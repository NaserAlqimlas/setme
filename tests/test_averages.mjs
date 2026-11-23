// Club averages: the middle and usual range, above / about / below, and per-player numbers from ratings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { band, MIN_PLAYERS, ratingAverages, spread, statAverages } from '../site/js/averages.mjs';

test('spread: middle and thirds, and nothing with too few players', () => {
  assert.equal(spread([.5, .5, .75, null]), null);
  assert.deepEqual(spread([0, .25, .5, .5, .75, 1]), { mid: .5, low: .42, high: .58, n: 6 });
  assert.equal(MIN_PLAYERS, 6);
});

test('band: above and below need to clear the middle; ties with the middle are about average', () => {
  const s = spread([.25, .5, .5, .5, .75, .75, 1]);   // mid .5, low .5, high .75
  assert.deepEqual([.25, .5, .75, 1].map(v => band(v, s)), ['below', 'about', 'above', 'above']);
  assert.equal(band(null, s), null);
  assert.equal(band(.5, null), null);
  assert.equal(band(1, spread([0, 0, 0, 1, 1, 1]), true), 'below');   // lower is better
});

test('ratingAverages: each player as on their profile, the club over everyone with numbers', () => {
  const players = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, name: `P${i + 1}` }));
  const all = { receiving: .5, hitting: .5, hustle: .5, serve: .5, blocking: .5 };
  const ratings = players.flatMap(p => ['a', 'b'].map(r => ({ rater_id: r, player_id: p.id, ...all, receiving: p.id / 8 })));
  ratings.push({ rater_id: 'a', player_id: 99, ...all });   // not an active player: ignored
  const { players: list, club } = ratingAverages(players, ratings);
  assert.equal(list.length, 7);
  assert.equal(list[0].skills.receiving, .13);
  assert.equal(list[0].total, 2.13);
  assert.equal(club.skills.receiving.mid, .5);
  assert.equal(club.skills.setting_skill, null);             // nobody set
  assert.ok(club.weighted);
});

test('statAverages: only players with enough tagged games', () => {
  const row = (id, games, k) => ({ player_id: id, games, attack_3: k, attack_0: 0, attack_1: 0, attack_2: 10 - k });
  const rows = [1, 2, 3, 4, 5, 6].map(i => row(i, 3, i)).concat(row(7, 1, 10));
  const { players, club } = statAverages(rows);
  assert.equal(players.size, 6);
  assert.ok(!players.has(7));
  assert.equal(club.killRate.mid, .35);
  assert.equal(statAverages(rows, new Set([1, 2])).club.killRate, null);   // too few active
});
