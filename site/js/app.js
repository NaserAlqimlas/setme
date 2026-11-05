import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { SKILLS, RATED, TIERS, WEIGHTS, SETTING_WEIGHT, ALL_GAME, combineRatings, weightedTotal, adjustSkills, teamNames } from './teams.mjs';
import { matchPasted, parseTeams } from './paste.mjs';
import { readRatingsCsv, ratingsTemplate, ratingsExport } from './csv.mjs';
import { courtImage } from './courtimg.mjs';
import { recapImage } from './recapimg.mjs';
import { analyze, playerStats, nextPairing, finished, resultAdjustments, MIN_FIT, PRIOR_GAMES, CLOSE, BLOWOUT, TARGET, ADJUST_MIN_GAMES } from './scores.mjs';
import { ACTIONS, gradeLabel, endsRally, other, sideOf, score, suggestAction, nextServer, teamSummary, tallyFromCounts, tally, fromRows, recap, metrics, statRatings, SKILL_STATS, MIN_PLAYERS } from './stats.mjs';
import { attendance, record, seasonRecap, REGULAR_GAP, MIN_GAMES_FOR_RECORD } from './club.mjs';
import { seasonImage } from './seasonimg.mjs';

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
// 'U' is a tap on don't know. A skill with nothing pressed hasn't been answered yet.
const RATING_OPTIONS = [['U', 'U', 'u'], [0, '0'], [.25, '.25'], [.5, '.5'], [.75, '.75'], [1, '1']];
const TIER_OPTIONS = TIERS.map(t => [t, t[0].toUpperCase() + t.slice(1)]);
const TEAM_COLORS = ['#2f6fde', '#e8663a', '#18a36f', '#c99400', '#8b5cf6', '#d6407a'];
// Players (role 'player', from the club upgrade) don't rate: they sign up for game days and see published teams.
const PAGES = [
  { id: 'rate', label: 'Rate', roles: ['rater', 'organizer', 'super'], view: ratePage },
  // club: only once supabase/club.sql has run (profiles then have player_id), so nothing changes before it.
  { id: 'signup', label: 'Sign up', roles: ['player', 'rater', 'organizer', 'super'], view: signupPage, club: true },
  { id: 'lineup', label: 'Lineup', roles: ['player', 'rater'], view: lineupPage, club: true },
  { id: 'players', label: 'Players', roles: ['organizer', 'super'], view: playersPage },
  { id: 'teams', label: 'Teams', roles: ['organizer', 'super'], view: teamsPage },
  { id: 'scores', label: 'Scores', roles: ['organizer', 'super'], view: scoresPage },
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
// A player's name that opens their profile, for whoever may see it (organizers and super: anyone; others: themselves).
const canProfile = id => me.role === 'organizer' || me.role === 'super' || (me.player_id != null && id === me.player_id);
const profileLink = (id, name) => canProfile(id) ? h('a', { href: `#player/${id}`, class: 'name-link' }, name) : h('span', {}, name);
// Supabase's errors when a table, column or function from an upgrade isn't there yet.
const missing = e => /relation|does not exist|schema cache|could not find|column/i.test(e?.message ?? '');
const needsUpgrade = (what, file = 'supabase/club.sql') => h('div', { class: 'card empty' }, `${what} needs the database upgrade: run ${file} in Supabase.`);
const today = () => new Date().toLocaleDateString('en-CA');
const downloadFile = (text, name, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
// A small dropdown of actions (a native <details>, so it works with keyboard and screen readers).
function menu(label, items) {
  const box = h('details', { class: 'menu' }, h('summary', { class: 'ghost-btn' }, label),
    h('div', { class: 'menu-list', role: 'menu' }, items.map(([text, act]) => h('button', { type: 'button', role: 'menuitem', onclick: () => { box.open = false; act(); } }, text))));
  return box;
}
// The avatar in the header: who you are, and sign out.
function accountMenu() {
  const box = h('details', { class: 'menu account' },
    h('summary', { 'aria-label': `Account: ${me.display_name}` }, avatar(me.display_name || '?', 34), h('span', { class: 'who-text' }, h('b', {}, me.display_name), h('small', {}, me.role))),
    h('div', { class: 'menu-list', role: 'menu' },
      h('p', { class: 'small' }, h('b', {}, me.display_name), h('br'), h('span', { class: 'muted' }, `${session.user.email}, ${me.role}`)),
      me.player_id && h('a', { href: `#player/${me.player_id}`, role: 'menuitem', onclick: () => { box.open = false; } }, 'My profile'),
      h('button', { type: 'button', role: 'menuitem', onclick: () => { teamsStore.clear(); sb.auth.signOut(); } }, 'Sign out')));
  return box;
}
// Close any open menu on an outside click or Escape.
document.addEventListener('click', e => document.querySelectorAll('details.menu[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('details.menu[open]').forEach(d => { d.open = false; d.querySelector('summary').focus(); }); });
// An on/off filter shown as a chip.
function filterChip(label, onchange) {
  const b = h('button', { type: 'button', class: 'filter-chip', 'aria-pressed': 'false' }, label);
  b.onclick = () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(v)); onchange(v); };
  return b;
}
const pageHead = (title, sub, ...right) => h('div', { class: 'page-head' }, h('div', {}, h('h2', {}, title), sub && h('p', {}, sub)), right.length ? h('div', { class: 'row' }, right) : null);

function avatar(name, size) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) % 360;
  const initials = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  return h('span', { class: 'avatar', style: `background: hsl(${hash} 50% 31%)${size ? `; width:${size}px; height:${size}px` : ''}`, 'aria-hidden': 'true' }, initials);
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
  t.onclick = () => { t.hidden = true; };
  // Long enough to read: short confirmations go quickly, longer messages (usually errors) stay up to 7 seconds.
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, Math.min(7000, Math.max(2200, msg.length * 70)));
}
// Ask with a few named choices in the page (not the browser's confirm). choices: [[value, label, class?], ...];
// resolves to the picked value, or null for Cancel, Esc or a tap outside. Focus starts on Cancel, so a stray Enter does nothing.
function choose(title, text, choices) {
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
const ask = async (title, text, ok, cls = 'danger') => await choose(title, text, [[true, ok, cls]]) === true;
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
  const pages = PAGES.filter(p => p.roles.includes(me.role) && (!p.club || 'player_id' in me));
  // #player/12 opens a player's profile (not in the nav, except your own as "Me").
  const profileId = Number(location.hash.match(/^#player\/(\d+)$/)?.[1]) || null;
  const current = profileId ? { id: 'profile', view: () => profilePage(profileId) } : pages.find(p => '#' + p.id === location.hash) || pages[0];
  if (pages.length > 1 || me.player_id) for (const p of pages) nav.append(h('a', { href: '#' + p.id, class: p === current ? 'on' : null }, typeof p.label === 'function' ? p.label(me.role) : p.label));
  if (me.player_id) nav.append(h('a', { href: `#player/${me.player_id}`, class: profileId === me.player_id ? 'on' : null }, 'Me'));
  who.append(accountMenu());
  nav.querySelector('a.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
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
  const set = v => {
    open = v;
    try { localStorage.setItem('setme.guide', v ? 'open' : 'closed'); } catch { /* not remembered, that's fine */ }
    panel.classList.toggle('open', v); panel.inert = !v; fab.hidden = v;
    onToggle(v);
  };
  close.onclick = () => set(false);
  fab.onclick = () => set(!open);
  return {
    panel, fab, init: () => set(open),
    focus(skill) {
      if (!open) return;
      for (const [s, el] of items) el.classList.toggle('on', s === skill);
      const el = items.get(skill);
      panel.scrollTo({ top: el.offsetTop - panel.querySelector('.guide-head').offsetHeight - 8, behavior: 'smooth' });
    },
  };
}

// Ratings older than this are worth another look.
const STALE_DAYS = 120;
async function ratePage() {
  const [players, mine, queue, hasUnknown] = await Promise.all([
    q(sb.from('players').select('*').eq('active', true).order('name')), // * so it works before the anchor column exists
    q(sb.from('ratings').select('*').eq('rater_id', me.id)),
    callFn('rate-queue', {}).catch(() => null),
    // The unknown column (rating_unknown.sql) tells don't know apart from not answered yet.
    q(sb.from('ratings').select('unknown').limit(1)).then(() => true, () => false),
  ]);
  const byPlayer = new Map(mine.map(r => [r.player_id, r]));
  const asked = p => RATED.filter(s => forPlayer(s, p));
  const unknownOf = r => r?.unknown ?? [];
  const answered = p => { const r = byPlayer.get(p.id); return r ? asked(p).filter(s => r[s] != null || unknownOf(r).includes(s)).length : 0; };
  // Rated = every skill answered. Before the upgrade a blank can't be told from U, so any saved row counts.
  const done = p => hasUnknown ? answered(p) === asked(p).length : byPlayer.has(p.id);
  // What a skill row shows: the number, U if they said don't know, or nothing pressed if not answered yet.
  const shown = (r, s) => r?.[s] != null ? Number(r[s]) : (hasUnknown ? unknownOf(r).includes(s) : r != null) ? 'U' : undefined;
  let onlyPlaying = false, onlyUnrated = false, onlyLook = false, search = '';
  // Why a player is worth a (fresh) look: ids only from the server, never which way.
  const sets = { results: new Set(queue?.results), few: new Set(queue?.few), anchors: new Set(queue?.anchors ?? players.filter(p => p.anchor).map(p => p.id)) };
  const reasons = p => {
    const r = byPlayer.get(p.id), out = [];
    if (sets.anchors.has(p.id) && !done(p)) out.push('Anchor player: rate them first');
    if (sets.results.has(p.id)) out.push('Results don\'t match their ratings');
    if (sets.few.has(p.id)) out.push('Few people have rated them');
    if (r?.updated_at && Date.now() - Date.parse(r.updated_at) > STALE_DAYS * 864e5) out.push(`Your rating is over ${Math.round(STALE_DAYS / 30)} months old`);
    return out;
  };
  const lookCard = h('div', { class: 'card' });
  const paintLook = () => {
    const list = players.map(p => ({ p, why: reasons(p) })).filter(x => x.why.length);
    const anchorsLeft = players.filter(p => sets.anchors.has(p.id) && !done(p));
    lookCard.hidden = !list.length;
    lookCard.replaceChildren(
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Worth a fresh look'),
        h('p', { class: 'muted small', style: 'margin:2px 0 0' }, anchorsLeft.length
          ? `New here? Start with the ${anchorsLeft.length} anchor player${anchorsLeft.length === 1 ? '' : 's'} everyone rates; it tells SetMe how you rate compared with the others, and until then your ratings count for less.`
          : 'Players where another look helps most. Nothing here says which way; just rate what you see.'))),
      h('ul', { class: 'look-list' }, list.map(({ p, why }) => h('li', { title: why.join('\n') }, h('b', {}, p.name),
        h('span', { class: 'muted small' }, why[0] + (why.length > 1 ? `, and ${why.length - 1} more` : ''))))));
  };
  paintLook();
  const grid = h('div', { class: 'grid' });
  const layout = h('div', { class: 'rate-layout' }, grid);
  const guide = ratingGuide(open => document.body.classList.toggle('guide-open', open));
  layout.append(guide.panel, guide.fab);
  guide.init();
  const bar = h('span'), countEl = h('span', { class: 'small muted' });
  const progress = () => {
    const n = players.filter(done).length;
    bar.style.width = `${players.length ? n / players.length * 100 : 0}%`;
    countEl.textContent = `${n} of ${players.length} players rated`;
  };

  const save = async (pid, skill, picked) => {
    const value = picked === 'U' ? null : picked, prev = byPlayer.get(pid);
    const row = { ...Object.fromEntries(RATED.map(s => [s, null])), ...prev, [skill]: value };
    // U goes on the unknown list; a number takes the skill off it.
    const unknown = hasUnknown ? { unknown: [...unknownOf(prev).filter(s => s !== skill), ...(picked === 'U' ? [skill] : [])] } : {};
    // Send Setting only when it's the skill tapped or the saved row has it, so other taps still save before the
    // setting_skill column is added in Supabase.
    const cols = RATED.filter(s => s !== 'setting_skill' || skill === s || (byPlayer.get(pid) && s in byPlayer.get(pid)));
    try {
      const saved = await q(sb.from('ratings').upsert({ rater_id: me.id, player_id: pid, ...Object.fromEntries(cols.map(s => [s, row[s]])), ...unknown }).select().single());
      byPlayer.set(pid, saved); progress(); totals.get(pid)?.(); paintLook(); toast('Saved');
    } catch (e) { toast(`Not saved: ${e.message}`); return false; }
  };
  // Totals follow the doc's rule: U if any skill is unknown.
  const totals = new Map();
  const card = p => {
    const r = byPlayer.get(p.id);
    const totalEl = h('div', { class: 'totals' });
    const leftEl = h('span', { class: 'muted small answered' });
    const paint = () => {
      const row = byPlayer.get(p.id);
      // How far along a started card is, so a half-rated player doesn't look finished.
      const n = answered(p), of = asked(p).length;
      leftEl.textContent = hasUnknown && n > 0 && n < of ? `${n} of ${of}` : '';
      const known = row && SKILLS.every(s => row[s] != null);
      const sk = known ? Object.fromEntries(SKILLS.map(s => [s, Number(row[s])])) : null;
      totalEl.replaceChildren(
        h('span', {}, h('small', {}, 'Total'), h('b', {}, known ? fmt(SKILLS.reduce((a, s) => a + sk[s], 0)) : 'U')),
        h('span', {}, h('small', {}, 'Weighted'), h('b', {}, known ? fmt(weightedTotal(sk)) : 'U')));
    };
    totals.set(p.id, paint); paint();
    return h('div', { class: 'card player-card' },
      h('header', {}, avatar(p.name), h('b', {}, p.name), sets.anchors.has(p.id) && h('span', { class: 'badge backup', title: 'Anchor player: everyone rates them, so SetMe can compare raters' }, 'Anchor'),
        reasons(p).length > 0 && !sets.anchors.has(p.id) && h('span', { class: 'badge', title: reasons(p).join(' · ') }, 'Look again'),
        p.playing && h('span', { class: 'badge on' }, 'Playing'), leftEl),
      RATED.filter(s => forPlayer(s, p)).map(s => h('div', { class: `skill-row${s === 'consistency' ? ' trait' : ''}`, onclick: () => guide.focus(s) }, h('span', {}, LABEL[s]),
        seg(RATING_OPTIONS, shown(r, s), v => save(p.id, s, v), `${p.name} ${LABEL[s]}`))),
      totalEl);
  };
  const draw = () => {
    // Still to rate = not every skill answered, same as the progress count. A card stays put after a tap until the list is redrawn.
    const list = players.filter(p => (!onlyPlaying || p.playing) && (!onlyUnrated || !done(p)) && (!onlyLook || reasons(p).length) && p.name.toLowerCase().includes(search))
      // Anchors you haven't rated come first, so a new rater starts with them.
      .sort((a, b) => (sets.anchors.has(b.id) && !done(b)) - (sets.anchors.has(a.id) && !done(a)));
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
        await q(sb.from('ratings').upsert(rows.map(r => ({ rater_id: raterId, player_id: r.player.id, ...r.values, ...(hasUnknown && { unknown: r.unknown }) }))));
        toast(`${rows.length} ratings imported`);
        if (raterId !== me.id) sb.from('audit_log').insert({ action: 'ratings imported', detail: { players: rows.length, for: raterId, file: file.name } }).then(() => {}, () => {});
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
        h('span', { class: 'muted small' }, hasUnknown ? 'Replaces existing ratings for these players. U means don\'t know; empty cells stay unanswered.' : 'Replaces existing ratings for these players. Empty cells and U count as unknown.'))));
    importBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const downloadCsv = (text, name) => downloadFile(text, name, 'text/csv');
  const downloadTemplate = () => downloadCsv(ratingsTemplate(players), 'setme-ratings-template.csv');
  const exportRatings = () => downloadCsv(ratingsExport(players, byPlayer), `setme-ratings-${new Date().toISOString().slice(0, 10)}.csv`);

  return h('div', {},
    pageHead('Rate players', 'Only the site owner sees your ratings. Every tap saves.',
      menu('Spreadsheet', [['Download a blank template', downloadTemplate], ['Import ratings from a file', () => fileInput.click()], ['Export my ratings', exportRatings]]), fileInput),
    importBox,
    h('div', { class: 'card' },
      h('div', { class: 'legend' },
        h('span', {}, h('b', {}, '0'), ' unwilling or unable'), h('span', {}, h('b', {}, '.25'), ' below average'),
        h('span', {}, h('b', {}, '.5'), ' average/consistent'), h('span', {}, h('b', {}, '.75'), ' excels'),
        h('span', {}, h('b', {}, '1'), ' top of the group'), h('span', {}, h('b', {}, 'U'), " don't know")),
      h('div', { class: 'progress', style: 'margin:14px 0 6px' }, bar), countEl,
      h('div', { class: 'toolbar', style: 'margin-top:12px' },
        h('input', { type: 'search', placeholder: 'Search players', 'aria-label': 'Search players', oninput: e => { search = e.target.value.trim().toLowerCase(); draw(); } }),
        h('div', { class: 'filter-chips', role: 'group', 'aria-label': 'Show only' },
          filterChip('Playing this session', v => { onlyPlaying = v; draw(); }),
          filterChip(hasUnknown ? 'Still to rate' : 'Not rated yet', v => { onlyUnrated = v; draw(); }),
          filterChip('Worth a look', v => { onlyLook = v; draw(); })))),
    lookCard,
    layout);
}

// ---------- players (organizers) ----------
// Who was playing before the last paste or clear, so Undo can put the list back. Lasts while the page is open.
let playingUndo = null;
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
        // Anchor players: every rater rates them first (only once the club upgrade adds the column).
        me.role === 'super' && 'anchor' in p && toggle('Anchor', p.anchor, v => update(p, { anchor: v })),
        h('span', { class: 'grow' }),
        h('a', { href: `#player/${p.id}`, class: 'name-link small' }, 'Profile'),
        me.role === 'super' && h('button', { class: 'danger sm', onclick: () => removePlayer(p) }, 'Delete')));
    return el;
  };
  const removePlayer = async p => {
    if (!await ask(`Delete ${p.name}?`, 'Their ratings are deleted too. This can\'t be undone.', 'Delete player')) return;
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
    // The paste replaces the whole list, so say who comes off it (and who's new) before anything changes.
    const now = new Set(players.filter(p => p.playing).map(p => p.id)), next = new Set(matched.map(m => m.player.id));
    const adding = matched.filter(m => !now.has(m.player.id)), removing = players.filter(p => now.has(p.id) && !next.has(p.id));
    const apply = async () => {
      const before = [...now];
      try {
        await q(sb.from('players').update({ playing: false }).eq('playing', true));
        if (matched.length) await q(sb.from('players').update({ playing: true, active: true }).in('id', matched.map(m => m.player.id)));
        playingUndo = { ids: before, what: `Playing list set to ${matched.length}${removing.length ? `, ${removing.length} taken off` : ''}.` };
        toast(`${matched.length} players set as playing`); render();
      } catch (err) { toast(err.message); }
    };
    const section = (title, note, list, cls) => list.length > 0 && [
      h('p', { class: 'small', style: 'margin:12px 0 6px' }, h('b', {}, title), note && h('span', { class: 'muted' }, note)),
      h('div', { class: 'chips' }, list.map(([name, line]) => h('span', { class: `chip plain ${cls}`, title: line }, name)))];
    // Wrapped in a div: h() skips false and flattens lists, replaceChildren doesn't.
    pasteResult.replaceChildren(h('div', {},
      h('p', { class: 'small', style: 'margin:12px 0 6px' }, h('b', {}, `${matched.length} matched`)),
      h('div', { class: 'chips' }, matched.map(m => h('span', { class: 'chip plain', title: m.line }, m.player.name))),
      section(`${removing.length} taken off`, ' (playing now, not in the paste)', removing.map(p => [p.name]), ''),
      section(`${adding.length} new to the list`, null, adding.map(m => [m.player.name, m.line]), ''),
      matched.length > 0 && !removing.length && !adding.length && h('p', { class: 'small muted', style: 'margin:12px 0 0' }, 'Same as the current playing list.'),
      waitlist.length > 0 && h('p', { class: 'small muted', style: 'margin:12px 0 6px' }, h('b', {}, `${waitlist.length} on the waitlist`), ' (not ticked)'),
      waitlist.length > 0 && h('div', { class: 'chips' }, waitlist.map(m => h('span', { class: 'chip plain off', title: m.line }, m.player.name))),
      unmatched.length > 0 && h('p', { class: 'small muted', style: 'margin:12px 0 6px' },
        h('b', {}, `${unmatched.length} not recognized`), me.role === 'super' ? ' (ignored; add them as players first if they should count)' : ' (ignored)'),
      unmatched.length > 0 && h('div', { class: 'chips' }, unmatched.map(l => h('span', { class: 'chip plain off' }, l))),
      h('div', { class: 'row', style: 'margin-top:14px' },
        h('button', { class: 'ball', onclick: apply, disabled: !matched.length }, `Set playing list (${matched.length})`),
        h('span', { class: 'muted small' }, removing.length ? `Takes ${removing.length} off. You can undo it.` : 'Replaces the current playing list.'))));
  };
  box.addEventListener('input', checkPaste);

  const clearPlaying = async () => {
    if (!await ask('Clear the playing list?', 'Everyone is unticked. You can undo it right after.', 'Clear list')) return;
    const before = players.filter(p => p.playing).map(p => p.id);
    try {
      await q(sb.from('players').update({ playing: false }).eq('playing', true));
      playingUndo = { ids: before, what: `Playing list cleared (${before.length} taken off).` }; render();
    } catch (err) { toast(err.message); }
  };
  const undoPlaying = async () => {
    try {
      await q(sb.from('players').update({ playing: false }).eq('playing', true));
      if (playingUndo.ids.length) await q(sb.from('players').update({ playing: true }).in('id', playingUndo.ids));
      toast(`Playing list put back (${playingUndo.ids.length})`); playingUndo = null; render();
    } catch (err) { toast(`Not undone: ${err.message}`); }
  };

  return h('div', {},
    pageHead('Players', 'Who\'s playing this session, and each player\'s setter role.', countEl),
    playingUndo && h('div', { class: 'card undo-line', role: 'status' }, h('span', {}, playingUndo.what),
      h('button', { class: 'ghost sm', onclick: undoPlaying }, 'Undo'),
      h('button', { class: 'ghost sm', 'aria-label': 'Dismiss', onclick: e => { playingUndo = null; e.target.closest('.undo-line').remove(); } }, '×')),
    me.role === 'super' && h('form', { class: 'card add-player', onsubmit: add },
      h('div', { class: 'row' }, name, h('button', {}, 'Add player')),
      h('div', { class: 'field' }, h('span', {}, 'Level until rated'), tierPick)),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Paste from WhatsApp'),
        h('p', { class: 'muted small', style: 'margin:2px 0 0' }, 'Paste the group\'s list to tick everyone who\'s playing.'))),
      box, pasteResult),
    me.role === 'super' && players.length && 'anchor' in players[0] && h('p', { class: 'muted small' }, h('b', {}, 'Anchor'),
      ': a well-known player every rater rates first. Pick 4 to 6 across the range (strong, average, newer), so a new rater\'s lean is known quickly.'),
    h('div', { class: 'card toolbar' },
      h('input', { type: 'search', placeholder: 'Search players', 'aria-label': 'Search players', oninput: e => { search = e.target.value.trim().toLowerCase(); draw(); } }),
      h('button', { class: 'ghost', onclick: clearPlaying }, 'Clear playing list')),
    grid,
    h('p', { class: 'muted small', style: 'margin-top:16px' }, 'Main setters: one per team. Backups: at most one per team.'));
}

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
// Said right after a swap, next to the teams: who moved, how the gap changed, and Undo.
function changeLine(before, after, onUndo) {
  if (!before || !after) return null;
  const gap = o => { const t = o.teams.map(x => x.weighted); return Math.max(...t) - Math.min(...t); };
  const teamOf = new Map(before.teams.flatMap((t, k) => t.players.map(p => [p.id, k])));
  const moved = after.teams.flatMap((t, k) => t.players.filter(p => teamOf.get(p.id) !== k).map(p => `${p.name} to Team ${k + 1}`));
  const [g0, g1] = [gap(before), gap(after)];
  const worse = g1 > g0 + 0.005;
  const detail = me.role === 'super' || me.role === 'organizer';
  return h('div', { class: `change-line${worse ? ' worse' : ''}`, role: 'status' },
    h('p', { class: 'small' }, h('b', {}, moved.length ? `Moved ${moved.join(', ')}.` : 'Swapped.'), ' ',
      detail ? `Gap ${num2(g0)} → ${num2(g1)}, ${worse ? 'less even' : g1 < g0 - 0.005 ? 'more even' : 'about the same'}.` : worse ? 'Less even than before.' : ''),
    onUndo && h('button', { type: 'button', class: 'ghost sm', onclick: onUndo }, 'Undo'));
}
// Database upgrade messages: the super can run the SQL file; anyone else is told who can.
const needsSql = (what, file) => me.role === 'super' ? `${what} need the database upgrade (supabase/${file})` : `${what} aren't set up yet. Ask the site owner to finish the upgrade.`;

// Team totals and gaps on Teams: always two decimals with a leading zero, easier to compare at a glance.
const num2 = v => (Math.round(v * 100) / 100).toFixed(2);
// How even an option is, from the gap between the strongest and weakest team's total.
const EVEN = [[0.25, 'Very even'], [0.6, 'Even'], [1.2, 'A bit uneven'], [Infinity, 'Uneven']];
const evenness = gap => EVEN.find(([max]) => gap <= max)[1];
// The scale in words, said next to a gap so organizers can judge it without knowing the numbers.
const GAP_SCALE = 'Under 0.25 is very even, under 0.60 even, over 1.20 uneven.';

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

async function teamsPage() {
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
      onApply: sg => edit(i, sg.teams),
      onUndo: undos[i]?.length > 0 && (() => undo(i)),
    }),
  })); };
  const undo = i => { [built.options[i], checked[i]] = undos[i].pop(); changes[i] = null; draw(); };
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
    const undo = history.length > 0 && (() => { current = history.pop(); changedFrom = null; run().catch(e => toast(e.message)); });
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
      onApply: sg => { history.push(current); changedFrom = lastOpt; current = sg.teams; run().catch(e => toast(e.message)); },
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

// Work on Teams kept on this device, so a reload, a locked phone or a trip to WhatsApp doesn't lose it: the built
// options with their swaps, Undo and locks, or your own checked teams, plus combos, the setter plan and the switches.
// Kept until its game day has passed; cleared on sign out. Only this device has it (to hand over, save the teams).
// { at, day, shows: 'built' | 'own', built, own, combos, setterPlan, switches }
const TEAMS_KEY = 'setme.teams';
const teamsStore = {
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
    ready = courtImage(teams, { title: dayTitle(gameDate), colors: TEAM_COLORS, names: teamNames(teams.map(t => t.players)) }).then(b => (blob = b));
  };
  prep();
  document.addEventListener('gamedate', prep);
  btn = h('button', { class: 'ghost sm', onclick: async () => sharePng(blob ?? await ready, name) }, 'Share image');
  return btn;
}

// Share sheet where there is one (phones), else copy to the clipboard, else download.
async function sharePng(b, name) {
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
function recapButton(label, title, subtitle, file, pname, teamName, lineups = () => []) {
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
function setterBadge(p, onSetter) {
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
    const gapLine = h('p', { class: 'verdict' });
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
    const pick = (k, id) => {
      if (!picked || picked[1] === id) { picked = picked ? null : [k, id]; return paint(); }
      if (picked[0] === k) { picked = [k, id]; return paint(); }
      const [a, b] = [picked[1], id];
      picked = null;
      busy();
      onSwap(i, opt.teams.map(t => t.players.map(p => p.id === a ? b : p.id === b ? a : p.id)));
    };
    const canSwap = onSwap && opt.teams.every(t => t.players.every(p => p.id != null));
    const name = (k, p) => !canSwap ? [avatar(p.name, 28), h('span', { class: 'pname' }, p.name)]
      : [h('button', { type: 'button', class: 'pick', 'aria-pressed': String(picked?.[1] === p.id),
        title: picked && picked[0] !== k ? `Swap with ${opt.teams[picked[0]].players.find(x => x.id === picked[1])?.name}` : `Swap ${p.name} with someone`,
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
    const paint = () => {
      hints = picked && opt.partners ? opt.partners[picked[1]] ?? [] : null;
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
          onLock && lk && p.id != null && h('button', { type: 'button', class: 'lock', 'aria-pressed': String(lk.has(p.id)),
            title: lk.has(p.id) ? `${p.name} stays on this team (tap to unlock)` : `Keep ${p.name} on this team`,
            'aria-label': lk.has(p.id) ? `Unlock ${p.name}` : `Lock ${p.name} on this team`, onclick: () => onLock(p.id, i) }, lockIcon(lk.has(p.id)))))),
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
      canSwap && h('p', { class: 'muted small swap-hint' }, opt.partners ? 'Tap a player to see their best swaps or replace them.' : 'Tap a player, then one on another team, to swap them.'),
      typeof notice === 'function' ? notice(i) : notice,
      grid, detail && h('div', { class: 'row option-foot' }, guessNote, h('span', { class: 'grow' }), skillsBtn),
      typeof extra === 'function' ? extra(i) : i === 0 && extra);
    sections.push(section);
    parts.push(section);
  });
  if (!res.options.length) parts.push(h('p', { class: 'warn' }, 'No lineup found.'));
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

// ---------- scores (organizers) ----------
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

let scoresTab = 'games', scoresDay = null;
// Set when a new round starts on Scores with the same teams, so the page comes back with Change players open.
let scoresEditNext = false;
// A game day's rounds, oldest first: [{ n, teams, raters, all_game, current }]. The last is the round playing now
// (the session's own teams); earlier ones come from rounds (rows: that table, null before rounds.sql).
function roundsOf(ses, rows) {
  const kept = (rows ?? []).filter(r => r.session_id === ses.id).sort((a, b) => a.n - b.n);
  return [...kept.map(r => ({ ...r, current: false })), { n: kept.length + 1, teams: ses.teams, raters: ses.raters, all_game: ses.all_game, current: true }];
}
const roundOf = g => g.round ?? 1;
// (session id, team number from 1, round) -> that team's name in that round, from who is on it (late changes
// included). No round = the round playing now.
function sessionTeamNamer(sessions, players, rounds) {
  const byId = new Map(players.map(p => [p.id, p])), byS = new Map(sessions.map(s => [s.id, s]));
  return (sid, k, round) => {
    const s = byS.get(sid);
    const rs = s ? roundsOf(s, rounds) : [];
    const r = rs.find(x => x.n === round) ?? rs.at(-1);
    const names = r && Array.isArray(r.teams) ? teamNames(r.teams.map(t => (Array.isArray(t) ? t : []).map(id => byId.get(id)).filter(Boolean)), new Set(r.all_game ?? [])) : [];
    return names[k - 1] ?? `Team ${k}`;
  };
}
async function scoresPage() {
  const [sessions, players, rounds] = await Promise.all([
    q(sb.from('sessions').select('*').order('played_on', { ascending: false })),
    q(sb.from('players').select('id,name,setting,active').order('name')),
    q(sb.from('rounds').select('*')).catch(() => null), // null before rounds.sql
  ]);
  const pname = new Map(players.map(p => [p.id, p.name]));
  const tname = sessionTeamNamer(sessions, players, rounds);
  const body = h('div');
  const tabs = seg([['games', 'Games'], ['insights', 'Insights'], ['attendance', 'Attendance'], ['season', 'Season']], scoresTab, v => { scoresTab = v; draw(); }, 'Scores view');
  const views = { games: () => gamesView(sessions, players, pname, tname, rounds), insights: () => insightsView(sessions, pname, tname),
    attendance: () => attendanceView(sessions, players, pname), season: () => seasonView(sessions, pname, tname) };
  const draw = async () => {
    body.replaceChildren(h('p', { class: 'empty' }, 'Loading…'));
    try { body.replaceChildren(...await views[scoresTab]()); }
    catch (e) { body.replaceChildren(h('p', { class: 'warn' }, e.message)); }
  };
  draw();
  return h('div', {}, pageHead('Scores', 'Enter each game\'s score. Insights show how well the teams were balanced.', tabs), body);
}

async function gamesView(sessions, players, pname, tname, roundRows) {
  if (!sessions.length) return [h('div', { class: 'card empty' }, 'No teams saved yet. On Teams, build or check a lineup and tap ', h('b', {}, 'Save'), '.')];
  if (!sessions.some(s => s.played_on === scoresDay)) scoresDay = sessions[0].played_on;
  const ses = sessions.find(s => s.played_on === scoresDay);
  let games = await q(sb.from('games').select('*').eq('session_id', ses.id).order('created_at'));
  // Finished rallies tagged per game (null = the match stats SQL hasn't been run).
  const tags = games.length ? await q(sb.from('rallies').select('game_id').in('game_id', games.map(g => g.id)).not('won_by', 'is', null))
    .then(rows => rows.reduce((m, r) => m.set(r.game_id, (m.get(r.game_id) ?? 0) + 1), new Map()), () => null) : new Map();
  const tagGame = games.find(g => g.id === taggingGame);
  if (tagGame) return [await tagView(tagGame, games.indexOf(tagGame) + 1, pname, tname, () => { taggingGame = null; render(); })];
  taggingGame = null;
  const wrap = h('div');
  const daySel = h('select', { 'aria-label': 'Game day' }, sessions.map(s => h('option', { value: s.played_on, selected: s.played_on === scoresDay }, dayTitle(s.played_on) + (s.ended ? ' (ended)' : ''))));
  daySel.onchange = () => { scoresDay = daySel.value; render(); };

  // Delete day: only on the day itself (or a day still to come). Once the date has passed, the day stays.
  const delDay = ses.played_on >= today() && h('button', { class: 'danger sm', onclick: async () => {
    const n = games.length;
    if (await choose(`Delete ${dayTitle(ses.played_on)}?`, `Its teams${n ? `, all ${n} game${n === 1 ? '' : 's'} and their tags` : ''} are deleted too. This can't be undone.`, [[true, 'Delete day', 'danger']]) !== true) return;
    try { await q(sb.from('sessions').delete().eq('id', ses.id)); toast('Deleted'); render(); } catch (e) { toast(e.message); }
  } }, 'Delete day');

  // Rounds: the last is the one playing now (ses.teams); new games go into it. One round before rounds.sql.
  const rounds = roundsOf(ses, roundRows), cur = rounds.at(-1).n, hasRounds = roundRows != null;
  const inRound = n => games.filter(g => roundOf(g) === n);
  const teamsIn = n => n === cur ? ses.teams : rounds.find(r => r.n === n)?.teams ?? [];
  const N = () => ses.teams.length;
  const teamName = (k, n = cur) => tname(ses.id, k, n);
  const teamsBox = h('div'), entry = h('div'), list = h('div', { class: 'card' });
  let editing = scoresEditNext; scoresEditNext = false;
  // Swapping while changing players: the player tapped first, as [team index, player id].
  let picked = null;
  // Setters who set all game: as saved with the teams; a main setter who arrived later does by default.
  const allGameFor = ids => { const known = new Set(ses.all_game); return [...known, ...ids.filter(id => !known.has(id) && players.find(p => p.id === id)?.setting === 'M')]; };
  // While changing players: how even the teams are now, from the same ratings the lineup was built with.
  const balance = h('p', { class: 'small verdict', 'aria-live': 'polite' });
  const paintBalance = async () => {
    const teams = ses.teams;
    if (!editing || teams.length < 2 || teams.some(t => !t.length)) return balance.replaceChildren();
    try {
      const r = await callFn('build-teams', { predict: true, teams, raters: ses.raters, allGame: allGameFor(teams.flat()) });
      if (teams !== ses.teams) return; // changed again meanwhile
      const t = r.teams.map(x => x.weighted), gap = Math.max(...t) - Math.min(...t);
      balance.replaceChildren(h('b', {}, evenness(gap)), h('span', { class: 'muted' }, ` · team totals ${num2(Math.min(...t))} to ${num2(Math.max(...t))}, a gap of ${num2(gap)}. ${GAP_SCALE}`));
    } catch { balance.replaceChildren(); }
  };
  const swap = (i, id) => {
    if (!picked || picked[0] === i) { picked = picked?.[1] === id ? null : [i, id]; return paintTeams(); }
    const [j, other] = picked; picked = null;
    saveTeams(ses.teams.map((t, k) => k === i ? t.map(x => x === id ? other : x) : k === j ? t.map(x => x === other ? id : x) : t));
  };

  // Late changes: remove someone, or add anyone (picking a player on another team moves them). Saved straight away;
  // games already entered keep who they had.
  const saveTeams = async teams => {
    const before = ses.teams; ses.teams = teams;
    try { await q(sb.from('sessions').update({ teams }).eq('id', ses.id)); toast('Saved. Next games use these players.'); }
    catch (e) { ses.teams = before; toast(e.message); }
    paintTeams(); paintEntry(); paintBalance();
  };
  const record = (k, n = cur) => {
    const mine = inRound(n).filter(g => g.team_a === k || g.team_b === k);
    const won = mine.filter(g => (g.team_a === k ? g.score_a - g.score_b : g.score_b - g.score_a) > 0).length;
    const diff = mine.reduce((a, g) => a + (g.team_a === k ? g.score_a - g.score_b : g.score_b - g.score_a), 0);
    return mine.length ? `${won}–${mine.length - won} · ${diff > 0 ? '+' : ''}${diff}` : 'No games yet';
  };
  const paintTeams = () => {
    const active = players.filter(p => p.active);
    const canRound = hasRounds && !editing && !ses.ended && inRound(cur).length > 0;
    teamsBox.replaceChildren(h('div', { class: 'card-head' },
      h('div', {}, h('h3', {}, cur > 1 ? `Round ${cur} teams` : 'Teams'), h('p', { class: 'muted small', style: 'margin:2px 0 0' },
        editing ? `Tap a player, then one on another team, to swap them. Remove someone who left, or add a late arrival. Games already saved keep who they had.` : 'Wins–losses and points for minus points against.')),
      cur > 1 && !inRound(cur).length && !editing && h('button', { class: 'ghost sm', onclick: backRound }, `Back to round ${cur - 1}`),
      canRound && h('button', { class: 'ghost sm', onclick: newRound }, `Start round ${cur + 1}`),
      h('button', { class: editing ? 'sm' : 'ghost sm', onclick: () => { editing = !editing; picked = null; paintTeams(); paintBalance(); } }, editing ? 'Done' : 'Change players')),
    editing && balance,
    picked && h('p', { class: 'small swap-hint', role: 'status' }, h('b', {}, `Picked: ${pname.get(picked[1]) ?? 'player'}.`), ' Tap someone on another team to swap, or tap them again to cancel.'),
    h('div', { class: `team-grid${picked ? ' picking' : ''}` }, ses.teams.map((ids, i) => {
      const k = i + 1;
      const add = editing && h('select', { 'aria-label': `Add a player to ${teamName(k)}` },
        h('option', { value: '' }, '+ Add player'),
        active.filter(p => !ids.includes(p.id)).map(p => {
          const on = ses.teams.findIndex(t => t.includes(p.id));
          return h('option', { value: p.id }, on >= 0 ? `${p.name} (from ${teamName(on + 1)})` : p.name);
        }));
      if (add) add.onchange = () => {
        const id = Number(add.value); if (!id) return;
        saveTeams(ses.teams.map((t, j) => j === i ? [...t, id] : t.filter(x => x !== id)));
      };
      const who = id => editing
        ? h('button', { type: 'button', class: 'pick', 'aria-pressed': String(picked?.[1] === id), onclick: () => swap(i, id),
          'aria-label': picked && picked[0] !== i ? `Swap ${pname.get(id)} with ${pname.get(picked[1])}` : `Pick ${pname.get(id)} to swap` },
          avatar(pname.get(id) ?? '?', 28), h('span', { class: 'pname' }, pname.get(id) ?? 'Removed player'))
        : [avatar(pname.get(id) ?? '?', 28), h('span', { class: 'pname' }, pname.get(id) ?? 'Removed player')];
      return h('article', { class: `team${picked?.[0] === i ? ' from' : ''}`, style: `--tc: ${TEAM_COLORS[i % TEAM_COLORS.length]}` },
        h('header', {}, h('h4', {}, teamName(k)), h('span', { class: 'muted small' }, record(k))),
        h('ul', {}, ids.map(id => h('li', {}, who(id),
          editing && h('button', { type: 'button', class: 'ghost sm', 'aria-label': `Remove ${pname.get(id)}`,
            onclick: () => ids.length > 1 ? saveTeams(ses.teams.map((t, j) => j === i ? t.filter(x => x !== id) : t)) : toast('A team needs at least one player') }, '×')))),
        add);
    })),
    ...rounds.filter(r => !r.current).reverse().map(r => h('details', { class: 'round-past' },
      h('summary', {}, h('b', {}, `Round ${r.n}`), h('span', { class: 'muted small' }, ` · ${inRound(r.n).length} game${inRound(r.n).length === 1 ? '' : 's'}`)),
      h('div', { class: 'team-grid' }, r.teams.map((ids, i) => h('article', { class: 'team', style: `--tc: ${TEAM_COLORS[i % TEAM_COLORS.length]}` },
        h('header', {}, h('h4', {}, teamName(i + 1, r.n)), h('span', { class: 'muted small' }, record(i + 1, r.n))),
        h('ul', {}, ids.map(id => h('li', {}, avatar(pname.get(id) ?? '?', 28), h('span', { class: 'pname' }, pname.get(id) ?? 'Removed player')))))))))
    );
  };
  // Start the next round from here: keep this round with its games and standings, then either play on with the same
  // teams (Change players opens to swap a few people) or build new ones on Teams.
  const newRound = async () => {
    const pick = await choose(`Start round ${cur + 1}?`, `Round ${cur} is kept with its ${inRound(cur).length} game${inRound(cur).length === 1 ? '' : 's'} and standings. Start round ${cur + 1} with the same teams and swap players here, or build new teams on Teams.`,
      [['here', 'Same teams, swap here', 'ball'], ['teams', 'Build new teams', 'ghost']]);
    if (pick === 'teams') { gameDate = ses.played_on; location.hash = '#teams'; return; }
    if (pick !== 'here') return;
    try {
      await q(sb.rpc('start_round', { p_session: ses.id, p_teams: ses.teams, p_raters: ses.raters ?? null, p_all_game: ses.all_game ?? [], p_source: ses.source ?? null }));
      toast(`Round ${cur + 1} started. Swap players, then tap Done.`);
      scoresEditNext = true; render();
    } catch (e) { toast(e.message); }
  };
  // Undo a new round before any game is entered in it: the previous round's teams come back.
  const backRound = async () => {
    if (await choose(`Go back to round ${cur - 1}?`, `Round ${cur}'s teams are dropped and round ${cur - 1}'s teams are playing again. No games are lost.`, [[true, `Back to round ${cur - 1}`, 'danger']]) !== true) return;
    try { await q(sb.rpc('undo_round', { p_session: ses.id })); toast(`Back to round ${cur - 1}`); render(); }
    catch (e) { toast(e.message); }
  };

  // New game: which two teams, then the score. Played to 25; a game cut short by time is saved as it stood.
  const paintEntry = () => {
    const [pa, pb] = nextPairing(N(), inRound(cur)) ?? [1, 2];
    const pick = (v, label) => h('select', { 'aria-label': label }, ses.teams.map((_, i) => h('option', { value: i + 1, selected: i + 1 === v }, teamName(i + 1))));
    const ta = pick(pa, 'First team'), tb = pick(pb, 'Second team');
    const num = label => h('input', { type: 'number', min: 0, max: 99, inputmode: 'numeric', class: 'score-in', 'aria-label': label, placeholder: '0' });
    const sa = num('First team score'), sB = num('Second team score');
    const btn = h('button', { class: 'ball' }, 'Save game');
    const note = h('p', { class: 'muted small' });
    const hint = () => {
      const a = Number(sa.value), b = Number(sB.value);
      note.textContent = sa.value === '' || sB.value === '' ? `Games go to ${TARGET}. Time up? Save the score as it stood.`
        : Math.max(a, b) < TARGET ? `Saved as stopped early (time up). It counts as if scaled to a game to ${TARGET}.` : '';
    };
    sa.oninput = sB.oninput = hint; hint();
    btn.onclick = async () => {
      const a = Number(ta.value), b = Number(tb.value);
      if (a === b) return toast('Pick two different teams');
      if (sa.value === '' || sB.value === '') return toast('Enter both scores');
      const A = Number(sa.value), B = Number(sB.value);
      if (![A, B].every(v => Number.isInteger(v) && v >= 0 && v <= 99)) return toast('Scores are whole numbers from 0 to 99');
      if (A === B) return toast('A game can\'t end in a tie');
      btn.disabled = true; btn.textContent = 'Saving…';
      const players_a = ses.teams[a - 1], players_b = ses.teams[b - 1];
      const allGame = allGameFor([...players_a, ...players_b]);
      let predicted = null;
      try {
        const r = await callFn('build-teams', { predict: true, teams: [players_a, players_b], raters: ses.raters, allGame });
        predicted = { a: r.teams[0], b: r.teams[1] };
      } catch (e) { toast(`Saved without a prediction: ${e.message}`); }
      try {
        const [g] = await q(sb.from('games').insert({ session_id: ses.id, team_a: a, team_b: b, players_a, players_b, score_a: A, score_b: B, predicted, ...(hasRounds ? { round: cur } : {}) }).select());
        games = [...games, g];
        if (predicted) toast('Game saved');
        paintTeams(); paintEntry(); paintList();
      } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = 'Save game'; }
    };
    entry.replaceChildren(h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, `Game ${games.length + 1}`),
      h('p', { class: 'muted small', style: 'margin:2px 0 0' }, N() > 2 ? 'Next up from the rotation; change it if you played someone else.' : 'Same two teams until time is up.'))),
      h('div', { class: 'score-row' }, h('div', { class: 'score-side' }, ta, sa), h('span', { class: 'muted vs' }, 'v'), h('div', { class: 'score-side right' }, sB, tb), btn),
      note);
  };

  // Saved games, newest first. Scores can be fixed in place; the players and prediction stay as saved.
  const paintList = () => {
    list.hidden = !games.length;
    if (!games.length) return list.replaceChildren();
    const lineup = (ids, k, n) => ids.join() !== (teamsIn(n)[k - 1] ?? []).join() ? ` (${ids.map(id => firstName(pname.get(id))).join(', ')})` : '';
    // Newest round first, each round's games newest first. Game numbers run through the whole day.
    list.replaceChildren(h('h3', {}, 'Games'), ...[...rounds].reverse().filter(r => inRound(r.n).length).flatMap(r => [cur > 1 && h('h4', { class: 'round-head' }, `Round ${r.n}`), h('ol', { class: 'game-list' }, [...inRound(r.n)].reverse().map(g => {
      const n = games.indexOf(g) + 1;
      const input = (key, label) => {
        const el = h('input', { type: 'number', min: 0, max: 99, inputmode: 'numeric', class: 'score-in sm', value: g[key], 'aria-label': label });
        el.onchange = async () => {
          const v = Number(el.value);
          if (!Number.isInteger(v) || v < 0 || v > 99) { el.value = g[key]; return toast('Scores are whole numbers from 0 to 99'); }
          try { await q(sb.from('games').update({ [key]: v }).eq('id', g.id)); g[key] = v; toast('Saved'); paintTeams(); }
          catch (e) { el.value = g[key]; toast(e.message); }
        };
        return el;
      };
      const changed = [lineup(g.players_a, g.team_a, roundOf(g)) && `${teamName(g.team_a, roundOf(g))}${lineup(g.players_a, g.team_a, roundOf(g))}`, lineup(g.players_b, g.team_b, roundOf(g)) && `${teamName(g.team_b, roundOf(g))}${lineup(g.players_b, g.team_b, roundOf(g))}`].filter(Boolean).join(' · ');
      return h('li', {},
        h('span', { class: 'game-no muted' }, String(n)),
        h('div', { class: 'grow' }, h('b', {}, `${teamName(g.team_a, roundOf(g))} v ${teamName(g.team_b, roundOf(g))}`),
          !finished(g) && h('span', { class: 'muted small' }, ' · time up'),
          changed && h('div', { class: 'muted small' }, changed)),
        h('span', { class: 'game-score' }, input('score_a', `Game ${n} ${teamName(g.team_a, roundOf(g))} score`), '–', input('score_b', `Game ${n} ${teamName(g.team_b, roundOf(g))} score`)),
        h('button', { class: 'ghost sm', title: 'Tag who did what from the game\'s video', onclick: () => {
          if (!tags) return toast('Match stats need the database upgrade (supabase/match_stats.sql)');
          taggingGame = g.id; render();
        } }, tags?.get(g.id) ? `Tags (${tags.get(g.id)})` : 'Tag'),
        h('button', { class: 'ghost sm', 'aria-label': `Delete game ${n}`, onclick: async () => {
          if (!await ask(`Delete game ${n}?`, `${teamName(g.team_a, roundOf(g))} v ${teamName(g.team_b, roundOf(g))}, ${g.score_a}–${g.score_b}${tags?.get(g.id) ? `, and its ${tags.get(g.id)} tagged rallies` : ''}. This can't be undone.`, 'Delete game')) return;
          try { await q(sb.from('games').delete().eq('id', g.id)); games = games.filter(x => x !== g); paintTeams(); paintEntry(); paintList(); }
          catch (e) { toast(e.message); }
        } }, 'Delete'));
    }))]).filter(Boolean));
  };
  // Once the day is ended the entry box gives way to the final standings: most wins, then point difference.
  const standings = (n = cur) => teamsIn(n).map((_, i) => {
    const k = i + 1, mine = inRound(n).filter(g => g.team_a === k || g.team_b === k);
    const diff = mine.reduce((a, g) => a + (g.team_a === k ? g.score_a - g.score_b : g.score_b - g.score_a), 0);
    const won = mine.filter(g => (g.team_a === k ? g.score_a > g.score_b : g.score_b > g.score_a)).length;
    return { k, won, lost: mine.length - won, diff };
  }).sort((a, b) => b.won - a.won || b.diff - a.diff);
  const setEnded = async v => {
    try { await q(sb.from('sessions').update({ ended: v }).eq('id', ses.id)); ses.ended = v; toast(v ? 'Game day ended' : 'Game day reopened'); render(); }
    catch (e) { toast(e.message); }
  };
  const paintEnded = () => entry.replaceChildren(
    h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Game day over'),
      h('p', { class: 'muted small', style: 'margin:2px 0 0' }, games.length
        ? `${games.length} game${games.length === 1 ? '' : 's'} played. You can still fix a score below.`
        : 'No games were entered.')),
      h('button', { class: 'ghost sm', onclick: () => setEnded(false) }, 'Reopen')),
    ...[...rounds].reverse().filter(r => inRound(r.n).length).flatMap(r => [cur > 1 && h('h4', { class: 'round-head' }, `Round ${r.n}`),
      h('ol', { class: 'standings' }, standings(r.n).map(t => h('li', { style: `--tc: ${TEAM_COLORS[(t.k - 1) % TEAM_COLORS.length]}` },
        h('b', {}, teamName(t.k, r.n)), h('span', {}, `${t.won} won, ${t.lost} lost`), h('span', { class: 'muted' }, `${t.diff > 0 ? '+' : ''}${t.diff} points`))))]));
  paintTeams(); ses.ended ? paintEnded() : paintEntry(); paintList(); paintBalance();
  // Day recap: every game's result, plus standouts and team numbers from whatever has been tagged.
  const dayRecap = recapButton('Day recap', 'Game day recap', dayTitle(ses.played_on), `recap-${ses.played_on}.png`, pname, (k, n) => teamName(k, n),
    () => rounds.filter(r => inRound(r.n).length).map(r => ({ round: r.n, teams: teamsIn(r.n).map((ids, i) => ({ k: i + 1, ids })) })));
  if (games.length) {
    const stored = tags ? await q(sb.from('rallies').select('id,game_id,seq,video_t,serving,won_by,touches(seq,player_id,action,grade,video_t)').in('game_id', games.map(g => g.id))).catch(() => []) : [];
    dayRecap.refresh(games.map(g => ({ game: g, rallies: fromRows(stored.filter(r => r.game_id === g.id)) })));
  }
  // Players see a game day's teams and scores on Lineup only once an organizer turns this on (club upgrade).
  const publish = 'published' in ses && h('span', { title: 'Show these teams and scores to everyone on the Lineup page' }, toggle('Show to players', ses.published, async v => {
    try { await q(sb.from('sessions').update({ published: v }).eq('id', ses.id)); ses.published = v; toast(v ? 'Players can see these teams' : 'Hidden from players'); }
    catch (e) { toast(e.message); return false; }
  }));
  const endDay = 'ended' in ses && !ses.ended && h('button', { class: 'ghost sm', onclick: async () => {
    if (await ask(`End ${dayTitle(ses.played_on)}?`, 'The score entry closes and players see the scores as final. You can reopen it.', 'End the day', 'ball')) setEnded(true);
  } }, 'End the day');
  wrap.append(
    h('div', { class: 'card build-bar' }, h('label', { class: 'field' }, h('span', {}, 'Game day'), daySel), publish, h('span', { class: 'grow' }), endDay, games.length ? dayRecap.btn : null, delDay),
    h('div', { class: 'card' }, entry),
    h('div', { class: 'card' }, teamsBox),
    list);
  return [wrap];
}

// ---------- match stats: tagging a game ----------
// Watch the game's video and tap player → action → grade for each touch. Grades that end a rally (ace, kill, error…)
// award the point on their own; "Point" buttons cover the rest. The video stays on this device (a file) or on
// YouTube; tags keep the video time so tapping one jumps back to it. Works without a video too (tagging live).
// Saved a moment after each change: only rallies that changed since the last save, plus deleted ones, through
// save_game_tags (one transaction). Rally ids are made here, so a resent save can't double up, and two people
// tagging the same game don't wipe each other's rallies. A copy stays on this device until the save goes through.
let taggingGame = null;
const clock = t => t == null ? '' : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const ytId = s => (String(s).match(/(?:youtu\.be\/|[?&]v=|embed\/|shorts\/|live\/)([\w-]{11})/) ?? String(s).trim().match(/^([\w-]{11})$/))?.[1] ?? null;
let ytReady = null;
const loadYouTube = () => ytReady ??= new Promise((res, rej) => {
  window.onYouTubeIframeAPIReady = () => res(window.YT);
  const s = h('script', { src: 'https://www.youtube.com/iframe_api' });
  s.onerror = () => { ytReady = null; rej(new Error('Could not load YouTube')); };
  document.head.append(s);
});
// One interface for a local file or a YouTube embed. Both are put in `box` before use.
function fileVideo(box, file) {
  const v = h('video', { controls: true, playsinline: true, preload: 'auto' });
  v.src = URL.createObjectURL(file);
  box.replaceChildren(v);
  return { now: () => v.currentTime, seek: t => { v.currentTime = Math.max(0, t); }, toggle: () => v.paused ? v.play() : v.pause(), dispose: () => URL.revokeObjectURL(v.src) };
}
async function youtubeVideo(box, id) {
  const YT = await loadYouTube();
  const host = h('div');
  box.replaceChildren(h('div', { class: 'yt' }, host));
  const p = await new Promise((res, rej) => {
    const pl = new YT.Player(host, { videoId: id, playerVars: { playsinline: 1, rel: 0 }, events: { onReady: () => res(pl), onError: () => rej(new Error('YouTube could not play that video')) } });
  });
  return { now: () => p.getCurrentTime(), seek: t => p.seekTo(Math.max(0, t), true), toggle: () => p.getPlayerState() === 1 ? p.pauseVideo() : p.playVideo(), dispose: () => p.destroy() };
}

async function tagView(g, n, pname, tname, back) {
  const stored = fromRows(await q(sb.from('rallies').select('id,seq,video_t,serving,won_by,touches(seq,player_id,action,grade,video_t)').eq('game_id', g.id)));
  // What the database has: each rally as last saved (to send only what changed), and the video.
  const saved = new Map(stored.map(r => [r.id, JSON.stringify(r)]));
  const videoOf = () => video ? { video_kind: video.kind, video_ref: video.kind === 'file' ? video.name : video.id } : { video_kind: null, video_ref: null };
  let video = g.video_kind === 'file' ? { kind: 'file', name: g.video_ref } : g.video_kind === 'youtube' ? { kind: 'youtube', id: g.video_ref } : null;
  let savedVideo = JSON.stringify(videoOf());
  const draftKey = `setme-tags-${g.id}`;
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(draftKey)); } catch { /* no draft */ }
  // Changes on this device that never reached the database: apply them on top of what's saved. Rallies someone
  // else added since stay; only rallies this device knew about and deleted are deleted.
  let rallies = stored;
  if (draft?.rallies) {
    const mine = new Map(draft.rallies.map(r => [r.id, r]));
    const gone = new Set((draft.known ?? []).filter(id => !mine.has(id)));
    rallies = [...draft.rallies, ...stored.filter(r => !mine.has(r.id) && !gone.has(r.id))].sort((a, b) => a.seq - b.seq);
    video = draft.video ?? video;
    setTimeout(() => toast('Restored tags that hadn\'t saved yet'), 300);
  }

  const name = { a: tname(g.session_id, g.team_a, roundOf(g)), b: tname(g.session_id, g.team_b, roundOf(g)) };
  const color = { a: TEAM_COLORS[(g.team_a - 1) % TEAM_COLORS.length], b: TEAM_COLORS[(g.team_b - 1) % TEAM_COLORS.length] };
  const lineup = { a: g.players_a, b: g.players_b };
  const pn = id => firstName(pname.get(id) ?? '?');
  const side = p => sideOf(g, p);
  let player = null, sel = null, firstServe = 'a', history = [], saveTimer = null, saving = null, dirty = !!draft?.rallies;
  const now = () => player ? Math.round(player.now() * 10) / 10 : null;
  const open = () => { const r = rallies.at(-1); return r && !r.won ? r : null; };
  const serving = () => open()?.serve ?? (rallies.length ? rallies.at(-1).won : firstServe);

  // ----- saving -----
  const status = h('span', { class: 'muted small tag-status' }, stored.length ? 'Saved' : '');
  const save = async () => {
    clearTimeout(saveTimer); saveTimer = null;
    await saving;
    if (!dirty) return;
    dirty = false; status.textContent = 'Saving…';
    const ids = new Set(rallies.map(r => r.id));
    const changedRallies = rallies.filter(r => saved.get(r.id) !== JSON.stringify(r));
    const deleted = [...saved.keys()].filter(id => !ids.has(id));
    const sent = new Map(changedRallies.map(r => [r.id, JSON.stringify(r)])), vid = JSON.stringify(videoOf());
    saving = (async () => {
      if (changedRallies.length || deleted.length) await q(sb.rpc('save_game_tags', { p_game: g.id, p_rallies: changedRallies, p_deleted: deleted }));
      if (vid !== savedVideo) { await q(sb.from('games').update(videoOf()).eq('id', g.id)); savedVideo = vid; }
    })().then(() => {
      for (const id of deleted) saved.delete(id);
      for (const [id, j] of sent) saved.set(id, j);
      if (!dirty) { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } }
      status.textContent = dirty ? 'Unsaved' : 'Saved';
    }, e => {
      dirty = true; status.textContent = `Not saved (${e.message}). Kept on this device, retrying…`;
      saveTimer = setTimeout(save, 10e3);
    }).finally(() => { saving = null; });
    await saving;
  };
  const changed = () => {
    dirty = true; status.textContent = 'Unsaved';
    try { localStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), rallies, video, known: [...saved.keys()] })); } catch { /* storage full or blocked */ }
    clearTimeout(saveTimer); saveTimer = setTimeout(save, 1500);
    paint();
  };
  const snapshot = () => { history.push(JSON.stringify(rallies)); if (history.length > 100) history.shift(); };
  const undo = () => { if (!history.length) return toast('Nothing to undo'); rallies = JSON.parse(history.pop()); sel = null; changed(); };

  // ----- tagging -----
  const newRally = () => ({ id: crypto.randomUUID(), seq: Math.max(0, ...rallies.map(r => r.seq)) + 1, t: now(), serve: serving(), won: null, touches: [] });
  const addTouch = (p, a, grade) => {
    snapshot();
    let r = open();
    if (!r) { r = newRally(); rallies.push(r); }
    r.touches.push({ p, a, g: grade, t: now() });
    const end = endsRally(a, grade);
    if (end) r.won = end === 'won' ? side(p) : other(side(p));
    sel = null; changed();
    if (end) toast(`Point ${name[r.won]}`);
  };
  const point = s => {
    snapshot();
    const r = open() ?? (rallies.push(newRally()), rallies.at(-1));
    r.won = s; sel = null; changed();
  };
  // Picking a player suggests the likely action (serve first, then pass, set, attack…).
  const pick = p => { sel = sel?.p === p ? null : { p, a: suggestAction(open() ?? { serve: serving(), touches: [] }, side(p), g) }; paintPad(); };
  // At the start of a rally the expected server is ready to grade.
  const autoSel = () => {
    if (sel || open()?.touches.length) return;
    const p = nextServer(rallies, serving(), lineup[serving()]);
    if (p != null) sel = { p, a: 'serve', auto: true };
  };

  // ----- layout -----
  const scoreEl = h('div', { class: 'tag-score' });
  const summary = h('div', { class: 'tag-summary muted small' });
  const videoBox = h('div', { class: 'tag-video' });
  const sourceRow = h('div', { class: 'row tag-source' });
  const pad = h('div', { class: 'tag-pad' });
  const list = h('ol', { class: 'rally-list' });

  const paintScore = () => {
    const s = score(rallies);
    scoreEl.replaceChildren(
      h('span', { style: `--tc:${color.a}` }, name.a, h('b', {}, String(s.a))), h('span', { class: 'muted' }, '–'),
      h('span', { style: `--tc:${color.b}` }, h('b', {}, String(s.b)), name.b));
    const ts = teamSummary(rallies, g), done = rallies.filter(r => r.won).length;
    const line = k => `${name[k]}: side-out ${ts[k].sideOutRate == null ? '—' : `${Math.round(ts[k].sideOutRate * 100)}%`}, ${ts[k].aces} aces, ${ts[k].kills} kills, ${ts[k].stuffs} blocks, ${ts[k].errors} errors`;
    // Only once the tags cover as many points as the saved score.
    const off = done >= g.score_a + g.score_b && (s.a !== g.score_a || s.b !== g.score_b);
    summary.replaceChildren(...(done ? [h('div', {}, line('a')), h('div', {}, line('b'))] : []),
      ...(off ? [h('div', { class: 'warn' }, `Tags give ${s.a}–${s.b}; the saved score is ${g.score_a}–${g.score_b}.`)] : []));
  };

  const paintSource = () => {
    const file = h('input', { type: 'file', accept: 'video/*', hidden: true });
    file.onchange = () => {
      const f = file.files[0]; if (!f) return;
      player?.dispose(); player = fileVideo(videoBox, f);
      if (video?.kind !== 'file' || video.name !== f.name) { video = { kind: 'file', name: f.name }; changed(); }
      paintSource();
    };
    const yt = h('input', { type: 'url', placeholder: 'YouTube link', 'aria-label': 'YouTube link', value: video?.kind === 'youtube' ? `https://youtu.be/${video.id}` : '' });
    const loadYt = async () => {
      const id = ytId(yt.value); if (!id) return toast('That doesn\'t look like a YouTube link');
      try { player?.dispose(); player = null; player = await youtubeVideo(videoBox, id); } catch (e) { return toast(e.message); }
      if (video?.kind !== 'youtube' || video.id !== id) { video = { kind: 'youtube', id }; changed(); }
    };
    yt.onkeydown = e => { if (e.key === 'Enter') loadYt(); };
    sourceRow.replaceChildren(
      h('button', { class: 'ghost sm', onclick: () => file.click() }, video?.kind === 'file' ? `Open ${video.name}` : 'Open video file'), file,
      h('span', { class: 'muted small' }, 'or'), yt, h('button', { class: 'ghost sm', onclick: loadYt }, 'Load'));
    if (!player && !videoBox.children.length) videoBox.replaceChildren(h('p', { class: 'muted small' },
      video?.kind === 'file' ? `Open ${video.name} again to see the video. It never leaves this device.` : 'Open the game\'s video, or tag live without one. Files stay on this device.'));
    return loadYt;
  };

  const paintPad = () => {
    autoSel();
    const r = open(), sv = serving();
    const col = s => h('div', { class: 'tag-team', style: `--tc:${color[s]}` },
      h('div', { class: 'tag-team-head' }, h('b', {}, name[s]), sv === s && h('span', { class: 'badge set' }, 'Serving')),
      h('div', { class: 'tag-players' }, lineup[s].map(p => h('button', { type: 'button', class: 'tag-player', 'aria-pressed': String(sel?.p === p), onclick: () => pick(p) },
        avatar(pname.get(p) ?? '?', 26), h('span', {}, pn(p))))),
      h('button', { type: 'button', class: 'ghost sm tag-point', onclick: () => point(s) }, `Point ${name[s]}`));
    const choose = sel && h('div', { class: 'tag-choose' },
      h('div', { class: 'muted small' }, h('b', {}, pname.get(sel.p)), sel.auto ? ' is up to serve' : '', ' · pick what they did'),
      seg(Object.entries(ACTIONS).map(([a, d]) => [a, d.label]), sel.a, a => { sel = { ...sel, a, auto: false }; paintPad(); }, 'Action'),
      h('div', { class: 'tag-grades' }, ACTIONS[sel.a].grades.map(([gr, label, end]) => h('button', { type: 'button', class: `tag-grade${end ? ` ${end}` : ''}`, onclick: () => addTouch(sel.p, sel.a, gr) },
        h('small', {}, String(gr)), label))));
    pad.replaceChildren(
      h('div', { class: 'row tag-rally-head' },
        h('b', {}, `Rally ${rallies.filter(x => x.won).length + 1}`),
        h('span', { class: 'muted small' }, r ? r.touches.map(t => `${pn(t.p)} ${ACTIONS[t.a].label.toLowerCase()}`).join(' → ') : `${name[sv]} to serve`),
        h('span', { class: 'grow' }),
        !rallies.length && h('span', { class: 'row' }, h('span', { class: 'muted small' }, 'First serve'), seg([['a', name.a], ['b', name.b]], firstServe, v => { firstServe = v; sel = null; paintPad(); }, 'First serve')),
        h('button', { class: 'ghost sm', onclick: undo, disabled: !history.length }, 'Undo')),
      h('div', { class: 'tag-teams' }, col('a'), col('b')),
      ...(choose ? [choose] : []));
  };

  const paintList = () => {
    const shown = [...rallies.entries()].reverse();
    list.replaceChildren(...shown.map(([i, r]) => h('li', {},
      h('div', { class: 'rally-head' },
        h('span', { class: 'muted small' }, `#${i + 1}`),
        r.t != null && h('button', { class: 'ghost sm', onclick: () => player?.seek(r.t - 2), disabled: !player, title: 'Watch this rally' }, `▶ ${clock(r.t)}`),
        h('span', { class: 'muted small' }, `${name[r.serve]} served`),
        h('span', { class: 'grow' }),
        h('button', { class: `chip plain point ${r.won ?? 'open'}`, style: r.won ? `--tc:${color[r.won]}` : null, title: 'Change who won the point',
          onclick: () => { snapshot(); r.won = r.won === 'a' ? 'b' : r.won === 'b' ? (i === rallies.length - 1 ? null : 'a') : 'a'; changed(); } },
          r.won ? `Point ${name[r.won]}` : 'In play'),
        h('button', { class: 'ghost sm', 'aria-label': `Delete rally ${i + 1}`, onclick: () => { snapshot(); rallies.splice(i, 1); changed(); } }, '×')),
      h('div', { class: 'chips' }, r.touches.map((t, j) => h('span', { class: `chip tag-touch ${endsRally(t.a, t.g) ?? ''}`, style: `--tc:${color[side(t.p)] ?? 'var(--muted)'}` },
        h('button', { type: 'button', class: 'touch-btn', onclick: () => t.t != null && player?.seek(t.t - 1) }, `${pn(t.p)} · ${ACTIONS[t.a].label} ${gradeLabel(t.a, t.g)}`),
        h('button', { type: 'button', 'aria-label': 'Delete this touch', onclick: () => { snapshot(); r.touches.splice(j, 1); changed(); } }, '×')))))));
    if (!rallies.length) list.replaceChildren(h('li', { class: 'muted' }, 'No rallies tagged yet.'));
  };
  const gameRecap = recapButton('Share recap', `Game ${n} recap`, `${name.a} v ${name.b}`, `recap-game-${g.id}.png`, pname, k => tname(g.session_id, k, roundOf(g)),
    () => [{ round: roundOf(g), teams: [{ k: g.team_a, ids: g.players_a }, { k: g.team_b, ids: g.players_b }] }]);
  const paint = () => { paintScore(); paintPad(); paintList(); gameRecap.refresh([{ game: g, rallies }]); };

  const loadYt = paintSource();
  paint();
  if (video?.kind === 'youtube') loadYt();

  // Keys: space play/pause, ←/→ 2 s (shift 5 s), 0–3 grade, s/p/t/a/b/d action, Esc clear, u undo.
  const keys = e => {
    if (!wrap.isConnected) return document.removeEventListener('keydown', keys);
    if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); player?.toggle(); }
    else if (k === 'arrowleft' || k === 'arrowright') { e.preventDefault(); player?.seek(player.now() + (k === 'arrowright' ? 1 : -1) * (e.shiftKey ? 5 : 2)); }
    else if (k === 'escape') { sel = null; paintPad(); }
    else if (k === 'u') undo();
    else if (sel && /^[0-3]$/.test(k) && ACTIONS[sel.a].grades.some(x => x[0] === Number(k))) addTouch(sel.p, sel.a, Number(k));
    else if (sel) { const a = Object.keys(ACTIONS).find(x => ACTIONS[x].key === k); if (a) { sel = { ...sel, a, auto: false }; paintPad(); } }
  };
  document.addEventListener('keydown', keys);
  const leave = async () => { await save(); player?.dispose(); document.removeEventListener('keydown', keys); back(); };

  const wrap = h('div', { class: 'tagger' },
    h('div', { class: 'card tag-top' },
      h('button', { class: 'ghost sm', onclick: leave }, '← Games'),
      h('div', { class: 'grow' }, h('h3', {}, `Game ${n} · ${name.a} v ${name.b}`), status),
      scoreEl, gameRecap.btn),
    h('div', { class: 'card' }, videoBox, sourceRow,
      h('p', { class: 'muted small' }, 'Keys: space play/pause · ← → skip 2 s · 0–3 grade · S P T A B D action · U undo · Esc clear')),
    h('div', { class: 'card' }, pad),
    h('div', { class: 'card' }, h('h3', {}, 'Rallies'), summary, list));
  return wrap;
}

const pct = v => v == null ? '—' : `${Math.round(v * 100)}%`;
const pts = v => v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1);
const plusPts = v => v == null ? '—' : `${v > 0 ? '+' : ''}${pts(v)}`;

async function insightsView(sessions, pname, tname) {
  const games = await q(sb.from('games').select('*').order('created_at'));
  const day = new Map(sessions.map(s => [s.id, s.played_on]));
  const a = analyze(games);
  if (!a.n) return [h('div', { class: 'card empty' }, 'No games with scores yet. Enter a few on the Games tab and come back.')];
  const tile = (value, label, sub) => h('div', { class: 'card tile' }, h('span', { class: 'stat' }, value), h('b', {}, label), sub && h('span', { class: 'muted small' }, sub));
  const early = a.n < 15 && h('p', { class: 'warn small' }, `Only ${a.n} game${a.n === 1 ? '' : 's'} so far. Treat these numbers as a first look; they settle after a few game days.`);

  const tiles = h('div', { class: 'tiles' },
    tile(String(a.n), 'Games', `${a.sessions} game day${a.sessions === 1 ? '' : 's'}`),
    tile(pct(a.close), 'Close games', `won by ${CLOSE} or less`),
    tile(pct(a.blowouts), 'Blowouts', `won by ${BLOWOUT} or more`),
    tile(pts(a.avgMargin), 'Average margin', 'points, per game to 25'),
    tile(pct(a.favWon), 'Stronger team won', a.called ? `of ${a.called} games with a gap` : 'no games with a gap'));

  // Predicted gap vs actual margin, one dot per game.
  const chartBox = h('div');
  const chartCard = h('div', { class: 'card' },
    h('h3', {}, 'Predicted gap vs actual margin'),
    h('p', { class: 'muted small', style: 'margin:2px 0 0' }, 'Each dot is a game, from the first team\'s side: right = they were rated stronger, up = they won by more. ',
      'Dots near the middle line up with balanced teams. If the dots follow the dashed line, bigger rating gaps really do mean bigger wins',
      a.k > 0 ? ` (about ${pts(a.k)} points per 1.0 of gap).` : '.', ' Hollow dots stopped early (time up).'),
    chartBox);
  scatterChart(chartBox, a.rows.map(r => ({ x: r.gap, y: r.m, early: !finished(r.g),
    label: [`${dayTitle(day.get(r.g.session_id) ?? '')}`, `${tname(r.g.session_id, r.g.team_a, roundOf(r.g))} v ${tname(r.g.session_id, r.g.team_b, roundOf(r.g))}: ${r.g.score_a}–${r.g.score_b}`, `Rated gap ${plusPts(r.gap)}`] })), a.k);

  // Per game day.
  const bySes = sessions.map(s => ({ s, rows: a.rows.filter(r => r.g.session_id === s.id) })).filter(x => x.rows.length);
  const days = h('div', { class: 'card' }, h('h3', {}, 'By game day'), stacked(h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Day'), h('th', { class: 'num' }, 'Games'), h('th', { class: 'num' }, 'Average margin'), h('th', { class: 'num' }, 'Close'), h('th', { class: 'num' }, 'Rated gap'))),
    h('tbody', {}, bySes.map(({ s, rows }) => {
      const m = rows.map(r => Math.abs(r.m));
      return h('tr', {}, h('td', {}, dayTitle(s.played_on), s.source && h('span', { class: 'muted small' }, ` · ${{ built: 'built', edited: 'built, then swapped', own: 'own teams' }[s.source] ?? s.source}`)),
        h('td', { class: 'num' }, String(rows.length)),
        h('td', { class: 'num' }, pts(m.reduce((x, y) => x + y, 0) / m.length)),
        h('td', { class: 'num' }, pct(m.filter(v => v <= CLOSE).length / m.length)),
        h('td', { class: 'num' }, pts(rows.reduce((x, r) => x + Math.abs(r.gap), 0) / rows.length)));
    })))));

  // Which differences between teams go with winning.
  const word = r => r == null ? 'not enough games' : Math.abs(r) < .15 ? 'little or no link' : `${Math.abs(r) < .35 ? 'some' : 'strong'} link`;
  const factors = h('div', { class: 'card' }, h('h3', {}, 'What goes with winning'),
    h('p', { class: 'muted small', style: 'margin:2px 0 0' }, 'How each difference between the two teams lines up with the margin, from −1 to 1. ',
      'Positive: the team with more of it tended to win by more. Spread: how far apart teams typically were on it. A factor that hardly differs between teams (because the builder evens it out) can\'t show much.'),
    stacked(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Difference in'), h('th', { class: 'num' }, 'Link'), h('th', {}, ''), h('th', { class: 'num' }, 'Spread'))),
      h('tbody', {}, [...a.factors].sort((x, y) => Math.abs(y.r ?? 0) - Math.abs(x.r ?? 0)).map(f => h('tr', {},
        h('td', {}, f.label), h('td', { class: 'num' }, f.r == null ? '—' : fmt(f.r)), h('td', { class: 'muted' }, word(f.r)), h('td', { class: 'num' }, fmt(f.spread))))))));

  // Suggested weights, once there are enough games.
  const weights = h('div', { class: 'card' }, h('h3', {}, 'Strength weights'),
    a.weights
      ? [h('p', { class: 'muted small', style: 'margin:2px 0 0' }, `Weights that best explain the margins of these ${a.n} games, starting from the current ones as if they'd been seen in ${PRIOR_GAMES} games, so they move slowly. Same total as now. A big move that holds up over more game days is worth trying in teams.mjs.`),
        stacked(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Skill'), h('th', { class: 'num' }, 'Now'), h('th', { class: 'num' }, 'From results'), h('th', { class: 'num' }, 'Change'))),
          h('tbody', {}, SKILLS.map(s => h('tr', {}, h('td', {}, LABEL[s]), h('td', { class: 'num' }, fmt(WEIGHTS[s])), h('td', { class: 'num' }, h('b', {}, fmt(a.weights[s]))),
            h('td', { class: 'num muted' }, `${a.weights[s] >= WEIGHTS[s] ? '+' : ''}${fmt(a.weights[s] - WEIGHTS[s])}`))))))]
      : h('p', { class: 'muted small' }, `Suggested weights show up after ${MIN_FIT} games (${a.n} so far). Until then there's too little to tell the skills apart.`));

  const parts = [early, tiles, chartCard, factors, weights, days].filter(Boolean);

  // Super: players whose teams did better or worse than their ratings said. Based on results only, but it points at
  // players who may be rated too low or too high, so organizers don't get it.
  if (me.role === 'super') {
    const ps = playerStats(games, a.k).filter(p => pname.has(p.id)).sort((x, y) => y.over - x.over);
    const adj = resultAdjustments(games);
    parts.push(h('div', { class: 'card' }, h('h3', {}, 'Players vs their ratings'),
      h('p', { class: 'muted small', style: 'margin:2px 0 0' }, 'Only you see this. ', h('b', {}, 'Vs ratings'), ' is how many points per game their teams did better (+) or worse (−) than the rating gap predicted. ',
        'High and steady: maybe rated too low. Low: maybe too high. Under 10 games it\'s mostly luck. ',
        h('b', {}, 'Adjust'), ` is what Adjust for results on Teams adds to their strength (same scale as a team total; pulled toward 0 for few games${adj.size ? '' : `; starts after ${ADJUST_MIN_GAMES} games`}).`),
      stacked(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Player'), h('th', { class: 'num' }, 'Games'), h('th', { class: 'num' }, 'Won'), h('th', { class: 'num' }, 'Margin'), h('th', { class: 'num' }, 'Vs ratings'), h('th', { class: 'num' }, 'Adjust'))),
        h('tbody', {}, ps.map(p => h('tr', { class: p.games < 10 ? 'dim' : null },
          h('td', {}, profileLink(p.id, pname.get(p.id))), h('td', { class: 'num' }, String(p.games)), h('td', { class: 'num' }, pct(p.wins / p.games)),
          h('td', { class: 'num' }, plusPts(p.margin)), h('td', { class: 'num' }, h('b', {}, plusPts(p.over))),
          h('td', { class: 'num' }, adj.has(p.id) ? signed(adj.get(p.id)) : '—'))))))));
  }
  return parts;
}

// ---------- attendance (organizers) ----------
// Who comes, how often, and regulars who've stopped coming, from saved game days.
async function attendanceView(sessions, players, pname) {
  if (!sessions.length) return [h('div', { class: 'card empty' }, 'No game days saved yet. Attendance comes from the teams saved for scores.')];
  const games = await q(sb.from('games').select('session_id,players_a,players_b'));
  const att = attendance(sessions, games, today());
  const active = new Set(players.filter(p => p.active).map(p => p.id));
  const rows = [...att.values()].filter(a => pname.has(a.id));
  const gone = rows.filter(a => a.missing && active.has(a.id)).sort((a, b) => b.total - a.total);
  let sortKey = 'total';
  const body = h('tbody');
  const draw = () => {
    const by = { total: (a, b) => b.total - a.total, rate: (a, b) => b.rate - a.rate || b.total - a.total, last: (a, b) => b.last.localeCompare(a.last), streak: (a, b) => b.streak - a.streak || b.best - a.best, name: (a, b) => pname.get(a.id).localeCompare(pname.get(b.id)) };
    body.replaceChildren(...[...rows].sort((a, b) => by[sortKey](a, b) || pname.get(a.id).localeCompare(pname.get(b.id))).map(a => h('tr', {},
      h('td', {}, profileLink(a.id, pname.get(a.id)), a.missing && active.has(a.id) && ' ', a.missing && active.has(a.id) && h('span', { class: 'badge' }, 'Stopped coming')),
      h('td', { class: 'num' }, h('b', {}, String(a.total))),
      h('td', { class: 'num', title: `${a.total} of the ${a.of} game days since their first` }, pct(a.rate)),
      h('td', { class: 'num' }, `${a.streak}${a.best > a.streak ? ` (best ${a.best})` : ''}`),
      h('td', {}, dayTitle(a.last)),
      h('td', {}, h('span', { class: 'dots', 'aria-label': 'Last 10 game days' }, a.history.slice(-10).map(d => h('i', { class: d.came ? 'on' : null, title: `${dayTitle(d.played_on)}: ${d.came ? 'came' : 'missed'}` })))))));
  };
  draw();
  return [
    h('div', { class: 'tiles' },
      h('div', { class: 'card tile' }, h('span', { class: 'stat' }, String(sessions.length)), h('b', {}, 'Game days')),
      h('div', { class: 'card tile' }, h('span', { class: 'stat' }, String(rows.length)), h('b', {}, 'Players'), h('span', { class: 'muted small' }, 'came at least once')),
      h('div', { class: 'card tile' }, h('span', { class: 'stat' }, String(rows.filter(a => a.rate >= .5 && a.of >= 3 && !a.missing).length)), h('b', {}, 'Regulars'), h('span', { class: 'muted small' }, 'half the game days or more'))),
    gone.length > 0 && h('div', { class: 'card' }, h('h3', {}, 'Stopped coming'),
      h('p', { class: 'muted small' }, `Came to at least half the game days before, but none of the last ${REGULAR_GAP}. Maybe worth a message.`),
      h('div', { class: 'chips' }, gone.map(a => h('span', { class: 'chip plain' }, profileLink(a.id, pname.get(a.id)), h('span', { class: 'muted small' }, ` · last ${dayTitle(a.last)}`))))),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, 'Attendance'),
        h('label', { class: 'sort' }, h('span', {}, 'Sort by'), h('select', { 'aria-label': 'Sort by', onchange: e => { sortKey = e.target.value; draw(); } },
          [['total', 'Game days'], ['rate', 'How often'], ['streak', 'In a row'], ['last', 'Last came'], ['name', 'Name']].map(([v, t]) => h('option', { value: v }, t))))),
      h('p', { class: 'muted small' }, 'From the teams saved for scores (and anyone who played a game that day). ', h('b', {}, 'How often'), ' counts game days since their first. ', h('b', {}, 'In a row'), ' is their current run.'),
      h('div', { class: 'scroll' }, stacked(h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Player'), h('th', { class: 'num' }, 'Game days'), h('th', { class: 'num' }, 'How often'), h('th', { class: 'num' }, 'In a row'), h('th', {}, 'Last came'), h('th', {}, 'Last 10'))),
        body)))),
  ].filter(Boolean);
}

// ---------- season recap (organizers) ----------
// Awards for a month, a few months or the year, from results (and tagged games), shared as an image.
let seasonPick = 'month';
async function seasonView(sessions, pname, tname) {
  if (!sessions.length) return [h('div', { class: 'card empty' }, 'No game days saved yet.')];
  const ym = d => d.slice(0, 7);
  const now = today();
  const monthName = m => new Date(`${m}-15`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const months = [...new Set(sessions.map(s => ym(s.played_on)))].sort().reverse();
  const back = n => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toLocaleDateString('en-CA'); };
  const periods = [
    ...months.map(m => [`m:${m}`, monthName(m), s => ym(s.played_on) === m]),
    ['3m', 'Last 3 months', s => s.played_on >= back(3)],
    ['year', `${now.slice(0, 4)} so far`, s => s.played_on.startsWith(now.slice(0, 4))],
    ['all', 'Everything', () => true],
  ];
  if (seasonPick === 'month' || !periods.some(p => p[0] === seasonPick)) seasonPick = periods[0][0];
  const allGames = await q(sb.from('games').select('*').order('created_at'));
  const out = h('div');
  const draw = async () => {
    const [, label, keep] = periods.find(p => p[0] === seasonPick);
    const ses = sessions.filter(keep);
    const ids = new Set(ses.map(s => s.id));
    const games = allGames.filter(g => ids.has(g.session_id));
    // Tagged games in the period, for kills, aces, blocks and digs (none before the match stats upgrade).
    const rallies = games.length ? await q(sb.from('rallies').select('game_id,id,seq,video_t,serving,won_by,touches(seq,player_id,action,grade,video_t)').in('game_id', games.map(g => g.id))).catch(() => []) : [];
    const docs = games.map(g => ({ game: g, rallies: fromRows(rallies.filter(r => r.game_id === g.id)) })).filter(d => d.rallies.some(r => r.won));
    const rec = seasonRecap(ses, games, docs.length ? tally(docs) : null);
    if (rec.closest) rec.closest.names = [tname(rec.closest.session_id, rec.closest.team_a, rec.closest.round), tname(rec.closest.session_id, rec.closest.team_b, rec.closest.round)];
    const names = who => who.map(id => pname.get(id) ?? 'Someone');
    let blob = null;
    const ready = seasonImage(rec, { title: label, name: id => pname.get(id) ?? 'Someone' }).then(b => (blob = b));
    const file = `season-${seasonPick.replace(/[^\w-]/g, '')}.png`;
    out.replaceChildren(
      h('div', { class: 'tiles' },
        h('div', { class: 'card tile' }, h('span', { class: 'stat' }, String(rec.days)), h('b', {}, 'Game days')),
        h('div', { class: 'card tile' }, h('span', { class: 'stat' }, String(rec.games)), h('b', {}, 'Games')),
        h('div', { class: 'card tile' }, h('span', { class: 'stat' }, String(rec.players)), h('b', {}, 'Players'))),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, label), h('p', { class: 'muted small', style: 'margin:2px 0 0' },
          `From results${docs.length ? ` and ${docs.length} tagged game${docs.length === 1 ? '' : 's'}` : ''}; nothing here comes from ratings, so it's fine to share. Best record needs ${MIN_GAMES_FOR_RECORD}+ games.`)),
          h('button', { class: 'sm', disabled: !rec.games, onclick: async () => sharePng(blob ?? await ready, file) }, 'Share image')),
        rec.awards.length || rec.closest ? h('ul', { class: 'awards' },
          rec.awards.map(a => h('li', {}, h('b', {}, a.title), h('span', {}, names(a.who).join(', ')), h('span', { class: 'muted small' }, a.detail))),
          rec.closest && h('li', {}, h('b', {}, 'Closest game'), h('span', {}, `${rec.closest.names.join(' v ')}, ${rec.closest.score_a}–${rec.closest.score_b}`), h('span', { class: 'muted small' }, dayTitle(rec.closest.played_on))))
          : h('p', { class: 'muted' }, 'No games with scores in this stretch yet.')));
  };
  const sel = h('select', { 'aria-label': 'Period', onchange: e => { seasonPick = e.target.value; draw().catch(err => out.replaceChildren(h('p', { class: 'warn' }, err.message))); } },
    periods.map(([v, t]) => h('option', { value: v, selected: v === seasonPick }, t)));
  await draw();
  return [h('div', { class: 'card build-bar' }, h('label', { class: 'field' }, h('span', {}, 'Recap for'), sel)), out];
}

// Dots: x = rated gap, y = margin (both from the first team's side). Dashed line: margin = k × gap.
function scatterChart(box, dots, k) {
  const plot = h('div', { class: 'chart-plot' });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  plot.append(tip);
  box.replaceChildren(h('div', { class: 'chart-legend' }, h('span', {}, h('i', { class: 'dot-key' }), 'Game to 25'), h('span', {}, h('i', { class: 'dot-key hollow' }), 'Stopped early'), k > 0 && h('span', {}, h('i', { class: 'dash-key' }), 'Trend')), plot);
  const H = 260, M = { l: 34, r: 12, t: 10, b: 30 };
  const xMax = Math.max(.5, ...dots.map(d => Math.abs(d.x))) * 1.1;
  const yMax = Math.max(TARGET * .6, ...dots.map(d => Math.abs(d.y))) * 1.05;
  let W = 0;
  const render = () => {
    W = plot.clientWidth; if (!W) return;
    const xOf = x => M.l + (x + xMax) / (2 * xMax) * (W - M.l - M.r);
    const yOf = y => M.t + (1 - (y + yMax) / (2 * yMax)) * (H - M.t - M.b);
    const yTicks = [-20, -10, 0, 10, 20].filter(v => Math.abs(v) <= yMax);
    const step = xMax > 2 ? 1 : .5;
    const xTicks = []; for (let v = -Math.floor(xMax / step) * step; v <= xMax; v += step) xTicks.push(Math.round(v * 100) / 100);
    const grid = [
      ...yTicks.map(v => svg('g', {}, svg('line', { x1: M.l, x2: W - M.r, y1: yOf(v), y2: yOf(v), class: v ? 'grid' : 'cross' }),
        svg('text', { x: M.l - 6, y: yOf(v), class: 'axis', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, v > 0 ? `+${v}` : String(v)))),
      svg('line', { x1: xOf(0), x2: xOf(0), y1: M.t, y2: H - M.b, class: 'cross' }),
      ...xTicks.map(v => svg('text', { x: xOf(v), y: H - 12, class: 'axis', 'text-anchor': 'middle' }, v > 0 ? `+${fmt(v)}` : fmt(v))),
      svg('text', { x: W - M.r, y: H - 1, class: 'axis', 'text-anchor': 'end' }, 'Rated gap →'),
    ];
    const lo = Math.max(-xMax, -yMax / (k || 1)), hi = -lo;
    const trend = k > 0 && svg('line', { x1: xOf(lo), x2: xOf(hi), y1: yOf(k * lo), y2: yOf(k * hi), class: 'trend' });
    const marks = dots.map(d => {
      const g = svg('g', { class: 'pt', tabindex: 0, role: 'img', 'aria-label': d.label.join(', ') },
        svg('circle', { cx: xOf(d.x), cy: yOf(d.y), r: 12, fill: 'transparent' }),
        svg('circle', { cx: xOf(d.x), cy: yOf(d.y), r: 5, class: d.early ? 'dot hollow' : 'dot', fill: d.early ? 'var(--surface)' : 'var(--s1)', stroke: 'var(--s1)' }));
      const show = () => {
        tip.replaceChildren(h('div', { class: 'chart-tip-head' }, d.label[0]), ...d.label.slice(1).map(t => h('div', { class: 'chart-tip-row' }, t)));
        tip.hidden = false;
        const x = xOf(d.x), tw = tip.offsetWidth;
        tip.style.left = `${Math.max(0, Math.min(W - tw, x > W / 2 ? x - tw - 14 : x + 14))}px`;
        tip.style.top = `${Math.max(0, Math.min(H - tip.offsetHeight, yOf(d.y) - 20))}px`;
      };
      const hide = () => { tip.hidden = true; };
      g.onpointerenter = show; g.onfocus = show; g.onpointerleave = hide; g.onblur = hide;
      return g;
    });
    const el = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': `Rated gap against margin, ${dots.length} games` }, grid, trend, marks);
    plot.querySelector('svg')?.remove();
    plot.prepend(el);
  };
  const ro = new ResizeObserver(() => { if (!plot.isConnected) { if (W) ro.disconnect(); return; } if (plot.clientWidth !== W) render(); });
  ro.observe(plot);
  requestAnimationFrame(render);
}

// ---------- all ratings (super) ----------
// Super: everyone's ratings, combined or one rater at a time, plus rater leans and disagreements.
// Raters and organizers: their own ratings only (the database only returns their rows anyway).
async function ratingsPage() {
  const all = me.role === 'super';
  const [players, ratings, profiles] = await Promise.all([
    q(sb.from('players').select('*').eq('active', true).order('name')), // * so it works before the anchor column exists
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
  // Arrived from a profile's "Rating history" link.
  if (pendingHistory != null && players.some(p => p.id === pendingHistory)) { const id = pendingHistory; setTimeout(() => hist.show(id), 0); }
  pendingHistory = null;
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
      return h('tr', {}, h('td', {}, h('button', { type: 'button', class: 'name-link', title: 'Show rating history', onclick: () => hist.show(p.id) }, p.name),
        all && ' ', all && h('a', { href: `#player/${p.id}`, class: 'profile-link', title: `${p.name}'s profile`, 'aria-label': `${p.name}'s profile` }, '↗'),
        p.playing && ' ', p.playing && h('span', { class: 'badge on' }, 'Playing'),
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
    all && coverageCard(players, ratings, short),
    all && matchStatsCard(players, ratings),
    all && extra);
}

// Super only: who has been rated by how many people, and how much of the group each rater covers. One rater's view
// of a player swings the combined number; two or more (with leans taken out) settle it.
function coverageCard(players, ratings, short) {
  const by = new Map(players.map(p => [p.id, new Set()]));
  for (const r of ratings) if (by.has(r.player_id) && SKILLS.some(s => r[s] != null)) by.get(r.player_id).add(r.rater_id);
  const n = id => by.get(id).size;
  const buckets = [[0, 'Nobody'], [1, 'One rater'], [2, 'Two'], [3, 'Three or more']].map(([k, label]) => ({ label, count: players.filter(p => k === 3 ? n(p.id) >= 3 : n(p.id) === k).length }));
  const thin = players.filter(p => n(p.id) < 2).sort((a, b) => (b.playing - a.playing) || n(a.id) - n(b.id) || a.name.localeCompare(b.name));
  const raters = [...new Set(ratings.map(r => r.rater_id))];
  const covers = raters.map(rid => ({ rid, n: players.filter(p => by.get(p.id).has(rid)).length })).sort((a, b) => b.n - a.n);
  const anchors = players.filter(p => p.anchor);
  return h('div', { class: 'card' }, h('h3', {}, 'Coverage'),
    h('p', { class: 'muted small' }, 'How many people have rated each player. Players with one rater or none show up on everyone\'s Rate page under ', h('b', {}, 'Worth a fresh look'), '.'),
    h('div', { class: 'tiles' }, buckets.map(b => h('div', { class: 'card tile' }, h('span', { class: 'stat' }, String(b.count)), h('b', {}, b.label), h('span', { class: 'muted small' }, 'players')))),
    thin.length > 0 && h('div', { class: 'chips', style: 'margin:10px 0' }, thin.map(p => h('span', { class: `chip plain${n(p.id) ? '' : ' off'}` }, p.name, h('span', { class: 'muted small' }, ` · ${n(p.id)}`), p.playing && h('span', { class: 'badge on', style: 'margin-left:6px' }, 'Playing')))),
    h('div', { class: 'scroll' }, stacked(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Rater'), h('th', { class: 'num' }, 'Players rated'), h('th', { class: 'num' }, 'Of the group'), anchors.length > 0 && h('th', { class: 'num' }, 'Anchors rated'))),
      h('tbody', {}, covers.map(c => h('tr', {}, h('td', {}, short(c.rid)), h('td', { class: 'num' }, String(c.n)), h('td', { class: 'num' }, pct(c.n / players.length)),
        anchors.length > 0 && h('td', { class: 'num' }, `${anchors.filter(a => by.get(a.id).has(c.rid)).length} of ${anchors.length}`))))))));
}

// Super only: per-player numbers from tagged games, and SetMe's ratings worked out from them (see statRatings in
// stats.mjs). SetMe is a rater account of its own, so its ratings are combined, picked and charted like anyone's.
function matchStatsCard(players, ratings) {
  const el = h('div', { class: 'card' }, h('h3', {}, 'Match stats'), h('p', { class: 'muted' }, 'Loading…'));
  (async () => {
    let rows, tagged;
    try {
      [rows, [{ games: tagged }]] = await Promise.all([q(sb.from('player_stats').select('*')), q(sb.from('tagged_games').select('games'))]);
    } catch { return el.replaceChildren(h('h3', {}, 'Match stats'), h('p', { class: 'muted' }, 'Not set up yet: run supabase/match_stats.sql in Supabase, then tag games on Scores.')); }
    if (!tagged) return el.replaceChildren(h('h3', {}, 'Match stats'), h('p', { class: 'muted' }, 'No games tagged yet. On Scores, tap Tag on a saved game.'));
    const tallies = tallyFromCounts(rows);
    const pct = v => v == null ? '–' : `${Math.round(v * 100)}%`, num = v => v == null ? '–' : (Math.round(v * 100) / 100).toFixed(2);
    const COLS = [['Player'], ['Games'], ['Serves'], ['Aces', 'Ace %'], ['Srv err', 'Serve errors'], ['Pass', 'Pass average (0–3)'], ['Attacks'], ['Kill', 'Kill %'],
      ['Eff', 'Attack efficiency: (kills − errors − blocked) ÷ attacks'], ['Blk/g', 'Stuff blocks per game'], ['Dig/g', 'Digs per game']];
    const list = players.filter(p => tallies.has(p.id)).map(p => ({ p, m: metrics(tallies.get(p.id)) }));
    const table = stacked(h('table', {},
      h('thead', {}, h('tr', {}, COLS.map(([t, title], i) => h('th', { class: i ? 'num' : null, title }, t)))),
      h('tbody', {}, list.map(({ p, m }) => h('tr', {}, h('td', {}, p.name),
        [m.games, m.serves, pct(m.aceRate), pct(m.serveErr), m.passes ? `${num(m.passAvg)} (${m.passes})` : '–', m.attacks, pct(m.killRate), num(m.attackEff),
          num(m.stuffsPerGame), num(m.digsPerGame)].map(v => h('td', { class: 'num' }, String(v))))))));

    // SetMe's ratings: preview the changes, then write them as the SetMe rater.
    const [setme] = await q(sb.from('profiles').select('id').eq('email', 'setme@setme.invalid'));
    const current = new Map(setme ? ratings.filter(r => r.rater_id === setme.id).map(r => [r.player_id, r]) : []);
    const out = h('div');
    const preview = () => {
      const { ratings: next, detail } = statRatings(tallies, players);
      const skills = Object.keys(SKILL_STATS);
      const changes = [];
      for (const [pid, sk] of next) for (const s of skills) if (s in sk) {
        const was = current.get(pid)?.[s]; const old = was == null ? null : Number(was);
        if (old !== sk[s]) changes.push({ pid, s, old, new: sk[s] });
      }
      const skipped = skills.filter(s => detail[s].skipped).map(s => detail[s].flat ? `${LABEL[s]} (no differences between players yet)`
        : `${LABEL[s]} (${detail[s].players} of ${MIN_PLAYERS} players have ${SKILL_STATS[s].min}+ ${s === 'blocking' || s === 'hustle' ? 'games' : 'attempts'})`);
      const apply = h('button', { class: 'ball', disabled: !changes.length }, changes.length ? `Save ${changes.length} change${changes.length === 1 ? '' : 's'} as SetMe` : 'Nothing to change');
      apply.onclick = async () => {
        apply.disabled = true; apply.textContent = 'Saving…';
        try {
          const { id } = await callFn('admin', { action: 'setme' });
          // Every row carries every derived skill (unchanged ones as they were), so nothing gets blanked.
          const body = [...next].map(([pid, sk]) => ({ rater_id: id, player_id: pid,
            ...Object.fromEntries(skills.map(s => [s, s in sk ? sk[s] : current.get(pid)?.[s] ?? null])) }));
          await q(sb.from('ratings').upsert(body));
          toast('SetMe\'s ratings saved'); render();
        } catch (e) { toast(e.message); apply.disabled = false; apply.textContent = 'Try again'; }
      };
      const name = new Map(players.map(p => [p.id, p.name]));
      out.replaceChildren(
        ...(skipped.length ? [h('p', { class: 'muted small' }, `Not rated yet, too little data: ${skipped.join('; ')}.`)] : []),
        changes.length ? h('div', { class: 'chips' }, changes.map(c => h('span', { class: `chip plain ${c.old == null ? '' : c.new > c.old ? 'up' : 'down'}` },
          `${name.get(c.pid)} · ${SHORT[c.s]} ${fmt(c.old)} → ${fmt(c.new)}`))) : h('p', { class: 'muted' }, 'SetMe\'s ratings already match the stats.'),
        h('div', { class: 'row', style: 'margin-top:10px' }, apply));
    };
    el.replaceChildren(
      h('h3', {}, 'Match stats'),
      h('p', { class: 'muted small' }, `From ${tagged} tagged game${tagged === 1 ? '' : 's'}. Only you can see these.`),
      h('div', { class: 'scroll' }, table),
      h('h3', { style: 'margin-top:18px' }, 'SetMe\'s ratings'),
      h('p', { class: 'muted small' }, 'SetMe rates players from these stats as a rater of its own: ',
        Object.entries(SKILL_STATS).map(([s, d]) => `${LABEL[s]} from ${d.label.toLowerCase()}`).join(', '),
        '. Small samples are pulled toward the average, then players are ranked and spread over 0 to 1. Pick SetMe in Ratings from to see or use them.'),
      h('button', { class: 'ghost sm', onclick: preview }, 'Preview changes'), out);
  })().catch(e => el.replaceChildren(h('h3', {}, 'Match stats'), h('p', { class: 'warn' }, e.message)));
  return el;
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
  let used = [], player = '', limit = 30, mode = 'skill', chartRater = null, allMode = 'count';
  const playerBox = comboBox([['', 'All players'], ...players.map(p => [String(p.id), p.name])], v => { player = v; limit = 30; paint(); }, 'Player');
  const list = h('div', { class: 'history' });
  // Chart for one player: their skills over time from one rater, or each rater's total over time.
  const modeSeg = seg([['skill', 'By skill'], ['total', all ? 'Total by rater' : 'Total']], mode, v => { mode = v; paintChart(); }, 'Chart');
  const raterRow = h('div', { class: 'row chart-raters' });
  const chartBox = h('div', { class: 'chart-box' });
  // Chart for all players: changes per day, or every player's total / weighted total over time.
  const allSeg = seg([['count', 'Changes per day'], ['total', 'Total'], ['weighted', 'Weighted']], allMode, v => { allMode = v; paintChart(); }, 'Chart');
  const chartWrap = h('div', { class: 'history-chart' }, h('div', { class: 'toolbar' }, modeSeg, allSeg, raterRow), chartBox);
  let stopChart = () => {};
  const paintChart = () => {
    stopChart(); stopChart = () => {};
    modeSeg.hidden = !player;
    allSeg.hidden = !!player;
    if (!player) {
      raterRow.replaceChildren();
      const rows = changeLog.filter(c => known.has(c.player_id) && used.includes(c.rater_id));
      allSeg.hidden = !rows.length;
      if (!rows.length) return chartBox.replaceChildren();
      stopChart = allMode === 'count' ? changesChart(chartBox, rows, all && used.length > 1 ? short : null)
        : playersChart(chartBox, { log: changeLog, ratings, players, raters: used, metric: allMode, onpick: id => show(id) });
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
    h('p', { class: 'muted small' }, 'How many ratings changed each day, or every player\'s total over time. Pick a player (or tap their name in the table) to chart just their ratings. Recorded from when history was switched on.'),
    h('div', { class: 'toolbar' }, h('div', { class: 'sort' }, h('span', {}, 'Player'), playerBox.el)),
    chartWrap, list, more);
  const show = id => { player = String(id); playerBox.set(player); limit = 30; paint(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return { el, draw(ids) { used = ids; paint(); }, show };
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

// All players: each player's total (or weighted total) over time, a faint step line per player whose number moved.
// Ratings at any moment = today's ratings with every later change undone. One rater: what they entered (a gap while
// any skill is U). Several: combined like the table (leans taken out), a gap while nobody has rated them.
// Hover or arrow keys pick out one player (up/down to switch players); click or Enter opens their history.
function playersChart(box, { log, ratings, players, raters, metric, onpick }) {
  const metricOf = metric === 'weighted' ? weightedTotal : sk => SKILLS.reduce((a, s) => a + sk[s], 0);
  const known = new Set(players.map(p => p.id));
  const rows = log.filter(c => raters.includes(c.rater_id) && known.has(c.player_id))
    .map(c => ({ ...c, t: new Date(c.changed_at).getTime() })).sort((a, b) => a.t - b.t);
  // One stop per burst of changes (gaps under 5 minutes), at the burst's last change.
  const times = [];
  for (const r of rows) if (times.length && r.t - times.at(-1) < 5 * 60e3) times[times.length - 1] = r.t; else times.push(r.t);
  const now = Date.now(), first = times[0], span = Math.max(now - first, 60e3), pad = Math.max(span * .08, 30 * 60e3);
  const t0 = first - pad, t1 = now, stops = [t0, ...times, t1];

  // Walk back from today's ratings, undoing changes newer than each stop.
  const key = (rid, pid) => `${rid}|${pid}`;
  const snap = new Map(ratings.filter(r => raters.includes(r.rater_id) && known.has(r.player_id)).map(r => [key(r.rater_id, r.player_id), { ...r }]));
  const raw = raters.length === 1;
  const valuesNow = () => {
    if (raw) return new Map(players.map(p => {
      const r = snap.get(key(raters[0], p.id));
      const sk = Object.fromEntries(SKILLS.map(s => [s, r?.[s] == null ? null : Number(r[s])]));
      return [p.id, SKILLS.some(s => sk[s] == null) ? null : metricOf(sk)];
    }));
    const { combined } = combineRatings(players, [...snap.values()]);
    return new Map(players.map(p => { const c = combined.get(p.id); return [p.id, c.guess ? null : metricOf(c.skills)]; }));
  };
  const vals = new Array(stops.length);
  let undo = rows.length - 1;
  for (let i = stops.length - 1; i >= 0; i--) {
    for (; undo >= 0 && rows[undo].t > stops[i]; undo--) {
      const r = rows[undo], k = key(r.rater_id, r.player_id);
      if (!snap.has(k)) snap.set(k, { rater_id: r.rater_id, player_id: r.player_id });
      snap.get(k)[r.skill] = r.old_value;
    }
    vals[i] = valuesNow();
  }
  const series = players.map(p => ({ p, v: vals.map(m => m.get(p.id)) }))
    .filter(se => se.v.some((v, i) => i && v != null && (se.v[i - 1] == null || Math.abs(v - se.v[i - 1]) > 1e-9)));
  if (!series.length) { box.replaceChildren(h('p', { class: 'muted' }, 'No totals have changed yet.')); return () => {}; }

  const vs = series.flatMap(se => se.v).filter(v => v != null);
  let lo = Math.floor(Math.min(...vs) * 2) / 2, hi = Math.ceil(Math.max(...vs) * 2) / 2;
  if (hi - lo < 1) { lo = Math.max(0, lo - .5); hi = lo + 1; }
  const tickStep = hi - lo > 3 ? 1 : .5;
  const yTicks = []; for (let v = Math.ceil(lo / tickStep) * tickStep; v <= hi + 1e-9; v += tickStep) yTicks.push(v);
  const sameDay = span < 36 * 3600e3;
  const tickLabel = t => new Date(t).toLocaleString([], sameDay ? { hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short' });
  const tipTime = t => t === t0 ? 'Before the first change' : t === t1 ? 'Now' : new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const signed = v => `${v > 0 ? '+' : ''}${fmt(v)}`;

  const label = metric === 'weighted' ? 'Weighted total' : 'Total';
  const head = h('div', { class: 'chart-legend' }, `${label} over time for the ${series.length} ${series.length === 1 ? 'player' : 'players'} whose ${label.toLowerCase()} changed. Hover to pick one out, tap to open their history.`);
  const plot = h('div', { class: 'chart-plot' });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  plot.append(tip);
  box.replaceChildren(head, plot);

  let W = 0, svgEl = null, cross = null, xOf, yOf, focusIdx = stops.length - 1, focusSe = null, paths = [];
  const H = 240, M = { l: 34, r: 12, t: 10, b: 26 };
  const render = () => {
    W = plot.clientWidth; if (!W) return;
    xOf = t => M.l + (t - t0) / (t1 - t0) * (W - M.l - M.r);
    yOf = v => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);
    const grid = yTicks.map(v => svg('g', {},
      svg('line', { x1: M.l, x2: W - M.r, y1: yOf(v), y2: yOf(v), class: 'grid' }),
      svg('text', { x: M.l - 6, y: yOf(v), class: 'axis', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, fmt(v))));
    const n = Math.max(2, Math.min(5, Math.floor((W - M.l - M.r) / 90)));
    const xt = Array.from({ length: n }, (_, i) => t0 + (t1 - t0) * i / (n - 1));
    const xAxis = xt.map((t, i) => svg('text', { x: xOf(t), y: H - 6, class: 'axis', 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, i === n - 1 ? 'Now' : tickLabel(t)));
    paths = series.map(se => {
      let d = '', prev = null;
      se.v.forEach((v, i) => {
        if (v == null) { prev = null; return; }
        if (prev == null) d += `M${xOf(stops[i])},${yOf(v)}`; else if (v !== prev) d += `L${xOf(stops[i])},${yOf(v)}`;
        d += `L${xOf(stops[i + 1] ?? t1)},${yOf(v)}`;
        prev = v;
      });
      return svg('path', { d, class: 'line faint' });
    });
    cross = svg('line', { y1: M.t, y2: H - M.b, class: 'cross', visibility: 'hidden' });
    const hit = svg('rect', { x: M.l, y: 0, width: W - M.l - M.r, height: H, fill: 'transparent' });
    svgEl = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: 0, class: 'clickable',
      'aria-label': `${label} over time for ${series.length} players. Left and right arrow keys step through changes, up and down switch players, Enter opens a player's history.` },
      grid, xAxis, ...paths, cross, hit);
    svgEl.onpointermove = e => {
      const b = svgEl.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
      const i = stops.reduce((best, t, j) => Math.abs(xOf(t) - x) < Math.abs(xOf(stops[best]) - x) ? j : best, 0);
      // The line closest to the pointer at that moment.
      const se = series.filter(s => s.v[i] != null).reduce((best, s) => !best || Math.abs(yOf(s.v[i]) - y) < Math.abs(yOf(best.v[i]) - y) ? s : best, null);
      show(i, se);
    };
    svgEl.onpointerleave = hide;
    svgEl.onclick = () => focusSe && onpick(focusSe.p.id);
    svgEl.onfocus = () => show(focusIdx, focusSe);
    svgEl.onblur = hide;
    svgEl.onkeydown = e => {
      if (e.key === 'Enter' && focusSe) { e.preventDefault(); onpick(focusSe.p.id); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); show(Math.max(0, Math.min(stops.length - 1, focusIdx + (e.key === 'ArrowRight' ? 1 : -1))), focusSe); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        // Players with a value at this moment, top of the chart first.
        const order = series.filter(s => s.v[focusIdx] != null).sort((a, b) => b.v[focusIdx] - a.v[focusIdx]);
        if (!order.length) return;
        const at = order.indexOf(focusSe);
        show(focusIdx, order[at < 0 ? 0 : Math.max(0, Math.min(order.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]);
      }
    };
    plot.querySelector('svg')?.remove();
    plot.prepend(svgEl);
    if (focusSe) mark(focusSe);
  };
  // Highlight one line and draw it above the others (the crosshair and hit area stay on top).
  const mark = se => paths.forEach((p, j) => {
    const on = series[j] === se;
    p.classList.toggle('hot', on);
    if (on) p.parentNode.insertBefore(p, cross);
  });
  const show = (i, se) => {
    focusIdx = i; const t = stops[i], x = xOf(t);
    se ??= series.filter(s => s.v[i] != null).sort((a, b) => b.v[i] - a.v[i])[0] ?? null;
    focusSe = se; mark(se);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    const v = se?.v[i], start = se?.v.find(x => x != null);
    // How many of the lines moved at this stop.
    const moved = i ? series.filter(s => s.v[i] != null && s.v[i - 1] != null && Math.abs(s.v[i] - s.v[i - 1]) > 1e-9).length : 0;
    tip.replaceChildren(h('div', { class: 'chart-tip-head' }, tipTime(t)),
      se && h('div', { class: 'chart-tip-row' }, h('i', { style: 'background:var(--s1)' }), h('b', {}, fmt(v)), ' ', se.p.name),
      se && v != null && start != null && h('div', { class: 'chart-tip-row muted' }, `${signed(v - start)} since first shown`),
      i > 0 && i < stops.length - 1 && h('div', { class: 'chart-tip-row muted' }, `${moved} ${moved === 1 ? 'player' : 'players'} moved here`));
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(W - tw, x > W / 2 ? x - tw - 12 : x + 12))}px`;
  };
  const hide = () => { tip.hidden = true; cross?.setAttribute('visibility', 'hidden'); focusSe = null; mark(null); };
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
// Accounts, their roles, and (after the club upgrade) which player each one is. Linking is done here by the super,
// never by the person, so nobody has to find themselves in a list.
async function usersPage() {
  const [profiles, players] = await Promise.all([
    q(sb.from('profiles').select('*').order('display_name')),
    q(sb.from('players').select('id,name,active').order('name')),
  ]);
  const club = profiles.some(p => 'player_id' in p); // the club upgrade has run
  const linkBox = h('div');
  const showLink = (label, link) => linkBox.replaceChildren(h('div', { class: 'card' },
    h('b', {}, label), h('p', { class: 'link' }, link),
    h('button', { onclick: () => navigator.clipboard.writeText(link).then(() => toast('Copied')) }, 'Copy link')));

  const email = h('input', { type: 'email', placeholder: 'Email', 'aria-label': 'Email' });
  const name = h('input', { type: 'text', placeholder: 'Name', 'aria-label': 'Name' });
  let inviteRole = club ? 'player' : 'rater';
  const roleOptions = [...(club ? [['player', 'Player']] : []), ['rater', 'Rater'], ['organizer', 'Organizer']];
  const invite = async e => {
    e.preventDefault();
    try {
      const { link } = await callFn('admin', { action: 'invite', email: email.value, name: name.value, role: inviteRole });
      showLink(`Invite link for ${name.value || email.value} (${inviteRole}). Send it to them directly; it works once.${inviteRole === 'player' ? ' Then link their account to their player below.' : ''}`, link);
      email.value = name.value = '';
    } catch (err) { toast(err.message); }
  };
  const setRole = async (p, role) => {
    try { await q(sb.from('profiles').update({ role }).eq('id', p.id)); p.role = role; toast('Saved'); }
    catch (err) { toast(err.message); return false; }
  };
  const linkPlayer = async (p, sel) => {
    const v = sel.value ? Number(sel.value) : null;
    const taken = v && profiles.find(x => x.player_id === v && x.id !== p.id);
    if (taken && !await ask('Move the link?', `${taken.display_name}'s account is linked to that player. Move the link to ${p.display_name}?`, 'Move link', 'ball')) { sel.value = p.player_id ?? ''; return; }
    try {
      if (taken) { await q(sb.from('profiles').update({ player_id: null }).eq('id', taken.id)); taken.player_id = null; }
      await q(sb.from('profiles').update({ player_id: v }).eq('id', p.id)); p.player_id = v;
      toast(v ? 'Linked' : 'Unlinked');
      if (p.id === me.id) { me.player_id = v; render(); }
      else if (taken) render();
    } catch (err) { sel.value = p.player_id ?? ''; toast(err.message); }
  };
  const reset = async p => {
    try { showLink(`Password reset link for ${p.display_name}.`, (await callFn('admin', { action: 'reset', email: p.email })).link); }
    catch (err) { toast(err.message); }
  };
  const remove = async p => {
    if (!await ask(`Remove ${p.display_name}?`, 'Their account and their ratings are deleted. This can\'t be undone.', 'Remove account')) return;
    try { await callFn('admin', { action: 'remove', id: p.id }); render(); } catch (err) { toast(err.message); }
  };
  // Player picker: active players first; the account's current player stays listed even if inactive.
  const playerSelect = p => {
    const sel = h('select', { 'aria-label': `${p.display_name}'s player` }, h('option', { value: '' }, 'Not linked'),
      players.filter(x => x.active || x.id === p.player_id).map(x => {
        const other = profiles.find(o => o.player_id === x.id && o.id !== p.id);
        return h('option', { value: x.id, selected: x.id === p.player_id }, other ? `${x.name} (linked to ${other.display_name})` : x.name);
      }));
    sel.onchange = () => linkPlayer(p, sel);
    return sel;
  };
  const setme = p => p.email === 'setme@setme.invalid';

  return h('div', {},
    pageHead('Users', 'Players sign up and see published teams. Raters also rate. Organizers also run Players, Teams and Scores, but never see ratings.'),
    h('form', { class: 'card row', onsubmit: invite }, name, email,
      h('div', { class: 'field' }, h('span', {}, 'As'), seg(roleOptions, inviteRole, v => { inviteRole = v; }, 'Invite as')),
      h('button', {}, 'Create invite link')),
    linkBox,
    !club && h('p', { class: 'muted small' }, 'Player accounts, linking accounts to players, and the activity log need the database upgrade: run supabase/club.sql in Supabase.'),
    h('div', { class: 'grid' }, profiles.map(p => h('div', { class: 'card roster-card' },
      h('header', {}, avatar(p.display_name || '?'), h('div', { class: 'grow' }, h('b', {}, p.display_name), h('div', { class: 'muted small' }, p.email))),
      h('div', { class: 'row' },
        p.role === 'super' ? h('span', { class: 'badge set' }, 'Super') : seg(roleOptions.concat(p.role === 'player' && !club ? [['player', 'Player']] : []), p.role, v => setRole(p, v), `${p.display_name} role`),
        h('span', { class: 'grow' }),
        h('div', { class: 'row', style: 'gap:8px' },
          !setme(p) && h('button', { class: 'ghost sm', onclick: () => reset(p) }, 'Reset link'),
          p.id !== me.id && h('button', { class: 'danger sm', onclick: () => remove(p) }, 'Remove'))),
      club && !setme(p) && h('label', { class: 'field' }, h('span', {}, 'Player'), playerSelect(p))))),
    backupCard(),
    club && activityCard(profiles));
}

// Every table as one JSON file, for safekeeping. Pages through big tables (the API returns 1,000 rows at a time).
// Tables that don't exist yet (upgrades not run) are listed as skipped.
const BACKUP_TABLES = ['profiles', 'players', 'ratings', 'rating_history', 'sessions', 'games', 'rallies', 'touches', 'events', 'signups', 'drafts', 'audit_log'];
function backupCard() {
  const btn = h('button', { class: 'ghost' }, 'Download backup');
  const note = h('p', { class: 'muted small' }, 'Everything in SetMe as one JSON file: players, accounts, every rating and its history, game days, scores, tags, sign-ups, drafts and the activity log. It holds everyone\'s ratings, so keep it somewhere private.');
  btn.onclick = async () => {
    btn.disabled = true;
    const out = { app: 'SetMe', exported_at: new Date().toISOString(), tables: {}, skipped: [] };
    try {
      for (const t of BACKUP_TABLES) {
        btn.textContent = `Reading ${t.replace('_', ' ')}…`;
        const rows = [];
        try {
          for (let from = 0; ; from += 1000) {
            const page = await q(sb.from(t).select('*').range(from, from + 999));
            rows.push(...page);
            if (page.length < 1000) break;
          }
          out.tables[t] = rows;
        } catch (e) { if (missing(e)) out.skipped.push(t); else throw e; }
      }
      downloadFile(JSON.stringify(out, null, 1), `setme-backup-${today()}.json`, 'application/json');
      const n = Object.values(out.tables).reduce((a, r) => a + r.length, 0);
      note.textContent = `Downloaded ${n} rows from ${Object.keys(out.tables).length} tables${out.skipped.length ? ` (not set up yet: ${out.skipped.join(', ')})` : ''}.`;
      sb.from('audit_log').insert({ action: 'backup downloaded', detail: { rows: n } }).then(() => {}, () => {});
    } catch (e) { toast(`Backup failed: ${e.message}`); }
    btn.disabled = false; btn.textContent = 'Download backup';
  };
  return h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Backup'), btn), note);
}

// The activity log, newest first: roles, links, removals, players added or deleted, imports, backups.
function activityCard(profiles) {
  const el = h('div', { class: 'card' }, h('h3', {}, 'Activity'), h('p', { class: 'muted' }, 'Loading…'));
  const who = new Map(profiles.map(p => [p.id, p.display_name]));
  const say = r => {
    const d = r.detail ?? {};
    switch (r.action) {
      case 'role changed': return `${d.name}: ${d.from} → ${d.to}`;
      case 'account linked': return d.player ? `${d.name} linked to ${d.player}${d.was ? ` (was ${d.was})` : ''}` : `${d.name} unlinked from ${d.was}`;
      case 'user removed': return `Removed ${d.name ?? d.email} (${d.role})`;
      case 'player added': return `Added ${d.name}${d.tier ? ` (${d.tier})` : ''}`;
      case 'player deleted': return `Deleted ${d.name}`;
      case 'player renamed': return `Renamed ${d.from} → ${d.to}`;
      case 'anchor added': return `${d.name} is now an anchor`;
      case 'anchor removed': return `${d.name} is no longer an anchor`;
      case 'game day deleted': return `Deleted the game day ${dayTitle(d.played_on)}`;
      case 'ratings imported': return `Imported ${d.players} players' ratings for ${who.get(d.for) ?? 'another rater'}${d.file ? ` (${d.file})` : ''}`;
      case 'invite link created': return `Invite link for ${d.email}${d.role ? ` as ${d.role}` : ''}`;
      case 'reset link created': return `Password reset link for ${d.email}`;
      case 'backup downloaded': return `Backup downloaded (${d.rows} rows)`;
      default: return r.action;
    }
  };
  let limit = 40;
  const load = async () => {
    try {
      const rows = await q(sb.from('audit_log').select('*').order('at', { ascending: false }).limit(limit + 1));
      const when = t => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
      el.replaceChildren(h('h3', {}, 'Activity'), h('p', { class: 'muted small' }, 'Changes to accounts and players, imports and backups. Only you see this.'),
        rows.length ? h('div', { class: 'history' }, rows.slice(0, limit).map(r => h('div', { class: 'history-item' },
          h('div', { class: 'history-head' }, h('span', {}, say(r), h('span', { class: 'muted' }, ` · ${r.actor ? who.get(r.actor) ?? 'a removed account' : 'SQL editor or system'}`)), h('span', { class: 'muted small' }, when(r.at))))))
          : h('p', { class: 'muted' }, 'Nothing yet.'),
        ...(rows.length > limit ? [h('button', { class: 'ghost sm', onclick: () => { limit += 40; load(); } }, 'Show more')] : []));
    } catch (e) { el.replaceChildren(h('h3', {}, 'Activity'), h('p', { class: 'muted' }, missing(e) ? 'Needs the database upgrade (supabase/club.sql).' : e.message)); }
  };
  load();
  return el;
}

// ---------- sign up (everyone) ----------
// Game days people sign up for (supabase/club.sql). The first `cap` sign-ups are in; the rest wait, in order, and move
// up when someone drops out. Accounts linked to a player (Users page) sign themselves up or out while it's open;
// organizers add or remove anyone, open and close it, and turn the list into the Playing list.
async function signupPage() {
  const organizer = me.role === 'organizer' || me.role === 'super';
  const head = pageHead('Sign up', organizer ? 'Open a game day, share the site, and turn who\'s in into the Playing list.' : 'Say you\'re coming. If it\'s full you go on the waitlist and move up when someone drops out.');
  let events, signups, players;
  try {
    [events, signups, players] = await Promise.all([
      q(sb.from('events').select('*').order('played_on')),
      q(sb.from('signups').select('*').order('created_at')),
      q(sb.from('players').select('id,name,active').order('name')),
    ]);
  } catch (e) { if (missing(e)) return h('div', {}, head, needsUpgrade('Signing up')); throw e; }
  const pname = new Map(players.map(p => [p.id, p.name]));
  const mine = me.player_id;
  const now = today();
  const upcoming = events.filter(e => e.played_on >= now), past = events.filter(e => e.played_on < now).reverse().slice(0, 4);
  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); render(); } catch (e) { toast(e.message); } };

  const eventCard = ev => {
    const list = signups.filter(x => x.event_id === ev.id);
    const ins = list.slice(0, ev.cap), wait = list.slice(ev.cap);
    const at = list.findIndex(x => x.player_id === mine);
    const old = ev.played_on < now;
    const chip = (x, n) => h('span', { class: `chip${x.player_id === mine ? ' me' : ''}${organizer ? '' : ' plain'}` },
      n != null && h('span', { class: 'muted small' }, `${n}. `), profileLink(x.player_id, pname.get(x.player_id) ?? 'Removed player'),
      organizer && h('button', { type: 'button', 'aria-label': `Remove ${pname.get(x.player_id)}`, onclick: () => act(() => q(sb.from('signups').delete().eq('event_id', ev.id).eq('player_id', x.player_id))) }, '×'));
    const status = at < 0 ? null : at < ev.cap ? h('span', { class: 'badge on' }, 'You\'re in') : h('span', { class: 'badge' }, `Waitlist #${at - ev.cap + 1}`);
    const meBtn = mine && !old && (at < 0
      ? h('button', { class: 'ball', disabled: !ev.open, onclick: () => act(() => q(sb.from('signups').insert({ event_id: ev.id, player_id: mine })), ins.length >= ev.cap ? 'On the waitlist' : 'You\'re in') }, ins.length >= ev.cap ? 'Join the waitlist' : 'I\'m in')
      : h('button', { class: 'ghost', disabled: !ev.open, onclick: async () => await ask('Drop out of this game day?', 'If there\'s a waitlist, the next person gets your spot.', 'Drop out') && act(() => q(sb.from('signups').delete().eq('event_id', ev.id).eq('player_id', mine)), 'Dropped out') }, 'Drop out'));
    const add = organizer && h('select', { 'aria-label': 'Add a player' }, h('option', { value: '' }, '+ Add player'),
      players.filter(p => p.active && !list.some(x => x.player_id === p.id)).map(p => h('option', { value: p.id }, p.name)));
    if (add) add.onchange = () => add.value && act(() => q(sb.from('signups').insert({ event_id: ev.id, player_id: Number(add.value) })));
    const capIn = organizer && h('input', { type: 'number', min: 2, max: 200, value: ev.cap, class: 'score-in', 'aria-label': 'Spots' });
    if (capIn) capIn.onchange = () => { const v = Number(capIn.value); if (!Number.isInteger(v) || v < 2 || v > 200) { capIn.value = ev.cap; return toast('Spots: 2 to 200'); } act(() => q(sb.from('events').update({ cap: v }).eq('id', ev.id)), 'Saved'); };
    const toPlaying = async () => {
      if (!await ask('Set the playing list?', `The ${ins.length} people who are in become the Playing list. Everyone else is unticked.`, 'Set playing list', 'ball')) return;
      act(async () => {
        await q(sb.from('players').update({ playing: false }).eq('playing', true));
        if (ins.length) await q(sb.from('players').update({ playing: true, active: true }).in('id', ins.map(x => x.player_id)));
      }, `${ins.length} players set as playing`);
    };
    return h('div', { class: `card${old ? ' dim' : ''}` },
      h('div', { class: 'card-head' },
        h('div', {}, h('h3', {}, dayTitle(ev.played_on)), h('p', { class: 'muted small', style: 'margin:2px 0 0' },
          `${ins.length} of ${ev.cap} spots taken${wait.length ? `, ${wait.length} waiting` : ''}.${ev.open ? '' : ' Sign-ups closed.'}`, ev.note && h('br'), ev.note)),
        h('div', { class: 'row' }, status, meBtn)),
      !ev.open && mine && !old && h('p', { class: 'muted small' }, 'Sign-ups are closed. Message an organizer if something changed.'),
      h('div', { class: 'chips' }, ins.length ? ins.map(x => chip(x)) : h('span', { class: 'muted small' }, 'Nobody yet.')),
      wait.length > 0 && h('p', { class: 'small', style: 'margin:12px 0 6px' }, h('b', {}, 'Waitlist')),
      wait.length > 0 && h('div', { class: 'chips' }, wait.map((x, n) => chip(x, n + 1))),
      organizer && h('div', { class: 'row', style: 'margin-top:14px; padding-top:12px; border-top:1px solid var(--line)' },
        toggle('Open', ev.open, v => act(() => q(sb.from('events').update({ open: v }).eq('id', ev.id)), v ? 'Open for sign-ups' : 'Closed')),
        h('label', { class: 'row', style: 'gap:6px' }, h('span', { class: 'muted small' }, 'Spots'), capIn),
        add, h('span', { class: 'grow' }),
        h('button', { class: 'sm', disabled: !ins.length, onclick: toPlaying }, 'Set as Playing list'),
        h('button', { class: 'danger sm', onclick: async () => await ask(`Delete ${dayTitle(ev.played_on)}?`, `Its ${list.length} sign-up${list.length === 1 ? '' : 's'} are deleted too. This can't be undone.`, 'Delete') && act(() => q(sb.from('events').delete().eq('id', ev.id)), 'Deleted') }, 'Delete')));
  };

  const date = h('input', { type: 'date', value: now, 'aria-label': 'Game day' });
  const cap = h('input', { type: 'number', min: 2, max: 200, value: 24, class: 'score-in', 'aria-label': 'Spots' });
  const note = h('input', { type: 'text', placeholder: 'Note (time, place…)', 'aria-label': 'Note' });
  const create = e => {
    e.preventDefault();
    if (!date.value) return toast('Pick a date');
    if (events.some(x => x.played_on === date.value)) return toast('That day is already open');
    act(() => q(sb.from('events').insert({ played_on: date.value, cap: Number(cap.value) || 24, note: note.value.trim() || null })), 'Sign-ups open');
  };
  return h('div', {}, head,
    !mine && !organizer && h('div', { class: 'card' }, h('p', { style: 'margin:0' }, 'Your account isn\'t linked to a player yet, so you can\'t sign up here. Ask the organizer to link it.')),
    !mine && organizer && h('p', { class: 'muted small' }, 'To sign yourself up too, have the super link your account to your player on Users.'),
    organizer && h('form', { class: 'card build-bar', onsubmit: create },
      h('label', { class: 'field' }, h('span', {}, 'Game day'), date), h('label', { class: 'field' }, h('span', {}, 'Spots'), cap),
      h('label', { class: 'field grow' }, h('span', {}, 'Note'), note), h('button', { class: 'ball' }, 'Open sign-ups')),
    upcoming.length ? upcoming.map(eventCard) : h('div', { class: 'card empty' }, organizer ? 'No game days open. Open one above.' : 'No game days open for sign-ups right now.'),
    organizer && past.length > 0 && h('details', { class: 'card' }, h('summary', {}, h('h3', { style: 'display:inline' }, 'Past game days')), past.map(eventCard)));
}

// ---------- lineup (players, raters) ----------
// Game days whose teams an organizer published (Show to players on Scores): the teams and the scores, no numbers.
async function lineupPage() {
  const head = pageHead('Lineup', 'Teams for recent game days, once the organizers share them.');
  let days;
  try { days = await q(sb.rpc('published_lineups', { p_limit: 5 })); }
  catch (e) { if (missing(e)) return h('div', {}, head, needsUpgrade('The lineup')); throw e; }
  if (!days.length) return h('div', {}, head, h('div', { class: 'card empty' }, 'No teams shared yet. Check back on game day.'));
  return h('div', {}, head, days.map((d, i) => {
    const teams = d.teams.map(players => ({ players }));
    const tn = teamNames(d.teams);
    // Rounds (rounds.sql): earlier rounds' teams, oldest first; the day's own teams are the round playing now.
    const past = d.rounds ?? [], cur = past.length + 1;
    const pastNames = new Map(past.map(r => [r.n, teamNames(r.teams)]));
    const nameIn = (k, n) => ((n ?? 1) === cur ? tn : pastNames.get(n) ?? [])[k - 1] ?? `Team ${k}`;
    const roundsWithGames = [...new Set(d.games.map(g => g.round ?? 1))].sort((a, b) => b - a);
    let blob = null; const ready = courtImage(teams, { title: dayTitle(d.played_on), colors: TEAM_COLORS, names: tn }).then(b => (blob = b));
    const mineAt = teams.findIndex(t => t.players.some(p => p.id === me.player_id));
    return h('section', { class: 'option' },
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, dayTitle(d.played_on), cur > 1 ? h('span', { class: 'muted' }, ` · Round ${cur}`) : ''),
        mineAt >= 0 && h('p', { class: 'muted small', style: 'margin:2px 0 0' }, `You're on ${tn[mineAt]}${cur > 1 ? ` in round ${cur}` : ''}.`)),
        h('button', { class: 'sm', onclick: async () => sharePng(blob ?? await ready, `teams-${d.played_on}.png`) }, 'Share image')),
      h('div', { class: 'team-grid' }, teams.map((t, k) => h('article', { class: `team${k === mineAt ? ' mine' : ''}`, style: `--tc: ${TEAM_COLORS[k % TEAM_COLORS.length]}` },
        h('header', {}, h('h4', {}, tn[k])),
        h('ul', {}, t.players.map(p => h('li', {}, avatar(p.name, 28), h('span', { class: 'pname' }, p.id === me.player_id ? h('b', {}, p.name) : p.name), setterBadge(p))))))),
      d.games.length > 0 && h('div', { class: 'card', style: 'margin-top:12px' }, h('h3', {}, d.ended ? 'Final scores' : d.ended === false ? 'Scores so far' : 'Scores'),
        roundsWithGames.flatMap(n => [cur > 1 && h('h4', { class: 'round-head' }, `Round ${n}`),
          h('ol', { class: 'game-list' }, d.games.filter(g => (g.round ?? 1) === n).map(g => h('li', {}, h('div', { class: 'grow' }, h('b', {}, `${nameIn(g.team_a, n)} v ${nameIn(g.team_b, n)}`)),
            h('span', { class: 'game-score' }, `${g.score_a}–${g.score_b}`))))])),
      [...past].reverse().map(r => h('details', { class: 'round-past' },
        h('summary', {}, h('b', {}, `Round ${r.n} teams`)),
        h('div', { class: 'team-grid' }, r.teams.map((ps, k) => h('article', { class: 'team', style: `--tc: ${TEAM_COLORS[k % TEAM_COLORS.length]}` },
          h('header', {}, h('h4', {}, nameIn(k + 1, r.n))),
          h('ul', {}, ps.map(p => h('li', {}, avatar(p.name, 28), h('span', { class: 'pname' }, p.id === me.player_id ? h('b', {}, p.name) : p.name), setterBadge(p))))))))),
      i < days.length - 1 && h('hr', { class: 'sep' }));
  }));
}

// ---------- player profile ----------
// Everything about one player in one place. Organizers and super: anyone; everyone else: the player their account is
// linked to. Game days and record for all of those; ratings, results against ratings and match stats for the super only.
async function profilePage(id) {
  if (!canProfile(id)) return h('div', { class: 'card empty' }, 'You can only see your own profile.');
  const [player] = await q(sb.from('players').select('*').eq('id', id));
  if (!player) return h('div', { class: 'card empty' }, 'No such player.');
  const isSuper = me.role === 'super', organizer = isSuper || me.role === 'organizer';
  const head = h('div', { class: 'page-head' }, h('div', { class: 'row' }, avatar(player.name, 56),
    h('div', {}, h('h2', {}, player.name), h('p', {}, [player.setting === 'M' ? 'Setter' : player.setting === 'B' ? 'Backup setter' : null,
      player.playing ? 'Playing this session' : null, player.anchor ? 'Anchor player' : null, !player.active ? 'Inactive' : null, id === me.player_id ? 'You' : null].filter(Boolean).join(', ') || ' '))));
  const parts = [head];

  // Game days and games (player_games works for the player themself, organizers and super).
  let days = null;
  try { days = await q(sb.rpc('player_games', { p_player: id })); } catch (e) { if (!missing(e)) throw e; }
  if (!days) parts.push(needsUpgrade('Game days on profiles'));
  else {
    const games = days.flatMap(d => d.games);
    const r = record(games, id);
    // Organizers can read every game day, so they also get how often and runs; players see their own days.
    const all = organizer ? await q(sb.from('sessions').select('id,played_on,teams')).catch(() => null) : null;
    const allGames = organizer && all ? await q(sb.from('games').select('session_id,players_a,players_b')).catch(() => []) : [];
    const att = all ? attendance(all, allGames, today()).get(id) : null;
    const tile = (v, label, sub) => h('div', { class: 'card tile' }, h('span', { class: 'stat' }, v), h('b', {}, label), sub && h('span', { class: 'muted small' }, sub));
    parts.push(h('div', { class: 'tiles' },
      tile(String(days.length), 'Game days', att ? `${pct(att.rate)} since their first` : days.length ? `first ${dayTitle(days[0].played_on)}` : null),
      tile(r.games ? `${r.wins}–${r.losses}` : '—', 'Record', r.games ? `${pct(r.wins / r.games)} won` : 'no games yet'),
      tile(String(r.best), 'Best win streak', 'games in a row'),
      att ? tile(String(att.streak), 'Game days in a row', att.missing ? 'Stopped coming lately' : `best ${att.best}`) : tile(days.length ? dayTitle(days.at(-1).played_on) : '—', 'Last came')));
    if (att) parts.push(h('div', { class: 'card' }, h('h3', {}, 'Attendance'), h('p', { class: 'muted small' }, 'Every game day since their first, oldest on the left.'),
      h('span', { class: 'dots big' }, att.history.slice(att.history.findIndex(d => d.came)).map(d => h('i', { class: d.came ? 'on' : null, title: `${dayTitle(d.played_on)}: ${d.came ? 'came' : 'missed'}` })))));
    const recent = [...days].reverse().slice(0, 8);
    if (recent.length) parts.push(h('div', { class: 'card' }, h('h3', {}, 'Recent game days'),
      h('ol', { class: 'game-list' }, recent.map(d => {
        const res = record(d.games, id);
        return h('li', {}, h('div', { class: 'grow' }, h('b', {}, dayTitle(d.played_on)), d.team && h('span', { class: 'muted small' }, `, Team ${d.team}`),
          h('div', { class: 'muted small' }, d.games.map(g => { const a = g.players_a.includes(id); const [us, them] = a ? [g.score_a, g.score_b] : [g.score_b, g.score_a]; return `${us > them ? 'W' : 'L'} ${us}–${them}`; }).join(' · ') || 'No games entered')),
          res.games > 0 && h('span', { class: 'game-score' }, `${res.wins}–${res.losses}`));
      }))));
  }

  // Sign-ups ahead.
  const ev = await q(sb.from('events').select('id,played_on,cap').gte('played_on', today()).order('played_on')).catch(() => null);
  if (ev?.length) {
    const sg = await q(sb.from('signups').select('event_id,player_id,created_at').in('event_id', ev.map(e => e.id)).order('created_at')).catch(() => []);
    const lines = ev.map(e => { const list = sg.filter(x => x.event_id === e.id); const at = list.findIndex(x => x.player_id === id);
      return at < 0 ? null : h('li', {}, h('b', {}, dayTitle(e.played_on)), ': ', at < e.cap ? 'you\'re in' : `number ${at - e.cap + 1} on the waitlist`); }).filter(Boolean);
    parts.push(h('div', { class: 'card' }, h('h3', {}, 'Signed up for'), lines.length ? h('ul', {}, lines) : h('p', { class: 'muted' }, 'Nothing coming up.', id === me.player_id ? [' ', h('a', { href: '#signup' }, 'Sign up')] : [])));
  }

  // Super only: ratings, results against ratings, match stats.
  if (isSuper) {
    const [players, ratings, profiles, games] = await Promise.all([
      q(sb.from('players').select('id,name,tier,setting').eq('active', true)),
      q(sb.from('ratings').select('*')),
      q(sb.from('profiles').select('id,display_name')),
      q(sb.from('games').select('*')).catch(() => []),
    ]);
    const rn = new Map(profiles.map(p => [p.id, p.display_name]));
    const { combined } = combineRatings(players, ratings);
    const c = combined.get(id);
    const mineR = ratings.filter(r => r.player_id === id);
    if (c) {
      const adj = resultAdjustments(games).get(id);
      const a = analyze(games), st = a.n ? playerStats(games, a.k).find(p => p.id === id) : null;
      const row = (label, vals, extra) => h('tr', {}, h('td', {}, label), RATED.map((s, i) => h('td', { class: 'num' }, forPlayer(s, player) ? fmt(vals[i]) : '–')), h('td', { class: 'num' }, extra));
      parts.push(h('div', { class: 'card' }, h('h3', {}, 'Ratings'), h('p', { class: 'muted small' }, 'Only you see this. Combined has each rater\'s lean taken out.',
        c.guess ? ` Nobody has rated them, so the ${c.guess} stand-in level is used.` : ''),
        h('div', { class: 'scroll' }, stacked(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, ''), RATED.map(s => h('th', { class: 'num' }, SHORT[s])), h('th', { class: 'num' }, 'Weighted'))),
          h('tbody', {}, row(h('b', {}, 'Combined'), RATED.map(s => c.skills[s]), h('b', {}, fmt(weightedTotal(c.skills)))),
            mineR.map(r => { const v = RATED.map(s => r[s] == null ? null : Number(r[s])); const known = SKILLS.every(s => r[s] != null);
              return row(rn.get(r.rater_id) ?? 'Removed rater', v, known ? fmt(weightedTotal(Object.fromEntries(SKILLS.map(s => [s, Number(r[s])])))) : 'U'); }))))),
        st && h('p', { class: 'small' }, h('b', {}, 'Against their ratings: '), `${plusPts(st.over)} points a game over ${st.games} games`,
          adj != null ? ` · Adjust for results adds ${signed(adj)}` : ''),
        h('p', { class: 'small' }, h('a', { href: '#ratings', onclick: () => { pendingHistory = id; } }, 'Rating history →'))));
    }
    const statRow = await q(sb.from('player_stats').select('*').eq('player_id', id)).catch(() => []);
    if (statRow.length) {
      const m = metrics(tallyFromCounts(statRow).get(id));
      const num = v => v == null ? '–' : (Math.round(v * 100) / 100).toFixed(2);
      parts.push(h('div', { class: 'card' }, h('h3', {}, 'Match stats'), h('p', { class: 'muted small' }, `From ${m.games} tagged game${m.games === 1 ? '' : 's'}. Only you see these.`),
        h('div', { class: 'tiles' }, [[pct(m.aceRate), 'Aces', `${m.serves} serves`], [num(m.passAvg), 'Pass average', `${m.passes} passes, 0–3`],
          [pct(m.killRate), 'Kills', `${m.attacks} attacks`], [num(m.attackEff), 'Attack efficiency', 'kills − errors − blocked'],
          [num(m.stuffsPerGame), 'Blocks a game'], [num(m.digsPerGame), 'Digs a game']].map(([v, l, sub]) => h('div', { class: 'card tile' }, h('span', { class: 'stat' }, v), h('b', {}, l), sub && h('span', { class: 'muted small' }, sub))))));
    }
  }
  return h('div', {}, parts);
}
// Set by a profile's "Rating history" link: the All ratings page opens that player's history.
let pendingHistory = null;

boot();
