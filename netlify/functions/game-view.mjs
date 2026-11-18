// POST /.netlify/functions/game-view — the Games page (site/js/pages/games.mjs).
//   { action: 'days' }        -> { days, me, highlights: { [session_id]: count }, bloopers: {...}, unscored }   game days and games the caller may
//      see (netlify/lib/gamedays.mjs), and how many highlights each day's reel has (every game that day; see highlights.mjs)
//   { action: 'game', game }  -> { rallies, video: { url, rallies, sound } | null, highlights: [{ id, start, end, label, kind }] | null,
//      dismissed: [{ t, kind }] | null }   highlights: null before highlights.sql. sound (the worker's sound scores) and
//      dismissed (suggestions the super turned down) are for suggesting highlights; dismissed only for the super.
//      rallies: the game's tags with touches, as stored (everyone's, for the box score); video: the uploaded copy to
//      watch (a link that expires) and the rally times found in it.
// Organizers and the super: every game. Players: games they played in, on published game days.
import { caller, json, rest } from '../lib/supabase.mjs';
import { r2 } from '../lib/r2.mjs';
import { buildDays } from '../lib/gamedays.mjs';
import { canWatch, LINK_SECONDS } from '../lib/video.mjs';

const enc = encodeURIComponent;
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
  me.player_id = await rest(`profiles?id=eq.${me.id}&select=player_id`).then(r => r[0]?.player_id ?? null, () => null);
  const body = await req.json().catch(() => ({}));
  // The super looking at the app as another role (site/js/ui.mjs viewingAs) gets what that role would get.
  if (me.role === 'super' && ['organizer', 'rater', 'player'].includes(body.view_as)) me.role = body.view_as;
  const isPlayer = me.role === 'player', pid = Number(me.player_id);
  if (!['player', 'organizer', 'super'].includes(me.role)) return json({ error: 'Games are for players, organizers and the super' }, 403);
  if (isPlayer && !Number.isInteger(pid)) return json({ days: [], me: { role: me.role, player_id: null } });

  try {
    if (body.action === 'days') {
      const games = await allRows(`games?select=id,session_id,team_a,team_b,score_a,score_b,players_a,players_b,created_at,round,video_kind,video_ref${isPlayer ? `&or=(players_a.cs.{${pid}},players_b.cs.{${pid}})` : ''}&order=id`)
        .catch(() => allRows(`games?select=id,session_id,team_a,team_b,score_a,score_b,players_a,players_b,created_at${isPlayer ? `&or=(players_a.cs.{${pid}},players_b.cs.{${pid}})` : ''}&order=id`));
      if (!games.length) return json({ days: [], me: { role: me.role, player_id: me.player_id } });
      const sids = [...new Set(games.map(g => g.session_id))];
      // For a player, the whole day's games are needed to number them; only theirs are sent back.
      const dayGames = isPlayer ? await allRows(`games?session_id=in.(${sids.join(',')})&select=id,session_id,team_a,team_b,score_a,score_b,players_a,players_b,created_at&order=id`) : games;
      const mineById = new Map(games.map(g => [g.id, g]));
      const merged = dayGames.map(g => mineById.get(g.id) ?? g);
      const ids = merged.map(g => g.id);
      const [sessions, rounds, players, rallies, jobs, unrecorded, marks] = await Promise.all([
        rest(`sessions?id=in.(${sids.join(',')})&select=*`),
        rest(`rounds?session_id=in.(${sids.join(',')})&select=session_id,n,teams,all_game`).catch(() => []),
        allRows('players?select=id,name,setting&order=id'),
        allRows(`rallies?game_id=in.(${ids.join(',')})&won_by=not.is.null&select=game_id&order=game_id`).catch(() => []),
        rest(`video_jobs?game_id=in.(${ids.join(',')})&status=eq.done&viewing_key=not.is.null&select=id,game_id`).catch(() => []),
        isPlayer ? [] : rest(`games?not_recorded=is.true&select=id`).catch(() => []),   // before not_recorded.sql: none
        // before suggestions.sql there's no kind: all highlights. Before highlights.sql: none.
        allRows(`highlights?game_id=in.(${ids.join(',')})&select=game_id,kind&order=game_id`)
          .catch(() => allRows(`highlights?game_id=in.(${ids.join(',')})&select=game_id&order=game_id`)).catch(() => []),
      ]);
      const dayOf = new Map(merged.map(g => [g.id, g.session_id])), highlights = {}, bloopers = {};
      for (const m of marks) { const sid = dayOf.get(m.game_id), to = m.kind === 'blooper' ? bloopers : highlights; to[sid] = (to[sid] ?? 0) + 1; }
      // The super: how many videos have no sound scores yet (analysed before they existed), to score them from Games.
      const unscored = me.role === 'super' ? await rest('video_jobs?status=eq.done&viewing_key=not.is.null&game_id=not.is.null&result->sound=is.null&select=id').then(r => r.length, () => 0) : 0;
      const tagged = new Map();
      for (const r of rallies) tagged.set(r.game_id, (tagged.get(r.game_id) ?? 0) + 1);
      const videos = new Set(jobs.filter(j => merged.find(g => g.id === j.game_id && g.video_kind === 'upload' && g.video_ref === j.id)).map(j => j.game_id));
      const days = buildDays({ sessions, rounds, games: merged, players, tagged, videos, unrecorded: new Set(unrecorded.map(g => g.id)), me });
      return json({ days, me: { role: me.role, player_id: me.player_id }, highlights, bloopers, unscored });
    }

    if (body.action === 'game') {
      const [g] = await rest(`games?id=eq.${Number(body.game)}&select=*,sessions(published)`);
      if (!g || !canWatch(me, g) || (isPlayer && !g.sessions?.published)) return json({ error: 'You can only see games you played in' }, 403);
      const rallies = await allRows(`rallies?game_id=eq.${g.id}&select=id,seq,video_t,serving,won_by,touches(seq,player_id,action,grade,video_t)&order=seq`).catch(() => []);
      let video = null;
      if (g.video_kind === 'upload' && g.video_ref) {
        const [job] = await rest(`video_jobs?id=eq.${enc(g.video_ref)}&select=status,viewing_key,result`).catch(() => []);
        const bucket = r2();
        if (job?.status === 'done' && job.viewing_key && bucket) video = { url: bucket.getUrl(job.viewing_key, LINK_SECONDS), rallies: job.result?.rallies ?? [],
          sound: isPlayer ? null : job.result?.sound ?? null };
      }
      const hl = f => rest(`highlights?game_id=eq.${g.id}&select=${f}&order=start_t`);
      const highlights = await hl('id,start_t,end_t,label,kind').catch(() => hl('id,start_t,end_t,label'))
        .then(r => r.map(x => ({ id: x.id, start: Number(x.start_t), end: Number(x.end_t), label: x.label ?? null, kind: x.kind ?? 'highlight' })), () => null);
      // Suggestions the super dismissed; null before suggestions.sql (then no suggestions are shown).
      const dismissed = me.role === 'super' ? await rest(`highlight_dismissed?game_id=eq.${g.id}&select=t,kind`).then(r => r.map(x => ({ t: Number(x.t), kind: x.kind })), () => null) : null;
      return json({ rallies, video, highlights, dismissed, tags_end: g.tags_end ?? null, middle: { set: !!g.middle_set, a: g.middle_a ?? null, b: g.middle_b ?? null } });
    }
  } catch (e) {
    return json({ error: e.message }, 400);
  }
  return json({ error: 'Unknown action' }, 400);
};
