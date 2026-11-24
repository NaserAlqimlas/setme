// Incomplete games: only part filmed, score unknown (both scores null). Left out of everything score-based.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze, playerStats } from '../site/js/scores.mjs';

test('incomplete games (score unknown) are left out of results, records and the season recap', async () => {
  const { finished, resultAdjustments, scoreError, scoreKnown, scoreText } = await import('../site/js/scores.mjs');
  const { record, seasonRecap } = await import('../site/js/club.mjs');
  const { clubEmail } = await import('../netlify/lib/email.mjs');
  const gone = { session_id: 1, team_a: 1, team_b: 2, players_a: [1, 2], players_b: [3, 4], score_a: null, score_b: null, predicted: { a: 2, b: 2 } };
  assert.equal(scoreKnown(gone), false);
  assert.equal(finished(gone), false);
  assert.equal(scoreText(null, null), 'Incomplete');
  assert.equal(scoreText(25, 20), '25–20');
  assert.deepEqual(analyze([gone]).n, 0);
  assert.deepEqual(playerStats([gone], 1), []);
  assert.equal(resultAdjustments(Array(50).fill(gone)).size, 0);
  assert.deepEqual(record([gone], 1), record([], 1));
  assert.equal(typeof seasonRecap, 'function');
  assert.match(scoreError({ message: 'null value in column "score_a" of relation "games" violates not-null constraint' }), /score_unknown\.sql/);
  assert.equal(scoreError({ message: 'other' }), 'other');
  const m = clubEmail({ kind: 'tags', label: 'G', game: { a: 'A', b: 'B', sa: null, sb: null }, link: 'L', settings: 'S' });
  assert.match(m.text, /\(A v B\)/); assert.doesNotMatch(m.text + m.html, /null/);
});
