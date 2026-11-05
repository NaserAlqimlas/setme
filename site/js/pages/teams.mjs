import { ask, avatar, callFn, choose, firstName, fmt, h, LABEL, me, missing, pageHead, q, sb, seg, setterMark, SHORT, stacked, TEAM_COLORS, TIER_OPTIONS, toast, today, toggle } from '../ui.mjs';
import { ALL_GAME, SETTING_WEIGHT, SKILLS, teamNames, WEIGHTS } from '../teams.mjs';
import { parseTeams } from '../paste.mjs';
import { courtImage } from '../courtimg.mjs';
import { recapImage } from '../recapimg.mjs';
import { ADJUST_MIN_GAMES } from '../scores.mjs';
import { recap } from '../stats.mjs';
import { svg } from './ratings.mjs';

// Teams page (organizers): building, editing and saving teams for a game day, drafts, share images.

// ---------- teams (organizers) ----------
// Combos are set here, just before building. They're saved, so the next session starts from the last one's.
// Pairs who play together (always same team) or apart (never same team), for this build only. Nothing is saved:
// they last while the page is open (switching tabs keeps them) and are sent along when teams are built.
let sessionCombos = [];
// Build options that last while the page is open: mix up teammates from recent game days (on), and shift players by
// how their teams have done against their ratings (off), and split women evenly across teams (on).
let mixTeammates = true, adjustResults = false, spreadWomen = true;
const buildExtras = () => ({ variety: mixTeammates, resultsAdjust: adjustResults, spreadWomen, playedOn: gameDate || null });
// Which setters set all game, for this session (not saved): player id -> true / false. Not set yet = main setters do.
const setterPlan = new Map();
const setsAllGame = p => setterPlan.get(p.id) ?? p.setting === 'M';
const allGameIds = players => players.filter(p => p.setting && p.setting !== 'N' && setsAllGame(p)).map(p => p.id);
const setterPlanChanged = () => document.dispatchEvent(new Event('setterplan'));

// A card that folds: the title and a line saying how it's set now; tap to open.
function fold(title, cls = '') {
  const state = h('span', { class: 'muted small fold-state' });
  const body = h('div', { class: 'fold-body' });
  const card = h('details', { class: `card fold ${cls}` }, h('summary', {}, h('h3', {}, title), state), body);
  card.state = state; card.body = body;
  return card;
}

// Tonight's setters: who sets all game (their Setting counts, hitting and receiving count for less) and who rotates.
function settersCard(playing) {
  const setters = playing.filter(p => p.setting === 'M' || p.setting === 'B');
  const card = fold('Setters');
  card.hidden = !setters.length;
  const paint = () => {
    if (!card.isConnected && card.dataset.drawn) return document.removeEventListener('setterplan', paint);
    card.dataset.drawn = '1';
    const all = setters.filter(setsAllGame).map(p => firstName(p.name));
    card.state.textContent = all.length ? `${all.length > 2 ? all.length : all.join(' and ')} set${all.length === 1 ? 's' : ''} all game${all.length < setters.length ? `, ${setters.length - all.length} rotate${setters.length - all.length === 1 ? 's' : ''}` : ''}` : 'Everyone rotates';
    card.body.replaceChildren(
      h('p', { class: 'muted small', style: 'margin:0 0 10px' }, 'A setter who sets the whole game counts for their setting; their hitting and passing count for less. Setters who rotate count like everyone else.'),
      h('div', { class: 'new-players' }, setters.map(p => h('div', { class: 'new-player' },
        h('span', {}, h('b', {}, p.name), ' ', h('span', { class: `badge ${p.setting === 'M' ? 'set' : 'backup'}` }, p.setting === 'M' ? 'Setter' : 'Backup')),
        seg([[true, 'All game'], [false, 'Rotates']], setsAllGame(p), v => { setterPlan.set(p.id, v); setterPlanChanged(); }, `${p.name} sets`)))));
  };
  paint();
  document.addEventListener('setterplan', paint);
  return card;
}
function comboCard(playing, combos, useSwitch) {
  const name = new Map(playing.map(p => [p.id, p.name]));
  const card = fold('Combos');
  let kind = 'together';
  const draw = () => {
    const sel = label => h('select', { 'aria-label': label }, h('option', { value: '' }, 'Choose player'), playing.map(p => h('option', { value: p.id }, p.name)));
    const a = sel('First player'), b = sel('Second player');
    const add = async e => {
      e.preventDefault();
      if (!a.value || !b.value || a.value === b.value) return toast('Pick two different players');
      const [x, y] = [Number(a.value), Number(b.value)];
      if (combos.some(c => (c.player_a === x && c.player_b === y) || (c.player_a === y && c.player_b === x))) return toast('Those two are already paired');
      combos.push({ player_a: x, player_b: y, kind }); draw();
    };
    const remove = c => { combos.splice(combos.indexOf(c), 1); draw(); };
    const clear = () => { combos.length = 0; draw(); };
    const chip = c => {
      const off = !name.has(c.player_a) || !name.has(c.player_b);
      const apart = c.kind === 'apart';
      const text = `${name.get(c.player_a) ?? '?'} ${apart ? '≠' : '+'} ${name.get(c.player_b) ?? '?'}`;
      return h('span', { class: `chip${apart ? ' apart' : ''}${off ? ' off' : ''}`, title: off ? 'Skipped: not everyone is playing' : null }, text,
        h('button', { type: 'button', 'aria-label': `Remove ${text}`, onclick: () => remove(c) }, '×'));
    };
    const section = (title, list, empty) => h('div', { class: 'combo-section' },
      h('h4', {}, title, h('span', { class: 'muted' }, ` ${list.length || ''}`)),
      h('div', { class: 'chips' }, list.length ? list.map(chip) : h('span', { class: 'muted small' }, empty)));
    const together = combos.filter(c => c.kind !== 'apart').length, apart = combos.length - together;
    card.state.textContent = combos.length ? [together && `${together} together`, apart && `${apart} apart`].filter(Boolean).join(', ') : 'None';
    card.body.replaceChildren(
      h('div', { class: 'card-head' }, h('p', { class: 'muted small', style: 'margin:0' }, 'Pairs who should play on the same team, or never on the same team. Kept while this page is open; not saved.'),
        combos.length > 0 && h('button', { class: 'ghost sm', onclick: clear }, 'Clear all')),
      useSwitch,
      h('form', { class: 'row combo-add', onsubmit: add }, a, b,
        seg([['together', 'Together'], ['apart', 'Apart']], kind, v => { kind = v; }, 'Pair type'),
        h('button', { class: 'ghost' }, 'Add')),
      section('Play together', combos.filter(c => c.kind !== 'apart'), 'Nobody paired up.'),
      section('Keep apart', combos.filter(c => c.kind === 'apart'), 'Nobody kept apart.'));
  };
  draw();
  return card;
}

// The teams saved for the picked date ({ day, key, round, games: games entered in that round }), so whatever on screen
// matches gets a Saved mark and Save buttons say what they'll do. null: none, or unknown.
let savedLineup = null;
// Same teams in any order, with players in any order, give the same key.
const lineupKey = teams => teams.map(t => [...t].sort((a, b) => a - b).join(',')).sort().join('|');
const optionIds = opt => opt.teams.map(t => t.players.map(p => p.id));
function markSaved() {
  const key = savedLineup?.day === gameDate ? savedLineup.key : null;
  document.querySelectorAll('[data-key]').forEach(el => el.classList.toggle('is-saved', el.dataset.key === key));
  document.dispatchEvent(new Event('savedmarks'));
}
// Where keyboard and screen-reader focus goes once teams are drawn again after a swap, Apply, Undo or lock
// (a selector inside the option on screen); without it focus would drop to the top of the page.
let pendingFocus = null;
const focusAfterDraw = sel => { pendingFocus = sel; };
const FOCUS_CHANGE = '.change-line', FOCUS_VERDICT = '.verdict';
// Said right after a swap, next to the teams: who moved, how the gap changed, and Undo.
function changeLine(before, after, onUndo) {
  if (!before || !after) return null;
  const gap = o => { const t = o.teams.map(x => x.weighted); return Math.max(...t) - Math.min(...t); };
  const teamOf = new Map(before.teams.flatMap((t, k) => t.players.map(p => [p.id, k])));
  const moved = after.teams.flatMap((t, k) => t.players.filter(p => teamOf.get(p.id) !== k).map(p => `${p.name} to Team ${k + 1}`));
  const [g0, g1] = [gap(before), gap(after)];
  const worse = g1 > g0 + 0.005;
  const detail = me.role === 'super' || me.role === 'organizer';
  return h('div', { class: `change-line${worse ? ' worse' : ''}`, role: 'status', tabindex: -1 },
    h('p', { class: 'small' }, h('b', {}, moved.length ? `Moved ${moved.join(', ')}.` : 'Swapped.'), ' ',
      detail ? `Gap ${num2(g0)} → ${num2(g1)}, ${worse ? 'less even' : g1 < g0 - 0.005 ? 'more even' : 'about the same'}.` : worse ? 'Less even than before.' : ''),
    onUndo && h('button', { type: 'button', class: 'ghost sm', onclick: onUndo }, 'Undo'));
}
// Database upgrade messages: the super can run the SQL file; anyone else is told who can.
const needsSql = (what, file) => me.role === 'super' ? `${what} need the database upgrade (supabase/${file})` : `${what} aren't set up yet. Ask the site owner to finish the upgrade.`;

// Team totals and gaps on Teams: always two decimals with a leading zero, easier to compare at a glance.
export const num2 = v => (Math.round(v * 100) / 100).toFixed(2);
// How even an option is, from the gap between the strongest and weakest team's total.
const EVEN = [[0.25, 'Very even'], [0.6, 'Even'], [1.2, 'A bit uneven'], [Infinity, 'Uneven']];
export const evenness = gap => EVEN.find(([max]) => gap <= max)[1];
// The scale in words, said next to a gap so organizers can judge it without knowing the numbers.
export const GAP_SCALE = 'Under 0.25 is very even, under 0.60 even, over 1.20 uneven.';

// Teams of about 6: the count the build starts on for this many players.
const suggestTeams = n => Math.min(6, Math.max(2, Math.round(n / 6) || 4));
const teamSizes = (n, k) => { const lo = Math.floor(n / k); return n % k ? `${lo} or ${lo + 1}` : String(lo); };
// "Thursday's teams" for the save button; the button follows the date picked above.
const dayName = iso => iso ? new Date(`${iso}T12:00`).toLocaleDateString(undefined, { weekday: 'long' }) : '';
// Says what saving will do, from the teams already saved for the picked date and whether these are them:
// "Save as Thursday's teams" (nothing saved yet), "Saved ✓" (these are the saved teams; nothing to do),
// "Replace Thursday's teams" (others saved, no games yet), "Save new teams for Thursday…" (others saved with games:
// saving asks whether to start a new round or replace them).
function saveButton(onclick) {
  let saving = false;
  const btn = h('button', { class: 'sm', onclick: async () => {
    if (btn.disabled) return;
    saving = true; btn.disabled = true; btn.textContent = 'Saving…';
    try { await onclick(); } finally { saving = false; label(); }
  } });
  const label = () => {
    if (!btn.isConnected && btn.dataset.drawn) {
      document.removeEventListener('gamedate', label); document.removeEventListener('savedmarks', label); return;
    }
    if (btn.isConnected) btn.dataset.drawn = '1';
    if (saving) return;
    const day = gameDate && dayName(gameDate);
    const saved = savedLineup?.day === gameDate ? savedLineup : null;
    const here = btn.closest('[data-key]');
    const isSaved = !!saved && !!here?.dataset.key && here.dataset.key === saved.key;
    const round = saved?.round > 1 ? ` (round ${saved.round})` : '';
    btn.disabled = isSaved;
    btn.classList.toggle('ghost', isSaved);
    btn.classList.toggle('replace', !!saved && !isSaved);
    btn.textContent = !gameDate ? 'Save for scores'
      : isSaved ? 'Saved ✓'
      : !saved ? `Save as ${day}'s teams`
      : saved.games ? `Save new teams for ${day}…`
      : `Replace ${day}'s teams${round}`;
    btn.title = !gameDate ? ''
      : isSaved ? `These are the teams saved for ${dayTitle(gameDate)}${round}`
      : !saved ? `Save for ${dayTitle(gameDate)}, so scores can be entered on Scores`
      : saved.games ? `${dayTitle(gameDate)} already has ${saved.games} game${saved.games === 1 ? '' : 's'}${round}. You'll pick: start a new round, or replace the teams.`
      : `Replaces the teams saved for ${dayTitle(gameDate)}${round}. No games entered yet.`;
  };
  // Drawn before it's on the page; label again once it is, so it can see which option it belongs to.
  queueMicrotask(label);
  label();
  document.addEventListener('gamedate', label);
  document.addEventListener('savedmarks', label);
  return btn;
}
// On/off switch with a line under it saying what it does.
const switchRow = (label, on, onchange, hint) => h('div', { class: 'switch-row' }, toggle(label, on, onchange), h('p', { class: 'muted small' }, hint));
// Which built option is open, and whether skill numbers show (open on wider screens to start).
let showSkills = matchMedia('(min-width: 641px)').matches;
document.documentElement.classList.toggle('hide-skills', !showSkills);

export async function teamsPage() {
  const playing = await q(sb.from('players').select('id,name,setting').eq('playing', true).eq('active', true).order('name'));
  const combos = sessionCombos;
  let numTeams = suggestTeams(playing.length), useCombos = true;
  // Whose ratings to build from. null = everyone's.
  let raterIds = null;
  const newPlayers = newPlayersCard(() => raterIds);
  const out = h('div', { class: 'teams-out' });
  const ownTeams = ownTeamsCard(out, () => ({ raters: raterIds, useCombos, combos: combos.map(({ player_a, player_b, kind }) => ({ player_a, player_b, kind })), ...buildExtras() }));
  const drafts = draftsCard(ownTeams);
  const btn = h('button', { class: 'ball big', disabled: !playing.length }, 'Build teams');
  // An empty list means every rater is switched off: nothing to build from until one is back on.
  const needRater = h('p', { class: 'warn small need-rater', hidden: true }, 'Turn on at least one rater to build teams.');
  const options = fold('Options', 'options');
  const paintOptions = () => {
    options.state.textContent = [raterIds ? `Ratings from ${raterIds.length} rater${raterIds.length === 1 ? '' : 's'}` : null,
      mixTeammates && 'Mix up teammates', spreadWomen && 'Spread women', adjustResults && 'Adjust for results'].filter(Boolean).join(' · ') || 'All switches off';
  };
  // Organizers can only read their own rating rows, so the server says who has rated.
  const raterList = me.role === 'super' ? undefined
    : await callFn('build-teams', { listRaters: true }).then(({ raters }) => ({ ratings: raters.map(r => ({ rater_id: r.id })), profiles: raters })).catch(() => null);
  const raterPick = raterList === null ? null : await raterPicker(ids => {
    raterIds = ids;
    ownTeams.refresh();
    const none = ids?.length === 0;
    btn.disabled = none || !playing.length; needRater.hidden = !none;
    if (none) options.open = true;
    if (!none) newPlayers.refresh();
    paintOptions();
  }, raterList);
  const switched = (set) => v => { set(v); ownTeams.refresh(); paintOptions(); };
  options.body.append(
    raterPick ?? '', needRater,
    h('div', { class: 'switches' },
      switchRow('Mix up teammates', mixTeammates, switched(v => { mixTeammates = v; }), 'Avoids putting the same people together as on the last game days, choosing only between equally even splits.'),
      switchRow('Spread women evenly', spreadWomen, switched(v => { spreadWomen = v; }), 'Each team gets about the same number of women. Off, gender is ignored.'),
      switchRow('Adjust for results', adjustResults, switched(v => { adjustResults = v; }), `Moves each player up or down by how their teams have done against their ratings, after ${ADJUST_MIN_GAMES} games with scores.`)));
  paintOptions();

  // The date, in words and as a picker. Saving and the shared image use it.
  const dayWords = h('h3', { class: 'day' });
  const date = h('input', { type: 'date', value: gameDate, 'aria-label': 'Game date' });
  const saved = h('p', { class: 'small saved-line', hidden: true });
  // Already saved for that day? Said here so whoever picks up the phone sees it. Quiet when Scores isn't set up.
  const paintDay = async () => {
    dayWords.textContent = gameDate ? dayTitle(gameDate) : 'Pick a date';
    if (!gameDate) { saved.hidden = true; return; }
    const day = gameDate;
    const [row] = await q(sb.from('sessions').select('id,teams').eq('played_on', day)).catch(() => []);
    // Which round is playing (rounds.sql; 1 before it runs).
    const [kept, played] = row ? await Promise.all([
      q(sb.from('rounds').select('n').eq('session_id', row.id)).catch(() => []),
      q(sb.from('games').select('*').eq('session_id', row.id)).catch(() => []),
    ]) : [[], []];
    if (day !== gameDate) return;
    const round = kept.length + 1;
    savedLineup = row ? { day, key: Array.isArray(row.teams) ? lineupKey(row.teams) : null, round, games: played.filter(g => (g.round ?? 1) === round).length } : null;
    markSaved();
  };
  // Which option on screen is the saved one, if any. Re-said whenever options or the saved teams change.
  const paintSaved = () => {
    if (!saved.isConnected && saved.dataset.drawn) return document.removeEventListener('savedmarks', paintSaved);
    saved.dataset.drawn = '1';
    const on = savedLineup?.day === gameDate;
    saved.hidden = !on;
    if (!on) return;
    const shown = [...out.querySelectorAll('.option')];
    const match = shown.find(o => o.classList.contains('is-saved'));
    const day = h('b', {}, dayTitle(gameDate));
    const scores = h('a', { href: '#scores' }, 'Enter scores');
    saved.classList.toggle('differs', shown.length > 0 && !match);
    const round = savedLineup.round > 1 ? savedLineup.round : null;
    saved.replaceChildren(...(match ? ['✓ ', match.dataset.label ?? 'These teams', ' is saved for ', day, round ? ` (round ${round})` : '', '. ', scores]
      : shown.length ? [round ? `Round ${round} teams are` : 'Teams are', ' already saved for ', day, ', but not the ones below. Saving these replaces them, or starts a new round once games are in. ', scores]
      : ['✓ ', round ? `Round ${round} teams are` : 'Teams are', ' saved for ', day, '. ', scores]));
  };
  document.addEventListener('savedmarks', paintSaved);
  date.onchange = () => { gameDate = date.value; document.dispatchEvent(new Event('gamedate')); paintDay(); };
  const onSaved = () => { if (!out.isConnected) return document.removeEventListener('lineupsaved', onSaved); paintDay(); };
  document.addEventListener('lineupsaved', onSaved);
  paintDay();

  const sizes = h('span', { class: 'muted small' });
  const paintSizes = () => { sizes.textContent = playing.length ? `Teams of ${teamSizes(playing.length, numTeams)}` : ''; };
  paintSizes();
  const sendCombos = () => combos.map(({ player_a, player_b, kind }) => ({ player_a, player_b, kind }));
  // Built options on screen. Once you swap someone in an option it's checked like Your own teams (same numbers, problems,
  // suggestions, locks); the earlier version is kept for Undo. The raters and setters it was built with stay.
  // Per option i: checked[i] = the last check's response, undos[i] = earlier [option, check] pairs, locks[i] = locked ids.
  let built = null, builtWith = null, view = null, pool = null, open = 0;
  let checked = [], undos = [], locks = [], changes = [];
  const ids = i => built.options[i].teams.map(t => t.players.map(p => p.id));
  const check = async (i, teams) => {
    const res = await callFn('build-teams', { ...builtWith, teams, locked: [...(locks[i] ?? [])], suggestRater: view });
    built.options[i] = res.options[0]; checked[i] = res;
  };
  const edit = async (i, teams) => {
    const before = [built.options[i], checked[i]];
    try { await check(i, teams); (undos[i] ??= []).push(before); changes[i] = before[0]; draw(); }
    catch (e) { toast(e.message); draw(); }
  };
  const recheck = i => check(i, ids(i)).then(draw).catch(e => toast(e.message));
  // Kept after each change. Undo goes back 10 steps per option at most, and is dropped if storage is full.
  const keepBuilt = () => {
    const state = { built, builtWith, checked, locks: locks.map(l => l ? [...l] : null), view, open };
    teamsStore.write({ shows: 'built', own: null, built: { ...state, undos: undos.map(u => u?.slice(-10) ?? null), changes } })
      || teamsStore.write({ shows: 'built', own: null, built: { ...state, undos: [], changes: [] } });
  };
  ownTeams.onRun = () => { restoredLine.hidden = restoring ? restoredLine.hidden : true; teamsStore.write({ shows: 'own', built: null, own: ownTeams.snapshot() }); };
  const draw = () => { out.dataset.shows = 'built'; if (!restoring) restoredLine.hidden = true; keepBuilt(); out.replaceChildren(...showTeams(built, {
    view, onSwap: edit, pool, open, onOpen: i => { open = i; keepBuilt(); },
    edited: i => undos[i]?.length > 0,
    notice: i => changes[i] && changeLine(changes[i], built.options[i], () => undo(i)),
    onSave: i => saveLineup(ids(i), { raters: builtWith.raters, allGame: builtWith.allGame, source: checked[i] ? 'edited' : 'built' }),
    onDraft: i => saveDraft(ids(i), builtWith, `Option ${i + 1}${checked[i] ? ' (swapped)' : ''}`).then(ok => ok && document.dispatchEvent(new Event('drafts'))),
    onView: id => { view = id; checked.forEach((c, i) => c && recheck(i)); },
    locked: i => checked[i] && (locks[i] ??= new Set()),
    onLock: (id, i) => { locks[i].has(id) ? locks[i].delete(id) : locks[i].add(id); recheck(i); },
    extra: i => checked[i] && suggestionsPanel(checked[i], {
      onApply: sg => { focusAfterDraw(FOCUS_CHANGE); edit(i, sg.teams); },
      onUndo: undos[i]?.length > 0 && (() => undo(i)),
    }),
  })); };
  const undo = i => { [built.options[i], checked[i]] = undos[i].pop(); changes[i] = null; focusAfterDraw(FOCUS_VERDICT); draw(); };
  ownTeams.builtEdited = () => undos.some(u => u?.length);
  btn.onclick = async () => {
    if (out.dataset.shows === 'built' && ownTeams.builtEdited() && !await ask('Build new teams?', 'The swaps you made on the options below will be lost. Teams already saved for the day stay saved.', 'Build new teams', 'ball')) return;
    if (out.dataset.shows === 'own' && ownTeams.edited() && !await ask('Build new teams?', 'The swaps you made on your own teams below will be lost. Teams already saved for the day stay saved.', 'Build new teams', 'ball')) return;
    btn.disabled = true; btn.textContent = 'Building…'; out.classList.add('busy');
    try {
      builtWith = { useCombos, raters: raterIds, allGame: allGameIds(playing), combos: sendCombos(), ...buildExtras() };
      [built, pool] = await Promise.all([callFn('build-teams', { numTeams, ...builtWith }), ownTeams.roster().catch(() => null)]);
      checked = []; undos = []; locks = []; changes = []; view = null;
      // Open the most even option first.
      const gap = o => { const t = o.teams.map(x => x.weighted); return Math.max(...t) - Math.min(...t); };
      open = built.options.reduce((best, o, i) => gap(o) < gap(built.options[best]) ? i : best, 0);
      draw(); out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    catch (e) {
      out.dataset.shows = '';
      out.replaceChildren(h('div', { class: 'card build-error', role: 'alert' },
        h('p', { class: 'warn', style: 'margin:0' }, `Couldn't build teams: ${e.message}`),
        h('button', { type: 'button', class: 'ghost sm', onclick: () => btn.click() }, 'Try again')));
    }
    out.classList.remove('busy');
    btn.disabled = raterIds?.length === 0; btn.textContent = 'Build teams';
  };
  new MutationObserver(() => markSaved()).observe(out, { childList: true });
  // Coming back: put back what was on screen (built options as they were; own teams checked again).
  const restoredLine = h('div', { class: 'card undo-line restored-line', role: 'status', hidden: true });
  const clearKept = () => {
    teamsStore.write({ shows: null, built: null, own: null });
    built = null; checked = []; undos = []; locks = []; changes = []; view = null; ownTeams.reset();
    out.dataset.shows = ''; out.replaceChildren(); restoredLine.hidden = true;
  };
  let restoring = false;
  const kept = teamsStore.read();
  if (kept?.shows === 'built' && kept.built?.built?.options?.length) {
    restoring = true;
    ({ built, builtWith, checked = [], undos = [], changes = [], view = null, open = 0 } = kept.built);
    locks = (kept.built.locks ?? []).map(l => l ? new Set(l) : null);
    pool = await ownTeams.roster().catch(() => null);
    draw();
    restoring = false;
  } else if (kept?.shows === 'own' && kept.own?.current) {
    restoring = true;
    // Offline or the check failed: say so and keep what's stored, so the next visit can try again.
    await ownTeams.restore(kept.own).catch(e => { out.dataset.shows = ''; out.replaceChildren(h('p', { class: 'warn' }, `Couldn't bring back your teams: ${e.message}. Reload to try again.`)); });
    restoring = false;
  }
  if (out.dataset.shows) {
    const at = new Date(kept.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    restoredLine.replaceChildren(h('span', {}, `Restored your ${out.dataset.shows === 'built' ? 'options' : 'teams'} from ${at}.`),
      h('button', { type: 'button', class: 'ghost sm', onclick: clearKept }, 'Clear'));
    restoredLine.hidden = false;
  }
  const nobody = !playing.length && h('div', { class: 'card empty-list' },
    h('p', { style: 'margin:0' }, h('b', {}, 'Nobody is on the playing list yet.'), ' Paste the WhatsApp list or tick who\'s playing on Players, then come back to build.'),
    h('a', { class: 'button', href: '#players' }, 'Go to Players'));
  return h('div', {},
    pageHead('Teams', 'Build balanced teams from the playing list.'),
    nobody,
    h('div', { class: 'card build' },
      h('div', { class: 'build-head' },
        h('div', {}, dayWords,
          h('p', { class: 'muted small', style: 'margin:2px 0 0' }, h('b', { class: 'count' }, String(playing.length)), ' playing · ', h('a', { href: '#players' }, 'Change list'))),
        h('label', { class: 'field date-field' }, h('span', {}, 'Date'), date)),
      saved,
      h('div', { class: 'build-row' },
        h('div', { class: 'field' }, h('span', {}, 'Teams'),
          h('div', { class: 'row', style: 'gap:10px' }, seg([2, 3, 4, 5, 6].map(n => [n, String(n)]), numTeams, v => { numTeams = v; paintSizes(); }, 'Number of teams'), sizes)),
        h('span', { class: 'grow' }), btn)),
    comboCard(playing, combos, toggle('Use combos in this build', true, v => { useCombos = v; })),
    settersCard(playing),
    options,
    newPlayers,
    ownTeams,
    restoredLine,
    out,
    drafts);
}

// Teams you made yourself: paste them or upload a text/CSV file, then see the same numbers and sharing as a built option.
function ownTeamsCard(out, getOptions) {
  let players = null;
  const roster = () => players ??= q(sb.from('players').select('id,name,setting,playing').eq('active', true).order('name'));
  const box = h('textarea', { rows: 5, 'aria-label': 'Your teams',
    placeholder: 'Team 1: Reem, Mishal, HQ\nTeam 2: Fuwaires, Nasser, Adi\n\nOr a "Team" line then one name per line.' });
  const fileInput = h('input', { type: 'file', accept: '.txt,.csv,text/plain,text/csv', hidden: true });
  const preview = h('div');
  let parsed = { teams: [], dupes: [] };
  const check = h('button', { class: 'ball', disabled: true }, 'Check teams');

  const update = async () => {
    parsed = box.value.trim() ? parseTeams(box.value, await roster()) : { teams: [], dupes: [] };
    const { teams, dupes } = parsed;
    const filled = teams.filter(t => t.players.length);
    check.disabled = filled.length < 2;
    check.textContent = filled.length ? `Check ${filled.length} teams` : 'Check teams';
    const unmatched = teams.flatMap(t => t.unmatched);
    preview.replaceChildren(...(!teams.length ? [] : [
      h('div', { class: 'own-teams' }, teams.map(t => h('div', {},
        h('p', { class: 'small', style: 'margin:10px 0 6px' }, h('b', {}, t.label), h('span', { class: 'muted' }, ` · ${t.players.length} ${t.players.length === 1 ? 'player' : 'players'}${t.unmatched.length ? `, ${t.unmatched.length} not recognized` : ''}`)),
        h('div', { class: 'chips' }, t.players.map(p => h('span', { class: 'chip plain' }, p.name)), t.unmatched.map(n => h('span', { class: 'chip plain off', title: 'Not recognized' }, n)))))),
      unmatched.length > 0 && h('p', { class: 'small muted' }, h('b', {}, `${unmatched.length} not recognized`), ' (greyed out, left out of the check)'),
      dupes.length > 0 && h('p', { class: 'small muted' }, h('b', {}, `Listed twice: ${dupes.join(', ')}`), ' (kept in their first team)'),
      filled.length === 1 && h('p', { class: 'small warn' }, 'Only one team found. Put each team on its own "Team" line, or leave a blank line between teams.'),
    ].filter(Boolean)));
  };
  box.oninput = update;
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    box.value = await file.text();
    update();
  };
  // After a check: the teams as they stand now (player ids), earlier versions for Undo, and players locked in place.
  // viewRater: whose ratings the cards and suggestions use (null = the picked raters combined).
  let current = null, history = [], viewRater = null, lastOpt = null, changedFrom = null;
  // The opened draft's name and id; null for pasted teams. Not card.title: that's the tooltip attribute, and null turns into "null".
  let teamsTitle = null, draftId = null;
  const locked = new Set();
  const run = async ({ scroll = false } = {}) => {
    const opts = getOptions();
    if (opts.raters?.length === 0) return out.replaceChildren(h('p', { class: 'warn' }, 'Please select at least one rater.'));
    if (viewRater && opts.raters && !opts.raters.includes(viewRater)) viewRater = null;
    const res = await callFn('build-teams', { teams: current, locked: [...locked], suggestRater: viewRater, allGame: allGameIds(await roster()), ...opts });
    const toggleLock = id => { locked.has(id) ? locked.delete(id) : locked.add(id); run().catch(e => toast(e.message)); };
    const onView = id => { viewRater = id; run().catch(e => toast(e.message)); };
    const onSetter = async id => {
      const p = (await roster()).find(x => x.id === id);
      setterPlan.set(id, !setsAllGame(p)); setterPlanChanged();
    };
    const onSwap = (_, teams) => { history.push(current); changedFrom = lastOpt; current = teams; run().catch(e => { current = history.pop(); changedFrom = null; toast(e.message); run().catch(() => {}); }); };
    const undo = history.length > 0 && (() => { current = history.pop(); changedFrom = null; focusAfterDraw(FOCUS_VERDICT); run().catch(e => toast(e.message)); });
    const onSave = async () => saveLineup(current, { raters: opts.raters, allGame: allGameIds(await roster()), source: 'own' });
    const onDraft = async () => { if (await saveDraft(current, { ...opts, allGame: allGameIds(await roster()) }, teamsTitle ?? 'Your teams')) document.dispatchEvent(new Event('drafts')); };
    const onUpdateDraft = draftId != null && (async () => {
      try {
        await q(sb.from('drafts').update({ teams: current, raters: opts.raters ?? null, all_game: allGameIds(await roster()), combos: opts.combos ?? [] }).eq('id', draftId));
        toast('Draft updated'); document.dispatchEvent(new Event('drafts'));
      } catch (e) { toast(e.message); }
    });
    const notice = changeLine(changedFrom, res.options[0], undo);
    lastOpt = res.options[0];
    out.dataset.shows = 'own';
    out.replaceChildren(...showTeams(res, { title: teamsTitle ?? 'Your teams', locked, onLock: toggleLock, view: viewRater, onView, onSetter, onSwap, onSave, onDraft, onUpdateDraft, pool: await roster(), notice, extra: suggestionsPanel(res, {
      onApply: sg => { history.push(current); changedFrom = lastOpt; current = sg.teams; focusAfterDraw(FOCUS_CHANGE); run().catch(e => toast(e.message)); },
      onUndo: undo,
    }) }));
    if (scroll) out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.onRun?.();
  };
  // The results area holds either built options or these teams. Ask before replacing work that would be lost.
  const okToReplace = async (what, ok) => {
    if (out.dataset.shows === 'built') return ask(`${what}?`, `The built options below will be replaced${card.builtEdited?.() ? ', and the swaps you made on them will be lost' : ''}. Teams already saved for the day stay saved.`, ok, 'ball');
    if (out.dataset.shows === 'own' && history.length) return ask(`${what}?`, 'The swaps you made on the teams below will be lost.', ok, 'ball');
    return true;
  };
  check.onclick = async () => {
    if (!await okToReplace('Check these teams', 'Check teams')) return;
    teamsTitle = null; draftId = null;
    current = parsed.teams.filter(t => t.players.length).map(t => t.players.map(p => p.id));
    history = []; locked.clear(); changedFrom = null;
    check.disabled = true; const label = check.textContent; check.textContent = 'Checking…';
    try { await run({ scroll: true }); }
    catch (e) { out.dataset.shows = ''; out.replaceChildren(h('p', { class: 'warn' }, e.message)); }
    check.disabled = false; check.textContent = label;
  };
  const card = h('details', { class: 'card own' },
    h('summary', {}, h('h3', {}, 'Your own teams'), h('span', { class: 'muted small' }, 'Paste or upload teams you made to see how they balance')),
    h('div', { class: 'own-body' },
      box,
      h('div', { class: 'row', style: 'margin-top:10px' },
        h('button', { type: 'button', class: 'ghost sm', onclick: () => fileInput.click() }, 'Upload file'), fileInput,
        h('span', { class: 'muted small grow' }, '.txt or .csv, one team per line or per block'),
        check),
      preview));
  // Ratings from changed at the top: re-check teams already on screen.
  card.refresh = () => { if (current && out.isConnected) run().catch(e => toast(e.message)); };
  // Open a saved draft: checked like pasted teams (swaps, suggestions, locks, Save for scores).
  card.load = async (teams, title, id = null) => {
    if (!await okToReplace(`Open "${title}"`, 'Open draft')) return;
    current = teams; history = []; locked.clear(); changedFrom = null; teamsTitle = title; draftId = id;
    try { await run({ scroll: true }); } catch (e) { out.dataset.shows = ''; out.replaceChildren(h('p', { class: 'warn' }, e.message)); }
  };
  document.addEventListener('setterplan', () => card.refresh());
  card.roster = roster;
  card.edited = () => history.length > 0;
  // Kept on this device between visits (teamsStore): what's pasted and the checked teams with their swaps and locks.
  card.snapshot = () => ({ text: box.value, current, history: history.slice(-20), locked: [...locked], viewRater, teamsTitle, draftId });
  card.restore = async st => {
    box.value = st.text ?? ''; if (box.value) { update(); card.open = true; }
    current = st.current; history = st.history ?? []; locked.clear(); (st.locked ?? []).forEach(id => locked.add(id));
    viewRater = st.viewRater ?? null; teamsTitle = st.teamsTitle ?? null; draftId = st.draftId ?? null; changedFrom = null;
    await run();
  };
  card.reset = () => { current = null; history = []; locked.clear(); changedFrom = null; teamsTitle = null; draftId = null; };
  return card;
}

// What's off about some teams and the smallest swaps that fix it, from a build-teams check ({ teams }).
// onApply(suggestion); onUndo shows an Undo button when given.
function suggestionsPanel(res, { onApply, onUndo }) {
  const detail = me.role === 'super' || me.role === 'organizer';
  const tn = teamNames(res.options[0]?.teams.map(t => t.players) ?? []);
  const who = p => h('span', {}, h('b', {}, p.name), h('span', { class: 'muted' }, ` (${tn[p.team - 1] ?? `Team ${p.team}`})`));
  const basis = !detail ? null : res.suggestRater ? `Based on ${firstName(res.options[0]?.byRater?.find(r => r.rater_id === res.suggestRater)?.name)}'s ratings` : 'Based on the combined ratings';
  return h('div', { class: 'suggestions' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h3', {}, 'Suggestions'), h('p', { class: 'muted small', style: 'margin:2px 0 0' },
        basis && h('b', {}, basis, '. '), 'The smallest changes that make your teams more even. To keep a player where they are, tap them, then their lock.')),
      onUndo && h('button', { type: 'button', class: 'ghost sm', onclick: onUndo }, 'Undo')),
    res.problems?.length > 0 && h('ul', { class: 'problems' }, res.problems.map(x => h('li', {}, x))),
    res.suggestions?.length
      ? h('ol', { class: 'suggest-list' }, res.suggestions.map(sg => h('li', {},
        h('div', { class: 'grow' },
          h('div', {}, sg.swaps.length > 1 ? 'Two swaps: ' : 'Swap ', sg.swaps.flatMap(([a, b], n) => [n ? ', and ' : '', who(a), ' with ', who(b)])),
          h('div', { class: 'muted small' }, [
            detail && sg.gap && `Gap ${num2(sg.gap[0])} → ${num2(sg.gap[1])}`,
            sg.fixes.length > 0 && `fixes: ${sg.fixes.join('; ')}`,
            !detail && !sg.fixes.length && 'makes teams more even',
          ].filter(Boolean).join(' · ')),
          sg.adds.length > 0 && h('div', { class: 'small warn-text' }, `But: ${sg.adds.join('; ')}`)),
        h('button', { type: 'button', class: 'sm', onclick: () => onApply(sg) }, 'Apply'))))
      : h('p', { class: 'muted' }, res.problems?.length ? 'Swapping one or two players doesn\'t fix this. Try a different option or build again.' : 'These teams are even. No swap would make them better.'));
}

let gameDate = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
export const setGameDate = d => { gameDate = d; };

// Work on Teams kept on this device, so a reload, a locked phone or a trip to WhatsApp doesn't lose it: the built
// options with their swaps, Undo and locks, or your own checked teams, plus combos, the setter plan and the switches.
// Kept until its game day has passed; cleared on sign out. Only this device has it (to hand over, save the teams).
// { at, day, shows: 'built' | 'own', built, own, combos, setterPlan, switches }
const TEAMS_KEY = 'setme.teams';
export const teamsStore = {
  read() { try { const v = JSON.parse(localStorage.getItem(TEAMS_KEY)); return v?.day && v.day >= today() ? v : null; } catch { return null; } },
  write(patch) {
    const v = { ...(this.read() ?? {}), ...patch, at: Date.now(), day: gameDate,
      combos: sessionCombos, setterPlan: [...setterPlan], switches: { mixTeammates, adjustResults, spreadWomen } };
    try { localStorage.setItem(TEAMS_KEY, JSON.stringify(v)); return true; } catch { return false; } // full or blocked
  },
  clear() { try { localStorage.removeItem(TEAMS_KEY); } catch { /* nothing kept */ } },
};
{
  const kept = teamsStore.read();
  if (kept) {
    gameDate = kept.day;
    sessionCombos.push(...(kept.combos ?? []));
    for (const [id, v] of kept.setterPlan ?? []) setterPlan.set(id, v);
    ({ mixTeammates = mixTeammates, adjustResults = adjustResults, spreadWomen = spreadWomen } = kept.switches ?? {});
  }
}
// Combos, setters and switches change without a redraw: keep them when the page is left or hidden.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') teamsStore.write({}); });
export const dayTitle = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return iso ? new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) : '';
};

// Rendered as soon as the teams show (and again when the date changes), so a tap can share straight away;
// iOS drops the tap if we draw first.
function shareButton(teams, i) {
  let blob = null, ready, name, btn;
  const prep = () => {
    if (btn && !btn.isConnected) return document.removeEventListener('gamedate', prep);
    name = `teams-${gameDate || 'lineup'}${i ? `-${i + 1}` : ''}.png`;
    blob = null;
    ready = courtImage(teams, { title: dayTitle(gameDate), colors: TEAM_COLORS, names: teamNames(teams.map(t => t.players)) }).then(b => (blob = b));
  };
  prep();
  document.addEventListener('gamedate', prep);
  btn = h('button', { class: 'ghost sm', onclick: async () => sharePng(blob ?? await ready, name) }, 'Share image');
  return btn;
}

// Share sheet where there is one (phones), else copy to the clipboard, else download.
export async function sharePng(b, name) {
  const file = new File([b], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch (e) { if (e.name !== 'AbortError') toast('Could not share'); }
    return;
  }
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); toast('Image copied, paste it in WhatsApp'); }
  catch { h('a', { href: URL.createObjectURL(b), download: name }).click(); toast('Image downloaded'); }
}

// Recap image for one game or a game day. Drawn ahead of the tap (iOS drops a share that waits on drawing);
// call the returned refresh() with new docs when the tags change.
// teamName: (team number, round) -> the team's name on the image. lineups: () -> who was on each team
// ([{ round, teams: [{ k, ids }] }]), read at each refresh so late changes show.
export function recapButton(label, title, subtitle, file, pname, teamName, lineups = () => []) {
  let blob = null, ready = null, timer = null;
  const btn = h('button', { class: 'sm', disabled: true, onclick: async () => { const b = blob ?? await ready; if (b) sharePng(b, file); } }, label);
  const refresh = docs => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const data = recap(docs);
      btn.disabled = !data.results.length;
      blob = null;
      ready = recapImage(data, { title, subtitle, name: id => pname.get(id) ?? 'Someone', colors: TEAM_COLORS, teamName, lineups: lineups() }).then(b => (blob = b));
    }, 300);
  };
  return { btn, refresh };
}

// Setter / Backup badge with how they play tonight. With onSetter (your own teams) it's a button that flips all game / rotates.
export function setterBadge(p, onSetter) {
  if (p.setting !== 'M' && p.setting !== 'B') return null;
  // Short so it fits beside a long name and the lock; the colour (filled = main, outline = backup) still says which.
  const text = p.allGame ? 'Sets all game' : p.setting === 'M' ? 'Setter' : 'Backup';
  const cls = `badge ${p.setting === 'M' ? 'set' : 'backup'}`;
  if (!onSetter || p.id == null) return h('span', { class: cls }, text);
  return h('button', { type: 'button', class: `${cls} badge-btn`, 'aria-pressed': String(!!p.allGame),
    title: `${p.setting === 'M' ? 'Main setter' : 'Backup setter'}: ${p.allGame ? 'sets all game (tap: rotates)' : 'rotates (tap: sets all game)'}`, onclick: () => onSetter(p.id) }, text);
}

const LOCK_PATH = { on: 'M7 11V8a5 5 0 0 1 10 0v3', off: 'M7 11V8a5 5 0 0 1 9.6-2' };
const lockIcon = on => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="${on ? LOCK_PATH.on : LOCK_PATH.off}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`;
  return svg;
};

// A "More" menu for buttons already made; tapping one closes it.
function moreMenu(items) {
  const box = h('details', { class: 'menu more' }, h('summary', { class: 'ghost-btn' }, 'More'),
    h('div', { class: 'menu-list', role: 'menu' }, items.filter(Boolean)));
  box.addEventListener('click', e => { if (e.target.closest('.menu-list button')) box.open = false; });
  return box;
}

// onSwap(i, teams): tap a player, then a player on another team, to swap them; teams = player ids per team after the swap.
// locked: a Set of locked ids, or i => that option's Set (none: no locks on it); onLock(id, i).
// extra: shown under option 1, or i => what to show under option i.
// open: which option shows when there are several (a switcher picks); onOpen(i) is told when it changes.
// edited(i): option i was swapped since it was built (marked on its tab). notice: shown above the teams, or i => that.
// Before saving: anything an organizer would want to know first. Uneven teams (A bit uneven or worse), a team with no
// setter or backup, or someone who isn't on the playing list. Nothing to say: saves straight away.
async function okToSave(opt, off = new Set()) {
  const teams = opt.teams.map(t => t.players), names = teamNames(teams);
  const t = opt.teams.map(x => x.weighted), gap = Math.max(...t) - Math.min(...t);
  const issues = [
    gap > 0.6 && `The teams are ${evenness(gap).toLowerCase()}: a gap of ${num2(gap)} (${GAP_SCALE.toLowerCase().replace(/\.$/, '')}).`,
    ...teams.map((ps, k) => !ps.some(p => p.setting === 'M' || p.setting === 'B') && `${names[k]} has no setter or backup setter.`),
    off.size > 0 && `${teams.flat().filter(p => off.has(p.id)).map(p => p.name).join(', ')} ${off.size === 1 ? 'isn\'t' : 'aren\'t'} on the playing list.`,
  ].filter(Boolean);
  if (!issues.length) return true;
  return ask('Save these teams anyway?', issues.join(' '), 'Save anyway', 'ball');
}
// onSave(i): saves option i as the game day's teams for the Scores page.
// onDraft(i): keeps option i as a draft to compare or come back to; onUpdateDraft(i) saves it over the draft it came from.
// pool: active players ({ id, name, playing }) to replace someone with (tap them, then Replace with); goes through onSwap.
function showTeams(res, { title, locked, onLock, view: viewId = null, onView, onSetter, onSwap, onSave, onDraft, onUpdateDraft, pool, extra, open = 0, onOpen, edited, notice } = {}) {
  const detail = me.role === 'super' || me.role === 'organizer';
  const parts = res.warnings.map(w => h('p', { class: 'warn' }, w));
  const sections = [];
  const gapOf = opt => { const t = opt.teams.map(x => x.weighted); return Math.max(...t) - Math.min(...t); };
  // Several options: a row of tabs with each one's gap and repeat teammates; one option shows at a time.
  if (res.options.length > 1) {
    const tabs = h('div', { class: 'option-tabs', role: 'tablist', 'aria-label': 'Options' });
    const show = i => {
      open = i;
      [...tabs.children].forEach((b, n) => { b.setAttribute('aria-selected', String(n === i)); b.tabIndex = n === i ? 0 : -1; });
      sections.forEach((sec, n) => { sec.hidden = n !== i; });
      onOpen?.(i);
    };
    res.options.forEach((opt, i) => tabs.append(h('button', { type: 'button', role: 'tab', id: `opt-tab-${i}`, 'aria-controls': `opt-${i}`, 'data-key': lineupKey(optionIds(opt)),
      onclick: () => show(i),
      onkeydown: e => {
        const to = { ArrowRight: i + 1, ArrowLeft: i - 1 }[e.key];
        if (to == null) return;
        const n = (to + res.options.length) % res.options.length;
        show(n); tabs.children[n].focus();
      } },
      h('b', {}, `Option ${i + 1}`, edited?.(i) ? h('span', { class: 'tab-mark' }, ' · swapped') : '', h('span', { class: 'tab-mark saved-mark' }, ' · saved')),
      detail && h('span', { class: 'tab-verdict' }, evenness(gapOf(opt))),
      h('span', { class: 'small' }, [detail && `Gap ${num2(gapOf(opt))}`,
        res.variety > 0 && (opt.repeats?.length ? `${opt.repeats.length} ${opt.repeats.length === 1 ? 'pair' : 'pairs'} again` : 'no pairs again')].filter(Boolean).join(' · ')))));
    parts.push(tabs);
    queueMicrotask(() => show(Math.min(open, res.options.length - 1)));
  }
  // Said in each option's Details rather than above the tabs.
  const adjustedNote = () => res.adjusted != null && h('p', { class: 'muted small' }, res.adjusted
    ? `Adjusted for results: ${res.adjusted} player${res.adjusted === 1 ? '\'s' : 's\''} numbers moved by how their teams have done against their ratings.`
    : `Adjust for results is on, but there aren't enough games with scores yet (${ADJUST_MIN_GAMES} needed), so nothing moved.`);
  res.options.forEach((opt, i) => {
    const tn = teamNames(opt.teams.map(t => t.players));
    const text = opt.teams.map((t, k) => `${tn[k]}: ${t.players.map(p => p.name + setterMark(p.setting)).join(', ')}`).join('\n');
    // Whose numbers the cards show. null = combined (what the teams were judged on), else one rater's alone.
    const views = [{ id: null, name: 'Combined', totals: opt.teams.map(t => t.weighted), sums: opt.teams.map(t => t.sums), guessed: null },
      ...(opt.byRater ?? []).map(r => ({ id: r.rater_id, name: r.name, totals: r.totals, sums: r.sums, guessed: r.guessed }))];
    let view = views.find(v => v.id === viewId) ?? views[0];
    const withSet = opt.teams.some(t => t.players.some(p => p.allGame));
    // One short line under the tabs; the full story folds into Details.
    const gapLine = h('p', { class: 'verdict', tabindex: -1 });
    const gapStory = h('p', { class: 'muted small' });
    const grid = h('div', { class: 'team-grid', 'data-n': opt.teams.length });
    const guessNote = h('p', { class: 'muted small', hidden: true });
    const lk = typeof locked === 'function' ? locked(i) : locked;
    const busy = () => { grid.classList.add('busy'); grid.setAttribute('aria-busy', 'true'); gapLine.replaceChildren(h('b', {}, 'Checking…'), h('span', { class: 'muted small' }, 'Working out the new teams.')); };
    // On a team but not on the playing list (only known once a playing list is set).
    const playingIds = pool?.some(p => p.playing) ? new Set(pool.filter(p => p.playing).map(p => p.id)) : null;
    const off = new Set(playingIds ? opt.teams.flatMap(t => t.players.filter(p => p.id != null && !playingIds.has(p.id)).map(p => p.id)) : []);
    // Swapping: the player tapped first, as [team index, player id].
    let picked = null;
    // Picking redraws the cards: focus goes back to the player just tapped.
    const refocus = id => grid.querySelector(`.pick[data-pid="${id}"]`)?.focus();
    const pick = (k, id) => {
      if (!picked || picked[1] === id) { picked = picked ? null : [k, id]; paint(); return refocus(id); }
      if (picked[0] === k) { picked = [k, id]; paint(); return refocus(id); }
      const [a, b] = [picked[1], id];
      picked = null;
      busy();
      focusAfterDraw(FOCUS_CHANGE);
      onSwap(i, opt.teams.map(t => t.players.map(p => p.id === a ? b : p.id === b ? a : p.id)));
    };
    const canSwap = onSwap && opt.teams.every(t => t.players.every(p => p.id != null));
    const name = (k, p) => !canSwap ? [avatar(p.name, 28), h('span', { class: 'pname' }, p.name)]
      : [h('button', { type: 'button', class: 'pick', 'data-pid': p.id, 'aria-pressed': String(picked?.[1] === p.id),
        title: picked && picked[0] !== k ? `Swap with ${pickedName()}` : `Swap ${p.name} with someone`,
        // Said out loud: what a tap does now, and the suggestion rank when there is one.
        'aria-label': picked?.[1] === p.id ? `${p.name}, picked. Tap again to cancel`
          : picked && picked[0] !== k ? `Swap ${p.name} with ${pickedName()}${hints?.findIndex(x => x.id === p.id) >= 0 ? `, suggested swap ${hints.findIndex(x => x.id === p.id) + 1}` : ''}`
          : `${p.name}: pick to swap`,
        onclick: () => pick(k, p.id) }, avatar(p.name, 28), h('span', { class: 'pname' }, p.name))];
    // Best swaps for the tapped player (from the server, judged like Suggestions): listed under their team, marked on the others.
    let hints = null;
    const rank = id => { const n = hints.findIndex(x => x.id === id); return n >= 0 && h('span', { class: 'badge hint-rank', title: `Swap #${n + 1} for ${pickedName()}` }, `#${n + 1}`); };
    const pickedName = () => opt.teams[picked[0]].players.find(x => x.id === picked[1])?.name;
    // Someone dropped out: put another player in the tapped player's place (bench = playing but on no team, listed first).
    const replaceRow = () => {
      if (!pool?.length) return null;
      const on = new Set(opt.teams.flatMap(t => t.players.map(p => p.id)));
      const free = pool.filter(p => !on.has(p.id));
      if (!free.length) return null;
      const bench = free.filter(p => p.playing), rest = free.filter(p => !p.playing);
      const opts = list => list.map(p => h('option', { value: p.id }, p.name));
      const sel = h('select', { 'aria-label': `Replace ${pickedName()} with` }, h('option', { value: '' }, bench.length ? 'Choose player' : 'Choose player (nobody else is playing)'),
        bench.length > 0 && h('optgroup', { label: 'Playing, on no team' }, opts(bench)),
        rest.length > 0 && h('optgroup', { label: bench.length ? 'Not on the playing list' : 'Everyone else' }, opts(rest)));
      sel.onchange = () => {
        const to = Number(sel.value), from = picked[1];
        if (!to) return;
        picked = null;
        busy();
        focusAfterDraw(FOCUS_CHANGE);
        onSwap(i, opt.teams.map(t => t.players.map(p => p.id === from ? to : p.id)));
      };
      return h('div', { class: 'row replace-row' }, h('span', { class: 'small' }, h('b', {}, `Replace ${pickedName()} with`)), sel);
    };
    const hintBox = k => {
      const who = pickedName();
      if (!hints) return h('div', { class: 'swap-hints' }, replaceRow());
      if (!hints.length) return h('div', { class: 'swap-hints' }, replaceRow(), h('p', { class: 'muted small' }, `${who} is locked or paired by a combo, so there's no swap to suggest.`));
      return h('div', { class: 'swap-hints' }, replaceRow(),
        h('p', { class: 'small' }, h('b', {}, `Best swaps for ${who}`), hints.some(x => x.better) ? '' : h('span', { class: 'muted' }, ' · the teams are already as even as a swap can make them')),
        h('ol', {}, hints.map(x => h('li', {},
          h('div', { class: 'grow' },
            h('div', {}, h('b', {}, x.name), h('span', { class: 'muted' }, ` (${tn[x.team - 1]})`)),
            h('div', { class: 'muted small' }, [
              detail && `Gap ${num2(x.gap[0])} → ${num2(x.gap[1])}`,
              x.fixes.length > 0 && `fixes: ${x.fixes.join('; ')}`,
              !x.better && 'not better',
              !detail && x.better && !x.fixes.length && 'more even',
            ].filter(Boolean).join(' · ')),
            x.adds.length > 0 && h('div', { class: 'small warn-text' }, `But: ${x.adds.join('; ')}`)),
          h('button', { type: 'button', class: x.better ? 'sm' : 'ghost sm', onclick: () => pick(x.team - 1, x.id) }, x.better ? 'Swap' : 'Swap anyway')))));
    };
    const swapHint = h('p', { class: 'small swap-hint', role: 'status' });
    const paint = () => {
      hints = picked && opt.partners ? opt.partners[picked[1]] ?? [] : null;
      swapHint.classList.toggle('muted', !picked);
      swapHint.replaceChildren(...(picked
        ? [h('b', {}, `Picked: ${pickedName()} (${tn[picked[0]]}).`), ` Tap a player on another team to swap${opt.partners ? ' (best swaps are numbered)' : ''}, or tap ${firstName(pickedName())} again to cancel.${onLock && lk ? ` The lock keeps ${firstName(pickedName())} on this team.` : ''}`]
        : [opt.partners ? 'Tap a player to see their best swaps or replace them.' : 'Tap a player, then one on another team, to swap them.']));
      const totals = view.totals, hi = Math.max(...totals), lo = Math.min(...totals);
      const reps = res.variety > 0 && opt.repeats && (opt.repeats.length ? `${opt.repeats.length} ${opt.repeats.length === 1 ? 'pair' : 'pairs'} again` : 'no pairs again');
      gapLine.replaceChildren(h('b', {}, evenness(hi - lo)), h('span', { class: 'muted small' },
        [view.id && `${view.name.split(/[\s.@]/)[0]}'s ratings`, `Gap ${num2(hi - lo)}`, reps].filter(Boolean).join(' · ')));
      gapStory.textContent = `${view.id ? `By ${view.name.split(/[\s.@]/)[0]}'s ratings, team` : 'Team'} totals ${num2(lo)} to ${num2(hi)}: a gap of ${num2(hi - lo)} between the strongest and weakest team. ${GAP_SCALE}`;
      grid.classList.toggle('picking', !!picked);
      grid.replaceChildren(...opt.teams.map((t, k) => h('article', { class: `team${picked?.[0] === k ? ' from' : ''}`, style: `--tc: ${TEAM_COLORS[k % TEAM_COLORS.length]}` },
        h('header', {}, h('h4', {}, tn[k]), detail && h('span', { class: 'total', title: view.guessed?.[k] ? `${view.guessed[k]} not rated by ${view.name}; their level until rated was used` : null },
          h('small', {}, 'Total'), num2(totals[k]), view.guessed?.[k] ? '*' : '')),
        h('ul', {}, t.players.map(p => h('li', { class: hints?.some(x => x.id === p.id) ? 'suggested' : null }, ...name(k, p),
          hints && rank(p.id),
          off.has(p.id) && h('span', { class: 'badge off-list', title: `${p.name} isn't on the playing list. Tap them to replace them.` }, 'Not playing'),
          setterBadge(p, onSetter),
          onLock && lk && p.id != null && h('button', { type: 'button', class: 'lock', 'data-lock': p.id, 'aria-pressed': String(lk.has(p.id)),
            title: lk.has(p.id) ? `${p.name} stays on this team (tap to unlock)` : `Keep ${p.name} on this team`,
            'aria-label': lk.has(p.id) ? `Unlock ${p.name}` : `Lock ${p.name} on this team`, onclick: () => { focusAfterDraw(`[data-lock="${p.id}"]`); onLock(p.id, i); } }, lockIcon(lk.has(p.id)))))),
        picked?.[0] === k && hintBox(k),
        detail && h('div', { class: `stats${withSet ? ' six' : ''}` }, [...SKILLS, ...(withSet ? ['setting'] : [])].map(s => h('div', { title: s === 'setting' ? 'Setting' : LABEL[s] }, h('small', { 'aria-hidden': 'true' }, s === 'setting' ? 'Set' : SHORT[s]), h('span', { class: 'visually-hidden' }, `${s === 'setting' ? 'Setting' : LABEL[s]} `), h('b', {}, fmt(view.sums[k][s] ?? 0))))))));
      guessNote.hidden = !view.guessed?.some(Boolean);
      guessNote.textContent = `* Some players on that team aren't rated by ${view.name.split(/[\s.@]/)[0]}, so their level until rated (set on Players) was used.`;
    };
    const chips = views.length > 2 ? h('div', { class: 'rater-chips view-chips', role: 'group', 'aria-label': 'Whose ratings to show' }, views.map(v => {
      const b = h('button', { type: 'button', class: 'rater-chip', 'aria-pressed': String(v === view), title: v.id ? v.name : 'All picked raters combined' },
        v.id ? avatar(v.name, 24) : null, h('span', {}, v.id ? v.name.split(/[\s.@]/)[0] : v.name));
      b.onclick = () => { if (v === view) return; view = v; chips.querySelectorAll('button').forEach((x, n) => x.setAttribute('aria-pressed', String(views[n] === view))); paint(); onView?.(v.id); };
      return b;
    })) : null;
    paint();
    const skillsBtn = detail && h('button', { type: 'button', class: 'ghost sm skills-btn', 'aria-pressed': String(showSkills), onclick: () => {
      showSkills = !showSkills;
      document.documentElement.classList.toggle('hide-skills', !showSkills);
      document.querySelectorAll('.skills-btn').forEach(b => { b.setAttribute('aria-pressed', String(showSkills)); b.textContent = showSkills ? 'Hide skill numbers' : 'Show skill numbers'; });
    } }, showSkills ? 'Hide skill numbers' : 'Show skill numbers');
    const section = h('section', { class: 'option', id: res.options.length > 1 ? `opt-${i}` : null, role: res.options.length > 1 ? 'tabpanel' : null, 'aria-labelledby': res.options.length > 1 ? `opt-tab-${i}` : null, 'data-label': title ?? `Option ${i + 1}`, 'data-key': opt.teams.every(t => t.players.every(p => p.id != null)) ? lineupKey(optionIds(opt)) : null },
      h('div', { class: 'card-head' }, h('div', {},
        // With tabs the tab already names the option (and says saved); a single option keeps its title.
        res.options.length === 1 && h('div', { class: 'option-title' }, h('h3', {}, title ?? `Option ${i + 1}`), h('span', { class: 'badge saved-badge' }, '✓ Saved')),
        detail ? gapLine : res.variety > 0 && repeatLine(opt.repeats, res.variety)),
      ),
      h('div', { class: 'option-actions' },
        onSave && saveButton(async () => { if (await okToSave(opt, off)) return onSave(i); }),
        shareButton(opt.teams, i),
        moreMenu([
          onUpdateDraft && h('button', { type: 'button', role: 'menuitem', title: 'Save these teams over the draft you opened', onclick: () => onUpdateDraft(i) }, 'Update draft'),
          onDraft && h('button', { type: 'button', role: 'menuitem', class: 'draft-btn', hidden: !draftsOk, onclick: () => onDraft(i) }, onUpdateDraft ? 'Save as new draft' : 'Save draft'),
          h('button', { type: 'button', role: 'menuitem', onclick: () => navigator.clipboard.writeText(text).then(() => toast('Copied')) }, 'Copy text'),
        ])),
      detail && h('details', { class: 'option-more' }, h('summary', {}, 'Details'),
        gapStory, res.variety > 0 && repeatLine(opt.repeats, res.variety), adjustedNote(),
        chips && h('div', { class: 'field raters view' }, h('span', {}, 'Show numbers from'), chips)),
      canSwap && swapHint,
      typeof notice === 'function' ? notice(i) : notice,
      grid, detail && h('div', { class: 'row option-foot' }, guessNote, h('span', { class: 'grow' }), skillsBtn),
      typeof extra === 'function' ? extra(i) : i === 0 && extra);
    sections.push(section);
    parts.push(section);
  });
  if (!res.options.length) parts.push(h('p', { class: 'warn' }, 'No lineup found.'));
  if (pendingFocus) {
    const sel = pendingFocus; pendingFocus = null;
    queueMicrotask(() => {
      const shown = sections.find(sec => !sec.hidden && sec.isConnected) ?? sections.find(sec => sec.isConnected);
      (shown?.querySelector(sel) ?? shown?.querySelector(FOCUS_VERDICT))?.focus({ preventScroll: true });
    });
  }
  if (detail) parts.push(h('p', { class: 'muted small weights' }, `Each skill number adds up the team's players. A team's total counts some skills more: ${SKILLS.map(s => [s, WEIGHTS[s]]).sort((a, b) => b[1] - a[1]).map(([s, w]) => `${LABEL[s]} ×${fmt(w)}`).join(', ')}.`,
    res.options.some(o => o.teams.some(t => t.players.some(p => p.allGame))) && ` Setters who set all game add their Setting ×${fmt(SETTING_WEIGHT)}, with their receiving at ${ALL_GAME.receiving * 100}% and hitting at ${ALL_GAME.hitting * 100}%.`));
  return parts;
}

// Who's on the same team again as on a recent game day.
const AGO = ['last time', 'two game days ago', 'three game days ago'];
function repeatLine(repeats = [], days) {
  if (!repeats.length) return h('p', { class: 'muted small', style: 'margin:2px 0 0' }, `No teammates from the last ${days === 1 ? 'game day' : `${days} game days`} together again.`);
  const shown = repeats.slice(0, 4).map(r => `${firstName(r.a)} & ${firstName(r.b)} (${AGO[r.ago] ?? 'recently'})`).join(', ');
  return h('p', { class: 'muted small', style: 'margin:2px 0 0', title: repeats.map(r => `${r.a} & ${r.b}: ${AGO[r.ago]}`).join('\n') },
    `Teammates again: ${shown}${repeats.length > 4 ? `, and ${repeats.length - 4} more` : ''}`);
}

// ---------- drafts (organizers) ----------
// Lineups kept to compare or come back to (supabase/club.sql). Returns true once saved.
async function saveDraft(teams, opts, label) {
  const name = prompt('Name this draft', `${label} · ${dayTitle(gameDate) || 'no date'}`);
  if (name == null) return false;
  try {
    await q(sb.from('drafts').insert({ name: name.trim() || label, played_on: gameDate || null, teams, raters: opts.raters ?? null,
      all_game: opts.allGame ?? [], combos: opts.combos ?? [] }));
    toast('Draft saved');
    return true;
  } catch (e) { toast(missing(e) ? needsSql('Drafts', 'club.sql') : e.message); return false; }
}

// Set once the drafts table answers (club upgrade), so Save draft only shows when it can work.
let draftsOk = false;
// Saved drafts side by side: each one re-checked with today's ratings (gap, what's off, repeat teammates).
function draftsCard(ownTeams) {
  const card = h('div', { class: 'card', hidden: true });
  card.refresh = async () => {
    let drafts;
    try { drafts = await q(sb.from('drafts').select('*').order('created_at', { ascending: false }).limit(12)); }
    catch { card.hidden = true; return; }
    if (!draftsOk) { draftsOk = true; document.querySelectorAll('.draft-btn').forEach(b => { b.hidden = false; }); }
    card.hidden = !drafts.length;
    if (!drafts.length) return card.replaceChildren();
    const body = h('tbody');
    const row = d => {
      const cells = { gap: h('td', { class: 'num muted' }, '…'), off: h('td', { class: 'num muted' }, '…'), rep: h('td', { class: 'num muted' }, '…') };
      const offNote = h('div', { class: 'small warn-text', hidden: true });
      callFn('build-teams', { teams: d.teams, raters: d.raters, allGame: d.all_game, combos: d.combos, useCombos: true, ...buildExtras(), playedOn: d.played_on })
        .then(res => {
          const tot = res.options[0].teams.map(t => t.weighted);
          cells.gap.replaceChildren(h('b', {}, fmt(Math.max(...tot) - Math.min(...tot)))); cells.gap.className = 'num';
          cells.off.textContent = String(res.problems?.length ?? 0); cells.off.className = 'num';
          cells.rep.textContent = res.variety ? String(res.options[0].repeats?.length ?? 0) : '–'; cells.rep.className = 'num';
          const gone = res.offList?.out ?? [];
          if (gone.length) { offNote.hidden = false; offNote.textContent = `Not playing now: ${gone.map(p => p.name).join(', ')}. Open it to replace them.`; }
        }).catch(e => { cells.gap.textContent = '!'; cells.gap.title = e.message; });
      return h('tr', {},
        h('td', {}, h('b', {}, d.name), h('div', { class: 'muted small' }, `${d.teams.length} teams of ${d.teams.map(t => t.length).join('/')}${d.played_on ? ` · for ${dayTitle(d.played_on)}` : ''}`), offNote),
        cells.gap, cells.off, cells.rep,
        h('td', {}, h('div', { class: 'row', style: 'gap:6px; justify-content:flex-end' },
          h('button', { class: 'sm', onclick: () => ownTeams.load(d.teams, d.name, d.id) }, 'Open'),
          h('button', { class: 'ghost sm', 'aria-label': `Delete ${d.name}`, onclick: async () => {
            if (!await ask(`Delete the draft "${d.name}"?`, 'Teams saved for a day aren\'t affected.', 'Delete draft')) return;
            try { await q(sb.from('drafts').delete().eq('id', d.id)); card.refresh(); } catch (e) { toast(e.message); }
          } }, 'Delete'))));
    };
    body.replaceChildren(...drafts.map(row));
    card.replaceChildren(
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Drafts'),
        h('p', { class: 'muted small', style: 'margin:2px 0 0' }, 'Lineups you kept, checked again with today\'s ratings and the switches above. Lower gap is more even. Open one to swap, share or save it for scores.'))),
      h('div', { class: 'scroll' }, stacked(h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Draft'), h('th', { class: 'num', title: 'Strongest team minus weakest' }, 'Gap'), h('th', { class: 'num', title: 'Problems: setters, weak passers bunched, combos…' }, 'Issues'),
          h('th', { class: 'num', title: 'Pairs who were teammates on a recent game day' }, 'Repeats'), h('th', {}, ''))),
        body))));
  };
  card.refresh();
  document.addEventListener('drafts', () => { if (card.isConnected) card.refresh(); });
  return card;
}

// Playing tonight with no ratings yet: whoever builds picks a stand-in level for each.
function newPlayersCard(getRaters) {
  const card = h('div', { class: 'card', hidden: true });
  card.refresh = () => callFn('build-teams', { check: true, raters: getRaters() }).then(({ unrated }) => {
    card.hidden = !unrated.length;
    card.replaceChildren(
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'New players'),
        h('p', { class: 'muted small', style: 'margin:2px 0 0' }, 'Nobody has rated them yet. Pick how good they look; they\'re spread across teams either way.'))),
      h('div', { class: 'new-players' }, unrated.map(p => h('div', { class: 'new-player' }, h('b', {}, p.name),
        seg(TIER_OPTIONS, p.tier, async v => {
          try { await q(sb.from('players').update({ tier: v }).eq('id', p.id)); toast('Saved'); }
          catch (e) { toast(`Not saved: ${e.message}`); return false; }
        }, `${p.name} level`)))));
  }).catch(() => {});
  card.refresh();
  return card;
}

// Tap raters on or off; teams are built from the ones left on. Everyone is on to start.
// `preload` ({ ratings, profiles }) skips the fetch when the page already has them.
export async function raterPicker(onchange, preload) {
  const [rows, profiles] = preload ? [preload.ratings, [...preload.profiles].sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? ''))]
    : await Promise.all([
      q(sb.from('ratings').select('rater_id')),
      q(sb.from('profiles').select('id,display_name').order('display_name')),
    ]);
  const has = new Set(rows.map(r => r.rater_id));
  const raters = profiles.filter(p => has.has(p.id));
  if (raters.length < 2) return null;
  const on = new Set(raters.map(r => r.id));
  const reset = h('button', { type: 'button', class: 'ghost sm', hidden: true }, 'Select all');
  const clear = h('button', { type: 'button', class: 'ghost sm' }, 'Deselect all');
  const chips = raters.map(r => {
    const name = (r.display_name ?? '?').split(/[\s.@]/)[0];
    const b = h('button', { type: 'button', class: 'rater-chip', 'aria-pressed': 'true', title: r.display_name },
      avatar(r.display_name ?? '?', 24), h('span', {}, r.id === me.id ? `${name} (me)` : name), h('span', { class: 'tick', 'aria-hidden': 'true' }, '✓'));
    b.onclick = () => {
      on.has(r.id) ? on.delete(r.id) : on.add(r.id);
      paint();
    };
    return [r.id, b];
  });
  const paint = () => {
    for (const [id, b] of chips) b.setAttribute('aria-pressed', String(on.has(id)));
    const all = on.size === raters.length;
    reset.hidden = all;
    clear.hidden = !on.size;
    onchange(all ? null : [...on]);
  };
  reset.onclick = () => { raters.forEach(r => on.add(r.id)); paint(); };
  clear.onclick = () => { on.clear(); paint(); };
  return h('div', { class: 'field raters' },
    h('span', {}, 'Build from ratings by'),
    h('div', { class: 'rater-chips', role: 'group', 'aria-label': 'Raters to use' }, chips.map(([, b]) => b), reset, clear));
}

// Teams saved from the Teams page (Save for scores) become the game day's lineup. Each game stores who played on
// each side and the team numbers the ratings predicted at that moment, so late changes and rating changes don't
// rewrite history. Insights compare predictions with results to tune the team builder.
async function saveLineup(teams, { raters, allGame, source }) {
  const day = gameDate;
  if (!day) return toast('Pick a date first');
  try {
    const [existing] = await q(sb.from('sessions').select('id').eq('played_on', day));
    const row = { played_on: day, teams, raters: raters ?? null, all_game: allGame ?? [], source };
    if (existing) {
      // Rounds (rounds.sql): null before the upgrade. The round playing now is one past the last one kept.
      const kept = await q(sb.from('rounds').select('n').eq('session_id', existing.id)).catch(() => null);
      const cur = kept ? kept.length + 1 : 1;
      const games = await q(sb.from('games').select('*').eq('session_id', existing.id));
      const n = (kept ? games.filter(g => (g.round ?? 1) === cur) : games).length;
      const roundWord = cur > 1 ? `round ${cur}'s teams` : 'the teams';
      if (n && kept) {
        const pick = await choose(`${dayTitle(day)} already has ${n} game${n > 1 ? 's' : ''}${cur > 1 ? ` in round ${cur}` : ''}`,
          `Start round ${cur + 1} to keep ${cur > 1 ? `round ${cur}` : 'the teams so far'} with ${n > 1 ? 'their' : 'its'} games and standings, and play on with these. Or replace ${roundWord}; saved games keep the players they had.`,
          [['round', `Start round ${cur + 1}`, 'ball'], ['replace', `Replace ${roundWord}`, 'ghost']]);
        if (!pick) return;
        if (pick === 'round') {
          const r = await q(sb.rpc('start_round', { p_session: existing.id, p_teams: teams, p_raters: raters ?? null, p_all_game: allGame ?? [], p_source: source }));
          toast(`Round ${r} saved for ${dayTitle(day)}`);
          return document.dispatchEvent(new Event('lineupsaved'));
        }
      } else if (n) {
        const upgrade = me.role === 'super' ? ' To keep them as round 1 instead, run supabase/rounds.sql.' : '';
        if (await choose(`${dayTitle(day)} already has ${n} game${n > 1 ? 's' : ''}`, `Replace the teams? Saved games keep the players they had.${upgrade}`, [[true, 'Replace the teams', 'danger']]) !== true) return;
      } else if (await choose(`Teams are already saved for ${dayTitle(day)}`, `Replace ${roundWord} with these? No games have been entered${cur > 1 ? ' in this round' : ''} yet.`, [[true, 'Replace', 'danger']]) !== true) return;
      await q(sb.from('sessions').update(row).eq('id', existing.id));
    } else await q(sb.from('sessions').insert(row));
    toast(`Saved as the teams for ${dayTitle(day)}`);
    document.dispatchEvent(new Event('lineupsaved'));
  } catch (e) { toast(/relation|does not exist|schema cache/i.test(e.message) ? needsSql('Scores', 'scores.sql') : `Not saved: ${e.message}`); }
}
