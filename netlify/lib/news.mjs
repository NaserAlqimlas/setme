// Club emails about one game (netlify/lib/email.mjs clubRecipients, clubEmail): its video is ready, or it's fully
// tagged. Used by video-worker (video ready) and notify (tagged). Never throws on a missing table: before
// supabase/emails.sql nothing goes out.
import { rest } from './supabase.mjs';
import { clubEmail, clubRecipients, sendBatch } from './email.mjs';
import { gameLabel } from './video.mjs';
import { teamsOf } from './gamedays.mjs';
import { teamNames } from '../../site/js/teams.mjs';

export async function tellClub({ kind, gameId, origin, skip = null }) {
  const prefs = await rest('email_prefs?select=user_id,videos,tags').catch(() => null);
  if (!prefs) return 0;   // emails.sql not run yet
  const [g] = await rest(`games?id=eq.${Number(gameId)}&select=*`);
  if (!g) return 0;
  const [[s], day, rounds, players, profiles] = await Promise.all([
    rest(`sessions?id=eq.${g.session_id}&select=*`),
    rest(`games?session_id=eq.${g.session_id}&select=id&order=created_at`),
    rest(`rounds?session_id=eq.${g.session_id}&select=*`).catch(() => []),
    rest('players?select=id,name,setting'),
    rest('profiles?select=id,email,role'),
  ]);
  if (!s) return 0;
  const to = clubRecipients({ kind, profiles, prefs, published: !!s.published, skip });
  if (!to.length) return 0;
  const label = gameLabel(day.findIndex(x => x.id === g.id) + 1, s.played_on);
  let game = null;
  try {
    const t = teamsOf(s, rounds, g.round ?? 1), pl = new Map(players.map(p => [p.id, p]));
    const names = teamNames((t?.teams ?? []).map(ids => (Array.isArray(ids) ? ids : []).map(id => pl.get(id)).filter(Boolean)), new Set(t?.all_game ?? []), t?.captains);
    game = { a: names[g.team_a - 1] ?? `Team ${g.team_a}`, b: names[g.team_b - 1] ?? `Team ${g.team_b}`, sa: g.score_a, sb: g.score_b };
  } catch { /* the label alone */ }
  const msg = clubEmail({ kind, label, game, link: `${origin}/#games`, settings: `${origin}/#settings` });
  return sendBatch(to.map(email => ({ to: email, ...msg })));
}
