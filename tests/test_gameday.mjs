// Run: node tests/test_gameday.mjs
// A game day's rules (gameday.mjs): phases, the tagging window, the Tag button, rounds, what Save does, save status.
import { dayPhase, dayState, saveIntent, signupStatus, SYNC, syncNext, TAG_DAYS, tagButton, tagWindow } from '../site/js/gameday.mjs';

let fail = 0;
const ok = (title, cond, ...info) => { if (!cond) { fail++; console.log('FAIL', title, ...info); } };

// Phases.
ok('upcoming', dayPhase({ playedOn: '2026-11-10', today: '2026-11-09' }) === 'upcoming');
ok('today', dayPhase({ playedOn: '2026-11-09', today: '2026-11-09' }) === 'today');
ok('past', dayPhase({ playedOn: '2026-11-01', today: '2026-11-09' }) === 'past');
ok('ended wins over the date', dayPhase({ playedOn: '2026-11-10', ended: true, today: '2026-11-09' }) === 'ended');

// Tagging window: open through TAG_DAYS after the day (same as tag_open in tag_window.sql), the super always.
ok('three days', TAG_DAYS === 3);
const w = (playedOn, today, role = 'organizer') => tagWindow({ playedOn, today, role });
ok('open on the day', w('2026-11-05', '2026-11-05').mode === 'open');
ok('open on the last day', w('2026-11-05', '2026-11-08').mode === 'open' && w('2026-11-05', '2026-11-08').until === '2026-11-08');
ok('closed the day after', w('2026-11-05', '2026-11-09').mode === 'read-only');
ok('month end', w('2026-10-30', '2026-11-02').mode === 'open' && w('2026-10-30', '2026-11-03').mode === 'read-only');
ok('super any time', w('2026-01-01', '2026-11-09', 'super').mode === 'open');

// Tag button.
const open = { mode: 'open' }, shut = { mode: 'read-only' };
ok('tag', tagButton(open, 0) === 'tag' && tagButton(open, 12) === 'tag');
ok('view', tagButton(shut, 12) === 'view');
ok('closed', tagButton(shut, 0) === 'closed');
ok('upgrade', tagButton(open, null) === 'upgrade' && tagButton(shut, null) === 'upgrade');

// The whole day.
const d = (o = {}) => dayState({ playedOn: '2026-11-09', today: '2026-11-09', role: 'organizer', ...o });
ok('delete today and ahead', d().canDelete && d({ playedOn: '2026-11-12' }).canDelete && !d({ playedOn: '2026-11-08' }).canDelete);
ok('entry open until ended', d().entry === 'open' && d({ ended: true }).entry === 'final');
ok('start a round once games are in', !d().canStartRound && !d({ gamesInRound: 2 }).canStartRound
  && d({ gamesInRound: 2, hasRounds: true }).canStartRound && !d({ gamesInRound: 2, hasRounds: true, ended: true }).canStartRound);
ok('back a round before any game', d({ round: 2 }).canGoBackRound && !d({ round: 2, gamesInRound: 1 }).canGoBackRound && !d().canGoBackRound);
ok('tagging comes along', d({ playedOn: '2026-11-01' }).tagging.mode === 'read-only');

// Sign-up place.
const L = [1, 2, 3, 4].map(player_id => ({ player_id }));
ok('out', signupStatus(L, 3, 9).kind === 'out');
ok('in', JSON.stringify(signupStatus(L, 3, 3)) === '{"kind":"in","place":3}');
ok('waitlist', JSON.stringify(signupStatus(L, 3, 4)) === '{"kind":"waitlist","place":1}');
ok('moves up when someone drops', signupStatus(L.filter(x => x.player_id !== 1), 3, 4).kind === 'in');

// What Save does on Teams.
const s = (o = {}) => saveIntent({ gameDate: '2026-11-09', saved: null, shownKey: '1,2|3,4', ...o });
ok('no date', s({ gameDate: '' }) === 'no-date');
ok('new', s() === 'new');
ok('saved', s({ saved: { key: '1,2|3,4', games: 3 } }) === 'saved');
ok('replace', s({ saved: { key: '1,3|2,4', games: 0 } }) === 'replace');
ok('new round', s({ saved: { key: '1,3|2,4', games: 2 } }) === 'new-round');
ok('nothing on screen yet', s({ saved: { key: null, games: 0 }, shownKey: null }) === 'replace');

// Save status on the tag screen.
ok('states', SYNC.join() === 'saved,unsaved,saving,failed');
ok('change', ['saved', 'unsaved', 'saving', 'failed'].every(st => syncNext(st, 'change') === 'unsaved'));
ok('save', syncNext('unsaved', 'save') === 'saving' && syncNext('failed', 'save') === 'saving');
ok('ok', syncNext('saving', 'ok') === 'saved' && syncNext('saving', 'ok', { dirty: true }) === 'unsaved');
ok('error', syncNext('saving', 'error') === 'failed');
let threw = false; try { syncNext('saved', 'nope'); } catch { threw = true; }
ok('unknown event throws', threw);

console.log(fail ? `${fail} failed` : 'gameday: all passed');
process.exit(fail ? 1 : 0);
