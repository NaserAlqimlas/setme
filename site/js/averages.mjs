// Club averages: where a player stands next to the rest of the club, for "am I above or below average?".
// Shared by the server (my-rating, my-stats, club-averages) and the pages (profile, All ratings).
//
// Middle and usual range rather than the mean: in a small club one very strong or very new player drags a mean
// around. mid: the median; low and high: the 1/3 and 2/3 points, so about a third of players sit below low, a third
// above high (band() says above, about or below). Ratings move in .25 steps, so bands
// rather than exact numbers are what to tell people.
// Only active players count, and a spread needs MIN_PLAYERS of them, so a club average never points at anyone.
import { ownRating } from './myrating.mjs';
import { metrics, tallyFromCounts } from './stats.mjs';
import { SKILLS, weightedTotal } from './teams.mjs';

export const MIN_PLAYERS = 6;
export const MIN_TAGGED_GAMES = 3;   // match stats count for a player once they have this many tagged games
const round = v => Math.round(v * 100) / 100;

// The value at fraction q of sorted xs (linear between neighbours).
function quantile(xs, q) {
  const i = (xs.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return xs[lo] + (xs[hi] - xs[lo]) * (i - lo);
}
// values -> { mid, low, high, n } or null with fewer than MIN_PLAYERS.
export function spread(values) {
  const xs = values.filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length < MIN_PLAYERS) return null;
  return { mid: round(quantile(xs, .5)), low: round(quantile(xs, 1 / 3)), high: round(quantile(xs, 2 / 3)), n: xs.length };
}
// 'above' | 'about' | 'below', or null when either is missing. Above: past the middle and at or past the upper
// third; below: the mirror. (Ratings tie a lot, so the thirds often sit on the middle itself.) lowerBetter for
// numbers where less is better.
export function band(v, s, lowerBetter = false) {
  if (v == null || !s) return null;
  const up = v > s.mid && v >= s.high, down = v < s.mid && v <= s.low;
  return up ? (lowerBetter ? 'below' : 'above') : down ? (lowerBetter ? 'above' : 'below') : 'about';
}
export const BAND_WORD = { above: 'Above average', about: 'About average', below: 'Below average' };

// Ratings: each active player's own numbers (ownRating: the plain average of what their raters gave, per skill,
// shown once two people rated it), plus Total (five main skills added, 0 to 5) and Weighted (as team building
// counts them, 0 to 5), as on their profile. players: active [{ id, name }], ratings: rows from active raters.
// -> { players: [{ id, name, skills, total, weighted }], club: { skills: { skill: spread }, total, weighted } }.
// Setting is compared among the players who have a setting number (setters) only.
export const RATING_SKILLS = [...SKILLS, 'setting_skill'];
export function ratingAverages(players, ratings) {
  const by = new Map(players.map(p => [p.id, []]));
  for (const r of ratings) by.get(r.player_id)?.push(r);
  const list = players.map(p => {
    const { skills } = ownRating(by.get(p.id)).current;
    const all = SKILLS.every(s => skills[s] != null);
    return { id: p.id, name: p.name, skills,
      total: all ? round(SKILLS.reduce((a, s) => a + skills[s], 0)) : null,
      weighted: all ? round(weightedTotal(skills)) : null };
  });
  return { players: list, club: {
    skills: Object.fromEntries(RATING_SKILLS.map(s => [s, spread(list.map(p => p.skills[s]))])),
    total: spread(list.map(p => p.total)), weighted: spread(list.map(p => p.weighted)) } };
}

// Match stats (the profile's tiles): per player from their player_stats row, for players with MIN_TAGGED_GAMES or
// more tagged games. rows: player_stats rows. -> { players: Map id -> metrics, club: { key: spread } }.
export const STAT_KEYS = ['aceRate', 'passAvg', 'killRate', 'attackEff', 'stuffsPerGame', 'digsPerGame', 'digAvg'];
export function statAverages(rows, active = null) {
  const tallies = tallyFromCounts(rows.filter(r => (r.games ?? 0) >= MIN_TAGGED_GAMES && (!active || active.has(Number(r.player_id)))));
  const players = new Map([...tallies].map(([id, t]) => [Number(id), metrics(t)]));
  return { players, club: Object.fromEntries(STAT_KEYS.map(k => [k, spread([...players.values()].map(m => m[k]))])) };
}
