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
  player: 'Sign up for game days, see your teams, and watch videos of the games.',
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

// Many emails at once (Resend's batch: up to 100 a call) -> how many were sent. Returns 0 when email isn't set up.
export async function sendBatch(messages, env = process.env, fetcher = (...a) => fetch(...a)) {
  if (!emailReady(env) || !messages.length) return 0;
  const from = env.RESEND_FROM || 'SetMe <onboarding@resend.dev>';
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const part = messages.slice(i, i + 100);
    const res = await fetcher('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(part.map(({ to, subject, text, html }) => ({ from, to: [to], subject, text, ...(html ? { html } : {}) }))),
    });
    if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(`Emails not sent: ${body.message || body.error || res.status}`); }
    sent += part.length;
  }
  return sent;
}

// Club emails (supabase/emails.sql): kind 'videos' (a game's video is ready to watch) or 'tags' (a game is fully
// tagged). Who gets one: everyone who may watch the game (organizers, the super, players and raters once the day is
// published), with an email address, who hasn't turned that kind off, except `skip` (the uploader, who
// gets their own email). profiles: [{ id, email, role }], prefs: [{ user_id, videos, tags }].
export const CLUB_KINDS = ['videos', 'tags'];
export function clubRecipients({ kind, profiles, prefs, published, skip = null }) {
  const off = new Set(prefs.filter(p => p[kind] === false).map(p => p.user_id));
  const can = p => p.role === 'super' || p.role === 'organizer' || ((p.role === 'player' || p.role === 'rater') && published);
  return [...new Set(profiles.filter(p => p.email && can(p) && !off.has(p.id) && p.id !== skip).map(p => p.email))];
}
// -> { subject, text, html }. label: "Game 2 on Sat, Nov 21"; game: { a, b, sa, sb } (team names and scores), or null.
// The HTML is the club's look (site/style.css): navy header with the ball and the SetMe wordmark, the score as a
// scoreboard, one blue button. Tables and inline styles only, so Gmail, Outlook and Apple Mail all draw it; no images.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const BRAND = { navy: '#0f1630', blue: '#1d3fbf', ball: '#ffc531', ballFg: '#2a1f00', bg: '#f3f4f8', line: '#e3e6ef', muted: '#5d6680', display: "'Barlow Condensed','Arial Narrow',Arial,sans-serif", body: "Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif" };
export function clubEmail({ kind, label, game = null, link, settings }) {
  const video = kind === 'videos';
  const teams = game ? `${game.a} ${game.sa}–${game.sb} ${game.b}` : null;
  const subject = video ? `${label}: the video is up` : `${label}: the stats are up`;
  const lead = video ? `The video of ${label}${teams ? ` (${teams})` : ''} is ready to watch on Games.`
    : `${label}${teams ? ` (${teams})` : ''} has been tagged touch by touch. Its stats and box score are on Games.`;
  const text = [lead, '', link, '', `Don't want these? Turn them off in Settings: ${settings}`, '', 'SetMe'].join('\n');
  const B = BRAND, tag = video ? '▶ New video' : '★ Stats are up', button = video ? 'Watch the game' : 'See the stats';
  const sub = video ? 'Watch every rally, skip the breaks with Next rally, and catch the highlights.' : 'Every touch tagged: kills, aces, blocks, passes and the full box score.';
  const side = (name, pts, win) => `<td width="50%" align="center" style="padding:14px 8px;">
        <div style="font:600 14px/1.3 ${B.body};color:${win ? B.navy : B.muted};">${esc(name)}</div>
        <div style="font:800 44px/1.1 ${B.display};color:${win ? B.blue : B.muted};">${esc(pts)}</div></td>`;
  const board = game ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${B.bg};border-radius:12px;margin:18px 0 22px;">
      <tr>${side(game.a, game.sa, game.sa > game.sb)}<td style="font:700 22px ${B.display};color:${B.muted};">–</td>${side(game.b, game.sb, game.sb > game.sa)}</tr></table>` : '<div style="height:18px"></div>';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${esc(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Inter:wght@400;600&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:${B.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(sub)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${B.bg};"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${B.line};">
    <tr><td style="background:${B.navy};padding:18px 24px;border-bottom:4px solid ${B.ball};">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="width:26px;height:26px;background:${B.ball};border-radius:13px;font-size:0;line-height:0;">&nbsp;</td>
        <td style="padding-left:10px;font:800 28px/1 ${B.display};color:#ffffff;letter-spacing:.3px;">Set<span style="color:${B.ball};">Me</span></td>
      </tr></table></td></tr>
    <tr><td style="padding:26px 24px 8px;">
      <span style="display:inline-block;background:${B.ball};color:${B.ballFg};font:700 12px/1 ${B.body};text-transform:uppercase;letter-spacing:.8px;padding:6px 10px;border-radius:999px;">${tag}</span>
      <h1 style="margin:14px 0 6px;font:800 30px/1.1 ${B.display};color:${B.navy};text-transform:uppercase;letter-spacing:.3px;">${esc(label)}</h1>
      <p style="margin:0;font:400 15px/1.5 ${B.body};color:${B.muted};">${esc(sub)}</p>
      ${board}
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="border-radius:10px;background:${B.blue};">
        <a href="${esc(link)}" style="display:block;padding:14px 20px;font:700 17px/1 ${B.body};color:#ffffff;text-decoration:none;">${button} →</a></td></tr></table>
    </td></tr>
    <tr><td style="padding:22px 24px 24px;"><p style="margin:0;font:400 12px/1.5 ${B.body};color:${B.muted};border-top:1px solid ${B.line};padding-top:16px;">
      You get this because you're in the club on SetMe. <a href="${esc(settings)}" style="color:${B.blue};">Turn these emails off in Settings</a>.</p></td></tr>
  </table></td></tr></table></body></html>`;
  return { subject, text, html };
}
