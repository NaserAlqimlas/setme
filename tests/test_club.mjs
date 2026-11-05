// Run: node tests/test_club.mjs
// Attendance, records, season awards, results-adjusted ratings, teammate variety, serving order, new raters.
import { attendance, record, seasonRecap } from '../site/js/club.mjs';
import { resultAdjustments, ADJUST_CAP } from '../site/js/scores.mjs';
import { SKILLS, WEIGHTS, buildTeams, combineRatings, teamSkills, servingOrder, repeatPairs, adjustSkills, weightedTotal, UNCALIBRATED_WEIGHT } from '../site/js/teams.mjs';

let fail = 0;
const ok = (title, cond, ...info) => { if (!cond) { fail++; console.log('FAIL', title, ...info); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// ----- attendance -----
// Player 1 every week, 2 the first four only (a regular who stopped), 3 the last two, 4 once.
const days = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13'];
const who = [[1, 2, 4], [1, 2], [1, 2], [1, 2], [1], [1, 3], [1, 3]];
const sessions = days.map((d, i) => ({ id: i + 1, played_on: d, teams: [who[i]] }));
const att = attendance(sessions, [], '2026-10-20');
ok('every week', att.get(1).total === 7 && att.get(1).streak === 7 && att.get(1).rate === 1 && att.get(1).daysSince === 7, att.get(1));
ok('stopped coming', att.get(2).missing && att.get(2).streak === 0 && att.get(2).best === 4 && att.get(2).last === '2026-09-22', att.get(2));
ok('new regular', !att.get(3).missing && att.get(3).streak === 2 && att.get(3).rate === 1 && att.get(3).of === 2, att.get(3));
ok('once', att.get(4).total === 1 && att.get(4).rate === 1 / 7 && !att.get(4).missing, att.get(4));
// Someone who only played a game (a late arrival moved off the saved teams) still came.
// Rounds: someone only on an earlier round's team still came.
const earlier = attendance([{ id: 9, played_on: '2026-10-01', teams: [[1]], earlier: [[[1, 7]]] }], [], '2026-10-01');
if (!earlier.has(7)) { fail++; console.log('FAIL earlier round counts as came'); }
const late = attendance([{ id: 9, played_on: '2026-10-01', teams: [[1]] }], [{ session_id: 9, players_a: [1], players_b: [5] }], '2026-10-01');
ok('late arrival counts', late.get(5)?.total === 1);

// ----- record and season awards -----
const g = (s, a, b, sa, sb, t) => ({ session_id: s, team_a: 1, team_b: 2, players_a: a, players_b: b, score_a: sa, score_b: sb, created_at: t });
const games = [
  g(1, [1, 2], [3, 4], 25, 20, '1'), g(1, [1, 2], [3, 4], 25, 23, '2'), g(1, [1, 3], [2, 4], 25, 10, '3'),
  g(2, [1, 4], [2, 3], 20, 25, '4'), g(2, [1, 2], [3, 4], 27, 25, '5'), g(2, [1, 3], [2, 4], 25, 15, '6'),
];
const r1 = record(games, 1);
ok('record', r1.wins === 5 && r1.losses === 1 && r1.best === 3, r1);
const rec = seasonRecap(sessions.slice(0, 2), games);
const award = k => rec.awards.find(a => a.key === k);
ok('season counts', rec.days === 2 && rec.games === 6, rec);
ok('best record', award('record')?.who.join() === '1', award('record'));
ok('streak', award('streak')?.who.join() === '1' && award('streak').value === 3, award('streak'));
ok('closest is the deuce game', rec.closest?.score_a === 27, rec.closest);
ok('no tags, no stat awards', !award('kills'));
// Awards that don't single anyone out are left out: one game day, so "never misses" is everyone who came.
const oneDay = seasonRecap(sessions.slice(0, 1), games.filter(x => x.session_id === 1));
ok('no never-misses after one day', !oneDay.awards.some(a => a.key === 'iron'), oneDay.awards);
// Everyone tied on wins (each of 6 players won once): no Most wins.
const tie = seasonRecap([{ id: 5, played_on: '2026-10-01', teams: [[1, 2, 3], [4, 5, 6]] }],
  [g(5, [1, 2, 3], [4, 5, 6], 25, 20, '1'), g(5, [1, 2, 3], [4, 5, 6], 20, 25, '2')]);
ok('no award when everyone ties', !tie.awards.some(a => a.key === 'wins'), tie.awards);

// ----- results-adjusted ratings -----
// Even teams on paper; player 1's team always wins by 6, so 1 plays above their ratings and 2 below.
const even = { weighted: 5, sums: Object.fromEntries([...SKILLS, 'setting'].map(s => [s, 1])), size: 2, women: 0, setters: 1, unrated: 0 };
const tilt = { ...even, weighted: 5.5 };
const many = [];
for (let i = 0; i < 40; i++) {
  // Some games with a rating gap that plays out, so k (points per gap) is known.
  many.push({ session_id: 1, players_a: [10 + i % 4], players_b: [20 + i % 4], score_a: 25, score_b: 20, predicted: { a: tilt, b: even } });
  many.push({ session_id: 1, players_a: [1, 30 + i % 5], players_b: [2, 40 + i % 5], score_a: 25, score_b: 19, predicted: { a: even, b: even } });
}
const adj = resultAdjustments(many);
ok('above ratings', adj.get(1) > .3 && adj.get(1) <= ADJUST_CAP, adj.get(1));
ok('below ratings', near(adj.get(2), -adj.get(1)), adj.get(2));
ok('too few games: nothing', resultAdjustments(many.slice(0, 10)).size === 0);
const comb = new Map([[1, { skills: Object.fromEntries(SKILLS.map(s => [s, .5])) }]]);
adjustSkills(comb, new Map([[1, .4]]));
ok('adjustment moves weighted total by itself', near(weightedTotal(comb.get(1).skills), .5 * SKILLS.reduce((a, s) => a + WEIGHTS[s], 0) + .4));

// ----- teammate variety -----
// 12 identical players, 2 teams: any split is equally balanced, so variety alone decides. Last time: 0-5 v 6-11.
const ps = Array.from({ length: 12 }, (_, i) => ({ id: i, name: `P${i}`, gender: 'U', setting: i === 0 || i === 6 ? 'M' : 'N' }));
const flat = new Map(ps.map(p => [p.id, { skills: { ...Object.fromEntries(SKILLS.map(s => [s, .5])), setting_skill: null, consistency: .5 }, guess: null }]));
const sk = teamSkills(ps, flat, new Set());
const last = [[0, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11]];
const without = buildTeams({ players: ps, skills: sk, numTeams: 2, timeBudgetMs: 500, maxRestarts: 200 });
const withH = buildTeams({ players: ps, skills: sk, numTeams: 2, history: [last], timeBudgetMs: 500, maxRestarts: 200 });
const reps = o => repeatPairs(o.teams.map(t => t.players.map(p => p.id)), [last]).length;
ok('variety cuts repeat pairs', reps(withH.options[0]) < reps(without.options[0]) || reps(without.options[0]) === reps(withH.options[0]) && reps(withH.options[0]) <= 12, reps(without.options[0]), reps(withH.options[0]));
ok('variety: at most the minimum (12 pairs for a 3/3 split)', reps(withH.options[0]) <= 12, reps(withH.options[0]));

// ----- serving order -----
const order = servingOrder([{ id: 'S', setting: 'M' }, { id: 1, setting: 'N' }, { id: 2, setting: 'N' }, { id: 3, setting: 'N' }, { id: 4, setting: 'N' }, { id: 5, setting: 'N' }]);
ok('serving order: setter, then strong and weak in turn', order.map(p => p.id).join() === 'S,1,5,2,4,3', order.map(p => p.id));

// ----- new raters count for less until their lean is known -----
// A, B, C rate 10 players alike (so their leans are fitted); N rates only player 0, generously.
const players = Array.from({ length: 10 }, (_, i) => ({ id: i, name: `P${i}` }));
const rows = [];
for (const rid of ['A', 'B', 'C']) for (const p of players) rows.push({ rater_id: rid, player_id: p.id, ...Object.fromEntries(SKILLS.map(s => [s, .5])) });
rows.push({ rater_id: 'N', player_id: 0, ...Object.fromEntries(SKILLS.map(s => [s, 1])) });
const { combined } = combineRatings(players, rows);
ok('new rater counts less', near(combined.get(0).skills.receiving, (1.5 + UNCALIBRATED_WEIGHT) / (3 + UNCALIBRATED_WEIGHT)), combined.get(0).skills.receiving);

console.log(fail ? `${fail} failed` : 'ok');
process.exit(fail ? 1 : 0);
