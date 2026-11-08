import { ask, avatar, callFn, downloadFile, h, me, missing, pageHead, q, render, sb, seg, toast, today } from '../ui.mjs';
import { other } from '../stats.mjs';
import { dayTitle } from './teams.mjs';

// Users page (super): accounts, backup, activity.

// ---------- users (super) ----------
// Accounts, their roles, and (after the club upgrade) which player each one is. Linking is done here by the super,
// never by the person, so nobody has to find themselves in a list.
export async function usersPage() {
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
    pageHead('Users', 'Players sign up, see published teams and their own average rating. Raters also rate. Organizers also run Players, Teams and Scores, but never see ratings.'),
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
