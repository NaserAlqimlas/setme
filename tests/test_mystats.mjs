// Run: node tests/test_mystats.mjs
// Your match stats: one player's touches tallied per game (gameTallies) and turned into numbers (metrics).
import { gameTallies, metrics } from '../site/js/stats.mjs';
let fail = 0;
const ok = (name, cond, got) => { if (!cond) { fail++; console.log('FAIL', name, got ?? ''); } else console.log('ok  ', name); };

const touches = [
  { game_id: 1, action: 'serve', grade: 3 }, { game_id: 1, action: 'serve', grade: 0 }, { game_id: 1, action: 'pass', grade: 2 },
  { game_id: 1, action: 'attack', grade: 3 }, { game_id: 1, action: 'attack', grade: 2 },
  { game_id: 2, action: 'pass', grade: 3 }, { game_id: 2, action: 'pass', grade: 1 }, { game_id: 2, action: 'dig', grade: 1 },
  { game_id: 9, action: 'serve', grade: 3 },  // not one of the listed games: ignored
];
const games = [{ id: 2, played_on: '2026-11-08', mine: 25, theirs: 17 }, { id: 1, played_on: '2026-11-01', mine: 20, theirs: 25 }];
const per = gameTallies(touches, games);
ok('one entry per game, in the order given', per.map(g => g.id).join() === '2,1', per.map(g => g.id));
ok('game fields kept', per[0].played_on === '2026-11-08' && per[0].mine === 25);
const c1 = per[1].tally.counts;
ok('game 1 counts', c1.serve[3] === 1 && c1.serve[0] === 1 && c1.pass[2] === 1 && c1.attack[3] === 1 && c1.attack[2] === 1, c1);
ok('touches from other games left out', per.every(g => g.tally.counts.serve[3] <= 1));
const m2 = metrics(per[0].tally);
ok('game 2 pass average', m2.passAvg === 2 && m2.passes === 2, m2);
ok('each game counts once', per.every(g => g.tally.games === 1));
ok('a game with no touches tallies to zero', gameTallies([], [{ id: 5 }])[0].tally.counts.attack[3] === 0);
console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
