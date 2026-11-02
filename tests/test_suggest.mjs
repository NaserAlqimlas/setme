// Run: node tests/test_suggest.mjs
import { suggestSwaps, teamProblems, weightedTotal } from '../site/js/teams.mjs';

let fail = 0;
const ok = (cond, msg) => { if (!cond) { fail++; console.log('FAIL', msg); } };
// 8 players, 2 teams of 4. Strong players all on team 1, both setters on team 2.
const lvl = [1, 1, .75, .75, .25, .25, .5, .5];
const players = lvl.map((v, i) => ({ id: i + 1, name: `P${i + 1}`, gender: 'M', setting: i === 4 || i === 5 ? 'M' : 'N', unrated: false }));
const skills = new Map(players.map((p, i) => [p.id, { receiving: lvl[i], hitting: lvl[i], hustle: lvl[i], serve: lvl[i], blocking: lvl[i], consistency: .5 }]));
const teams = [[1, 2, 3, 4], [5, 6, 7, 8]];
const gap = ts => { const t = ts.map(x => x.reduce((a, id) => a + weightedTotal(skills.get(id)), 0)); return Math.max(...t) - Math.min(...t); };
const byId = new Map(players.map(p => [p.id, p]));

const txt = ps => ps.map(x => x.text);
const probs = txt(teamProblems(teams.map(t => t.map(id => byId.get(id))), skills));
ok(probs.includes('Team 1 has no setter or backup setter') && probs.includes('Team 2 has 2 main setters (P5, P6)'), `problems: ${probs}`);
const weak = probs.find(x => x.startsWith('Weak passers'));
ok(weak === 'Weak passers (receiving .25 or below, not counting setters who set all game) are bunched up: Team 1 has none · Team 2 has 2 (P5, P6). Best is no more than 1 apart.', `weak text: ${weak}`);

const { base, suggestions } = suggestSwaps({ players, skills, teams });
ok(suggestions.length >= 1 && suggestions.length <= 3, `count ${suggestions.length}`);
ok(suggestions.every(s => s.cost < base), 'every suggestion lowers the score');
ok(suggestions[0].swaps.length === 1, 'single swap comes first');
ok(gap(suggestions[0].teams) < gap(teams), 'first suggestion narrows the gap');
const after = txt(teamProblems(suggestions[0].teams.map(t => t.map(id => byId.get(id))), skills));
ok(!after.some(x => x.startsWith('Team 1 has no setter')), `first suggestion gives team 1 a setter: ${after}`);
ok(suggestions.every(s => s.teams.flat().sort().join() === teams.flat().sort().join()), 'same players, nobody lost');

// Locked players never move.
const locked = suggestSwaps({ players, skills, teams, locked: [5, 1] });
ok(locked.suggestions.every(s => s.swaps.flat().every(id => id !== 5 && id !== 1)), 'locked players stay');
// A "together" pair on the same team is never split.
const tog = suggestSwaps({ players, skills, teams, combos: [[1, 2], [5, 6]] });
ok(tog.suggestions.every(s => s.swaps.flat().every(id => ![1, 2, 5, 6].includes(id))), 'together pairs stay together');
// A together pair on different teams: listed, and the top suggestion reunites them.
const splitPair = [[3, 7]];
const sp = txt(teamProblems(teams.map(t => t.map(id => byId.get(id))), skills, [], splitPair));
ok(sp.includes('P3 is on Team 1 and P7 is on Team 2 (set to play together)'), `split together pair listed: ${sp}`);
const re = suggestSwaps({ players, skills, teams, combos: splitPair });
const tOf = (ts, id) => ts.findIndex(t => t.includes(id));
ok(re.suggestions.length && tOf(re.suggestions[0].teams, 3) === tOf(re.suggestions[0].teams, 7), 'top suggestion reunites the pair');
// Reunited, then locked in: the next round never splits them again.
const next = suggestSwaps({ players, skills, teams: re.suggestions[0].teams, combos: splitPair });
ok(next.suggestions.every(s => !s.swaps.flat().some(id => id === 3 || id === 7)), 'reunited pair stays together');
// Keep-apart pair on one team shows up as a problem and gets fixed.
const ap = txt(teamProblems(teams.map(t => t.map(id => byId.get(id))), skills, [[1, 2]]));
ok(ap.includes('P1 and P2 are both on Team 1 (set to keep apart)'), 'keep-apart problem listed');
// Already balanced teams: no suggestions.
const fair = suggestSwaps({ players, skills, teams: [[1, 4, 5, 8], [2, 3, 6, 7]] });
ok(fair.suggestions.every(s => s.cost < fair.base), 'only improvements, even when nearly balanced');

console.log(fail ? `${fail} failed` : 'ok');
process.exit(fail ? 1 : 0);
