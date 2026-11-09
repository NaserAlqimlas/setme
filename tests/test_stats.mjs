// Run: node tests/test_stats.mjs
import { recap, score, suggestAction, nextServer, teamSummary, tally, tallyFromCounts, fromRows, metrics, statRatings, endsRally, MIN_PLAYERS } from '../site/js/stats.mjs';

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

// Rows from the database: sorted by seq, renamed.
const rows = fromRows([
  { id: 'r2', seq: 2, video_t: 30, serving: 'b', won_by: null, touches: [{ seq: 1, player_id: 2, action: 'pass', grade: 2, video_t: 31 }, { seq: 0, player_id: 4, action: 'serve', grade: 1, video_t: 30 }] },
  { id: 'r1', seq: 1, video_t: 10, serving: 'a', won_by: 'a', touches: [] }]);
ok('rows sorted', rows[0].id === 'r1' && rows[1].touches[0].a === 'serve' && rows[1].touches[1].p === 2 && rows[1].t === 30 && rows[0].won === 'a', rows);

// SetMe ratings: better passers rank higher, few attempts get pulled to the middle, too few players = no rating.
const many = [];
const players = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, setting: 'N' }));
for (let k = 0; k < 4; k++) many.push({ game: { players_a: [1, 2, 3], players_b: [4, 5, 6] }, rallies: [{ serve: 'a', won: 'a', touches:
  players.flatMap(p => Array.from({ length: 5 }, (_, j) => T(p.id, 'pass', p.id === 6 ? (j ? 3 : 0) : Math.min(3, Math.floor((p.id - 1) / 2) + (j % 2))))) }] });
const { ratings, detail } = statRatings(tally(many), players);
const rc = id => ratings.get(id)?.receiving;
ok('receiving rated', detail.receiving.players === 6 && !detail.receiving.skipped, detail.receiving);
ok('ranked by passing', rc(1) <= rc(3) && rc(3) <= rc(5) && rc(1) === 0 && rc(5) === 1, [...ratings]);
ok('quarter steps', [...ratings.values()].every(r => Object.values(r).every(v => [0, .25, .5, .75, 1].includes(v))));
ok('no serve data, no serve rating', detail.serve.skipped && ![...ratings.values()].some(r => 'serve' in r));
ok('no blocks tagged, no blocking rating', detail.blocking.skipped && detail.blocking.flat && ![...ratings.values()].some(r => 'blocking' in r));
ok('too few players', statRatings(tally(many), players.slice(0, MIN_PLAYERS - 1)).detail.receiving.skipped);
ok('setting only for setters', statRatings(tally(many), players).detail.setting_skill.players === 0);


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

console.log(fail ? `${fail} failed` : 'stats: all passed');
process.exit(fail ? 1 : 0);
