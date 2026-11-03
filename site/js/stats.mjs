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
  dig: { label: 'Dig', key: 'd', grades: [[0, 'Miss', 'lost'], [1, 'Up'], [2, 'Good']] },
};
export const gradeLabel = (a, g) => ACTIONS[a]?.grades.find(x => x[0] === g)?.[1] ?? String(g);
export const endsRally = (a, g) => ACTIONS[a]?.grades.find(x => x[0] === g)?.[2] ?? null;
export const other = side => side === 'a' ? 'b' : 'a';

// Which side a player was on in this game.
export const sideOf = (game, pid) => game.players_a.includes(pid) ? 'a' : game.players_b.includes(pid) ? 'b' : null;

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
// (one row per player: { player_id, games, serve_0 … dig_2 }).
export function tallyFromCounts(rows) {
  return new Map(rows.map(r => [r.player_id, { games: r.games ?? 0,
    counts: Object.fromEntries(Object.entries(ACTIONS).map(([a, d]) => [a, Object.fromEntries(d.grades.map(([g]) => [g, r[`${a}_${g}`] ?? 0]))])) }]));
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
    digsPerGame: per(c.dig[1] + c.dig[2]),
  };
}

// How SetMe turns stats into ratings, per skill: the number used, how many attempts it rests on, and the minimum.
// A skill is left out while fewer than MIN_PLAYERS have enough attempts, or while everyone is level. Consistency isn't derived. Setting only for players marked as setters.
export const SKILL_STATS = {
  receiving: { label: 'Pass average', value: m => m.passAvg, n: m => m.passes, min: 8 },
  hitting: { label: 'Attack efficiency', value: m => m.attackEff, n: m => m.attacks, min: 8 },
  serve: { label: 'Serve value', value: m => m.serveValue, n: m => m.serves, min: 10 },
  blocking: { label: 'Blocks per game', value: m => m.blockValue, n: m => m.games, min: 3 },
  hustle: { label: 'Digs per game', value: m => m.digsPerGame, n: m => m.games, min: 3 },
  setting_skill: { label: 'Set average', value: m => m.setAvg, n: m => m.sets, min: 10, setters: true },
};
export const MIN_PLAYERS = 4; // fewer qualifying players than this and a skill isn't rated at all

// SetMe's ratings. Each number is pulled toward the group's average by how few attempts it rests on (a player with
// `min` attempts lands halfway), then players are ranked and spread over 0 to 1 in .25 steps: SetMe rates
// relative to the group, and combineRatings takes out its lean like any rater's.
// players: [{ id, setting }]. Returns Map player id -> { skill: rating }, and per skill the numbers behind it.
export function statRatings(tallies, players) {
  const ratings = new Map(), detail = {};
  for (const [skill, def] of Object.entries(SKILL_STATS)) {
    const rows = players
      .filter(p => !def.setters || (p.setting && p.setting !== 'N'))
      .map(p => { const t = tallies.get(p.id); const m = t && metrics(t); return m && { id: p.id, v: def.value(m), n: def.n(m) }; })
      .filter(r => r && r.v != null && r.n >= def.min);
    if (rows.length < MIN_PLAYERS) { detail[skill] = { players: rows.length, skipped: true }; continue; }
    const tot = rows.reduce((a, r) => a + r.n, 0), mean = rows.reduce((a, r) => a + r.v * r.n, 0) / tot;
    for (const r of rows) r.adj = (r.v * r.n + mean * def.min) / (r.n + def.min);
    // Everyone level (often: nobody tagged that action yet) says nothing about who's better.
    if (Math.max(...rows.map(r => r.adj)) - Math.min(...rows.map(r => r.adj)) < 1e-9) { detail[skill] = { players: rows.length, skipped: true, flat: true }; continue; }
    const sorted = [...rows].sort((a, b) => a.adj - b.adj);
    for (const r of rows) {
      // Rank 0..1 with ties sharing their average rank.
      const lo = sorted.findIndex(x => x.adj === r.adj), hi = sorted.findLastIndex(x => x.adj === r.adj);
      const rank = (lo + hi) / 2 / (sorted.length - 1);
      r.rating = Math.round(rank * 4) / 4;
      if (!ratings.has(r.id)) ratings.set(r.id, {});
      ratings.get(r.id)[skill] = r.rating;
    }
    detail[skill] = { players: rows.length, mean, rows };
  }
  return { ratings, detail };
}
