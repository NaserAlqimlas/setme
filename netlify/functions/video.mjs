// POST /.netlify/functions/video — game videos (supabase/video.sql, netlify/lib/video.mjs).
// Anyone signed in:
//   { action: 'list' }               -> { videos: [{ game, played_on, n, score_a, score_b, a: [names], b: [names], rallies }] }
//                                       the videos the caller may watch, newest first: every game's for organizers and
//                                       the super; a player only games they played in, on published game days
//   { action: 'watch', game }        -> { job: { id, status, progress, error, file_name }, url?, rallies?, sound? }
//                                       url: the copy to watch, a link that works for LINK_SECONDS. Players only get
//                                       finished videos; organizers and the super also see the status while it's analysed.
// Super only (uploading goes straight from the browser to storage, in parts, with these links):
//   { action: 'start', game, name, size, type } -> { job, partBytes, parts: [{ n, url }] }
//   { action: 'resume', job }        -> { partBytes, parts }        fresh links for an upload left part-way
//   { action: 'finish', job, parts: [{ n, etag }] } -> { job: {...} }  joins the parts, starts the analysis
//   { action: 'retry', job }         -> { job: {...} }              analyses the upload again (kept for 7 days)
//   { action: 'cancel', job }        -> { ok }
//   { action: 'sound', games? }      -> { started }   score the sound (for highlight suggestions) of videos analysed
//                                       before that existed: the given games', or every one still without, 25 at a time
import { caller, json, rest } from '../lib/supabase.mjs';
import { r2 } from '../lib/r2.mjs';
import { canWatch, shownOnly, LINK_SECONDS, originalKey, PART_BYTES, parts as partsOf, sign, viewingKey } from '../lib/video.mjs';

const enc = encodeURIComponent;
const NOT_SET_UP = 'Video upload isn\'t set up yet: the storage and worker keys go in Netlify\'s environment variables (see vision/architecture.md).';
const NO_TABLE = 'Video upload needs the database upgrade first: run supabase/video.sql in the Supabase SQL Editor.';
const SHOWN = 'id,game_id,status,progress,error,file_name,size_bytes,created_at,finished_at,original_key';

const jobOf = id => rest(`video_jobs?id=eq.${enc(id)}&select=*`).then(r => r[0]);
const patchJob = (id, patch) => rest(`video_jobs?id=eq.${enc(id)}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(patch) }).then(r => r[0]);
const shown = job => job && Object.fromEntries(SHOWN.split(',').map(k => [k, k === 'original_key' ? !!job[k] : job[k]]));

// Hands the job to the worker (Modal), which fetches the original with one link and uploads the copy with another.
async function startWorker(bucket, job, origin, env = process.env) {
  const body = JSON.stringify({
    job: job.id,
    source: bucket.getUrl(job.original_key, 12 * 3600),
    viewing: bucket.putUrl(viewingKey(job.id), 12 * 3600),
    callback: `${origin}/.netlify/functions/video-worker`,
  });
  const res = await fetch(env.MODAL_VIDEO_URL, { method: 'POST', headers: { 'content-type': 'application/json', ...sign(body, env.VIDEO_WORKER_SECRET) }, body });
  if (!res.ok) throw new Error(`The analysis didn't start (worker said ${res.status}). Try again in a minute.`);
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const me = await caller(req);
  if (!me) return json({ error: 'Sign in first' }, 401);
  const body = await req.json().catch(() => ({}));
  const origin = new URL(req.url).origin;
  const bucket = r2();
  const ready = bucket && process.env.MODAL_VIDEO_URL && process.env.VIDEO_WORKER_SECRET;
  me.player_id = await rest(`profiles?id=eq.${me.id}&select=player_id`).then(r => r[0]?.player_id ?? null, () => null);

  try {
    if (body.action === 'list') {
      const pid = Number(me.player_id);
      const mine = shownOnly(me);
      if (mine && !Number.isInteger(pid)) return json({ videos: [] });
      const games = await rest(`games?video_kind=eq.upload&select=id,session_id,score_a,score_b,players_a,players_b,video_ref,created_at,sessions(played_on${mine ? ',published' : ''})`
        + '&order=created_at.desc')
        .then(gs => gs.filter(g => canWatch(me) && (!mine || g.sessions?.published)));
      if (!games.length) return json({ videos: [] });
      const [jobs, all, names] = await Promise.all([
        rest(`video_jobs?id=in.(${games.map(g => enc(g.video_ref)).join(',')})&status=eq.done&select=id,result`),
        rest(`games?session_id=in.(${[...new Set(games.map(g => g.session_id))].join(',')})&select=id,session_id,created_at&order=created_at`),
        rest(`players?id=in.(${[...new Set(games.flatMap(g => [...g.players_a, ...g.players_b]))].join(',')})&select=id,name`),
      ]);
      const job = new Map(jobs.map(j => [j.id, j])), name = new Map(names.map(p => [p.id, p.name]));
      const n = g => all.filter(x => x.session_id === g.session_id).findIndex(x => x.id === g.id) + 1;
      return json({ videos: games.filter(g => job.has(g.video_ref)).map(g => ({
        game: g.id, played_on: g.sessions?.played_on, n: n(g), score_a: g.score_a, score_b: g.score_b,
        a: g.players_a.map(id => name.get(id)).filter(Boolean), b: g.players_b.map(id => name.get(id)).filter(Boolean),
        rallies: job.get(g.video_ref).result?.rallies?.length ?? 0,
      })) });
    }

    if (body.action === 'watch') {
      const [g] = await rest(`games?id=eq.${Number(body.game)}&select=id,players_a,players_b,video_kind,video_ref${shownOnly(me) ? ',sessions(published)' : ''}`);
      if (!g || !canWatch(me) || (shownOnly(me) && !g.sessions?.published)) return json({ error: 'That game day isn\'t published yet' }, 403);
      if (g.video_kind !== 'upload' || !g.video_ref) return json({ job: null });
      const job = await jobOf(g.video_ref);
      if (!job) return json({ job: null });
      if (shownOnly(me) && job.status !== 'done') return json({ error: 'That video isn\'t ready yet' }, 404);
      const out = { job: shown(job) };
      if (job.status === 'done' && job.viewing_key) {
        if (!bucket) return json({ error: NOT_SET_UP }, 503);
        out.url = bucket.getUrl(job.viewing_key, LINK_SECONDS);
        out.rallies = job.result?.rallies ?? [];
        out.sound = job.result?.sound ?? null;
      }
      return json(out);
    }

    if (!['start', 'resume', 'finish', 'retry', 'cancel', 'sound'].includes(body.action)) return json({ error: 'Unknown action' }, 400);
    if (me.role !== 'super') return json({ error: 'Only the super uploads videos' }, 403);
    if (!ready) return json({ error: NOT_SET_UP }, 503);

    if (body.action === 'start') {
      const size = Number(body.size), name = String(body.name || 'video').slice(0, 200);
      const nums = partsOf(size);
      const [g] = await rest(`games?id=eq.${Number(body.game)}&select=id`);
      if (!g) return json({ error: 'That game is gone' }, 404);
      const id = crypto.randomUUID(), key = originalKey(id, name);
      const uploadId = await bucket.startUpload(key, String(body.type || 'video/mp4'));
      await rest('video_jobs', { method: 'POST', headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ id, game_id: g.id, uploaded_by: me.id, file_name: name, size_bytes: size, original_key: key, upload_id: uploadId }) })
        .catch(async e => { await bucket.abortUpload(key, uploadId).catch(() => {}); throw e; });
      return json({ job: id, partBytes: PART_BYTES, parts: nums.map(n => ({ n, url: bucket.partUrl(key, uploadId, n) })) });
    }

    if (body.action === 'sound') {
      const only = Array.isArray(body.games) ? body.games.map(Number).filter(Number.isInteger) : null;
      const jobs = await rest(`video_jobs?status=eq.done&viewing_key=not.is.null&result->sound=is.null&select=id,viewing_key${only ? `&game_id=in.(${only.join(',') || 0})` : '&game_id=not.is.null'}&limit=25`);
      let started = 0;
      for (const j of jobs) {
        const send = JSON.stringify({ kind: 'sound', job: j.id, source: bucket.getUrl(j.viewing_key, 12 * 3600), callback: `${origin}/.netlify/functions/video-worker` });
        const res = await fetch(process.env.MODAL_VIDEO_URL, { method: 'POST', headers: { 'content-type': 'application/json', ...sign(send, process.env.VIDEO_WORKER_SECRET) }, body: send }).catch(() => null);
        if (res?.ok) started++;
      }
      return json({ started });
    }

    const job = await jobOf(body.job);
    if (!job) return json({ error: 'That upload is gone' }, 404);

    if (body.action === 'resume') {
      if (job.status !== 'uploading' || !job.upload_id) return json({ error: 'That upload has already finished or was cancelled' }, 409);
      return json({ partBytes: PART_BYTES, parts: partsOf(Number(job.size_bytes)).map(n => ({ n, url: bucket.partUrl(job.original_key, job.upload_id, n) })) });
    }

    if (body.action === 'cancel') {
      if (job.status === 'uploading' && job.upload_id) await bucket.abortUpload(job.original_key, job.upload_id).catch(() => {});
      if (job.status !== 'done') await patchJob(job.id, { status: 'cancelled', upload_id: null, ...(job.status === 'uploading' ? { original_key: null } : {}) });
      return json({ ok: true });
    }

    if (body.action === 'finish') {
      if (job.status !== 'uploading' || !job.upload_id) return json({ error: 'That upload has already finished or was cancelled' }, 409);
      const given = Array.isArray(body.parts) ? body.parts.map(p => ({ n: Number(p.n), etag: String(p.etag || '') })) : [];
      const want = partsOf(Number(job.size_bytes));
      if (want.some(n => !given.find(p => p.n === n && p.etag))) return json({ error: 'Some of the video hasn\'t been sent yet. Tap Resume.' }, 400);
      await bucket.finishUpload(job.original_key, job.upload_id, given.filter(p => want.includes(p.n)));
      // An earlier video of this game is replaced (the page asks first): its files go, its record says so.
      const older = await rest(`video_jobs?game_id=eq.${job.game_id}&id=neq.${enc(job.id)}&status=neq.cancelled&select=id,original_key,viewing_key`);
      for (const o of older) {
        await Promise.all([o.original_key, o.viewing_key].filter(Boolean).map(k => bucket.remove(k).catch(() => {})));
        await patchJob(o.id, { status: 'cancelled', original_key: null, viewing_key: null, error: 'Replaced by a newer upload.' });
      }
      await rest(`games?id=eq.${job.game_id}`, { method: 'PATCH', body: JSON.stringify({ video_kind: 'upload', video_ref: job.id }) });
      let now = await patchJob(job.id, { status: 'queued', upload_id: null, progress: 0 });
      try { await startWorker(bucket, now, origin); }
      catch (e) { now = await patchJob(job.id, { status: 'failed', error: e.message, finished_at: new Date().toISOString() }); }
      return json({ job: shown(now) });
    }

    if (body.action === 'retry') {
      const stuck = ['queued', 'processing'].includes(job.status) && Date.now() - Date.parse(job.updated_at) > 20 * 60e3;
      if (job.status !== 'failed' && !stuck) return json({ error: 'Only an analysis that failed or got stuck can be tried again' }, 409);
      if (!job.original_key) return json({ error: 'The upload was deleted 7 days after it was analysed, so it can\'t be analysed again. Upload it again.' }, 409);
      let now = await patchJob(job.id, { status: 'queued', progress: 0, error: null, finished_at: null, attempts: (job.attempts ?? 0) + 1 });
      try { await startWorker(bucket, now, origin); }
      catch (e) { now = await patchJob(job.id, { status: 'failed', error: e.message, finished_at: new Date().toISOString() }); }
      return json({ job: shown(now) });
    }
  } catch (e) {
    return json({ error: /video_jobs|video_kind_check/.test(e.message) ? NO_TABLE : e.message }, 400);
  }
  return json({ error: 'Unknown action' }, 400);
};
