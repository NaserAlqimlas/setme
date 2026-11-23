// POST /.netlify/functions/club-averages  (organizers and the super: they see every rating anyway)
// -> { ratings: { players: [{ id, name, skills, total, weighted }], club }, stats: { players: { id: metrics }, club } }
// Each active player's own numbers next to the club's middle and usual range (averages.mjs), for All ratings' Club
// averages card: who's above or below average in each skill, by ratings and by match stats.
import { activeRaters, caller, json, rest } from '../lib/supabase.mjs';
import { ratingAverages, statAverages } from '../../site/js/averages.mjs';

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
  if (!me || !['organizer', 'super'].includes(me.role)) return json({ error: 'Organizers only' }, 403);
  try {
    const [players, ratings, rating, stats] = await Promise.all([
      rest('players?active=eq.true&select=id,name&order=name'),
      allRows('ratings?select=*&order=player_id'),
      activeRaters(),
      allRows('player_stats?select=*&order=player_id').catch(() => []),   // before match_stats.sql: none
    ]);
    const r = ratingAverages(players, ratings.filter(x => rating.has(x.rater_id)));
    const s = statAverages(stats, new Set(players.map(p => p.id)));
    return json({ ratings: r, stats: { players: Object.fromEntries(s.players), club: s.club } });
  } catch (e) {
    return json({ error: e.message }, 400);
  }
};
