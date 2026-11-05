// Run: node tests/test_teamnames.mjs
import { teamNames } from '../site/js/teams.mjs';

let fail = 0;
const eq = (got, want, msg) => { if (JSON.stringify(got) !== JSON.stringify(want)) { fail++; console.log('FAIL', msg, JSON.stringify(got)); } };
const p = (id, name, setting = 'N', extra = {}) => ({ id, name, setting, ...extra });

eq(teamNames([[p(1, 'Nasser', 'M'), p(2, 'Adi')], [p(3, 'Reem'), p(4, 'HQ')]]), ["Nasser's Team", 'Team 2'], 'setter names the team; no setter keeps the number');
eq(teamNames([[p(1, 'Reem', 'B'), p(2, 'Mishal', 'M')]]), ["Mishal's Team"], 'main setter before backup');
eq(teamNames([[p(1, 'Reem', 'B'), p(2, 'Mishal', 'M')]], new Set([1])), ["Reem's Team"], 'all-game setter first');
eq(teamNames([[p(1, 'Reem', 'B', { allGame: true }), p(2, 'Mishal', 'M')]]), ["Reem's Team"], 'allGame flag on the player counts');
eq(teamNames([[p(1, 'Sara', 'M'), p(2, 'Lana', 'M')]]), ["Sara's Team"], 'two mains: first listed');
eq(teamNames([[p(1, 'Ali', 'M')], [p(2, 'Ali', 'M')]]), ['Team 1', 'Team 2'], 'same name twice keeps numbers');
eq(teamNames([[undefined, p(1, 'Ali', 'M')], [], null]), ["Ali's Team", 'Team 2', 'Team 3'], 'missing players and empty teams');

if (fail) { console.log(`${fail} failed`); process.exit(1); } else console.log('ok');
