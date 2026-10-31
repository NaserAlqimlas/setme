// POST /.netlify/functions/admin  (super only)
//   { action: 'invite', email, name }  -> { link }   invite link to send yourself (no email is sent)
// Links point at the site, which only signs in when the person taps Continue. Link previews (WhatsApp etc.)
// open links automatically, which would use up a one-time Supabase link before the person ever sees it.
//   { action: 'reset', email }         -> { link }   password reset link
//   { action: 'remove', id }           -> { ok }     delete the account and its ratings
import { authAdmin, caller, json } from '../lib/supabase.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const me = await caller(req);
  if (me?.role !== 'super') return json({ error: 'Super only' }, 403);

  const body = await req.json().catch(() => ({}));
  const redirect_to = new URL(req.url).origin;
  try {
    if (body.action === 'invite' || body.action === 'reset') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email.includes('@')) return json({ error: 'Enter an email' }, 400);
      const res = await authAdmin('generate_link', {
        method: 'POST',
        body: JSON.stringify({
          type: body.action === 'invite' ? 'invite' : 'recovery',
          email, redirect_to,
          ...(body.action === 'invite' ? { data: { display_name: String(body.name || '').trim() || email.split('@')[0] } } : {}),
        }),
      });
      const hashed = res.hashed_token ?? res.properties?.hashed_token;
      const type = body.action === 'invite' ? 'invite' : 'recovery';
      return json({ link: hashed ? `${redirect_to}/?token_hash=${encodeURIComponent(hashed)}&type=${type}` : (res.action_link ?? res.properties?.action_link) });
    }
    if (body.action === 'remove') {
      if (body.id === me.id) return json({ error: "You can't remove yourself" }, 400);
      await authAdmin(`users/${encodeURIComponent(body.id)}`, { method: 'DELETE' });
      return json({ ok: true });
    }
  } catch (e) {
    return json({ error: e.message }, 400);
  }
  return json({ error: 'Unknown action' }, 400);
};
