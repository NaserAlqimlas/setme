// Games page: game days and their games, and for each game on one page its video, its tagged stats (team numbers
// and a box score with everyone's line) and your own. Organizers and the super see every game; players and raters see
// every game on published game days (netlify/functions/game-view.mjs). The super also uploads videos
// here (Upload several) and can go from a game to tagging it.
import { ask, callFn, fill, h, me, pageHead, q, render, sb, bigVideoButton, isBigVideo, spinner, TEAM_COLORS, toast, withSpinner } from '../ui.mjs';
import { jumpTo, playAt, rallyAt } from '../rallytimes.mjs';
import { ACTIONS, bestPlayers, FRONT_ROW, fromRows, gameDetail, gradeLabel, POSITIONS, positions, recap, rotations, serveCycle, tally, teamSummary } from '../stats.mjs';
import { matchFiles, numbered, problems } from '../bulkmatch.mjs';
import { trayDrop, trayPut, uploadVideo } from '../upload.mjs';
import { openTagging } from './scores.mjs';
import { dayTitle } from './teams.mjs';
import { gameLine } from './club.mjs';
import { searchDays, toTag } from '../gamesearch.mjs';
import { highlightBox, videoControl } from '../highlights.mjs';
import { moments } from '../suggest.mjs';

let openGame = null;   // the game shown, kept while moving between pages
let showAllToTag = false;   // the super's to-tag list, opened past its first few
let videoOnly = false;   // Games: only games with a video
let statsTab = 'teams';   // the team stats tab open on a game
let posPlayer = null;   // the player picked on the Positions tab
let query = '';        // what's typed in the search box, kept the same way
const clock = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const color = k => TEAM_COLORS[(k - 1) % TEAM_COLORS.length];
const day = d => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

export async function gamesPage() {
  const wrap = h('div');
  const bulkBox = me.role === 'super' ? bulkCard() : null;
  const head = pageHead('Games', me.role === 'player' ? 'Every game: the video, the stats, and how you did in yours.' : 'Every game: the video and the tagged stats.');
  let data;
  try { data = await callFn('game-view', { action: 'days' }); }
  catch (e) { return h('div', {}, head, bulkBox, h('p', { class: 'warn' }, e.message)); }
  const consent = h('p', { class: 'muted small' }, 'Some games are filmed so the club can review them. ',
    'Only organizers and the players in a game can watch its video and see its stats. Rather not be filmed? Tell an organizer.');
  const all = data.days.flatMap(d => d.games.map(g => ({ ...g, played_on: d.played_on, session_id: d.session_id })));
  const reels = data.highlights ?? {}, blooperReels = data.bloopers ?? {};
  const open = id => { openGame = id; show(); scrollTo(0, 0); };
  // Only the list is redrawn while typing, so the search box keeps its place and focus.
  const list = h('div');
  const paintList = () => {
    const found = searchDays(data.days, query).map(d => videoOnly ? { ...d, games: d.games.filter(g => g.video) } : d).filter(d => d.games.length);
    const n = found.reduce((t, d) => t + d.games.length, 0);
    fill(list, (query.trim() || videoOnly) && h('p', { class: 'muted small', role: 'status' }, n ? `${n} game${n === 1 ? '' : 's'} found` : ''),
      found.length ? found.map(d => dayCard(d, open, reels[d.session_id] ?? 0, blooperReels[d.session_id] ?? 0))
        : h('div', { class: 'card empty' }, videoOnly && !query.trim() ? 'No games have a video yet.' : 'No games match that. Try a first name, a date like "nov 10", or video, tagged or untagged.'));
  };
  const search = h('input', { type: 'search', class: 'gd-search', placeholder: 'Search: a name, a date like "nov 10", video, tagged…', 'aria-label': 'Search games', value: query });
  search.oninput = () => { query = search.value; paintList(); };
  const withVideo = h('input', { type: 'checkbox', checked: videoOnly });
  withVideo.onchange = () => { videoOnly = withVideo.checked; paintList(); };
  const filters = h('div', { class: 'gd-filters' }, search, h('label', { class: 'gd-filter' }, withVideo, ' ▶ With video only'));
  const show = () => {
    const g = all.find(x => x.id === openGame);
    if (g) return fill(wrap, gameView(g, () => { openGame = null; show(); scrollTo(0, 0); }));
    if (!data.days.length) return fill(wrap, head, bulkBox, h('div', { class: 'card empty' }, me.role === 'player' || me.role === 'rater' ? 'No games yet. Games show up here once the organizers publish the day.' : 'No games yet.'), consent);
    paintList();
    fill(wrap, head, bulkBox, me.role === 'super' && data.unscored > 0 && soundCard(data.unscored), me.role === 'super' && toTagCard(data.days), filters, list, consent);
  };
  show();
  return wrap;
}

// Videos uploaded before sound scores existed get no highlight suggestions until the worker scores their sound.
// The super starts that here, 25 at a time (a minute or two each, side by side).
function soundCard(n) {
  const btn = h('button', { class: 'ghost sm' }, 'Score them');
  const note = h('span', { class: 'muted small' }, `${n} older video${n === 1 ? ' has' : 's have'} no sound scores yet, so no highlight suggestions.`);
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const { started } = await callFn('video', { action: 'sound' });
      note.textContent = started ? `Scoring ${started} video${started === 1 ? '' : 's'}. It takes a few minutes; suggestions show on each game after that.` : 'Nothing to score right now.';
      btn.remove();
    } catch (e) { toast(e.message); btn.disabled = false; }
  };
  return h('div', { class: 'card row', style: 'flex-wrap:wrap;gap:8px;align-items:center' }, note, h('span', { class: 'grow' }), btn);
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

function dayCard(d, open, highlights = 0, bloopers = 0) {
  return h('div', { class: 'card' }, h('div', { class: 'gd-dayhead' }, h('h3', {}, dayTitle(d.played_on)),
      (highlights > 0 || bloopers > 0) && h('span', { class: 'gd-reels' },
        highlights > 0 && h('a', { class: 'chip plain gd-reel', href: `#reel/${d.session_id}` }, `★ Highlights (${highlights})`),
        bloopers > 0 && h('a', { class: 'chip plain gd-reel', href: `#bloopers/${d.session_id}` }, `🙈 Bloopers (${bloopers})`))),
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

// The super fixes a game entered wrong: which two of its round's teams played, and the score. The game takes those
// teams' lineups and is predicted again (as on Scores), then the page loads again with the fix.
function fixCard(g, fix, tagged, close) {
  const pick = (v, label) => h('select', { 'aria-label': label }, fix.teams.map(t => h('option', { value: t.k, selected: t.k === v }, t.name)));
  const num = (v, label) => h('input', { type: 'number', min: 0, max: 99, inputmode: 'numeric', class: 'score-in sm', value: v, 'aria-label': label });
  const ta = pick(g.a.k, 'First team'), tb = pick(g.b.k, 'Second team'), sa = num(g.a.score, 'First team score'), sB = num(g.b.score, 'Second team score');
  const save = h('button', { class: 'sm' }, 'Save');
  save.onclick = async () => {
    const a = Number(ta.value), b = Number(tb.value), A = Number(sa.value), B = Number(sB.value);
    if (a === b) return toast('Pick two different teams');
    if (sa.value === '' || sB.value === '' || ![A, B].every(v => Number.isInteger(v) && v >= 0 && v <= 99)) return toast('Scores are whole numbers from 0 to 99');
    if (A === B) return toast('A game can\'t end in a tie');
    const teamsChanged = a !== g.a.k || b !== g.b.k;
    if (!teamsChanged && A === g.a.score && B === g.b.score) return close();
    if (teamsChanged && tagged && !await ask(`Change game ${g.n}'s teams?`, `It has ${tagged} tagged rallies, tagged with the players saved now. Check its tags afterwards.`, 'Change teams')) return;
    save.disabled = true; save.textContent = 'Saving…';
    const upd = { score_a: A, score_b: B };
    if (teamsChanged) {
      const players_a = fix.teams[a - 1]?.ids ?? [], players_b = fix.teams[b - 1]?.ids ?? [], ids = [...players_a, ...players_b];
      const known = new Set(fix.all_game), noSet = fix.no_set ?? [];
      const allGame = [...known, ...ids.filter(id => !known.has(id) && !noSet.includes(id) && fix.middles.includes(id))];
      Object.assign(upd, { team_a: a, team_b: b, players_a, players_b, predicted: null });
      try {
        const p = await callFn('build-teams', { predict: true, teams: [players_a, players_b], raters: fix.raters, allGame, noSet });
        upd.predicted = { a: p.teams[0], b: p.teams[1] };
      } catch (e) { toast(`Saved without a prediction: ${e.message}`); }
    }
    try { await q(sb.from('games').update(upd).eq('id', g.id)); toast('Game fixed'); render(); }
    catch (e) { toast(e.message); save.disabled = false; save.textContent = 'Save'; }
  };
  return [h('h3', {}, `Fix game ${g.n}`),
    h('p', { class: 'muted small' }, 'Picked the wrong teams or typed a wrong score? Choose the teams that played and their score.'),
    h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;align-items:center' }, ta, sa, h('span', { class: 'muted' }, 'v'), sB, tb, save,
      h('button', { class: 'ghost sm', onclick: close }, 'Cancel'))];
}

// One game: video and rallies on the left, the numbers on the right (stacked on a phone).
function gameView(g, back) {
  const fix = h('div', { class: 'card', hidden: true }, spinner('Loading…'));
  const left = h('div', { class: 'gd-left' }, h('div', { class: 'card' }, spinner('Loading the game…')));
  const right = h('div', { class: 'gd-right' });
  const view = h('div', { class: `gd-view${isBigVideo() ? ' big' : ''}` },
    h('div', { class: 'card gd-top' },
      h('button', { class: 'ghost sm', onclick: back }, '← Games'),
      h('div', { class: 'grow' }, h('h3', { style: 'margin:0' }, `Game ${g.n} · ${day(g.played_on)}`),
        h('div', { class: 'gd-score big' },
          h('span', { style: `--tc:${color(g.a.k)}` }, g.a.name, ' ', h('b', {}, String(g.a.score))), h('span', { class: 'muted' }, ' – '),
          h('span', { style: `--tc:${color(g.b.k)}` }, h('b', {}, String(g.b.score)), ' ', g.b.name))),
      me.role === 'super' && h('button', { class: 'ghost sm', onclick: () => { fix.hidden = !fix.hidden; } }, 'Fix teams or score'),
      me.role === 'super' && h('button', { class: 'ghost sm', onclick: () => openTagging(g.played_on, g.id) }, 'Tag this game')),
    fix,
    h('div', { class: 'gd-cols' }, left, right));
  load();
  return view;

  async function load() {
    let d;
    try { d = await callFn('game-view', { action: 'game', game: g.id }); }
    catch (e) { return fill(left, h('p', { class: 'warn' }, e.message)); }
    if (d.fix) fill(fix, fixCard(g, d.fix, d.rallies?.length ?? 0, () => { fix.hidden = true; }));
    else fill(fix, h('p', { class: 'muted' }, 'This game can\'t be fixed here. Fix it on Scores.'));
    const rallies = fromRows(d.rallies ?? []);
    const game = { team_a: g.a.k, team_b: g.b.k, players_a: g.a.players.map(p => p.id), players_b: g.b.players.map(p => p.id), score_a: g.a.score, score_b: g.b.score,
      middle_set: !!d.middle?.set, middle_a: d.middle?.a ?? null, middle_b: d.middle?.b ?? null, joins: d.joins ?? [], rotation: d.rotation ?? null };
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
        times.length && h('p', { class: 'muted small', style: 'margin:6px 0 0' }, 'Keys: N next rally · Shift N back'),
        highlightBox(g, videoControl(video), () => times, d.highlights, {
          suggestions: () => ({ sound: d.video.sound, moments: moments(rallies, d.video.rallies ?? []), dismissed: d.dismissed }),
          nameOf: id => name.get(id) }));
    } else fill(videoCard, h('p', { class: 'muted' }, 'No video of this game.'));
    const seek = t => { if (!video || t == null) return; playAt(video, t - 2); video.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };

    // ----- rallies -----
    const done = rallies.filter(r => r.won);
    const lastTouch = r => { const t = r.touches.at(-1); return t ? `${name.get(t.p) ?? 'Someone'} ${ACTIONS[t.a]?.label.toLowerCase() ?? t.a} ${gradeLabel(t.a, t.g).toLowerCase()}` : ''; };
    // Pick a player to list only their touches, each one a jump into the video.
    let only = null;
    const rallyList = h('ol', { class: 'gd-rallies' }), rallyHint = h('p', { class: 'muted small' });
    const rallyRow = (i, t, body) => h('li', {}, h('button', { type: 'button', disabled: !video || t == null, onclick: () => seek(t) },
      h('span', { class: 'muted small' }, `${i + 1}`), t != null && video ? h('span', { class: 'small' }, `▶ ${clock(t)}`) : null, ...body));
    const paintRallies = () => {
      if (only == null) {
        rallyHint.textContent = video ? 'Tap a rally to watch it.' : 'How each point ended.';
        return fill(rallyList, done.map((r, i) => rallyRow(i, r.t, [
          h('span', { class: 'chip plain point', style: `--tc:${color(side[r.won].k)}` }, side[r.won].name),
          h('span', { class: 'small muted grow' }, lastTouch(r))])));
      }
      const rows = done.flatMap((r, i) => r.touches.filter(t => t.p === only).map(t => rallyRow(i, t.t ?? r.t, [
        h('span', { class: 'small grow' }, `${ACTIONS[t.a]?.label ?? t.a} ${gradeLabel(t.a, t.g).toLowerCase()}`),
        h('span', { class: 'chip plain point', style: `--tc:${color(side[r.won].k)}` }, side[r.won].name)])));
      const nr = done.filter(r => r.touches.some(t => t.p === only)).length, first = (name.get(only) ?? 'They').split(' ')[0];
      rallyHint.textContent = rows.length ? `${first}: ${rows.length} touch${rows.length === 1 ? '' : 'es'} in ${nr} rall${nr === 1 ? 'y' : 'ies'}.${video ? ' Tap one to watch it.' : ''}` : '';
      fill(rallyList, rows.length ? rows : h('li', { class: 'muted small' }, `${first} has no touches tagged in this game.`));
    };
    const picker = h('select', { 'aria-label': 'Show one player\'s touches', onchange: e => { only = e.target.value ? Number(e.target.value) : null; paintRallies(); } },
      h('option', { value: '' }, 'Everyone'),
      [g.a, g.b].map(t => h('optgroup', { label: t.name }, [...t.players].sort((x, y) => x.name.localeCompare(y.name)).map(p => h('option', { value: p.id }, p.name)))));
    if (done.length) paintRallies();
    const rallyCard = done.length ? h('div', { class: 'card' }, h('div', { class: 'rally-list-head' }, h('h3', {}, 'Rallies'), h('span', { class: 'rally-filter' }, picker)),
      rallyHint, rallyList) : null;
    fill(left, videoCard, rallyCard);

    // ----- the numbers -----
    if (!done.length) return fill(right, h('div', { class: 'card' }, h('h3', {}, 'Stats'), h('p', { class: 'muted' }, 'This game hasn\'t been tagged yet, so there are no stats for it.')));
    const ts = teamSummary(rallies, game), gd = gameDetail(rallies, game);
    const pc = v => v == null ? '—' : `${Math.round(v * 100)}%`;
    const signed = v => v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0';
    const teamRow = s => h('tr', {}, h('th', { scope: 'row', style: `--tc:${color(side[s].k)}`, class: 'gd-team' }, side[s].name),
      h('td', { class: 'num' }, pc(ts[s].sideOutRate)),
      h('td', { class: 'num' }, gd[s].pass.avg == null ? '—' : gd[s].pass.avg.toFixed(1)),
      h('td', { class: 'num' }, gd[s].attackEff == null ? '—' : gd[s].attackEff.toFixed(2).replace(/^(-?)0/, '$1')),
      ...['aces', 'kills', 'stuffs', 'errors'].map(k => h('td', { class: 'num' }, String(ts[s][k]))),
      h('td', { class: 'num' }, String(gd[s].run)));
    const teams = h('div', {},
      h('div', { class: 'scroll' }, h('table', { class: 'gd-table' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), ...['Side-out', 'Pass avg', 'Attack eff', 'Aces', 'Kills', 'Blocks', 'Errors', 'Best run'].map(t => h('th', { class: 'num' }, t)))),
        h('tbody', {}, teamRow('a'), teamRow('b')))),
      h('p', { class: 'muted small' }, 'Side-out: how often a team won the point when the other team served. Pass avg: serve receive, 0 to 3. ',
        'Attack eff: kills minus errors and blocked attacks, per attack. Errors: points given away. Best run: most points in a row.'));

    // Where each team's points came from, as a bar split by kind.
    const KINDS = [['kills', 'Kills'], ['aces', 'Aces'], ['blocks', 'Blocks'], ['errors', 'Their errors'], ['other', 'Not tagged']];
    const fromRow = s => {
      const f = gd[s].from, n = KINDS.reduce((t, [k]) => t + f[k], 0);
      return h('div', { class: 'gd-from' }, h('div', { class: 'gd-from-head' }, h('span', { class: 'gd-teamname', style: `--tc:${color(side[s].k)}` }, side[s].name), h('span', { class: 'muted small' }, `${n} point${n === 1 ? '' : 's'}`)),
        h('div', { class: 'gd-bar', role: 'img', 'aria-label': KINDS.filter(([k]) => f[k]).map(([k, l]) => `${l} ${f[k]}`).join(', ') },
          KINDS.filter(([k]) => f[k]).map(([k, l]) => h('span', { class: `gd-seg ${k}`, style: `flex:${f[k]}`, title: `${l}: ${f[k]}` }, String(f[k])))));
    };
    const used = KINDS.filter(([k]) => gd.a.from[k] || gd.b.from[k]);
    const points = h('div', {}, fromRow('a'), fromRow('b'),
      h('ul', { class: 'gd-legend small' }, used.map(([k, l]) => h('li', {}, h('i', { class: `gd-seg ${k}` }), l))));

    // Serve receive: does a good pass turn into the point?
    const recvRow = s => { const p = gd[s].pass; return h('tr', {}, h('th', { scope: 'row', style: `--tc:${color(side[s].k)}`, class: 'gd-team' }, side[s].name),
      h('td', { class: 'num' }, String(p.n)), h('td', { class: 'num' }, p.good ? `${pc(p.goodRate)} (${p.goodWon}/${p.good})` : '—'),
      h('td', { class: 'num' }, p.poor ? `${pc(p.poorRate)} (${p.poorWon}/${p.poor})` : '—')); };
    const receive = (gd.a.pass.n || gd.b.pass.n) ? h('div', {},
      h('div', { class: 'scroll' }, h('table', { class: 'gd-table' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), ...['Passes', 'Side-out after a good pass', 'After a poor pass'].map(t => h('th', { class: 'num' }, t)))),
        h('tbody', {}, recvRow('a'), recvRow('b')))),
      h('p', { class: 'muted small' }, 'Good: a pass graded 2 or 3. Poor: 0 or 1, and aces count as a 0. Side-out: the receiving team won the point.')) : null;

    // Rotations: each team's points won and lost in each rotation, named by who serves in it.
    const cyc = { a: serveCycle(rallies, game, 'a'), b: serveCycle(rallies, game, 'b') };
    const rot = rotations(rallies, game);
    const rotHead = s => h('tr', { class: 'gd-teamhead', style: `--tc:${color(side[s].k)}` },
      h('th', { colspan: 6, scope: 'rowgroup' }, h('span', { class: 'gd-teamname' }, side[s].name)));
    const rotRows = s => rot[s].map(r => {
      const best = rot[s].best.includes(r.server), worst = rot[s].worst.includes(r.server);
      return h('tr', { class: best ? 'gd-best' : worst ? 'gd-worst' : null },
        h('th', { scope: 'row', style: `--tc:${color(side[s].k)}`, class: 'gd-team' }, name.get(r.server) ?? 'Someone', h('span', { class: 'muted small' }, ' serving'),
          best ? h('span', { class: 'chip plain gd-rot best' }, 'Best') : worst ? h('span', { class: 'chip plain gd-rot worst' }, 'Weakest') : null),
        h('td', { class: 'num' }, String(r.rallies)), h('td', { class: 'num' }, `${r.won}–${r.lost}`),
        h('td', { class: `num gd-net ${r.net > 0 ? 'up' : r.net < 0 ? 'down' : ''}` }, signed(r.net)),
        h('td', { class: 'num' }, r.served ? `${r.held}/${r.served}` : '—'), h('td', { class: 'num' }, r.received ? `${r.sideOut}/${r.received}` : '—'));
    });
    const rotCard = (rot.a.length || rot.b.length) ? h('div', {},
      h('div', { class: 'scroll' }, h('table', { class: 'gd-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Rotation'), ...['Rallies', 'Won–lost', '+/−', 'Serving', 'Receiving'].map(t => h('th', { class: 'num' }, t)))),
        h('tbody', {}, rot.a.length ? [rotHead('a'), ...rotRows('a')] : null, rot.b.length ? [rotHead('b'), ...rotRows('b')] : null))),
      ['a', 'b'].filter(s => cyc[s].fixed != null).map(s => h('p', { class: 'small gd-fixed' }, h('b', {}, name.get(cyc[s].fixed) ?? 'Someone'), ` stayed front middle for ${side[s].name}, so the other five rotated. Change it on the Positions tab.`)),
      h('p', { class: 'muted small' }, 'A rotation is named by the player serving in it, in serving order. It counts the points the team played there, serving and receiving until it won the serve back. ',
        'Serving: points won on its own serve. Receiving: side-outs. Best and weakest: the most and fewest points won over lost, among rotations with 3 or more rallies. One game is a small sample, so read it as a hint.')) : null;

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
        'Best: points scored, minus errors, plus half a point for each good pass, dig or set. Players level on that share the star. Setters aren\'t starred: they touch the ball most, so they\'d top it every game.'),
      h('p', { class: 'muted small' }, 'Points: kills, aces and blocks. Good passes: passes graded 2 or 3. Only the organizers and the players in this game see this.'));

    const mineTally = Number.isInteger(mineId) && game.players_a.concat(game.players_b).includes(mineId) ? tally([{ game, rallies }]).get(mineId) : null;
    const you = mineTally && h('div', { class: 'card gd-you' }, h('h3', {}, 'Your game'), h('p', {}, gameLine(mineTally.counts)),
      h('p', { class: 'muted small' }, h('a', { href: `#player/${mineId}` }, 'All your stats on Me →')));
    // Who stayed front middle, per team: chosen by an organizer, or read from the tags until then.
    const HOW = { served: 'read from the tags: the serve came round after five servers', sets: 'a guess: they hadn\'t served and did most of the setting', chosen: null };
    const middleBox = () => {
      const canEdit = me.role === 'organizer' || me.role === 'super';
      const pickers = {};
      const row = s => {
        const f = cyc[s].fixed, how = cyc[s].how;
        if (!canEdit) return f != null && h('p', { class: 'small' }, h('b', {}, name.get(f) ?? 'Someone'), ` stayed front middle for ${side[s].name}.`);
        pickers[s] = h('select', { 'aria-label': `Stayed front middle for ${side[s].name}` }, h('option', { value: '' }, 'Nobody, all six rotated'),
          side[s].players.map(p => h('option', { value: p.id, selected: p.id === f }, p.name)));
        pickers[s].onchange = save;
        return h('label', { class: 'gd-middle-row' }, h('span', { class: 'gd-teamname', style: `--tc:${color(side[s].k)}` }, side[s].name), pickers[s],
          !game.middle_set && how && HOW[how] && h('span', { class: 'muted small' }, HOW[how]));
      };
      async function save() {
        const v = s => pickers[s]?.value ? Number(pickers[s].value) : null;
        const { error } = await sb.from('games').update({ middle_a: v('a'), middle_b: v('b'), middle_set: true }).eq('id', g.id);
        if (error) return toast(/middle_/.test(error.message) ? 'This needs the database upgrade first: run supabase/front_middle.sql in the Supabase SQL Editor.' : error.message);
        toast('Saved');
        load();
      }
      const rows = ['a', 'b'].map(row).filter(Boolean);
      if (!rows.length) return null;
      return h('div', { class: 'gd-fixed' }, canEdit && h('b', { class: 'small' }, 'Stayed front middle'), rows,
        canEdit && h('p', { class: 'muted small', style: 'margin:6px 0 0' }, 'A player who stays front middle (often the setter) is in 3 every rally, even when they take their turn to serve; the other five rotate round them.'));
    };

    // Positions: one player's numbers in each court position, from the serving order.
    const pos = positions(rallies, game);
    const posPanel = (pos.a.ok || pos.b.ok) ? h('div', {}) : null;
    if (posPanel) {
      const placed = s => [...pos[s].players.keys()];
      const all = [...placed('a'), ...placed('b')];
      if (!all.includes(posPlayer)) posPlayer = all.includes(mineId) ? mineId : all[0];
      const sel = h('select', { 'aria-label': 'Player' }, ['a', 'b'].filter(s => pos[s].ok).map(s => h('optgroup', { label: side[s].name },
        placed(s).map(p => h('option', { value: p, selected: p === posPlayer }, name.get(p) ?? 'Someone')))));
      const body = h('div');
      const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
      const frac = (n, d) => d ? `${n}/${d}` : '—';
      const merge = rows => rows.reduce((m, r) => {
        m.rallies += r.rallies; m.won += r.won; m.lost += r.lost;
        for (const a in r.counts) for (const g in r.counts[a]) m.counts[a][g] += r.counts[a][g];
        return m;
      }, { rallies: 0, won: 0, lost: 0, counts: Object.fromEntries(Object.entries(ACTIONS).map(([a, d]) => [a, Object.fromEntries(d.grades.map(([g]) => [g, 0]))])) });
      const cells = r => { const c = r.counts, net = r.won - r.lost; return [
        h('td', { class: 'num' }, String(r.rallies)), h('td', { class: 'num' }, r.rallies ? `${r.won}–${r.lost}` : '—'),
        h('td', { class: `num gd-net ${net > 0 ? 'up' : net < 0 ? 'down' : ''}` }, r.rallies ? signed(net) : '—'),
        h('td', { class: 'num' }, frac(sum(c.serve) - c.serve[0], sum(c.serve))),
        h('td', { class: 'num' }, frac(c.pass[2] + c.pass[3], sum(c.pass))),
        h('td', { class: 'num' }, sum(c.set) ? String(sum(c.set)) : '—'),
        h('td', { class: 'num' }, frac(c.attack[3], sum(c.attack))),
        h('td', { class: 'num' }, c.block[3] || sum(c.block) ? `${c.block[3]}/${sum(c.block)}` : '—'),
        h('td', { class: 'num' }, frac(c.dig[1] + c.dig[2] + c.dig[3], sum(c.dig)))]; };
      const paintPos = () => {
        const s = game.players_a.includes(posPlayer) ? 'a' : 'b', rows = pos[s].players.get(posPlayer);
        const front = merge(rows.filter((_, i) => FRONT_ROW.includes(i + 1))), back = merge(rows.filter((_, i) => !FRONT_ROW.includes(i + 1)));
        fill(body, h('div', { class: 'scroll' }, h('table', { class: 'gd-table gd-pos' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Position'), ...['Rallies', 'Won–lost', '+/−', 'Serves in', 'Good passes', 'Sets', 'Kills', 'Blocks', 'Digs'].map(t => h('th', { class: 'num' }, t)))),
          h('tbody', {}, POSITIONS.map(([n, label], i) => h('tr', { class: [FRONT_ROW.includes(n) ? 'front' : null, rows[i].rallies ? null : 'empty'].filter(Boolean).join(' ') || null },
            h('th', { scope: 'row', class: 'gd-team', style: `--tc:${color(side[s].k)}` }, `${n} `, h('span', { class: 'muted small' }, label)), ...cells(rows[i])))),
          h('tbody', { class: 'gd-pos-sum' },
            h('tr', {}, h('th', { scope: 'row' }, 'Front row'), ...cells(front)),
            h('tr', {}, h('th', { scope: 'row' }, 'Back row'), ...cells(back))))));
      };
      sel.onchange = () => { posPlayer = Number(sel.value); paintPos(); };
      paintPos();
      const unplaced = ['a', 'b'].flatMap(s => pos[s].unplaced);
      fill(posPanel, h('label', { class: 'gd-pos-pick' }, h('span', { class: 'muted small' }, 'Player'), sel), body,
        h('p', { class: 'muted small' }, 'Where a player stood comes from the serving order: the server is in 1, the next to serve in 2, and so on round the court (2, 3 and 4 are the front row). ',
          'Each row counts the rallies they played there and what they did. Serves in: out of serves. Good passes: 2 or 3, out of passes. Kills, blocks (stuffs) and digs: out of attempts.'),
        middleBox(),
        unplaced.length > 0 && h('p', { class: 'muted small' }, `${unplaced.map(p => name.get(p) ?? 'Someone').join(', ')} never served, so where they stood isn't known.`),
        ['a', 'b'].filter(s => !pos[s].ok && pos[s].why === 'size').map(s => h('p', { class: 'muted small' }, `${side[s].name} didn't play six with a fixed rotation, so positions aren't worked out for it.`)));
    }

    // The team numbers as tabs on one card; the tab picked stays while moving between games.
    const panels = [['teams', 'Teams', teams], ['rotations', 'Rotations', rotCard], ['points', 'Points', points], ['receive', 'Serve receive', receive], ['positions', 'Positions', posPanel]].filter(p => p[2]);
    const tabs = h('div', { class: 'gd-tabs', role: 'tablist', 'aria-label': 'Team stats' });
    const show = key => {
      statsTab = key;
      panels.forEach(([k, , el], i) => { const on = k === key; el.hidden = !on; tabs.children[i].setAttribute('aria-selected', String(on)); tabs.children[i].tabIndex = on ? 0 : -1; });
    };
    panels.forEach(([k, label, el], i) => {
      el.id = `gd-panel-${k}`; el.setAttribute('role', 'tabpanel'); el.setAttribute('aria-labelledby', `gd-tab-${k}`);
      tabs.append(h('button', { type: 'button', role: 'tab', id: `gd-tab-${k}`, 'aria-controls': el.id, onclick: () => show(k),
        onkeydown: e => {
          const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: panels.length - 1 }[e.key];
          if (to == null) return;
          e.preventDefault();
          const n = (to + panels.length) % panels.length;
          show(panels[n][0]); tabs.children[n].focus();
        } }, label));
    });
    show(panels.some(p => p[0] === statsTab) ? statsTab : 'teams');
    const statsCard = h('div', { class: 'card gd-stats' }, tabs, panels.map(p => p[2]));
    fill(right, you, statsCard, players);
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
