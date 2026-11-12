import { avatar, h, me, q, sb, session, setMe, setRender, setSession, toast } from './ui.mjs';
import { ratePage } from './pages/rate.mjs';
import { playersPage } from './pages/players.mjs';
import { teamsPage, teamsStore } from './pages/teams.mjs';
import { scoresPage } from './pages/scores.mjs';
import { ratingsPage } from './pages/ratings.mjs';
import { usersPage } from './pages/users.mjs';
import { lineupPage, profilePage, signupPage } from './pages/club.mjs';

const app = document.getElementById('app');
// Players (role 'player', from the club upgrade) don't rate: they sign up for game days and see published teams.
const PAGES = [
  { id: 'rate', label: 'Rate', roles: ['rater', 'organizer', 'super'], view: ratePage },
  // club: only once supabase/club.sql has run (profiles then have player_id), so nothing changes before it.
  { id: 'signup', label: 'Sign up', roles: ['player', 'rater', 'organizer', 'super'], view: signupPage, club: true },
  { id: 'lineup', label: 'Lineup', roles: ['player', 'rater'], view: lineupPage, club: true },
  { id: 'players', label: 'Players', roles: ['organizer', 'super'], view: playersPage },
  { id: 'teams', label: 'Teams', roles: ['organizer', 'super'], view: teamsPage },
  { id: 'scores', label: 'Scores', roles: ['organizer', 'super'], view: scoresPage },
  { id: 'ratings', label: role => role === 'super' || role === 'organizer' ? 'All ratings' : 'My ratings', roles: ['rater', 'organizer', 'super'], view: ratingsPage },
  { id: 'users', label: 'Users', roles: ['super'], view: usersPage },
];

// Arriving from an invite or reset link means a password needs setting.
let mustSetPassword = /type=(invite|recovery)/.test(location.hash);
// Invite/reset links carry a token that is only used when the person taps Continue (see netlify/functions/admin.mjs).
const query = new URLSearchParams(location.search);
let pendingLink = query.get('token_hash') ? { token_hash: query.get('token_hash'), type: query.get('type') === 'recovery' ? 'recovery' : 'invite' } : null;
// Supabase reports expired or used links in the URL hash.
let linkError = new URLSearchParams(location.hash.slice(1)).get('error_description');
function accountMenu() {
  const box = h('details', { class: 'menu account' },
    h('summary', { 'aria-label': `Account: ${me.display_name}` }, avatar(me.display_name || '?', 34), h('span', { class: 'who-text' }, h('b', {}, me.display_name), h('small', {}, me.role))),
    h('div', { class: 'menu-list', role: 'menu' },
      h('p', { class: 'small' }, h('b', {}, me.display_name), h('br'), h('span', { class: 'muted' }, `${session.user.email}, ${me.role}`)),
      me.player_id && h('a', { href: `#player/${me.player_id}`, role: 'menuitem', onclick: () => { box.open = false; } }, 'My profile'),
      h('button', { type: 'button', role: 'menuitem', onclick: () => { teamsStore.clear(); sb.auth.signOut(); } }, 'Sign out')));
  return box;
}
// ---------- auth & routing ----------
sb.auth.onAuthStateChange((event, s) => {
  setSession(s);
  if (event === 'PASSWORD_RECOVERY') mustSetPassword = true;
  if (event === 'SIGNED_OUT') { setMe(null); render(); }
});
window.addEventListener('hashchange', render);

async function boot() {
  setSession((await sb.auth.getSession()).data.session);
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
    if (!me) setMe(await q(sb.from('profiles').select('*').eq('id', session.user.id).single()));
  } catch {
    return app.replaceChildren(h('p', { class: 'warn' }, 'Your account has no profile. Ask the organizer to check your invite.'));
  }
  // Players (linked to a player) start on Me, then Lineup, then Sign up, which few use. Everyone else keeps PAGES order.
  const playerFirst = me.role === 'player' && !!me.player_id;
  const PLAYER_ORDER = ['lineup', 'signup'];
  const pages = PAGES.filter(p => p.roles.includes(me.role) && (!p.club || 'player_id' in me))
    .sort((a, b) => playerFirst ? PLAYER_ORDER.indexOf(a.id) - PLAYER_ORDER.indexOf(b.id) : 0);
  // #player/12 opens a player's profile (not in the nav, except your own as "Me").
  const profileId = Number(location.hash.match(/^#player\/(\d+)$/)?.[1]) || (playerFirst && !pages.some(p => '#' + p.id === location.hash) ? me.player_id : null);
  const current = profileId ? { id: 'profile', view: () => profilePage(profileId) } : pages.find(p => '#' + p.id === location.hash) || pages[0];
  const meLink = () => nav.append(h('a', { href: `#player/${me.player_id}`, class: profileId === me.player_id ? 'on' : null }, 'Me'));
  if (playerFirst) meLink();
  if (pages.length > 1 || me.player_id) for (const p of pages) nav.append(h('a', { href: '#' + p.id, class: p === current ? 'on' : null }, typeof p.label === 'function' ? p.label(me.role) : p.label));
  if (me.player_id && !playerFirst) meLink();
  who.append(accountMenu());
  nav.querySelector('a.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  app.replaceChildren(h('p', { class: 'empty' }, 'Loading…'));
  try {
    app.replaceChildren(await current.view());
  } catch (e) {
    app.replaceChildren(h('p', { class: 'warn' }, `Something went wrong: ${e.message}`));
  }
}

setRender(render);
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
    if (error) { linkError = 'This link has expired or was already used. Ask the organizer for a new one.'; setSession(null); setMe(null); return render(); }
    setSession(data.session); setMe(null); mustSetPassword = true; render();
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
    setSession(data.session); render();
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

boot();
