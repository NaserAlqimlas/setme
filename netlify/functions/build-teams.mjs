// POST /.netlify/functions/build-teams  { numTeams?: number, useCombos?: boolean, combos?: [{ player_a, player_b, kind: 'together'|'apart' }] }
// raters: [ids] builds from those raters' ratings only. { listRaters: true } returns who has rated anyone.
// allGame: [playerId] = setters who set all game (default: every main setter); see teamSkills in teams.mjs.
// POST { check: true } instead lists who's playing with no ratings yet, so the organizer can pick a tier for them.
// POST { teams: [[playerId, ...], ...], locked?: [playerId] } rates teams you made yourself instead of building them (any active
// players), lists what's off about them, and suggests up to three small swaps (combos are respected the same way).
// Organizers and super can add suggestRater: id to work out problems and suggestions from that one rater's ratings (cards still get all).
// Organizers get team numbers, combined and per rater (byRater). Player-level ratings never leave the server for organizers.
import { SKILLS, buildTeams, combineRatings, describeTeam, strength, teamSkills, teamProblems, suggestSwaps } from '../../site/js/teams.mjs';
import { caller, json, rest } from '../lib/supabase.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const me = await caller(req);
  if (!me || !['organizer', 'super'].includes(me.role)) return json({ error: 'Organizers only' }, 403);

  const { numTeams = 4, useCombos = true, check = false, raters = null, combos: sent = [], teams: own = null, locked = [], suggestRater = null, allGame: sentAllGame = null, listRaters = false } = await req.json().catch(() => ({}));
  const [players, ratings] = await Promise.all([
    rest('players?active=eq.true&select=id,name,gender,setting,playing,tier'),
    rest('ratings?select=*'), // * so it still works before the setting_skill column is added
  ]);
  // Who has rated anyone, for the Ratings from picker (organizers can't read other people's rating rows).
  if (listRaters) {
    const has = new Set(ratings.map(r => r.rater_id));
    return json({ raters: (await rest('profiles?select=id,display_name')).filter(p => has.has(p.id)) });
  }
  if (Array.isArray(raters) && !raters.length) return json({ error: 'Pick at least one rater' }, 400);
  const pick = Array.isArray(raters) ? new Set(raters) : null;
  // Combos come with the request (they aren't saved). Keep only well-formed pairs of player ids.
  const pairs = (Array.isArray(sent) ? sent : [])
    .filter(c => Number.isInteger(c?.player_a) && Number.isInteger(c?.player_b) && c.player_a !== c.player_b)
    .map(c => ({ player_a: c.player_a, player_b: c.player_b, kind: c.kind === 'apart' ? 'apart' : 'together' }));
  const { combined } = combineRatings(players, pick ? ratings.filter(r => pick.has(r.rater_id)) : ratings);
  const playing = players.filter(p => p.playing).map(p => ({ ...p, unrated: !!combined.get(p.id).guess }));
  if (check) return json({ unrated: playing.filter(p => p.unrated).map(({ id, name }) => ({ id, name, tier: combined.get(id).guess })) });
  // Setters who set all game (picked on the Teams page; main setters if not sent): see teamSkills.
  const allGame = new Set(Array.isArray(sentAllGame) ? sentAllGame.filter(Number.isInteger) : players.filter(p => p.setting === 'M').map(p => p.id));
  const skills = teamSkills(players, combined, allGame);

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
    // Looking at one rater (Show ratings from): judge the teams by that rater's ratings alone.
    const solo = typeof suggestRater === 'string' && ratings.some(r => r.rater_id === suggestRater) && (!pick || pick.has(suggestRater));
    const sk = solo ? teamSkills(players, combineRatings(players, ratings.filter(r => r.rater_id === suggestRater)).combined, allGame) : skills;
    const gapBy = ts => { const tot = ts.map(t => t.reduce((a, id) => a + strength(sk.get(id)), 0)); return Math.max(...tot) - Math.min(...tot); };
    result.suggestRater = solo ? suggestRater : null;
    const before = teamProblems(asPlayers(kept), sk, apart, together);
    const { suggestions } = suggestSwaps({ players: [...byId.values()], skills: sk, teams: kept, combos: together, apart,
      locked: (Array.isArray(locked) ? locked : []).filter(id => byId.has(id)) });
    result.problems = before;
    result.suggestions = suggestions.map(sg => {
      const after = teamProblems(asPlayers(sg.teams), sk, apart, together);
      return {
        swaps: sg.swaps.map(([a, b]) => [a, b].map(id => ({ id, name: byId.get(id).name, team: kept.findIndex(t => t.includes(id)) + 1 }))),
        teams: sg.teams,
        gap: [gapBy(kept), gapBy(sg.teams)],
        fixes: before.filter(x => !after.some(y => y.key === x.key)),
        adds: after.filter(x => !before.some(y => y.key === x.key)),
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

  {
    // Each team's weighted total and skill sums by each rater on their own (only their ratings, no leans taken out).
    // guessed = players on that team this rater hasn't rated at all, so a stand-in level was used.
    const ids = pick ? [...pick] : [...new Set(ratings.map(r => r.rater_id))];
    const names = new Map((await rest('profiles?select=id,display_name')).map(p => [p.id, p.display_name]));
    const per = ids.map(id => {
      const c = combineRatings(players, ratings.filter(r => r.rater_id === id)).combined;
      return { id, name: names.get(id) ?? 'Someone', c, sk: teamSkills(players, c, allGame) };
    });
    for (const opt of result.options) {
      opt.byRater = per.map(({ id, name, c, sk }) => ({
        rater_id: id, name,
        totals: opt.teams.map(t => t.players.reduce((a, p) => a + strength(sk.get(p.id)), 0)),
        sums: opt.teams.map(t => Object.fromEntries([...SKILLS.map(s => [s, t.players.reduce((a, p) => a + sk.get(p.id)[s], 0)]), ['setting', t.players.reduce((a, p) => a + sk.get(p.id).setEff, 0)]])),
        guessed: opt.teams.map(t => t.players.filter(p => c.get(p.id).guess).length),
      }));
    }
  }
  if (me.role !== 'super') {
    // Organizers see team numbers (combined or one rater's, per team) but never a single player's ratings.
    for (const opt of result.options) for (const t of opt.teams) t.players = t.players.map(({ id, name, setting, allGame }) => ({ id, name, setting, allGame }));
  }
  // Problems go out as full text; a suggestion's fixes and new problems as the short form.
  if (result.problems) result.problems = result.problems.map(x => x.text);
  for (const sg of result.suggestions ?? []) { sg.fixes = sg.fixes.map(x => x.short); sg.adds = sg.adds.map(x => x.short); }
  return json(result);
};
