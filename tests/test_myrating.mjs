// Run: node tests/test_myrating.mjs
// A player's own rating: averages need MIN_RATERS numbers, overall is weighted, history replays changes by day.
import { ownRating } from '../site/js/myrating.mjs';

let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('FAIL', msg); } };
const all = (rater_id, v, extra = {}) => ({ rater_id, receiving: v, hitting: v, hustle: v, serve: v, blocking: v, setting_skill: null, consistency: v, ...extra });

// One rater: nothing shows.
let r = ownRating([all('a', .5)]);
check(r.current.overall === null && r.current.skills.hitting === null && r.history.length === 0, 'one rater shows nothing');

// Two raters: plain averages, overall weighted like team building.
r = ownRating([all('a', .5), all('b', .75, { hitting: .25 })]);
check(r.current.skills.receiving === .63 || r.current.skills.receiving === .62, 'receiving average (.625 rounded)');
check(r.current.skills.hitting === .38 || r.current.skills.hitting === .37, 'hitting average');
check(r.current.skills.setting_skill === null, 'setting needs two numbers');
check(typeof r.current.overall === 'number' && r.current.overall > .5 && r.current.overall < .7, 'overall weighted');
check(r.history.length === 1 && r.history[0].date === null, 'no changes: one starting point');

// U doesn't count toward the two.
r = ownRating([all('a', .5), all('b', .5, { blocking: null })]);
check(r.current.skills.blocking === null && r.current.overall === null, 'U leaves a skill (and overall) hidden');

// History: b raised hitting on Nov 3, a lowered it later the same day (one point), c joined Nov 5.
const ratings = [all('a', .5, { hitting: .25 }), all('b', .5, { hitting: 1 }), all('c', .75)];
const history = [
  { rater_id: 'b', skill: 'hitting', old_value: .5, new_value: 1, changed_at: '2026-11-03T10:00:00Z' },
  { rater_id: 'a', skill: 'hitting', old_value: .5, new_value: .25, changed_at: '2026-11-03T18:00:00Z' },
  ...['receiving', 'hitting', 'hustle', 'serve', 'blocking', 'consistency'].map(skill => ({ rater_id: 'c', skill, old_value: null, new_value: .75, changed_at: '2026-11-05T09:00:00Z' })),
];
r = ownRating(ratings, history);
check(r.history.map(p => p.date).join() === ',2026-11-03,2026-11-05', `points by day: ${r.history.map(p => p.date).join()}`);
check(r.history[0].skills.hitting === .5 && [.62, .63].includes(r.history[1].skills.hitting), 'hitting before and after Nov 3');
check(r.history[2].overall === r.current.overall, 'last point matches today');
check(!JSON.stringify(r).match(/"a"|"b"|"c"|rater/), 'nothing about who rated');

// A day whose changes cancel out adds no point.
r = ownRating([all('a', .5), all('b', .5)], [
  { rater_id: 'a', skill: 'serve', old_value: .5, new_value: .75, changed_at: '2026-10-01T10:00:00Z' },
  { rater_id: 'a', skill: 'serve', old_value: .75, new_value: .5, changed_at: '2026-10-01T11:00:00Z' },
]);
check(r.history.length === 1, 'no visible change, no point');

console.log(fail ? `${fail} checks failed` : 'all checks passed');
process.exit(fail ? 1 : 0);
