// Team builder shared by the Netlify function (server) and the super's Ratings page (browser).
// Ratings are 0..1 in .25 steps; null means unknown (U).

export const SKILLS = ['receiving', 'hitting', 'hustle', 'serve', 'blocking'];
export const WEIGHTS = { receiving: 1.5, hitting: 1.25, hustle: .75, serve: 1, blocking: .5 };
// Stand-in levels for players nobody has rated: the group's lower quartile, average and upper quartile.
export const TIERS = ['beginner', 'average', 'strong'];
const MIN_RATINGS_FOR_OFFSET = 5; // a rater needs this many shared ratings in a skill before we adjust for them

// Combine every rater's ratings into one value per player per skill.
// Each rating is treated as the player's level plus the rater's lean (some rate high, some low). Leans are
// fitted per skill from players that 2+ people rated, centred so the average rater has none, then taken out,
// so a generous or harsh rater doesn't skew players only they have rated.
export function combineRatings(players, ratings) {
  const byPlayer = new Map(players.map(p => [p.id, []]));
  for (const r of ratings) byPlayer.get(r.player_id)?.push(r);
  const raterIds = [...new Set(ratings.filter(r => byPlayer.has(r.player_id)).map(r => r.rater_id))];

  const offsets = new Map(raterIds.map(id => [id, {}]));
  // Per rater per skill: shared = ratings on players someone else also rated; miss = typical distance from the fit.
  const raters = new Map(raterIds.map(id => [id, { shared: {}, miss: {}, applied: {} }]));
  for (const s of SKILLS) {
    const entries = [];
    for (const [pid, rs] of byPlayer) {
      const vs = rs.filter(r => r[s] != null);
      if (vs.length > 1) for (const r of vs) entries.push({ pid, rid: r.rater_id, v: Number(r[s]) });
    }
    const n = new Map(raterIds.map(id => [id, 0]));
    for (const e of entries) n.set(e.rid, n.get(e.rid) + 1);
    const fitted = raterIds.filter(id => n.get(id) >= MIN_RATINGS_FOR_OFFSET);
    const lean = new Map(raterIds.map(id => [id, 0]));
    const level = new Map();
    for (let it = 0; it < 50; it++) {
      const acc = new Map();
      for (const e of entries) { const a = acc.get(e.pid) ?? [0, 0]; a[0] += e.v - lean.get(e.rid); a[1]++; acc.set(e.pid, a); }
      for (const [pid, [sum, k]] of acc) level.set(pid, sum / k);
      if (!fitted.length) break;
      const sums = new Map(fitted.map(id => [id, 0]));
      for (const e of entries) if (sums.has(e.rid)) sums.set(e.rid, sums.get(e.rid) + e.v - level.get(e.pid));
      const raw = fitted.map(id => sums.get(id) / n.get(id));
      const centre = avg(raw);
      fitted.forEach((id, i) => lean.set(id, raw[i] - centre));
    }
    const miss = new Map(raterIds.map(id => [id, []]));
    for (const e of entries) miss.get(e.rid).push(Math.abs(e.v - lean.get(e.rid) - level.get(e.pid)));
    for (const id of raterIds) {
      offsets.get(id)[s] = lean.get(id);
      const st = raters.get(id);
      st.shared[s] = n.get(id);
      st.applied[s] = fitted.includes(id);
      st.miss[s] = miss.get(id).length ? avg(miss.get(id)) : null;
    }
  }

  const combined = new Map();
  for (const [pid, rs] of byPlayer) {
    const v = {}, unknown = [];
    for (const s of SKILLS) {
      const vals = rs.filter(r => r[s] != null).map(r => clamp(Number(r[s]) - (offsets.get(r.rater_id)?.[s] ?? 0)));
      v[s] = vals.length ? avg(vals) : null;
      if (!vals.length) unknown.push(s);
    }
    combined.set(pid, { skills: v, unknown, raters: rs.length });
  }
  // Fill the gaps, using the group's spread on each skill among players who have a value.
  const known = Object.fromEntries(SKILLS.map(s => [s, [...combined.values()].map(c => c.skills[s]).filter(v => v != null).sort((a, b) => a - b)]));
  const mean = Object.fromEntries(SKILLS.map(s => [s, known[s].length ? avg(known[s]) : .5]));
  const tierValue = {
    beginner: s => quantile(known[s], .25) ?? .25,
    average: s => mean[s],
    strong: s => quantile(known[s], .75) ?? .75,
  };
  for (const p of players) {
    const c = combined.get(p.id);
    c.guess = null;
    if (!c.unknown.length) continue;
    const have = SKILLS.filter(s => c.skills[s] != null);
    if (have.length) {
      // A skill nobody rated: assume they sit as far above or below the group as on the skills we know.
      const lift = avg(have.map(s => c.skills[s] - mean[s]));
      for (const s of c.unknown) c.skills[s] = clamp(mean[s] + lift);
    } else {
      // Nobody has rated them at all: use the tier picked for them, or a cautious Beginner.
      c.guess = TIERS.includes(p.tier) ? p.tier : 'beginner';
      for (const s of SKILLS) c.skills[s] = tierValue[c.guess](s);
    }
  }

  // Players whose raters disagree by a full point or more on their total, after taking out each rater's lean.
  const disagreements = [];
  for (const p of players) {
    const totals = byPlayer.get(p.id)
      .filter(r => SKILLS.every(s => r[s] != null))
      .map(r => ({
        rater_id: r.rater_id,
        total: SKILLS.reduce((a, s) => a + clamp(Number(r[s]) - offsets.get(r.rater_id)[s]), 0),
        raw: Object.fromEntries(SKILLS.map(s => [s, Number(r[s])])),
      }))
      .sort((a, b) => b.total - a.total);
    if (totals.length < 2) continue;
    const gap = totals[0].total - totals[totals.length - 1].total;
    if (gap >= 1) disagreements.push({ player_id: p.id, name: p.name, gap, totals });
  }
  disagreements.sort((a, b) => b.gap - a.gap);

  return { combined, offsets, raters, disagreements };
}

export const weightedTotal = sk => SKILLS.reduce((a, s) => a + sk[s] * WEIGHTS[s], 0);

// players: [{id, name, gender: 'M'|'F'|'U', setting: 'M'|'B'|'N', unrated?: bool}], skills: Map id -> {receiving..}
// combos: [[idA, idB]]; pairs with someone not in `players` are skipped.
export function buildTeams({ players, skills, combos = [], numTeams = 4, timeBudgetMs = 5000, maxRestarts = 3000, seed = 11, options = 3 }) {
  const n = players.length, T = numTeams;
  if (n < T || n % T) throw new Error(`${n} players can't be split into ${T} equal teams`);
  const size = n / T;
  const idx = new Map(players.map((p, i) => [p.id, i]));

  // Fields per player/unit/team: 5 weighted skills, main setters, backup setters, women, weak passers, unrated players.
  const F = 10, MAIN = 5, BACK = 6, WOMEN = 7, WEAK = 8, GUESS = 9;
  const feat = players.map(p => {
    const sk = skills.get(p.id);
    return [...SKILLS.map(s => sk[s] * WEIGHTS[s]), +(p.setting === 'M'), +(p.setting === 'B'), +(p.gender === 'F'), +(sk.receiving <= .25), +!!p.unrated];
  });

  // Combos lock players into units that always move together.
  const parent = players.map((_, i) => i);
  const find = x => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  const usedCombos = [];
  for (const [a, b] of combos) {
    if (!idx.has(a) || !idx.has(b)) continue;
    parent[find(idx.get(a))] = find(idx.get(b));
    usedCombos.push([a, b]);
  }
  const groups = new Map();
  players.forEach((_, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  const units = [...groups.values()].sort((a, b) => b.length - a.length);
  const big = units.find(u => u.length > size);
  if (big) throw new Error(`Combo group ${big.map(i => players[i].name).join(', ')} is bigger than a team`);
  const U = units.length, NG = units.filter(u => u.length > 1).length;
  const ua = new Float64Array(U * F);
  units.forEach((u, k) => u.forEach(i => feat[i].forEach((v, f) => { ua[k * F + f] += v; })));

  const rand = mulberry32(seed);
  const agg = new Float64Array(T * F);
  const add = (t, u, sgn) => { for (let f = 0; f < F; f++) agg[t * F + f] += sgn * ua[u * F + f]; };
  const tot = new Float64Array(T);

  function cost() {
    let c = 0, m = 0;
    for (let t = 0; t < T; t++) { let s = 0; for (let f = 0; f < 5; f++) s += agg[t * F + f]; tot[t] = s; m += s; }
    m /= T;
    let hi = -Infinity, lo = Infinity;
    for (let t = 0; t < T; t++) { c += 4 * (tot[t] - m) ** 2; hi = Math.max(hi, tot[t]); lo = Math.min(lo, tot[t]); }
    for (let f = 0; f < 5; f++) {
      let cm = 0; for (let t = 0; t < T; t++) cm += agg[t * F + f]; cm /= T;
      for (let t = 0; t < T; t++) c += (agg[t * F + f] - cm) ** 2;
    }
    c += 50 * Math.max(0, hi - lo - .25) / .25;
    let wkHi = -Infinity, wkLo = Infinity, woHi = -Infinity, woLo = Infinity, guHi = -Infinity, guLo = Infinity;
    for (let t = 0; t < T; t++) {
      const o = t * F;
      if (Math.round(agg[o + MAIN]) !== 1) c += 100;
      if (Math.round(agg[o + BACK]) > 1) c += 5;
      wkHi = Math.max(wkHi, agg[o + WEAK]); wkLo = Math.min(wkLo, agg[o + WEAK]);
      woHi = Math.max(woHi, agg[o + WOMEN]); woLo = Math.min(woLo, agg[o + WOMEN]);
      guHi = Math.max(guHi, agg[o + GUESS]); guLo = Math.min(guLo, agg[o + GUESS]);
    }
    const wk = Math.round(wkHi - wkLo);
    c += 20 * Math.max(0, wk - 1) + .5 * wk * wk;
    c += 100 * Math.max(0, Math.round(woHi - woLo) - 1);
    // Unrated players' numbers are guesses; spread them so no team stacks up several.
    const gu = Math.round(guHi - guLo);
    c += 20 * Math.max(0, gu - 1) + .5 * gu * gu;
    return c;
  }

  const seen = new Map();
  const start = Date.now();
  let restarts = 0;
  while (restarts < maxRestarts && Date.now() - start < timeBudgetMs) {
    restarts++;
    const asg = new Int32Array(U), cap = new Array(T).fill(size);
    agg.fill(0);
    const order = [...Array(U).keys()].map(u => [u, rand()]).sort((a, b) => units[b[0]].length - units[a[0]].length || a[1] - b[1]).map(x => x[0]);
    let ok = true;
    for (const u of order) {
      const open = [];
      for (let t = 0; t < T; t++) if (cap[t] >= units[u].length) open.push(t);
      if (!open.length) { ok = false; break; }
      const t = open[Math.floor(rand() * open.length)];
      asg[u] = t; cap[t] -= units[u].length; add(t, u, 1);
    }
    if (!ok) continue;

    let c = cost(), improved = true;
    while (improved) {
      improved = false;
      for (let a = 0; a < U; a++) for (let b = a + 1; b < U; b++) {
        const ta = asg[a], tb = asg[b];
        if (ta === tb || units[a].length !== units[b].length) continue;
        add(ta, a, -1); add(ta, b, 1); add(tb, b, -1); add(tb, a, 1);
        const c2 = cost();
        if (c2 < c - 1e-9) { c = c2; asg[a] = tb; asg[b] = ta; improved = true; }
        else { add(ta, a, 1); add(ta, b, -1); add(tb, b, 1); add(tb, a, -1); }
      }
      // Swap a combo group for the same number of single players on another team.
      for (let g = 0; g < NG; g++) {
        const L = units[g].length;
        for (let k = 0; k < T; k++) {
          const o = asg[g];
          if (k === o) continue;
          const singles = [];
          for (let u = NG; u < U; u++) if (asg[u] === k) singles.push(u);
          for (const combo of combinations(singles, L)) {
            add(o, g, -1); add(k, g, 1);
            for (const u of combo) { add(k, u, -1); add(o, u, 1); }
            const c2 = cost();
            if (c2 < c - 1e-9) { c = c2; asg[g] = k; for (const u of combo) asg[u] = o; improved = true; break; }
            add(o, g, 1); add(k, g, -1);
            for (const u of combo) { add(k, u, 1); add(o, u, -1); }
          }
        }
      }
    }
    const teams = Array.from({ length: T }, () => []);
    units.forEach((u, k) => teams[asg[k]].push(...u));
    const key = teams.map(t => [...t].sort((x, y) => x - y).join(',')).sort().join('|');
    if (!seen.has(key)) seen.set(key, { cost: c, teams });
  }

  // Rank, then keep options that differ from each other by at least 4 players.
  const ranked = [...seen.values()].sort((a, b) => a.cost - b.cost);
  const picked = [];
  for (const sol of ranked) {
    if (picked.every(p => moved(p.teams, sol.teams, n) >= 4)) picked.push(sol);
    if (picked.length >= options) break;
  }

  const warnings = [];
  const mains = players.filter(p => p.setting === 'M').length;
  if (mains < T) warnings.push(`Only ${mains} main setters for ${T} teams.`);
  if (restarts < maxRestarts) warnings.push(`Stopped after ${restarts} tries (time limit).`);

  return {
    restarts, warnings, combosUsed: usedCombos.length,
    options: picked.map(sol => ({
      score: sol.cost,
      teams: sol.teams.map(t => describeTeam(t.map(i => players[i]), skills)),
    })),
  };
}

function describeTeam(members, skills) {
  const rank = p => ({ M: 0, B: 1 })[p.setting] ?? 2;
  const ps = [...members].sort((a, b) => rank(a) - rank(b) || weightedTotal(skills.get(b.id)) - weightedTotal(skills.get(a.id)));
  const sums = Object.fromEntries(SKILLS.map(s => [s, ps.reduce((a, p) => a + skills.get(p.id)[s], 0)]));
  return {
    players: ps.map(p => ({ id: p.id, name: p.name, setting: p.setting, gender: p.gender, weak: skills.get(p.id).receiving <= .25 })),
    sums,
    weighted: ps.reduce((a, p) => a + weightedTotal(skills.get(p.id)), 0),
  };
}

// Fewest players that must change teams to turn lineup a into lineup b.
function moved(a, b, n) {
  const A = a.map(t => new Set(t)), B = b.map(t => new Set(t));
  let best = 0;
  for (const perm of permutations([...Array(A.length).keys()])) {
    let same = 0;
    perm.forEach((j, i) => { for (const x of A[i]) if (B[j].has(x)) same++; });
    best = Math.max(best, same);
  }
  return n - best;
}

function* combinations(arr, k, startAt = 0, acc = []) {
  if (acc.length === k) { yield acc; return; }
  for (let i = startAt; i < arr.length; i++) yield* combinations(arr, k, i + 1, [...acc, arr[i]]);
}

function* permutations(arr) {
  if (arr.length <= 1) { yield arr; return; }
  for (let i = 0; i < arr.length; i++) for (const p of permutations([...arr.slice(0, i), ...arr.slice(i + 1)])) yield [arr[i], ...p];
}

function mulberry32(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
// q-th quantile of a sorted list (linear between points), or null if empty.
const quantile = (xs, q) => {
  if (!xs.length) return null;
  const i = (xs.length - 1) * q, lo = Math.floor(i);
  return xs[lo] + (xs[Math.min(lo + 1, xs.length - 1)] - xs[lo]) * (i - lo);
};
const clamp = v => Math.min(1, Math.max(0, v));
