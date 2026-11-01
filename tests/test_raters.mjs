// Run: node tests/test_raters.mjs
// Rater leans with several raters who each rate only part of the group.
import { combineRatings, SKILLS } from '../site/js/teams.mjs';

let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('FAIL', msg); } };

// 30 players with true levels; 4 raters with known leans; each rater sees 20 of them. No rounding noise
// except the .25 steps and the 0..1 clamp, so the fit should land close to the true leans.
const leanOf = { A: .2, B: 0, C: -.1, D: -.1 };
const players = Array.from({ length: 30 }, (_, i) => ({ id: i, name: `P${i}` }));
const truth = i => .3 + .4 * ((i * 7) % 30) / 29;
const ratings = [];
Object.entries(leanOf).forEach(([rid, lean], k) => {
  for (let j = 0; j < 20; j++) {
    const i = (j + k * 5) % 30;
    const v = Math.round(Math.min(1, Math.max(0, truth(i) + lean)) * 4) / 4;
    ratings.push({ rater_id: rid, player_id: i, ...Object.fromEntries(SKILLS.map(s => [s, v])) });
  }
});
// One rater who is all over the place.
const noisy = [1, 0, 1, 0, .25, 1, 0, .75, 0, 1];
noisy.forEach((v, j) => ratings.push({ rater_id: 'E', player_id: j, ...Object.fromEntries(SKILLS.map(s => [s, v])) }));

const { offsets, raters, disagreements } = combineRatings(players, ratings);
const centre = (leanOf.A + leanOf.B + leanOf.C + leanOf.D) / 4;
for (const [rid, lean] of Object.entries(leanOf)) {
  const got = offsets.get(rid).receiving;
  console.log(`${rid} lean ${(lean - centre).toFixed(3)} expected-ish, got ${got.toFixed(3)}, off by ${raters.get(rid).miss.receiving.toFixed(3)}, shared ${raters.get(rid).shared.receiving}`);
}
console.log(`E got ${offsets.get('E').receiving.toFixed(3)}, off by ${raters.get('E').miss.receiving.toFixed(3)}`);

// Order of leans is right and A stands well apart.
const o = rid => offsets.get(rid).receiving;
check(o('A') > o('B') && o('B') > o('C') - .03 && o('B') > o('D') - .03, 'lean order A > B > C, D');
check(o('A') - o('C') > .2, `A vs C spread (${(o('A') - o('C')).toFixed(3)})`);
check(raters.get('E').miss.receiving > 2 * raters.get('B').miss.receiving, 'noisy rater has a much higher "off by"');
check(raters.get('A').applied.receiving, 'A has enough shared ratings to be adjusted');
check(disagreements.every(d => d.totals.length >= 2 && d.gap >= 1), 'disagreements have 2+ raters and gap >= 1');
check(disagreements.some(d => d.totals.some(t => t.rater_id === 'E')), 'the noisy rater shows up in disagreements');
console.log(`${disagreements.length} disagreements, first: ${disagreements[0]?.name} gap ${disagreements[0]?.gap.toFixed(2)}`);

// Too few shared ratings: no adjustment, and it says so.
const few = combineRatings(players.slice(0, 3), [
  { rater_id: 'X', player_id: 0, receiving: 1 }, { rater_id: 'Y', player_id: 0, receiving: 0 },
]);
check(few.offsets.get('X').receiving === 0 && !few.raters.get('X').applied.receiving, 'below 5 shared: not adjusted');

console.log(fail ? `${fail} checks failed` : 'all checks passed');
process.exit(fail ? 1 : 0);
