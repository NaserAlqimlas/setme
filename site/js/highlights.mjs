// Marking highlights and bloopers (supabase/highlights.sql, suggestions.sql): under a game's video on Games, and on the
// tag screen while tagging. Everyone sees a game's list and its reels; the super marks them, either the rally playing
// now (a second either side) or from Start to End, and removes them. Times are in the game's uploaded video; a file
// of the same game opened on the tag screen has the same times.
// The super also gets suggestions (suggest.mjs): loud kills, aces and stuffs as highlights and loud errors as
// bloopers, from the sound after each rally. Keep makes one a highlight (or blooper); ✕ dismisses it for good.
import { ask, callFn, fill, h, me, q, sb, toast } from './ui.mjs';
import { playAt, rallyAt } from './rallytimes.mjs';
import { momentLabel, suggest } from './suggest.mjs';

const clock = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const NAME = { highlight: 'highlight', blooper: 'blooper' };

// A <video> as highlightBox drives it.
export const videoControl = v => ({ now: () => v.currentTime, seek: t => playAt(v, t), play: () => { if (v.paused) v.play().catch(() => {}); }, duration: () => v.duration });

// g: { id, session_id }. ctl: { now(), seek(t), play?(), duration?() }. times(): the rallies found, [{ start, end }].
// list: the game's highlights and bloopers [{ id, start, end, label, kind }], or null before highlights.sql.
// opts.reel: show links to the game's reels. opts.suggestions(): { sound, moments, dismissed } for the super's
// suggestions (dismissed null before suggestions.sql: none shown). opts.nameOf(player id): for labels.
// The box has .hotkey(kind), for the tag screen's H (highlight) and Shift H (blooper): this rally if one is
// playing, else Start, then End.
export function highlightBox(g, ctl, times, list, { reel = true, suggestions = null, nameOf = () => null } = {}) {
  const sup = me.role === 'super';
  if (list == null) return sup ? h('p', { class: 'muted small' }, 'Highlights: run supabase/highlights.sql in Supabase to mark them.') : null;
  const box = h('div', { class: 'gd-highlights' });
  let marks = list.map(m => ({ kind: 'highlight', ...m })), from = null, scoring = false;
  const base = suggestions?.();
  let dismissed = base?.dismissed ? [...base.dismissed] : null;
  const kinded = dismissed != null;   // suggestions.sql has been run: bloopers and suggestions work

  const save = async (start, end, kind = 'highlight', extra = {}) => {
    if (end - start < 1) return toast('A highlight needs at least a second. Play a little further, then tap End.');
    if (kind !== 'highlight' && !kinded) return toast('Bloopers need supabase/suggestions.sql run in Supabase first.');
    try {
      const row = await q(sb.from('highlights').insert({ game_id: g.id, start_t: Math.round(start * 10) / 10, end_t: Math.round(end * 10) / 10,
        ...(kind !== 'highlight' ? { kind } : {}), ...extra }).select().single());
      marks = [...marks, { id: row.id, start: Number(row.start_t), end: Number(row.end_t), label: row.label, kind: row.kind ?? 'highlight' }].sort((a, b) => a.start - b.start);
      toast(`${kind === 'blooper' ? 'Blooper' : 'Highlight'} saved (${clock(start)}–${clock(end)})`); paint();
    } catch (e) { toast(/highlights/.test(e.message) ? 'Run supabase/highlights.sql in Supabase first.' : e.message); }
  };
  const remove = async m => {
    if (!await ask(`Remove this ${NAME[m.kind]}?`, `${clock(m.start)}–${clock(m.end)} leaves the ${NAME[m.kind]} reel.`, 'Remove')) return;
    try { await q(sb.from('highlights').delete().eq('id', m.id)); marks = marks.filter(x => x.id !== m.id); paint(); }
    catch (e) { toast(e.message); }
  };
  const flip = async m => {
    const kind = m.kind === 'blooper' ? 'highlight' : 'blooper';
    try { await q(sb.from('highlights').update({ kind }).eq('id', m.id)); m.kind = kind; paint(); }
    catch (e) { toast(e.message); }
  };
  const playing = () => { const ts = times() ?? []; const i = rallyAt(ts, ctl.now()); return i < 0 ? null : ts[i]; };
  const thisRally = (kind = 'highlight') => {
    const r = playing();
    if (!r) return toast('Not in a rally right now. Use Start and End instead.');
    save(Math.max(0, r.start - 1), Math.min(ctl.duration?.() || Infinity, r.end + 1), kind);
  };
  const start = (kind = 'highlight') => { from = { t: ctl.now(), kind }; ctl.play?.(); paint(); };
  const end = () => { const f = from; from = null; paint(); save(f.t, ctl.now(), f.kind); };

  // ----- suggestions (the super) -----
  const keep = (c, kind) => save(c.start, c.end, kind, { label: momentLabel(c, nameOf), suggested: true, lift: Math.round(c.lift * 10) / 10 });
  const dismiss = async (c, kind) => {
    try {
      await q(sb.from('highlight_dismissed').insert({ game_id: g.id, t: Math.round(c.t * 10) / 10, kind, lift: Math.round(c.lift * 10) / 10 }));
      dismissed = [...dismissed, { t: c.t, kind }]; paint();
    } catch (e) { toast(e.message); }
  };
  const scoreSound = async btn => {
    btn.disabled = true;
    try {
      const { started } = await callFn('video', { action: 'sound', games: [g.id] });
      scoring = true; paint();
      if (!started) toast('Nothing to score: this game has no finished upload.');
    } catch (e) { toast(e.message); btn.disabled = false; }
  };
  const suggestionRows = () => {
    if (!sup || !kinded) return null;
    const s = suggestions();
    if (!s.sound) {
      const btn = h('button', { class: 'ghost sm' }, 'Score the sound');
      btn.onclick = () => scoreSound(btn);
      return h('div', { class: 'gd-suggest' }, h('p', { class: 'muted small' }, scoring
        ? 'Scoring the sound. It takes a minute or two: open this game again to see suggestions.'
        : 'Suggestions come from how loud players get after each rally. This video was uploaded before that.'), !scoring && btn);
    }
    const { highlights, bloopers } = suggest({ sound: s.sound, moments: s.moments, marks, dismissed });
    const row = (c, kind) => h('li', {},
      h('button', { type: 'button', class: 'linkish', title: 'Watch it', onclick: () => ctl.seek(c.start) }, `▶ ${clock(c.t)}`),
      h('span', { class: 'small' }, momentLabel(c, nameOf) ?? (kind === 'blooper' ? 'Loud error' : 'Loud reaction')),
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'ghost sm', onclick: () => keep(c, kind) }, 'Keep'),
      h('button', { type: 'button', class: 'ghost sm up-icon', 'aria-label': `Not a ${NAME[kind]}`, title: `Not a ${NAME[kind]}: don't suggest it again`, onclick: () => dismiss(c, kind) }, '✕'));
    if (!highlights.length && !bloopers.length) return h('p', { class: 'muted small gd-suggest' }, s.moments.length ? 'No more suggestions for this game.' : 'Suggestions appear once the rallies are found or tagged.');
    return h('div', { class: 'gd-suggest' },
      highlights.length > 0 && [h('p', { class: 'small' }, h('b', {}, 'Suggested highlights'), h('span', { class: 'muted' }, ' · the loudest reactions to kills, aces and blocks')),
        h('ul', { class: 'gd-sug-list' }, highlights.map(c => row(c, 'highlight')))],
      bloopers.length > 0 && [h('p', { class: 'small' }, h('b', {}, 'Possible bloopers'), h('span', { class: 'muted' }, ' · loud reactions to errors')),
        h('ul', { class: 'gd-sug-list' }, bloopers.map(c => row(c, 'blooper')))]);
  };

  const paint = () => {
    const hl = marks.filter(m => m.kind !== 'blooper').length, bl = marks.length - hl;
    fill(box,
      h('div', { class: 'row', style: 'flex-wrap:wrap;gap:8px;align-items:center' },
        h('b', {}, hl ? `★ Highlights (${hl})` : '★ Highlights'), bl > 0 && h('b', {}, `· Bloopers (${bl})`),
        reel && hl > 0 && h('a', { class: 'ghost sm button', href: `#reel/${g.session_id}/${g.id}` }, '▶ Play them'),
        reel && bl > 0 && h('a', { class: 'ghost sm button', href: `#bloopers/${g.session_id}/${g.id}` }, '▶ Bloopers'),
        h('span', { class: 'grow' }),
        sup && (times() ?? []).length > 0 && from == null && h('button', { class: 'ghost sm', title: 'Save the rally playing now, with a second either side', onclick: () => thisRally() }, '★ This rally'),
        sup && (from == null
          ? h('button', { class: 'ghost sm', title: 'Start a highlight here, then tap End where it stops', onclick: () => start() }, '☆ Start')
          : [h('button', { class: 'sm', onclick: end }, `■ End ${from.kind === 'blooper' ? 'blooper ' : ''}(from ${clock(from.t)})`),
            h('button', { class: 'ghost sm', onclick: () => { from = null; paint(); } }, 'Cancel')])),
      marks.length > 0 && h('ul', { class: 'gd-hl-list' }, marks.map(m => h('li', { class: m.kind === 'blooper' ? 'blooper' : null },
        h('button', { type: 'button', class: 'linkish', onclick: () => ctl.seek(m.start) }, `${m.kind === 'blooper' ? '🙈 ' : ''}${clock(m.start)}–${clock(m.end)}`),
        m.label && h('span', { class: 'muted small' }, ` ${m.label}`),
        sup && kinded && h('button', { type: 'button', class: 'ghost sm up-icon', title: m.kind === 'blooper' ? 'Make it a highlight' : 'Make it a blooper',
          'aria-label': `${m.kind === 'blooper' ? 'Make it a highlight' : 'Make it a blooper'}: ${clock(m.start)}`, onclick: () => flip(m) }, '⇄'),
        sup && h('button', { type: 'button', class: 'ghost sm up-icon', 'aria-label': `Remove the ${NAME[m.kind]} at ${clock(m.start)}`, onclick: () => remove(m) }, '✕')))),
      !marks.length && !sup && h('p', { class: 'muted small', style: 'margin:4px 0 0' }, 'No highlights from this game yet.'),
      !marks.length && sup && !kinded && h('p', { class: 'muted small', style: 'margin:4px 0 0' }, 'Mark the best moments: they play back to back in the game\'s and the day\'s highlight reel.'),
      suggestionRows());
  };
  paint();
  box.refresh = paint;
  box.hotkey = (kind = 'highlight') => {
    if (!sup) return;
    if (from != null) end(); else if (playing()) thisRally(kind); else start(kind);
  };
  return box;
}
