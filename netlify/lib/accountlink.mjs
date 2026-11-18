// Invite and password reset links (admin.mjs for the super, forgot-password.mjs for anyone). The link points at the
// site, which only signs in when the person taps Continue: link previews (WhatsApp, mail scanners) open links on
// their own, which would use up a one-time Supabase link before the person ever sees it.
import { authAdmin } from './supabase.mjs';

// Supabase's generate_link answer -> the link to send. Older answers only have action_link.
export function linkFrom(res, origin, type) {
  const hashed = res.hashed_token ?? res.properties?.hashed_token;
  return hashed ? `${origin}/?token_hash=${encodeURIComponent(hashed)}&type=${type}` : (res.action_link ?? res.properties?.action_link);
}

// type: 'invite' or 'recovery'. data: user metadata for a new invite. -> { link, userId }
export async function accountLink({ type, email, origin, data }) {
  const res = await authAdmin('generate_link', { method: 'POST', body: JSON.stringify({ type, email, redirect_to: origin, ...(data ? { data } : {}) }) });
  return { link: linkFrom(res, origin, type), userId: res.id ?? res.user?.id };
}

// Forgot password (forgot-password.mjs): whether to email a reset link. Everyone gets the same answer on screen, so
// nobody can find out who has an account; these rules only decide whether an email goes.
export const FORGOT_EVERY_MINUTES = 5;   // one email per address this often, however often the button is pressed
export const FORGOT_PER_DAY = 3;         // per address in 24 hours: after that, ask the super for a Reset link
export const FORGOT_PER_HOUR = 30;       // all addresses together, so the button can't burn through the email quota
const NOT_PEOPLE = ['setme@setme.invalid'];   // SetMe's own rater account
export const cleanEmail = e => String(e ?? '').trim().toLowerCase();
export const looksLikeEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
export function shouldSendReset({ email, account, sentToThis = 0, sentToThisToday = 0, sentLastHour = 0 }) {
  if (!looksLikeEmail(email) || !account || NOT_PEOPLE.includes(email)) return false;
  return sentToThis === 0 && sentToThisToday < FORGOT_PER_DAY && sentLastHour < FORGOT_PER_HOUR;
}
