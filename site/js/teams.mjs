// Team builder shared by the Netlify function (server) and the super's Ratings page (browser).
// Ratings are 0..1 in .25 steps; null means unknown (U).

export const SKILLS = ['receiving', 'hitting', 'hustle', 'serve', 'blocking'];
export const WEIGHTS = { receiving: 1.5, hitting: 1.25, hustle: .75, serve: 1, blocking: .5 };
// Everything raters rate. Consistency (how steady a player is day to day) isn't part of strength: it never adds to a
// total, it only spreads the least steady players across teams.
// Setting (how well they set) is rated only for setters and only counts while they set all game (see teamSkills).
export const RATED = [...SKILLS, 'setting_skill', 'consistency'];
// A setter who sets all game: their setting counts, while hitting and receiving count for less (they rarely attack,
// and teams hide them from passing serve). Serve, hustle and blocking count in full. Tune here.
export const SETTING_WEIGHT = 1.25;
export const ALL_GAME = { receiving: .5, hitting: .25 };
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
  for (const s of RATED) {
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
    for (const s of RATED) {
      const vals = rs.filter(r => r[s] != null).map(r => clamp(Number(r[s]) - (offsets.get(r.rater_id)?.[s] ?? 0)));
      v[s] = vals.length ? avg(vals) : null;
      if (!vals.length) unknown.push(s);
    }
    combined.set(pid, { skills: v, unknown, raters: rs.length });
  }
  // Fill the gaps, using the group's spread on each skill among players who have a value.
  const known = Object.fromEntries(RATED.map(s => [s, [...combined.values()].map(c => c.skills[s]).filter(v => v != null).sort((a, b) => a - b)]));
  const mean = Object.fromEntries(RATED.map(s => [s, known[s].length ? avg(known[s]) : .5]));
  const tierValue = {
    beginner: s => quantile(known[s], .25) ?? .25,
    average: s => mean[s],
    strong: s => quantile(known[s], .75) ?? .75,
  };
  for (const p of players) {
    const c = combined.get(p.id);
    c.guess = null;
    if (!c.unknown.length) continue;
    // Unrated consistency counts as the group's normal; being good doesn't make someone steady.
    if (c.skills.consistency == null) c.skills.consistency = mean.consistency;
    const have = SKILLS.filter(s => c.skills[s] != null);
    if (have.length === SKILLS.length) continue;
    if (have.length) {
      // A skill nobody rated: assume they sit as far above or below the group as on the skills we know.
      const lift = avg(have.map(s => c.skills[s] - mean[s]));
      for (const s of SKILLS) if (c.skills[s] == null) c.skills[s] = clamp(mean[s] + lift);
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
        raw: Object.fromEntries(RATED.map(s => [s, r[s] == null ? null : Number(r[s])])),
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
// A player's worth to a team: weighted skills, plus setting for a setter who sets all game (setEff, from teamSkills).
export const strength = sk => weightedTotal(sk) + (sk.setEff ?? 0) * SETTING_WEIGHT;

// Skills as they count on a team. allGame: ids of setters who set all game; their receiving and hitting shrink
// (ALL_GAME) and their setting counts (setEff; unrated setting = the setters' average, or .5). Everyone else: as rated.
export function teamSkills(players, combined, allGame) {
  const known = players.filter(p => p.setting !== 'N').map(p => combined.get(p.id)?.skills.setting_skill).filter(v => v != null);
  const avgSet = known.length ? known.reduce((a, b) => a + b, 0) / known.length : .5;
  return new Map(players.map(p => {
    const sk = combined.get(p.id).skills;
    if (!allGame.has(p.id)) return [p.id, { ...sk, setEff: 0, allGame: false }];
    return [p.id, { ...sk, receiving: sk.receiving * ALL_GAME.receiving, hitting: sk.hitting * ALL_GAME.hitting,
      setEff: sk.setting_skill ?? avgSet, allGame: true }];
  }));
}
// Weak passer: receiving .25 or below, unless they set all game (they're kept out of serve receive).
const weakPasser = sk => !sk.allGame && sk.receiving <= .25;

// players: [{id, name, gender: 'M'|'F'|'U', setting: 'M'|'B'|'N', unrated?: bool}], skills: Map id -> {receiving..}
// combos: [[idA, idB]] play together; apart: [[idA, idB]] must not share a team. Pairs with someone not in `players` are skipped.
export function buildTeams({ players, skills, combos = [], apart = [], numTeams = 4, timeBudgetMs = 5000, maxRestarts = 3000, seed = 11, options = 3 }) {
  const n = players.length, T = numTeams;
  if (n < T || n % T) throw new Error(`${n} players can't be split into ${T} equal teams`);
  const size = n / T;
  const idx = new Map(players.map((p, i) => [p.id, i]));

  // Keep-apart pairs: each gets its own field, 1 for both players, so a team scoring 2 on it has the pair together.
  const apartUsed = apart.filter(([a, b]) => idx.has(a) && idx.has(b) && a !== b);

  const { F, feat, cost: scoreAgg } = makeScorer(players, skills, apartUsed, T);

  // Combos lock players into units that always move together.
  const parent = players.map((_, i) => i);
  const find = x => { while (parent[x] !== x) x = parent[x] = parent[parent[x]]; return x; };
  const usedCombos = [];
  for (const [a, b] of combos) {
    if (!idx.has(a) || !idx.has(b)) continue;
    parent[find(idx.get(a))] = find(idx.get(b));
    usedCombos.push([a, b]);
  }
  for (const [a, b] of apartUsed) {
    if (find(idx.get(a)) === find(idx.get(b))) {
      throw new Error(`${players[idx.get(a)].name} and ${players[idx.get(b)].name} are set to keep apart, but combos put them together`);
    }
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

  const cost = () => scoreAgg(agg);

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
  if (restarts < maxRestarts) warnings.push(`Stopped after ${restarts} tries (time limit).`);
  for (const [a, b] of apartUsed) {
    if (picked.some(sol => sol.teams.some(t => t.includes(idx.get(a)) && t.includes(idx.get(b))))) {
      warnings.push(`Couldn't keep ${players[idx.get(a)].name} and ${players[idx.get(b)].name} apart in every option.`);
    }
  }

  return {
    restarts, warnings, combosUsed: usedCombos.length, apartUsed: apartUsed.length,
    options: picked.map(sol => ({
      score: sol.cost,
      teams: sol.teams.map(t => describeTeam(t.map(i => players[i]), skills)),
    })),
  };
}

// Per-player features and the score of a split (lower is better), shared by buildTeams and suggestSwaps.
// Fields per player/team: 5 weighted skills, weighted setting (all-game setters only), main setters, backup setters,
// women, weak passers, unrated players, inconsistent players, then one per keep-apart pair. The first NSK fields make
// up a team's strength. cost(agg) reads the per-team sums of those fields (T * F).
function makeScorer(players, skills, apartUsed, T) {
  const NSK = 6, MAIN = 6, BACK = 7, WOMEN = 8, WEAK = 9, GUESS = 10, SHAKY = 11, BASE = 12, F = BASE + apartUsed.length;
  const feat = players.map(p => {
    const sk = skills.get(p.id);
    return [...SKILLS.map(s => sk[s] * WEIGHTS[s]), (sk.setEff ?? 0) * SETTING_WEIGHT, +(p.setting === 'M'), +(p.setting === 'B'), +(p.gender === 'F'), +weakPasser(sk), +!!p.unrated, +((sk.consistency ?? .5) <= .25),
      ...apartUsed.map(([a, b]) => +(p.id === a || p.id === b))];
  });

  const tot = new Float64Array(T);

  function cost(agg) {
    let c = 0, m = 0;
    for (let t = 0; t < T; t++) { let s = 0; for (let f = 0; f < NSK; f++) s += agg[t * F + f]; tot[t] = s; m += s; }
    m /= T;
    let hi = -Infinity, lo = Infinity;
    for (let t = 0; t < T; t++) { c += 4 * (tot[t] - m) ** 2; hi = Math.max(hi, tot[t]); lo = Math.min(lo, tot[t]); }
    for (let f = 0; f < NSK; f++) {
      let cm = 0; for (let t = 0; t < T; t++) cm += agg[t * F + f]; cm /= T;
      for (let t = 0; t < T; t++) c += (agg[t * F + f] - cm) ** 2;
    }
    c += 50 * Math.max(0, hi - lo - .25) / .25;
    let wkHi = -Infinity, wkLo = Infinity, woHi = -Infinity, woLo = Infinity, guHi = -Infinity, guLo = Infinity, shHi = -Infinity, shLo = Infinity;
    for (let t = 0; t < T; t++) {
      const o = t * F;
      // Setters: exactly one main per team. When mains run short, two on one team is worse than none, and a team
      // without a main should get a backup, so every team has someone who can set.
      const mains = Math.round(agg[o + MAIN]), backs = Math.round(agg[o + BACK]);
      if (mains !== 1) c += 100;
      if (mains > 1) c += 100 * (mains - 1);
      if (mains === 0 && backs === 0) c += 40;
      if (backs > 1) c += 5;
      wkHi = Math.max(wkHi, agg[o + WEAK]); wkLo = Math.min(wkLo, agg[o + WEAK]);
      woHi = Math.max(woHi, agg[o + WOMEN]); woLo = Math.min(woLo, agg[o + WOMEN]);
      guHi = Math.max(guHi, agg[o + GUESS]); guLo = Math.min(guLo, agg[o + GUESS]);
      shHi = Math.max(shHi, agg[o + SHAKY]); shLo = Math.min(shLo, agg[o + SHAKY]);
    }
    const wk = Math.round(wkHi - wkLo);
    c += 20 * Math.max(0, wk - 1) + .5 * wk * wk;
    c += 100 * Math.max(0, Math.round(woHi - woLo) - 1);
    // Unrated players' numbers are guesses; spread them so no team stacks up several.
    const gu = Math.round(guHi - guLo);
    c += 20 * Math.max(0, gu - 1) + .5 * gu * gu;
    // Inconsistent players (consistency .25 or less) too, so no team leans on several on the same night.
    const sh = Math.round(shHi - shLo);
    c += 20 * Math.max(0, sh - 1) + .5 * sh * sh;
    for (let t = 0; t < T; t++) for (let f = BASE; f < F; f++) if (agg[t * F + f] > 1.5) c += 100;
    return c;
  }

  return { F, feat, cost };
}

export function describeTeam(members, skills) {
  const rank = p => ({ M: 0, B: 1 })[p.setting] ?? 2;
  const ps = [...members].sort((a, b) => rank(a) - rank(b) || strength(skills.get(b.id)) - strength(skills.get(a.id)));
  // sums.setting: setting of the team's all-game setters (0 when nobody sets all game).
  const sums = Object.fromEntries([...SKILLS.map(s => [s, ps.reduce((a, p) => a + skills.get(p.id)[s], 0)]), ['setting', ps.reduce((a, p) => a + (skills.get(p.id).setEff ?? 0), 0)]]);
  return {
    players: ps.map(p => ({ id: p.id, name: p.name, setting: p.setting, gender: p.gender, weak: weakPasser(skills.get(p.id)), allGame: !!skills.get(p.id).allGame })),
    sums,
    weighted: ps.reduce((a, p) => a + strength(skills.get(p.id)), 0),
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

// What's off about a split, in plain words, using the same rules buildTeams balances.
// teams: [[player, ...], ...] (players with id, name, setting, gender, unrated); skills: Map id -> skills.
// -> [{ key, text, short, rating }]: key stays the same while the problem lasts (to tell fixed from new after a swap),
// text is the full story with every team's count and names, short fits in a suggestion line, rating = comes from ratings.
export function teamProblems(teams, skills, apart = [], together = []) {
  const out = [];
  const label = k => `Team ${k + 1}`;
  const names = ps => ps.map(p => p.name).join(', ');
  teams.forEach((t, k) => {
    const mains = t.filter(p => p.setting === 'M'), backs = t.filter(p => p.setting === 'B');
    if (!mains.length && !backs.length) out.push({ key: `nosetter:${k}`, short: `${label(k)} has no setter`, text: `${label(k)} has no setter or backup setter` });
    else if (mains.length > 1) out.push({ key: `mains:${k}`, short: `${label(k)} has ${mains.length} main setters`, text: `${label(k)} has ${mains.length} main setters (${names(mains)})` });
  });
  // Groups that should be spread out: every team's count and who, when the most and fewest differ by 2 or more.
  const spread = (key, fn, what, rule, rating) => {
    const per = teams.map(t => t.filter(fn)), c = per.map(x => x.length), hi = Math.max(...c), lo = Math.min(...c);
    if (hi - lo < 2) return;
    const each = per.map((x, k) => `${label(k)} has ${x.length ? `${x.length} (${names(x)})` : 'none'}`).join(' · ');
    out.push({ key: `spread:${key}`, rating, short: `${what.toLowerCase()} bunched up`,
      text: `${what}${rule ? ` (${rule})` : ''} are bunched up: ${each}. Best is no more than 1 apart.` });
  };
  spread('weak', p => weakPasser(skills.get(p.id)), 'Weak passers', 'receiving .25 or below, not counting setters who set all game', true);
  spread('women', p => p.gender === 'F', 'Women', '', false);
  spread('unrated', p => p.unrated, 'Unrated players', 'no ratings yet, so a stand-in level is used', false);
  spread('shaky', p => (skills.get(p.id).consistency ?? .5) <= .25, 'Inconsistent players', 'consistency .25 or below', true);
  for (const [a, b] of apart) {
    const k = teams.findIndex(t => t.some(p => p.id === a) && t.some(p => p.id === b));
    if (k < 0) continue;
    const pair = `${teams[k].find(p => p.id === a).name} and ${teams[k].find(p => p.id === b).name}`;
    out.push({ key: `apart:${a}-${b}`, short: `${pair} together`, text: `${pair} are both on ${label(k)} (set to keep apart)` });
  }
  for (const [a, b] of together) {
    const ta = teams.findIndex(t => t.some(p => p.id === a)), tb = teams.findIndex(t => t.some(p => p.id === b));
    if (ta < 0 || tb < 0 || ta === tb) continue;
    const pa = teams[ta].find(p => p.id === a).name, pb = teams[tb].find(p => p.id === b).name;
    out.push({ key: `together:${a}-${b}`, short: `${pa} and ${pb} apart`, text: `${pa} is on ${label(ta)} and ${pb} is on ${label(tb)} (set to play together)` });
  }
  return out.map(x => ({ rating: false, ...x }));
}

// Smallest changes that make your own teams better by buildTeams' score: one-for-one swaps, then pairs of swaps.
// locked players never move, a "together" pair that's already on one team is never split, and fewer together pairs
// on different teams always beats better balance (combos are a rule in buildTeams too), so reuniting swaps come first.
// -> [{ swaps: [[idA, idB], ...], cost, teams }] best first: up to two single swaps, then a double if it beats them.
export function suggestSwaps({ players, skills, teams, combos = [], apart = [], locked = [], top = 3 }) {
  const T = teams.length, byId = new Map(players.map(p => [p.id, p]));
  const members = teams.map(t => t.map(id => byId.get(id)));
  const flat = members.flat();
  const idx = new Map(flat.map((p, i) => [p.id, i]));
  const teamOf = new Map(); teams.forEach((t, k) => t.forEach(id => teamOf.set(id, k)));
  const apartUsed = apart.filter(([a, b]) => idx.has(a) && idx.has(b) && a !== b);
  const { F, feat, cost } = makeScorer(flat, skills, apartUsed, T);
  const fixed = new Set(locked);
  for (const [a, b] of combos) if (teamOf.has(a) && teamOf.get(a) === teamOf.get(b)) { fixed.add(a); fixed.add(b); }
  const split = combos.filter(([a, b]) => teamOf.has(a) && teamOf.has(b) && teamOf.get(a) !== teamOf.get(b));
  const score = () => cost(agg) + 1e6 * split.filter(([a, b]) => teamOf.get(a) !== teamOf.get(b)).length;

  const agg = new Float64Array(T * F);
  const move = (id, from, to) => { const f = feat[idx.get(id)]; for (let i = 0; i < F; i++) { agg[from * F + i] -= f[i]; agg[to * F + i] += f[i]; } };
  flat.forEach(p => { const t = teamOf.get(p.id), f = feat[idx.get(p.id)]; for (let i = 0; i < F; i++) agg[t * F + i] += f[i]; });
  const base = score();
  const swap = ([a, b]) => { const ta = teamOf.get(a), tb = teamOf.get(b); move(a, ta, tb); move(b, tb, ta); teamOf.set(a, tb); teamOf.set(b, ta); };

  const singles = [];
  for (const a of flat) for (const b of flat) {
    if (a.id >= b.id || fixed.has(a.id) || fixed.has(b.id) || teamOf.get(a.id) === teamOf.get(b.id)) continue;
    swap([a.id, b.id]); singles.push({ swaps: [[a.id, b.id]], cost: score() }); swap([a.id, b.id]);
  }
  singles.sort((x, y) => x.cost - y.cost);
  // Pairs of swaps from the most promising singles (a swap that's flat on its own can still set up a great second one).
  const pool = singles.slice(0, 40), doubles = [];
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
    const [s1] = pool[i].swaps, [s2] = pool[j].swaps;
    if (s1.some(id => s2.includes(id))) continue;
    swap(s1); swap(s2); doubles.push({ swaps: [s1, s2], cost: score() }); swap(s2); swap(s1);
  }
  doubles.sort((x, y) => x.cost - y.cost);

  const better = x => x.cost < base - 1e-6;
  const picks = singles.filter(better).slice(0, Math.min(2, top));
  const bestDouble = doubles.find(d => better(d) && d.cost < (picks[0]?.cost ?? base) - 1e-6);
  if (bestDouble && picks.length < top) picks.push(bestDouble);
  for (const x of singles.filter(better).slice(picks.filter(p => p.swaps.length === 1).length)) { if (picks.length >= top) break; picks.push(x); }
  return { base, suggestions: picks.map(x => {
    const after = teams.map(t => [...t]);
    for (const [a, b] of x.swaps) {
      const ta = after.findIndex(t => t.includes(a)), tb = after.findIndex(t => t.includes(b));
      after[ta][after[ta].indexOf(a)] = b; after[tb][after[tb].indexOf(b)] = a;
    }
    return { ...x, teams: after };
  }) };
}
