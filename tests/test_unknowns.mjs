// Run: node tests/test_unknowns.mjs
// Gap filling for unrated skills, stand-in tiers for unrated players, and spreading those players across teams.
import { combineRatings, buildTeams, SKILLS } from '../site/js/teams.mjs';

let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('FAIL', msg); } };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const row = (rater_id, player_id, vals) => ({ rater_id, player_id, ...Object.fromEntries(SKILLS.map((s, i) => [s, vals[i]])) });

// 8 rated players at levels .25-.75, one strong player with blocking unknown, three unrated players.
const players = [];
const ratings = [];
const levels = [.25, .25, .5, .5, .5, .5, .75, .75];
levels.forEach((v, i) => { players.push({ id: i, name: `P${i}`, gender: 'M', setting: 'N' }); ratings.push(row('r1', i, [v, v, v, v, v])); });
players.push({ id: 8, name: 'NoBlock', gender: 'M', setting: 'N' });
ratings.push(row('r1', 8, [1, 1, 1, 1, null]));
players.push({ id: 9, name: 'NewDefault', gender: 'M', setting: 'N' });
players.push({ id: 10, name: 'NewStrong', gender: 'M', setting: 'N', tier: 'strong' });
players.push({ id: 11, name: 'AllU', gender: 'M', setting: 'N', tier: 'average' });
ratings.push(row('r1', 11, [null, null, null, null, null]));

const { combined } = combineRatings(players, ratings);
const sk = id => combined.get(id).skills;
const meanOf = s => avg([...levels, s === 'blocking' ? null : 1].filter(v => v != null));
const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

// Option 1: NoBlock sits well above the group on known skills, so their blocking is filled high, not average.
check(sk(8).blocking > meanOf('blocking') + .3, `NoBlock blocking filled high (got ${sk(8).blocking})`);
check(combined.get(8).guess === null, 'NoBlock is rated, not a guess');

// Option 3: unrated players use their tier, Beginner by default.
check(combined.get(9).guess === 'beginner', 'no tier -> beginner');
check(combined.get(10).guess === 'strong', 'strong tier kept');
check(combined.get(11).guess === 'average', 'a ratings row that is all U still counts as unrated');
check(sk(9).receiving < sk(11).receiving && sk(11).receiving < sk(10).receiving, 'beginner < average < strong');
check(near(sk(11).hitting, meanOf('hitting')), 'average tier = group average');
console.log('NoBlock', fmt(sk(8)), '\nbeginner', fmt(sk(9)), '\naverage ', fmt(sk(11)), '\nstrong  ', fmt(sk(10)));

// Option 4: 4 unrated players among 16 for 4 teams -> one per team.
const pool = Array.from({ length: 16 }, (_, i) => ({ id: 100 + i, name: `Q${i}`, gender: 'M', setting: i < 4 ? 'M' : 'N', unrated: i >= 4 && i < 8 }));
const skills = new Map(pool.map((p, i) => [p.id, Object.fromEntries(SKILLS.map(s => [s, [.25, .5, .75][i % 3]]))]));
const res = buildTeams({ players: pool, skills, numTeams: 4, timeBudgetMs: 2000, maxRestarts: 300 });
for (const opt of res.options) {
  const per = opt.teams.map(t => t.players.filter(p => pool.find(q => q.id === p.id).unrated).length);
  check(Math.max(...per) - Math.min(...per) <= 1, `unrated spread ${per}`);
}
console.log('unrated per team:', res.options.map(o => o.teams.map(t => t.players.filter(p => pool.find(q => q.id === p.id).unrated).length).join('/')).join('  '));

console.log(fail ? `${fail} checks failed` : 'all checks passed');
process.exit(fail ? 1 : 0);

function fmt(s) { return SKILLS.map(k => `${k} ${s[k].toFixed(2)}`).join(', '); }
