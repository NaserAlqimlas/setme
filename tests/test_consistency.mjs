// Run: node tests/test_consistency.mjs
// Consistency never adds to strength, unrated consistency counts as normal, low consistency is spread across teams,
// and CSVs without a consistency column still import.
import { combineRatings, buildTeams, weightedTotal, SKILLS } from '../site/js/teams.mjs';
import { readRatingsCsv } from '../site/js/csv.mjs';

let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('FAIL', msg); } };
const row = (rater_id, player_id, v, consistency) => ({ rater_id, player_id, ...Object.fromEntries(SKILLS.map(s => [s, v])), consistency });

// Same skills, different consistency: same weighted total.
const players = [0, 1, 2, 3].map(id => ({ id, name: `P${id}` }));
const { combined } = combineRatings(players, [row('r', 0, .5, 1), row('r', 1, .5, 0), row('r', 2, .5, null), row('r', 3, .75, .5)]);
const sk = id => combined.get(id).skills;
check(weightedTotal(sk(0)) === weightedTotal(sk(1)), 'consistency does not change the total');
check(Math.abs(sk(2).consistency - .5) < 1e-9, `unrated consistency = group normal (got ${sk(2).consistency})`);
check(combined.get(2).guess === null, 'a player with skills but no consistency is still rated');

// 4 inconsistent players among 16 for 4 teams -> one per team.
const pool = Array.from({ length: 16 }, (_, i) => ({ id: i, name: `Q${i}`, gender: 'M', setting: i < 4 ? 'M' : 'N' }));
const skills = new Map(pool.map((p, i) => [p.id, { ...Object.fromEntries(SKILLS.map(s => [s, [.25, .5, .75][i % 3]])), consistency: i >= 4 && i < 8 ? .25 : .75 }]));
const res = buildTeams({ players: pool, skills, numTeams: 4, timeBudgetMs: 2000, maxRestarts: 300 });
for (const opt of res.options) {
  const per = opt.teams.map(t => t.players.filter(p => p.id >= 4 && p.id < 8).length);
  check(Math.max(...per) - Math.min(...per) <= 1, `inconsistent spread ${per}`);
}

// CSV with and without the column.
const roster = [{ id: 1, name: 'Reem' }];
const withCol = readRatingsCsv('name,receiving,hitting,setting,hustle,serve,blocking,consistency\nReem,1,1,,1,1,1,.25', roster);
check(withCol.rows[0]?.values.consistency === .25, 'consistency read from CSV');
const without = readRatingsCsv('name,receiving,hitting,setting,hustle,serve,blocking\nReem,1,1,,1,1,1', roster);
check(without.rows.length === 1 && !('consistency' in without.rows[0].values), 'old CSV imports and leaves consistency alone');

console.log(fail ? `${fail} checks failed` : 'all checks passed');
process.exit(fail ? 1 : 0);
