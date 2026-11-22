// Settings (#settings, from the account menu): which club emails you get (supabase/emails.sql). Everyone who may
// watch a game (organizers, the super, players and raters once its day is published) gets an email when its video is up and
// when its stats are up, unless they turn that one off here. No row in email_prefs: both on.
import { h, missing, needsUpgrade, pageHead, q, sb, session, toast, toggle } from '../ui.mjs';

export async function settingsPage() {
  const head = pageHead('Settings', 'Choose which emails SetMe sends you.');
  const uid = session.user.id;
  let row;
  try { [row] = await q(sb.from('email_prefs').select('videos,tags').eq('user_id', uid)); }
  catch (e) { return h('div', {}, head, missing(e) ? needsUpgrade('Email settings', 'supabase/emails.sql') : h('p', { class: 'warn' }, e.message)); }
  const prefs = { videos: row?.videos ?? true, tags: row?.tags ?? true };
  const set = key => async v => {
    try { await q(sb.from('email_prefs').upsert({ user_id: uid, ...prefs, [key]: v, updated_at: new Date().toISOString() })); prefs[key] = v; toast(v ? 'Email on' : 'Email off'); }
    catch (e) { toast(e.message); return false; }
  };
  return h('div', {}, head,
    h('div', { class: 'card' }, h('h3', {}, 'Emails'),
      h('p', { class: 'muted small' }, `Sent to ${session.user.email}.`),
      h('div', { class: 'settings-list' },
        h('div', {}, toggle('A game\'s video is up', prefs.videos, set('videos')),
          h('p', { class: 'muted small' }, 'When a game you can watch has its video ready.')),
        h('div', {}, toggle('A game\'s stats are up', prefs.tags, set('tags')),
          h('p', { class: 'muted small' }, 'When a game has been tagged touch by touch and its stats and box score are on Games.')))));
}
