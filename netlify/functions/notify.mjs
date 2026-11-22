// POST /.netlify/functions/notify — club emails the site asks for (netlify/lib/news.mjs).
//   { action: 'tagged', game } -> { sent, at }   the super's Done tagging on the tag screen: everyone who may watch the
//      game hears its stats are up. Once per game (games.tagged_emailed_at, which also marks it done). Needs some tags.
//      Before supabase/emails.sql: an error saying so.
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
    if (!('tagged_emailed_at' in g)) return json({ error: 'This needs the database upgrade first: run supabase/emails.sql in the Supabase SQL Editor.' }, 400);
    if (g.tagged_emailed_at) return json({ sent: 0, at: g.tagged_emailed_at });
    const [tagged] = await rest(`rallies?game_id=eq.${id}&won_by=not.is.null&select=id&limit=1`);
    if (!tagged) return json({ error: 'Tag some rallies first' }, 400);
    // Claim it first, so two taps send one email.
    const at = new Date().toISOString();
    const claimed = await rest(`games?id=eq.${id}&tagged_emailed_at=is.null`, { method: 'PATCH', headers: { prefer: 'return=representation' },
      body: JSON.stringify({ tagged_emailed_at: at }) });
    if (!claimed.length) return json({ sent: 0 });
    const sent = await tellClub({ kind: 'tags', gameId: id, origin: process.env.URL || new URL(req.url).origin });
    return json({ sent, at });
  } catch (e) {
    return json({ error: e.message }, 400);
  }
};
