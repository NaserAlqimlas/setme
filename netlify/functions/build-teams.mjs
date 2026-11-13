// POST /.netlify/functions/build-teams  { numTeams?: number, useCombos?: boolean, combos?: [{ player_a, player_b, kind: 'together'|'apart' }] }
// raters: [ids] builds from those raters' ratings only. { listRaters: true } returns who has rated anyone, and everyone's names.
// allGame: [playerId] = setters who set all game (default: every main setter); see teamSkills in teams.mjs.
// POST { check: true } instead lists who's playing with no ratings yet, so the organizer can pick a tier for them.
// POST { teams: [[playerId, ...], ...], locked?: [playerId] } rates teams you made yourself instead of building them (any active
// players), lists what's off about them, and suggests up to three small swaps (combos are respected the same way).
// Organizers and super can add suggestRater: id to work out problems and suggestions from that one rater's ratings (cards still get all).
// POST { predict: true, teams } returns only each team's numbers ({ teams: [{ weighted, sums, size, women, setters, unrated }] }),
// stored with a game's score on the Scores page. Team totals only, like everything organizers get.
// Organizers get team numbers, combined and per rater (byRater). Player-level ratings never leave the server for organizers.
// variety (default on): the last game days' teams before playedOn (sessions) are passed to the builder so the same
// teammates don't keep landing together; each option lists its repeat pairs (names only, nothing from ratings).
// spreadWomen (default on): split women evenly across teams (and flag it when they aren't); false ignores gender.
// resultsAdjust: shift each player's numbers by how their teams have done against the ratings (resultAdjustments in
// scores.mjs) before building or checking. Never used for predict, so stored predictions stay ratings-only.
import { SKILLS, buildTeams, combineRatings, describeTeam, strength, teamSkills, teamProblems, suggestSwaps, adjustSkills, repeatPairs, VARIETY } from '../../site/js/teams.mjs';
import { resultAdjustments } from '../../site/js/scores.mjs';
import { caller, json, rest } from '../lib/supabase.mjs';

// Recent game days' teams, newest first, before `day` when given. [] before the scores upgrade.
// Building a later round on `day` itself: the rounds already played that day come first, so round 2 mixes up
// round 1's teammates (rounds.sql; skipped before it runs, or while the day has no games yet).
const cleanTeams = teams => (Array.isArray(teams) ? teams : []).map(t => (Array.isArray(t) ? t : []).filter(Number.isInteger));
async function recentTeams(day) {
  const rows = await rest(`sessions?select=played_on,teams&order=played_on.desc&limit=${VARIETY.length + 1}${day ? `&played_on=lt.${encodeURIComponent(day)}` : ''}`).catch(() => []);
  const past = rows.slice(0, VARIETY.length).map(r => cleanTeams(r.teams));
  if (!day) return past;
  const [today] = await rest(`sessions?select=id,teams&played_on=eq.${encodeURIComponent(day)}`).catch(() => []);
  if (!today) return past;
  const [played, kept] = await Promise.all([
    rest(`games?select=round&session_id=eq.${today.id}`).catch(() => []),
    rest(`rounds?select=n,teams&session_id=eq.${today.id}&order=n.desc`).catch(() => []),
  ]);
  if (!played.length) return past;
  const cur = kept.length + 1;
  const sameDay = [...(played.some(g => (g.round ?? 1) === cur) ? [today.teams] : []), ...kept.map(r => r.teams)];
  return [...sameDay.map(cleanTeams), ...past].slice(0, VARIETY.length);
}

// Each movable player's best one-for-one swaps, shown when you tap them on a team card:
// { [id]: [{ id, name, team, gap: [now, after], better, fixes, adds }] } (fixes/adds: short problem text).
function swapHints(teams, { partners, base }, { byId, sk, apart, together, spreadWomen }) {
  const asPlayers = ts => ts.map(t => t.map(id => byId.get(id)));
  const gapBy = ts => { const tot = ts.map(t => t.reduce((a, id) => a + strength(sk.get(id)), 0)); return Math.max(...tot) - Math.min(...tot); };
  const before = teamProblems(asPlayers(teams), sk, apart, together, { spreadWomen }), gap = gapBy(teams);
  const out = {};
  for (const [a, list] of partners) out[a] = list.map(({ id: b, cost }) => {
    const after = teams.map(t => t.map(id => id === a ? b : id === b ? a : id));
    const probs = teamProblems(asPlayers(after), sk, apart, together, { spreadWomen });
    return { id: b, name: byId.get(b).name, team: teams.findIndex(t => t.includes(b)) + 1, gap: [gap, gapBy(after)], better: cost < base - 1e-6,
      fixes: before.filter(x => !probs.some(y => y.key === x.key)).map(x => x.short), adds: probs.filter(x => !before.some(y => y.key === x.key)).map(x => x.short) };
  });
  return out;
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const me = await caller(req);
  if (!me || !['organizer', 'super'].includes(me.role)) return json({ error: 'Organizers only' }, 403);

  const { numTeams = 4, useCombos = true, check = false, raters = null, combos: sent = [], teams: own = null, locked = [], suggestRater = null, allGame: sentAllGame = null, listRaters = false, predict = false, variety = true, playedOn = null, resultsAdjust = false, spreadWomen: sentSpread = true } = await req.json().catch(() => ({}));
  const [players, ratings] = await Promise.all([
    rest('players?active=eq.true&select=id,name,gender,setting,playing,tier'),
    rest('ratings?select=*'), // * so it still works before the setting_skill column is added
  ]);
  // Who has rated anyone, for the Ratings from picker (organizers can't read other people's rating rows), and everyone's
  // name (people), for who made each draft. Names only, never emails.
  if (listRaters) {
    const has = new Set(ratings.map(r => r.rater_id));
    const people = await rest('profiles?select=id,display_name');
    return json({ raters: people.filter(p => has.has(p.id)), people });
  }
  if (Array.isArray(raters) && !raters.length) return json({ error: 'Pick at least one rater' }, 400);
  const pick = Array.isArray(raters) ? new Set(raters) : null;
  // Combos come with the request (they aren't saved). Keep only well-formed pairs of player ids.
  const pairs = (Array.isArray(sent) ? sent : [])
    .filter(c => Number.isInteger(c?.player_a) && Number.isInteger(c?.player_b) && c.player_a !== c.player_b)
    .map(c => ({ player_a: c.player_a, player_b: c.player_b, kind: c.kind === 'apart' ? 'apart' : 'together' }));
  const { combined } = combineRatings(players, pick ? ratings.filter(r => pick.has(r.rater_id)) : ratings);
  // Results-adjusted numbers (not for predictions, which must stay what the ratings alone said).
  let adjusted = 0;
  if (resultsAdjust && !predict) {
    const adj = resultAdjustments(await rest('games?select=session_id,players_a,players_b,score_a,score_b,predicted').catch(() => []));
    adjustSkills(combined, adj);
    adjusted = [...adj.values()].filter(v => Math.abs(v) >= .005).length;
  }
  const spreadWomen = sentSpread !== false;
  const day = typeof playedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(playedOn) ? playedOn : null;
  const history = variety && !predict ? await recentTeams(day) : [];
  const playing = players.filter(p => p.playing).map(p => ({ ...p, unrated: !!combined.get(p.id).guess }));
  if (check) return json({ unrated: playing.filter(p => p.unrated).map(({ id, name }) => ({ id, name, tier: combined.get(id).guess })) });
  // Setters who set all game (picked on the Teams page; main setters if not sent): see teamSkills.
  const allGame = new Set(Array.isArray(sentAllGame) ? sentAllGame.filter(Number.isInteger) : players.filter(p => p.setting === 'M').map(p => p.id));
  const skills = teamSkills(players, combined, allGame);

  if (predict) {
    const byId = new Map(players.map(p => [p.id, p]));
    const ids = Array.isArray(own) ? own.map(t => (Array.isArray(t) ? t : []).filter(id => byId.has(id))) : [];
    if (ids.length < 2 || ids.some(t => !t.length)) return json({ error: 'Each team needs at least one player' }, 400);
    return json({ teams: ids.map(t => {
      const d = describeTeam(t.map(id => byId.get(id)), skills);
      return { weighted: d.weighted, sums: d.sums, size: t.length, women: d.players.filter(p => p.gender === 'F').length,
        setters: d.players.filter(p => p.setting === 'M').length, unrated: t.filter(id => combined.get(id).guess).length };
    }) });
  }

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
    // Against the playing list (once one is set): who's on a team but not playing, and who's playing but on no team.
    if (playing.length) {
      const on = new Set(flat);
      const out = flat.map(id => byId.get(id)).filter(p => !p.playing).map(({ id, name }) => ({ id, name }));
      const bench = playing.filter(p => !on.has(p.id)).map(({ id, name }) => ({ id, name }));
      result.offList = { out, bench };
      if (out.length) result.warnings.push(`Not on the playing list: ${out.map(p => p.name).join(', ')}. Tap them to replace them.`);
      if (bench.length) result.warnings.push(`Playing but on no team: ${bench.map(p => p.name).join(', ')}.`);
    }

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
    const before = teamProblems(asPlayers(kept), sk, apart, together, { spreadWomen });
    const swapped = suggestSwaps({ players: [...byId.values()], skills: sk, teams: kept, combos: together, apart, history, spreadWomen,
      locked: (Array.isArray(locked) ? locked : []).filter(id => byId.has(id)) });
    const { suggestions } = swapped;
    result.options[0].partners = swapHints(kept, swapped, { byId, sk, apart, together, spreadWomen });
    result.problems = before;
    result.suggestions = suggestions.map(sg => {
      const after = teamProblems(asPlayers(sg.teams), sk, apart, together, { spreadWomen });
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
      history, spreadWomen,
      timeBudgetMs: 7000,
    });
    // Best swaps per player for each built option too, so a tap shows them before the first swap.
    const byId = new Map(playing.map(p => [p.id, p]));
    const together = useCombos ? pairs.filter(c => c.kind !== 'apart').map(c => [c.player_a, c.player_b]) : [];
    const apart = useCombos ? pairs.filter(c => c.kind === 'apart').map(c => [c.player_a, c.player_b]) : [];
    for (const opt of result.options) {
      const teams = opt.teams.map(t => t.players.map(p => p.id));
      opt.partners = swapHints(teams, suggestSwaps({ players: playing, skills, teams, combos: together, apart, history, spreadWomen, top: 0 }),
        { byId, sk: skills, apart, together, spreadWomen });
    }
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
  // Pairs who were teammates on a recent game day, per option (ago 0 = the last one).
  const pname = new Map(players.map(p => [p.id, p.name]));
  for (const opt of result.options) {
    opt.repeats = repeatPairs(opt.teams.map(t => t.players.map(p => p.id)), history).map(r => ({ a: pname.get(r.a), b: pname.get(r.b), ago: r.ago }));
  }
  result.variety = history.length;
  result.adjusted = resultsAdjust ? adjusted : null;
  // Problems go out as full text; a suggestion's fixes and new problems as the short form.
  if (result.problems) result.problems = result.problems.map(x => x.text);
  for (const sg of result.suggestions ?? []) { sg.fixes = sg.fixes.map(x => x.short); sg.adds = sg.adds.map(x => x.short); }
  return json(result);
};
