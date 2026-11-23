// POST /.netlify/functions/rate-queue  (raters, organizers, super)  -> { few: [id], anchors: [id] }
// Players worth a fresh look on the Rate page, ids only:
//   few:     active players fewer than MIN_RATERS people have rated
//   anchors: anchor players (players.anchor), for new raters to rate first
// Ratings older than STALE_DAYS are worked out in the browser from the caller's own rows. Results against the
// ratings used to be here too; they were mostly luck and stressed people out (2026-11-23), so they're only on
// Insights and in Adjust for results on Teams.
import { activeRaters, caller, json, rest } from '../lib/supabase.mjs';

const MIN_RATERS = 2;

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const me = await caller(req);
  if (!me || !['rater', 'organizer', 'super'].includes(me.role)) return json({ error: 'Raters only' }, 403);
  // select=* so it works before the anchor column exists.
  const [players, allRatings, rating] = await Promise.all([
    rest('players?active=eq.true&select=*'),
    rest('ratings?select=rater_id,player_id'),
    activeRaters(),
  ]);
  const ratings = allRatings.filter(r => rating.has(r.rater_id));
  const count = new Map();
  for (const r of ratings) count.set(r.player_id, (count.get(r.player_id) ?? 0) + 1);
  const few = players.filter(p => (count.get(p.id) ?? 0) < MIN_RATERS).map(p => p.id);
  const anchors = players.filter(p => p.anchor).map(p => p.id);
  return json({ few, anchors });
};
