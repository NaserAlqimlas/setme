// POST /.netlify/functions/my-rating  (anyone signed in whose account is linked to a player)
// -> { current: { overall, skills }, history: [{ date, overall, skills }] } for the caller's own player only
//    (the super may pass { player: id } for anyone's).
// Averages of what everyone rated them (ownRating in myrating.mjs). Never who rated, how many, or any one rater's values.
import { ownRating } from '../../site/js/myrating.mjs';
import { caller, json, rest } from '../lib/supabase.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const me = await caller(req);
  if (!me) return json({ error: 'Sign in first' }, 401);
  // select=* so it still answers before club.sql adds player_id.
  // The super can ask for any player ({ player: id }) to see their Me page as they do.
  const body = await req.json().catch(() => ({}));
  if (body.player != null && me.role !== 'super') return json({ error: 'Only the super can see another player\'s Me page' }, 403);
  const [profile] = body.player != null ? [{ player_id: body.player }] : await rest(`profiles?id=eq.${me.id}&select=*`);
  const pid = Number(profile?.player_id);
  if (!profile?.player_id || !Number.isInteger(pid)) return json({ linked: false });
  const [ratings, history] = await Promise.all([
    rest(`ratings?player_id=eq.${pid}&select=*`),
    rest(`rating_history?player_id=eq.${pid}&select=rater_id,skill,old_value,new_value,changed_at&order=changed_at.asc`).catch(() => []),
  ]);
  return json({ linked: true, ...ownRating(ratings, history) });
};
