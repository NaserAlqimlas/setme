// Sends a game video to storage in parts, straight from the browser: netlify/functions/video.mjs hands out a link
// per part, so the file never passes through Netlify. What's been sent is remembered on this device, so after a
// dropped connection or a reload, picking the same file again sends only the parts still missing.
import { callFn } from './ui.mjs';
import { partLength, sameFile, sentShare, todo } from './uploadparts.mjs';

export { sentShare };

const KEY = game => `setme-upload-${game}`;
const AT_ONCE = 3, TRIES = 4;

// The upload this device started for a game and hasn't finished: { job, name, size, lastModified, partBytes, done: { n: etag } }.
export function savedUpload(game) { try { return JSON.parse(localStorage.getItem(KEY(game))); } catch { return null; } }
const keep = (game, s) => { try { s ? localStorage.setItem(KEY(game), JSON.stringify(s)) : localStorage.removeItem(KEY(game)); } catch { /* storage blocked: no resuming */ } };

// Uploads running on this page, by game, so the tag screen can show one again after moving between pages.
const running = new Map();
export const activeUpload = game => running.get(game) ?? null;

function putPart(url, blob, onBytes, track) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    track(x);
    x.open('PUT', url);
    x.upload.onprogress = e => onBytes(e.loaded);
    x.onload = () => {
      const etag = x.getResponseHeader('ETag');
      if (x.status >= 300) reject(new Error(`Storage said ${x.status}`));
      else if (!etag) reject(new Error('Storage didn\'t confirm the part (its CORS rule needs ExposeHeaders: ETag)'));
      else resolve(etag);
    };
    x.onerror = () => reject(new Error('The connection dropped'));
    x.onabort = () => reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
    x.send(blob);
  });
}

// -> { done: Promise<job>, progress: 0..1, cancel(), on(fn) }. fn() is called whenever progress changes.
export function uploadVideo(game, file) {
  const listeners = new Set(), xhrs = new Set();
  let cancelled = false;
  const up = { progress: 0, file: file.name, on: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
  const tell = () => listeners.forEach(fn => fn(up));
  up.cancel = async () => {
    cancelled = true; xhrs.forEach(x => x.abort());
    const s = savedUpload(game);
    keep(game, null);
    if (s) await callFn('video', { action: 'cancel', job: s.job }).catch(() => {});
  };
  up.done = (async () => {
    let s = savedUpload(game), plan = null;
    if (sameFile(s, file)) plan = await callFn('video', { action: 'resume', job: s.job }).catch(() => null);
    if (!plan) {
      plan = await callFn('video', { action: 'start', game, name: file.name, size: file.size, type: file.type || 'video/mp4' });
      s = { job: plan.job, name: file.name, size: file.size, lastModified: file.lastModified, partBytes: plan.partBytes, done: {} };
      keep(game, s);
    }
    const moving = new Map();
    const paint = () => {
      up.progress = Math.min(1, sentShare(s) + [...moving.values()].reduce((a, b) => a + b, 0) / s.size);
      tell();
    };
    paint();
    const queue = todo(plan.parts, s.done);
    const worker = async () => {
      for (let p; (p = queue.shift());) {
        const start = (p.n - 1) * s.partBytes, blob = file.slice(start, start + partLength(s, p.n));
        for (let attempt = 1; ; attempt++) {
          if (cancelled) throw Object.assign(new Error('Cancelled'), { cancelled: true });
          try {
            s.done[p.n] = await putPart(p.url, blob, b => { moving.set(p.n, b); paint(); }, x => { xhrs.add(x); });
            moving.delete(p.n); keep(game, s); paint();
            break;
          } catch (e) {
            moving.delete(p.n); paint();
            if (e.cancelled || attempt >= TRIES) throw e;
            await new Promise(r => setTimeout(r, 2000 * attempt));   // a wobble in the connection: try that part again
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, worker));
    const { job } = await callFn('video', { action: 'finish', job: s.job, parts: Object.entries(s.done).map(([n, etag]) => ({ n: Number(n), etag })) });
    keep(game, null);
    return job;
  })();
  const guard = e => { e.preventDefault(); e.returnValue = ''; };   // leaving the page stops the upload: ask first
  addEventListener('beforeunload', guard);
  running.set(game, up);
  up.done.finally(() => { running.delete(game); removeEventListener('beforeunload', guard); tell(); }).catch(() => {});
  return up;
}
