// Marking highlights (supabase/highlights.sql): under a game's video on Games, and on the tag screen while tagging.
// Everyone sees a game's list and its reel; the super marks them, either the rally playing now (a second either side)
// or from Start to End, and removes them. Times are in the game's uploaded video; a file of the same game opened on
// the tag screen has the same times.
import { ask, fill, h, me, q, sb, toast } from './ui.mjs';
import { playAt, rallyAt } from './rallytimes.mjs';

const clock = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// A <video> as highlightBox drives it.
export const videoControl = v => ({ now: () => v.currentTime, seek: t => playAt(v, t), play: () => { if (v.paused) v.play().catch(() => {}); }, duration: () => v.duration });

// g: { id, session_id }. ctl: { now(), seek(t), play?(), duration?() }. times(): the rallies found, [{ start, end }].
// list: the game's highlights, or null before highlights.sql. reel: show the link to the game's reel.
// The box has .hotkey(), for the tag screen's H: this rally if one is playing, else Start, then End.
export function highlightBox(g, ctl, times, list, { reel = true } = {}) {
  const sup = me.role === 'super';
  if (list == null) return sup ? h('p', { class: 'muted small' }, 'Highlights: run supabase/highlights.sql in Supabase to mark them.') : null;
  const box = h('div', { class: 'gd-highlights' });
  let marks = [...list], from = null;
  const save = async (start, end) => {
    if (end - start < 1) return toast('A highlight needs at least a second. Play a little further, then tap End.');
    try {
      const row = await q(sb.from('highlights').insert({ game_id: g.id, start_t: Math.round(start * 10) / 10, end_t: Math.round(end * 10) / 10 }).select().single());
      marks = [...marks, { id: row.id, start: Number(row.start_t), end: Number(row.end_t), label: row.label }].sort((a, b) => a.start - b.start);
      toast(`Highlight saved (${clock(start)}–${clock(end)})`); paint();
    } catch (e) { toast(/highlights/.test(e.message) ? 'Run supabase/highlights.sql in Supabase first.' : e.message); }
  };
  const remove = async m => {
    if (!await ask('Remove this highlight?', `${clock(m.start)}–${clock(m.end)} leaves the reel.`, 'Remove')) return;
    try { await q(sb.from('highlights').delete().eq('id', m.id)); marks = marks.filter(x => x.id !== m.id); paint(); }
    catch (e) { toast(e.message); }
  };
  const playing = () => { const ts = times() ?? []; const i = rallyAt(ts, ctl.now()); return i < 0 ? null : ts[i]; };
  const thisRally = () => {
    const r = playing();
    if (!r) return toast('Not in a rally right now. Use Start and End instead.');
    save(Math.max(0, r.start - 1), Math.min(ctl.duration?.() || Infinity, r.end + 1));
  };
  const start = () => { from = ctl.now(); ctl.play?.(); paint(); };
  const end = () => { const s0 = from; from = null; paint(); save(s0, ctl.now()); };
  const paint = () => fill(box,
    h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;align-items:center' },
      h('b', {}, marks.length ? `★ Highlights (${marks.length})` : '★ Highlights'),
      reel && marks.length > 0 && h('a', { class: 'ghost sm button', href: `#reel/${g.session_id}/${g.id}` }, '▶ Play them'),
      h('span', { class: 'grow' }),
      sup && (times() ?? []).length > 0 && from == null && h('button', { class: 'ghost sm', title: 'Save the rally playing now, with a second either side', onclick: thisRally }, '★ This rally'),
      sup && (from == null
        ? h('button', { class: 'ghost sm', title: 'Start a highlight here, then tap End where it stops', onclick: start }, '☆ Start')
        : [h('button', { class: 'sm', onclick: end }, `■ End (from ${clock(from)})`),
          h('button', { class: 'ghost sm', onclick: () => { from = null; paint(); } }, 'Cancel')])),
    marks.length > 0 && h('ul', { class: 'gd-hl-list' }, marks.map(m => h('li', {},
      h('button', { type: 'button', class: 'linkish', onclick: () => ctl.seek(m.start) }, `${clock(m.start)}–${clock(m.end)}`),
      m.label && h('span', { class: 'muted small' }, ` ${m.label}`),
      sup && h('button', { type: 'button', class: 'ghost sm up-icon', 'aria-label': `Remove the highlight at ${clock(m.start)}`, onclick: () => remove(m) }, '✕')))),
    !marks.length && h('p', { class: 'muted small', style: 'margin:4px 0 0' }, sup ? 'Mark the best moments: they play back to back in the game\'s and the day\'s highlight reel.' : 'No highlights from this game yet.'));
  paint();
  box.hotkey = () => { if (!sup) return; if (from != null) end(); else if (playing()) thisRally(); else start(); };
  return box;
}
