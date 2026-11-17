// Game videos: the rules the video functions share, kept apart from the network so they can be tested.
// See supabase/video.sql for the job record and vision/architecture.md for the whole pipeline.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_BYTES = 4 * 1024 ** 3;          // about 45 minutes of iPhone 1080p
export const PART_BYTES = 64 * 1024 ** 2;        // each upload part; a dropped connection resends one part at most
export const KEEP_ORIGINAL_DAYS = 7;             // originals are deleted this long after analysis; the viewing copy stays
export const STUCK_HOURS = 2;                    // a job with no word from the worker for this long has failed
export const ABANDONED_UPLOAD_DAYS = 2;          // an upload nobody finished is cancelled after this long
export const LINK_SECONDS = 4 * 3600;            // how long a watch link works (a long game, paused, still plays)

// Where each file goes in the bucket. The file name is kept (safely) so the original is recognisable.
export const originalKey = (job, name) => `originals/${job}/${String(name).replace(/[^\w.-]+/g, '_').slice(-80) || 'video'}`;
export const viewingKey = job => `viewing/${job}.mp4`;

// The parts a file is sent in: [1, 2, …]. R2 needs every part but the last to be the same size, at least 5 MB.
export function parts(size) {
  if (!Number.isFinite(size) || size <= 0) throw new Error('That file is empty');
  if (size > MAX_BYTES) throw new Error(`That video is ${(size / 1024 ** 3).toFixed(1)} GB; the most is ${MAX_BYTES / 1024 ** 3} GB. Trim it, or export it at 1080p.`);
  return Array.from({ length: Math.ceil(size / PART_BYTES) }, (_, i) => i + 1);
}

// Who may watch a game's video: organizers and the super any game, a player only games they played in.
export function canWatch(me, game) {
  if (!me) return false;
  if (me.role === 'super' || me.role === 'organizer') return true;
  const pid = Number(me.player_id);
  return me.role === 'player' && Number.isInteger(pid) && [...(game.players_a ?? []), ...(game.players_b ?? [])].map(Number).includes(pid);
}

// Highlight reels (supabase/highlights.sql). A game day's reel is open to organizers, the super, and players who
// played any game that day once it's published (decided 2026-11-17: everyone in the game day sees the day's reel).
export const reelKey = reel => `reels/${reel}.mp4`;
export const MAX_CLIP_SECONDS = 90;   // a highlight longer than this is cut short (a reel is short moments)
export function canSeeDay(me, games, session) {
  if (!me) return false;
  if (me.role === 'super' || me.role === 'organizer') return true;
  return me.role === 'player' && !!session?.published && games.some(g => canWatch(me, g));
}
// The reel's clips, in the order played: games by when they were saved, then by time in the video. Only games with
// a finished viewing copy. games: [{ id, created_at, video_ref }], jobs: Map video_ref -> job, highlights: rows.
export function reelClips(games, jobs, highlights) {
  const order = [...games].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id - b.id);
  const n = new Map(order.map((g, i) => [g.id, i + 1]));
  const ok = new Set(order.filter(g => { const j = jobs.get(g.video_ref); return j?.status === 'done' && j.viewing_key; }).map(g => g.id));
  return highlights.filter(x => ok.has(x.game_id))
    .map(x => ({ id: x.id, game: x.game_id, n: n.get(x.game_id), start: Number(x.start_t), end: Math.min(Number(x.end_t), Number(x.start_t) + MAX_CLIP_SECONDS), label: x.label ?? null }))
    .sort((a, b) => a.n - b.n || a.start - b.start);
}
// Is the file made from these clips still the reel? (Highlights added, removed or moved since: no.)
export const sameClips = (a, b) => JSON.stringify((a ?? []).map(c => [c.id, c.start, c.end])) === JSON.stringify((b ?? []).map(c => [c.id, c.start, c.end]));

// A worker update about a reel, given the reel now -> fields to save, or null to ignore it.
export function applyReelUpdate(reel, u) {
  if (!['queued', 'processing'].includes(reel.status)) return null;
  if (u.status === 'processing') return { status: 'processing', progress: clamp01(u.progress), error: null };
  if (u.status === 'done') return { status: 'done', progress: 1, error: null, finished_at: new Date().toISOString(), file_key: reelKey(reel.id) };
  if (u.status === 'failed') return { status: 'failed', error: String(u.error || 'The video file couldn\'t be made.').slice(0, 300), finished_at: new Date().toISOString() };
  return null;
}

// Messages between SetMe and the worker are signed with a secret both know, with the time, so an old message can't
// be replayed. Header x-setme-signature: hex HMAC-SHA256 of `${time}.${body}`; x-setme-time: seconds.
export const sign = (body, secret, time = Math.floor(Date.now() / 1000)) =>
  ({ 'x-setme-time': String(time), 'x-setme-signature': createHmac('sha256', secret).update(`${time}.${body}`).digest('hex') });

export function verify(body, headers, secret, now = Date.now() / 1000, slack = 600) {
  const time = Number(headers['x-setme-time']), got = String(headers['x-setme-signature'] ?? '');
  if (!secret || !Number.isFinite(time) || Math.abs(now - time) > slack || !/^[0-9a-f]{64}$/.test(got)) return false;
  const want = sign(body, secret, time)['x-setme-signature'];
  return timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(want, 'hex'));
}

// What a worker update may change, given the job's status now -> the fields to save, or null to ignore it
// (an update for a job that was cancelled, already finished, or a message out of order).
export function applyUpdate(job, u) {
  if (!['queued', 'processing'].includes(job.status)) return null;
  if (u.status === 'processing') return { status: 'processing', progress: clamp01(u.progress), error: null };
  if (u.status === 'done') {
    const rallies = Array.isArray(u.result?.rallies) ? u.result.rallies
      .map(r => ({ start: Number(r.start), end: Number(r.end), confidence: Number(r.confidence ?? 0) }))
      .filter(r => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start) : [];
    if (!u.viewing) return { status: 'failed', error: 'The copy to watch wasn\'t made. Try again; if it keeps failing, export the video again as MP4.', finished_at: new Date().toISOString() };
    return { status: 'done', progress: 1, error: null, finished_at: new Date().toISOString(),
      result: { ...(u.result ?? {}), rallies }, viewing_key: viewingKey(job.id) };
  }
  if (u.status === 'failed') return { status: 'failed', error: String(u.error || 'The video couldn\'t be analysed.').slice(0, 300), finished_at: new Date().toISOString() };
  return null;
}
const clamp01 = v => Number.isFinite(Number(v)) ? Math.min(1, Math.max(0, Number(v))) : null;

// The daily clean-up's decisions for one job -> { delete: [keys], abort, patch, drop }.
export function tidy(job, now = Date.now()) {
  const age = t => (now - Date.parse(t)) / 3600e3;   // hours
  const out = { delete: [], abort: false, patch: null, drop: false };
  if (job.game_id == null) {                          // the game was deleted: so is its video
    out.delete = [job.original_key, job.viewing_key].filter(Boolean);
    out.abort = job.status === 'uploading' && !!job.upload_id;
    out.drop = true;
    return out;
  }
  if (job.status === 'uploading' && age(job.updated_at) > ABANDONED_UPLOAD_DAYS * 24) {
    out.abort = !!job.upload_id;
    out.patch = { status: 'cancelled', upload_id: null, original_key: null, error: 'The upload wasn\'t finished.' };
    return out;
  }
  if (['queued', 'processing'].includes(job.status) && age(job.updated_at) > STUCK_HOURS)
    out.patch = { status: 'failed', error: 'The analysis stopped without finishing. Try again.', finished_at: new Date(now).toISOString() };
  const ended = out.patch?.finished_at ?? job.finished_at ?? (['failed', 'cancelled'].includes(job.status) ? job.updated_at : null);
  if (job.original_key && ended && age(ended) > KEEP_ORIGINAL_DAYS * 24 && !out.patch) {
    out.delete.push(job.original_key);
    out.patch = { original_key: null, original_deleted_at: new Date(now).toISOString() };
  }
  return out;
}

// "Game 2 on Tue, Nov 10"
export function gameLabel(n, playedOn) {
  const d = new Date(`${playedOn}T12:00:00Z`);
  return `Game ${n} on ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

// The email to the person who uploaded, when the analysis is done or has failed -> { subject, text }. Plain text on
// purpose: Gmail files styled, button-led mail under Promotions, and this should reach the inbox.
export function doneEmail({ status, label, rallies, error, link }) {
  const ok = status === 'done';
  const subject = ok ? `${label} is ready to watch` : `${label}: the video couldn't be analysed`;
  const lines = ok
    ? [`${label} is ready. ${rallies ? `${rallies} rall${rallies === 1 ? 'y' : 'ies'} found, so Next rally skips the time between them.` : 'No rallies were found, but the video is ready to watch.'}`,
      'Organizers and the players in the game can watch it now, with its stats, on Games.']
    : [`${label} couldn't be analysed: ${error}`, 'You can try again from the game\'s tag screen. The upload is kept for 7 days.'];
  return { subject, text: [...lines, '', link, '', 'SetMe'].join('\n') };
}
