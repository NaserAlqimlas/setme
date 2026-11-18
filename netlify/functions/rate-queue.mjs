// POST /.netlify/functions/rate-queue  (raters, organizers, super)  -> { results: [id], few: [id], anchors: [id], how? }
// Players worth a fresh look on the Rate page. For raters, ids only, never which way or by how much, so nobody learns
// anything about anyone's ratings. Organizers and the super can already see every rating (and Insights' Players vs
// their ratings), so they also get how: { [id]: { over, games, wins } } for the results players:
//   results: their teams keep doing better or worse than their ratings said (resultAdjustments in scores.mjs,
//            at least NEEDS_GAMES games and a shift of SHIFT or more)
//   few:     active players fewer than MIN_RATERS people have rated
//   anchors: anchor players (players.anchor), for new raters to rate first
// Ratings older than STALE_DAYS are worked out in the browser from the caller's own rows.
import { resultAdjustments, playerStats, analyze } from '../../site/js/scores.mjs';
import { activeRaters, caller, json, rest } from '../lib/supabase.mjs';

const NEEDS_GAMES = 10, SHIFT = .25, MIN_RATERS = 2;

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const me = await caller(req);
  if (!me || !['rater', 'organizer', 'super'].includes(me.role)) return json({ error: 'Raters only' }, 403);
  // select=* so it works before the anchor column exists.
  const [players, allRatings, games, rating] = await Promise.all([
    rest('players?active=eq.true&select=*'),
    rest('ratings?select=rater_id,player_id'),
    rest('games?select=session_id,players_a,players_b,score_a,score_b,predicted').catch(() => []),
    activeRaters(),
  ]);
  const ratings = allRatings.filter(r => rating.has(r.rater_id));
  const active = new Set(players.map(p => p.id));
  const adj = resultAdjustments(games);
  const played = new Map(analyze(games).n ? playerStats(games, 1).map(p => [p.id, p.games]) : []);
  const results = [...adj].filter(([id, v]) => active.has(id) && Math.abs(v) >= SHIFT && (played.get(id) ?? 0) >= NEEDS_GAMES).map(([id]) => id);
  // over: points a game their teams did better (+) or worse (−) than the rating gap predicted; the same numbers as
  // Insights' Players vs their ratings.
  let how;
  if (['organizer', 'super'].includes(me.role) && results.length) {
    const a = analyze(games), st = new Map(playerStats(games, a.k).map(p => [p.id, p]));
    how = Object.fromEntries(results.filter(id => st.has(id)).map(id => {
      const p = st.get(id);
      return [id, { over: Math.round(p.over * 10) / 10, games: p.games, wins: p.wins }];
    }));
  }
  const count = new Map();
  for (const r of ratings) count.set(r.player_id, (count.get(r.player_id) ?? 0) + 1);
  const few = players.filter(p => (count.get(p.id) ?? 0) < MIN_RATERS).map(p => p.id);
  const anchors = players.filter(p => p.anchor).map(p => p.id);
  return json({ results, few, anchors, ...(how ? { how } : {}) });
};
