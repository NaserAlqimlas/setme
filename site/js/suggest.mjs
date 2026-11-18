// Highlight and blooper suggestions from how loud it gets after each rally (players reacting). The video worker
// scores the sound (vision/worker/sound.py: dB over the sound around it, in tenths, every `hop` seconds); this picks
// the moments. Tried on seven tagged games (2026-11-18): the loudest rally ends were mostly kills and stuff blocks the
// super called highlights, and loud errors were often bloopers.
//
// Each rally is scored by the loudest moment from just before it ends to five seconds after. Then, per game:
//   highlights: kills, aces and stuff blocks (or any rally, in an untagged game) at least as loud as 70% of its rallies
//   bloopers:   errors at least as loud as 85% of its rallies
// in video order, skipping moments already kept or dismissed. There's no cap: every moment over the bar is suggested.

const HIGHLIGHT_SHARE = .7, BLOOPER_SHARE = .85;
const BEFORE = .5, AFTER = 5;            // seconds around a rally's end where the reaction is
const LEAD = 2, TAIL = 3;                // a suggested clip: from just before the rally to the reaction after it

// How a rally ended, from its last touch: 'big' (kill, ace, stuff block), 'error', or 'other'.
export function endOf(touch) {
  if (!touch) return 'other';
  if (touch.g === 0) return 'error';
  return touch.g === 3 && ['attack', 'serve', 'block'].includes(touch.a) ? 'big' : 'other';
}

// The rallies to score: tagged ones with video times (from the first to the last touch, with how they ended), or
// else the rallies the video analysis found (how they ended isn't known: kind null).
export function moments(tagged = [], found = []) {
  const timed = tagged.map(r => ({ r, ts: r.touches.filter(t => t.t != null) })).filter(x => x.ts.length);
  if (timed.length) return timed.map(({ r, ts }) => ({ start: ts[0].t, end: ts.at(-1).t, kind: endOf(r.touches.at(-1)), last: r.touches.at(-1) }));
  return found.map(r => ({ start: r.start, end: r.end, kind: null, last: null }));
}

// The loudest lift (dB) around time t, or null outside the sound.
export function liftAt(sound, t) {
  const hop = sound?.hop, lift = sound?.lift;
  if (!hop || !lift?.length) return null;
  const a = Math.max(0, Math.floor((t - BEFORE) / hop)), b = Math.min(lift.length - 1, Math.ceil((t + AFTER) / hop));
  if (a > b) return null;
  let top = -Infinity;
  for (let i = a; i <= b; i++) top = Math.max(top, lift[i]);
  return top / 10;
}

const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : Infinity; };

// -> { highlights: [moment], bloopers: [moment] }, each { start, end, t (rally end), lift, kind, last }, in video order.
// marks: highlights kept (any kind) [{ start, end }]; dismissed: [{ t, kind }].
export function suggest({ sound, moments: ms = [], marks = [], dismissed = [] }) {
  const scored = ms.map(m => ({ ...m, lift: liftAt(sound, m.end) })).filter(m => m.lift != null);
  if (!scored.length) return { highlights: [], bloopers: [] };
  const lifts = scored.map(m => m.lift);
  const hiBar = quantile(lifts, HIGHLIGHT_SHARE), bloBar = quantile(lifts, BLOOPER_SHARE);
  const clip = m => ({ ...m, t: m.end, start: Math.max(0, m.start - LEAD), end: m.end + TAIL });
  const free = (c, kind) => !marks.some(x => x.start < c.end && x.end > c.start) && !dismissed.some(d => d.kind === kind && Math.abs(d.t - c.t) < 2);
  const pick = (ok, bar, kind) => scored.filter(m => ok(m) && m.lift >= bar).map(clip).filter(c => free(c, kind))
    .sort((a, b) => a.start - b.start);
  return {
    highlights: pick(m => m.kind === 'big' || m.kind === null, hiBar, 'highlight'),
    bloopers: pick(m => m.kind === 'error', bloBar, 'blooper'),
  };
}

// "Kill · Ali", "Set error · Sara", for a suggestion's label (and the highlight's, once kept).
const WORD = { attack: ['Attack error', 'Blocked', 'Attack', 'Kill'], serve: ['Serve error', 'Serve', 'Tough serve', 'Ace'],
  block: ['Block error', 'Block touch', 'Block', 'Stuff block'], pass: ['Pass error', 'Pass', 'Pass', 'Pass'],
  set: ['Set error', 'Set', 'Set', 'Set'], dig: ['Missed dig', 'Dig', 'Dig', 'Dig'] };
export function momentLabel(m, nameOf = () => null) {
  if (!m.last) return null;
  const what = WORD[m.last.a]?.[m.last.g] ?? null, who = nameOf(m.last.p);
  return [what, who].filter(Boolean).join(' · ') || null;
}
