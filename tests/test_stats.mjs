// Run: node tests/test_stats.mjs
import { bestPlayers, gameScore, isSetter, flipSides, recap, score, suggestAction, nextServer, teamSummary, tally, tallyFromCounts, fromRows, metrics, statRatings, levelOf, SKILL_STATS, withDays, endsRally, rotations, gameDetail, positions, serveCycle } from '../site/js/stats.mjs';

let fail = 0;
const ok = (title, cond, ...info) => { if (!cond) { fail++; console.log('FAIL', title, ...info); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

const game = { players_a: [1, 2, 3], players_b: [4, 5, 6] };
const T = (p, a, g) => ({ p, a, g, t: 0 });

// Score and team numbers.
const rallies = [
  { serve: 'a', won: 'a', touches: [T(1, 'serve', 3)] },                                        // ace
  { serve: 'a', won: 'b', touches: [T(1, 'serve', 1), T(4, 'pass', 2), T(5, 'set', 2), T(6, 'attack', 3)] }, // side-out kill
  { serve: 'b', won: 'b', touches: [T(4, 'serve', 1), T(2, 'pass', 0)] },                         // pass error
  { serve: 'b', won: 'a', touches: [T(4, 'serve', 0)] },                                          // serve error
  { serve: 'a', won: null, touches: [T(2, 'serve', 1)] },                                         // still open
];
ok('score', JSON.stringify(score(rallies)) === '{"a":2,"b":2}', score(rallies));
const ts = teamSummary(rallies, game);
ok('served/held', ts.a.served === 2 && ts.a.held === 1 && ts.b.served === 2 && ts.b.held === 1, ts);
ok('side-out rate', near(ts.b.sideOutRate, .5) && near(ts.a.sideOutRate, .5), ts);
ok('aces kills errors', ts.a.aces === 1 && ts.b.kills === 1 && ts.a.errors === 1 && ts.b.errors === 1, ts);
ok('ends rally', endsRally('attack', 3) === 'won' && endsRally('serve', 0) === 'lost' && endsRally('pass', 2) === null);

// Suggested action.
ok('first touch serve', suggestAction({ serve: 'a', touches: [] }, 'a', game) === 'serve');
ok('then pass', suggestAction({ serve: 'a', touches: [T(1, 'serve', 1)] }, 'b', game) === 'pass');
ok('then set', suggestAction({ serve: 'a', touches: [T(1, 'serve', 1), T(4, 'pass', 2)] }, 'b', game) === 'set');
ok('then attack', suggestAction({ serve: 'a', touches: [T(1, 'serve', 1), T(4, 'pass', 2), T(5, 'set', 2)] }, 'b', game) === 'attack');
ok('then dig', suggestAction({ serve: 'a', touches: [T(1, 'serve', 1), T(4, 'pass', 2), T(5, 'set', 2), T(6, 'attack', 2)] }, 'a', game) === 'dig');

// Serving order: same server while holding serve, next one after a side-out, then round again.
const R = (serve, won, p) => ({ serve, won, touches: [T(p, 'serve', 1)] });
ok('first server', nextServer([], 'a', [1, 2, 3]) === 1);
ok('holds serve', nextServer([R('a', 'a', 1)], 'a', [1, 2, 3]) === 1);
ok('next after side-out', nextServer([R('a', 'b', 1), R('b', 'a', 4)], 'a', [1, 2, 3]) === 2);
ok('observed order kept', nextServer([R('a', 'b', 3), R('b', 'a', 4)], 'a', [1, 2, 3]) === 1);
const round = [R('a', 'b', 2), R('b', 'a', 4), R('a', 'b', 1), R('b', 'a', 5), R('a', 'b', 3), R('b', 'a', 6)];
ok('wraps around', nextServer(round, 'a', [1, 2, 3]) === 2, nextServer(round, 'a', [1, 2, 3]));

// Tally and metrics.
const tl = tally([{ game, rallies }]);
const m1 = metrics(tl.get(1));
ok('games counted', tl.get(1).games === 1 && tl.get(6).games === 1);
ok('serve numbers', m1.serves === 2 && near(m1.aceRate, .5) && near(m1.serveValue, .5), m1);
ok('attack eff', near(metrics(tl.get(6)).attackEff, 1));
const open1 = tally([{ game, rallies: [{ serve: 'a', won: null, touches: [T(1, 'serve', 3)] }] }]);
ok('unfinished game not played', open1.get(1).games === 0 && open1.get(1).counts.serve[3] === 1 && !open1.has(2));

// From the database views: same numbers as from memory.
const fromViews = tallyFromCounts([{ player_id: 1, games: 1, serve_3: 1, serve_1: 1 }, { player_id: 6, games: 1, attack_3: 1 }]);
ok('views match memory', JSON.stringify(metrics(fromViews.get(1))) === JSON.stringify(m1) && near(metrics(fromViews.get(6)).attackEff, 1));
ok('missing columns are zero', tallyFromCounts([{ player_id: 1, games: 2 }]).get(1).counts.dig[2] === 0);
// Digs: Up, Good and Perfect all keep the ball alive; the average grades them 0 to 3.
const dg = metrics(tallyFromCounts([{ player_id: 1, games: 2, dig_0: 1, dig_1: 1, dig_3: 2 }]).get(1));
ok('perfect digs count', dg.digs === 4 && near(dg.digsPerGame, 1.5) && near(dg.digAvg, 7 / 4), dg);

// Moving tags to another game: sides swap when the other game lists the teams the other way round.
{
  const g1 = { team_a: 1, team_b: 2, players_a: [1, 2, 3], players_b: [4, 5, 6] };
  const g2 = { team_a: 2, team_b: 1, players_a: [4, 5, 6], players_b: [1, 2, 3] };
  const g3 = { team_a: 3, team_b: 4, players_a: [7, 8], players_b: [9, 10] };
  ok('same order, no flip', !flipSides(rallies, g1, game));
  ok('other way round, flip', flipSides(rallies, g1, g2));
  ok('no shared players, by team', !flipSides(rallies, g1, g3) && flipSides([], g1, g2));
}

// Rows from the database: sorted by seq, renamed.
const rows = fromRows([
  { id: 'r2', seq: 2, video_t: 30, serving: 'b', won_by: null, touches: [{ seq: 1, player_id: 2, action: 'pass', grade: 2, video_t: 31 }, { seq: 0, player_id: 4, action: 'serve', grade: 1, video_t: 30 }] },
  { id: 'r1', seq: 1, video_t: 10, serving: 'a', won_by: 'a', touches: [] }]);
ok('rows sorted', rows[0].id === 'r1' && rows[1].touches[0].a === 'serve' && rows[1].touches[1].p === 2 && rows[1].t === 30 && rows[0].won === 'a', rows);

// SetMe ratings: fixed steps, own stats only, few attempts pulled to the middle.
const many = [];
const players = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, setting: 'N' }));
for (let k = 0; k < 4; k++) many.push({ game: { players_a: [1, 2, 3], players_b: [4, 5, 6] }, rallies: [{ serve: 'a', won: 'a', touches:
  players.flatMap(p => Array.from({ length: 5 }, (_, j) => T(p.id, 'pass', p.id === 6 ? (j ? 3 : 0) : Math.min(3, Math.floor((p.id - 1) / 2) + (j % 2))))) }] });
const { ratings, detail } = statRatings(tally(many), players);
const rc = id => ratings.get(id)?.receiving;
ok('receiving rated', detail.receiving.players === 6 && !detail.receiving.skipped, detail.receiving);
ok('better passers higher', rc(1) <= rc(3) && rc(3) <= rc(5), [...ratings]);
ok('read off the steps, not ranked, exact', rc(1) === 0 && rc(3) === .41 && rc(5) === .86, [rc(1), rc(3), rc(5)]);
ok('two decimals, 0 to 1', [...ratings.values()].every(r => Object.values(r).every(v => v >= 0 && v <= 1 && Math.round(v * 100) === v * 100)));
ok('no serve data, no serve rating', detail.serve.skipped && ![...ratings.values()].some(r => 'serve' in r));
ok('no blocks tagged, no blocking rating', detail.blocking.untagged && ![...ratings.values()].some(r => 'blocking' in r));
ok('one player is enough', statRatings(tally(many), players.slice(0, 1)).ratings.get(1)?.receiving === 0);
ok('setting only for setters', statRatings(tally(many), players).detail.setting_skill.skipped);
{
  // Tagging a game someone wasn't in leaves their rating alone.
  const extra = [...many, { game: { players_a: [7], players_b: [8] }, rallies: [{ serve: 'a', won: 'a', touches: Array.from({ length: 20 }, () => T(7, 'pass', 0)) }] }];
  const more = [...players, { id: 7, setting: 'N' }, { id: 8, setting: 'N' }];
  const after = statRatings(tally(extra), more).ratings;
  ok('others\' games don\'t move you', players.every(p => after.get(p.id)?.receiving === rc(p.id)), [...after]);
  ok('their own rating is low', after.get(7)?.receiving === 0);
}
ok('hustle left to people', !('hustle' in SKILL_STATS) && ![...ratings.values()].some(r => 'hustle' in r));
{
  // Consistency: game score per game on each game day. Player 1 is the same every day, player 2 swings, player 3 has two days.
  const day = (pid, session, kills, errs) => ({ player_id: pid, session_id: session, games: 2, attack_3: kills, attack_0: errs });
  const rows = [1, 2, 3, 4].flatMap(s => [day(1, s, 6, 2), day(2, s, s % 2 ? 14 : 0, s % 2 ? 0 : 6)]).concat([day(3, 1, 4, 0), day(3, 2, 8, 0)]);
  const tallies = withDays(tally(many), rows);
  const r = statRatings(tallies, players).ratings;
  ok('steady player rates high', r.get(1)?.consistency === .95, r.get(1));
  ok('swinging player rates low', r.get(2)?.consistency === 0, r.get(2));
  ok('too few game days, no consistency', r.get(3)?.consistency === undefined);
  ok('no game-day data, no consistency', statRatings(tally(many), players).detail.consistency.untagged);
}
ok('levels between steps', Math.abs(levelOf(SKILL_STATS.receiving.steps, 1.4) - .375) < 1e-9 && levelOf(SKILL_STATS.receiving.steps, 0) === 0 && levelOf(SKILL_STATS.receiving.steps, 3) === 1);

// Recap: results from saved scores, a stat line per player by team, sorted by points.
{
  const g1 = { team_a: 1, team_b: 2, players_a: [1, 2, 3], players_b: [4, 5, 6], score_a: 25, score_b: 20 };
  const g2 = { team_a: 2, team_b: 1, players_a: [4, 5, 6], players_b: [1, 2, 3], score_a: 25, score_b: 23 };
  const g3 = { team_a: 1, team_b: 2, players_a: [1, 2, 3], players_b: [4, 5, 6], score_a: 10, score_b: 8 }; // untagged
  const day = recap([
    { game: g1, rallies },
    { game: g2, rallies: [{ serve: 'a', won: 'a', touches: [T(4, 'serve', 3)] }, { serve: 'a', won: 'a', touches: [T(4, 'pass', 3), T(4, 'pass', 1), T(6, 'attack', 3), T(6, 'attack', 0)] }] },
    { game: g3, rallies: [] }]);
  ok('all results', day.results.length === 3 && day.results[2].score_a === 10 && day.tagged === 2, day.results);
  const line = id => day.players.find(p => p.pid === id);
  ok('everyone who played', day.players.length === 6 && line(3).points === 0 && line(3).team === 1, day.players);
  ok('hits and kills', line(6).attacks === 3 && line(6).kills === 2 && line(6).points === 2, line(6));
  ok('serves in', line(4).serves === 3 && line(4).servesIn === 2 && line(4).aces === 1, line(4));
  ok('receives good of total', line(4).passes === 3 && line(4).passesGood === 2 && line(2).passes === 1 && line(2).passesGood === 0, line(4), line(2));
  ok('by team, then points', day.players.map(p => p.team).join() === '1,1,1,2,2,2' && day.players[3].pid === 6, day.players.map(p => p.pid));
  ok('untagged day: results only', recap([{ game: g3, rallies: [] }]).players.length === 0);
}

// Best player on each team in a game.
{
  const g = { players_a: [1, 2, 3], players_b: [4, 5] };
  const R = (...touches) => ({ won: 'a', touches });
  const rs = [R(T(1, 'attack', 3)), R(T(1, 'attack', 3), T(2, 'pass', 3), T(2, 'set', 2)), R(T(2, 'serve', 0)), R(T(3, 'dig', 2)),
    R(T(4, 'attack', 3)), R(T(5, 'attack', 3))];
  ok('game score: points − errors + good touches / 2', gameScore({ attack: { 3: 2 }, pass: { 3: 1, 0: 1 }, set: { 2: 1 } }).score === 2, gameScore({ attack: { 3: 2 }, pass: { 3: 1, 0: 1 }, set: { 2: 1 } }));
  const best = bestPlayers(g, rs);
  ok('best on each team; a dead tie stars both', best.a.join() === '1' && best.b.join() === '4,5', best);
  ok('nobody did anything: no star', bestPlayers(g, []).a.length === 0);
  // A setter with lots of good sets would top the list; they're left out and the star goes to the next best.
  const sets = Array.from({ length: 8 }, () => R(T(3, 'set', 3)));
  ok('setter: mostly sets', isSetter({ set: { 3: 8 } }) && !isSetter({ set: { 3: 2 } }) && !isSetter({ set: { 2: 3 }, attack: { 3: 4 } }));
  ok('no star for the setter', bestPlayers(g, [...rs, ...sets]).a.join() === '1', bestPlayers(g, [...rs, ...sets]));
}

// Rotations: named by who serves; a team stays in one while serving and after losing the serve, until its side-out.
{
  const g = { players_a: [1, 2], players_b: [4, 5] };
  const S = (serve, won, p, ...more) => ({ serve, won, touches: [T(p, 'serve', 1), ...more] });
  const rs = [
    S('b', 'b', 4),   // a receives before it has served: a's rotation before 1 (2, once the order is known); b holds in 4
    S('b', 'a', 4),   // a sides out, still in 2's rotation; b loses in 4
    S('a', 'a', 1),   // a in 1, holds
    S('a', 'a', 1),
    S('a', 'b', 1),   // a loses the serve in 1
    S('b', 'b', 5),   // b sides out (counted for b's rotation 4 above), now 5 serves and holds; a still in 1
    S('b', 'a', 5),   // a sides out in 1
    S('a', 'b', 2),   // a in 2, loses
  ];
  const rot = rotations(rs, g, 1);
  const by = (s, p) => rot[s].find(r => r.server === p);
  ok('rotation order', rot.a.map(r => r.server).join() === '1,2' && rot.b.map(r => r.server).join() === '4,5', rot);
  ok('a in 1', by('a', 1).won === 3 && by('a', 1).lost === 2 && by('a', 1).held === 2 && by('a', 1).served === 3 && by('a', 1).sideOut === 1, by('a', 1));
  ok('a before first serve counts for the last server', by('a', 2).rallies === 3 && by('a', 2).won === 1 && by('a', 2).received === 2, by('a', 2));
  ok('b in 4', by('b', 4).rallies === 5 && by('b', 4).won === 2 && by('b', 4).sideOut === 1, by('b', 4));
  ok('every rally counted once per team', rot.a.reduce((t, r) => t + r.rallies, 0) === rs.length && rot.b.reduce((t, r) => t + r.rallies, 0) === rs.length);
  ok('best and worst', rot.a.best.join() === '1' && rot.a.worst.join() === '2', rot.a.best, rot.a.worst);
  ok('min rallies', rotations(rs, g, 4).a.best.length === 0);
  // Order not known yet: rallies received before the team's first serve aren't counted.
  const part = rotations([S('b', 'b', 4), S('b', 'a', 4), S('a', 'a', 1)], g, 1);
  ok('partial order skips', part.a.length === 1 && part.a[0].rallies === 1, part.a);
}

// Game detail: where points came from, runs, serve receive, attack efficiency.
{
  const d = gameDetail(rallies, game);
  ok('from', d.a.from.aces === 1 && d.a.from.errors === 1 && d.b.from.kills === 1 && d.b.from.errors === 1, d.a.from, d.b.from);
  ok('runs', d.a.run === 1 && d.b.run === 2, d.a.run, d.b.run);
  // a received twice: a 0 pass (lost) and a serve error (no pass); b received an ace (0) and a 2 pass (won).
  ok('pass', d.a.pass.n === 1 && d.a.pass.avg === 0 && d.b.pass.n === 2 && d.b.pass.avg === 1 && d.b.pass.goodRate === 1 && d.b.pass.poorRate === 0, d.a.pass, d.b.pass);
  ok('attack eff', d.b.attackEff === 1 && d.a.attackEff === null, d.b);
}

// Positions from the serving order: server in 1, next server in 2, and so on.
{
  const g = { players_a: [1, 2, 3, 4, 5, 6], players_b: [7, 8, 9, 10, 11, 12] };
  const S = (serve, won, p, ...more) => ({ serve, won, touches: [T(p, 'serve', 1), ...more] });
  const rs = [
    S('b', 'b', 7, T(3, 'pass', 2)),   // a receives before serving: rotation before 1's, so 6 is in 1, 1 in 2, 3 in 4
    S('b', 'a', 7, T(3, 'attack', 3)), // a sides out, same spots
    S('a', 'b', 1),                    // a: 1 serving, so 3 is in 3
    S('b', 'a', 8),
    S('a', 'a', 2), S('a', 'b', 2),    // 2 serving: 3 in 2, 1 in 6
    S('b', 'a', 9), S('a', 'b', 3), S('b', 'a', 10), S('a', 'b', 4), S('b', 'a', 11), S('a', 'b', 5),   // 6 never served
  ];
  const p = positions(rs, g);
  const at = (pid, n) => p.a.players.get(pid)[n - 1];
  ok('positions ok', p.a.ok && p.a.players.size === 6 && p.a.unplaced.length === 0, p.a);
  ok('received before first serve', at(3, 4).rallies === 2 && at(3, 4).won === 1 && at(3, 4).counts.pass[2] === 1 && at(3, 4).counts.attack[3] === 1, at(3, 4));
  ok('server is in 1', at(1, 1).rallies === 2 && at(2, 1).rallies === 3 && at(1, 1).counts.serve[1] === 1, at(1, 1));
  ok('next server in 2', at(3, 2).rallies === 3 && at(1, 6).rallies === 3, at(3, 2), at(1, 6));
  ok('sixth fills the last slot', at(6, 1).rallies === 2, at(6, 1));
  ok('every rally placed once per player', [...p.a.players.values()].every(rows => rows.reduce((t, r) => t + r.rallies, 0) === rs.length));
  ok('not six', positions(rs, { players_a: [1, 2, 3], players_b: g.players_b }).a.why === 'size');
  const few = positions([S('a', 'b', 1), S('b', 'a', 7), S('a', 'b', 2)], g);
  ok('unplaced', few.a.ok && few.a.players.size === 2 && few.a.unplaced.length === 4 && few.b.players.size === 1, few.a);
}

// A setter who stays front middle: the other five rotate round 1, 2, 4, 5, 6 and serve; the order comes round after five.
{
  const g = { players_a: [1, 2, 3, 4, 5, 6], players_b: [7, 8, 9, 10, 11, 12] };
  const S = (serve, won, p, ...more) => ({ serve, won, touches: [T(p, 'serve', 1), ...more] });
  const lap = [1, 2, 3, 4, 5, 1].flatMap((p, i) => [S('a', 'b', p, T(6, 'set', 2)), S('b', 'a', 7 + (i % 6), T(6, 'set', 2))]);
  const c = serveCycle(lap, g, 'a');
  ok('fixed setter found', c.fixed === 6 && c.size === 5 && !c.guessed, c);
  const p = positions(lap, g);
  ok('fixed in 3 every rally', p.a.fixed === 6 && p.a.players.get(6)[2].rallies === lap.length && p.a.players.get(6)[2].counts.set[2] === 12, p.a.players.get(6)[2]);
  ok('the rest skip 3', [1, 2, 3, 4, 5].every(pid => p.a.players.get(pid)[2].rallies === 0), p.a);
  // 1 serves in 1; next rally (b serves) a is still in that rotation: 2 in 2, 3 in 4, 4 in 5, 5 in 6.
  ok('five spots', p.a.players.get(2)[1].rallies === 4 && p.a.players.get(3)[3].rallies === 4 && p.a.players.get(5)[5].rallies === 4, p.a.players.get(2));
  ok('five rotations', rotations(lap, g, 1).a.length === 5 && rotations(lap, g, 1).a.reduce((t, r) => t + r.rallies, 0) === lap.length);
  ok('six rotate normally', serveCycle(lap, g, 'b').fixed === null);
  // Order not round yet: the one left to serve did most of the setting -> guessed fixed; otherwise all six rotate.
  const short = lap.slice(0, 10);
  ok('guessed from sets', serveCycle(short, g, 'a').fixed === 6 && serveCycle(short, g, 'a').guessed);
  const noSets = short.map(r => ({ ...r, touches: r.touches.filter(t => t.a !== 'set') }));
  ok('no setting, assume six', serveCycle(noSets, g, 'a').fixed === null && positions(noSets, g).a.players.size === 6);
}

console.log(fail ? `${fail} failed` : 'stats: all passed');
process.exit(fail ? 1 : 0);
