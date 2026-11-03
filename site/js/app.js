import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { SKILLS, RATED, TIERS, WEIGHTS, SETTING_WEIGHT, ALL_GAME, combineRatings, weightedTotal } from './teams.mjs';
import { matchPasted, parseTeams } from './paste.mjs';
import { readRatingsCsv, ratingsTemplate, ratingsExport } from './csv.mjs';
import { courtImage } from './courtimg.mjs';

// supabase-js 2.45.4, self-hosted in vendor/ (loaded by index.html as window.supabase)
// Auth calls are serialized with an in-page lock; the default browser lock (navigator.locks) can hang.
let lockChain = Promise.resolve();
const lock = (_name, _timeout, fn) => { const run = lockChain.then(fn, fn); lockChain = run.catch(() => {}); return run; };
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { lock } });
const app = document.getElementById('app');
const SHORT = { receiving: 'Rcv', hitting: 'Hit', hustle: 'Hus', serve: 'Srv', blocking: 'Blk', setting_skill: 'Set', consistency: 'Con' };
const LABEL = { receiving: 'Receiving', hitting: 'Hitting', hustle: 'Hustle', serve: 'Serve', blocking: 'Blocking', setting_skill: 'Setting', consistency: 'Consistency' };
// Rated only for players marked as setters (main or backup).
const forPlayer = (s, p) => s !== 'setting_skill' || (p.setting && p.setting !== 'N');
const RATING_OPTIONS = [[null, 'U', 'u'], [0, '0'], [.25, '.25'], [.5, '.5'], [.75, '.75'], [1, '1']];
const TIER_OPTIONS = TIERS.map(t => [t, t[0].toUpperCase() + t.slice(1)]);
const TEAM_COLORS = ['#2f6fde', '#e8663a', '#18a36f', '#c99400', '#8b5cf6', '#d6407a'];
const PAGES = [
  { id: 'rate', label: 'Rate', roles: ['rater', 'organizer', 'super'], view: ratePage },
  { id: 'players', label: 'Players', roles: ['organizer', 'super'], view: playersPage },
  { id: 'teams', label: 'Teams', roles: ['organizer', 'super'], view: teamsPage },
  { id: 'ratings', label: role => role === 'super' ? 'All ratings' : 'My ratings', roles: ['rater', 'organizer', 'super'], view: ratingsPage },
  { id: 'users', label: 'Users', roles: ['super'], view: usersPage },
];

let session = null, me = null;
// Arriving from an invite or reset link means a password needs setting.
let mustSetPassword = /type=(invite|recovery)/.test(location.hash);
// Invite/reset links carry a token that is only used when the person taps Continue (see netlify/functions/admin.mjs).
const query = new URLSearchParams(location.search);
let pendingLink = query.get('token_hash') ? { token_hash: query.get('token_hash'), type: query.get('type') === 'recovery' ? 'recovery' : 'invite' } : null;
// Supabase reports expired or used links in the URL hash.
let linkError = new URLSearchParams(location.hash.slice(1)).get('error_description');

// ---------- helpers ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const q = async p => { const { data, error } = await p; if (error) throw error; return data; };
const fmt = v => v == null ? 'U' : String(Math.round(v * 100) / 100).replace(/^0\./, '.').replace(/^-0\./, '-.');
const firstName = n => (n ?? '?').split(/[\s.@]/)[0];
const setterMark = s => s === 'M' ? ' (S)' : s === 'B' ? ' (B)' : '';
const pageHead = (title, sub, ...right) => h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, title), sub && h('p', {}, sub)), right.length ? h('div', { class: 'row' }, right) : null);

function avatar(name, size) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) % 360;
  const initials = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  return h('span', { class: 'avatar', style: `background: hsl(${hash} 55% 45%)${size ? `; width:${size}px; height:${size}px` : ''}`, 'aria-hidden': 'true' }, initials);
}

// Pick-one buttons. onpick returns false when saving failed, which puts the old choice back.
function seg(options, value, onpick, label) {
  let current = value;
  const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  const paint = () => [...wrap.children].forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === current)));
  for (const [v, text, cls] of options) {
    wrap.append(h('button', { type: 'button', class: cls, onclick: async () => {
      if (v === current) return;
      const prev = current; current = v; paint();
      if (await onpick(v) === false) { current = prev; paint(); }
    } }, text));
  }
  paint();
  return wrap;
}

// On/off switch; the whole label is the tap target. onchange returns false when saving failed.
function toggle(label, checked, onchange) {
  const input = h('input', { type: 'checkbox', checked });
  input.addEventListener('change', async () => { if (await onchange(input.checked) === false) input.checked = !input.checked; });
  return h('label', { class: 'switch' }, input, h('span', { class: 'track', 'aria-hidden': 'true' }), h('span', {}, label));
}

// On narrow screens these tables turn into one card per row; each cell is labelled with its column name.
function stacked(table) {
  table.classList.add('stack');
  const label = () => {
    const heads = [...table.querySelectorAll('thead th')].map(th => th.dataset.label ?? th.textContent);
    for (const tr of table.querySelectorAll('tbody tr')) [...tr.children].forEach((td, i) => { if (heads[i]) td.dataset.label = heads[i]; });
  };
  label();
  new MutationObserver(label).observe(table, { childList: true, subtree: true });
  return table;
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 1800);
}
async function callFn(name, body) {
  const res = await fetch(`/.netlify/functions/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- auth & routing ----------
sb.auth.onAuthStateChange((event, s) => {
  session = s;
  if (event === 'PASSWORD_RECOVERY') mustSetPassword = true;
  if (event === 'SIGNED_OUT') { me = null; render(); }
});
window.addEventListener('hashchange', render);

async function boot() {
  session = (await sb.auth.getSession()).data.session;
  if (session?.user?.user_metadata?.password_set !== true && session) mustSetPassword = true;
  if (/access_token|type=|error/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
  render();
}

async function render() {
  document.body.classList.remove('guide-open'); // only the Rate page has the guide drawer
  const nav = document.getElementById('nav'), who = document.getElementById('who');
  nav.replaceChildren(); who.replaceChildren();
  if (pendingLink) return app.replaceChildren(linkPage());
  if (!session) return app.replaceChildren(loginPage());
  if (mustSetPassword) return app.replaceChildren(passwordPage());
  try {
    me = me || await q(sb.from('profiles').select('*').eq('id', session.user.id).single());
  } catch {
    return app.replaceChildren(h('p', { class: 'warn' }, 'Your account has no profile. Ask the organizer to check your invite.'));
  }
  const pages = PAGES.filter(p => p.roles.includes(me.role));
  const current = pages.find(p => '#' + p.id === location.hash) || pages[0];
  if (pages.length > 1) for (const p of pages) nav.append(h('a', { href: '#' + p.id, class: p === current ? 'on' : null }, typeof p.label === 'function' ? p.label(me.role) : p.label));
  who.append(
    h('div', { class: 'me' }, avatar(me.display_name || '?', 32), h('div', { class: 'who-text' }, h('b', {}, me.display_name), h('small', {}, me.role))),
    h('button', { class: 'ghost sm', onclick: () => sb.auth.signOut() }, 'Sign out'));
  app.replaceChildren(h('p', { class: 'empty' }, 'Loading…'));
  try {
    app.replaceChildren(await current.view());
  } catch (e) {
    app.replaceChildren(h('p', { class: 'warn' }, `Something went wrong: ${e.message}`));
  }
}

const brand = () => h('div', { class: 'brand' }, document.querySelector('.brand svg').cloneNode(true), h('h1', {}, 'Set', h('span', {}, 'Me')));

function linkPage() {
  const invite = pendingLink.type === 'invite';
  const msg = h('p', { class: 'muted small' }, invite ? "Tap Continue, then choose a password." : 'Tap Continue to choose a new password.');
  const btn = h('button', { class: 'big' }, 'Continue');
  btn.onclick = async () => {
    btn.disabled = true;
    const { data, error } = await sb.auth.verifyOtp({ token_hash: pendingLink.token_hash, type: pendingLink.type });
    pendingLink = null;
    history.replaceState(null, '', location.pathname);
    if (error) { linkError = 'This link has expired or was already used. Ask the organizer for a new one.'; session = null; me = null; return render(); }
    session = data.session; me = null; mustSetPassword = true; render();
  };
  return h('div', { class: 'login card' }, brand(), h('p', { class: 'tag' }, invite ? "You're invited to SetMe." : 'Reset your password.'), btn, msg);
}

function loginPage() {
  const email = h('input', { type: 'email', placeholder: 'Email', autocomplete: 'email', 'aria-label': 'Email' });
  const pw = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password', 'aria-label': 'Password' });
  const msg = h('p', { class: 'muted small' }, 'Invite only. Forgot your password? Ask the organizer for a reset link.');
  const go = async e => {
    e.preventDefault();
    const { data, error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value });
    if (error) return msg.replaceChildren(h('span', { class: 'warn' }, error.message));
    session = data.session; render();
  };
  const err = linkError && h('p', { class: 'warn small' }, /expired|invalid|used/i.test(linkError) ? 'This link has expired or was already used. Ask the organizer for a new one.' : linkError);
  linkError = null;
  return h('form', { class: 'login card', onsubmit: go }, brand(), h('p', { class: 'tag' }, 'Fair teams, every session.'), err, email, pw, h('button', { class: 'big' }, 'Sign in'), msg);
}

function passwordPage() {
  const pw = h('input', { type: 'password', placeholder: 'New password (8+ characters)', autocomplete: 'new-password', 'aria-label': 'New password' });
  const msg = h('p', { class: 'muted small' }, "You'll use it with your email to sign in from now on.");
  const go = async e => {
    e.preventDefault();
    if (pw.value.length < 8) return msg.replaceChildren(h('span', { class: 'warn' }, 'Use at least 8 characters.'));
    const { error } = await sb.auth.updateUser({ password: pw.value, data: { password_set: true } });
    if (error) return msg.replaceChildren(h('span', { class: 'warn' }, error.message));
    mustSetPassword = false; toast('Password saved'); render();
  };
  return h('form', { class: 'login card', onsubmit: go }, brand(), h('p', { class: 'tag' }, 'Welcome! Choose a password.'), pw, h('button', { class: 'big' }, 'Save password'), msg);
}

// ---------- rate (everyone) ----------
// What each skill means, and what each step of the scale looks like for it.
const STEPS = ['0', '.25', '.5', '.75', '1'];
const GUIDE = {
  receiving: ['Passing serves and digging attacks up to the setter.',
    'Can\'t control the ball; passes go anywhere.',
    'Gets easy serves up, but often off target or out of play.',
    'Gets most serves up, not always to the setter.',
    'Usually passes to the setter, even off harder serves.',
    'Passes tough serves right to the setter, every time.'],
  hitting: ['Attacking the ball over the net.',
    'Doesn\'t attack; just bumps or sets it over.',
    'Swings at times, but mostly tips or pushes it over, with lots of errors.',
    'Hits with some power, but with errors and easy balls.',
    'Hits hard and with placement; usually a tough ball to dig.',
    'Hits hard and smart, finds the floor, rarely errs.'],
  hustle: ['Effort and movement: chasing balls, covering hitters, calling the ball.',
    'Stands still and lets balls drop.',
    'Moves for balls near them; rarely chases or calls.',
    'Goes for the balls within reach.',
    'Chases most balls, covers hitters, and calls the ball.',
    'Chases everything, covers, dives, and talks.'],
  serve: ['Getting serves in, and making them hard to pass.',
    'Rarely gets it over the net.',
    'Gets it in about half the time.',
    'Reliably in, but easy to pass.',
    'Almost always in, with some pace or placement that causes trouble.',
    'Tough serves that win points, with few misses.'],
  blocking: ['Going up at the net to stop or slow attacks.',
    'Doesn\'t block.',
    'Goes up now and then, but usually late or off the hitter.',
    'Gets up and sometimes gets a touch.',
    'Blocks well-timed and often gets a hand on it.',
    'Reads the hitter, times it well, stuffs balls.'],
  setting_skill: ['How well they set: getting the second ball to a hitter they can attack. Only for setters, and only counts when they set all game.',
    'Can\'t set a hittable ball yet.',
    'Gets it up, but often too low, too tight or off the net.',
    'Hittable most of the time from a decent pass.',
    'Consistent, well-placed sets, and rescues some bad passes.',
    'Runs the offence: picks the right hitter, sets anything, hides bad passes.'],
  consistency: ['How steady they are from one day to the next. It doesn\'t add to their total; the most unpredictable players are spread across teams instead.',
    'You never know which version shows up.',
    'Good days and bad days, often in the same week.',
    'Plays about the same, with the odd off day.',
    'Rarely has an off day.',
    'Same level every single time.'],
};
// The rubric as a side panel (a bottom sheet on phones) that stays put while you rate. Tapping a rating on a card
// jumps the panel to that skill. Open or closed is remembered per browser.
function ratingGuide(onToggle) {
  let open = false;
  try { open = localStorage.getItem('setme.guide') === 'open'; } catch { /* storage blocked: start closed */ }
  const items = new Map(RATED.map(s => {
    const [what, ...steps] = GUIDE[s];
    return [s, h('section', { class: 'guide-item' }, h('h4', {}, LABEL[s]), h('p', {}, what),
      h('dl', {}, steps.flatMap((text, i) => [h('dt', {}, STEPS[i]), h('dd', {}, text)])))];
  }));
  const close = h('button', { type: 'button', class: 'ghost sm', 'aria-label': 'Close rating guide' }, '×');
  const panel = h('aside', { class: 'guide-panel', 'aria-label': 'Rating guide' },
    h('div', { class: 'guide-head' }, h('h3', {}, 'Rating guide'), close),
    h('p', { class: 'muted small' }, 'Rate each player against this group, not against volleyball players in general. Use U if you haven\'t seen enough to say.'),
    [...items.values()]);
  const fab = h('button', { type: 'button', class: 'guide-fab' }, '📖 Rating guide');
  const button = h('button', { type: 'button', class: 'ghost sm guide-toggle' });
  const set = v => {
    open = v;
    try { localStorage.setItem('setme.guide', v ? 'open' : 'closed'); } catch { /* not remembered, that's fine */ }
    panel.classList.toggle('open', v); panel.inert = !v; fab.hidden = v;
    button.textContent = v ? 'Hide rating guide' : 'Show rating guide';
    onToggle(v);
  };
  close.onclick = () => set(false);
  fab.onclick = button.onclick = () => set(!open);
  return {
    panel, fab, button, init: () => set(open),
    focus(skill) {
      if (!open) return;
      for (const [s, el] of items) el.classList.toggle('on', s === skill);
      const el = items.get(skill);
      panel.scrollTo({ top: el.offsetTop - panel.querySelector('.guide-head').offsetHeight - 8, behavior: 'smooth' });
    },
  };
}

async function ratePage() {
  const [players, mine] = await Promise.all([
    q(sb.from('players').select('id,name,playing,setting').eq('active', true).order('name')),
    q(sb.from('ratings').select('*').eq('rater_id', me.id)),
  ]);
  const byPlayer = new Map(mine.map(r => [r.player_id, r]));
  let onlyPlaying = false, onlyUnrated = false, search = '';
  const grid = h('div', { class: 'grid' });
  const layout = h('div', { class: 'rate-layout' }, grid);
  const guide = ratingGuide(open => document.body.classList.toggle('guide-open', open));
  layout.append(guide.panel, guide.fab);
  guide.init();
  const bar = h('span'), countEl = h('span', { class: 'small muted' });
  const progress = () => {
    const n = players.filter(p => byPlayer.has(p.id)).length;
    bar.style.width = `${players.length ? n / players.length * 100 : 0}%`;
    countEl.textContent = `${n} of ${players.length} players rated`;
  };

  const save = async (pid, skill, value) => {
    const row = { ...Object.fromEntries(RATED.map(s => [s, null])), ...byPlayer.get(pid), [skill]: value };
    // Send Setting only when it's the skill tapped or the saved row has it, so other taps still save before the
    // setting_skill column is added in Supabase.
    const cols = RATED.filter(s => s !== 'setting_skill' || skill === s || (byPlayer.get(pid) && s in byPlayer.get(pid)));
    try {
      const saved = await q(sb.from('ratings').upsert({ rater_id: me.id, player_id: pid, ...Object.fromEntries(cols.map(s => [s, row[s]])) }).select().single());
      byPlayer.set(pid, saved); progress(); totals.get(pid)?.(); toast('Saved');
    } catch (e) { toast(`Not saved: ${e.message}`); return false; }
  };
  // Totals follow the doc's rule: U if any skill is unknown.
  const totals = new Map();
  const card = p => {
    const r = byPlayer.get(p.id);
    const totalEl = h('div', { class: 'totals' });
    const paint = () => {
      const row = byPlayer.get(p.id);
      const known = row && SKILLS.every(s => row[s] != null);
      const sk = known ? Object.fromEntries(SKILLS.map(s => [s, Number(row[s])])) : null;
      totalEl.replaceChildren(
        h('span', {}, h('small', {}, 'Total'), h('b', {}, known ? fmt(SKILLS.reduce((a, s) => a + sk[s], 0)) : 'U')),
        h('span', {}, h('small', {}, 'Weighted'), h('b', {}, known ? fmt(weightedTotal(sk)) : 'U')));
    };
    totals.set(p.id, paint); paint();
    return h('div', { class: 'card player-card' },
      h('header', {}, avatar(p.name), h('b', {}, p.name), p.playing && h('span', { class: 'badge on' }, 'Playing')),
      RATED.filter(s => forPlayer(s, p)).map(s => h('div', { class: `skill-row${s === 'consistency' ? ' trait' : ''}`, onclick: () => guide.focus(s) }, h('span', {}, LABEL[s]),
        seg(RATING_OPTIONS, r?.[s] == null ? null : Number(r[s]), v => save(p.id, s, v), `${p.name} ${LABEL[s]}`))),
      totalEl);
  };
  const draw = () => {
    // Unrated = no rating saved yet, same as the progress count. A card stays put after a tap until the list is redrawn.
    const list = players.filter(p => (!onlyPlaying || p.playing) && (!onlyUnrated || !byPlayer.has(p.id)) && p.name.toLowerCase().includes(search));
    grid.replaceChildren(...(list.length ? list.map(card) : [h('p', { class: 'empty' }, 'No players match.')]));
  };
  progress(); draw();

  // CSV import: preview first, save on confirm. Super can import on behalf of another rater.
  const importBox = h('div');
  const fileInput = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const { rows, unmatched, blank, errors } = readRatingsCsv(await file.text(), players);
    let raterId = me.id;
    const raterPick = me.role === 'super'
      ? await q(sb.from('profiles').select('id,display_name').order('display_name')).then(ps =>
        h('div', { class: 'field' }, h('span', {}, 'Import as'), h('select', { 'aria-label': 'Import as', onchange: e => { raterId = e.target.value; } },
          ps.map(p => h('option', { value: p.id, selected: p.id === me.id }, p.id === me.id ? `${p.display_name} (me)` : p.display_name)))))
      : null;
    const apply = async () => {
      try {
        await q(sb.from('ratings').upsert(rows.map(r => ({ rater_id: raterId, player_id: r.player.id, ...r.values }))));
        toast(`${rows.length} ratings imported`);
        if (raterId === me.id) render(); else importBox.replaceChildren();
      } catch (e) { toast(`Not imported: ${e.message}`); }
    };
    const list = (title, items, cls) => items.length > 0 && [
      h('p', { class: 'small', style: 'margin:12px 0 6px' }, h('b', {}, title)),
      h('div', { class: 'chips' }, items.map(t => h('span', { class: `chip plain ${cls}` }, t)))];
    importBox.replaceChildren(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Import CSV'), h('p', { class: 'muted small', style: 'margin:2px 0 0' }, file.name)),
        h('button', { class: 'ghost sm', onclick: () => importBox.replaceChildren() }, 'Cancel')),
      errors.map(e => h('p', { class: 'warn small' }, e)),
      list(`${rows.length} players with ratings`, rows.map(r => r.player.name), ''),
      list(`${blank.length} left blank (skipped)`, blank, 'off'),
      list(`${unmatched.length} names not recognized (skipped)`, unmatched, 'off'),
      h('div', { class: 'row', style: 'margin-top:14px; align-items:end' }, raterPick,
        h('button', { class: 'ball', onclick: apply, disabled: !rows.length }, `Import ${rows.length} ratings`),
        h('span', { class: 'muted small' }, 'Replaces existing ratings for these players. Empty cells and U count as unknown.'))));
    importBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const downloadCsv = (text, name) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    h('a', { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const downloadTemplate = () => downloadCsv(ratingsTemplate(players), 'setme-ratings-template.csv');
  const exportRatings = () => downloadCsv(ratingsExport(players, byPlayer), `setme-ratings-${new Date().toISOString().slice(0, 10)}.csv`);

  return h('div', {},
    pageHead('Rate players', 'Only the site owner sees your ratings. Every tap saves.',
      h('button', { class: 'ghost sm', onclick: downloadTemplate }, 'CSV template'),
      h('button', { class: 'ghost sm', onclick: () => fileInput.click() }, 'Import CSV'),
      h('button', { class: 'ghost sm', onclick: exportRatings }, 'Export CSV'), fileInput),
    importBox,
    h('div', { class: 'card' },
      h('div', { class: 'legend' },
        h('span', {}, h('b', {}, '0'), ' unwilling or unable'), h('span', {}, h('b', {}, '.25'), ' below average'),
        h('span', {}, h('b', {}, '.5'), ' average/consistent'), h('span', {}, h('b', {}, '.75'), ' excels'),
        h('span', {}, h('b', {}, '1'), ' top of the group'), h('span', {}, h('b', {}, 'U'), " don't know")),
      h('div', { style: 'margin-top:12px' }, guide.button),
      h('div', { class: 'progress', style: 'margin:14px 0 6px' }, bar), countEl,
      h('div', { class: 'toolbar', style: 'margin-top:10px' },
        h('input', { type: 'search', placeholder: 'Search players', 'aria-label': 'Search players', oninput: e => { search = e.target.value.trim().toLowerCase(); draw(); } }),
        toggle("This session's players only", false, v => { onlyPlaying = v; draw(); }),
        toggle('Not rated yet', false, v => { onlyUnrated = v; draw(); }))),
    layout);
}

// ---------- players (organizers) ----------
async function playersPage() {
  const players = await q(sb.from('players').select('*').order('name'));
  const update = async (p, patch) => {
    try { Object.assign(p, await q(sb.from('players').update(patch).eq('id', p.id).select().single())); toast('Saved'); count(); }
    catch (e) { toast(`Not saved: ${e.message}`); return false; }
  };
  const countEl = h('span', { class: 'stat' });
  const count = () => countEl.replaceChildren(String(players.filter(p => p.playing && p.active).length), h('small', {}, 'playing'));
  count();
  let search = '';
  const grid = h('div', { class: 'grid' });

  const card = p => {
    const el = h('div', { class: 'card roster-card' });
    el.append(
      h('header', {}, avatar(p.name),
        h('input', { type: 'text', value: p.name, 'aria-label': 'Name', onchange: e => update(p, { name: e.target.value.trim() }) })),
      h('div', { class: 'fields' },
        h('div', { class: 'field' }, h('span', {}, 'Gender'), seg([['M', 'M'], ['F', 'F'], ['U', 'U', 'u']], p.gender, v => update(p, { gender: v }), `${p.name} gender`)),
        h('div', { class: 'field' }, h('span', {}, 'Setter'), seg([['M', 'Main'], ['B', 'Backup'], ['N', 'No']], p.setting, v => update(p, { setting: v }), `${p.name} setter role`))),
      h('div', { class: 'row' },
        toggle('Playing', p.playing, v => update(p, { playing: v })),
        h('span', { class: 'grow' }),
        me.role === 'super' && h('button', { class: 'danger sm', onclick: () => removePlayer(p) }, 'Delete')));
    return el;
  };
  const removePlayer = async p => {
    if (!confirm(`Delete ${p.name}? Their ratings are deleted too.`)) return;
    try {
      await q(sb.from('players').delete().eq('id', p.id));
      players.splice(players.indexOf(p), 1); draw(); count(); toast(`${p.name} deleted`);
    } catch (e) { toast(e.message); }
  };
  const draw = () => {
    const list = players.filter(p => p.name.toLowerCase().includes(search));
    grid.replaceChildren(...(list.length ? list.map(card) : [h('p', { class: 'empty' }, 'No players match.')]));
  };
  draw();

  const name = h('input', { type: 'text', placeholder: 'New player name', 'aria-label': 'New player name' });
  let newTier = 'beginner';
  const tierPick = seg(TIER_OPTIONS, newTier, v => { newTier = v; }, 'New player level');
  const add = async e => {
    e.preventDefault();
    if (!name.value.trim()) return;
    try { await q(sb.from('players').insert({ name: name.value.trim(), tier: newTier })); toast('Added'); render(); }
    catch (err) { toast(err.message); }
  };
  // Paste the WhatsApp list; matches show live, and nothing changes until "Set playing list".
  const box = h('textarea', { rows: 5, placeholder: 'Paste the list from the WhatsApp group…', 'aria-label': 'Pasted list' });
  const pasteResult = h('div');
  const checkPaste = () => {
    const { matched, waitlist, unmatched } = matchPasted(box.value, players);
    if (!matched.length && !waitlist.length && !unmatched.length) return pasteResult.replaceChildren();
    const apply = async () => {
      try {
        await q(sb.from('players').update({ playing: false }).eq('playing', true));
        if (matched.length) await q(sb.from('players').update({ playing: true, active: true }).in('id', matched.map(m => m.player.id)));
        toast(`${matched.length} players set as playing`); render();
      } catch (err) { toast(err.message); }
    };
    pasteResult.replaceChildren(
      h('p', { class: 'small', style: 'margin:12px 0 6px' }, h('b', {}, `${matched.length} matched`)),
      h('div', { class: 'chips' }, matched.map(m => h('span', { class: 'chip plain', title: m.line }, m.player.name))),
      waitlist.length > 0 && h('p', { class: 'small muted', style: 'margin:12px 0 6px' }, h('b', {}, `${waitlist.length} on the waitlist`), ' (not ticked)'),
      waitlist.length > 0 && h('div', { class: 'chips' }, waitlist.map(m => h('span', { class: 'chip plain off', title: m.line }, m.player.name))),
      unmatched.length > 0 && h('p', { class: 'small muted', style: 'margin:12px 0 6px' },
        h('b', {}, `${unmatched.length} not recognized`), me.role === 'super' ? ' (ignored; add them as players first if they should count)' : ' (ignored)'),
      unmatched.length > 0 && h('div', { class: 'chips' }, unmatched.map(l => h('span', { class: 'chip plain off' }, l))),
      h('div', { class: 'row', style: 'margin-top:14px' },
        h('button', { class: 'ball', onclick: apply, disabled: !matched.length }, `Set playing list (${matched.length})`),
        h('span', { class: 'muted small' }, 'Replaces the current playing list.')));
  };
  box.addEventListener('input', checkPaste);

  const clearPlaying = async () => {
    if (!confirm('Untick everyone from the Playing list?')) return;
    try { await q(sb.from('players').update({ playing: false }).eq('playing', true)); render(); }
    catch (err) { toast(err.message); }
  };

  return h('div', {},
    pageHead('Players', 'Who\'s playing this session, and each player\'s setter role.', countEl),
    h('div', { class: 'card toolbar' },
      h('input', { type: 'search', placeholder: 'Search players', 'aria-label': 'Search players', oninput: e => { search = e.target.value.trim().toLowerCase(); draw(); } }),
      h('button', { class: 'ghost', onclick: clearPlaying }, 'Clear playing list')),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Paste from WhatsApp'),
        h('p', { class: 'muted small', style: 'margin:2px 0 0' }, 'Paste the group\'s list to tick everyone who\'s playing.'))),
      box, pasteResult),
    me.role === 'super' && h('form', { class: 'card add-player', onsubmit: add },
      h('div', { class: 'row' }, name, h('button', {}, 'Add player')),
      h('div', { class: 'field' }, h('span', {}, 'Level until rated'), tierPick)),
    grid,
    h('p', { class: 'muted small', style: 'margin-top:16px' }, 'Main setters: one per team. Backups: at most one per team.'));
}

// ---------- teams (organizers) ----------
// Combos are set here, just before building. They're saved, so the next session starts from the last one's.
// Pairs who play together (always same team) or apart (never same team), for this build only. Nothing is saved:
// they last while the page is open (switching tabs keeps them) and are sent along when teams are built.
let sessionCombos = [];
// Which setters set all game, for this session (not saved): player id -> true / false. Not set yet = main setters do.
const setterPlan = new Map();
const setsAllGame = p => setterPlan.get(p.id) ?? p.setting === 'M';
const allGameIds = players => players.filter(p => p.setting && p.setting !== 'N' && setsAllGame(p)).map(p => p.id);
const setterPlanChanged = () => document.dispatchEvent(new Event('setterplan'));

// Tonight's setters: who sets all game (their Setting counts, hitting and receiving count for less) and who rotates.
function settersCard(playing) {
  const setters = playing.filter(p => p.setting === 'M' || p.setting === 'B');
  const card = h('div', { class: 'card', hidden: !setters.length });
  const paint = () => {
    if (!card.isConnected && card.dataset.drawn) return document.removeEventListener('setterplan', paint);
    card.dataset.drawn = '1';
    card.replaceChildren(
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Setters'),
        h('p', { class: 'muted small', style: 'margin:2px 0 0' }, 'Who sets the whole game? Their setting counts; their hitting and passing count for less. Rotating setters count like everyone else.'))),
      h('div', { class: 'new-players' }, setters.map(p => h('div', { class: 'new-player' },
        h('span', {}, h('b', {}, p.name), ' ', h('span', { class: `badge ${p.setting === 'M' ? 'set' : 'backup'}` }, p.setting === 'M' ? 'Setter' : 'Backup')),
        seg([[true, 'All game'], [false, 'Rotates']], setsAllGame(p), v => { setterPlan.set(p.id, v); setterPlanChanged(); }, `${p.name} sets`)))));
  };
  paint();
  document.addEventListener('setterplan', paint);
  return card;
}
function comboCard(playing, combos) {
  const name = new Map(playing.map(p => [p.id, p.name]));
  const card = h('div', { class: 'card' });
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
    card.replaceChildren(
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Combos'), h('p', { class: 'muted small', style: 'margin:2px 0 0' }, 'Who should play together, and who shouldn\'t. Used for this build only; not saved.')),
        combos.length > 0 && h('button', { class: 'ghost sm', onclick: clear }, 'Clear all')),
      h('form', { class: 'row combo-add', onsubmit: add }, a, b,
        seg([['together', 'Together'], ['apart', 'Apart']], kind, v => { kind = v; }, 'Pair type'),
        h('button', { class: 'ghost' }, 'Add')),
      section('Play together', combos.filter(c => c.kind !== 'apart'), 'Nobody paired up.'),
      section('Keep apart', combos.filter(c => c.kind === 'apart'), 'Nobody kept apart.'));
  };
  draw();
  return card;
}

async function teamsPage() {
  const playing = await q(sb.from('players').select('id,name,setting').eq('playing', true).eq('active', true).order('name'));
  const combos = sessionCombos;
  let numTeams = 4, useCombos = true;
  // Super only: whose ratings to build from. null = everyone's.
  let raterIds = null;
  const newPlayers = newPlayersCard(() => raterIds);
  const out = h('div');
  const ownTeams = ownTeamsCard(out, () => ({ raters: raterIds, useCombos, combos: combos.map(({ player_a, player_b, kind }) => ({ player_a, player_b, kind })) }));
  // An empty list means every rater is switched off: nothing to build from until one is back on.
  const needRater = h('p', { class: 'warn small need-rater', hidden: true }, 'Please select at least one rater.');
  const raterPick = me.role === 'super' ? await raterPicker(ids => {
    raterIds = ids;
    ownTeams.refresh();
    const none = ids?.length === 0;
    btn.disabled = none; needRater.hidden = !none;
    if (!none) newPlayers.refresh();
  }) : null;
  const date = h('input', { type: 'date', value: gameDate, 'aria-label': 'Game date' });
  date.onchange = () => { gameDate = date.value; document.dispatchEvent(new Event('gamedate')); };
  const btn = h('button', { class: 'ball big' }, 'Build teams');
  const sendCombos = () => combos.map(({ player_a, player_b, kind }) => ({ player_a, player_b, kind }));
  // Built options on screen. Once you swap someone in an option it's checked like Your own teams (same numbers, problems,
  // suggestions, locks); the earlier version is kept for Undo. The raters and setters it was built with stay.
  // Per option i: checked[i] = the last check's response, undos[i] = earlier [option, check] pairs, locks[i] = locked ids.
  let built = null, builtWith = null, view = null;
  let checked = [], undos = [], locks = [];
  const ids = i => built.options[i].teams.map(t => t.players.map(p => p.id));
  const check = async (i, teams) => {
    const res = await callFn('build-teams', { ...builtWith, teams, locked: [...(locks[i] ?? [])], suggestRater: view });
    built.options[i] = res.options[0]; checked[i] = res;
  };
  const edit = async (i, teams) => {
    const before = [built.options[i], checked[i]];
    try { await check(i, teams); (undos[i] ??= []).push(before); draw(); toast('Swapped'); }
    catch (e) { toast(e.message); draw(); }
  };
  const recheck = i => check(i, ids(i)).then(draw).catch(e => toast(e.message));
  const draw = () => out.replaceChildren(...showTeams(built, {
    view, onSwap: edit,
    onView: id => { view = id; checked.forEach((c, i) => c && recheck(i)); },
    locked: i => checked[i] && (locks[i] ??= new Set()),
    onLock: (id, i) => { locks[i].has(id) ? locks[i].delete(id) : locks[i].add(id); recheck(i); },
    extra: i => checked[i] && suggestionsPanel(checked[i], {
      onApply: sg => edit(i, sg.teams),
      onUndo: undos[i]?.length > 0 && (() => { [built.options[i], checked[i]] = undos[i].pop(); draw(); }),
    }),
  }));
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Building…';
    try {
      builtWith = { useCombos, raters: raterIds, allGame: allGameIds(playing), combos: sendCombos() };
      built = await callFn('build-teams', { numTeams, ...builtWith });
      checked = []; undos = []; locks = []; view = null;
      draw(); out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    catch (e) { out.replaceChildren(h('p', { class: 'warn' }, e.message)); }
    btn.disabled = raterIds?.length === 0; btn.textContent = 'Build teams';
  };
  return h('div', {},
    pageHead('Teams', 'Set combos, then build balanced lineups.', h('span', { class: 'stat' }, String(playing.length), h('small', {}, 'playing'))),
    comboCard(playing, combos),
    settersCard(playing),
    newPlayers,
    ownTeams,
    h('div', { class: 'card build-bar' },
      raterPick, needRater,
      h('div', { class: 'field' }, h('span', {}, 'Teams'), seg([2, 3, 4, 5, 6].map(n => [n, String(n)]), numTeams, v => { numTeams = v; }, 'Number of teams')),
      h('label', { class: 'field' }, h('span', {}, 'Date'), date),
      toggle('Use combos', true, v => { useCombos = v; }),
      h('span', { class: 'grow' }), btn),
    out);
}

// Teams you made yourself: paste them or upload a text/CSV file, then see the same numbers and sharing as a built option.
function ownTeamsCard(out, getOptions) {
  let players = null;
  const roster = () => players ??= q(sb.from('players').select('id,name,setting').eq('active', true).order('name'));
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
        h('p', { class: 'small', style: 'margin:10px 0 6px' }, h('b', {}, t.label), h('span', { class: 'muted' }, ` · ${t.players.length} players`)),
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
  // viewRater: whose ratings the cards and suggestions use (super, null = the picked raters combined).
  let current = null, history = [], viewRater = null;
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
    const onSwap = (_, teams) => { history.push(current); current = teams; run().catch(e => { current = history.pop(); toast(e.message); run().catch(() => {}); }); };
    out.replaceChildren(...showTeams(res, { title: 'Your teams', locked, onLock: toggleLock, view: viewRater, onView, onSetter, onSwap, extra: suggestionsPanel(res, {
      onApply: sg => { history.push(current); current = sg.teams; run().then(() => toast('Swapped')).catch(e => toast(e.message)); },
      onUndo: history.length > 0 && (() => { current = history.pop(); run().catch(e => toast(e.message)); }),
    }) }));
    if (scroll) out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  check.onclick = async () => {
    current = parsed.teams.filter(t => t.players.length).map(t => t.players.map(p => p.id));
    history = []; locked.clear();
    check.disabled = true; const label = check.textContent; check.textContent = 'Checking…';
    try { await run({ scroll: true }); }
    catch (e) { out.replaceChildren(h('p', { class: 'warn' }, e.message)); }
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
  document.addEventListener('setterplan', () => card.refresh());
  return card;
}

// What's off about some teams and the smallest swaps that fix it, from a build-teams check ({ teams }).
// onApply(suggestion); onUndo shows an Undo button when given.
function suggestionsPanel(res, { onApply, onUndo }) {
  const detail = me.role === 'super';
  const who = p => h('span', {}, h('b', {}, p.name), h('span', { class: 'muted' }, ` (Team ${p.team})`));
  const basis = !detail ? null : res.suggestRater ? `Based on ${firstName(res.options[0]?.byRater?.find(r => r.rater_id === res.suggestRater)?.name)}'s ratings` : 'Based on the combined ratings';
  return h('div', { class: 'suggestions' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h3', {}, 'Suggestions'), h('p', { class: 'muted small', style: 'margin:2px 0 0' },
        basis && h('b', {}, basis, '. '), 'Smallest changes that balance your teams better. Tap 🔓 next to a player to keep them where they are.')),
      onUndo && h('button', { type: 'button', class: 'ghost sm', onclick: onUndo }, 'Undo')),
    res.problems?.length > 0 && h('ul', { class: 'problems' }, res.problems.map(x => h('li', {}, x))),
    res.suggestions?.length
      ? h('ol', { class: 'suggest-list' }, res.suggestions.map(sg => h('li', {},
        h('div', { class: 'grow' },
          h('div', {}, sg.swaps.length > 1 ? 'Two swaps: ' : 'Swap ', sg.swaps.flatMap(([a, b], n) => [n ? ', and ' : '', who(a), ' ↔ ', who(b)])),
          h('div', { class: 'muted small' }, [
            detail && sg.gap && `Gap ${fmt(sg.gap[0])} → ${fmt(sg.gap[1])}`,
            sg.fixes.length > 0 && `fixes: ${sg.fixes.join('; ')}`,
            !detail && !sg.fixes.length && 'makes teams more even',
          ].filter(Boolean).join(' · ')),
          sg.adds.length > 0 && h('div', { class: 'small warn-text' }, `But: ${sg.adds.join('; ')}`)),
        h('button', { type: 'button', class: 'sm', onclick: () => onApply(sg) }, 'Apply'))))
      : h('p', { class: 'muted' }, res.problems?.length ? 'No single or double swap makes these teams better.' : 'These teams look balanced. No swap would make them better.'));
}

let gameDate = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
const dayTitle = iso => {
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
    ready = courtImage(teams, { title: dayTitle(gameDate), colors: TEAM_COLORS }).then(b => (blob = b));
  };
  prep();
  document.addEventListener('gamedate', prep);
  const share = async () => {
    const b = blob ?? await ready;
    const file = new File([b], name, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch (e) { if (e.name !== 'AbortError') toast('Could not share'); }
      return;
    }
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); toast('Image copied, paste it in WhatsApp'); }
    catch { h('a', { href: URL.createObjectURL(b), download: name }).click(); toast('Image downloaded'); }
  };
  btn = h('button', { class: 'sm', onclick: share }, 'Share image');
  return btn;
}

// Setter / Backup badge with how they play tonight. With onSetter (your own teams) it's a button that flips all game / rotates.
function setterBadge(p, onSetter) {
  if (p.setting !== 'M' && p.setting !== 'B') return null;
  // Short so it fits beside a long name and the lock; the colour (filled = main, outline = backup) still says which.
  const text = p.allGame ? 'Sets all game' : p.setting === 'M' ? 'Setter' : 'Backup';
  const cls = `badge ${p.setting === 'M' ? 'set' : 'backup'}`;
  if (!onSetter || p.id == null) return h('span', { class: cls }, text);
  return h('button', { type: 'button', class: `${cls} badge-btn`, 'aria-pressed': String(!!p.allGame),
    title: `${p.setting === 'M' ? 'Main setter' : 'Backup setter'}: ${p.allGame ? 'sets all game (tap: rotates)' : 'rotates (tap: sets all game)'}`, onclick: () => onSetter(p.id) }, text);
}

// onSwap(i, teams): tap a player, then a player on another team, to swap them; teams = player ids per team after the swap.
// locked: a Set of locked ids, or i => that option's Set (none: no locks on it); onLock(id, i).
// extra: shown under option 1, or i => what to show under option i.
function showTeams(res, { title, locked, onLock, view: viewId = null, onView, onSetter, onSwap, extra } = {}) {
  const detail = me.role === 'super';
  const parts = res.warnings.map(w => h('p', { class: 'warn' }, w));
  res.options.forEach((opt, i) => {
    const text = opt.teams.map((t, k) => `Team ${k + 1}: ${t.players.map(p => p.name + setterMark(p.setting)).join(', ')}`).join('\n');
    // Super: whose numbers the cards show. null = combined (what the teams were judged on), else one rater's alone.
    const views = [{ id: null, name: 'Combined', totals: opt.teams.map(t => t.weighted), sums: opt.teams.map(t => t.sums), guessed: null },
      ...(opt.byRater ?? []).map(r => ({ id: r.rater_id, name: r.name, totals: r.totals, sums: r.sums, guessed: r.guessed }))];
    let view = views.find(v => v.id === viewId) ?? views[0];
    const withSet = opt.teams.some(t => t.players.some(p => p.allGame));
    const gapLine = h('p', { class: 'muted small', style: 'margin:2px 0 0' });
    const grid = h('div', { class: 'team-grid' });
    const guessNote = h('p', { class: 'muted small', hidden: true });
    const lk = typeof locked === 'function' ? locked(i) : locked;
    // Swapping: the player tapped first, as [team index, player id].
    let picked = null;
    const pick = (k, id) => {
      if (!picked || picked[1] === id) { picked = picked ? null : [k, id]; return paint(); }
      if (picked[0] === k) { picked = [k, id]; return paint(); }
      const [a, b] = [picked[1], id];
      picked = null;
      grid.classList.add('busy');
      onSwap(i, opt.teams.map(t => t.players.map(p => p.id === a ? b : p.id === b ? a : p.id)));
    };
    const canSwap = onSwap && opt.teams.every(t => t.players.every(p => p.id != null));
    const name = (k, p) => !canSwap ? [avatar(p.name, 28), h('span', { class: 'pname' }, p.name)]
      : [h('button', { type: 'button', class: 'pick', 'aria-pressed': String(picked?.[1] === p.id),
        title: picked && picked[0] !== k ? `Swap with ${opt.teams[picked[0]].players.find(x => x.id === picked[1])?.name}` : `Swap ${p.name} with someone`,
        onclick: () => pick(k, p.id) }, avatar(p.name, 28), h('span', { class: 'pname' }, p.name))];
    const paint = () => {
      const totals = view.totals, hi = Math.max(...totals), lo = Math.min(...totals);
      gapLine.textContent = `${view.id ? `${view.name.split(/[\s.@]/)[0]}'s ratings: totals` : 'Totals'} ${fmt(lo)} to ${fmt(hi)}, a gap of ${fmt(hi - lo)}`;
      grid.classList.toggle('picking', !!picked);
      grid.replaceChildren(...opt.teams.map((t, k) => h('article', { class: `team${picked?.[0] === k ? ' from' : ''}`, style: `--tc: ${TEAM_COLORS[k % TEAM_COLORS.length]}` },
        h('header', {}, h('h4', {}, `Team ${k + 1}`), detail && h('span', { class: 'total', title: view.guessed?.[k] ? `${view.guessed[k]} not rated by ${view.name} (stand-in level used)` : null },
          h('small', {}, 'TOTAL'), fmt(totals[k]), view.guessed?.[k] ? '*' : '')),
        h('ul', {}, t.players.map(p => h('li', {}, ...name(k, p),
          setterBadge(p, onSetter),
          onLock && lk && p.id != null && h('button', { type: 'button', class: 'lock', 'aria-pressed': String(lk.has(p.id)),
            title: lk.has(p.id) ? `${p.name} stays on this team (tap to unlock)` : `Keep ${p.name} on this team`, onclick: () => onLock(p.id, i) }, lk.has(p.id) ? '🔒' : '🔓')))),
        detail && h('div', { class: `stats${withSet ? ' six' : ''}` }, [...SKILLS, ...(withSet ? ['setting'] : [])].map(s => h('div', {}, h('small', {}, s === 'setting' ? 'Set' : SHORT[s]), h('b', {}, fmt(view.sums[k][s] ?? 0))))))));
      guessNote.hidden = !view.guessed?.some(Boolean);
      guessNote.textContent = `* Some players on that team aren't rated by ${view.name.split(/[\s.@]/)[0]}, so their stand-in level was used.`;
    };
    const chips = views.length > 2 ? h('div', { class: 'rater-chips view-chips', role: 'group', 'aria-label': 'Whose ratings to show' }, views.map(v => {
      const b = h('button', { type: 'button', class: 'rater-chip', 'aria-pressed': String(v === view), title: v.id ? v.name : 'All picked raters combined' },
        v.id ? avatar(v.name, 24) : null, h('span', {}, v.id ? v.name.split(/[\s.@]/)[0] : v.name));
      b.onclick = () => { if (v === view) return; view = v; chips.querySelectorAll('button').forEach((x, n) => x.setAttribute('aria-pressed', String(views[n] === view))); paint(); onView?.(v.id); };
      return b;
    })) : null;
    paint();
    parts.push(h('section', { class: 'option' },
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, title ?? `Option ${i + 1}`), detail && gapLine),
        h('div', { class: 'actions' },
          h('button', { class: 'ghost sm', onclick: () => navigator.clipboard.writeText(text).then(() => toast('Copied')) }, 'Copy text'),
          shareButton(opt.teams, i))),
      detail && chips && h('div', { class: 'field raters view' }, h('span', {}, 'Show ratings from'), chips),
      canSwap && h('p', { class: 'muted small swap-hint' }, 'Tap a player, then a player on another team, to swap them.'),
      grid, detail && guessNote,
      typeof extra === 'function' ? extra(i) : i === 0 && extra));
  });
  if (!res.options.length) parts.push(h('p', { class: 'warn' }, 'No lineup found.'));
  if (detail) parts.push(h('p', { class: 'muted small' }, `Skill numbers are team sums. Total weights them: ${SKILLS.map(s => [s, WEIGHTS[s]]).sort((a, b) => b[1] - a[1]).map(([s, w]) => `${SHORT[s]} ×${fmt(w)}`).join(', ')}.`,
    res.options.some(o => o.teams.some(t => t.players.some(p => p.allGame))) && ` Setters who set all game add their Setting ×${fmt(SETTING_WEIGHT)}, with their receiving at ${ALL_GAME.receiving * 100}% and hitting at ${ALL_GAME.hitting * 100}%.`));
  return parts;
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

// Super only: tap raters on or off; teams are built from the ones left on. Everyone is on to start.
// `preload` ({ ratings, profiles }) skips the fetch when the page already has them.
async function raterPicker(onchange, preload) {
  const [rows, profiles] = preload ? [preload.ratings, [...preload.profiles].sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? ''))]
    : await Promise.all([
      q(sb.from('ratings').select('rater_id')),
      q(sb.from('profiles').select('id,display_name').order('display_name')),
    ]);
  const has = new Set(rows.map(r => r.rater_id));
  const raters = profiles.filter(p => has.has(p.id));
  if (raters.length < 2) return null;
  const on = new Set(raters.map(r => r.id));
  const reset = h('button', { type: 'button', class: 'ghost sm', disabled: true }, 'Select all');
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
    reset.disabled = all;
    clear.disabled = !on.size;
    onchange(all ? null : [...on]);
  };
  reset.onclick = () => { raters.forEach(r => on.add(r.id)); paint(); };
  clear.onclick = () => { on.clear(); paint(); };
  return h('div', { class: 'field raters' },
    h('span', {}, 'Ratings from'),
    h('div', { class: 'rater-chips', role: 'group', 'aria-label': 'Raters to use' }, chips.map(([, b]) => b), reset, clear));
}

// ---------- all ratings (super) ----------
// Super: everyone's ratings, combined or one rater at a time, plus rater leans and disagreements.
// Raters and organizers: their own ratings only (the database only returns their rows anyway).
async function ratingsPage() {
  const all = me.role === 'super';
  const [players, ratings, profiles] = await Promise.all([
    q(sb.from('players').select('id,name,playing,tier,setting').eq('active', true).order('name')),
    all ? q(sb.from('ratings').select('*')) : q(sb.from('ratings').select('*').eq('rater_id', me.id)),
    all ? q(sb.from('profiles').select('id,display_name')) : [],
  ]);
  // Super gets everyone's changes; anyone else only their own (the database enforces this too).
  const histQ = sb.from('rating_history').select('*').order('changed_at', { ascending: false }).limit(1000);
  const changeLog = await q(all ? histQ : histQ.eq('rater_id', me.id)).catch(() => null);
  const pname = new Map(profiles.map(p => [p.id, p.display_name]));
  const raters = [...new Set(ratings.map(r => r.rater_id))];
  // First name only ("Reem Al-Khaled" -> "Reem"), unless two raters share it.
  const first = id => (pname.get(id) ?? '?').split(/[\s.@]/)[0];
  const short = id => raters.filter(r => first(r) === first(id)).length > 1 ? pname.get(id) : first(id);
  short.full = id => pname.get(id) ?? id;
  // Super picks whose ratings to look at, like on Teams. Several raters: their ratings combined (leans and
  // disagreements worked out among just them). One rater: exactly what they entered. null = everyone.
  let sel = null, combined, offsets, stats, disagreements;
  const extra = h('div');
  const recompute = () => {
    const used = sel ?? raters;
    ({ combined, offsets, raters: stats, disagreements } = combineRatings(players, ratings.filter(r => used.includes(r.rater_id))));
    extra.replaceChildren(...(used.length > 1 ? [raterCard(used, offsets, stats, short), disagreeCard(disagreements, short)] : []));
    hist?.draw(used);
  };
  const hist = historyCard(changeLog, players, ratings, raters, pname, short, all);
  if (!all) hist.draw([me.id]);
  if (all) recompute();
  const picker = all ? await raterPicker(ids => {
    sel = ids;
    if (ids?.length === 0) { extra.replaceChildren(); hist?.draw([]); } else recompute();
    draw();
  }, { ratings, profiles }) : null;

  // Sorting: tap a column header, or use the dropdown (the only way on phones, where headers are hidden).
  const COLS = [['name', 'Player'], ...RATED.map(s => [s, LABEL[s]]), ['total', 'Total'], ['weighted', 'Weighted'], ...(all ? [['raters', 'Raters']] : [])];
  let sortKey = 'name', desc = false, unratedOnly = false;
  const sortSel = h('select', { 'aria-label': 'Sort by' }, COLS.map(([k, t]) => h('option', { value: k }, t)));
  const dirBtn = h('button', { type: 'button', class: 'ghost sm sort-dir' });
  const heads = new Map(COLS.map(([k, t]) => [k, h('th', { class: k === 'name' ? 'sortable' : 'num sortable', tabindex: 0, 'aria-sort': 'none', 'data-label': RATED.includes(k) ? SHORT[k] : t })]));
  const sortBy = (k, d) => { sortKey = k; desc = d; draw(); };
  sortSel.onchange = () => sortBy(sortSel.value, sortSel.value !== 'name');
  dirBtn.onclick = () => sortBy(sortKey, !desc);
  for (const [k, th] of heads) {
    const pick = () => sortBy(k, k === sortKey ? !desc : k !== 'name');
    th.onclick = pick;
    th.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
  }

  const body = h('tbody');
  const draw = () => {
    if (all && sel?.length === 0) return body.replaceChildren(h('tr', {}, h('td', { colspan: COLS.length, class: 'warn' }, 'Please select at least one rater.')));
    const rid = !all ? me.id : sel?.length === 1 ? sel[0] : '';
    const mine = new Map(ratings.filter(r => r.rater_id === rid).map(r => [r.player_id, r]));
    // Combined: nobody has rated them. One rater: that rater left a skill as U (consistency doesn't count).
    const rows = players.map(p => {
      const vals = rid ? RATED.map(s => mine.get(p.id)?.[s] ?? null).map(v => v == null ? null : Number(v)) : RATED.map(s => combined.get(p.id).skills[s]);
      const unknown = rid ? vals.slice(0, SKILLS.length).some(v => v == null) : !!combined.get(p.id).guess;
      const key = { name: p.name, ...Object.fromEntries(RATED.map((s, i) => [s, vals[i]])),
        total: unknown ? null : vals.slice(0, SKILLS.length).reduce((a, b) => a + b, 0),
        weighted: unknown ? null : weightedTotal(Object.fromEntries(SKILLS.map((s, i) => [s, vals[i]]))),
        raters: all && !rid ? combined.get(p.id).raters : null };
      return { p, vals, unknown, key };
    }).filter(r => !unratedOnly || r.unknown);
    // U (unknown) always sorts last, whichever way.
    rows.sort((a, b) => {
      const x = a.key[sortKey], y = b.key[sortKey];
      if (x == null || y == null) return (x == null) - (y == null) || a.p.name.localeCompare(b.p.name);
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return (desc ? -c : c) || a.p.name.localeCompare(b.p.name);
    });
    sortSel.value = sortKey;
    dirBtn.textContent = desc ? '↓ High to low' : '↑ Low to high';
    if (sortKey === 'name') dirBtn.textContent = desc ? '↓ Z to A' : '↑ A to Z';
    for (const [k, th] of heads) {
      const label = COLS.find(c => c[0] === k)[1];
      th.setAttribute('aria-sort', k === sortKey ? (desc ? 'descending' : 'ascending') : 'none');
      th.replaceChildren(k === 'name' || k === 'total' || k === 'weighted' || k === 'raters' ? label : SHORT[k], h('span', { class: 'arrow' }, k === sortKey ? (desc ? ' ↓' : ' ↑') : ''));
    }
    if (!rows.length) return body.replaceChildren(h('tr', {}, h('td', { colspan: COLS.length, class: 'muted' }, all ? 'Everyone is rated.' : 'You\'ve rated everyone.')));
    body.replaceChildren(...rows.map(({ p, vals, key }) => {
      const guess = all && !rid && combined.get(p.id).guess;
      return h('tr', {}, h('td', {}, h('button', { type: 'button', class: 'name-link', title: 'Show rating history', onclick: () => hist.show(p.id) }, p.name), p.playing && ' ', p.playing && h('span', { class: 'badge on' }, 'Playing'),
        guess && ' ', guess && h('span', { class: 'badge' }, `${guess[0].toUpperCase()}${guess.slice(1)} (guess)`)), vals.map((v, i) => h('td', { class: 'num' }, forPlayer(RATED[i], p) ? fmt(v) : '–')),
        h('td', { class: 'num' }, h('b', {}, fmt(key.total))),
        h('td', { class: 'num' }, fmt(key.weighted)),
        all && h('td', { class: 'num' }, rid ? '' : `${key.raters}`));
    }));
  };
  draw();

  return h('div', {},
    all ? pageHead('All ratings', 'Only you can see this page.')
      : pageHead('My ratings', 'Only you and the site owner can see your ratings. Change them on the Rate page.'),
    picker && h('div', { class: 'card' }, picker),
    h('div', { class: 'card toolbar' },
      h('label', { class: 'sort' }, h('span', {}, 'Sort by'), sortSel), dirBtn,
      toggle(all ? 'Unrated only' : 'Not rated yet', false, v => { unratedOnly = v; draw(); })),
    h('div', { class: 'card scroll' }, stacked(h('table', {}, h('thead', {}, h('tr', {}, [...heads.values()])), body))),
    hist.el,
    all && extra);
}

// Who changed what and when, newest first. Changes one person made to one player within a few minutes show as one entry.
// Super: filtered to the raters picked above. Anyone else: their own changes only, without rater names.
// Narrowed to one player when their name is tapped in the table.
function historyCard(changeLog, players, ratings, allRaters, pname, short, all) {
  const el = h('div', { class: 'card' }, h('h3', {}, 'Rating history'));
  if (!changeLog) {
    el.append(h('p', { class: 'muted' }, all ? 'Not set up yet: run the rating history SQL from the README in Supabase.' : 'Not available yet.'));
    return { el, draw() {}, show() {} };
  }
  const known = new Map(players.map(p => [p.id, p]));
  let used = [], player = '', limit = 30, mode = 'skill', chartRater = null;
  const playerBox = comboBox([['', 'All players'], ...players.map(p => [String(p.id), p.name])], v => { player = v; limit = 30; paint(); }, 'Player');
  const list = h('div', { class: 'history' });
  // Chart for one player: their skills over time from one rater, or each rater's total over time.
  const modeSeg = seg([['skill', 'By skill'], ['total', all ? 'Total by rater' : 'Total']], mode, v => { mode = v; paintChart(); }, 'Chart');
  const raterRow = h('div', { class: 'row chart-raters' });
  const chartBox = h('div', { class: 'chart-box' });
  const chartWrap = h('div', { class: 'history-chart' }, h('div', { class: 'toolbar' }, modeSeg, raterRow), chartBox);
  let stopChart = () => {};
  const paintChart = () => {
    stopChart(); stopChart = () => {};
    modeSeg.hidden = !player;
    if (!player) {
      raterRow.replaceChildren();
      const rows = changeLog.filter(c => known.has(c.player_id) && used.includes(c.rater_id));
      if (!rows.length) return chartBox.replaceChildren();
      stopChart = changesChart(chartBox, rows, all && used.length > 1 ? short : null);
      return;
    }
    const pid = Number(player);
    const withRows = used.filter(r => changeLog.some(c => c.rater_id === r && c.player_id === pid));
    if (!withRows.length) { raterRow.replaceChildren(); chartBox.replaceChildren(h('p', { class: 'muted' }, 'No changes for this player yet.')); return; }
    if (!withRows.includes(chartRater)) chartRater = changeLog.find(c => c.player_id === pid && withRows.includes(c.rater_id)).rater_id;
    raterRow.replaceChildren(...(mode === 'skill' && all && withRows.length > 1
      ? [h('span', { class: 'muted small' }, 'Rater'), seg(withRows.map(r => [r, short(r)]), chartRater, v => { chartRater = v; paintChart(); }, 'Rater for chart')]
      : mode === 'skill' && all ? [h('span', { class: 'muted small' }, short(chartRater))] : []));
    stopChart = historyChart(chartBox, { log: changeLog, ratings, pid, mode, raters: mode === 'skill' ? [chartRater] : withRows,
      slotOf: r => allRaters.indexOf(r), name: all ? short : () => 'Total' });
  };
  const more = h('button', { type: 'button', class: 'ghost sm' }, 'Show more');
  more.onclick = () => { limit += 30; paint(); };
  const when = t => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  const paint = () => {
    // Group rows (already newest first) by rater, player and who changed it, within 5 minutes of each other.
    const groups = [];
    for (const r of changeLog) {
      if (!known.has(r.player_id) || !used.includes(r.rater_id)) continue;
      if (player && String(r.player_id) !== player) continue;
      const g = groups.at(-1);
      if (g && g.rater_id === r.rater_id && g.player_id === r.player_id && g.changed_by === r.changed_by && new Date(g.last) - new Date(r.changed_at) < 5 * 60e3) {
        g.rows.push(r); g.last = r.changed_at;
      } else groups.push({ rater_id: r.rater_id, player_id: r.player_id, changed_by: r.changed_by, at: r.changed_at, last: r.changed_at, rows: [r] });
    }
    list.replaceChildren(...(groups.length ? groups.slice(0, limit).map(g => h('div', { class: 'history-item' },
      h('div', { class: 'history-head' },
        h('span', {}, h('b', {}, known.get(g.player_id).name), all && ' · ', all && short(g.rater_id),
          g.changed_by && g.changed_by !== g.rater_id && h('span', { class: 'muted' }, ` (entered by ${pname.get(g.changed_by) ?? 'someone else'})`)),
        h('span', { class: 'muted small' }, when(g.at))),
      h('div', { class: 'chips' }, RATED.filter(s => g.rows.some(r => r.skill === s)).map(s => {
        // Oldest row's "from" and newest row's "to" for this skill.
        const rs = g.rows.filter(r => r.skill === s), from = rs.at(-1).old_value, to = rs[0].new_value;
        const dir = from == null || to == null ? '' : Number(to) > Number(from) ? 'up' : 'down';
        return h('span', { class: `chip plain ${dir}` }, `${SHORT[s]} ${fmt(from == null ? null : Number(from))} → ${fmt(to == null ? null : Number(to))}`);
      }))))
      : [h('p', { class: 'muted' }, used.length ? 'No changes yet.' : 'Please select at least one rater.')]));
    more.hidden = groups.length <= limit;
    paintChart();
  };
  el.append(
    h('p', { class: 'muted small' }, 'How many ratings changed each day. Pick a player (or tap their name in the table) to chart just their ratings. Recorded from when history was switched on.'),
    h('div', { class: 'toolbar' }, h('div', { class: 'sort' }, h('span', {}, 'Player'), playerBox.el)),
    chartWrap, list, more);
  return {
    el,
    draw(ids) { used = ids; paint(); },
    show(id) { player = String(id); playerBox.set(player); limit = 30; paint(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  };
}

// ---------- rating history chart ----------
// Step lines: a rating holds its value until someone changes it. U / no rating = a gap in the line.
// mode 'skill': one rater, a line per skill (0 to 1). mode 'total': a line per rater, total of the five skills (0 to 5),
// a gap while any of them is U. Colours follow the skill or rater (fixed slots), never their position in the list.
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
};
const SLOTS = 7;
function historyChart(box, { log, ratings, pid, mode, raters, slotOf, name }) {
  const num = v => v == null ? null : Number(v);
  const now = Date.now();
  // Value of each skill over time for one rater: [[time, value], ...], starting before the first change.
  const timeline = rid => {
    const rows = log.filter(c => c.rater_id === rid && c.player_id === pid).map(c => ({ ...c, t: new Date(c.changed_at).getTime() })).sort((a, b) => a.t - b.t);
    const cur = ratings.find(r => r.rater_id === rid && r.player_id === pid);
    const out = {};
    for (const sk of RATED) {
      const rs = rows.filter(r => r.skill === sk);
      out[sk] = rs.length ? [[-Infinity, num(rs[0].old_value)], ...rs.map(r => [r.t, num(r.new_value)])] : [[-Infinity, num(cur?.[sk])]];
    }
    return { rows, out };
  };
  const at = (steps, t) => { let v = steps[0][1]; for (const [st, sv] of steps) { if (st <= t) v = sv; else break; } return v; };
  const lines = raters.map(rid => ({ rid, ...timeline(rid) }));
  const times = [...new Set(lines.flatMap(l => l.rows.map(r => r.t)))].sort((a, b) => a - b);
  const series = mode === 'skill'
    ? RATED.map((sk, i) => ({ key: sk, label: LABEL[sk], slot: i, value: t => at(lines[0].out[sk], t) }))
      // Setting only for players who have a setting rating at some point.
      .filter(se => se.key !== 'setting_skill' || lines[0].out.setting_skill.some(([, v]) => v != null))
    : lines.map(l => ({ key: l.rid, label: name(l.rid), slot: slotOf(l.rid), value: t => {
        const vs = SKILLS.map(sk => at(l.out[sk], t));
        return vs.some(v => v == null) ? null : vs.reduce((a, b) => a + b, 0);
      } }));
  const yMax = mode === 'skill' ? 1 : SKILLS.length;
  const yTicks = mode === 'skill' ? [0, .25, .5, .75, 1] : [0, 1, 2, 3, 4, 5];
  const first = times[0], span = Math.max(now - first, 60e3), pad = Math.max(span * .08, 30 * 60e3);
  const t0 = first - pad, t1 = now;
  const stops = [t0, ...times, t1]; // where the crosshair can rest
  const color = slot => slot >= 0 && slot < SLOTS ? `var(--s${slot + 1})` : 'var(--muted)';

  const legend = h('div', { class: 'chart-legend' }, series.map(se => h('span', {}, h('i', { style: `background:${color(se.slot)}` }), se.label)));
  const plot = h('div', { class: 'chart-plot' });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  plot.append(tip);
  box.replaceChildren(legend, plot);

  let W = 0, svgEl = null, cross = null, xOf, yOf, focusIdx = stops.length - 1;
  const H = 220, M = { l: 34, r: 12, t: 10, b: 26 };
  const sameDay = span < 36 * 3600e3;
  const tickLabel = t => new Date(t).toLocaleString([], sameDay ? { hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short' });
  const tipTime = t => t === t0 ? 'Before the first change' : t === t1 ? 'Now' : new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  const render = () => {
    W = plot.clientWidth; if (!W) return;
    xOf = t => M.l + (t - t0) / (t1 - t0) * (W - M.l - M.r);
    yOf = v => M.t + (1 - v / yMax) * (H - M.t - M.b);
    const grid = yTicks.map(v => svg('g', {},
      svg('line', { x1: M.l, x2: W - M.r, y1: yOf(v), y2: yOf(v), class: 'grid' }),
      svg('text', { x: M.l - 6, y: yOf(v), class: 'axis', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, mode === 'skill' ? fmt(v) : String(v))));
    const n = Math.max(2, Math.min(5, Math.floor((W - M.l - M.r) / 90)));
    const xt = Array.from({ length: n }, (_, i) => t0 + (t1 - t0) * i / (n - 1));
    const xAxis = xt.map((t, i) => svg('text', { x: xOf(t), y: H - 6, class: 'axis', 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, i === n - 1 ? 'Now' : tickLabel(t)));
    const paths = series.map(se => {
      // Steps from t0 to now; a null value lifts the pen.
      const pts = stops.map(t => [t, se.value(t)]);
      let d = '', prev = null;
      for (let i = 0; i < pts.length; i++) {
        const [t, v] = pts[i], next = pts[i + 1]?.[0] ?? t1;
        if (v == null) { prev = null; continue; }
        // The previous step ended at (t, prev): rise or fall straight up/down, then run flat to the next change.
        if (prev == null) d += `M${xOf(t)},${yOf(v)}`; else if (v !== prev) d += `L${xOf(t)},${yOf(v)}`;
        d += `L${xOf(next)},${yOf(v)}`;
        prev = v;
      }
      const dots = times.filter(t => { const v = se.value(t), b = se.value(t - 1); return v != null && v !== b; })
        .map(t => svg('circle', { cx: xOf(t), cy: yOf(se.value(t)), r: 4, class: 'dot', fill: color(se.slot) }));
      return svg('g', {}, svg('path', { d, class: 'line', stroke: color(se.slot) }), dots);
    });
    cross = svg('line', { y1: M.t, y2: H - M.b, class: 'cross', visibility: 'hidden' });
    const hit = svg('rect', { x: M.l, y: 0, width: W - M.l - M.r, height: H, fill: 'transparent' });
    svgEl = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: 0,
      'aria-label': `Rating history chart. ${series.length} lines. Use left and right arrow keys to step through changes.` }, grid, xAxis, cross, paths, hit);
    svgEl.onpointermove = e => { const x = e.clientX - svgEl.getBoundingClientRect().left; show(nearest(x)); };
    svgEl.onpointerleave = hide;
    svgEl.onfocus = () => show(focusIdx);
    svgEl.onblur = hide;
    svgEl.onkeydown = e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); show(Math.max(0, Math.min(stops.length - 1, focusIdx + (e.key === 'ArrowRight' ? 1 : -1))));
    };
    plot.querySelector('svg')?.remove();
    plot.prepend(svgEl);
  };
  const nearest = x => stops.reduce((best, t, i) => Math.abs(xOf(t) - x) < Math.abs(xOf(stops[best]) - x) ? i : best, 0);
  const show = i => {
    focusIdx = i; const t = stops[i], x = xOf(t);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    tip.replaceChildren(h('div', { class: 'chart-tip-head' }, tipTime(t)),
      ...series.map(se => { const v = se.value(t); return h('div', { class: 'chart-tip-row' }, h('i', { style: `background:${color(se.slot)}` }), h('b', {}, fmt(v)), ' ', se.label); }));
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(W - tw, x > W / 2 ? x - tw - 12 : x + 12))}px`;
  };
  const hide = () => { tip.hidden = true; cross?.setAttribute('visibility', 'hidden'); };
  const ro = new ResizeObserver(() => { if (plot.clientWidth !== W) render(); });
  ro.observe(plot);
  render();
  return () => ro.disconnect();
}

// All players: how many skill ratings changed each day (last 60 days at most), one column per day.
// Hover or arrow keys show the day's count, split by rater when byRater is given.
function changesChart(box, rows, byRater) {
  const DAY = 864e5, dayOf = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const today = dayOf(Date.now()), firstDay = Math.max(dayOf(Math.min(...rows.map(r => new Date(r.changed_at)))), today - 59 * DAY);
  const days = [];
  for (let t = firstDay; t <= today; t = dayOf(t + DAY * 1.5)) days.push({ t, rows: [] });
  for (const r of rows) { const d = days.find(x => x.t === dayOf(r.changed_at)); if (d) d.rows.push(r); }
  const max = Math.max(1, ...days.map(d => d.rows.length));
  const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.ceil(max / 5 / 10) * 10;
  const yMax = Math.ceil(max / step) * step, yTicks = Array.from({ length: yMax / step + 1 }, (_, i) => i * step);
  const dayLabel = t => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });

  const head = h('div', { class: 'chart-legend' }, 'Rating changes per day');
  const plot = h('div', { class: 'chart-plot' });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  plot.append(tip);
  box.replaceChildren(head, plot);

  let W = 0, bars = [], focusIdx = days.length - 1, xOf, bw;
  const H = 180, M = { l: 30, r: 8, t: 10, b: 26 };
  const render = () => {
    W = plot.clientWidth; if (!W) return;
    const band = (W - M.l - M.r) / days.length;
    bw = Math.max(2, Math.min(24, band * .7));
    xOf = i => M.l + band * i + band / 2;
    const yOf = v => M.t + (1 - v / yMax) * (H - M.t - M.b);
    const grid = yTicks.map(v => svg('g', {},
      svg('line', { x1: M.l, x2: W - M.r, y1: yOf(v), y2: yOf(v), class: 'grid' }),
      svg('text', { x: M.l - 6, y: yOf(v), class: 'axis', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, String(v))));
    // Date labels: first, last, and evenly spaced ones in between that fit.
    const every = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor((W - M.l - M.r) / 70))));
    const xAxis = days.map((d, i) => (i === days.length - 1 || (i % every === 0 && days.length - 1 - i >= every / 2)) &&
      svg('text', { x: xOf(i), y: H - 6, class: 'axis', 'text-anchor': days.length === 1 ? 'middle' : i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle' }, i === days.length - 1 ? 'Today' : dayLabel(d.t)));
    // Column with a 4px rounded top, square at the baseline.
    const col = (x, y, w, hgt) => { const r = Math.min(4, w / 2, hgt); return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`; };
    bars = days.map((d, i) => d.rows.length ? svg('path', { d: col(xOf(i) - bw / 2, yOf(d.rows.length), bw, yOf(0) - yOf(d.rows.length)), class: 'bar' }) : null);
    const hit = svg('rect', { x: M.l, y: 0, width: W - M.l - M.r, height: H, fill: 'transparent' });
    const el = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: 0,
      'aria-label': `Rating changes per day, ${dayLabel(days[0].t)} to today. Use left and right arrow keys to step through days.` }, grid, xAxis, bars, hit);
    el.onpointermove = e => { const x = e.clientX - el.getBoundingClientRect().left; show(Math.max(0, Math.min(days.length - 1, Math.floor((x - M.l) / band)))); };
    el.onpointerleave = hide; el.onblur = hide;
    el.onfocus = () => show(focusIdx);
    el.onkeydown = e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); show(Math.max(0, Math.min(days.length - 1, focusIdx + (e.key === 'ArrowRight' ? 1 : -1))));
    };
    plot.querySelector('svg')?.remove();
    plot.prepend(el);
  };
  const show = i => {
    focusIdx = i; const d = days[i];
    bars.forEach((b, j) => b?.classList.toggle('dim', j !== i));
    const counts = byRater ? [...d.rows.reduce((m, r) => m.set(r.rater_id, (m.get(r.rater_id) ?? 0) + 1), new Map())] : [];
    tip.replaceChildren(h('div', { class: 'chart-tip-head' }, dayLabel(d.t)),
      h('div', {}, h('b', {}, String(d.rows.length)), d.rows.length === 1 ? ' change' : ' changes'),
      ...counts.sort((a, b) => b[1] - a[1]).map(([rid, n]) => h('div', { class: 'chart-tip-row muted' }, h('b', {}, String(n)), ' ', byRater(rid))));
    tip.hidden = false;
    const tw = tip.offsetWidth, x = xOf(i);
    tip.style.left = `${Math.max(0, Math.min(W - tw, x > W / 2 ? x - bw / 2 - tw - 8 : x + bw / 2 + 8))}px`;
  };
  const hide = () => { tip.hidden = true; bars.forEach(b => b?.classList.remove('dim')); };
  const ro = new ResizeObserver(() => { if (plot.clientWidth !== W) render(); });
  ro.observe(plot);
  render();
  return () => ro.disconnect();
}

// Dropdown you can type into: tap to see every option, type to narrow the list, arrows + Enter to pick, Esc to close.
// options: [[value, label], ...]; the first one is the "nothing picked" choice shown when the box is cleared.
let comboSeq = 0;
function comboBox(options, onchange, label) {
  const id = `combo-${++comboSeq}`;
  let value = options[0][0], shown = [], active = -1;
  const labelOf = v => options.find(o => o[0] === v)?.[1] ?? '';
  const input = h('input', { type: 'text', role: 'combobox', 'aria-label': label, 'aria-expanded': 'false', 'aria-controls': id,
    'aria-autocomplete': 'list', autocomplete: 'off', spellcheck: 'false', value: labelOf(value) });
  const list = h('ul', { id, role: 'listbox', class: 'combo-list', hidden: true });
  const arrow = h('button', { type: 'button', class: 'combo-arrow', tabindex: -1, 'aria-label': `Show ${label} options` }, '▾');
  const el = h('div', { class: 'combo' }, input, arrow, list);

  const render = filter => {
    const f = filter.trim().toLowerCase();
    shown = f ? options.filter(([, t]) => t.toLowerCase().includes(f)) : options;
    active = shown.findIndex(o => o[0] === value);
    if (active < 0 && f) active = 0;
    list.replaceChildren(...(shown.length ? shown.map(([v, t], i) => {
      const li = h('li', { role: 'option', id: `${id}-${i}`, 'aria-selected': String(v === value), class: i === active ? 'active' : '' }, t);
      li.onmousedown = e => { e.preventDefault(); pick(v); };
      return li;
    }) : [h('li', { class: 'muted empty' }, 'No matches')]));
    mark();
  };
  const mark = () => {
    [...list.children].forEach((li, i) => li.classList.toggle('active', i === active));
    const cur = list.children[active];
    if (cur?.id) { input.setAttribute('aria-activedescendant', cur.id); cur.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };
  const open = (filter = '') => { list.hidden = false; input.setAttribute('aria-expanded', 'true'); render(filter); };
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); input.value = labelOf(value); };
  const pick = v => { const changed = v !== value; value = v; close(); if (changed) onchange(v); };

  input.onfocus = () => { input.select(); open(); };
  input.onclick = () => { if (list.hidden) open(); };
  input.oninput = () => open(input.value);
  input.onblur = close;
  input.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) return open();
      if (shown.length) { active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; mark(); }
    } else if (e.key === 'Enter') {
      if (!list.hidden) { e.preventDefault(); if (shown[active]) pick(shown[active][0]); }
    } else if (e.key === 'Escape') { if (!list.hidden) { e.preventDefault(); close(); } }
  };
  arrow.onmousedown = e => { e.preventDefault(); if (list.hidden) { input.focus(); } else close(); };
  return { el, set(v) { value = v; close(); } };
}

const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v));
const leanClass = v => Math.abs(v) < .05 ? null : v > 0 ? 'lean-up' : 'lean-down';

// One row per rater: their lean per skill (taken out of combined ratings), how far off the group they land, and on how much.
function raterCard(raters, offsets, stats, short) {
  const rows = [...raters].sort((a, b) => short(a).localeCompare(short(b))).map(rid => {
    const st = stats.get(rid), o = offsets.get(rid);
    const used = SKILLS.filter(s => st.applied[s]);
    const overall = used.length ? avg(used.map(s => o[s])) : null;
    const misses = SKILLS.map(s => st.miss[s]).filter(v => v != null);
    return h('tr', {},
      h('td', { title: short.full(rid) }, h('b', {}, short(rid))),
      RATED.map(s => st.applied[s]
        ? h('td', { class: `num ${leanClass(o[s]) ?? ''}` }, signed(o[s]))
        : h('td', { class: 'num muted', title: 'Fewer than 5 shared ratings, so not adjusted yet' }, '—')),
      h('td', { class: `num ${overall == null ? 'muted' : leanClass(overall) ?? ''}` }, h('b', {}, overall == null ? '—' : signed(overall))),
      h('td', { class: 'num' }, misses.length ? fmt(avg(misses)) : '—'),
      h('td', { class: 'num muted' }, String(Math.max(0, ...RATED.map(s => st.shared[s])))));
  });
  return h('div', { class: 'card' },
    h('h3', {}, 'How each rater rates'),
    h('p', { class: 'muted small' },
      h('b', { class: 'lean-up' }, '+'), ' rates higher than the group on the same players, ', h('b', { class: 'lean-down' }, '−'), ' lower. ',
      'Combined ratings take this out. ', h('b', {}, 'Off by'), ' is how far they typically land from the group after that; ',
      'a high number means their ratings don\'t line up with everyone else\'s. ', h('b', {}, 'Shared'), ' is how many of their players someone else also rated; ',
      '— means fewer than 5, so no adjustment yet.'),
    rows.length ? h('div', { class: 'scroll' }, stacked(h('table', { class: 'rater-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Rater'), RATED.map(s => h('th', { class: 'num' }, SHORT[s])),
        h('th', { class: 'num' }, 'Overall'), h('th', { class: 'num' }, 'Off by'), h('th', { class: 'num' }, 'Shared'))),
      h('tbody', {}, rows))))
      : h('p', { class: 'muted' }, 'No ratings yet.'));
}

// Players whose raters are a point or more apart, with each rater's total and, on tap, what they entered per skill.
function disagreeCard(disagreements, short) {
  return h('div', { class: 'card' },
    h('h3', {}, 'Raters disagree'),
    h('p', { class: 'muted small' }, 'Totals after each rater\'s lean is taken out, so these are real differences of opinion. Gap of 1 or more.'),
    disagreements.length ? h('div', { class: 'disagree' }, disagreements.map(d => h('div', { class: 'disagree-item' },
      h('div', { class: 'disagree-head' }, h('b', {}, d.name), h('span', { class: 'badge' }, `Gap ${fmt(d.gap)}`)),
      h('div', { class: 'chips' }, d.totals.map((t, i) => h('span', {
        class: `chip plain ${i === 0 ? 'hi' : i === d.totals.length - 1 ? 'lo' : ''}`, title: short.full(t.rater_id),
      }, `${short(t.rater_id)} ${fmt(t.total)}`))),
      h('details', {}, h('summary', {}, 'By skill (as entered)'),
        h('table', { class: 'mini' },
          h('thead', {}, h('tr', {}, h('th', {}), RATED.map(s => h('th', { class: 'num' }, SHORT[s])))),
          h('tbody', {}, d.totals.map(t => h('tr', {}, h('td', {}, short(t.rater_id)), RATED.map(s => h('td', { class: 'num' }, fmt(t.raw[s])))))))))))
      : h('p', { class: 'muted' }, 'No player has raters a full point apart.'));
}

// ---------- users (super) ----------
async function usersPage() {
  const profiles = await q(sb.from('profiles').select('*').order('display_name'));
  const linkBox = h('div');
  const showLink = (label, link) => linkBox.replaceChildren(h('div', { class: 'card' },
    h('b', {}, label), h('p', { class: 'link' }, link),
    h('button', { onclick: () => navigator.clipboard.writeText(link).then(() => toast('Copied')) }, 'Copy link')));

  const email = h('input', { type: 'email', placeholder: 'Email', 'aria-label': 'Email' });
  const name = h('input', { type: 'text', placeholder: 'Name', 'aria-label': 'Name' });
  const invite = async e => {
    e.preventDefault();
    try {
      const { link } = await callFn('admin', { action: 'invite', email: email.value, name: name.value });
      showLink(`Invite link for ${name.value || email.value}. Send it to them directly; it works once.`, link);
      email.value = name.value = '';
    } catch (err) { toast(err.message); }
  };
  const setRole = async (p, role) => {
    try { await q(sb.from('profiles').update({ role }).eq('id', p.id)); toast('Saved'); }
    catch (err) { toast(err.message); return false; }
  };
  const reset = async p => {
    try { showLink(`Password reset link for ${p.display_name}.`, (await callFn('admin', { action: 'reset', email: p.email })).link); }
    catch (err) { toast(err.message); }
  };
  const remove = async p => {
    if (!confirm(`Remove ${p.display_name}? Their ratings are deleted too.`)) return;
    try { await callFn('admin', { action: 'remove', id: p.id }); render(); } catch (err) { toast(err.message); }
  };

  return h('div', {},
    pageHead('Users', 'Raters only rate. Organizers also run Players and Teams, but never see ratings.'),
    h('form', { class: 'card row', onsubmit: invite }, name, email, h('button', {}, 'Create invite link')),
    linkBox,
    h('div', { class: 'grid' }, profiles.map(p => h('div', { class: 'card roster-card' },
      h('header', {}, avatar(p.display_name || '?'), h('div', { class: 'grow' }, h('b', {}, p.display_name), h('div', { class: 'muted small' }, p.email))),
      h('div', { class: 'row' },
        p.role === 'super' ? h('span', { class: 'badge set' }, 'Super') : seg([['rater', 'Rater'], ['organizer', 'Organizer']], p.role, v => setRole(p, v), `${p.display_name} role`),
        h('span', { class: 'grow' }),
        h('div', { class: 'row', style: 'gap:8px' },
          h('button', { class: 'ghost sm', onclick: () => reset(p) }, 'Reset link'),
          p.id !== me.id && h('button', { class: 'danger sm', onclick: () => remove(p) }, 'Remove')))))));
}

boot();
