// Game videos: who may watch, upload parts, signed worker messages, what an update may change, the daily clean-up,
// and the email.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyUpdate, canWatch, doneEmail, gameLabel, MAX_BYTES, originalKey, PART_BYTES, parts, sign, tidy, verify } from '../netlify/lib/video.mjs';
import { sendEmail } from '../netlify/lib/email.mjs';

const game = { players_a: [1, 2], players_b: [3, 4] };

test('organizers and the super watch any game; players only their own', () => {
  assert.ok(canWatch({ role: 'super' }, game));
  assert.ok(canWatch({ role: 'organizer' }, game));
  assert.ok(canWatch({ role: 'player', player_id: 3 }, game));
  assert.ok(canWatch({ role: 'player', player_id: '3' }, game));
  assert.ok(canWatch({ role: 'player', player_id: 9 }, game));       // every player watches every game
  assert.ok(canWatch({ role: 'player', player_id: null }, game));
  assert.ok(!canWatch({ role: 'rater', player_id: 3 }, game));      // raters aren't players in the club sense
  assert.ok(!canWatch(null, game));
});

test('uploads go in equal parts, and too big is refused before anything is sent', () => {
  assert.deepEqual(parts(1), [1]);
  assert.deepEqual(parts(PART_BYTES), [1]);
  assert.deepEqual(parts(PART_BYTES + 1), [1, 2]);
  assert.equal(parts(MAX_BYTES).length, 64);
  assert.throws(() => parts(MAX_BYTES + 1), /the most is 4 GB/);
  assert.throws(() => parts(0), /empty/);
  assert.equal(originalKey('j', 'My game (1).MOV'), 'originals/j/My_game_1_.MOV');
  assert.equal(originalKey('j', '../../x'), 'originals/j/.._.._x');      // no folders of its own
});

test('worker messages: signed, recent, and only with the secret', () => {
  const body = '{"job":"j","status":"processing"}', now = 1_800_000_000;
  const h = sign(body, 'shh', now);
  assert.ok(verify(body, h, 'shh', now + 5));
  assert.ok(!verify(body, h, 'other', now));
  assert.ok(!verify(body + ' ', h, 'shh', now));
  assert.ok(!verify(body, h, 'shh', now + 3600));         // replayed an hour later
  assert.ok(!verify(body, { ...h, 'x-setme-signature': 'zz' }, 'shh', now));
  assert.ok(!verify(body, h, '', now));                   // no secret set: nothing gets in
});

test('worker updates: progress, done with the rallies, failed; ignored once a job has ended', () => {
  const job = { id: 'j', status: 'queued' };
  assert.deepEqual(applyUpdate(job, { status: 'processing', progress: 1.7 }), { status: 'processing', progress: 1, error: null });
  const done = applyUpdate({ ...job, status: 'processing' }, { status: 'done', viewing: true,
    result: { version: 1, rallies: [{ start: 3, end: 9.5, confidence: 0.8 }, { start: 'x', end: 2 }, { start: 5, end: 4 }] } });
  assert.equal(done.status, 'done');
  assert.equal(done.viewing_key, 'viewing/j.mp4');
  assert.deepEqual(done.result.rallies, [{ start: 3, end: 9.5, confidence: 0.8 }]);
  assert.equal(applyUpdate(job, { status: 'done', result: { rallies: [] } }).status, 'failed');   // no copy to watch
  assert.match(applyUpdate(job, { status: 'failed', error: 'Unreadable' }).error, /Unreadable/);
  for (const status of ['done', 'failed', 'cancelled', 'uploading']) assert.equal(applyUpdate({ ...job, status }, { status: 'processing', progress: 0.5 }), null);
  assert.equal(applyUpdate(job, { status: 'weird' }), null);
});

test('clean-up: originals go after 7 days, viewing copies stay, stuck and abandoned jobs are closed', () => {
  const now = Date.parse('2026-11-15T12:00:00Z'), ago = h => new Date(now - h * 3600e3).toISOString();
  const base = { id: 'j', game_id: 5, original_key: 'originals/j/a.mov', viewing_key: 'viewing/j.mp4', upload_id: null };
  let t = tidy({ ...base, status: 'done', finished_at: ago(8 * 24), updated_at: ago(8 * 24) }, now);
  assert.deepEqual(t.delete, ['originals/j/a.mov']);
  assert.equal(t.patch.original_key, null);
  t = tidy({ ...base, status: 'done', finished_at: ago(6 * 24), updated_at: ago(6 * 24) }, now);
  assert.deepEqual(t.delete, []); assert.equal(t.patch, null);
  t = tidy({ ...base, status: 'processing', viewing_key: null, finished_at: null, updated_at: ago(3) }, now);
  assert.equal(t.patch.status, 'failed'); assert.deepEqual(t.delete, []);              // the upload stays for a retry
  t = tidy({ ...base, status: 'uploading', viewing_key: null, upload_id: 'u', finished_at: null, updated_at: ago(3 * 24) }, now);
  assert.ok(t.abort); assert.equal(t.patch.status, 'cancelled');
  t = tidy({ ...base, game_id: null, status: 'done', finished_at: ago(1), updated_at: ago(1) }, now);
  assert.deepEqual(t.delete, ['originals/j/a.mov', 'viewing/j.mp4']); assert.ok(t.drop);
  t = tidy({ ...base, original_key: null, status: 'done', finished_at: ago(400 * 24), updated_at: ago(400 * 24) }, now);
  assert.deepEqual(t, { delete: [], abort: false, patch: null, drop: false });       // a year on, still watchable
});

test('the email to the uploader', () => {
  assert.equal(gameLabel(2, '2026-11-10'), 'Game 2 on Tue, Nov 10');
  const ok = doneEmail({ status: 'done', label: 'Game 2 on Tue, Nov 10', rallies: 41, link: 'https://x/#videos' });
  assert.match(ok.subject, /ready/); assert.match(ok.text, /41 rallies found/); assert.match(ok.text, /^https:\/\/x\/#videos$/m);
  assert.equal(ok.html, undefined);                       // plain text, so it lands in the inbox, not Promotions
  const bad = doneEmail({ status: 'failed', label: 'G', error: 'It broke', link: 'l' });
  assert.match(bad.subject, /couldn't/); assert.match(bad.text, /It broke/);
});

test('sending email: through Resend, or quietly not at all when it isn\'t set up', async () => {
  assert.equal(await sendEmail({ to: 'a@b.c', subject: 's', text: 't' }, {}), null);
  let sent;
  const id = await sendEmail({ to: 'a@b.c', subject: 's', text: 't' }, { RESEND_API_KEY: 'k', RESEND_FROM: 'SetMe <x@y.z>' },
    async (url, init) => { sent = { url, init }; return new Response('{"id":"m1"}', { status: 200 }); });
  assert.equal(id, 'm1');
  assert.equal(sent.url, 'https://api.resend.com/emails');
  assert.equal(sent.init.headers.authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(sent.init.body).to, ['a@b.c']);
  await assert.rejects(sendEmail({ to: 'a', subject: 's', text: 't' }, { RESEND_API_KEY: 'k' },
    async () => new Response('{"message":"You can only send testing emails to your own email address"}', { status: 403 })), /only send testing emails/);
});

test('invite and reset emails', async () => {
  const { accountEmail } = await import('../netlify/lib/email.mjs');
  const inv = accountEmail({ kind: 'invite', name: 'Sara', role: 'player', link: 'https://s/?token_hash=a&type=invite' });
  assert.equal(inv.subject, 'You\'re invited to SetMe');
  assert.match(inv.text, /^Hi Sara,/); assert.match(inv.text, /watch videos of the games\./);
  assert.match(inv.text, /^https:\/\/s\/\?token_hash=a&type=invite$/m);
  assert.equal(inv.html, undefined);
  const reset = accountEmail({ kind: 'reset', name: 'Sara', link: 'l' });
  assert.match(reset.subject, /password reset/); assert.match(reset.text, /^l$/m);
});
