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
// the order they first served, or the first player in the lineup who hasn't served yet. fixed: a player who stays
// front middle (frontMiddle). They're never suggested after a side-out, since serving is up to them; when they do
// serve, the order carries on from the player who served before them.
export function nextServer(rallies, side, lineup, fixed = null) {
  const turn = lineup.filter(p => p !== fixed);
  const servers = [];
  for (const r of rallies) for (const t of r.touches) if (t.a === 'serve' && r.serve === side && !servers.includes(t.p)) servers.push(t.p);
  const done = rallies.filter(r => r.won);
  const prev = done.at(-1);
  const serves = [...rallies].reverse().flatMap(r => r.serve === side ? r.touches.filter(t => t.a === 'serve') : []);
  const lastServe = serves[0];
  if (lastServe && prev && prev.serve === side && prev.won === side) return lastServe.p;
  const order = servers.filter(p => turn.includes(p));
  const fresh = turn.find(p => !servers.includes(p));
  const last = serves.find(t => turn.includes(t.p));
  if (!last) return fresh ?? turn[0] ?? null;
  if (fresh != null && order.length < turn.length) return fresh;
  return order[(order.indexOf(last.p) + 1) % order.length] ?? turn[0] ?? null;
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

// A team's serving order in one game, and whether one player stayed front middle. In the usual game all six rotate.
// Sometimes the setter stays front middle and the other five rotate round them; the setter may still take a turn to
// serve (and run back to front middle in the same rally, the other five staying where they are) or let it pass.
// Who stayed front middle is per game and per team: chosen by a person (games.middle_set, middle_a / middle_b, null
// = nobody), or until then read from the tags: a serve that came back round after five servers means the sixth
// stayed (how 'served'); before it has, the one player yet to serve counts if they did most of the team's setting
// (how 'sets', a guess). Who sets can change during a game day, so the day's all-game setters aren't used.
//   order: the rotating players in the order they first served (the front-middle player's serves left out)
//   size: how many rotate, null when it can't be told yet
//   fixed: the front-middle player or null; how: 'chosen' | 'served' | 'sets' | null
export function frontMiddle(game, s) {
  return game.middle_set ? game[`middle_${s}`] ?? null : undefined;
}
export function serveCycle(rallies, game, s) {
  const lineup = game[`players_${s}`] ?? [];
  const done = rallies.filter(r => r.won);
  const serverOf = r => r.serve === s ? r.touches.find(t => t.a === 'serve' && sideOf(game, t.p) === s)?.p ?? null : null;
  const build = fixed => {
    const order = [], stints = [];
    let prev = null;
    for (const r of done) {
      if (r.serve !== s) { prev = null; continue; }
      const p = serverOf(r);
      if (p == null || p === fixed) continue;
      if (p !== prev) stints.push(p);
      prev = p;
      if (!order.includes(p)) order.push(p);
    }
    return { order, stints };
  };
  const chosen = frontMiddle(game, s);
  if (chosen !== undefined) {
    const { order } = build(chosen), rotating = lineup.filter(p => p !== chosen).length;
    return { order, size: order.length >= rotating ? order.length : null, fixed: chosen, how: chosen != null ? 'chosen' : null, serverOf };
  }
  const { order, stints } = build(null);
  const wrapped = stints.length > order.length && stints[order.length] === order[0];
  const left = lineup.filter(p => !order.includes(p));
  if (wrapped) {
    const fixed = order.length === 5 && left.length === 1 ? left[0] : null;
    return { order, size: order.length, fixed, how: fixed != null ? 'served' : null, serverOf };
  }
  if (lineup.length === 6 && order.length === 5 && left.length === 1) {
    const sets = new Map();
    for (const r of done) for (const t of r.touches) if (t.a === 'set' && sideOf(game, t.p) === s) sets.set(t.p, (sets.get(t.p) ?? 0) + 1);
    const top = Math.max(0, ...sets.values());
    const fixed = top >= 3 && sets.get(left[0]) === top ? left[0] : null;
    return { order, size: fixed ? 5 : 6, fixed, how: fixed != null ? 'sets' : null, serverOf };
  }
  return { order, size: order.length >= lineup.length ? order.length : null, fixed: null, how: null, serverOf };
}

// Each team's rotations in one game, named by the player serving in it (position 1). A team stays in a rotation
// while it serves and while it receives after losing the serve; it moves to the next one when it wins a side-out.
// So a rally counts for the serving team's rotation of its server, and for the receiving team's rotation of the
// last player it had serve. Rallies a team received before anyone on it served belong to the rotation before its
// first server's: the last in its serving order, once everyone has served; until then they aren't counted.
// -> { a: [row], b: [row] } in serving order, row = { server, rallies, won, lost, net, served, held, received, sideOut },
// and best / worst: the server of the rotation with the highest / lowest net, among those with at least `min`
// rallies (none when fewer than two rotations qualify or they're all level).
export function rotations(rallies, game, min = 3) {
  const out = {};
  const done = rallies.filter(r => r.won);
  for (const s of ['a', 'b']) {
    const { order, size, fixed, serverOf } = serveCycle(rallies, game, s);
    const full = size != null && order.length === size && order.length > 1;
    // A front-middle player who serves gets a row of their own, for the rallies they serve; the other five stay put,
    // so the team receives in the rotation it was in before.
    const fixedServes = fixed != null && done.some(r => serverOf(r) === fixed);
    const rows = new Map([...order, ...(fixedServes ? [fixed] : [])].map(p => [p, { server: p, rallies: 0, won: 0, lost: 0, served: 0, held: 0, received: 0, sideOut: 0 }]));
    let cur = null;
    for (const r of done) {
      const srv = r.serve === s ? serverOf(r) : null;
      if (srv != null && srv !== fixed) cur = srv;
      const p = srv != null && srv === fixed ? fixed : cur ?? (full ? order.at(-1) : null);
      const row = rows.get(p);
      if (!row) continue;
      row.rallies++;
      r.won === s ? row.won++ : row.lost++;
      if (r.serve === s) { row.served++; if (r.won === s) row.held++; }
      else { row.received++; if (r.won === s) row.sideOut++; }
    }
    const list = [...rows.values()].map(r => ({ ...r, net: r.won - r.lost }));
    const enough = list.filter(r => r.rallies >= min);
    const top = Math.max(...enough.map(r => r.net)), bottom = Math.min(...enough.map(r => r.net));
    const pick = v => enough.length > 1 && top !== bottom ? enough.filter(r => r.net === v).map(r => r.server) : [];
    out[s] = list;
    out[s].best = pick(top);
    out[s].worst = pick(bottom);
  }
  return out;
}

// Where each player stood, rally by rally, and their numbers in each court position. Positions aren't tagged; they
// follow from the serving order, which goes round the court: the server is in position 1 (back right), the next
// player to serve in 2 (front right), then 3 (front middle), 4 (front left), 5 (back left) and 6 (back middle).
// So with six a side, a player who has served has a known position in every rally once the team's rotation is
// known, including rallies received before the team first served (the rotation before its first server's). With
// five servers seen, the sixth player fills the last spot, unless they stayed front middle (serveCycle): then they
// are in 3 throughout (serving or not) and the other five go round 1, 2, 4, 5 and 6. Players who never served have no position.
// -> { a: side, b: side }, side = { ok, why?: 'size' | 'none', players: Map pid -> [6 rows, position 1 first],
// unplaced: [pid], fixed: pid | null, how (serveCycle) }, row = { rallies, won, lost, counts: { action: { grade: n } } } (counts as in tally()).
export const POSITIONS = [[1, 'Back right'], [2, 'Front right'], [3, 'Front middle'], [4, 'Front left'], [5, 'Back left'], [6, 'Back middle']];
export const FRONT_ROW = [2, 3, 4];
export function positions(rallies, game) {
  const out = {};
  const done = rallies.filter(r => r.won);
  const blank = () => Object.fromEntries(Object.entries(ACTIONS).map(([a, d]) => [a, Object.fromEntries(d.grades.map(([g]) => [g, 0]))]));
  for (const s of ['a', 'b']) {
    const lineup = game[`players_${s}`] ?? [];
    const { order: served, size, fixed, how, serverOf } = serveCycle(rallies, game, s);
    const order = [...served];
    const none = why => ({ ok: false, why, players: new Map(), unplaced: why === 'none' ? [...lineup] : [], fixed: null, how: null });
    if (lineup.length !== 6 || order.length > 6 || (size != null && size !== 6 && !fixed)) { out[s] = none('size'); continue; }
    if (!order.length && fixed == null) { out[s] = none('none'); continue; }
    const rot = lineup.filter(p => p !== fixed);
    if (order.length === rot.length - 1) order.push(rot.find(p => !order.includes(p)));   // one left to serve: the last spot
    // The spots the rotating players go round: all six, or the five around a player fixed in 3.
    const spots = fixed != null ? [1, 2, 4, 5, 6] : [1, 2, 3, 4, 5, 6], n = spots.length;
    const players = new Map([...order, ...(fixed != null ? [fixed] : [])].map(p => [p, POSITIONS.map(() => ({ rallies: 0, won: 0, lost: 0, counts: blank() }))]));
    const add = (p, spot, r) => {
      const row = players.get(p)[spot - 1];
      row.rallies++;
      r.won === s ? row.won++ : row.lost++;
      for (const t of r.touches) if (t.p === p && row.counts[t.a]?.[t.g] != null) row.counts[t.a][t.g]++;
    };
    let slot = null;
    for (const r of done) {
      if (r.serve === s) { const p = serverOf(r); if (p != null && p !== fixed) slot = order.indexOf(p); }
      // Received before its first serve: the rotation before slot 0. Served first by the front-middle player: the same.
      const at = slot ?? (r.serve !== s || (fixed != null && serverOf(r) === fixed) ? n - 1 : null);
      if (at == null) continue;
      for (const [i, p] of order.entries()) add(p, spots[(i - at + n) % n], r);
      if (fixed != null) add(fixed, 3, r);   // front middle all rally, even when they serve (they run back there)
    }
    out[s] = { ok: true, players, unplaced: lineup.filter(p => !players.has(p)), fixed, how };
  }
  return out;
}

// More team numbers for one game, per side:
//   from: how its points came: kills, aces, blocks, the other team's errors, and other (the rally's end wasn't tagged)
//   run: its longest streak of points in a row
//   pass: serve receive, the first touch after the other team's serve (an ace counts as a 0 pass), with its average
//     and the side-out rate after a good pass (2 or 3) and after a poor one (0 or 1)
//   attackEff: (kills - errors - blocked) / attacks, null without attacks
export function gameDetail(rallies, game) {
  const out = {};
  for (const s of ['a', 'b']) out[s] = { from: { kills: 0, aces: 0, blocks: 0, errors: 0, other: 0 }, run: 0,
    pass: { n: 0, sum: 0, good: 0, goodWon: 0, poor: 0, poorWon: 0 }, attacks: 0, attackEff: null, kills: 0, attackErr: 0 };
  const streak = { a: 0, b: 0 };
  for (const r of rallies) {
    if (!r.won) continue;
    const w = r.won, l = other(w);
    streak[w]++; streak[l] = 0;
    out[w].run = Math.max(out[w].run, streak[w]);
    const end = [...r.touches].reverse().find(t => endsRally(t.a, t.g) && sideOf(game, t.p));
    const f = out[w].from;
    if (!end) f.other++;
    else if (sideOf(game, end.p) !== w) f.errors++;
    else if (end.a === 'attack') f.kills++;
    else if (end.a === 'serve') f.aces++;
    else if (end.a === 'block') f.blocks++;
    else f.other++;
    // Serve receive.
    const recv = other(r.serve), ts = r.touches;
    const serve = ts.find(t => t.a === 'serve');
    if (!(serve && serve.g === 0)) {
      const first = ts.find(t => t.a !== 'serve' && sideOf(game, t.p) === recv);
      const g = first ? (first.a === 'pass' || first.a === 'dig' ? first.g : null) : serve?.g === 3 ? 0 : null;
      if (g != null) {
        const p = out[recv].pass, won = r.won === recv;
        p.n++; p.sum += g;
        if (g >= 2) { p.good++; if (won) p.goodWon++; } else { p.poor++; if (won) p.poorWon++; }
      }
    }
    for (const t of r.touches) {
      if (t.a !== 'attack') continue;
      const side = sideOf(game, t.p); if (!side) continue;
      out[side].attacks++;
      if (t.g === 3) out[side].kills++;
      if (t.g <= 1) out[side].attackErr++;
    }
  }
  for (const s of ['a', 'b']) {
    const o = out[s], p = o.pass;
    p.avg = p.n ? p.sum / p.n : null;
    p.goodRate = p.good ? p.goodWon / p.good : null;
    p.poorRate = p.poor ? p.poorWon / p.poor : null;
    o.attackEff = o.attacks ? (o.kills - o.attackErr) / o.attacks : null;
  }
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
