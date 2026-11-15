// The Games page: which game days and games each person sees, numbered and with team names.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDays } from '../netlify/lib/gamedays.mjs';

const players = [{ id: 1, name: 'Ali', setting: 'M' }, { id: 2, name: 'Sara', setting: 'M' }, { id: 3, name: 'Omar' }, { id: 4, name: 'Dana' }, { id: 5, name: 'Noor' }];
const sessions = [
  { id: 10, played_on: '2026-11-03', published: true, teams: [[1, 3], [2, 4]], all_game: [] },
  { id: 11, played_on: '2026-11-10', published: false, teams: [[1, 4], [2, 3]], all_game: [] },
];
const games = [
  { id: 101, session_id: 10, created_at: '1', team_a: 1, team_b: 2, players_a: [1, 3], players_b: [2, 4], score_a: 25, score_b: 20 },
  { id: 102, session_id: 10, created_at: '2', team_a: 1, team_b: 2, players_a: [1, 5], players_b: [2, 4], score_a: 18, score_b: 25 },
  { id: 103, session_id: 11, created_at: '1', team_a: 1, team_b: 2, players_a: [1, 4], players_b: [2, 3], score_a: 25, score_b: 23 },
];

test('organizers see every game day and game, newest first, with team names from the setters', () => {
  const days = buildDays({ sessions, games, players, tagged: new Map([[101, 45]]), videos: new Set([101]), unrecorded: new Set([101]), me: { role: 'organizer' } });
  assert.deepEqual(days.map(d => d.played_on), ['2026-11-10', '2026-11-03']);
  const g = days[1].games[0];
  assert.deepEqual([g.n, g.a.name, g.b.name, g.a.score, g.tagged, g.video, g.not_recorded], [1, "Ali's Team", "Sara's Team", 25, 45, true, true]);
  assert.deepEqual(g.a.players.map(p => p.name), ['Ali', 'Omar']);
});

test('a player sees only games they played in, on published days, numbered as on the day', () => {
  const days = buildDays({ sessions, games, players, me: { role: 'player', player_id: 3 } });
  assert.equal(days.length, 1);                                   // Nov 10 isn't published
  assert.deepEqual(days[0].games.map(g => [g.id, g.n, g.mine]), [[101, 1, 'a']]);   // not game 2: they sat out
  assert.deepEqual(buildDays({ sessions, games, players, me: { role: 'player', player_id: 5 } })[0].games.map(g => g.n), [2]);
  assert.deepEqual(buildDays({ sessions, games, players, me: { role: 'player', player_id: 99 } }), []);
});

test('an earlier round keeps its own team names', () => {
  const rounds = [{ session_id: 10, n: 1, teams: [[3, 1], [4, 5]], all_game: [] }];
  const later = { ...games[1], round: 2 }, first = { ...games[0], round: 1 };
  const days = buildDays({ sessions: [{ ...sessions[0], teams: [[2, 3], [1, 4]] }], rounds, games: [first, later], players, me: { role: 'super' } });
  assert.deepEqual(days[0].games.map(g => [g.a.name, g.b.name]), [["Ali's Team", 'Team 2'], ["Sara's Team", "Ali's Team"]]);
});
