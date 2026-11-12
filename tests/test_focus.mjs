// Run: node tests/test_focus.mjs
// What to work on: stats against the club average (10 touches minimum), ratings for the rest, silence when they disagree.
import { clubCounts, focusAreas, sentence } from '../site/js/focus.mjs';

let fail = 0;
const check = (ok, msg, got) => { if (!ok) { fail++; console.log('FAIL', msg, got === undefined ? '' : JSON.stringify(got)); } };
const LABELS = { receiving: 'Receiving', hitting: 'Hitting', hustle: 'Hustle', serve: 'Serve', blocking: 'Blocking', consistency: 'Consistency' };
const SHOWN = Object.keys(LABELS);

// Club: serves mostly in (1 in 10 errors), passes average about 2.
const club = { serve: { 0: 10, 1: 50, 2: 30, 3: 10 }, pass: { 0: 10, 1: 20, 2: 40, 3: 30 } };

// Not enough touches: nothing from stats.
let r = focusAreas({ mine: { serve: { 0: 4, 1: 5, 2: 0, 3: 0 } }, club });
check(!r.strength && r.focus.length === 0, '9 serves is too few', r);

// 10 serves, 4 errors: work on your serve. 12 great passes: a strength.
r = focusAreas({ mine: { serve: { 0: 4, 1: 5, 2: 1, 3: 0 }, pass: { 0: 0, 1: 1, 2: 4, 3: 7 } }, club });
check(r.focus.length === 1 && r.focus[0].action === 'serve' && r.focus[0].kind === 'err', 'serve errors flagged', r.focus);
check(r.strength?.action === 'pass', 'passing is the strength', r.strength);
check(/^Serve: 1 in 3 of your serves is an error; for the club it's 1 in 10\. From 10 serves\.$/.test(sentence(r.focus[0])), 'serve sentence', sentence(r.focus[0]));
check(/^Serve receive: you average 2\.5 out of 3; the club averages 1\.9\. From 12 serve receives\.$/.test(sentence(r.strength)), 'pass sentence', sentence(r.strength));

// No club average for an action: it isn't judged.
r = focusAreas({ mine: { attack: { 0: 9, 1: 1, 2: 0, 3: 0 } }, club });
check(!r.strength && !r.focus.length, 'no club numbers, no verdict', r);

// Right at the club average: nothing to say.
r = focusAreas({ mine: { pass: { 0: 1, 1: 2, 2: 4, 3: 3 } }, club });
check(!r.strength && !r.focus.length, 'average passer says nothing', r);

// Ratings fill in skills stats don't cover.
const skills = { receiving: .5, hitting: .5, hustle: .25, serve: .5, blocking: .75, consistency: .5 };
r = focusAreas({ skills, labels: LABELS, shown: SHOWN });
check(r.strength?.skill === 'blocking' && r.strength.from === 'rating', 'rated strength', r.strength);
check(r.focus.length === 1 && r.focus[0].skill === 'hustle', 'rated focus', r.focus);
check(sentence(r.focus[0]) === 'Raters see hustle as your area to grow.', 'rating sentence', sentence(r.focus[0]));

// Stats first; ratings only for skills stats cover are not repeated.
r = focusAreas({ mine: { serve: { 0: 4, 1: 5, 2: 1, 3: 0 } }, club, skills: { ...skills, serve: .25 }, labels: LABELS, shown: SHOWN });
check(r.focus[0].from === 'stats' && r.focus[0].action === 'serve' && r.focus.filter(f => f.skill === 'serve').length === 1, 'serve once, from stats', r.focus);
check(r.focus.length === 2 && r.focus[1].skill === 'hustle', 'then a rating', r.focus);

// Stats and ratings disagree: say nothing about it.
r = focusAreas({ mine: { serve: { 0: 4, 1: 5, 2: 1, 3: 0 } }, club, skills: { ...skills, serve: .75, blocking: .5 }, labels: LABELS, shown: SHOWN });
check(!r.focus.some(f => f.skill === 'serve') && r.strength?.skill !== 'serve', 'disagreement is silent', r);

// At most two to work on, and they're the biggest gaps.
r = focusAreas({ skills: { receiving: 1, hitting: .25, hustle: 0, serve: .5, blocking: .75, consistency: .25 }, labels: LABELS, shown: SHOWN });
check(r.focus.length === 2 && r.focus[0].skill === 'hustle', 'two biggest', r.focus);

// Club totals: everyone but me, only with enough other players.
const rows = [1, 2, 3, 4, 5].map(id => ({ player_id: id, serve_0: 1, serve_1: id, serve_2: 0, serve_3: 0, pass_0: id === 2 ? 1 : 0 }));
const c = clubCounts(rows, 1);
check(c.serve && c.serve[1] === 2 + 3 + 4 + 5 && c.serve[0] === 4, 'club serve totals leave me out', c);
check(!c.pass, 'one other passer is too few', c);
check(!clubCounts(rows.slice(0, 4), 1).serve, 'three others is too few');

console.log(fail ? `${fail} checks failed` : 'all checks passed');
process.exit(fail ? 1 : 0);
