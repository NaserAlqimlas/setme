import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { SKILLS, combineRatings } from './teams.mjs';
import { matchPasted } from './paste.mjs';
import { readRatingsCsv, ratingsTemplate } from './csv.mjs';

// supabase-js 2.45.4, self-hosted in vendor/ (loaded by index.html as window.supabase)
// Auth calls are serialized with an in-page lock; the default browser lock (navigator.locks) can hang.
let lockChain = Promise.resolve();
const lock = (_name, _timeout, fn) => { const run = lockChain.then(fn, fn); lockChain = run.catch(() => {}); return run; };
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { lock } });
const app = document.getElementById('app');
const SHORT = { receiving: 'Rcv', hitting: 'Hit', hustle: 'Hus', serve: 'Srv', blocking: 'Blk' };
const LABEL = { receiving: 'Receiving', hitting: 'Hitting', hustle: 'Hustle', serve: 'Serve', blocking: 'Blocking' };
const RATING_OPTIONS = [[null, 'U', 'u'], [0, '0'], [.25, '.25'], [.5, '.5'], [.75, '.75'], [1, '1']];
const TEAM_COLORS = ['#2f6fde', '#e8663a', '#18a36f', '#c99400', '#8b5cf6', '#d6407a'];
const PAGES = [
  { id: 'rate', label: 'Rate', roles: ['rater', 'organizer', 'super'], view: ratePage },
  { id: 'players', label: 'Players', roles: ['organizer', 'super'], view: playersPage },
  { id: 'teams', label: 'Teams', roles: ['organizer', 'super'], view: teamsPage },
  { id: 'ratings', label: 'All ratings', roles: ['super'], view: ratingsPage },
  { id: 'users', label: 'Users', roles: ['super'], view: usersPage },
];

let session = null, me = null;
// Arriving from an invite or reset link means a password needs setting.
let mustSetPassword = /type=(invite|recovery)/.test(location.hash);

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
    const heads = [...table.querySelectorAll('thead th')].map(th => th.textContent);
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
  if (/access_token|type=/.test(location.hash)) history.replaceState(null, '', location.pathname);
  render();
}

async function render() {
  const nav = document.getElementById('nav'), who = document.getElementById('who');
  nav.replaceChildren(); who.replaceChildren();
  if (!session) return app.replaceChildren(loginPage());
  if (mustSetPassword) return app.replaceChildren(passwordPage());
  try {
    me = me || await q(sb.from('profiles').select('*').eq('id', session.user.id).single());
  } catch {
    return app.replaceChildren(h('p', { class: 'warn' }, 'Your account has no profile. Ask the organizer to check your invite.'));
  }
  const pages = PAGES.filter(p => p.roles.includes(me.role));
  const current = pages.find(p => '#' + p.id === location.hash) || pages[0];
  if (pages.length > 1) for (const p of pages) nav.append(h('a', { href: '#' + p.id, class: p === current ? 'on' : null }, p.label));
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
  return h('form', { class: 'login card', onsubmit: go }, brand(), h('p', { class: 'tag' }, 'Fair teams, every session.'), email, pw, h('button', { class: 'big' }, 'Sign in'), msg);
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
async function ratePage() {
  const [players, mine] = await Promise.all([
    q(sb.from('players').select('id,name,playing').eq('active', true).order('name')),
    q(sb.from('ratings').select('*').eq('rater_id', me.id)),
  ]);
  const byPlayer = new Map(mine.map(r => [r.player_id, r]));
  let onlyPlaying = false, search = '';
  const grid = h('div', { class: 'grid' });
  const bar = h('span'), countEl = h('span', { class: 'small muted' });
  const progress = () => {
    const n = players.filter(p => byPlayer.has(p.id)).length;
    bar.style.width = `${players.length ? n / players.length * 100 : 0}%`;
    countEl.textContent = `${n} of ${players.length} players rated`;
  };

  const save = async (pid, skill, value) => {
    const row = { ...Object.fromEntries(SKILLS.map(s => [s, null])), ...byPlayer.get(pid), [skill]: value };
    try {
      const saved = await q(sb.from('ratings').upsert({ rater_id: me.id, player_id: pid, ...Object.fromEntries(SKILLS.map(s => [s, row[s]])) }).select().single());
      byPlayer.set(pid, saved); progress(); toast('Saved');
    } catch (e) { toast(`Not saved: ${e.message}`); return false; }
  };
  const card = p => {
    const r = byPlayer.get(p.id);
    return h('div', { class: 'card player-card' },
      h('header', {}, avatar(p.name), h('b', {}, p.name), p.playing && h('span', { class: 'badge on' }, 'Playing')),
      SKILLS.map(s => h('div', { class: 'skill-row' }, h('span', {}, LABEL[s]),
        seg(RATING_OPTIONS, r?.[s] == null ? null : Number(r[s]), v => save(p.id, s, v), `${p.name} ${LABEL[s]}`))));
  };
  const draw = () => {
    const list = players.filter(p => (!onlyPlaying || p.playing) && p.name.toLowerCase().includes(search));
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
  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([ratingsTemplate(players)], { type: 'text/csv' }));
    h('a', { href: url, download: 'setme-ratings-template.csv' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return h('div', {},
    pageHead('Rate players', 'Only the site owner sees your ratings. Every tap saves.',
      h('button', { class: 'ghost sm', onclick: downloadTemplate }, 'CSV template'),
      h('button', { class: 'ghost sm', onclick: () => fileInput.click() }, 'Import CSV'), fileInput),
    importBox,
    h('div', { class: 'card' },
      h('div', { class: 'legend' },
        h('span', {}, h('b', {}, '0'), ' unwilling or unable'), h('span', {}, h('b', {}, '.25'), ' inconsistent'),
        h('span', {}, h('b', {}, '.5'), ' average here'), h('span', {}, h('b', {}, '.75'), ' excels'),
        h('span', {}, h('b', {}, '1'), ' top of the group'), h('span', {}, h('b', {}, 'U'), " don't know")),
      h('div', { class: 'progress', style: 'margin:14px 0 6px' }, bar), countEl,
      h('div', { class: 'toolbar', style: 'margin-top:10px' },
        h('input', { type: 'search', placeholder: 'Search players', 'aria-label': 'Search players', oninput: e => { search = e.target.value.trim().toLowerCase(); draw(); } }),
        toggle("This session's players only", false, v => { onlyPlaying = v; draw(); }))),
    grid);
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
    if (!confirm(`Delete ${p.name}? Their ratings and combos are deleted too.`)) return;
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
  const add = async e => {
    e.preventDefault();
    if (!name.value.trim()) return;
    try { await q(sb.from('players').insert({ name: name.value.trim() })); toast('Added'); render(); }
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
    me.role === 'super' && h('form', { class: 'card row', onsubmit: add }, name, h('button', {}, 'Add player')),
    grid,
    h('p', { class: 'muted small', style: 'margin-top:16px' }, 'Main setters: one per team. Backups: at most one per team.'));
}

// ---------- teams (organizers) ----------
// Combos are set here, just before building. They're saved, so the next session starts from the last one's.
function comboCard(playing, combos) {
  const name = new Map(playing.map(p => [p.id, p.name]));
  const card = h('div', { class: 'card' });
  const draw = () => {
    const sel = label => h('select', { 'aria-label': label }, h('option', { value: '' }, 'Choose player'), playing.map(p => h('option', { value: p.id }, p.name)));
    const a = sel('First player'), b = sel('Second player');
    const add = async e => {
      e.preventDefault();
      if (!a.value || !b.value || a.value === b.value) return toast('Pick two different players');
      try { combos.push(await q(sb.from('combos').insert({ player_a: Number(a.value), player_b: Number(b.value) }).select().single())); draw(); }
      catch (err) { toast(err.message.includes('duplicate') ? 'That combo already exists' : err.message); }
    };
    const remove = async c => {
      try { await q(sb.from('combos').delete().eq('id', c.id)); combos.splice(combos.indexOf(c), 1); draw(); }
      catch (err) { toast(err.message); }
    };
    const clear = async () => {
      if (!combos.length || !confirm('Remove all combos?')) return;
      try { await q(sb.from('combos').delete().in('id', combos.map(c => c.id))); combos.length = 0; draw(); }
      catch (err) { toast(err.message); }
    };
    const chip = c => {
      const off = !name.has(c.player_a) || !name.has(c.player_b);
      const text = `${name.get(c.player_a) ?? c.name_a} + ${name.get(c.player_b) ?? c.name_b}`;
      return h('span', { class: `chip${off ? ' off' : ''}`, title: off ? 'Skipped: not everyone is playing' : null }, text,
        h('button', { type: 'button', 'aria-label': `Remove ${text}`, onclick: () => remove(c) }, '×'));
    };
    card.replaceChildren(
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Combos'), h('p', { class: 'muted small', style: 'margin:2px 0 0' }, 'Players who want to be on the same team.')),
        combos.length > 0 && h('button', { class: 'ghost sm', onclick: clear }, 'Clear all')),
      h('form', { class: 'row', onsubmit: add }, a, b, h('button', { class: 'ghost' }, 'Add combo')),
      h('div', { class: 'chips', style: 'margin-top:12px' }, combos.length ? combos.map(chip) : h('span', { class: 'muted small' }, 'No combos.')));
  };
  draw();
  return card;
}

async function teamsPage() {
  const [playing, combos] = await Promise.all([
    q(sb.from('players').select('id,name').eq('playing', true).eq('active', true).order('name')),
    q(sb.from('combos').select('id,player_a,player_b,a:players!combos_player_a_fkey(name),b:players!combos_player_b_fkey(name)')),
  ]);
  for (const c of combos) { c.name_a = c.a?.name ?? '?'; c.name_b = c.b?.name ?? '?'; }
  let numTeams = 4, useCombos = true;
  const out = h('div');
  const btn = h('button', { class: 'ball big' }, 'Build teams');
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Building…';
    try { out.replaceChildren(...showTeams(await callFn('build-teams', { numTeams, useCombos }))); out.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    catch (e) { out.replaceChildren(h('p', { class: 'warn' }, e.message)); }
    btn.disabled = false; btn.textContent = 'Build teams';
  };
  return h('div', {},
    pageHead('Teams', 'Set combos, then build balanced lineups.', h('span', { class: 'stat' }, String(playing.length), h('small', {}, 'playing'))),
    comboCard(playing, combos),
    h('div', { class: 'card build-bar' },
      h('div', { class: 'field' }, h('span', {}, 'Teams'), seg([2, 3, 4, 5, 6].map(n => [n, String(n)]), numTeams, v => { numTeams = v; }, 'Number of teams')),
      toggle('Use combos', true, v => { useCombos = v; }),
      h('span', { class: 'grow' }), btn),
    out);
}

function showTeams(res) {
  const detail = me.role === 'super';
  const parts = res.warnings.map(w => h('p', { class: 'warn' }, w));
  res.options.forEach((opt, i) => {
    const text = opt.teams.map((t, k) => `Team ${k + 1}: ${t.players.map(p => p.name + setterMark(p.setting)).join(', ')}`).join('\n');
    parts.push(h('section', { class: 'option' },
      h('div', { class: 'card-head' }, h('h3', {}, `Option ${i + 1}`),
        h('button', { class: 'ghost sm', onclick: () => navigator.clipboard.writeText(text).then(() => toast('Copied')) }, 'Copy for WhatsApp')),
      h('div', { class: 'team-grid' }, opt.teams.map((t, k) => h('article', { class: 'team', style: `--tc: ${TEAM_COLORS[k % TEAM_COLORS.length]}` },
        h('header', {}, h('h4', {}, `Team ${k + 1}`), detail && h('span', { class: 'total' }, h('small', {}, 'TOTAL'), fmt(t.weighted))),
        h('ul', {}, t.players.map(p => h('li', {}, avatar(p.name, 28), h('span', {}, p.name),
          p.setting === 'M' ? h('span', { class: 'badge set' }, 'Setter') : p.setting === 'B' ? h('span', { class: 'badge backup' }, 'Backup') : null))),
        detail && h('div', { class: 'stats' }, SKILLS.map(s => h('div', {}, h('small', {}, SHORT[s]), h('b', {}, fmt(t.sums[s]))))))))));
  });
  if (!res.options.length) parts.push(h('p', { class: 'warn' }, 'No lineup found.'));
  if (detail) parts.push(h('p', { class: 'muted small' }, 'Skill numbers are team sums; Total is the weighted total.'));
  return parts;
}

// ---------- all ratings (super) ----------
async function ratingsPage() {
  const [players, ratings, profiles] = await Promise.all([
    q(sb.from('players').select('id,name,playing').eq('active', true).order('name')),
    q(sb.from('ratings').select('*')),
    q(sb.from('profiles').select('id,display_name')),
  ]);
  const pname = new Map(profiles.map(p => [p.id, p.display_name]));
  const raters = [...new Set(ratings.map(r => r.rater_id))];
  const { combined, offsets, disagreements } = combineRatings(players, ratings);
  const view = h('select', { 'aria-label': 'Whose ratings' }, h('option', { value: '' }, 'Combined (adjusted)'), raters.map(r => h('option', { value: r }, pname.get(r) ?? r)));
  const body = h('tbody');
  const draw = () => {
    const rid = view.value;
    const mine = new Map(ratings.filter(r => r.rater_id === rid).map(r => [r.player_id, r]));
    body.replaceChildren(...players.map(p => {
      const vals = rid ? SKILLS.map(s => mine.get(p.id)?.[s] ?? null).map(v => v == null ? null : Number(v)) : SKILLS.map(s => combined.get(p.id).skills[s]);
      const unknown = rid ? vals.some(v => v == null) : combined.get(p.id).raters === 0;
      return h('tr', {}, h('td', {}, p.name, p.playing && ' ', p.playing && h('span', { class: 'badge on' }, 'Playing')), vals.map(v => h('td', { class: 'num' }, fmt(v))),
        h('td', { class: 'num' }, h('b', {}, unknown ? 'U' : fmt(vals.reduce((a, b) => a + b, 0)))),
        h('td', { class: 'num' }, rid ? '' : `${combined.get(p.id).raters}`));
    }));
  };
  view.onchange = draw; draw();

  return h('div', {},
    pageHead('All ratings', 'Only you can see this page.', view),
    h('div', { class: 'card scroll' }, stacked(h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Player'), SKILLS.map(s => h('th', { class: 'num' }, SHORT[s])), h('th', { class: 'num' }, 'Total'), h('th', { class: 'num' }, 'Raters'))),
      body))),
    h('div', { class: 'grid' },
      h('div', { class: 'card' },
        h('h3', {}, 'Big disagreements'),
        disagreements.length ? h('ul', {}, disagreements.map(d => h('li', {}, h('b', {}, d.name), ': ', d.totals.map(t => `${pname.get(t.rater_id) ?? '?'} ${fmt(t.total)}`).join(', '))))
          : h('p', { class: 'muted' }, 'None of a full point or more.')),
      h('div', { class: 'card' },
        h('h3', {}, 'Rater adjustment'),
        h('p', { class: 'muted small' }, 'How far each rater sits above (+) or below (−) the others on the same players. Combined ratings subtract this first.'),
        h('table', {}, h('tbody', {}, [...offsets].map(([rid, o]) => h('tr', {}, h('td', {}, pname.get(rid) ?? rid), SKILLS.map(s => h('td', { class: 'num' }, `${SHORT[s]} ${fmt(o[s])}`)))))))));
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
        h('button', { class: 'ghost sm', onclick: () => reset(p) }, 'Reset link'),
        p.id !== me.id && h('button', { class: 'danger sm', onclick: () => remove(p) }, 'Remove'))))));
}

boot();
