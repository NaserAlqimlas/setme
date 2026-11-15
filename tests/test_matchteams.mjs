// Run: node tests/test_matchteams.mjs
// Comparing two drafts: teams paired by shared players, whoever changes teams counted.
import { matchTeams } from '../site/js/teams.mjs';

let fail = 0;
const check = (ok, msg, got) => { if (!ok) { fail++; console.log('FAIL', msg, got === undefined ? '' : JSON.stringify(got)); } };

// Same teams in a different order: paired up, nobody moved.
let m = matchTeams([[1, 2, 3], [4, 5, 6], [7, 8, 9]], [[7, 9, 8], [1, 2, 3], [6, 5, 4]]);
check(m.pairs.map(p => `${p.a}-${p.b}`).join() === '0-1,1-2,2-0', 'paired by players, not by number', m.pairs);
check(m.moved === 0 && m.pairs.every(p => !p.out.length && !p.in.length), 'nobody moved', m);

// One swap: 3 and 4 trade places.
m = matchTeams([[1, 2, 3], [4, 5, 6]], [[1, 2, 4], [3, 5, 6]]);
check(m.moved === 2, 'a swap moves two', m.moved);
check(m.pairs[0].stay.join() === '1,2' && m.pairs[0].out.join() === '3' && m.pairs[0].in.join() === '4', 'who left and who came', m.pairs[0]);

// Different players and a different number of teams.
m = matchTeams([[1, 2], [3, 4], [5, 6]], [[1, 2, 7], [3, 4, 5]]);
check(m.onlyA.join() === '6' && m.onlyB.join() === '7', 'players in one draft only', m);
check(m.pairs.length === 3 && m.pairs.some(p => p.b === null && p.a === 2), 'a team with no partner', m.pairs);
check(m.moved === 1, 'only 5 moved (6 is not in b at all)', m.moved);

// Ties keep a's order.
m = matchTeams([[1], [2]], [[3], [4]]);
check(m.pairs.map(p => p.b).join() === '0,1', 'ties keep the order', m.pairs);

console.log(fail ? `${fail} checks failed` : 'all checks passed');
process.exit(fail ? 1 : 0);
