// POST /.netlify/functions/build-teams  { numTeams?: number, useCombos?: boolean }
// Organizers get lineups only; super also gets skill numbers. Ratings never leave the server for organizers.
import { buildTeams, combineRatings } from '../../site/js/teams.mjs';
import { caller, json, rest } from '../lib/supabase.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const me = await caller(req);
  if (!me || !['organizer', 'super'].includes(me.role)) return json({ error: 'Organizers only' }, 403);

  const { numTeams = 4, useCombos = true } = await req.json().catch(() => ({}));
  const [players, ratings, combos] = await Promise.all([
    rest('players?active=eq.true&select=id,name,gender,setting,playing'),
    rest('ratings?select=rater_id,player_id,receiving,hitting,hustle,serve,blocking'),
    rest('combos?select=player_a,player_b'),
  ]);
  const playing = players.filter(p => p.playing);
  const { combined } = combineRatings(players, ratings);
  const skills = new Map([...combined].map(([id, c]) => [id, c.skills]));

  let result;
  try {
    result = buildTeams({
      players: playing, skills, numTeams: Number(numTeams),
      combos: useCombos ? combos.map(c => [c.player_a, c.player_b]) : [],
      timeBudgetMs: 7000,
    });
  } catch (e) {
    return json({ error: e.message }, 400);
  }

  const unrated = playing.filter(p => combined.get(p.id).raters === 0).map(p => p.name);
  if (unrated.length) result.warnings.push(`No ratings yet for ${unrated.join(', ')} (counted as average).`);

  if (me.role !== 'super') {
    for (const opt of result.options) {
      delete opt.score;
      for (const t of opt.teams) { delete t.sums; delete t.weighted; t.players = t.players.map(({ name, setting }) => ({ name, setting })); }
    }
  }
  return json(result);
};
