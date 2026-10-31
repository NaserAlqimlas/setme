import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { SKILLS, combineRatings } from './teams.mjs';

// supabase-js 2.45.4, self-hosted in vendor/ (loaded by index.html as window.supabase)
// Auth calls are serialized with an in-page lock; the default browser lock (navigator.locks) can hang.
let lockChain = Promise.resolve();
const lock = (_name, _timeout, fn) => { const run = lockChain.then(fn, fn); lockChain = run.catch(() => {}); return run; };
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { lock } });
const app = document.getElementById('app');
const SHORT = { receiving: 'Rcv', hitting: 'Hit', hustle: 'Hus', serve: 'Srv', blocking: 'Blk' };
const VALUES = [0, .25, .5, .75, 1];
const PAGES = [
  { id: 'rate', label: 'Rate players', roles: ['rater', 'organizer', 'super'], view: ratePage },
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
const setterMark = s => s === 'M' ? ' (S)' : s === 'B' ? ' (B)' : '';
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
    return app.replaceChildren(h('p', {}, 'Your account has no profile. Ask the organizer to check your invite.'));
  }
  const pages = PAGES.filter(p => p.roles.includes(me.role));
  const current = pages.find(p => '#' + p.id === location.hash) || pages[0];
  for (const p of pages) nav.append(h('a', { href: '#' + p.id, class: p === current ? 'on' : null }, p.label));
  who.append(`${me.display_name} · ${me.role}`, h('button', { class: 'ghost', onclick: () => sb.auth.signOut() }, 'Sign out'));
  app.replaceChildren(h('p', { class: 'muted' }, 'Loading…'));
  try {
    app.replaceChildren(await current.view());
  } catch (e) {
    app.replaceChildren(h('p', { class: 'warn' }, `Something went wrong: ${e.message}`));
  }
}

function loginPage() {
  const email = h('input', { type: 'email', placeholder: 'Email', autocomplete: 'email' });
  const pw = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const msg = h('p', { class: 'muted' }, 'Invite only. Forgot your password? Ask the organizer for a reset link.');
  const go = async e => {
    e.preventDefault();
    const { data, error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value });
    if (error) return msg.replaceChildren(h('span', { class: 'warn' }, error.message));
    session = data.session; render();
  };
  return h('form', { class: 'login card', onsubmit: go }, h('h2', {}, 'Sign in'), email, pw, h('button', {}, 'Sign in'), msg);
}

function passwordPage() {
  const pw = h('input', { type: 'password', placeholder: 'New password (8+ characters)', autocomplete: 'new-password' });
  const msg = h('p', { class: 'muted' }, 'Choose a password. You will use it with your email to sign in from now on.');
  const go = async e => {
    e.preventDefault();
    if (pw.value.length < 8) return msg.replaceChildren(h('span', { class: 'warn' }, 'Use at least 8 characters.'));
    const { error } = await sb.auth.updateUser({ password: pw.value, data: { password_set: true } });
    if (error) return msg.replaceChildren(h('span', { class: 'warn' }, error.message));
    mustSetPassword = false; toast('Password saved'); render();
  };
  return h('form', { class: 'login card', onsubmit: go }, h('h2', {}, 'Set your password'), pw, h('button', {}, 'Save password'), msg);
}

// ---------- rate (everyone) ----------
async function ratePage() {
  const [players, mine] = await Promise.all([
    q(sb.from('players').select('id,name,playing').eq('active', true).order('name')),
    q(sb.from('ratings').select('*').eq('rater_id', me.id)),
  ]);
  const byPlayer = new Map(mine.map(r => [r.player_id, r]));
  let onlyPlaying = false;
  const body = h('tbody');

  const save = async (pid, skill, raw) => {
    const row = byPlayer.get(pid) || { rater_id: me.id, player_id: pid, ...Object.fromEntries(SKILLS.map(s => [s, null])) };
    row[skill] = raw === '' ? null : Number(raw);
    try {
      const saved = await q(sb.from('ratings').upsert({ rater_id: me.id, player_id: pid, ...Object.fromEntries(SKILLS.map(s => [s, row[s]])) }).select().single());
      byPlayer.set(pid, saved); toast('Saved');
    } catch (e) { toast(`Not saved: ${e.message}`); }
  };
  const draw = () => body.replaceChildren(...players.filter(p => !onlyPlaying || p.playing).map(p => {
    const r = byPlayer.get(p.id);
    return h('tr', {}, h('td', {}, p.name), SKILLS.map(s => h('td', { class: 'num' },
      h('select', { 'aria-label': `${p.name} ${s}`, onchange: e => save(p.id, s, e.target.value) },
        h('option', { value: '' }, 'U'),
        VALUES.map(v => h('option', { value: String(v), selected: r?.[s] != null && Number(r[s]) === v }, fmt(v)))))));
  }));
  draw();

  return h('div', {},
    h('h2', {}, 'Rate players'),
    h('div', { class: 'card' },
      h('p', { class: 'muted' }, 'Only the site owner sees your ratings. Changes save automatically.'),
      h('ul', { class: 'muted' },
        h('li', {}, '0: unwilling or unable'), h('li', {}, '.25: inconsistent'), h('li', {}, '.5: average for this group'),
        h('li', {}, '.75: excels at it'), h('li', {}, '1: top of the group'), h('li', {}, "U: you don't know")),
      h('label', { class: 'row' }, h('input', { type: 'checkbox', onchange: e => { onlyPlaying = e.target.checked; draw(); } }), "Only show this session's players")),
    h('div', { class: 'card scroll' }, stacked(h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Player'), SKILLS.map(s => h('th', { class: 'num', title: s }, s[0].toUpperCase() + s.slice(1))))),
      body))));
}

// ---------- players (organizers) ----------
async function playersPage() {
  const players = await q(sb.from('players').select('*').order('name'));
  const update = async (p, patch) => {
    try { Object.assign(p, await q(sb.from('players').update(patch).eq('id', p.id).select().single())); toast('Saved'); count(); }
    catch (e) { toast(`Not saved: ${e.message}`); }
  };
  const countEl = h('span', { class: 'muted' });
  const count = () => { countEl.textContent = `${players.filter(p => p.playing && p.active).length} playing`; };
  count();
  const pick = (p, field, opts) => h('select', { onchange: e => update(p, { [field]: e.target.value }) },
    opts.map(([v, label]) => h('option', { value: v, selected: p[field] === v }, label)));

  const rows = players.map(p => h('tr', {},
    h('td', {}, h('input', { type: 'text', value: p.name, onchange: e => update(p, { name: e.target.value.trim() }) })),
    h('td', {}, pick(p, 'gender', [['M', 'M'], ['F', 'F'], ['U', 'U']])),
    h('td', {}, pick(p, 'setting', [['M', 'M'], ['B', 'B'], ['N', 'N']])),
    h('td', { class: 'num' }, h('input', { type: 'checkbox', checked: p.playing, 'aria-label': `${p.name} playing`, onchange: e => update(p, { playing: e.target.checked }) })),
    h('td', { class: 'num' }, h('input', { type: 'checkbox', checked: p.active, 'aria-label': `${p.name} on roster`, onchange: e => update(p, { active: e.target.checked }) }))));

  const name = h('input', { type: 'text', placeholder: 'New player name' });
  const add = async e => {
    e.preventDefault();
    if (!name.value.trim()) return;
    try { await q(sb.from('players').insert({ name: name.value.trim() })); toast('Added'); render(); }
    catch (err) { toast(err.message); }
  };
  const clearPlaying = async () => {
    if (!confirm('Untick everyone from the Playing list?')) return;
    await q(sb.from('players').update({ playing: false }).eq('playing', true)); render();
  };

  return h('div', {},
    h('h2', {}, 'Players'),
    h('div', { class: 'card row' },
      me.role === 'super' && h('form', { class: 'row', onsubmit: add }, name, h('button', {}, 'Add player')),
      countEl, h('button', { class: 'ghost', onclick: clearPlaying }, 'Clear playing list')),
    h('div', { class: 'card scroll' }, stacked(h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Gender'), h('th', {}, 'Setting'), h('th', { class: 'num' }, 'Playing'), h('th', { class: 'num' }, 'On roster'))),
      h('tbody', {}, rows)))),
    h('p', { class: 'muted' }, 'Setting: M = main setter (one per team), B = backup (at most one per team), N = not a setter. Untick "On roster" to hide a player without deleting their ratings.'));
}

// ---------- teams (organizers) ----------
// Combos are set here, just before building. They're saved, so the next session starts from the last one's.
function comboCard(playing, combos) {
  const name = new Map(playing.map(p => [p.id, p.name]));
  const card = h('div', { class: 'card' });
  const draw = () => {
    const sel = () => h('select', {}, h('option', { value: '' }, 'Choose…'), playing.map(p => h('option', { value: p.id }, p.name)));
    const a = sel(), b = sel();
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
    const label = c => {
      const out = [c.player_a, c.player_b].filter(id => !name.has(id));
      return out.length ? h('span', { class: 'muted' }, `${name.get(c.player_a) ?? c.name_a} + ${name.get(c.player_b) ?? c.name_b} (skipped: not playing)`)
        : `${name.get(c.player_a)} + ${name.get(c.player_b)}`;
    };
    card.replaceChildren(
      h('div', { class: 'row' }, h('h3', {}, 'Combos'), h('button', { class: 'ghost', onclick: clear }, 'Clear all')),
      h('p', { class: 'muted' }, 'Players who want to be on the same team this session.'),
      h('form', { class: 'row', onsubmit: add }, a, '+', b, h('button', {}, 'Add combo')),
      combos.length ? h('table', {}, h('tbody', {}, combos.map(c => h('tr', {}, h('td', {}, label(c)),
        h('td', { class: 'num' }, h('button', { class: 'danger', onclick: () => remove(c) }, 'Remove'))))))
        : h('p', { class: 'muted' }, 'No combos.'));
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
  const num = h('select', {}, [2, 3, 4, 5, 6].map(n => h('option', { value: n, selected: n === 4 }, `${n} teams`)));
  const useCombos = h('input', { type: 'checkbox', checked: true });
  const out = h('div');
  const btn = h('button', {}, 'Build teams');
  btn.onclick = async () => {
    btn.disabled = true; out.replaceChildren(h('p', { class: 'muted' }, 'Building… this takes a few seconds.'));
    try { out.replaceChildren(...showTeams(await callFn('build-teams', { numTeams: Number(num.value), useCombos: useCombos.checked }))); }
    catch (e) { out.replaceChildren(h('p', { class: 'warn' }, e.message)); }
    btn.disabled = false;
  };
  return h('div', {},
    h('h2', {}, 'Teams'),
    comboCard(playing, combos),
    h('div', { class: 'card row' }, h('span', {}, `${playing.length} playing`), num,
      h('label', { class: 'row' }, useCombos, 'Use combos'), btn),
    out);
}

function showTeams(res) {
  const detail = me.role === 'super';
  const parts = res.warnings.map(w => h('p', { class: 'warn' }, w));
  res.options.forEach((opt, i) => {
    const text = opt.teams.map((t, k) => `Team ${k + 1}: ${t.players.map(p => p.name + setterMark(p.setting)).join(', ')}`).join('\n');
    parts.push(h('div', { class: 'card scroll' },
      h('div', { class: 'row' }, h('h3', {}, `Option ${i + 1}`),
        h('button', { class: 'ghost', onclick: () => navigator.clipboard.writeText(text).then(() => toast('Copied')) }, 'Copy')),
      stacked(h('table', { class: 'teams' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Team'), h('th', {}, 'Players'),
          detail && SKILLS.map(s => h('th', { class: 'num' }, SHORT[s])), detail && h('th', { class: 'num' }, 'Total'))),
        h('tbody', {}, opt.teams.map((t, k) => h('tr', {},
          h('td', {}, `Team ${k + 1}`),
          h('td', {}, t.players.map(p => p.name + setterMark(p.setting)).join(', ')),
          detail && SKILLS.map(s => h('td', { class: 'num' }, fmt(t.sums[s]))),
          detail && h('td', { class: 'num' }, fmt(t.weighted)))))))));
  });
  if (!res.options.length) parts.push(h('p', { class: 'warn' }, 'No lineup found.'));
  parts.push(h('p', { class: 'muted' }, '(S) main setter, (B) backup setter.' + (detail ? ' Skill columns are team sums; Total is the weighted total.' : '')));
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
  const view = h('select', {}, h('option', { value: '' }, 'Combined (adjusted)'), raters.map(r => h('option', { value: r }, pname.get(r) ?? r)));
  const body = h('tbody');
  const draw = () => {
    const rid = view.value;
    const mine = new Map(ratings.filter(r => r.rater_id === rid).map(r => [r.player_id, r]));
    body.replaceChildren(...players.map(p => {
      const vals = rid ? SKILLS.map(s => mine.get(p.id)?.[s] ?? null).map(v => v == null ? null : Number(v)) : SKILLS.map(s => combined.get(p.id).skills[s]);
      const unknown = rid ? vals.some(v => v == null) : combined.get(p.id).raters === 0;
      return h('tr', {}, h('td', {}, p.name + (p.playing ? '' : ' ·')), vals.map(v => h('td', { class: 'num' }, fmt(v))),
        h('td', { class: 'num' }, unknown ? 'U' : fmt(vals.reduce((a, b) => a + b, 0))),
        h('td', { class: 'num' }, rid ? '' : `${combined.get(p.id).raters}`));
    }));
  };
  view.onchange = draw; draw();

  return h('div', {},
    h('h2', {}, 'All ratings'),
    h('div', { class: 'card row' }, view, h('span', { class: 'muted' }, '· = not playing this session')),
    h('div', { class: 'card scroll' }, stacked(h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Player'), SKILLS.map(s => h('th', { class: 'num' }, SHORT[s])), h('th', { class: 'num' }, 'Total'), h('th', { class: 'num' }, 'Raters'))),
      body))),
    h('div', { class: 'card' },
      h('h3', {}, 'Big disagreements'),
      disagreements.length ? h('ul', {}, disagreements.map(d => h('li', {}, `${d.name}: ${d.totals.map(t => `${pname.get(t.rater_id) ?? '?'} ${fmt(t.total)}`).join(', ')}`)))
        : h('p', { class: 'muted' }, 'None of a full point or more.'),
      h('h3', {}, 'Rater adjustment'),
      h('p', { class: 'muted' }, 'How far each rater sits above (+) or below (−) the others on the same players, per skill. Combined ratings subtract this first.'),
      h('table', {}, h('tbody', {}, [...offsets].map(([rid, o]) => h('tr', {}, h('td', {}, pname.get(rid) ?? rid), SKILLS.map(s => h('td', { class: 'num' }, `${SHORT[s]} ${fmt(o[s])}`))))))));
}

// ---------- users (super) ----------
async function usersPage() {
  const profiles = await q(sb.from('profiles').select('*').order('display_name'));
  const linkBox = h('div');
  const showLink = (label, link) => linkBox.replaceChildren(h('div', { class: 'card' },
    h('p', {}, label), h('p', { class: 'link' }, link),
    h('button', { onclick: () => navigator.clipboard.writeText(link).then(() => toast('Copied')) }, 'Copy link')));

  const email = h('input', { type: 'email', placeholder: 'Email' });
  const name = h('input', { type: 'text', placeholder: 'Name' });
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
    catch (err) { toast(err.message); }
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
    h('h2', {}, 'Users'),
    h('form', { class: 'card row', onsubmit: invite }, name, email, h('button', {}, 'Create invite link')),
    linkBox,
    h('div', { class: 'card scroll' }, stacked(h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Email'), h('th', {}, 'Role'), h('th', {}), h('th', {}))),
      h('tbody', {}, profiles.map(p => h('tr', {},
        h('td', {}, p.display_name), h('td', {}, p.email),
        h('td', {}, p.role === 'super' ? 'super' : h('select', { onchange: e => setRole(p, e.target.value) },
          ['rater', 'organizer'].map(r => h('option', { value: r, selected: p.role === r }, r)))),
        h('td', {}, h('button', { class: 'ghost', onclick: () => reset(p) }, 'Reset link')),
        h('td', {}, p.id === me.id ? '' : h('button', { class: 'danger', onclick: () => remove(p) }, 'Remove')))))))),
    h('p', { class: 'muted' }, 'Raters can only rate. Organizers also manage players, combos and the Playing list, and build teams, but never see ratings.'));
}

boot();
