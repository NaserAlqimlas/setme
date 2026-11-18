// POST /.netlify/functions/highlights — highlight reels (supabase/highlights.sql, netlify/lib/video.mjs).
// Anyone who may see the game day (canSeeDay: organizers, the super, players who played that day once it's published):
// kind: 'highlight' (default) or 'blooper': each has its own reel and video file.
//   { action: 'reel', session, game?, kind? } -> { played_on, game_n?, clips: [{ id, game, n, start, end, label }],
//        videos: { [game]: url }, file: { status, progress, error, current, url? } | null }
//      The day's highlights (or one game's), in the order played, with a link to each game's viewing copy, and the
//      reel's video file if one was made (current: it still matches the highlights; url: a download link).
// Super only:
//   { action: 'make', session, game?, kind? } -> { file }   has the worker cut the clips and join them into one video file
// The worker reports back to video-worker (with { reel }), which saves the result.
import { caller, json, rest } from '../lib/supabase.mjs';
import { r2 } from '../lib/r2.mjs';
import { canSeeDay, KINDS, LINK_SECONDS, reelClips, reelKey, sameClips, sign } from '../lib/video.mjs';

const enc = encodeURIComponent;
const NO_TABLE = 'Highlights need the database upgrade first: run supabase/highlights.sql in the Supabase SQL Editor.';
const NOT_SET_UP = 'Video files aren\'t set up yet: the storage and worker keys go in Netlify\'s environment variables (see vision/architecture.md).';

// The day (or game) and its clips, or { error, status }.
async function load(me, sessionId, gameId, kind) {
  const [session] = await rest(`sessions?id=eq.${Number(sessionId)}&select=id,played_on,published`);
  if (!session) return { error: 'That game day is gone', status: 404 };
  const games = await rest(`games?session_id=eq.${session.id}&select=id,created_at,video_kind,video_ref,players_a,players_b&order=created_at`);
  if (!canSeeDay(me, games, session)) return { error: 'You can only see highlights from game days you played', status: 403 };
  const game = gameId == null ? null : games.find(g => g.id === Number(gameId));
  if (gameId != null && !game) return { error: 'That game is gone', status: 404 };
  const refs = games.filter(g => g.video_kind === 'upload' && g.video_ref).map(g => g.video_ref);
  const [jobs, marks] = await Promise.all([
    refs.length ? rest(`video_jobs?id=in.(${refs.map(enc).join(',')})&select=id,status,viewing_key`) : [],
    rest(`highlights?game_id=in.(${games.map(g => g.id).join(',') || 0})&select=id,game_id,start_t,end_t,label,kind`)
      .catch(() => rest(`highlights?game_id=in.(${games.map(g => g.id).join(',') || 0})&select=id,game_id,start_t,end_t,label`)),   // before suggestions.sql
  ]);
  const job = new Map(jobs.map(j => [j.id, j]));
  const clips = reelClips(games, job, marks, kind).filter(c => !game || c.game === game.id);
  return { session, games, game, job, clips };
}

// The newest file of this kind. Before suggestions.sql there's no kind column: every file is a highlight reel.
const latestReel = (session, game, kind) => {
  const base = `highlight_reels?session_id=eq.${session.id}&game_id=${game ? `eq.${game.id}` : 'is.null'}&select=*&order=created_at.desc&limit=1`;
  return rest(`${base}&kind=eq.${kind}`)
    .catch(e => kind === 'highlight' ? rest(base) : Promise.reject(e))
    .then(r => r[0] ?? null);
};

function fileOf(reel, clips, bucket, name) {
  if (!reel) return null;
  return { status: reel.status, progress: reel.progress, error: reel.error, current: sameClips(reel.clips, clips),
    ...(reel.status === 'done' && reel.file_key && bucket ? { url: bucket.getUrl(reel.file_key, LINK_SECONDS, name) } : {}) };
}
const fileName = (session, game, kind) => `SetMe ${kind === 'blooper' ? 'bloopers' : 'highlights'} ${session.played_on}${game ? ` game ${game.n}` : ''}.mp4`;

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const me = await caller(req);
  if (!me) return json({ error: 'Sign in first' }, 401);
  me.player_id = await rest(`profiles?id=eq.${me.id}&select=player_id`).then(r => r[0]?.player_id ?? null, () => null);
  const body = await req.json().catch(() => ({}));
  const bucket = r2();
  const kind = KINDS.includes(body.kind) ? body.kind : 'highlight';

  try {
    if (body.action === 'reel') {
      const d = await load(me, body.session, body.game ?? null, kind);
      if (d.error) return json({ error: d.error }, d.status);
      if (!bucket && d.clips.length) return json({ error: NOT_SET_UP }, 503);
      const videos = Object.fromEntries([...new Set(d.clips.map(c => c.game))].map(id => {
        const g = d.games.find(x => x.id === id);
        return [id, bucket.getUrl(d.job.get(g.video_ref).viewing_key, LINK_SECONDS)];
      }));
      const n = d.game ? d.games.findIndex(g => g.id === d.game.id) + 1 : null;
      const reel = await latestReel(d.session, d.game, kind).catch(() => null);
      return json({ played_on: d.session.played_on, game_n: n, kind, clips: d.clips, videos,
        file: fileOf(reel, d.clips, bucket, fileName(d.session, d.game && { n }, kind)) });
    }

    if (body.action === 'make') {
      if (me.role !== 'super') return json({ error: 'Only the super makes video files' }, 403);
      if (!bucket || !process.env.MODAL_VIDEO_URL || !process.env.VIDEO_WORKER_SECRET) return json({ error: NOT_SET_UP }, 503);
      const d = await load(me, body.session, body.game ?? null, kind);
      if (d.error) return json({ error: d.error }, d.status);
      if (!d.clips.length) return json({ error: `There are no ${kind}s to put in a file yet` }, 400);
      const busy = await latestReel(d.session, d.game, kind);
      if (busy && ['queued', 'processing'].includes(busy.status) && Date.now() - Date.parse(busy.updated_at) < 30 * 60e3)
        return json({ error: 'That video file is already being made' }, 409);
      const [reel] = await rest('highlight_reels', { method: 'POST', headers: { prefer: 'return=representation' },
        body: JSON.stringify({ session_id: d.session.id, game_id: d.game?.id ?? null, clips: d.clips.map(({ id, game, start, end }) => ({ id, game, start, end })), created_by: me.id,
          ...(kind === 'blooper' ? { kind } : {}) }) });
      const send = JSON.stringify({
        kind: 'reel', reel: reel.id,
        clips: d.clips.map(c => ({ source: bucket.getUrl(d.job.get(d.games.find(g => g.id === c.game).video_ref).viewing_key, 12 * 3600), start: c.start, end: c.end })),
        output: bucket.putUrl(reelKey(reel.id), 12 * 3600),
        callback: `${new URL(req.url).origin}/.netlify/functions/video-worker`,
      });
      let now = reel;
      try {
        const res = await fetch(process.env.MODAL_VIDEO_URL, { method: 'POST', headers: { 'content-type': 'application/json', ...sign(send, process.env.VIDEO_WORKER_SECRET) }, body: send });
        if (!res.ok) throw new Error(`The video file didn't start (worker said ${res.status}). Try again in a minute.`);
      } catch (e) {
        [now] = await rest(`highlight_reels?id=eq.${reel.id}`, { method: 'PATCH', headers: { prefer: 'return=representation' },
          body: JSON.stringify({ status: 'failed', error: e.message, finished_at: new Date().toISOString() }) });
      }
      return json({ file: fileOf(now, d.clips, bucket, '') });
    }
  } catch (e) {
    return json({ error: /highlight/.test(e.message) && /relation|does not exist|schema cache/i.test(e.message) ? NO_TABLE : e.message }, 400);
  }
  return json({ error: 'Unknown action' }, 400);
};
