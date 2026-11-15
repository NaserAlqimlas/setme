// A video upload in parts: resuming only with the same file, and how much is sent.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { partLength, sameFile, sentShare, todo } from '../site/js/uploadparts.mjs';

const s = { name: 'g.mov', size: 250, lastModified: 7, partBytes: 100, done: { 1: '"a"', 3: '"c"' } };

test('resumes only the same file', () => {
  assert.ok(sameFile(s, { name: 'g.mov', size: 250, lastModified: 7 }));
  assert.ok(!sameFile(s, { name: 'g.mov', size: 251, lastModified: 7 }));
  assert.ok(!sameFile(s, { name: 'g.mov', size: 250, lastModified: 8 }));     // exported again: a different file
  assert.ok(!sameFile(null, { name: 'g.mov' }));
});

test('parts: their sizes, what is sent, what is left', () => {
  assert.deepEqual([1, 2, 3, 4].map(n => partLength(s, n)), [100, 100, 50, 0]);
  assert.equal(sentShare(s), 150 / 250);
  assert.equal(sentShare(null), 0);
  assert.deepEqual(todo([{ n: 1 }, { n: 2 }, { n: 3 }], s.done), [{ n: 2 }]);
});
