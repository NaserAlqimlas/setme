// Run: node tests/test_apart.mjs
// Keep-apart pairs never share a team; a pair that combos force together is an error.
import { buildTeams, SKILLS } from '../site/js/teams.mjs';

let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('FAIL', msg); } };

const players = Array.from({ length: 16 }, (_, i) => ({ id: i, name: `P${i}`, gender: 'M', setting: i < 4 ? 'M' : 'N' }));
const skills = new Map(players.map((p, i) => [p.id, Object.fromEntries(SKILLS.map(s => [s, [.25, .5, .75, 1][i % 4]]))]));
const apart = [[4, 5], [4, 6], [5, 6], [8, 9]];
const combos = [[4, 10]];

const res = buildTeams({ players, skills, combos, apart, numTeams: 4, timeBudgetMs: 2000, maxRestarts: 300 });
check(res.apartUsed === 4, 'all 4 apart pairs used');
for (const [oi, opt] of res.options.entries()) {
  const team = new Map();
  opt.teams.forEach((t, k) => t.players.forEach(p => team.set(p.id, k)));
  for (const [a, b] of apart) check(team.get(a) !== team.get(b), `option ${oi + 1}: P${a} and P${b} together`);
  check(team.get(4) === team.get(10), `option ${oi + 1}: combo P4 + P10 split`);
}
check(!res.warnings.some(w => w.includes('apart')), 'no apart warning when it worked');
console.log(`${res.options.length} options, warnings: ${res.warnings.join(' ') || 'none'}`);

// Combo P1 + P2 and P2 + P3, but P1 apart from P3: impossible, say who.
let msg = '';
try { buildTeams({ players, skills, combos: [[1, 2], [2, 3]], apart: [[1, 3]], numTeams: 4, maxRestarts: 10 }); } catch (e) { msg = e.message; }
check(msg.includes('P1') && msg.includes('P3'), `clash error names both players (got "${msg}")`);
console.log(`clash: ${msg}`);

console.log(fail ? `${fail} checks failed` : 'all checks passed');
process.exit(fail ? 1 : 0);
