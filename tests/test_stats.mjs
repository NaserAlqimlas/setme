// Run: node tests/test_stats.mjs
import { score, suggestAction, nextServer, teamSummary, tally, metrics, statRatings, endsRally, MIN_PLAYERS } from '../site/js/stats.mjs';

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
ok('untagged game ignored', tally([{ game, rallies: [{ serve: 'a', won: null, touches: [T(1, 'serve', 3)] }] }]).size === 0);

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

console.log(fail ? `${fail} failed` : 'stats: all passed');
process.exit(fail ? 1 : 0);
