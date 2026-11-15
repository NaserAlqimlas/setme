// Games page search.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchDays } from '../site/js/gamesearch.mjs';

const game = (id, n, a, b, extra = {}) => ({ id, n, a: { name: `${a[0]}'s Team`, players: a.map(name => ({ name })) }, b: { name: `${b[0]}'s Team`, players: b.map(name => ({ name })) }, tagged: 0, video: false, ...extra });
const days = [
  { played_on: '2026-11-10', games: [game(1, 1, ['Sara', 'Omar'], ['Ali', 'Dana'], { video: true }), game(2, 2, ['Sara', 'Noor'], ['Ali', 'Zoë'], { tagged: 40 })] },
  { played_on: '2026-11-03', games: [game(3, 1, ['Ali', 'Omar'], ['Noor', 'Dana'], { video: true, tagged: 38 })] },
];
const ids = q => searchDays(days, q).flatMap(d => d.games.map(g => g.id));

test('by player, team, several words at once', () => {
  assert.deepEqual(ids(''), [1, 2, 3]);
  assert.deepEqual(ids('omar'), [1, 3]);
  assert.deepEqual(ids('SARA noor'), [2]);
  assert.deepEqual(ids("ali's team"), [1, 2, 3]);
  assert.deepEqual(ids('zoe'), [2]);              // accents don't matter
  assert.deepEqual(ids('nobody'), []);
  assert.deepEqual(ids('om'), [1, 3]);            // the start of a name
  assert.deepEqual(ids('mar'), []);               // not the middle of one
});

test('by day, game number, video and tags', () => {
  assert.deepEqual(ids('nov 3'), [3]);
  assert.deepEqual(ids('november 10'), [1, 2]);
  assert.deepEqual(ids('tuesday'), [1, 2, 3]);      // both were Tuesdays
  assert.deepEqual(ids('2026-11-03'), [3]);
  assert.deepEqual(searchDays([{ played_on: '2026-11-30', games: [game(9, 1, ['A'], ['B'])] }], 'nov 3'), []);   // not Nov 30
  assert.deepEqual(ids('game 2'), [2]);
  assert.deepEqual(ids('video'), [1, 3]);
  assert.deepEqual(ids('tagged'), [2, 3]);
  assert.deepEqual(ids('untagged'), [1]);
  assert.deepEqual(ids('omar video untagged'), [1]);
  assert.deepEqual(searchDays(days, 'nov 3').map(d => d.played_on), ['2026-11-03']);   // days with no match drop out
});

test('games to tag: untagged only, with a video first, then oldest first', async () => {
  const { toTag } = await import('../site/js/gamesearch.mjs');
  const more = [...days, { played_on: '2026-10-27', games: [game(4, 1, ['A'], ['B']), game(5, 2, ['C'], ['D'], { video: true })] }];
  assert.deepEqual(toTag(more).map(g => [g.id, g.played_on]), [[5, '2026-10-27'], [1, '2026-11-10'], [4, '2026-10-27']]);
  assert.deepEqual(toTag([]), []);
  more[2].games[0].not_recorded = true;
  assert.deepEqual(toTag(more).map(g => g.id), [5, 1]);   // marked not recorded: off the list
});
