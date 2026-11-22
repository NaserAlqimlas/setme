// The Games page's data (netlify/functions/game-view.mjs): game days and their games as the caller may see them.
// Kept apart from the network so it can be tested. Organizers and the super see every game; players and raters see every
// game on published game days (decided 2026-11-22; before, only the games they played in), with everyone's tagged stats.
import { teamNames } from '../../site/js/teams.mjs';

// A round's teams: an earlier round's from rounds, the round playing now from the session (as on Scores).
export const teamsOf = (session, rounds, n) => rounds.find(r => r.session_id === session.id && r.n === n) ?? session;

// -> [{ session_id, played_on, games: [{ id, n, round, a: { k, name, players: [{ id, name }] , score }, b: {...}, tagged, video, not_recorded, mine }] }],
// newest day first, games in the order played. me: { role, player_id }.
export function buildDays({ sessions, rounds = [], games, players, tagged = new Map(), videos = new Set(), unrecorded = new Set(), me }) {
  const pl = new Map(players.map(p => [p.id, p]));
  const pid = Number(me.player_id);
  const isPlayer = me.role === 'player' || me.role === 'rater';   // published game days only
  return sessions
    .filter(s => !isPlayer || s.published)
    .map(s => {
      const all = games.filter(g => g.session_id === s.id).sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)));
      const names = new Map();
      const nameOf = (round, k) => {
        if (!names.has(round)) {
          const t = teamsOf(s, rounds, round);
          names.set(round, teamNames((t?.teams ?? []).map(team => (Array.isArray(team) ? team : []).map(id => pl.get(id)).filter(Boolean)), new Set(t?.all_game ?? [])));
        }
        return names.get(round)[k - 1] ?? `Team ${k}`;
      };
      const side = (g, k, ids, score) => ({ k, name: nameOf(g.round ?? 1, k), score, players: ids.map(id => ({ id, name: pl.get(id)?.name ?? 'Someone' })) });
      return { session_id: s.id, played_on: s.played_on, games: all.map((g, i) => ({ g, n: i + 1 })).map(({ g, n }) => ({
        id: g.id, n, round: g.round ?? 1,
        a: side(g, g.team_a, g.players_a, g.score_a), b: side(g, g.team_b, g.players_b, g.score_b),
        tagged: tagged.get(g.id) ?? 0, video: videos.has(g.id), not_recorded: unrecorded.has(g.id),
        mine: Number.isInteger(pid) && (g.players_a.map(Number).includes(pid) || g.players_b.map(Number).includes(pid)) ? (g.players_a.map(Number).includes(pid) ? 'a' : 'b') : null,
      })) };
    })
    .filter(d => d.games.length)
    .sort((x, y) => y.played_on.localeCompare(x.played_on));
}
