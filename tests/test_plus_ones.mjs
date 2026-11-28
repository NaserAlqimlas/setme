// Plus ones: adding them from a typed list.
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('a typed list of plus ones: every line is a name, none skipped as a header', async () => {
  const { matchPasted } = await import('../site/js/paste.mjs');
  const ps = [{ id: 1, name: 'Sara' }, { id: 2, name: 'Omar' }];
  assert.deepEqual(matchPasted('John\nMike', ps).skipped, ['John', 'Mike']);              // a group message: header lines
  const r = matchPasted('John\nSara\nMike', ps, [], { allNames: true });
  assert.deepEqual(r.unmatched, ['John', 'Mike']);
  assert.deepEqual(r.matched.map(m => m.player.id), [1]);
  assert.deepEqual(r.skipped, []);
});
