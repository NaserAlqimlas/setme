// Run: node tests/test_teams.mjs   (needs private/fixture.json from tools/make_seed.py)
import { existsSync, readFileSync } from 'node:fs';
import { combineRatings, buildTeams, SKILLS } from '../site/js/teams.mjs';

// The fixture holds everyone's ratings, so it never leaves this machine: CI and Netlify skip this test.
const fixture = new URL('../private/fixture.json', import.meta.url);
if (!existsSync(fixture)) { console.log('skipped: no private/fixture.json'); process.exit(0); }
const data = JSON.parse(readFileSync(fixture, 'utf8'));
const playing = data.players.filter(p => p.playing);
const { combined, offsets, disagreements } = combineRatings(data.players, data.ratings);
const skills = new Map([...combined].map(([id, c]) => [id, c.skills]));

console.log('rater offsets:', JSON.stringify(Object.fromEntries([...offsets].map(([r, o]) => [r, Object.fromEntries(SKILLS.map(s => [s, +o[s].toFixed(3)]))]))));
console.log('disagreements:', disagreements.map(d => `${d.name} ${d.gap}`).join(', '));

const t0 = Date.now();
const res = buildTeams({ players: playing, skills, combos: data.combos, timeBudgetMs: 8000 });
console.log(`restarts ${res.restarts} in ${Date.now() - t0}ms, warnings: ${res.warnings.join(' ') || 'none'}`);

let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('FAIL', msg); } };
for (const [oi, opt] of res.options.entries()) {
  console.log(`\nOption ${oi + 1} (score ${opt.score.toFixed(2)})`);
  const where = new Map();
  opt.teams.forEach((t, k) => {
    t.players.forEach(p => where.set(p.id, k));
    console.log(`|${k + 1}|${t.players.map(p => p.name + (p.setting === 'M' ? ' (S)' : p.setting === 'B' ? ' (B)' : '')).join(', ')}|${SKILLS.map(s => t.sums[s].toFixed(2)).join('|')}|${t.weighted.toFixed(2)}|`);
    check(t.players.length === playing.length / 4, `team ${k + 1} size`);
    check(t.players.filter(p => p.setting === 'M').length === 1, `team ${k + 1} main setters`);
    check(t.players.filter(p => p.gender === 'F').length <= 1, `team ${k + 1} women`);
  });
  for (const [a, b] of data.combos) if (where.has(a) && where.has(b)) check(where.get(a) === where.get(b), `combo ${a}+${b} split`);
  const w = opt.teams.map(t => t.weighted);
  check(Math.max(...w) - Math.min(...w) <= .25 + 1e-9, 'totals gap over .25');
}
console.log(fail ? `\n${fail} checks failed` : '\nall checks passed');
process.exit(fail ? 1 : 0);
