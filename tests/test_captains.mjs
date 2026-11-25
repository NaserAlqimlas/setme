// Team captains: a picked captain names their team (captains.sql).
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('team captains name their team; a captain who moved doesn\'t; marked captains from the lineup list count too', async () => {
  const { teamNames } = await import('../site/js/teams.mjs');
  const teams = [[{ id: 1, name: 'Sara', setting: 'M' }, { id: 2, name: 'Omar' }], [{ id: 3, name: 'Lina', setting: 'B' }, { id: 4, name: 'Ali' }]];
  assert.deepEqual(teamNames(teams), ['Sara\'s Team', 'Lina\'s Team']);                    // no captains: setters
  assert.deepEqual(teamNames(teams, new Set(), [2, null]), ['Omar\'s Team', 'Lina\'s Team']);
  assert.deepEqual(teamNames(teams, new Set(), [4, 4]), ['Sara\'s Team', 'Ali\'s Team']);    // 4 isn't on team 1
  assert.deepEqual(teamNames(teams, new Set(), ['2', null]), ['Omar\'s Team', 'Lina\'s Team']); // ids from JSON
  const listed = [[{ id: 1, name: 'Sara', setting: 'M' }, { id: 2, name: 'Omar', captain: true }], teams[1]];
  assert.deepEqual(teamNames(listed), ['Omar\'s Team', 'Lina\'s Team']);
  assert.deepEqual(teamNames([[{ id: 1, name: 'Sam' }], [{ id: 2, name: 'Sam' }]], new Set(), [1, 2]), ['Team 1', 'Team 2']);   // same name twice
});
