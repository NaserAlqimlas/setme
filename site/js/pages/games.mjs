// Games page: game days and their games, and for each game on one page its video, its tagged stats (team numbers
// and a box score with everyone's line) and your own. Organizers and the super see every game; a player sees the
// games they played in, on published game days (netlify/functions/game-view.mjs). The super also uploads videos
// here (Upload several) and can go from a game to tagging it.
import { ask, callFn, fill, h, me, pageHead, q, sb, bigVideoButton, isBigVideo, spinner, TEAM_COLORS, toast, withSpinner } from '../ui.mjs';
import { jumpTo, playAt, rallyAt } from '../rallytimes.mjs';
import { ACTIONS, bestPlayers, fromRows, gradeLabel, recap, tally, teamSummary } from '../stats.mjs';
import { matchFiles, numbered, problems } from '../bulkmatch.mjs';
import { trayDrop, trayPut, uploadVideo } from '../upload.mjs';
import { openTagging } from './scores.mjs';
import { dayTitle } from './teams.mjs';
import { gameLine } from './club.mjs';
import { searchDays, toTag } from '../gamesearch.mjs';

let openGame = null;   // the game shown, kept while moving between pages
let showAllToTag = false;   // the super's to-tag list, opened past its first few
let query = '';        // what's typed in the search box, kept the same way
const clock = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const color = k => TEAM_COLORS[(k - 1) % TEAM_COLORS.length];
const day = d => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

export async function gamesPage() {
  const wrap = h('div');
  const bulkBox = me.role === 'super' ? bulkCard() : null;
  const head = pageHead('Games', me.role === 'player' ? 'Your games: the video, the stats, and how you did.' : 'Every game: the video and the tagged stats.');
  let data;
  try { data = await callFn('game-view', { action: 'days' }); }
  catch (e) { return h('div', {}, head, bulkBox, h('p', { class: 'warn' }, e.message)); }
  const consent = h('p', { class: 'muted small' }, 'Some games are filmed so the club can review them. ',
    'Only organizers and the players in a game can watch its video and see its stats. Rather not be filmed? Tell an organizer.');
  const all = data.days.flatMap(d => d.games.map(g => ({ ...g, played_on: d.played_on })));
  const open = id => { openGame = id; show(); scrollTo(0, 0); };
  // Only the list is redrawn while typing, so the search box keeps its place and focus.
  const list = h('div');
  const paintList = () => {
    const found = searchDays(data.days, query), n = found.reduce((t, d) => t + d.games.length, 0);
    fill(list, query.trim() && h('p', { class: 'muted small', role: 'status' }, n ? `${n} game${n === 1 ? '' : 's'} found` : ''),
      found.length ? found.map(d => dayCard(d, open))
        : h('div', { class: 'card empty' }, 'No games match that. Try a first name, a date like "nov 10", or video, tagged or untagged.'));
  };
  const search = h('input', { type: 'search', class: 'gd-search', placeholder: 'Search: a name, a date like "nov 10", video, tagged…', 'aria-label': 'Search games', value: query });
  search.oninput = () => { query = search.value; paintList(); };
  const show = () => {
    const g = all.find(x => x.id === openGame);
    if (g) return fill(wrap, gameView(g, () => { openGame = null; show(); scrollTo(0, 0); }));
    if (!data.days.length) return fill(wrap, head, bulkBox, h('div', { class: 'card empty' }, me.role === 'player' ? 'No games yet. Games you play show up here once the organizers publish the day.' : 'No games yet.'), consent);
    paintList();
    fill(wrap, head, bulkBox, me.role === 'super' && toTagCard(data.days), search, list, consent);
  };
  show();
  return wrap;
}

// The super's list of games still to tag, to work through. Each opens the tag screen; a game nobody filmed can be
// marked not recorded, which takes it off the list (and can be put back).
let showUnrecorded = false;
function toTagCard(days) {
  const FEW = 5, card = h('div', { class: 'card' });
  const all = () => days.flatMap(d => d.games.map(g => ({ ...g, played_on: d.played_on })));
  const mark = async (g, value) => {
    const { error } = await sb.from('games').update({ not_recorded: value }).eq('id', g.id);
    if (error) return toast(/not_recorded/.test(error.message) ? 'This needs the database upgrade first: run supabase/not_recorded.sql in the Supabase SQL Editor.' : error.message);
    for (const d of days) for (const x of d.games) if (x.id === g.id) x.not_recorded = value;
    toast(value ? `Game ${g.n} on ${day(g.played_on)} marked not recorded` : `Game ${g.n} on ${day(g.played_on)} is back on the list`);
    paint();
  };
  const line = (g, ...end) => h('span', { class: 'gd-score' },
    h('span', { style: `--tc:${color(g.a.k)}` }, g.a.name), h('b', {}, ` ${g.a.score}–${g.b.score} `), h('span', { style: `--tc:${color(g.b.k)}` }, g.b.name), ...end);
  const paint = () => {
    const games = toTag(days), off = all().filter(g => g.not_recorded && !g.tagged);
    const shown = showAllToTag ? games : games.slice(0, FEW);
    fill(card, h('div', { class: 'row', style: 'justify-content:space-between;align-items:baseline' },
        h('h3', {}, 'To tag'), games.length > 0 && h('span', { class: 'muted small' }, `${games.length} game${games.length === 1 ? '' : 's'} left`)),
      games.length ? h('ul', { class: 'gd-games' }, shown.map(g => h('li', { class: 'gd-totag' },
        h('button', { type: 'button', class: 'gd-game', onclick: () => openTagging(g.played_on, g.id) },
          h('span', { class: 'muted small gd-n' }, `${day(g.played_on)} · Game ${g.n}`), line(g),
          h('span', { class: 'gd-tags' }, g.video ? h('span', { class: 'chip plain' }, '▶ Video') : h('span', { class: 'muted small' }, 'No video'),
            h('span', { class: 'chip plain' }, 'Tag →'))),
        !g.video && h('button', { type: 'button', class: 'ghost sm', title: 'Nobody filmed this game, so it can\'t be tagged. Takes it off this list.', onclick: () => mark(g, true) }, 'Not recorded'))))
        : h('p', { class: 'muted' }, 'Every game is tagged.'),
      games.length > FEW && h('button', { class: 'ghost sm', style: 'margin-top:8px', onclick: () => { showAllToTag = !showAllToTag; paint(); } },
        showAllToTag ? 'Show fewer' : `Show all ${games.length}`),
      off.length > 0 && h('div', { class: 'gd-unrec' },
        h('button', { type: 'button', class: 'ghost sm', 'aria-expanded': String(showUnrecorded), onclick: () => { showUnrecorded = !showUnrecorded; paint(); } },
          `${showUnrecorded ? '▾' : '▸'} Not recorded (${off.length})`),
        showUnrecorded && h('ul', { class: 'gd-games' }, off.map(g => h('li', { class: 'gd-totag' },
          h('div', { class: 'gd-game static' }, h('span', { class: 'muted small gd-n' }, `${day(g.played_on)} · Game ${g.n}`), line(g)),
          h('button', { type: 'button', class: 'ghost sm', onclick: () => mark(g, false) }, 'Put back'))))));
  };
  paint();
  return card;
}

function dayCard(d, open) {
  return h('div', { class: 'card' }, h('h3', {}, dayTitle(d.played_on)),
    h('ul', { class: 'gd-games' }, d.games.map(g => {
      const res = g.mine && (g[g.mine].score > g[g.mine === 'a' ? 'b' : 'a'].score ? 'Won' : g[g.mine].score < g[g.mine === 'a' ? 'b' : 'a'].score ? 'Lost' : 'Tied');
      return h('li', {}, h('button', { type: 'button', class: 'gd-game', onclick: () => open(g.id) },
        h('span', { class: 'muted small gd-n' }, `Game ${g.n}`),
        h('span', { class: 'gd-score' },
          h('span', { style: `--tc:${color(g.a.k)}`, class: g.mine === 'a' ? 'mine' : null }, g.a.name), h('b', {}, ` ${g.a.score}–${g.b.score} `),
          h('span', { style: `--tc:${color(g.b.k)}`, class: g.mine === 'b' ? 'mine' : null }, g.b.name)),
        h('span', { class: 'gd-tags' }, res && h('span', { class: `chip plain ${res === 'Won' ? 'won' : ''}` }, res),
          g.video && h('span', { class: 'chip plain' }, '▶ Video'),
          g.tagged ? h('span', { class: 'chip plain' }, 'Stats') : g.not_recorded ? h('span', { class: 'muted small' }, 'Not recorded') : null)));
    })));
}

// One game: video and rallies on the left, the numbers on the right (stacked on a phone).
function gameView(g, back) {
  const left = h('div', { class: 'gd-left' }, h('div', { class: 'card' }, spinner('Loading the game…')));
  const right = h('div', { class: 'gd-right' });
  const view = h('div', { class: `gd-view${isBigVideo() ? ' big' : ''}` },
    h('div', { class: 'card gd-top' },
      h('button', { class: 'ghost sm', onclick: back }, '← Games'),
      h('div', { class: 'grow' }, h('h3', { style: 'margin:0' }, `Game ${g.n} · ${day(g.played_on)}`),
        h('div', { class: 'gd-score big' },
          h('span', { style: `--tc:${color(g.a.k)}` }, g.a.name, ' ', h('b', {}, String(g.a.score))), h('span', { class: 'muted' }, ' – '),
          h('span', { style: `--tc:${color(g.b.k)}` }, h('b', {}, String(g.b.score)), ' ', g.b.name))),
      me.role === 'super' && h('button', { class: 'ghost sm', onclick: () => openTagging(g.played_on, g.id) }, 'Tag this game')),
    h('div', { class: 'gd-cols' }, left, right));
  load();
  return view;

  async function load() {
    let d;
    try { d = await callFn('game-view', { action: 'game', game: g.id }); }
    catch (e) { return fill(left, h('p', { class: 'warn' }, e.message)); }
    const rallies = fromRows(d.rallies ?? []);
    const game = { team_a: g.a.k, team_b: g.b.k, players_a: g.a.players.map(p => p.id), players_b: g.b.players.map(p => p.id), score_a: g.a.score, score_b: g.b.score };
    const name = new Map([...g.a.players, ...g.b.players].map(p => [p.id, p.name]));
    const side = { a: g.a, b: g.b };

    // ----- video -----
    let video = null;
    const videoCard = h('div', { class: 'card' });
    if (d.video?.url) {
      video = h('video', { controls: true, playsinline: true, preload: 'metadata', src: d.video.url });
      // Next rally: the times the video analysis found, or else where the tagged rallies start.
      const times = (d.video.rallies?.length ? d.video.rallies : rallies.filter(r => r.t != null).map(r => ({ start: Math.max(0, r.t - 2), end: r.t + 8 })))
        .map(r => ({ start: r.start, end: r.end })).sort((a, b) => a.start - b.start);
      const where = h('span', { class: 'muted small' });
      const go = dir => { const i = jumpTo(times, video.currentTime, dir); if (i < 0) return toast(dir > 0 ? 'That was the last rally' : 'That was the first rally'); playAt(video, times[i].start); };
      video.addEventListener('timeupdate', () => { const at = rallyAt(times, video.currentTime); where.textContent = times.length ? (at >= 0 ? `Rally ${at + 1} of ${times.length}` : `${times.length} rallies`) : ''; });
      const keys = e => {
        if (!video.isConnected) return document.removeEventListener('keydown', keys);
        if (e.key.toLowerCase() === 'n' && times.length && !e.metaKey && !e.ctrlKey && !e.target.closest('input, select, textarea')) { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
      };
      document.addEventListener('keydown', keys);
      const full = () => (video.requestFullscreen?.() ?? video.webkitRequestFullscreen?.() ?? video.webkitEnterFullscreen?.())?.catch?.(() => {});
      fill(videoCard, h('div', { class: 'video-frame' }, withSpinner(video), bigVideoButton(view)), h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;margin-top:10px' },
        times.length && h('button', { class: 'ghost sm', onclick: () => go(-1) }, '◀ Previous rally'), times.length && h('button', { class: 'ghost sm', onclick: () => go(1) }, 'Next rally ▶'), times.length && where,
        h('span', { class: 'grow' }),
        h('button', { class: 'ghost sm', onclick: full }, '⛶ Full screen')),
        times.length && h('p', { class: 'muted small', style: 'margin:6px 0 0' }, 'Keys: N next rally · Shift N back'));
    } else fill(videoCard, h('p', { class: 'muted' }, 'No video of this game.'));
    const seek = t => { if (!video || t == null) return; playAt(video, t - 2); video.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };

    // ----- rallies -----
    const done = rallies.filter(r => r.won);
    const lastTouch = r => { const t = r.touches.at(-1); return t ? `${name.get(t.p) ?? 'Someone'} ${ACTIONS[t.a]?.label.toLowerCase() ?? t.a} ${gradeLabel(t.a, t.g).toLowerCase()}` : ''; };
    const rallyCard = done.length ? h('div', { class: 'card' }, h('h3', {}, 'Rallies'),
      h('p', { class: 'muted small' }, video ? 'Tap a rally to watch it.' : 'How each point ended.'),
      h('ol', { class: 'gd-rallies' }, done.map((r, i) => h('li', {}, h('button', { type: 'button', disabled: !video || r.t == null, onclick: () => seek(r.t) },
        h('span', { class: 'muted small' }, `${i + 1}`), r.t != null && video ? h('span', { class: 'small' }, `▶ ${clock(r.t)}`) : null,
        h('span', { class: 'chip plain point', style: `--tc:${color(side[r.won].k)}` }, side[r.won].name),
        h('span', { class: 'small muted grow' }, lastTouch(r))))))) : null;
    fill(left, videoCard, rallyCard);

    // ----- the numbers -----
    if (!done.length) return fill(right, h('div', { class: 'card' }, h('h3', {}, 'Stats'), h('p', { class: 'muted' }, 'This game hasn\'t been tagged yet, so there are no stats for it.')));
    const ts = teamSummary(rallies, game);
    const teamRow = s => h('tr', {}, h('th', { scope: 'row', style: `--tc:${color(side[s].k)}`, class: 'gd-team' }, side[s].name),
      h('td', { class: 'num' }, ts[s].sideOutRate == null ? '—' : `${Math.round(ts[s].sideOutRate * 100)}%`),
      ...['aces', 'kills', 'stuffs', 'errors'].map(k => h('td', { class: 'num' }, String(ts[s][k]))));
    const teams = h('div', { class: 'card' }, h('h3', {}, 'Teams'),
      h('div', { class: 'scroll' }, h('table', { class: 'gd-table' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), ...['Side-out', 'Aces', 'Kills', 'Blocks', 'Errors'].map(t => h('th', { class: 'num' }, t)))),
        h('tbody', {}, teamRow('a'), teamRow('b')))),
      h('p', { class: 'muted small' }, 'Side-out: how often a team won the point when the other team served. Errors: points given away.'));

    const box = recap([{ game, rallies }]).players;
    const mineId = Number(me.player_id);
    const head = ['Points', 'Kills', 'Aces', 'Serves in', 'Good passes', 'Blocks', 'Digs', 'Sets'];
    const cells = p => [p.points, p.attacks ? `${p.kills}/${p.attacks}` : '—', p.aces, p.serves ? `${p.servesIn}/${p.serves}` : '—', p.passes ? `${p.passesGood}/${p.passes}` : '—', p.blocks, p.digs, p.sets];
    // Stars: each team's best game, gold on the side that won and silver on the side that lost (silver both, if tied).
    const best = bestPlayers(game, rallies), won = g.a.score > g.b.score ? 'a' : g.b.score > g.a.score ? 'b' : null;
    const star = s => {
      const gold = s === won;
      const what = `Best game on ${won ? (gold ? 'the winning' : 'the losing') : 'their'} team`;
      return h('span', { class: `gd-star ${gold ? 'gold' : 'silver'}`, title: what, 'aria-label': what, role: 'img' }, '★');
    };
    // Each team's players under a heading in its colour, so the two teams read apart.
    const teamHead = s => h('tr', { class: 'gd-teamhead', style: `--tc:${color(side[s].k)}` },
      h('th', { colspan: head.length + 1, scope: 'rowgroup' }, h('span', { class: 'gd-teamname' }, side[s].name),
        h('span', { class: 'muted small' }, ` ${side[s].score}${won ? (won === s ? ' · Won' : ' · Lost') : ' · Tied'}`)));
    const boxRows = s => box.filter(p => game[`players_${s}`].includes(p.pid)).map(p => h('tr', { class: p.pid === mineId ? 'mine' : null },
      h('th', { scope: 'row', style: `--tc:${color(side[s].k)}`, class: 'gd-team' }, name.get(p.pid) ?? 'Someone', best[s].includes(p.pid) ? star(s) : null,
        p.pid === mineId ? h('span', { class: 'muted small' }, ' (you)') : null),
      ...cells(p).map(v => h('td', { class: 'num' }, String(v)))));
    const players = h('div', { class: 'card' }, h('h3', {}, 'Players'),
      h('div', { class: 'scroll' }, h('table', { class: 'gd-table' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), ...head.map(t => h('th', { class: 'num' }, t)))),
        h('tbody', {}, teamHead('a'), boxRows('a'), teamHead('b'), boxRows('b')))),
      (best.a.length || best.b.length) > 0 && h('p', { class: 'muted small gd-star-note' },
        won ? [h('span', { class: 'gd-star gold', 'aria-hidden': 'true' }, '★'), ' Best game on the winning team · ', h('span', { class: 'gd-star silver', 'aria-hidden': 'true' }, '★'), ' best on the losing team. ']
          : [h('span', { class: 'gd-star silver', 'aria-hidden': 'true' }, '★'), ' Best game on each team. '],
        'Best: points scored, minus errors, plus half a point for each good pass, dig or set. Players level on that share the star.'),
      h('p', { class: 'muted small' }, 'Points: kills, aces and blocks. Good passes: passes graded 2 or 3. Only the organizers and the players in this game see this.'));

    const mineTally = Number.isInteger(mineId) && game.players_a.concat(game.players_b).includes(mineId) ? tally([{ game, rallies }]).get(mineId) : null;
    const you = mineTally && h('div', { class: 'card gd-you' }, h('h3', {}, 'Your game'), h('p', {}, gameLine(mineTally.counts)),
      h('p', { class: 'muted small' }, h('a', { href: `#player/${mineId}` }, 'All your stats on Me →')));
    fill(right, you, teams, players);
  }
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

// add: put these files on the list as well (a file already on it is left as it is), instead of starting again.
async function pickFiles(files, add = false) {
  try {
    const gs = await q(sb.from('games').select('id,session_id,created_at,score_a,score_b,video_kind,video_ref,sessions(played_on)'));
    bulk.games = numbered(gs.map(g => ({ ...g, played_on: g.sessions?.played_on ?? '' })));
  } catch (e) { return toast(e.message); }
  const same = (a, b) => a.name === b.name && a.size === b.size;
  const kept = add && bulk.rows ? bulk.rows : [];
  const fresh = files.filter(f => !kept.some(r => same(r.file, f)));
  const matched = matchFiles([...kept.map(r => r.file), ...fresh], bulk.games).slice(kept.length);
  const taken = new Set(kept.filter(r => !r.skip).map(r => r.game));
  bulk.rows = [...kept, ...matched.map(m => ({ ...(taken.has(m.game) ? { ...m, game: null, how: null } : m), state: 'waiting', progress: 0, skip: false }))];
  paintBulk();
}

function paintBulk() {
  const card = bulk.card;
  if (!card) return;
  const picker = h('input', { type: 'file', accept: 'video/*', multiple: true, hidden: true });
  picker.onchange = () => { const files = [...picker.files]; picker.value = ''; if (files.length) pickFiles(files, !!bulk.rows); };
  if (!bulk.rows) return card.replaceChildren(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px 14px' },
    h('div', { class: 'grow' }, h('b', {}, 'Upload several videos'),
      h('p', { class: 'muted small', style: 'margin:4px 0 0' }, 'Select several at once (hold Cmd and click, or Cmd+A for a whole folder). Videos of games you tagged from a file are matched to their game by name; pick the game for the rest. They upload one after another, and each is analysed as soon as it lands.')),
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
    // The upload panel lists the ones waiting too; Stop there takes one off the list.
    for (const r of live) trayPut(r.game, { name: r.file.name, size: r.file.size, state: 'waiting', progress: 0, error: null,
      stop: () => { r.skip = true; trayDrop(r.game); paintBulk(); } });
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
    for (const r of bulk.rows) if (r.state === 'waiting') trayDrop(r.game);   // stopped before their turn
    const done = bulk.rows.filter(r => r.state === 'done').length;
    if (!bulk.stop) toast(`${done} uploaded. You'll get an email as each one is analysed.`);
  };
  const stop = async () => {
    if (!await ask('Stop uploading?', 'The video uploading now is cancelled; the ones already uploaded carry on being analysed.', 'Stop')) return;
    bulk.stop = true;
    for (const r of bulk.rows) if (r.state === 'waiting') trayDrop(r.game);
    bulk.current?.cancel();
  };
  fill(card,
    h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;margin-bottom:10px' },
      h('b', { class: 'grow' }, 'Upload several videos'),
      bulk.running ? h('span', { class: 'muted small' }, 'Keep this tab open; you can use the rest of SetMe') : null,
      bulk.running ? h('button', { class: 'ghost sm', onclick: stop }, 'Stop')
        : h('button', { class: 'ghost sm', onclick: () => { bulk.rows = null; paintBulk(); } }, 'Clear')),
    h('ul', { class: 'bulk-list' }, bulk.rows.map(rowEl)),
    issues.length ? h('ul', { class: 'small warn-text bulk-issues' }, issues.map(t => h('li', {}, t))) : null,
    !bulk.running && h('div', { class: 'row', style: 'gap:8px;margin-top:10px' },
      h('button', { onclick: start, disabled: !!issues.length || !live.length }, live.length ? `Upload ${live.length} video${live.length === 1 ? '' : 's'}` : 'All uploaded'),
      h('button', { class: 'ghost sm', onclick: () => picker.click() }, 'Add more videos'), picker));
}
