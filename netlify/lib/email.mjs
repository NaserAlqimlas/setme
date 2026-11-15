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
    body: JSON.stringify({ from: env.RESEND_FROM || 'SetMe <onboarding@resend.dev>', to: [to], subject, text, ...(html ? { html } : {}) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Email not sent: ${body.message || body.error || res.status}`);
  return body.id ?? null;
}

const ROLE_LINE = {
  player: 'Sign up for game days, see your teams, and watch videos of the games you played in.',
  rater: 'Rate players so the teams come out even.',
  organizer: 'Build the teams, enter scores, and rate players.',
};

// The invite or password reset email (admin.mjs) -> { subject, text }. kind: 'invite' or 'reset'. Plain text, so
// Gmail treats it as personal mail rather than Promotions.
export function accountEmail({ kind, name, role, link }) {
  const hi = name ? `Hi ${name},` : 'Hi,';
  const lines = kind === 'invite'
    ? [hi, '', `You're invited to SetMe, the club's volleyball site. ${ROLE_LINE[role] ?? ROLE_LINE.rater}`, '',
       'Open this link to choose your password (it works once):', link]
    : [hi, '', 'Open this link to choose a new SetMe password (it works once):', link, '', 'If you didn\'t ask for this, you can ignore it.'];
  return { subject: kind === 'invite' ? 'You\'re invited to SetMe' : 'Your SetMe password reset', text: [...lines, '', 'SetMe'].join('\n') };
}
