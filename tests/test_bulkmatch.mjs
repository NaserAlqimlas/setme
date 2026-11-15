// Bulk video upload: matching files to games by the name they were tagged with, or by the day they were filmed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileDay, matchFiles, numbered, problems } from '../site/js/bulkmatch.mjs';

const at = day => new Date(`${day}T19:30:00`).getTime();   // filmed in the evening, local time
const games = [
  { id: 1, session_id: 10, created_at: '2026-11-03T19:00', played_on: '2026-11-03', video_kind: 'file', video_ref: 'IMG_4821.MOV' },
  { id: 2, session_id: 10, created_at: '2026-11-03T19:30', played_on: '2026-11-03', video_kind: null, video_ref: null },
  { id: 3, session_id: 11, created_at: '2026-11-10T19:00', played_on: '2026-11-10', video_kind: null, video_ref: null },
  { id: 4, session_id: 11, created_at: '2026-11-10T19:40', played_on: '2026-11-10', video_kind: null, video_ref: null },
  { id: 5, session_id: 12, created_at: '2026-11-12T19:00', played_on: '2026-11-12', video_kind: 'upload', video_ref: 'job' },
];

test('a tagged game is found by its file name; an untagged one by the day, when only one game is free', () => {
  const m = matchFiles([
    { name: 'img_4821.mov', lastModified: at('2026-11-20') },     // same name, any case, any date
    { name: 'IMG_5000.MOV', lastModified: at('2026-11-03') },     // game 2 is that day's only game without a video
    { name: 'IMG_5100.MOV', lastModified: at('2026-11-10') },     // two free games that day: pick one
    { name: 'IMG_5200.MOV', lastModified: at('2026-11-12') },     // that day's game already has an upload
  ], games);
  assert.deepEqual(m.map(x => [x.game, x.how]), [[1, 'name'], [2, 'day'], [null, null], [null, null]]);
});

test('one free game is never suggested for two files', () => {
  const m = matchFiles([{ name: 'a.mov', lastModified: at('2026-11-03') }, { name: 'b.mov', lastModified: at('2026-11-03') }], games);
  assert.deepEqual(m.map(x => x.game), [null, null]);
});

test('games are numbered within their day, newest day first', () => {
  assert.deepEqual(numbered(games).map(g => [g.id, g.n]), [[5, 1], [3, 1], [4, 2], [1, 1], [2, 2]]);
  assert.equal(fileDay(at('2026-11-03')), '2026-11-03');
});

test('what has to be fixed before uploading', () => {
  const f = n => ({ name: n });
  assert.deepEqual(problems([{ file: f('a'), game: 1 }, { file: f('b'), game: 2 }], games), []);
  assert.deepEqual(problems([{ file: f('a'), game: null }], games), ['Pick a game for a, or skip it']);
  assert.deepEqual(problems([{ file: f('a'), game: null, skip: true }], games), []);
  assert.deepEqual(problems([{ file: f('a'), game: 1 }, { file: f('b'), game: 1 }], games), ['a and b are both set to the same game']);
  assert.deepEqual(problems([{ file: f('a'), game: 99 }], games), ['The game for a is gone']);
});
