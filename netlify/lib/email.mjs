// Email through Resend (resend.com). Server side only.
// Environment: RESEND_API_KEY, and RESEND_FROM, "SetMe <hello@setme.club>". Until a domain is verified in
// Resend, it only delivers to the Resend account's own address, from onboarding@resend.dev.
export const emailReady = (env = process.env) => !!env.RESEND_API_KEY;

// -> the message id, or throws with Resend's reason. Returns null when email isn't set up, so callers carry on.
export async function sendEmail({ to, subject, text, html }, env = process.env, fetcher = (...a) => fetch(...a)) {
  if (!emailReady(env)) return null;
  const res = await fetcher('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.RESEND_FROM || 'SetMe <onboarding@resend.dev>', to: [to], subject, text, html }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Email not sent: ${body.message || body.error || res.status}`);
  return body.id ?? null;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ROLE_LINE = {
  player: 'Sign up for game days, see your teams, and watch videos of the games you played in.',
  rater: 'Rate players so the teams come out even.',
  organizer: 'Build the teams, enter scores, and rate players.',
};

// The invite or password reset email (admin.mjs) -> { subject, text, html }. kind: 'invite' or 'reset'.
export function accountEmail({ kind, name, role, link }) {
  const hi = name ? `Hi ${name},` : 'Hi,';
  const lines = kind === 'invite'
    ? [hi, `You're invited to SetMe, the club's volleyball site. ${ROLE_LINE[role] ?? ROLE_LINE.rater}`, 'Tap the button to choose your password. The link works once.']
    : [hi, 'Here is the link to choose a new SetMe password. It works once. If you didn\'t ask for it, you can ignore this email.'];
  const button = kind === 'invite' ? 'Join SetMe' : 'Choose a new password';
  const subject = kind === 'invite' ? 'You\'re invited to SetMe' : 'Your SetMe password reset';
  const text = [...lines, '', `${button}: ${link}`, '', 'SetMe'].join('\n');
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#18182b">${lines.map(l => `<p>${esc(l)}</p>`).join('')}`
    + `<p><a href="${esc(link)}" style="display:inline-block;padding:10px 16px;background:#18182b;color:#fff;border-radius:6px;text-decoration:none">${button}</a></p>`
    + `<p style="color:#65657a;font-size:13px">If the button doesn't work, copy this into your browser:<br>${esc(link)}</p></div>`;
  return { subject, text, html };
}
