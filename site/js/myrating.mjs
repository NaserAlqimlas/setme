// A player's own rating, for their profile: the plain average of what everyone rated them, per skill and overall,
// and how it moved over time. Worked out on the server (my-rating function); only numbers leave it, never who rated,
// how many rated, or any one rater's values.
//
// A skill shows once at least MIN_RATERS people have given it a number (U doesn't count). Overall needs that for every
// main skill and weighs them like team building (WEIGHTS), on the same 0 to 1 scale as the ratings.
// History replays rating_history day by day (UTC): one point per day on which the visible numbers changed.
import { SKILLS, WEIGHTS } from './teams.mjs';

export const MIN_RATERS = 2;
export const SHOWN = ['receiving', 'hitting', 'hustle', 'serve', 'blocking', 'setting_skill', 'consistency'];
const round = v => Math.round(v * 100) / 100;

// state: Map "rater|skill" -> number|null  ->  { overall, skills: { skill: number|null } }
function snapshot(state) {
  const vals = new Map(SHOWN.map(s => [s, []]));
  for (const [k, v] of state) { const s = k.slice(k.indexOf('|') + 1); if (v != null && vals.has(s)) vals.get(s).push(Number(v)); }
  const skills = Object.fromEntries(SHOWN.map(s => { const a = vals.get(s); return [s, a.length >= MIN_RATERS ? round(a.reduce((x, y) => x + y, 0) / a.length) : null]; }));
  const wsum = SKILLS.reduce((a, s) => a + WEIGHTS[s], 0);
  const overall = SKILLS.every(s => skills[s] != null) ? round(SKILLS.reduce((a, s) => a + WEIGHTS[s] * skills[s], 0) / wsum) : null;
  return { overall, skills };
}
const same = (a, b) => a.overall === b.overall && SHOWN.every(s => a.skills[s] === b.skills[s]);

// ratings: this player's rows [{ rater_id, receiving.. }]; history: this player's rating_history rows.
// -> { current: { overall, skills }, history: [{ date: 'YYYY-MM-DD' | null, overall, skills }] } (oldest first;
// date null = how it stood before the first recorded change).
export function ownRating(ratings, history = []) {
  const now = new Map();
  for (const r of ratings) for (const s of SHOWN) now.set(`${r.rater_id}|${s}`, r[s] ?? null);
  const current = snapshot(now);

  // Start from each rater-skill's value before its first recorded change; pairs never changed keep today's value.
  const events = [...history].filter(e => SHOWN.includes(e.skill)).sort((a, b) => String(a.changed_at).localeCompare(String(b.changed_at)));
  const state = new Map(now);
  const seen = new Set();
  for (const e of events) { const k = `${e.rater_id}|${e.skill}`; if (!seen.has(k)) { seen.add(k); state.set(k, e.old_value ?? null); } }

  const points = [];
  const push = (date) => {
    const p = snapshot(state);
    const last = points[points.length - 1];
    if (p.overall == null && !SHOWN.some(s => p.skills[s] != null)) return;
    if (last && same(last, p)) return;
    points.push({ date, ...p });
  };
  push(null);
  for (let i = 0; i < events.length;) {
    const day = String(events[i].changed_at).slice(0, 10);
    for (; i < events.length && String(events[i].changed_at).slice(0, 10) === day; i++) state.set(`${events[i].rater_id}|${events[i].skill}`, events[i].new_value ?? null);
    push(day);
  }
  return { current, history: points };
}
