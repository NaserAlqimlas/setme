// POST /.netlify/functions/notify — club emails the site asks for (netlify/lib/news.mjs).
//   { action: 'tagged', game } -> { sent }   the super's tag screen, once a game's tags reach its saved score: everyone
//      who may watch the game hears its stats are up. Checked here against the stored tags, and sent once per game
//      (games.tagged_emailed_at). Before supabase/emails.sql: { sent: 0 }.
import { caller, json, rest } from '../lib/supabase.mjs';
import { tellClub } from '../lib/news.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const me = await caller(req);
  if (!me) return json({ error: 'Sign in first' }, 401);
  const body = await req.json().catch(() => ({}));
  if (body.action !== 'tagged') return json({ error: 'Unknown action' }, 400);
  if (me.role !== 'super') return json({ error: 'Only the super tags games' }, 403);
  try {
    const id = Number(body.game);
    const [g] = await rest(`games?id=eq.${id}&select=*`);
    if (!g) return json({ error: 'That game is gone' }, 404);
    if (!('tagged_emailed_at' in g) || g.tagged_emailed_at) return json({ sent: 0 });
    const rallies = await rest(`rallies?game_id=eq.${id}&won_by=not.is.null&select=seq,won_by`);
    const counted = g.tags_end == null ? rallies : rallies.filter(r => r.seq <= g.tags_end);
    const a = counted.filter(r => r.won_by === 'a').length, b = counted.filter(r => r.won_by === 'b').length;
    if (a !== g.score_a || b !== g.score_b) return json({ sent: 0, complete: false });
    // Claim it first, so two saves at once send one email.
    const claimed = await rest(`games?id=eq.${id}&tagged_emailed_at=is.null`, { method: 'PATCH', headers: { prefer: 'return=representation' },
      body: JSON.stringify({ tagged_emailed_at: new Date().toISOString() }) });
    if (!claimed.length) return json({ sent: 0 });
    const sent = await tellClub({ kind: 'tags', gameId: id, origin: process.env.URL || new URL(req.url).origin });
    return json({ sent });
  } catch (e) {
    return json({ error: e.message }, 400);
  }
};
