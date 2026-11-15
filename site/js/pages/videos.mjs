// Videos page: watch uploaded game videos (supabase/video.sql, netlify/functions/video.mjs). Organizers and the super
// see every game's; a player sees the games they played in. Each video has its rally times, so you can jump from rally
// to rally and skip the time between. The super can go from here to tagging the game.
import { callFn, h, me, pageHead, toast } from '../ui.mjs';
import { jumpTo, rallyAt } from '../rallytimes.mjs';
import { openTagging } from './scores.mjs';

let picked = null;   // the game being watched, kept while moving between pages
const clock = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const day = d => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

export async function videosPage() {
  const { videos } = await callFn('video', { action: 'list' }).catch(e => {
    if (/database upgrade|set up yet/.test(e.message) && me.role !== 'super') return { videos: [] };
    throw e;
  });
  const consent = h('p', { class: 'muted small' }, 'Some games are filmed so the club can review them. ',
    me.role === 'player' ? 'Only organizers and the players in a game can watch its video.' : 'Organizers see every game\'s video; players see only games they played in.',
    ' Rather not be filmed? Tell an organizer.');
  const head = pageHead('Videos', me.role === 'player' ? 'Your games on video.' : 'Games on video. Tap one to watch it.');
  if (!videos.length) return h('div', {}, head, h('div', { class: 'card empty' },
    me.role === 'player' ? 'No videos of your games yet. When a game you played in is filmed, it shows up here.'
      : me.role === 'super' ? 'No videos yet. On Scores, open a game\'s Tag screen and tap Upload for analysis.' : 'No videos yet.'), consent);

  if (!videos.some(v => v.game === picked)) picked = videos[0].game;
  const watch = h('div', { class: 'card video-watch' });
  const list = h('ul', { class: 'video-list' });
  let stop = () => {};

  const paintList = () => list.replaceChildren(...videos.map(v => h('li', {}, h('button', { type: 'button', 'aria-current': String(v.game === picked), onclick: () => { picked = v.game; paintList(); show(v); } },
    h('b', {}, `Game ${v.n} · ${day(v.played_on)}`),
    h('span', { class: 'muted small' }, `${v.score_a}–${v.score_b}${v.rallies ? ` · ${v.rallies} rallies` : ''}`),
    h('span', { class: 'vs' }, `${v.a.join(', ')}  v  ${v.b.join(', ')}`)))));

  const show = async v => {
    stop();
    watch.replaceChildren(h('p', { class: 'empty' }, 'Loading…'));
    let w;
    try { w = await callFn('video', { action: 'watch', game: v.game }); } catch (e) { return watch.replaceChildren(h('p', { class: 'warn' }, e.message)); }
    if (!w.url) return watch.replaceChildren(h('p', { class: 'muted' }, 'This video isn\'t ready yet.'));
    const video = h('video', { controls: true, playsinline: true, preload: 'metadata', src: w.url });
    const rallies = (w.rallies ?? []).slice().sort((a, b) => a.start - b.start);
    const chips = h('div', { class: 'video-rallies' });
    const where = h('span', { class: 'muted small' });
    const go = dir => {
      const i = jumpTo(rallies, video.currentTime, dir);
      if (i < 0) return toast(dir > 0 ? 'That was the last rally' : 'That was the first rally');
      video.currentTime = rallies[i].start; video.play();
    };
    const paintAt = () => {
      const at = rallyAt(rallies, video.currentTime);
      where.textContent = rallies.length ? (at >= 0 ? `Rally ${at + 1} of ${rallies.length}` : `${rallies.length} rallies`) : '';
      chips.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-current', String(i === at)));
    };
    chips.append(...rallies.map((r, i) => h('button', { type: 'button', class: 'ghost sm', title: `Rally ${i + 1} at ${clock(r.start)}`,
      onclick: () => { video.currentTime = r.start; video.play(); } }, String(i + 1))));
    video.addEventListener('timeupdate', paintAt);
    const keys = e => {
      if (!video.isConnected) return document.removeEventListener('keydown', keys);
      if (e.target.closest('input, select, textarea, button') && e.key === ' ') return;
      if (e.key.toLowerCase() === 'n' && rallies.length && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
    };
    document.addEventListener('keydown', keys);
    stop = () => { document.removeEventListener('keydown', keys); video.pause(); video.removeAttribute('src'); video.load(); };
    watch.replaceChildren(
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;margin-bottom:10px' },
        h('h3', { class: 'grow', style: 'margin:0' }, `Game ${v.n} · ${day(v.played_on)} · ${v.score_a}–${v.score_b}`),
        me.role === 'super' && h('button', { class: 'ghost sm', onclick: () => { stop(); openTagging(v.played_on, v.game); } }, 'Tag this game')),
      video,
      rallies.length ? h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;margin-top:10px' },
        h('button', { class: 'ghost sm', onclick: () => go(-1) }, '◀ Previous rally'),
        h('button', { class: 'ghost sm', onclick: () => go(1) }, 'Next rally ▶'), where,
        h('span', { class: 'muted small grow', style: 'text-align:right' }, 'N next rally · Shift N back')) : null,
      rallies.length ? chips : h('p', { class: 'muted small' }, 'No rally times for this video, so it plays straight through.'));
    paintAt();
  };

  paintList();
  show(videos.find(v => v.game === picked));
  return h('div', {}, head, watch, list, consent);
}
