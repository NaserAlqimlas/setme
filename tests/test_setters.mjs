// Run: node tests/test_setters.mjs
// When setters are short, no team gets two, and backups cover teams without a main setter.
import { buildTeams, SKILLS } from '../site/js/teams.mjs';

let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('FAIL', msg); } };

for (const [label, mains, backs] of [['2 main', 2, 0], ['2 main + 2 backup', 2, 2], ['0 main + 2 backup', 0, 2], ['3 main', 3, 0]]) {
  let stacked = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const players = Array.from({ length: 24 }, (_, i) => ({ id: i, name: `P${i}`, gender: 'M', setting: i < mains ? 'M' : i < mains + backs ? 'B' : 'N' }));
    // Strong setters, so balancing pulls against spreading them.
    const skills = new Map(players.map((p, i) => [p.id, Object.fromEntries(SKILLS.map(s => [s, i < mains + backs ? 1 : [.25, .5, .75][(i * 7 + seed) % 3]]))]));
    const res = buildTeams({ players, skills, numTeams: 4, seed, maxRestarts: 200, timeBudgetMs: 3000, options: 1 });
    for (const t of res.options[0].teams) if (t.players.filter(p => p.setting !== 'N').length > 1) stacked++;
  }
  check(stacked === 0, `${label}: ${stacked} teams with 2+ setters`);
  console.log(`${label.padEnd(18)} teams with 2+ setters over 10 builds: ${stacked}`);
}
console.log(fail ? `${fail} checks failed` : 'all checks passed');
process.exit(fail ? 1 : 0);
