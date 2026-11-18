// Highlight and blooper suggestions from the sound after each rally (site/js/suggest.mjs).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { endOf, liftAt, momentLabel, moments, suggest } from '../site/js/suggest.mjs';

// Sound every 0.5 s, level (lift 0) except a reaction of `db` right after each listed second.
const soundWith = (seconds, loud) => {
  const lift = new Array(seconds * 2).fill(0);
  for (const [t, db] of loud) for (let i = t * 2; i < t * 2 + 4; i++) lift[i] = db * 10;
  return { hop: .5, lift };
};
const T = (p, a, g, t) => ({ p, a, g, t });
// 10 tagged rallies, one ending every 30 s.
const kinds = [['attack', 3], ['attack', 0], ['serve', 3], ['pass', 0], ['block', 3], ['attack', 2], ['set', 0], ['attack', 3], ['dig', 0], ['serve', 1]];
const tagged = kinds.map(([a, g], i) => ({ touches: [T(1, 'serve', 1, i * 30 + 10), T(i + 1, a, g, i * 30 + 20)] }));

test('how a rally ended', () => {
  assert.equal(endOf(T(1, 'attack', 3)), 'big');
  assert.equal(endOf(T(1, 'block', 3)), 'big');
  assert.equal(endOf(T(1, 'pass', 0)), 'error');
  assert.equal(endOf(T(1, 'attack', 2)), 'other');
});

test('tagged rallies run from their first to last touch; untagged games use the rallies found', () => {
  const ms = moments(tagged, []);
  assert.deepEqual([ms[0].start, ms[0].end, ms[0].kind], [10, 20, 'big']);
  const found = moments([{ touches: [T(1, 'serve', 1, null)] }], [{ start: 5, end: 15 }]);
  assert.deepEqual(found, [{ start: 5, end: 15, kind: null, last: null }]);
});

test('the loudest moment just after a rally ends', () => {
  const s = soundWith(100, [[21, 12]]);
  assert.equal(liftAt(s, 20), 12);
  assert.equal(liftAt(s, 60), 0);
  assert.equal(liftAt(null, 20), null);
});

test('loud kills, aces and stuffs are highlights; loud errors are bloopers; quiet ones are neither', () => {
  // Loud: the kill at 20 s, the error at 50 s, the stuff at 140 s, the set error at 200 s. The ace at 80 s is quiet.
  const s = soundWith(300, [[20, 14], [50, 12], [140, 13], [200, 15]]);
  const { highlights, bloopers } = suggest({ sound: s, moments: moments(tagged) });
  assert.deepEqual(highlights.map(m => m.t), [20, 140]);
  assert.deepEqual(bloopers.map(m => m.t), [200]);
  assert.deepEqual([highlights[0].start, highlights[0].end], [8, 23]);   // 2 s before the serve, 3 s after the end
});

test('kept and dismissed moments are not suggested again', () => {
  const s = soundWith(300, [[20, 14], [50, 12], [140, 13], [200, 15]]);
  const { highlights, bloopers } = suggest({ sound: s, moments: moments(tagged),
    marks: [{ start: 15, end: 25 }], dismissed: [{ t: 200.4, kind: 'blooper' }] });
  assert.deepEqual(highlights.map(m => m.t), [140]);
  assert.deepEqual(bloopers, []);
});

test('an untagged game suggests its loudest rallies as highlights, no bloopers', () => {
  const found = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => ({ start: i * 30 + 5, end: i * 30 + 20 }));
  const { highlights, bloopers } = suggest({ sound: soundWith(300, [[110, 15], [230, 9], [20, 4]]), moments: moments([], found) });
  assert.deepEqual(highlights.map(m => m.t), [20, 110, 230]);
  assert.deepEqual(bloopers, []);
});

test('labels', () => {
  const [m] = moments(tagged);
  assert.equal(momentLabel(m, id => ({ 1: 'Ali' })[id]), 'Kill · Ali');
  assert.equal(momentLabel({ last: null }), null);
});
