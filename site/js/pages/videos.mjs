// Videos page: watch uploaded game videos (supabase/video.sql, netlify/functions/video.mjs). Organizers and the super
// see every game's; a player sees the games they played in. Each video has its rally times, so you can jump from rally
// to rally and skip the time between. The super can go from here to tagging the game.
import { ask, callFn, h, me, pageHead, q, sb, toast } from '../ui.mjs';
import { jumpTo, rallyAt } from '../rallytimes.mjs';
import { openTagging } from './scores.mjs';
import { matchFiles, numbered, problems } from '../bulkmatch.mjs';
import { uploadVideo } from '../upload.mjs';

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
  const bulkBox = me.role === 'super' ? bulkCard() : null;
  if (!videos.length) return h('div', {}, head, bulkBox, h('div', { class: 'card empty' },
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
  return h('div', {}, head, bulkBox, watch, list, consent);
}

// ---------- Upload several (super) ----------
// Kept while moving between pages: the uploads carry on, and coming back shows where they are.
const bulk = { rows: null, games: null, running: false, stop: false, current: null, card: null };
const pct = v => `${Math.round((v ?? 0) * 100)}%`;

function bulkCard() {
  bulk.card = h('div', { class: 'card bulk' });
  paintBulk();
  return bulk.card;
}

async function pickFiles(files) {
  try {
    const gs = await q(sb.from('games').select('id,session_id,created_at,score_a,score_b,video_kind,video_ref,sessions(played_on)'));
    bulk.games = numbered(gs.map(g => ({ ...g, played_on: g.sessions?.played_on ?? '' })));
  } catch (e) { return toast(e.message); }
  bulk.rows = matchFiles(files, bulk.games).map(m => ({ ...m, state: 'waiting', progress: 0, skip: false }));
  paintBulk();
}

function paintBulk() {
  const card = bulk.card;
  if (!card) return;
  const picker = h('input', { type: 'file', accept: 'video/*', multiple: true, hidden: true });
  picker.onchange = () => { const files = [...picker.files]; picker.value = ''; if (files.length) pickFiles(files); };
  if (!bulk.rows) return card.replaceChildren(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px 14px' },
    h('div', { class: 'grow' }, h('b', {}, 'Upload several videos'),
      h('p', { class: 'muted small', style: 'margin:4px 0 0' }, 'Pick them all at once. Videos of games you tagged from a file are matched to their game by name; pick the game for the rest. They upload one after another, and each is analysed as soon as it lands.')),
    h('button', { class: 'sm', onclick: () => picker.click() }, 'Pick videos'), picker));

  const byId = new Map(bulk.games.map(g => [g.id, g]));
  const days = [...new Set(bulk.games.map(g => g.played_on))];
  const issues = bulk.running ? [] : problems(bulk.rows, bulk.games);
  const live = bulk.rows.filter(r => !r.skip && r.state !== 'done');
  const note = r => r.skip ? 'Skipped'
    : r.state === 'uploading' ? `Uploading · ${pct(r.progress)}`
    : r.state === 'done' ? 'Uploaded · being analysed (you\'ll get an email)'
    : r.state === 'failed' ? `Stopped: ${r.error}`
    : r.how === 'name' ? 'Matched by file name' : r.how === 'day' ? 'The only game that day without a video' : '';
  const rowEl = r => {
    const locked = bulk.running || r.state !== 'waiting' && r.state !== 'failed';
    const sel = h('select', { 'aria-label': `Game for ${r.file.name}`, disabled: locked || r.skip },
      h('option', { value: '' }, 'Pick a game…'),
      days.map(d => h('optgroup', { label: day(d) }, bulk.games.filter(g => g.played_on === d).map(g =>
        h('option', { value: g.id, selected: g.id === r.game }, `Game ${g.n} · ${g.score_a}–${g.score_b}${g.video_kind === 'upload' ? ' · has a video' : ''}`)))));
    sel.onchange = () => { r.game = sel.value ? Number(sel.value) : null; r.how = null; paintBulk(); };
    const skip = h('input', { type: 'checkbox', checked: r.skip, disabled: locked });
    skip.onchange = () => { r.skip = skip.checked; paintBulk(); };
    r.noteEl = h('span', { class: `small ${r.state === 'failed' ? 'warn-text' : 'muted'}` }, note(r));
    r.barEl = r.state === 'uploading' ? h('progress', { max: 1, value: r.progress }) : null;
    return h('li', { class: r.skip ? 'skipped' : null },
      h('div', { class: 'bulk-file' }, h('b', { class: 'small' }, r.file.name), h('span', { class: 'muted small' }, `${(r.file.size / 1024 ** 3).toFixed(1)} GB`)),
      sel, h('label', { class: 'small bulk-skip' }, skip, ' Skip'),
      h('div', { class: 'bulk-note' }, r.barEl, r.noteEl));
  };
  const start = async () => {
    const replacing = live.filter(r => byId.get(r.game)?.video_kind === 'upload').length;
    if (replacing && !await ask('Replace videos?', `${replacing} of these game${replacing === 1 ? ' has' : 's have'} an uploaded video already. It's replaced by the new one.`, 'Replace', '')) return;
    bulk.running = true; bulk.stop = false; paintBulk();
    for (const r of bulk.rows) {
      if (bulk.stop) break;
      if (r.skip || r.state === 'done') continue;
      r.state = 'uploading'; r.progress = 0; r.error = null; paintBulk();
      try {
        bulk.current = uploadVideo(r.game, r.file);
        const off = bulk.current.on(u => {
          r.progress = u.progress;
          if (r.barEl) r.barEl.value = u.progress;
          if (r.noteEl) r.noteEl.textContent = note(r);
        });
        await bulk.current.done; off();
        r.state = 'done';
      } catch (e) {
        r.state = e.cancelled ? 'waiting' : 'failed'; r.error = e.message;
      }
      bulk.current = null; paintBulk();
    }
    bulk.running = false; paintBulk();
    const done = bulk.rows.filter(r => r.state === 'done').length;
    if (!bulk.stop) toast(`${done} uploaded. You'll get an email as each one is analysed.`);
  };
  const stop = async () => {
    if (!await ask('Stop uploading?', 'The video uploading now is cancelled; the ones already uploaded carry on being analysed.', 'Stop')) return;
    bulk.stop = true; bulk.current?.cancel();
  };
  card.replaceChildren(
    h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;margin-bottom:10px' },
      h('b', { class: 'grow' }, 'Upload several videos'),
      bulk.running ? h('span', { class: 'muted small' }, 'Keep this page open and the computer awake') : null,
      bulk.running ? h('button', { class: 'ghost sm', onclick: stop }, 'Stop')
        : h('button', { class: 'ghost sm', onclick: () => { bulk.rows = null; paintBulk(); } }, 'Clear')),
    h('ul', { class: 'bulk-list' }, bulk.rows.map(rowEl)),
    issues.length ? h('ul', { class: 'small warn-text bulk-issues' }, issues.map(t => h('li', {}, t))) : null,
    !bulk.running && h('div', { class: 'row', style: 'gap:8px;margin-top:10px' },
      h('button', { onclick: start, disabled: !!issues.length || !live.length }, live.length ? `Upload ${live.length} video${live.length === 1 ? '' : 's'}` : 'All uploaded'),
      h('button', { class: 'ghost sm', onclick: () => picker.click() }, 'Pick other videos'), picker));
}
