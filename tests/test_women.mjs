// Run: node tests/test_women.mjs   Women spread evenly when spreadWomen is on (default), ignored when off.
import { SKILLS, buildTeams, teamProblems, suggestSwaps } from '../site/js/teams.mjs';

let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('FAIL', msg); } };
const sk = v => ({ ...Object.fromEntries(SKILLS.map(s => [s, v])), setEff: 0, consistency: .5 });
// 16 players, 4 teams, 6 women. The women are the strongest players, so strength alone would want them split
// roughly evenly anyway; make the women weak and the men's levels uneven so gender only matters when asked.
const players = Array.from({ length: 16 }, (_, i) => ({ id: i, name: `P${i}`, gender: i < 6 ? 'F' : 'M', setting: i >= 12 ? 'M' : 'N' }));
const skills = new Map(players.map(p => [p.id, sk(p.gender === 'F' ? .3 : .4 + (p.id % 6) * .1)]));
const women = t => t.players.filter(p => p.gender === 'F').length;

for (const seed of [1, 2, 3]) {
  const on = buildTeams({ players, skills, seed, timeBudgetMs: 1500, maxRestarts: 400 });
  for (const opt of on.options) {
    const c = opt.teams.map(women);
    check(Math.max(...c) - Math.min(...c) <= 1, `seed ${seed} on: women ${c.join(',')}`);
  }
}
const off = buildTeams({ players, skills, spreadWomen: false, seed: 1, timeBudgetMs: 1500, maxRestarts: 400 });
check(off.options.length > 0, 'off still builds');

// Problems and suggestions follow the option too.
const byId = new Map(players.map(p => [p.id, p]));
const bunched = [[0, 1, 2, 12], [3, 4, 5, 13], [6, 7, 8, 14], [9, 10, 11, 15]];
const asP = bunched.map(t => t.map(id => byId.get(id)));
check(teamProblems(asP, skills).some(x => x.key === 'spread:women'), 'problem flagged when on');
check(!teamProblems(asP, skills, [], [], { spreadWomen: false }).some(x => x.key === 'spread:women'), 'no problem when off');
const sOn = suggestSwaps({ players, skills, teams: bunched });
const sOff = suggestSwaps({ players, skills, teams: bunched, spreadWomen: false });
check(sOn.base - sOff.base >= 100, `base cost includes women penalty only when on (${sOn.base} vs ${sOff.base})`);

console.log(fail ? `${fail} failed` : 'all ok');
process.exit(fail ? 1 : 0);
