// POST /.netlify/functions/video-worker — the analysis worker (vision/worker/modal_app.py) reporting on a job.
// Signed with VIDEO_WORKER_SECRET (netlify/lib/video.mjs sign/verify); anything unsigned or stale is refused.
//   { job, status: 'processing', progress }
//   { job, status: 'done', viewing: true, result: { version, video, duration, rallies: [{ start, end, confidence }] } }
//   { job, status: 'failed', error }
// Or about a highlight reel being made into a file (highlights.mjs): { reel, status: 'processing' | 'done' | 'failed', progress?, error? }.
// When a reel's file is done, older files of the same reel are deleted.
// When the job ends, the person who uploaded it gets an email (Resend), if email is set up.
import { json, rest } from '../lib/supabase.mjs';
import { sendEmail } from '../lib/email.mjs';
import { r2 } from '../lib/r2.mjs';
import { applyReelUpdate, applyUpdate, doneEmail, gameLabel, verify } from '../lib/video.mjs';

const enc = encodeURIComponent;

async function tellUploader(job, origin) {
  const [who] = await rest(`profiles?id=eq.${enc(job.uploaded_by)}&select=email`);
  const [g] = await rest(`games?id=eq.${job.game_id}&select=id,session_id,sessions(played_on)`);
  if (!who?.email || !g) return;
  const day = await rest(`games?session_id=eq.${g.session_id}&select=id&order=created_at`);
  const label = gameLabel(day.findIndex(x => x.id === g.id) + 1, g.sessions?.played_on);
  await sendEmail({ to: who.email, ...doneEmail({ status: job.status, label, rallies: job.result?.rallies?.length ?? 0, error: job.error, link: `${origin}/#games` }) });
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const text = await req.text();
  if (!verify(text, Object.fromEntries(req.headers), process.env.VIDEO_WORKER_SECRET)) return json({ error: 'Not signed' }, 401);
  let u;
  try { u = JSON.parse(text); } catch { return json({ error: 'Not JSON' }, 400); }
  if (u.reel) return reelUpdate(u);
  const [job] = await rest(`video_jobs?id=eq.${enc(u.job)}&select=*`);
  if (!job) return json({ error: 'No such job' }, 404);
  const patch = applyUpdate(job, u);
  if (!patch) return json({ ignored: true });   // cancelled, replaced, or already finished
  const [now] = await rest(`video_jobs?id=eq.${enc(job.id)}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (['done', 'failed'].includes(now.status)) {
    // The email is a courtesy: a failure to send it doesn't undo the result.
    await tellUploader(now, process.env.URL || new URL(req.url).origin).catch(e => console.error(e.message));
  }
  return json({ ok: true, status: now.status });
};

async function reelUpdate(u) {
  const [reel] = await rest(`highlight_reels?id=eq.${enc(u.reel)}&select=*`);
  if (!reel) return json({ error: 'No such reel' }, 404);
  const patch = applyReelUpdate(reel, u);
  if (!patch) return json({ ignored: true });
  const [now] = await rest(`highlight_reels?id=eq.${enc(reel.id)}`, { method: 'PATCH', headers: { prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (now.status === 'done') {
    const older = await rest(`highlight_reels?session_id=eq.${reel.session_id}&game_id=${reel.game_id ? `eq.${reel.game_id}` : 'is.null'}&id=neq.${enc(reel.id)}&select=id,file_key`);
    const bucket = r2();
    for (const o of older) {
      if (o.file_key && bucket) await bucket.remove(o.file_key).catch(() => {});
      await rest(`highlight_reels?id=eq.${enc(o.id)}`, { method: 'DELETE' }).catch(() => {});
    }
  }
  return json({ ok: true, status: now.status });
}
