// Highlight reels: who sees a game day's reel, which clips it holds and in what order, when a made file is out of
// date, what a worker update may change, and download links.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyReelUpdate, canSeeDay, MAX_CLIP_SECONDS, reelClips, reelKey, sameClips } from '../netlify/lib/video.mjs';
import { r2 } from '../netlify/lib/r2.mjs';

const games = [
  { id: 12, created_at: '2026-11-10T20:30', video_ref: 'j2', players_a: [1, 2], players_b: [3, 4] },
  { id: 11, created_at: '2026-11-10T20:00', video_ref: 'j1', players_a: [5, 6], players_b: [7, 8] },
  { id: 13, created_at: '2026-11-10T21:00', video_ref: 'j3', players_a: [1], players_b: [9] },
];
const jobs = new Map([['j1', { status: 'done', viewing_key: 'viewing/j1.mp4' }], ['j2', { status: 'done', viewing_key: 'viewing/j2.mp4' }], ['j3', { status: 'processing' }]]);

test('everyone who played that day sees the whole day, once it is published', () => {
  const day = { published: true };
  assert.ok(canSeeDay({ role: 'player', player_id: 5 }, games, day));
  assert.ok(!canSeeDay({ role: 'player', player_id: 99 }, games, day));
  assert.ok(!canSeeDay({ role: 'player', player_id: 5 }, games, { published: false }));
  assert.ok(canSeeDay({ role: 'organizer' }, games, { published: false }));
  assert.ok(!canSeeDay({ role: 'rater' }, games, day));
});

test('clips in the order played, only from finished videos, long ones cut short', () => {
  const marks = [
    { id: 'c', game_id: 12, start_t: 30, end_t: 40 },
    { id: 'a', game_id: 11, start_t: 50, end_t: 400 },
    { id: 'b', game_id: 12, start_t: 10, end_t: 20, label: 'Ace' },
    { id: 'd', game_id: 13, start_t: 1, end_t: 5 },   // video still being analysed
  ];
  const clips = reelClips(games, jobs, marks);
  assert.deepEqual(clips.map(c => [c.id, c.n]), [['a', 1], ['b', 2], ['c', 2]]);
  assert.equal(clips[0].end, 50 + MAX_CLIP_SECONDS);
  assert.equal(clips[1].label, 'Ace');
});

test('a made file is out of date once a highlight is added, removed or moved', () => {
  const clips = [{ id: 'a', start: 1, end: 5 }, { id: 'b', start: 9, end: 12 }];
  assert.ok(sameClips(clips, clips.map(c => ({ ...c, game: 1 }))));
  assert.ok(!sameClips(clips, clips.slice(1)));
  assert.ok(!sameClips(clips, [clips[0], { ...clips[1], end: 13 }]));
});

test('worker updates', () => {
  assert.deepEqual(applyReelUpdate({ id: 'r', status: 'queued' }, { status: 'processing', progress: 2 }), { status: 'processing', progress: 1, error: null });
  const done = applyReelUpdate({ id: 'r', status: 'processing' }, { status: 'done' });
  assert.equal(done.file_key, reelKey('r'));
  assert.equal(applyReelUpdate({ id: 'r', status: 'done' }, { status: 'failed' }), null);
  assert.match(applyReelUpdate({ id: 'r', status: 'processing' }, { status: 'failed', error: 'Clip 2 couldn\'t be cut' }).error, /Clip 2/);
});

test('download links save the file under a tidy name', () => {
  const b = r2({ R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'setme' });
  const url = new URL(b.getUrl('reels/r.mp4', 60, 'SetMe highlights 2026-11-10 "game" 2.mp4'));
  assert.equal(url.searchParams.get('response-content-disposition'), 'attachment; filename="SetMe highlights 2026-11-10 _game_ 2.mp4"');
  assert.equal(new URL(b.getUrl('reels/r.mp4', 60)).searchParams.get('response-content-disposition'), null);
});
