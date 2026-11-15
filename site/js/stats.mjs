// Match stats tagged by hand while watching a game's video. Pure functions, shared by the Scores page (tagging),
// the Ratings page (per-player stats, SetMe's ratings) and tests.
//
// One game's tags in memory, oldest first (stored as rows in rallies and touches; see fromRows):
//   [{ id, seq, t, serve: 'a' | 'b', won: 'a' | 'b' | null, touches: [{ p: player id, a: action, g: grade, t }] }]
// t = seconds into the video. 'a' / 'b' = the game's first / second team (games.team_a / team_b).

// Grades run 0 (worst) to 3 (best), the usual volleyball scale. end: 'won' / 'lost' = the grade ends the rally for
// the player's side, so tagging it closes the rally on its own.
export const ACTIONS = {
  serve: { label: 'Serve', key: 's', grades: [[0, 'Error', 'lost'], [1, 'In'], [2, 'Tough'], [3, 'Ace', 'won']] },
  pass: { label: 'Pass', key: 'p', grades: [[0, 'Error', 'lost'], [1, 'Poor'], [2, 'Good'], [3, 'Perfect']] },
  set: { label: 'Set', key: 't', grades: [[0, 'Error', 'lost'], [1, 'Poor'], [2, 'Good'], [3, 'Perfect']] },
  attack: { label: 'Attack', key: 'a', grades: [[0, 'Error', 'lost'], [1, 'Blocked'], [2, 'In play'], [3, 'Kill', 'won']] },
  block: { label: 'Block', key: 'b', grades: [[0, 'Error', 'lost'], [1, 'Touch'], [3, 'Stuff', 'won']] },
  dig: { label: 'Dig', key: 'd', grades: [[0, 'Miss', 'lost'], [1, 'Up'], [2, 'Good'], [3, 'Perfect']] },
};
export const gradeLabel = (a, g) => ACTIONS[a]?.grades.find(x => x[0] === g)?.[1] ?? String(g);
export const endsRally = (a, g) => ACTIONS[a]?.grades.find(x => x[0] === g)?.[2] ?? null;
export const other = side => side === 'a' ? 'b' : 'a';

// Which side a player was on in this game.
export const sideOf = (game, pid) => game.players_a.includes(pid) ? 'a' : game.players_b.includes(pid) ? 'b' : null;

// Tags moved from game `from` to game `to`: do 'a' and 'b' need swapping? Yes when most touches were by players on
// the other side in `to`; with no players in common, when the two teams are listed the other way round.
export function flipSides(rallies, from, to) {
  let same = 0, opposite = 0;
  for (const r of rallies) for (const t of r.touches) {
    const s1 = sideOf(from, t.p), s2 = sideOf(to, t.p);
    if (s1 && s2) s1 === s2 ? same++ : opposite++;
  }
  return same || opposite ? opposite > same : from.team_a === to.team_b && from.team_b === to.team_a;
}

export function score(rallies) {
  const s = { a: 0, b: 0 };
  for (const r of rallies) if (r.won) s[r.won]++;
  return s;
}

// What a touch most likely is, given the rally so far: serve first, then pass, set, attack; the other side then blocks or digs.
export function suggestAction(rally, side, game) {
  const ts = rally?.touches ?? [];
  if (!ts.length) return side === rally?.serve ? 'serve' : 'pass';
  const last = ts.at(-1), lastSide = sideOf(game, last.p);
  if (lastSide !== side) return last.a === 'serve' ? 'pass' : last.a === 'attack' ? 'dig' : 'pass';
  return last.a === 'pass' || last.a === 'dig' ? 'set' : last.a === 'set' ? 'attack' : 'set';
}

// Who serves for this side next. Same server while their side keeps the serve; after a side-out, the next player in
// the order they first served, or the first player in the lineup who hasn't served yet.
export function nextServer(rallies, side, lineup) {
  const servers = [];
  for (const r of rallies) for (const t of r.touches) if (t.a === 'serve' && r.serve === side && !servers.includes(t.p)) servers.push(t.p);
  const done = rallies.filter(r => r.won);
  const prev = done.at(-1);
  const lastServe = [...rallies].reverse().flatMap(r => r.serve === side ? r.touches.filter(t => t.a === 'serve') : []).at(0);
  if (lastServe && prev && prev.serve === side && prev.won === side) return lastServe.p;
  const fresh = lineup.find(p => !servers.includes(p));
  if (!lastServe) return fresh ?? lineup[0] ?? null;
  if (fresh != null && servers.length < lineup.length) return fresh;
  const order = servers.filter(p => lineup.includes(p));
  return order[(order.indexOf(lastServe.p) + 1) % order.length] ?? lineup[0] ?? null;
}

// Team numbers for one game: points won serving, side-out rate, aces, kills, stuffs and errors given away.
export function teamSummary(rallies, game) {
  const out = { a: { served: 0, held: 0, received: 0, sideOut: 0, aces: 0, kills: 0, stuffs: 0, errors: 0 } };
  out.b = { ...out.a };
  for (const r of rallies) {
    if (!r.won) continue;
    const recv = other(r.serve);
    out[r.serve].served++; out[recv].received++;
    if (r.won === r.serve) out[r.serve].held++; else out[recv].sideOut++;
    for (const t of r.touches) {
      const s = sideOf(game, t.p); if (!s) continue;
      if (t.a === 'serve' && t.g === 3) out[s].aces++;
      if (t.a === 'attack' && t.g === 3) out[s].kills++;
      if (t.a === 'block' && t.g === 3) out[s].stuffs++;
      if (endsRally(t.a, t.g) === 'lost') out[s].errors++;
    }
  }
  for (const s of ['a', 'b']) out[s].sideOutRate = out[s].received ? out[s].sideOut / out[s].received : null;
  return out;
}

// Per player: games played and how many of each action and grade, from the database view player_stats
// (one row per player: { player_id, games, serve_0 … dig_3 }). A column the view doesn't have yet counts as 0.
export function tallyFromCounts(rows) {
  return new Map(rows.map(r => [r.player_id, { games: r.games ?? 0,
    counts: Object.fromEntries(Object.entries(ACTIONS).map(([a, d]) => [a, Object.fromEntries(d.grades.map(([g]) => [g, r[`${a}_${g}`] ?? 0]))])) }]));
}

// One player's tally for each game, from their own touches (my-stats). touches: [{ game_id, action, grade }];
// games: [{ id, ... }] -> [{ ...game, tally }] in the same order, each tally counting that game once.
export function gameTallies(touches, games) {
  return games.map(g => {
    const row = { player_id: 0, games: 1 };
    for (const t of touches) if (t.game_id === g.id) { const k = `${t.action}_${t.grade}`; row[k] = (row[k] ?? 0) + 1; }
    return { ...g, tally: tallyFromCounts([row]).get(0) };
  });
}

// The same from games in memory, as the views would count them. docs: [{ game, rallies }]. A game counts as played
// when the player was in its lineup and the game has at least one finished rally.
export function tally(docs) {
  const rows = new Map();
  const get = p => { if (!rows.has(p)) rows.set(p, { player_id: p, games: 0 }); return rows.get(p); };
  for (const { game, rallies } of docs) {
    if (rallies.some(r => r.won)) for (const p of [...game.players_a, ...game.players_b]) get(p).games++;
    for (const r of rallies) for (const t of r.touches) { const row = get(t.p), k = `${t.a}_${t.g}`; row[k] = (row[k] ?? 0) + 1; }
  }
  return tallyFromCounts([...rows.values()]);
}

// Rallies as stored (rallies with embedded touches, from the database) to the shape used here, oldest first.
export const fromRows = rows => [...rows].sort((a, b) => a.seq - b.seq).map(r => ({
  id: r.id, seq: r.seq, t: r.video_t, serve: r.serving, won: r.won_by,
  touches: [...(r.touches ?? [])].sort((a, b) => a.seq - b.seq).map(t => ({ p: t.player_id, a: t.action, g: t.grade, t: t.video_t })),
}));

const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
// Readable numbers from a tally entry. Rates are null without attempts.
export function metrics(t) {
  const c = t.counts, n = a => sum(c[a]);
  const avg = a => n(a) ? Object.entries(c[a]).reduce((s, [g, k]) => s + g * k, 0) / n(a) : null;
  const rate = (a, g) => n(a) ? c[a][g] / n(a) : null;
  const per = v => t.games ? v / t.games : null;
  return {
    games: t.games,
    serves: n('serve'), aceRate: rate('serve', 3), serveErr: rate('serve', 0),
    serveValue: n('serve') ? (c.serve[3] + c.serve[2] * .5 - c.serve[0]) / n('serve') : null,
    passes: n('pass'), passAvg: avg('pass'),
    sets: n('set'), setAvg: avg('set'),
    attacks: n('attack'), killRate: rate('attack', 3),
    attackEff: n('attack') ? (c.attack[3] - c.attack[0] - c.attack[1]) / n('attack') : null,
    stuffsPerGame: per(c.block[3]), blockValue: per(c.block[3] + c.block[1] * .5 - c.block[0]),
    digs: n('dig'), digAvg: avg('dig'),
    digsPerGame: per(c.dig[1] + c.dig[2] + c.dig[3]),
    ...daySpread(t.days),
  };
}

// How much a player's game score (gameScore, per game) moves from one game day to the next: the standard deviation
// across the days they played tagged games. days: [tally per game day] (withDays), or none.
function daySpread(days) {
  const xs = (days ?? []).filter(d => d.games > 0).map(d => gameScore(d.counts).score / d.games);
  if (xs.length < 2) return { days: xs.length, daySpread: null };
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { days: xs.length, daySpread: Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)) };
}

// Adds each player's game-day tallies (rows of the player_day_stats view: player_id, session_id, games, counts) to
// their overall tally, for consistency.
export function withDays(tallies, dayRows) {
  for (const r of dayRows ?? []) {
    const t = tallies.get(r.player_id);
    if (t) (t.days ??= []).push(tallyFromCounts([r]).get(r.player_id));
  }
  return tallies;
}

// How SetMe turns stats into ratings, per skill: the number used, how many attempts it rests on, the minimum, and the
// action that has to be tagged at all. steps: the stat that earns 0, .25, .5, .75 and 1, the same for everyone, so a
// player's rating only moves when their own play does. Setting only for players marked as setters. Hustle isn't
// derived (digs per game says more about where the ball went than about effort).
// Consistency: the spread of their game score between game days, lower is steadier, so its steps are negative spreads.
export const SKILL_STATS = {
  receiving: { label: 'Pass average', value: m => m.passAvg, n: m => m.passes, min: 8, action: 'pass', steps: [.8, 1.2, 1.6, 2, 2.4] },
  hitting: { label: 'Attack efficiency', value: m => m.attackEff, n: m => m.attacks, min: 8, action: 'attack', steps: [-.2, 0, .15, .3, .45] },
  serve: { label: 'Serve value', value: m => m.serveValue, n: m => m.serves, min: 10, action: 'serve', steps: [-.35, -.15, 0, .15, .3] },
  blocking: { label: 'Blocks per game', value: m => m.blockValue, n: m => m.games, min: 3, action: 'block', steps: [0, .25, .6, 1, 1.5] },
  setting_skill: { label: 'Set average', value: m => m.setAvg, n: m => m.sets, min: 10, setters: true, action: 'set', steps: [1, 1.4, 1.8, 2.2, 2.5] },
  consistency: { label: 'Spread between game days', value: m => m.daySpread == null ? null : -m.daySpread, n: m => m.days, min: 3, steps: [-4, -3, -2, -1.25, -.75] },
};
// Skills SetMe used to rate and no longer does: saving clears them from SetMe's rows.
export const SETME_CLEARS = ['hustle'];
const LEVELS = [0, .25, .5, .75, 1];

// A stat on the 0 to 1 scale: straight lines between the steps, capped at both ends.
export function levelOf(steps, v) {
  if (v <= steps[0]) return 0;
  for (let i = 1; i < steps.length; i++) if (v <= steps[i]) return LEVELS[i - 1] + (v - steps[i - 1]) / (steps[i] - steps[i - 1]) * .25;
  return 1;
}

// SetMe's ratings. Each player's number comes from their own stats only: a small sample is pulled toward the middle
// step (.5) by how few attempts it rests on (a player with `min` attempts lands halfway), then read off the fixed
// steps, kept exact (to 2 decimals). Mixed with people's ratings it's rounded to .25 (combineRatings); on its own it
// isn't. Tagging other people's games never moves it.
// A skill is left out while nobody has a single tag of its action (blocks often aren't tagged at first), and
// consistency while there are no game-day tallies (before consistency.sql).
// players: [{ id, setting }]. Returns Map player id -> { skill: rating }, and per skill the numbers behind it.
export function statRatings(tallies, players) {
  const ratings = new Map(), detail = {};
  for (const [skill, def] of Object.entries(SKILL_STATS)) {
    const tagged = def.action ? [...tallies.values()].some(t => sum(t.counts[def.action] ?? {}) > 0) : [...tallies.values()].some(t => t.days?.length);
    if (!tagged) { detail[skill] = { players: 0, skipped: true, untagged: true }; continue; }
    const rows = players
      .filter(p => !def.setters || (p.setting && p.setting !== 'N'))
      .map(p => { const t = tallies.get(p.id); const m = t && metrics(t); return m && { id: p.id, v: def.value(m), n: def.n(m) }; })
      .filter(r => r && r.v != null && r.n >= def.min);
    const middle = def.steps[2];
    for (const r of rows) {
      r.adj = (r.v * r.n + middle * def.min) / (r.n + def.min);
      r.rating = Math.round(levelOf(def.steps, r.adj) * 100) / 100;
      if (!ratings.has(r.id)) ratings.set(r.id, {});
      ratings.get(r.id)[skill] = r.rating;
    }
    detail[skill] = { players: rows.length, skipped: !rows.length, rows };
  }
  return { ratings, detail };
}

// Recap of one game or a whole game day, for sharing. docs: [{ game, rallies }] (untagged games have no rallies).
// results: every game as saved on Scores, with its round (1 before rounds). players: a stat line for everyone who
// played a tagged game, grouped by round and team number (their team in the last tagged game they played) and
// sorted by points.
export function recap(docs) {
  const results = docs.map(({ game }) => ({ team_a: game.team_a, team_b: game.team_b, score_a: game.score_a, score_b: game.score_b, round: game.round ?? 1 }));
  const tagged = docs.filter(d => d.rallies.some(r => r.won));
  const teamOf = new Map(), roundOf = new Map();
  for (const { game } of tagged) {
    for (const p of game.players_a) { teamOf.set(p, game.team_a); roundOf.set(p, game.round ?? 1); }
    for (const p of game.players_b) { teamOf.set(p, game.team_b); roundOf.set(p, game.round ?? 1); }
  }
  const t = tally(tagged), sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  const players = [...teamOf].map(([pid, team]) => {
    const c = t.get(pid)?.counts;
    const round = roundOf.get(pid);
    if (!c) return { pid, team, round, points: 0, kills: 0, attacks: 0, aces: 0, serves: 0, servesIn: 0, passes: 0, passesGood: 0, blocks: 0, digs: 0, sets: 0 };
    return { pid, team, round,
      points: c.attack[3] + c.serve[3] + c.block[3],
      kills: c.attack[3], attacks: sum(c.attack),
      aces: c.serve[3], serves: sum(c.serve), servesIn: sum(c.serve) - c.serve[0],
      passes: sum(c.pass), passesGood: c.pass[2] + c.pass[3],
      blocks: c.block[3], digs: c.dig[1] + c.dig[2] + c.dig[3], sets: sum(c.set) };
  }).sort((a, b) => a.round - b.round || a.team - b.team || b.points - a.points || b.kills - a.kills || a.pid - b.pid);
  return { results, players, tagged: tagged.length };
}

// How well a player played one game, from their tags: points scored (kills, aces, stuff blocks), minus errors
// (any touch that lost the rally), plus half a point for each good or perfect pass, dig or set.
export function gameScore(counts) {
  const c = a => counts?.[a] ?? {};
  const points = (c('attack')[3] ?? 0) + (c('serve')[3] ?? 0) + (c('block')[3] ?? 0);
  const errors = Object.keys(ACTIONS).reduce((t, a) => t + (c(a)[0] ?? 0), 0);
  const good = ['pass', 'dig', 'set'].reduce((t, a) => t + (c(a)[2] ?? 0) + (c(a)[3] ?? 0), 0);
  return { score: points - errors + good / 2, points, errors };
}

// Who set in a game: at least 3 sets, and sets at least half their touches. They touch the ball most, so they'd
// top every game's score; the star goes to someone else.
export function isSetter(counts) {
  const sum = a => Object.values(counts?.[a] ?? {}).reduce((t, n) => t + n, 0);
  const sets = sum('set'), all = Object.keys(ACTIONS).reduce((t, a) => t + sum(a), 0);
  return sets >= 3 && sets * 2 >= all;
}

// Each team's best players in one game, setters left out -> { a: [pid], b: [pid] }. Ties go to more points, then
// fewer errors; still tied, they all get the star. A best score of 0 or less earns no star.
export function bestPlayers(game, rallies) {
  const t = tally([{ game, rallies }]);
  const pick = ids => {
    const rows = ids.filter(pid => !isSetter(t.get(pid)?.counts)).map(pid => ({ pid, ...gameScore(t.get(pid)?.counts) }))
      .sort((x, y) => y.score - x.score || y.points - x.points || x.errors - y.errors);
    const [top] = rows;
    if (!top || top.score <= 0) return [];
    return rows.filter(r => r.score === top.score && r.points === top.points && r.errors === top.errors).map(r => r.pid);
  };
  return { a: pick(game.players_a), b: pick(game.players_b) };
}
