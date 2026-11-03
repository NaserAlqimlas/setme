// Game results vs what the team builder predicted. Pure functions, shared by the Scores page and tests.
// A game: { session_id, team_a, team_b, players_a, players_b, score_a, score_b, predicted: { a, b } }
// predicted.a / .b: { weighted, sums: { receiving, …, setting }, size, women, setters, unrated } at the time it was saved.
import { SKILLS, WEIGHTS } from './teams.mjs';

export const TARGET = 25;
// Games stopped early (time up) are scaled to a game to 25, so 12-8 counts like 25-17 (rounded only for display).
export const margin25 = (a, b) => { const top = Math.max(a, b); return top >= TARGET ? a - b : top ? (a - b) * TARGET / top : 0; };
export const finished = g => Math.max(g.score_a, g.score_b) >= TARGET;
export const CLOSE = 3, BLOWOUT = 10;

// Predicted gap: team A's weighted total minus team B's.
export const gapOf = g => g.predicted ? g.predicted.a.weighted - g.predicted.b.weighted : null;

// What can differ between the two teams, as A minus B.
export const FACTORS = [
  ...SKILLS.map(s => ({ key: s, label: s[0].toUpperCase() + s.slice(1), get: t => t.sums[s] })),
  { key: 'setting', label: 'Setting (all-game setters)', get: t => t.sums.setting ?? 0 },
  { key: 'size', label: 'Team size', get: t => t.size },
  { key: 'women', label: 'Women', get: t => t.women },
  { key: 'setters', label: 'Main setters', get: t => t.setters },
];

const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
function corr(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

// Solve A x = b (small, symmetric positive definite) by Gaussian elimination.
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (!M[c][c]) return null;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

export const PRIOR_GAMES = 20; // the fitted weights lean on the current ones as if they'd been seen in this many games
export const MIN_FIT = 30;     // fewer games than this: don't suggest weights

export function analyze(games) {
  const gs = games.filter(g => g.predicted && g.score_a != null && g.score_b != null && (g.score_a || g.score_b));
  const rows = gs.map(g => ({ g, m: margin25(g.score_a, g.score_b), gap: gapOf(g) }));
  const n = rows.length;
  const abs = rows.map(r => Math.abs(r.m));
  // Points per unit of predicted gap (a line through zero), and how well the gap lines up with the margin.
  const sxx = rows.reduce((a, r) => a + r.gap ** 2, 0);
  const k = sxx ? rows.reduce((a, r) => a + r.gap * r.m, 0) / sxx : 0;
  const called = rows.filter(r => Math.abs(r.gap) >= .05 && r.m !== 0);
  const out = {
    n, sessions: new Set(gs.map(g => g.session_id)).size,
    avgMargin: n ? mean(abs) : null,
    close: n ? abs.filter(m => m <= CLOSE).length / n : null,
    blowouts: n ? abs.filter(m => m >= BLOWOUT).length / n : null,
    favWon: called.length ? called.filter(r => Math.sign(r.gap) === Math.sign(r.m)).length / called.length : null,
    called: called.length,
    k, r: n > 2 ? corr(rows.map(r => r.gap), rows.map(r => r.m)) : null,
    rows,
  };
  // How each difference between teams lines up with the margin.
  out.factors = FACTORS.map(f => {
    const xs = rows.map(r => f.get(r.g.predicted.a) - f.get(r.g.predicted.b));
    return { ...f, r: n > 2 ? corr(xs, rows.map(r => r.m)) : null, spread: n ? Math.sqrt(mean(xs.map(x => x * x))) : 0 };
  });
  out.weights = n >= MIN_FIT ? fitWeights(rows, k) : null;
  return out;
}

// Margin ≈ Σ β_s × (skill sum difference), pulled towards the current weights (scaled by k) as if they'd been
// seen in PRIOR_GAMES games. Returned on the current weights' scale, so they read side by side.
function fitWeights(rows, k) {
  const X = rows.map(r => SKILLS.map(s => r.g.predicted.a.sums[s] - r.g.predicted.b.sums[s]));
  const y = rows.map(r => r.m);
  const p = SKILLS.length, n = rows.length;
  const XtX = SKILLS.map((_, i) => SKILLS.map((_, j) => X.reduce((a, x) => a + x[i] * x[j], 0)));
  const Xty = SKILLS.map((_, i) => X.reduce((a, x, r) => a + x[i] * y[r], 0));
  const lam = mean(XtX.map((r, i) => r[i])) * PRIOR_GAMES / n;
  const scale = k > 0 ? k : 1;
  const prior = SKILLS.map(s => WEIGHTS[s] * scale);
  const beta = solve(XtX.map((r, i) => r.map((v, j) => v + (i === j ? lam : 0))), Xty.map((v, i) => v + lam * prior[i]));
  if (!beta) return null;
  const total = SKILLS.reduce((a, s) => a + WEIGHTS[s], 0), got = beta.reduce((a, b) => a + b, 0);
  if (!(got > 0)) return null;
  return Object.fromEntries(SKILLS.map((s, i) => [s, beta[i] * total / got]));
}

// Per player (super only on the page): games, wins, average margin for their team, and how much better their
// teams did than predicted (margin minus k × gap, from their team's side).
export function playerStats(games, k) {
  const by = new Map();
  for (const g of games) {
    if (!g.predicted || !(g.score_a || g.score_b)) continue;
    const m = margin25(g.score_a, g.score_b), gap = gapOf(g);
    for (const [ids, sign] of [[g.players_a, 1], [g.players_b, -1]]) for (const id of ids ?? []) {
      const s = by.get(id) ?? { id, games: 0, wins: 0, margin: 0, over: 0 };
      s.games++; s.wins += sign * m > 0 ? 1 : 0; s.margin += sign * m; s.over += sign * (m - k * gap);
      by.set(id, s);
    }
  }
  return [...by.values()].map(s => ({ ...s, margin: s.margin / s.games, over: s.over / s.games }));
}

// Which two teams play next: round robin (circle method), so with 4 teams it goes 1v2 3v4, 1v3 2v4, 1v4 2v3 and repeats.
// Suggests the first pairing that has been played the fewest times and doesn't involve a team already playing.
export function nextPairing(numTeams, games, busy = []) {
  if (numTeams < 2) return null;
  const ids = [...Array(numTeams).keys()].map(i => i + 1);
  if (numTeams % 2) ids.push(null);
  const rounds = [];
  const m = ids.length;
  // Start with 1v2, 3v4, 5v6 (the courts on the share image): arr[i] plays arr[m - 1 - i].
  let arr = Array(m);
  for (let i = 0; i < m / 2; i++) { arr[i] = ids[2 * i]; arr[m - 1 - i] = ids[2 * i + 1]; }
  for (let r = 0; r < m - 1; r++) {
    for (let i = 0; i < m / 2; i++) { const a = arr[i], b = arr[m - 1 - i]; if (a && b) rounds.push(a < b ? [a, b] : [b, a]); }
    arr = [arr[0], arr[m - 1], ...arr.slice(1, m - 1)];
  }
  const key = (a, b) => a < b ? `${a}-${b}` : `${b}-${a}`;
  const count = new Map();
  for (const g of games) count.set(key(g.team_a, g.team_b), (count.get(key(g.team_a, g.team_b)) ?? 0) + 1);
  const free = rounds.filter(([a, b]) => !busy.includes(a) && !busy.includes(b));
  if (!free.length) return rounds[0];
  const least = Math.min(...free.map(([a, b]) => count.get(key(a, b)) ?? 0));
  return free.find(([a, b]) => (count.get(key(a, b)) ?? 0) === least);
}
