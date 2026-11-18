// POST /.netlify/functions/forgot-password  { email }  -> { ok, email: true | false }   (no sign-in needed)
// The sign-in page's Forgot password: emails a reset link (the same link the super's Reset link makes, see
// accountlink.mjs), through Resend. The answer is the same whether or not the address has an account, so nobody can
// use it to find out who's in the club. email: false only says email isn't set up on the site at all.
// Each email sent is noted in the activity log ('reset requested'), which is also how the limits are counted:
// one email per address every few minutes, a few a day, and a cap for the whole site (accountlink.mjs).
import { json, rest } from '../lib/supabase.mjs';
import { accountEmail, emailReady, sendEmail } from '../lib/email.mjs';
import { accountLink, cleanEmail, FORGOT_EVERY_MINUTES, looksLikeEmail, shouldSendReset } from '../lib/accountlink.mjs';

const enc = encodeURIComponent;
const since = minutes => new Date(Date.now() - minutes * 60e3).toISOString();

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const email = cleanEmail((await req.json().catch(() => ({}))).email);
  if (!looksLikeEmail(email)) return json({ error: 'Enter your email address' }, 400);
  if (!emailReady()) return json({ ok: true, email: false });
  try {
    const [account] = await rest(`profiles?email=eq.${enc(email)}&select=id,display_name`);
    // The limits are counted from the activity log (club.sql). If it can't be read or written, nothing is sent.
    const mine = `audit_log?action=eq.reset%20requested&detail->>email=eq.${enc(email)}&select=at&at=gte.`;
    const [today, all] = await Promise.all([
      rest(`${mine}${enc(since(24 * 60))}`),
      rest(`audit_log?action=eq.reset%20requested&at=gte.${enc(since(60))}&select=id`),
    ]);
    const recent = today.filter(r => Date.parse(r.at) >= Date.now() - FORGOT_EVERY_MINUTES * 60e3).length;
    if (shouldSendReset({ email, account, sentToThis: recent, sentToThisToday: today.length, sentLastHour: all.length })) {
      // Noted first, so a request that fails part-way still counts towards the limits.
      await rest('audit_log', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ actor: account.id, action: 'reset requested', detail: { email } }) });
      const origin = process.env.URL || new URL(req.url).origin;
      const { link } = await accountLink({ type: 'recovery', email, origin });
      await sendEmail({ to: email, ...accountEmail({ kind: 'reset', name: account.display_name, link }) });
    }
  } catch (e) {
    // Said nowhere on screen (it would tell whether the address has an account); the function log has it.
    console.error(`forgot password: ${e.message}`);
  }
  return json({ ok: true, email: true });
};
