// POST /.netlify/functions/build-teams  { numTeams?: number, useCombos?: boolean, combos?: [{ player_a, player_b, kind: 'together'|'apart' }] }
// Super can pass raters: [ids] to build from those raters' ratings only (ignored for organizers).
// POST { check: true } instead lists who's playing with no ratings yet, so the organizer can pick a tier for them.
// POST { teams: [[playerId, ...], ...], locked?: [playerId] } rates teams you made yourself instead of building them (any active
// players), lists what's off about them, and suggests up to three small swaps (combos are respected the same way).
// Organizers get lineups only; super also gets skill numbers. Ratings never leave the server for organizers.
import { SKILLS, buildTeams, combineRatings, describeTeam, weightedTotal, teamProblems, suggestSwaps } from '../../site/js/teams.mjs';
import { caller, json, rest } from '../lib/supabase.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const me = await caller(req);
  if (!me || !['organizer', 'super'].includes(me.role)) return json({ error: 'Organizers only' }, 403);

  const { numTeams = 4, useCombos = true, check = false, raters = null, combos: sent = [], teams: own = null, locked = [] } = await req.json().catch(() => ({}));
  const [players, ratings] = await Promise.all([
    rest('players?active=eq.true&select=id,name,gender,setting,playing,tier'),
    rest('ratings?select=rater_id,player_id,receiving,hitting,hustle,serve,blocking,consistency'),
  ]);
  if (me.role === 'super' && Array.isArray(raters) && !raters.length) return json({ error: 'Pick at least one rater' }, 400);
  const pick = me.role === 'super' && Array.isArray(raters) ? new Set(raters) : null;
  // Combos come with the request (they aren't saved). Keep only well-formed pairs of player ids.
  const pairs = (Array.isArray(sent) ? sent : [])
    .filter(c => Number.isInteger(c?.player_a) && Number.isInteger(c?.player_b) && c.player_a !== c.player_b)
    .map(c => ({ player_a: c.player_a, player_b: c.player_b, kind: c.kind === 'apart' ? 'apart' : 'together' }));
  const { combined } = combineRatings(players, pick ? ratings.filter(r => pick.has(r.rater_id)) : ratings);
  const playing = players.filter(p => p.playing).map(p => ({ ...p, unrated: !!combined.get(p.id).guess }));
  if (check) return json({ unrated: playing.filter(p => p.unrated).map(({ id, name }) => ({ id, name, tier: combined.get(id).guess })) });
  const skills = new Map([...combined].map(([id, c]) => [id, c.skills]));

  let result;
  if (own != null) {
    // Your own teams: same numbers as a built option, nothing rearranged.
    const byId = new Map(players.map(p => [p.id, { ...p, unrated: !!combined.get(p.id).guess }]));
    const ids = Array.isArray(own) ? own.map(t => (Array.isArray(t) ? t : []).filter(id => byId.has(id))) : [];
    const flat = ids.flat();
    if (ids.filter(t => t.length).length < 2) return json({ error: 'Add at least two teams with players in them' }, 400);
    if (new Set(flat).size !== flat.length) return json({ error: 'A player is on more than one team' }, 400);
    const teams = ids.filter(t => t.length).map(t => describeTeam(t.map(id => byId.get(id)), skills));
    result = { warnings: [], options: [{ teams }] };
    const sizes = new Set(teams.map(t => t.players.length));
    if (sizes.size > 1) result.warnings.push(`Teams aren't the same size (${teams.map(t => t.players.length).join(', ')} players).`);
    const unratedOwn = flat.map(id => byId.get(id)).filter(p => p.unrated).map(p => `${p.name} (${combined.get(p.id).guess})`);
    if (unratedOwn.length) result.warnings.push(`No ratings yet for ${unratedOwn.join(', ')}.`);

    // What's off, and the smallest swaps that improve it.
    const kept = ids.filter(t => t.length);
    const together = useCombos ? pairs.filter(c => c.kind !== 'apart').map(c => [c.player_a, c.player_b]) : [];
    const apart = useCombos ? pairs.filter(c => c.kind === 'apart').map(c => [c.player_a, c.player_b]) : [];
    const asPlayers = ts => ts.map(t => t.map(id => byId.get(id)));
    const gap = ts => { const tot = ts.map(t => t.reduce((a, id) => a + weightedTotal(skills.get(id)), 0)); return Math.max(...tot) - Math.min(...tot); };
    const before = teamProblems(asPlayers(kept), skills, apart);
    const { suggestions } = suggestSwaps({ players: [...byId.values()], skills, teams: kept, combos: together, apart,
      locked: (Array.isArray(locked) ? locked : []).filter(id => byId.has(id)) });
    result.problems = before;
    result.suggestions = suggestions.map(sg => {
      const after = teamProblems(asPlayers(sg.teams), skills, apart);
      return {
        swaps: sg.swaps.map(([a, b]) => [a, b].map(id => ({ id, name: byId.get(id).name, team: kept.findIndex(t => t.includes(id)) + 1 }))),
        teams: sg.teams,
        gap: [gap(kept), gap(sg.teams)],
        fixes: before.filter(x => !after.includes(x)),
        adds: after.filter(x => !before.includes(x)),
      };
    });
  } else try {
    result = buildTeams({
      players: playing, skills, numTeams: Number(numTeams),
      combos: useCombos ? pairs.filter(c => c.kind !== 'apart').map(c => [c.player_a, c.player_b]) : [],
      apart: useCombos ? pairs.filter(c => c.kind === 'apart').map(c => [c.player_a, c.player_b]) : [],
      timeBudgetMs: 7000,
    });
  } catch (e) {
    return json({ error: e.message }, 400);
  }

  const unrated = playing.filter(p => p.unrated).map(p => `${p.name} (${combined.get(p.id).guess})`);
  if (own == null && unrated.length) result.warnings.push(`No ratings yet for ${unrated.join(', ')}.`);

  if (me.role === 'super') {
    // Each team's weighted total and skill sums by each rater on their own (only their ratings, no leans taken out).
    // guessed = players on that team this rater hasn't rated at all, so a stand-in level was used.
    const ids = pick ? [...pick] : [...new Set(ratings.map(r => r.rater_id))];
    const names = new Map((await rest('profiles?select=id,display_name')).map(p => [p.id, p.display_name]));
    const per = ids.map(id => ({ id, name: names.get(id) ?? 'Someone', combined: combineRatings(players, ratings.filter(r => r.rater_id === id)).combined }));
    for (const opt of result.options) {
      opt.byRater = per.map(({ id, name, combined: c }) => ({
        rater_id: id, name,
        totals: opt.teams.map(t => t.players.reduce((a, p) => a + weightedTotal(c.get(p.id).skills), 0)),
        sums: opt.teams.map(t => Object.fromEntries(SKILLS.map(s => [s, t.players.reduce((a, p) => a + c.get(p.id).skills[s], 0)]))),
        guessed: opt.teams.map(t => t.players.filter(p => c.get(p.id).guess).length),
      }));
    }
  } else {
    // Weak passers and inconsistent players come from ratings, which organizers don't see.
    const ok = x => !/^(Weak passers|Inconsistent players)/.test(x);
    if (result.problems) result.problems = result.problems.filter(ok);
    for (const sg of result.suggestions ?? []) { delete sg.gap; sg.fixes = sg.fixes.filter(ok); sg.adds = sg.adds.filter(ok); }
    for (const opt of result.options) {
      delete opt.score; delete opt.byRater;
      for (const t of opt.teams) { delete t.sums; delete t.weighted; t.players = t.players.map(({ id, name, setting }) => ({ id, name, setting })); }
    }
  }
  return json(result);
};
