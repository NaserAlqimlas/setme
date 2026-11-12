// What to work on, for a player's own profile: one strength and up to two things to work on, from their tagged match
// stats compared with the club average, and from their ratings where stats can't say.
//
// Stats: an action counts once the player has MIN_TOUCHES of it and the club average for it rests on at least
// MIN_OTHERS other players (my-stats sends the club totals only then). Each action is judged two ways, average grade
// (0 to 3) and how often it's an error, each as a gap from the club in the club's own spread, so serves and blocks
// compare fairly. The bigger gap speaks for the action; gaps under GAP are too small to mention.
// Ratings: for skills the stats don't cover (hustle, consistency, or not enough touches yet), a skill well above or
// below the player's own average skill. When stats and ratings disagree about a skill, it isn't mentioned at all.
import { ACTIONS } from './stats.mjs';

export const MIN_TOUCHES = 10;
export const MIN_OTHERS = 4;
export const GAP = .25;          // in club spreads (standard deviations)
export const RATING_GAP = .15;   // on the 0 to 1 rating scale

// Which skill (and rating guide) each action belongs to.
export const SKILL_OF = { serve: 'serve', pass: 'receiving', set: 'setting_skill', attack: 'hitting', block: 'blocking', dig: 'receiving' };
export const NAME = { serve: 'serve', pass: 'serve receive', set: 'setting', attack: 'attacking', block: 'blocking', dig: 'digging' };
const NOUN = { serve: ['serve', 'serves'], pass: ['serve receive', 'serve receives'], set: ['set', 'sets'], attack: ['attack', 'attacks'], block: ['block', 'blocks'], dig: ['dig', 'digs'] };

const total = c => Object.values(c).reduce((a, b) => a + b, 0);
const mean = c => Object.entries(c).reduce((s, [g, k]) => s + g * k, 0) / total(c);
const spread = c => { const m = mean(c); return Math.sqrt(Object.entries(c).reduce((s, [g, k]) => s + k * (g - m) ** 2, 0) / total(c)); };
const oneIn = p => p === 0 ? 'none' : `1 in ${Math.max(1, Math.round(1 / p))}`;
const two = v => (Math.round(v * 10) / 10).toFixed(1);

// One action, mine vs the club: { action, skill, gap, kind: 'avg' | 'err', mine, club, n } or null when it can't be judged.
function judge(action, mine, club) {
  const n = total(mine), cn = total(club);
  if (n < MIN_TOUCHES || !cn) return null;
  const out = [];
  const sd = spread(club);
  if (sd > 0) out.push({ kind: 'avg', gap: (mean(mine) - mean(club)) / sd, mine: mean(mine), club: mean(club) });
  const p = (mine[0] ?? 0) / n, cp = (club[0] ?? 0) / cn;
  if (cp > 0 && cp < 1) out.push({ kind: 'err', gap: (cp - p) / Math.sqrt(cp * (1 - cp)), mine: p, club: cp });
  if (!out.length) return null;
  const best = out.reduce((a, b) => Math.abs(b.gap) > Math.abs(a.gap) ? b : a);
  return { action, skill: SKILL_OF[action], n, ...best };
}

// The club's totals without this player, from player_stats rows: { action: { grade: count } }, only for actions at
// least MIN_OTHERS other players have touches of, so the average never stands for one or two people.
export function clubCounts(rows, pid) {
  const out = {};
  for (const [a, d] of Object.entries(ACTIONS)) {
    const others = rows.filter(r => Number(r.player_id) !== Number(pid) && d.grades.some(([g]) => r[`${a}_${g}`] > 0));
    if (others.length < MIN_OTHERS) continue;
    out[a] = Object.fromEntries(d.grades.map(([g]) => [g, others.reduce((s, r) => s + (r[`${a}_${g}`] ?? 0), 0)]));
  }
  return out;
}

// The sentence for one finding. The verdict (strength or work on) is shown beside it, so the sentence just gives the numbers.
export function sentence(f) {
  if (f.from === 'rating') return f.good ? `Raters see ${f.label.toLowerCase()} as your strongest skill.` : `Raters see ${f.label.toLowerCase()} as your area to grow.`;
  const [one, many] = NOUN[f.action];
  const head = NAME[f.action][0].toUpperCase() + NAME[f.action].slice(1);
  const detail = f.kind === 'avg'
    ? `you average ${two(f.mine)} out of 3; the club averages ${two(f.club)}`
    : `${oneIn(f.mine)} of your ${many} ${f.mine ? 'is an error' : 'were errors'}; for the club it's ${oneIn(f.club)}`;
  return `${head}: ${detail}. From ${f.n} ${f.n === 1 ? one : many}.`;
}

// mine: { action: { grade: count } } (the player's tally counts); club: the same for everyone else, with only the actions
// the club average can speak for; skills: the player's average rating per skill (0 to 1, null = not enough ratings);
// labels: skill -> name; shown: the skills that apply to this player.
// -> { strength: finding | null, focus: [finding] } where finding = { from: 'stats' | 'rating', skill, good, ... }
export function focusAreas({ mine = {}, club = {}, skills = {}, labels = {}, shown = Object.keys(skills) }) {
  const stats = Object.keys(ACTIONS).map(a => mine[a] && club[a] ? judge(a, mine[a], club[a]) : null).filter(Boolean);
  const covered = new Set(stats.map(f => f.skill));

  // Ratings: skills well above or below the player's own average.
  const rated = shown.filter(s => skills[s] != null);
  const avg = rated.length >= 3 ? rated.reduce((a, s) => a + skills[s], 0) / rated.length : null;
  const ratingSays = s => avg == null || skills[s] == null ? 0 : skills[s] - avg >= RATING_GAP ? 1 : avg - skills[s] >= RATING_GAP ? -1 : 0;

  const found = [];
  for (const f of stats) {
    if (Math.abs(f.gap) < GAP) continue;
    const good = f.gap > 0;
    if (ratingSays(f.skill) === (good ? -1 : 1)) continue;  // stats and ratings disagree: say nothing
    found.push({ from: 'stats', good, ...f });
  }
  for (const s of rated) {
    if (covered.has(s)) continue;
    const say = ratingSays(s);
    if (say) found.push({ from: 'rating', skill: s, label: labels[s] ?? s, good: say > 0, gap: (skills[s] - avg) / RATING_GAP * GAP });
  }
  // Stats first, then the biggest gap.
  const order = (a, b) => (a.from === 'stats' ? 0 : 1) - (b.from === 'stats' ? 0 : 1) || Math.abs(b.gap) - Math.abs(a.gap);
  const strength = found.filter(f => f.good).sort(order)[0] ?? null;
  const focus = found.filter(f => !f.good).sort(order).slice(0, 2);
  return { strength, focus };
}
