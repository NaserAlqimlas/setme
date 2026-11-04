// POST /.netlify/functions/rate-queue  (raters, organizers, super)  -> { results: [id], few: [id], anchors: [id] }
// Players worth a fresh look on the Rate page. Ids only, never which way or by how much, so nobody learns anything
// about anyone's ratings:
//   results: their teams keep doing better or worse than their ratings said (resultAdjustments in scores.mjs,
//            at least NEEDS_GAMES games and a shift of SHIFT or more)
//   few:     active players fewer than MIN_RATERS people have rated
//   anchors: anchor players (players.anchor), for new raters to rate first
// Ratings older than STALE_DAYS are worked out in the browser from the caller's own rows.
import { resultAdjustments, playerStats, analyze } from '../../site/js/scores.mjs';
import { caller, json, rest } from '../lib/supabase.mjs';

const NEEDS_GAMES = 10, SHIFT = .25, MIN_RATERS = 2;

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const me = await caller(req);
  if (!me || !['rater', 'organizer', 'super'].includes(me.role)) return json({ error: 'Raters only' }, 403);
  // select=* so it works before the anchor column exists.
  const [players, ratings, games] = await Promise.all([
    rest('players?active=eq.true&select=*'),
    rest('ratings?select=rater_id,player_id'),
    rest('games?select=session_id,players_a,players_b,score_a,score_b,predicted').catch(() => []),
  ]);
  const active = new Set(players.map(p => p.id));
  const adj = resultAdjustments(games);
  const played = new Map(analyze(games).n ? playerStats(games, 1).map(p => [p.id, p.games]) : []);
  const results = [...adj].filter(([id, v]) => active.has(id) && Math.abs(v) >= SHIFT && (played.get(id) ?? 0) >= NEEDS_GAMES).map(([id]) => id);
  const count = new Map();
  for (const r of ratings) count.set(r.player_id, (count.get(r.player_id) ?? 0) + 1);
  const few = players.filter(p => (count.get(p.id) ?? 0) < MIN_RATERS).map(p => p.id);
  const anchors = players.filter(p => p.anchor).map(p => p.id);
  return json({ results, few, anchors });
};
