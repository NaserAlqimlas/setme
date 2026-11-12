// POST /.netlify/functions/my-stats  (anyone signed in whose account is linked to a player)
// -> { linked, total, games, touches } for the caller's own player only, from tagged games (supabase/match_stats.sql):
//   total: their player_stats row (all tagged games) or null; games: tagged games they played, newest first,
//   [{ id, played_on, mine, theirs }]; touches: their own touches, [{ game_id, action, grade }];
//   club: everyone else's touches added together, per action and grade ({ serve: { 0: n, 1: n, … }, … }), for What to
//   work on. An action is left out until at least MIN_OTHERS other players have touches of it, so no one's own numbers show.
// Nothing about other players: no names, no one else's touches.
import { caller, json, rest } from '../lib/supabase.mjs';
import { clubCounts } from '../../site/js/focus.mjs';

// Every row, a page at a time (the API returns at most 1,000 rows per request).
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
  const [profile] = await rest(`profiles?id=eq.${me.id}&select=*`);
  const pid = Number(profile?.player_id);
  if (!profile?.player_id || !Number.isInteger(pid)) return json({ linked: false });
  let total, raw, games, everyone;
  try {
    [everyone, raw, games] = await Promise.all([
      allRows(`player_stats?select=*&order=player_id`),
      allRows(`touches?player_id=eq.${pid}&select=action,grade,rallies(game_id)&order=rally_id,seq`),
      rest(`games?or=(players_a.cs.{${pid}},players_b.cs.{${pid}})&select=id,session_id,score_a,score_b,players_a,created_at`),
    ]);
  } catch { return json({ linked: true, total: null, games: [], touches: [], club: {} }); }  // match stats not set up yet
  total = everyone.find(r => Number(r.player_id) === pid);
  // Tagged = at least one finished rally, as player_stats counts games.
  const ids = games.map(g => g.id);
  // Read in pages: the API returns at most 1,000 rows at a time, and this is one row per finished rally.
  const tagged = new Set();
  for (let from = 0; ids.length; from += 1000) {
    const page = await rest(`rallies?game_id=in.(${ids.join(',')})&won_by=not.is.null&select=game_id&order=game_id&offset=${from}&limit=1000`);
    for (const r of page) tagged.add(r.game_id);
    if (page.length < 1000) break;
  }
  const mine = games.filter(g => tagged.has(g.id));
  const sids = [...new Set(mine.map(g => g.session_id))];
  const day = new Map(sids.length ? (await rest(`sessions?id=in.(${sids.join(',')})&select=id,played_on`)).map(s => [s.id, s.played_on]) : []);
  const out = mine.map(g => {
    const onA = g.players_a.map(Number).includes(pid);
    return { id: g.id, played_on: day.get(g.session_id) ?? null, mine: onA ? g.score_a : g.score_b, theirs: onA ? g.score_b : g.score_a, at: g.created_at };
  }).sort((a, b) => String(b.played_on).localeCompare(String(a.played_on)) || String(b.at).localeCompare(String(a.at)))
    .map(({ at, ...g }) => g);
  const touches = raw.map(t => ({ game_id: t.rallies?.game_id, action: t.action, grade: t.grade })).filter(t => tagged.has(t.game_id));
  return json({ linked: true, total: total ?? null, games: out, touches, club: clubCounts(everyone, pid) });
};
