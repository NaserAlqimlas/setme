// POST /.netlify/functions/build-teams  { numTeams?: number, useCombos?: boolean, combos?: [{ player_a, player_b, kind: 'together'|'apart' }] }
// Super can pass raters: [ids] to build from those raters' ratings only (ignored for organizers).
// POST { check: true } instead lists who's playing with no ratings yet, so the organizer can pick a tier for them.
// Organizers get lineups only; super also gets skill numbers. Ratings never leave the server for organizers.
import { buildTeams, combineRatings } from '../../site/js/teams.mjs';
import { caller, json, rest } from '../lib/supabase.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const me = await caller(req);
  if (!me || !['organizer', 'super'].includes(me.role)) return json({ error: 'Organizers only' }, 403);

  const { numTeams = 4, useCombos = true, check = false, raters = null, combos: sent = [] } = await req.json().catch(() => ({}));
  const [players, ratings] = await Promise.all([
    rest('players?active=eq.true&select=id,name,gender,setting,playing,tier'),
    rest('ratings?select=rater_id,player_id,receiving,hitting,hustle,serve,blocking,consistency'),
  ]);
  if (me.role === 'super' && Array.isArray(raters) && !raters.length) return json({ error: 'Pick at least one rater' }, 400);
  const pick = me.role === 'super' && Array.isArray(raters) ? new Set(raters) : null;
  // Combos come with the request (they aren't saved). Keep only well-formed pairs of player ids.
  const pairs = (Array.isArray(sent) ? sent : [])
    .filter(c => Number.isInteger(c?.player_a) && Number.isInteger(c?.player_b) && c.player_a !== c.player_b)
    .map(c => ({ player_a: c.player_a, player_b: c.player_b, kind: c.kind === 'apart' ? 'apart' : 'together' }));
  const { combined } = combineRatings(players, pick ? ratings.filter(r => pick.has(r.rater_id)) : ratings);
  const playing = players.filter(p => p.playing).map(p => ({ ...p, unrated: !!combined.get(p.id).guess }));
  if (check) return json({ unrated: playing.filter(p => p.unrated).map(({ id, name }) => ({ id, name, tier: combined.get(id).guess })) });
  const skills = new Map([...combined].map(([id, c]) => [id, c.skills]));

  let result;
  try {
    result = buildTeams({
      players: playing, skills, numTeams: Number(numTeams),
      combos: useCombos ? pairs.filter(c => c.kind !== 'apart').map(c => [c.player_a, c.player_b]) : [],
      apart: useCombos ? pairs.filter(c => c.kind === 'apart').map(c => [c.player_a, c.player_b]) : [],
      timeBudgetMs: 7000,
    });
  } catch (e) {
    return json({ error: e.message }, 400);
  }

  const unrated = playing.filter(p => p.unrated).map(p => `${p.name} (${combined.get(p.id).guess})`);
  if (unrated.length) result.warnings.push(`No ratings yet for ${unrated.join(', ')}.`);

  if (me.role !== 'super') {
    for (const opt of result.options) {
      delete opt.score;
      for (const t of opt.teams) { delete t.sums; delete t.weighted; t.players = t.players.map(({ name, setting }) => ({ name, setting })); }
    }
  }
  return json(result);
};
