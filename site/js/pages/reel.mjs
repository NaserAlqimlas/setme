// A highlight reel (#reel/<session> for a game day, #reel/<session>/<game> for one game): the highlights marked on
// Games, played back to back from each game's video. Everyone who played that day can watch the day's reel
// (netlify/functions/highlights.mjs). The reel can be made into one video file to download: the super makes it,
// anyone watching downloads it once it's ready.
import { callFn, fill, h, me, pageHead, toast, withSpinner } from '../ui.mjs';
import { playAt } from '../rallytimes.mjs';
import { dayTitle } from './teams.mjs';

const clock = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
let poll = null;

export async function reelPage(session, game) {
  clearTimeout(poll);
  let d;
  try { d = await callFn('highlights', { action: 'reel', session, game }); }
  catch (e) { return h('div', {}, back(), h('p', { class: 'warn' }, e.message)); }
  const title = d.game_n ? `Game ${d.game_n} highlights` : 'Highlights';
  const head = pageHead(title, dayTitle(d.played_on));
  if (!d.clips.length) return h('div', {}, back(), head, h('div', { class: 'card empty' },
    me.role === 'super' ? 'No highlights yet. Open a game on Games and mark them under its video.' : 'No highlights from this day yet.'));

  const clips = d.clips, video = h('video', { controls: true, playsinline: true, preload: 'metadata' });
  let at = -1;
  const now = h('div', { class: 'reel-now' });
  const list = h('ol', { class: 'reel-list' });
  const go = i => {
    if (i < 0 || i >= clips.length) return;
    at = i;
    const c = clips[i], src = d.videos[c.game];
    if (video.dataset.game !== String(c.game)) { video.src = src; video.dataset.game = String(c.game); }
    playAt(video, c.start);
    paint();
  };
  // Played with the video's own button before choosing a clip: that's the first clip.
  video.addEventListener('play', () => { if (at < 0) { at = 0; paint(); } });
  // Moving on when a clip's end is reached; after the last one the reel stops there.
  video.addEventListener('timeupdate', () => {
    const c = clips[at];
    if (!c || video.paused || video.currentTime < c.end) return;
    if (at + 1 < clips.length) go(at + 1);
    else { video.pause(); at = clips.length; paint(); }
  });
  const paint = () => {
    const c = clips[at];
    fill(now, c ? h('span', {}, h('b', {}, `${at + 1} of ${clips.length}`), ` · Game ${c.n} at ${clock(c.start)}`, c.label && ` · ${c.label}`)
      : at >= clips.length ? h('span', {}, h('b', {}, 'That\'s the reel.'), ' ', h('button', { class: 'ghost sm', onclick: () => go(0) }, '↺ Play again'))
        : h('span', { class: 'muted' }, `${clips.length} highlight${clips.length === 1 ? '' : 's'}`));
    fill(list, clips.map((c, i) => h('li', { class: i === at ? 'on' : null },
      h('button', { type: 'button', onclick: () => go(i) }, h('span', { class: 'muted small' }, `Game ${c.n}`), ` ${clock(c.start)}`, c.label && h('span', { class: 'muted small' }, ` · ${c.label}`)))));
  };
  paint();
  // The first clip is ready on screen (its first frame), so the reel starts at once when Play is tapped.
  video.src = d.videos[clips[0].game]; video.dataset.game = String(clips[0].game);
  playAt(video, clips[0].start, false);
  const total = clips.reduce((t, c) => t + c.end - c.start, 0);
  const full = () => (video.requestFullscreen?.() ?? video.webkitRequestFullscreen?.() ?? video.webkitEnterFullscreen?.())?.catch?.(() => {});
  const start = h('button', { class: 'reel-start', onclick: () => go(0) }, `▶ Play the reel · ${clock(total)}`);
  const fileBox = h('div', { class: 'card' });
  paintFile(fileBox, d.file, { session, game, clips: clips.length });

  return h('div', {}, back(), head,
    h('div', { class: 'card reel-card' },
      h('div', { class: 'video-frame' }, withSpinner(video)),
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center' },
        start, h('button', { class: 'ghost sm', onclick: () => go(Math.max(0, at - 1)) }, '◀ Back'),
        h('button', { class: 'ghost sm', onclick: () => go(Math.min(clips.length - 1, at + 1)) }, 'Next ▶'),
        now, h('span', { class: 'grow' }), h('button', { class: 'ghost sm', onclick: full }, '⛶ Full screen'))),
    h('div', { class: 'card' }, h('h3', {}, 'In this reel'), list),
    fileBox);
}

const back = () => h('p', {}, h('a', { href: '#games' }, '← Games'));

// The video file: download it when it's ready; the super makes it (again, once highlights change). While it's being
// made, this checks back every few seconds.
function paintFile(box, file, { session, game, clips }) {
  clearTimeout(poll);
  const sup = me.role === 'super';
  const make = async btn => {
    btn.disabled = true; btn.textContent = 'Starting…';
    try { paintFile(box, (await callFn('highlights', { action: 'make', session, game })).file, { session, game, clips }); }
    catch (e) { toast(e.message); btn.disabled = false; btn.textContent = 'Try again'; }
  };
  const makeBtn = label => { const b = h('button', { class: 'ghost sm' }, label); b.onclick = () => make(b); return b; };
  const busy = file && ['queued', 'processing'].includes(file.status);
  box.hidden = !file && !sup;
  if (box.hidden) return;
  fill(box, h('h3', {}, 'Video file'),
    !file ? [h('p', { class: 'muted small' }, `Joins the ${clips} highlight${clips === 1 ? '' : 's'} into one video to download and share. It takes a few minutes.`), makeBtn('Make video file')]
      : busy ? [h('p', {}, file.status === 'queued' ? 'Starting…' : `Making it… ${Math.round((file.progress ?? 0) * 100)}%`), h('progress', { max: 1, value: file.progress ?? 0 })]
        : file.status === 'failed' ? [h('p', { class: 'warn' }, `It couldn't be made: ${file.error ?? 'something went wrong'}`), sup && makeBtn('Try again')]
          : [h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;align-items:center' },
            file.url && h('a', { class: 'button', href: file.url, download: '' }, '⬇ Download video'),
            !file.current && h('span', { class: 'muted small' }, 'Highlights have changed since it was made.'),
            sup && !file.current && makeBtn('Make it again'))]);
  if (busy) poll = setTimeout(async () => {
    if (!box.isConnected) return;
    try { paintFile(box, (await callFn('highlights', { action: 'reel', session, game })).file, { session, game, clips }); }
    catch { poll = setTimeout(() => paintFile(box, file, { session, game, clips }), 10000); }
  }, 5000);
}

