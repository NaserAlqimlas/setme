// Daily: keeps the promises made about game videos (netlify/lib/video.mjs tidy):
// originals deleted 7 days after analysis, unfinished uploads cancelled, stuck analyses marked failed, and the files
// of deleted games removed. The viewing copies of games that still exist are kept.
import { rest } from '../lib/supabase.mjs';
import { r2 } from '../lib/r2.mjs';
import { tidy } from '../lib/video.mjs';

export const config = { schedule: '@daily' };

export default async () => {
  const bucket = r2();
  if (!bucket) return new Response('Storage not set up');
  const jobs = await rest('video_jobs?or=(original_key.not.is.null,game_id.is.null,status.in.(uploading,queued,processing))&select=*').catch(() => null);
  if (!jobs) return new Response('No video_jobs table yet');
  let done = 0;
  for (const job of jobs) {
    const t = tidy(job);
    try {
      if (t.abort) await bucket.abortUpload(job.original_key, job.upload_id).catch(() => {});
      for (const key of t.delete) await bucket.remove(key);
      if (t.drop) await rest(`video_jobs?id=eq.${encodeURIComponent(job.id)}`, { method: 'DELETE' });
      else if (t.patch) await rest(`video_jobs?id=eq.${encodeURIComponent(job.id)}`, { method: 'PATCH', body: JSON.stringify(t.patch) });
      if (t.abort || t.delete.length || t.drop || t.patch) done++;
    } catch (e) { console.error(`video ${job.id}: ${e.message}`); }   // tried again tomorrow
  }
  return new Response(`Tidied ${done} of ${jobs.length}`);
};
