import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config.js';
import { TIERS } from './teams.mjs';

// Shared by every page: the Supabase client, who is signed in, building elements, and the small pieces
// (menus, toasts, dialogs, toggles) the pages are made of.

// supabase-js 2.45.4, self-hosted in vendor/ (loaded by index.html as window.supabase)
// Auth calls are serialized with an in-page lock; the default browser lock (navigator.locks) can hang.
let lockChain = Promise.resolve();
const lock = (_name, _timeout, fn) => { const run = lockChain.then(fn, fn); lockChain = run.catch(() => {}); return run; };
export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { lock } });
export const SHORT = { receiving: 'Rcv', hitting: 'Hit', hustle: 'Hus', serve: 'Srv', blocking: 'Blk', setting_skill: 'Set', consistency: 'Con' };

// Who is signed in, set by app.js. Pages read these; only app.js changes them.
export let session = null, me = null;
export const setSession = s => { session = s; };
export const setMe = p => { me = p; };
// Draws the current page again. app.js sets the real one.
export let render = () => {};
export const setRender = f => { render = f; };
export const LABEL = { receiving: 'Receiving', hitting: 'Hitting', hustle: 'Hustle', serve: 'Serve', blocking: 'Blocking', setting_skill: 'Setting', consistency: 'Consistency' };
// Rated only for players marked as setters (main or backup).
export const forPlayer = (s, p) => s !== 'setting_skill' || (p.setting && p.setting !== 'N');
// 'U' is a tap on don't know. A skill with nothing pressed hasn't been answered yet.
export const RATING_OPTIONS = [['U', 'U', 'u'], [0, '0'], [.25, '.25'], [.5, '.5'], [.75, '.75'], [1, '1']];
export const TIER_OPTIONS = TIERS.map(t => [t, t[0].toUpperCase() + t.slice(1)]);
export const TEAM_COLORS = ['#2f6fde', '#e8663a', '#18a36f', '#c99400', '#8b5cf6', '#d6407a'];

// ---------- helpers ----------
export function h(tag, attrs = {}, ...kids) {
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
export const q = async p => { const { data, error } = await p; if (error) throw error; return data; };
export const fmt = v => v == null ? 'U' : String(Math.round(v * 100) / 100).replace(/^0\./, '.').replace(/^-0\./, '-.');
export const firstName = n => (n ?? '?').split(/[\s.@]/)[0];
export const setterMark = s => s === 'M' ? ' (S)' : s === 'B' ? ' (B)' : '';
// A player's name that opens their profile, for whoever may see it (organizers and super: anyone; others: themselves).
export const canProfile = id => me.role === 'organizer' || me.role === 'super' || (me.player_id != null && id === me.player_id);
export const profileLink = (id, name) => canProfile(id) ? h('a', { href: `#player/${id}`, class: 'name-link' }, name) : h('span', {}, name);
// Supabase's errors when a table, column or function from an upgrade isn't there yet.
export const missing = e => /relation|does not exist|schema cache|could not find|column/i.test(e?.message ?? '');
export const needsUpgrade = (what, file = 'supabase/club.sql') => h('div', { class: 'card empty' }, `${what} needs the database upgrade: run ${file} in Supabase.`);
export const today = () => new Date().toLocaleDateString('en-CA');
export const downloadFile = (text, name, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
// A small dropdown of actions (a native <details>, so it works with keyboard and screen readers).
export function menu(label, items) {
  const box = h('details', { class: 'menu' }, h('summary', { class: 'ghost-btn' }, label),
    h('div', { class: 'menu-list', role: 'menu' }, items.map(([text, act]) => h('button', { type: 'button', role: 'menuitem', onclick: () => { box.open = false; act(); } }, text))));
  return box;
}
// The avatar in the header: who you are, and sign out.
// Close any open menu on an outside click or Escape.
document.addEventListener('click', e => document.querySelectorAll('details.menu[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('details.menu[open]').forEach(d => { d.open = false; d.querySelector('summary').focus(); }); });
// An on/off filter shown as a chip.
export function filterChip(label, onchange) {
  const b = h('button', { type: 'button', class: 'filter-chip', 'aria-pressed': 'false' }, label);
  b.onclick = () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(v)); onchange(v); };
  return b;
}
export const pageHead = (title, sub, ...right) => h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, title), sub && h('p', {}, sub)), right.length ? h('div', { class: 'row' }, right) : null);

export function avatar(name, size) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) % 360;
  const initials = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  return h('span', { class: 'avatar', style: `background: hsl(${hash} 50% 31%)${size ? `; width:${size}px; height:${size}px` : ''}`, 'aria-hidden': 'true' }, initials);
}

// Pick-one buttons. onpick returns false when saving failed, which puts the old choice back.
export function seg(options, value, onpick, label) {
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
export function toggle(label, checked, onchange) {
  const input = h('input', { type: 'checkbox', checked });
  input.addEventListener('change', async () => { if (await onchange(input.checked) === false) input.checked = !input.checked; });
  return h('label', { class: 'switch' }, input, h('span', { class: 'track', 'aria-hidden': 'true' }), h('span', {}, label));
}

// On narrow screens these tables turn into one card per row; each cell is labelled with its column name.
export function stacked(table) {
  table.classList.add('stack');
  const label = () => {
    const heads = [...table.querySelectorAll('thead th')].map(th => th.dataset.label ?? th.textContent);
    for (const tr of table.querySelectorAll('tbody tr')) [...tr.children].forEach((td, i) => { if (heads[i]) td.dataset.label = heads[i]; });
  };
  label();
  new MutationObserver(label).observe(table, { childList: true, subtree: true });
  return table;
}
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  t.onclick = () => { t.hidden = true; };
  // Long enough to read: short confirmations go quickly, longer messages (usually errors) stay up to 7 seconds.
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, Math.min(7000, Math.max(2200, msg.length * 70)));
}
// Ask with a few named choices in the page (not the browser's confirm). choices: [[value, label, class?], ...];
// resolves to the picked value, or null for Cancel, Esc or a tap outside. Focus starts on Cancel, so a stray Enter does nothing.
export function choose(title, text, choices) {
  return new Promise(resolve => {
    const done = v => { dlg.close(); dlg.remove(); resolve(v); };
    const dlg = h('dialog', { class: 'choose', 'aria-labelledby': 'choose-title' },
      h('h3', { id: 'choose-title' }, title), text && h('p', { class: 'muted' }, text),
      h('div', { class: 'choose-actions' },
        choices.map(([v, label, cls]) => h('button', { type: 'button', class: cls ?? '', onclick: () => done(v) }, label)),
        h('button', { type: 'button', class: 'ghost', autofocus: true, onclick: () => done(null) }, 'Cancel')));
    dlg.addEventListener('cancel', e => { e.preventDefault(); done(null); });
    dlg.addEventListener('click', e => { if (e.target === dlg) done(null); });
    document.body.append(dlg); dlg.showModal();
  });
}
// Yes/no in the page: resolves true only when the action button (labelled `ok`) is picked.
export const ask = async (title, text, ok, cls = 'danger') => await choose(title, text, [[true, ok, cls]]) === true;
export async function callFn(name, body) {
  const res = await fetch(`/.netlify/functions/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// A date picker whose weeks always start on Sunday (the browser's own follows the device's language, and can't be told
// otherwise). Acts like <input type=date> where the pages use it: .value is 'YYYY-MM-DD' or '', and picking a day fires
// 'change'. Arrow keys move a day or a week, Page Up/Down a month, Enter picks, Escape closes.
export function datePicker(value = '', label = 'Date') {
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parse = v => { const [y, m, d] = String(v).split('-').map(Number); return y && m && d ? new Date(y, m - 1, d) : null; };
  let current = parse(value) ? value : '', shown = parse(current) ?? new Date(), focus = shown;
  const btn = h('button', { type: 'button', class: 'date-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': label });
  const pop = h('div', { class: 'cal', role: 'dialog', 'aria-label': label, hidden: true });
  const el = h('span', { class: 'datepick' }, btn, pop);
  const words = d => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const paintBtn = () => { btn.textContent = current ? words(parse(current)) : 'Pick a date'; };
  const pick = d => { current = iso(d); paintBtn(); close(); btn.focus(); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const paint = () => {
    const y = shown.getFullYear(), m = shown.getMonth(), first = new Date(y, m, 1), today = iso(new Date());
    const start = new Date(y, m, 1 - first.getDay()); // back to the Sunday on or before the 1st
    const nav = (step, text, aria) => h('button', { type: 'button', class: 'ghost sm', 'aria-label': aria, onclick: () => { shown = new Date(y, m + step, 1); focus = shown; paint(); } }, text);
    const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)); // six weeks
    pop.replaceChildren(
      h('div', { class: 'cal-head' }, nav(-1, '‹', 'Previous month'), h('b', {}, first.toLocaleDateString([], { month: 'long', year: 'numeric' })), nav(1, '›', 'Next month')),
      h('div', { class: 'cal-grid', role: 'grid' },
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => h('span', { class: 'cal-dow', 'aria-hidden': 'true' }, d.slice(0, 2))),
        days.map(d => {
          const v = iso(d);
          return h('button', { type: 'button', class: ['cal-day', d.getMonth() !== m && 'out', v === today && 'today'].filter(Boolean).join(' '),
            'aria-pressed': String(v === current), 'aria-label': words(d), tabindex: v === iso(focus) ? '0' : '-1', 'data-day': v, onclick: () => pick(d) }, String(d.getDate()));
        })),
      h('div', { class: 'cal-foot' }, h('button', { type: 'button', class: 'ghost sm', onclick: () => pick(new Date()) }, 'Today')));
  };
  const outside = e => { if (!el.contains(e.target)) close(); };
  const open = () => { shown = parse(current) ?? new Date(); focus = shown; paint(); pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
    pop.querySelector('.cal-day[tabindex="0"]')?.focus(); document.addEventListener('pointerdown', outside); };
  function close() { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside); }
  btn.onclick = () => pop.hidden ? open() : close();
  // Inside a <label>, a tap on the calendar's background would "click" the label and so the button; don't let it.
  pop.addEventListener('click', e => { if (!e.target.closest('button')) e.preventDefault(); });
  pop.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); return; }
    const day = e.target.dataset?.day; if (!day) return;
    const d = parse(day);
    const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (move != null) d.setDate(d.getDate() + move);
    else if (e.key === 'PageUp' || e.key === 'PageDown') d.setMonth(d.getMonth() + (e.key === 'PageUp' ? -1 : 1));
    else return;
    e.preventDefault();
    focus = d;
    if (d.getMonth() !== shown.getMonth() || d.getFullYear() !== shown.getFullYear()) { shown = new Date(d.getFullYear(), d.getMonth(), 1); }
    paint(); pop.querySelector('.cal-day[tabindex="0"]')?.focus();
  });
  Object.defineProperty(el, 'value', { get: () => current, set: v => { current = parse(v) ? v : ''; paintBtn(); } });
  paintBtn();
  return el;
}
