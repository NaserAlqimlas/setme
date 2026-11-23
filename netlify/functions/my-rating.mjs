// POST /.netlify/functions/my-rating  (anyone signed in whose account is linked to a player)
// -> { current: { overall, skills }, history: [{ date, overall, skills }], club } for the caller's own player only
//    (the super may pass { player: id } for anyone's).
// Averages of what everyone rated them (ownRating in myrating.mjs). Never who rated, how many, or any one rater's values.
// club: the club's middle and usual range per skill, Total and Weighted (averages.mjs), over active players; no
// one else's numbers.
import { ownRating } from '../../site/js/myrating.mjs';
import { ratingAverages } from '../../site/js/averages.mjs';
import { activeRaters, caller, json, rest } from '../lib/supabase.mjs';

async function allRows(path) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest(`${path}&offset=${from}&limit=1000`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

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
  const [all, history, rating, players] = await Promise.all([
    allRows('ratings?select=*&order=player_id'),
    rest(`rating_history?player_id=eq.${pid}&select=rater_id,skill,old_value,new_value,changed_at&order=changed_at.asc`).catch(() => []),
    activeRaters(),
    rest('players?active=eq.true&select=id,name'),
  ]);
  const keep = r => rating.has(r.rater_id), kept = all.filter(keep);
  return json({ linked: true, ...ownRating(kept.filter(r => r.player_id === pid), history.filter(keep)), club: ratingAverages(players, kept).club });
};
