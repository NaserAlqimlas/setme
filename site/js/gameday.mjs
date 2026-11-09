// A game day's life, as rules. Pure: no DOM, no Supabase, so it's tested on its own (tests/test_gameday.mjs) and
// every page asks here instead of re-deriving it. Map of this and the app's other state machines: docs/state-machines.md.
//
//   date ahead ── upcoming ──(the day)── today ──(next day)── past ──(TAG_DAYS later)── tagging closed (read only)
//                       \___________________ End the day ⇄ Reopen: ended (any time; score entry gives way to standings)
//
// What each phase allows:
//   Delete day        upcoming, today (once the date has passed the day stays, for records and attendance)
//   Enter scores      while not ended
//   Tag a game        until TAG_DAYS after the day; the super any time. After that: View tags (read only)
//   Start a round     not ended, and the round playing now has games
//   Back a round      round 2 or later with no games in it yet

// Tagging closes this many days after a game day, except for the super. The database enforces the same rule:
// tag_open() in supabase/tag_window.sql (keep the 3 there in step).
export const TAG_DAYS = 3;

const DAY = 864e5;
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

// 'upcoming' | 'today' | 'past' | 'ended'. Dates are 'YYYY-MM-DD' (local game day, compared as text).
export function dayPhase({ playedOn, ended = false, today }) {
  if (ended) return 'ended';
  return playedOn > today ? 'upcoming' : playedOn === today ? 'today' : 'past';
}

// Tagging for a game day: 'open' (tag and change) or 'read-only' (View tags), and the last day it's open.
export function tagWindow({ playedOn, today, role }) {
  const until = addDays(playedOn, TAG_DAYS);
  return { mode: role === 'super' || today <= until ? 'open' : 'read-only', until };
}

// One game's Tag button: 'tag' (open, nothing yet or more to add), 'view' (read only, has tags),
// 'closed' (read only, nothing tagged), 'upgrade' (match_stats.sql not run: tags is null).
export function tagButton(window, tagged) {
  if (tagged == null) return 'upgrade';
  return window.mode === 'open' ? 'tag' : tagged > 0 ? 'view' : 'closed';
}

// Everything the Scores page needs to know about one game day, in one place.
// round: the round playing now; gamesInRound: games entered in it; hasRounds: rounds.sql has run.
export function dayState({ playedOn, ended = false, today, role, round = 1, gamesInRound = 0, hasRounds = false }) {
  const phase = dayPhase({ playedOn, ended, today });
  return {
    phase,
    canDelete: playedOn >= today,
    entry: ended ? 'final' : 'open',
    canStartRound: hasRounds && !ended && gamesInRound > 0,
    canGoBackRound: round > 1 && gamesInRound === 0,
    tagging: tagWindow({ playedOn, today, role }),
  };
}

// One player's place on a game day's sign-up list (signups in the order they came, cap = spots):
// { kind: 'out' } | { kind: 'in', place } | { kind: 'waitlist', place } (place from 1; the waitlist counts from 1 too).
// The waitlist moves up on its own: dropping out shortens the list, so the next person falls inside the cap.
export function signupStatus(list, cap, playerId) {
  const at = list.findIndex(x => x.player_id === playerId);
  if (at < 0) return { kind: 'out' };
  return at < cap ? { kind: 'in', place: at + 1 } : { kind: 'waitlist', place: at - cap + 1 };
}

// What Save does on Teams for the picked date: 'no-date' (Save for scores), 'saved' (these are the saved teams:
// nothing to do), 'new' (nothing saved yet), 'replace' (other teams saved, no games: overwrite them),
// 'new-round' (other teams saved with games: ask whether to start a new round or replace).
// saved: { key, games } for that date, or null; shownKey: the teams on screen (lineupKey), or null.
export function saveIntent({ gameDate, saved, shownKey }) {
  if (!gameDate) return 'no-date';
  if (!saved) return 'new';
  if (shownKey && shownKey === saved.key) return 'saved';
  return saved.games ? 'new-round' : 'replace';
}

// Saving tags on the tag screen. One state at a time, so the status line can't say two things:
//   saved ──change──▶ unsaved ──(1.5 s)──▶ saving ──ok──▶ saved (or unsaved, if changed meanwhile)
//                                            └──error──▶ failed ──(10 s)──▶ saving …
// A change in any state means unsaved (also while a save is on its way: that save doesn't carry it). Changes stay
// on this device (localStorage) until a save that carries them goes through.
export const SYNC = ['saved', 'unsaved', 'saving', 'failed'];
export function syncNext(state, event, { dirty = false } = {}) {
  switch (event) {
    case 'change': return 'unsaved';
    case 'save': return 'saving';
    case 'ok': return dirty ? 'unsaved' : 'saved';
    case 'error': return 'failed';
    default: throw new Error(`syncNext: unknown event ${event}`);
  }
}
