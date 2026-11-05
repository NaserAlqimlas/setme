// Attendance and season recaps from saved game days. Pure functions, shared by the Scores page, profiles and tests.
// A session: { id, played_on: 'YYYY-MM-DD', teams: [[player id, ...], ...], earlier?: [teams, ...] }, earlier = the
// teams of rounds played before the current one that day (rounds.sql). A game: as in scores.mjs.
import { margin25 } from './scores.mjs';

// Who came to each game day: everyone on a saved team in any round, plus anyone who played a game that day (late
// arrivals who were moved off again still count).
export function attendees(session, games = []) {
  const ids = new Set([...(session.teams ?? []).flat(), ...(session.earlier ?? []).flat(2)]);
  for (const g of games) if (g.session_id === session.id) for (const id of [...(g.players_a ?? []), ...(g.players_b ?? [])]) ids.add(id);
  return ids;
}

// Per player: game days attended, the share of all game days since their first, the last day they came, their
// current run of game days in a row, and their best run. `today` (YYYY-MM-DD) only matters for "days since".
// Regulars who stopped coming: came to at least half the game days before their last REGULAR_GAP days but none of those.
export const REGULAR_GAP = 3;
export function attendance(sessions, games = [], today = new Date().toISOString().slice(0, 10)) {
  const days = [...sessions].sort((a, b) => a.played_on.localeCompare(b.played_on));
  const came = days.map(s => attendees(s, games));
  const ids = new Set(came.flatMap(c => [...c]));
  const n = days.length;
  const out = new Map();
  for (const id of ids) {
    const hits = came.map(c => c.has(id));
    const first = hits.indexOf(true), last = hits.lastIndexOf(true);
    let run = 0, best = 0;
    for (const h of hits) { run = h ? run + 1 : 0; best = Math.max(best, run); }
    const total = hits.filter(Boolean).length;
    const before = hits.slice(0, Math.max(0, n - REGULAR_GAP));
    const missing = n > REGULAR_GAP && hits.slice(n - REGULAR_GAP).every(h => !h) && before.length >= 2 && before.filter(Boolean).length >= before.length / 2;
    out.set(id, {
      id, total, of: n - first, rate: total / (n - first),
      first: days[first].played_on, last: days[last].played_on,
      daysSince: Math.round((Date.parse(today) - Date.parse(days[last].played_on)) / 864e5),
      streak: hits.at(-1) ? run : 0, best, missing,
      history: days.map((d, i) => ({ played_on: d.played_on, came: hits[i] })),
    });
  }
  return out;
}

// One player's games: wins, losses and the longest winning run, in the order played.
export function record(games, id) {
  let wins = 0, losses = 0, run = 0, best = 0, pts = 0;
  for (const g of games) {
    const side = g.players_a?.includes(id) ? 1 : g.players_b?.includes(id) ? -1 : 0;
    if (!side || g.score_a === g.score_b) continue;
    const won = side * (g.score_a - g.score_b) > 0;
    if (won) { wins++; run++; best = Math.max(best, run); } else { losses++; run = 0; }
    pts += side * margin25(g.score_a, g.score_b);
  }
  const n = wins + losses;
  return { games: n, wins, losses, best, margin: n ? pts / n : null };
}

// Awards for a stretch of game days (a month, a season), for the season recap image. Results only: nothing here
// comes from ratings, so it can be shared with the whole group. tallies (optional): stats.mjs tally() of tagged games
// in the period. Each award: { key, title, who: [player id], value, detail } or null when nobody qualifies.
export const MIN_GAMES_FOR_RECORD = 6;
// An award has to single people out: shared by at most a third of the players (at least one), else it's left out.
// "Never misses" also needs a few game days; after one, everyone who came never missed.
export const MIN_DAYS_FOR_ATTENDANCE = 3;
const standout = (t, n) => t && t.who.length <= Math.max(1, Math.floor(n / 3)) ? t : null;
export function seasonRecap(sessions, games, tallies = null) {
  const sesIds = new Set(sessions.map(s => s.id));
  const gs = games.filter(g => sesIds.has(g.session_id) && g.score_a !== g.score_b)
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  const att = attendance(sessions, gs);
  const ids = [...att.keys()];
  const recs = new Map(ids.map(id => [id, record(gs, id)]));
  const top = (list, val, min = 1e-9) => {
    const best = Math.max(...list.map(val));
    if (!(best >= min)) return null;
    return { who: list.filter(x => Math.abs(val(x) - best) < 1e-9), value: best };
  };
  const awards = [];
  const iron = sessions.length >= MIN_DAYS_FOR_ATTENDANCE ? standout(top(ids, id => att.get(id).total, 1), ids.length) : null;
  if (iron) awards.push({ key: 'iron', title: 'Never misses', who: iron.who, value: iron.value, detail: `${iron.value} of ${sessions.length} game days` });
  const qualified = ids.filter(id => recs.get(id).games >= MIN_GAMES_FOR_RECORD);
  const winPct = standout(top(qualified, id => recs.get(id).wins / recs.get(id).games, .01), ids.length);
  if (winPct) { const r = recs.get(winPct.who[0]); awards.push({ key: 'record', title: 'Best record', who: winPct.who, value: winPct.value, detail: `${r.wins}–${r.losses}` }); }
  const streak = standout(top(ids, id => recs.get(id).best, 2), ids.length);
  if (streak) awards.push({ key: 'streak', title: 'Longest win streak', who: streak.who, value: streak.value, detail: `${streak.value} wins in a row` });
  const most = standout(top(ids, id => recs.get(id).wins, 1), ids.length);
  if (most) awards.push({ key: 'wins', title: 'Most wins', who: most.who, value: most.value, detail: `${most.value} wins` });
  if (tallies) {
    const stat = (key, title, get, unit) => {
      const t = standout(top([...tallies.keys()], id => get(tallies.get(id).counts), 1), ids.length);
      if (t) awards.push({ key, title, who: t.who, value: t.value, detail: `${t.value} ${unit}` });
    };
    stat('kills', 'Most kills', c => c.attack[3], 'kills');
    stat('aces', 'Most aces', c => c.serve[3], 'aces');
    stat('blocks', 'Most stuff blocks', c => c.block[3], 'blocks');
    stat('digs', 'Most digs', c => c.dig[1] + c.dig[2], 'digs');
  }
  // Closest finished game (ties broken by the higher score: a 27–25 beats a 25–23).
  const full = gs.filter(g => Math.max(g.score_a, g.score_b) >= 25);
  const closest = full.length ? full.reduce((b, g) => {
    const d = Math.abs(g.score_a - g.score_b), bd = Math.abs(b.score_a - b.score_b);
    return d < bd || (d === bd && Math.max(g.score_a, g.score_b) > Math.max(b.score_a, b.score_b)) ? g : b;
  }) : null;
  const day = new Map(sessions.map(s => [s.id, s.played_on]));
  return {
    days: sessions.length, games: gs.length, players: ids.length,
    first: sessions.map(s => s.played_on).sort()[0] ?? null, last: sessions.map(s => s.played_on).sort().at(-1) ?? null,
    awards,
    closest: closest && { session_id: closest.session_id, round: closest.round ?? 1, team_a: closest.team_a, team_b: closest.team_b, score_a: closest.score_a, score_b: closest.score_b, played_on: day.get(closest.session_id) },
  };
}
