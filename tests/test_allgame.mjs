// Run: node tests/test_allgame.mjs
import { teamSkills, strength, weightedTotal, buildTeams, teamProblems, combineRatings, SETTING_WEIGHT } from '../site/js/teams.mjs';

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('FAIL', m); } };
const row = (pid, v, set = null) => ({ rater_id: 'A', player_id: pid, receiving: v, hitting: v, hustle: v, serve: v, blocking: v, setting_skill: set, consistency: .5 });

// Two main setters (1: great setter, 2: weak setter), a backup (3) with no setting rating, everyone else plays.
const players = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, gender: 'M', setting: i < 2 ? 'M' : i === 2 ? 'B' : 'N' }));
const ratings = [row(1, .5, 1), row(2, .5, .25), row(3, .5), row(4, .25), ...[5, 6, 7, 8].map(id => row(id, .75))];
const { combined } = combineRatings(players, ratings);

const none = teamSkills(players, combined, new Set());
ok(strength(none.get(1)) === weightedTotal(combined.get(1).skills), 'not all game: counts as rated, setting ignored');
const sk = teamSkills(players, combined, new Set([1, 2, 3]));
const p1 = sk.get(1);
ok(p1.receiving === .25 && p1.hitting === .125 && p1.serve === .5 && p1.setEff === 1, 'all game: receiving x.5, hitting x.25, setting counts');
ok(Math.abs(strength(p1) - (weightedTotal(p1) + SETTING_WEIGHT)) < 1e-9, 'strength adds setting');
ok(strength(sk.get(1)) > strength(sk.get(2)), 'better setter worth more when setting all game');
ok(sk.get(3).setEff === (1 + .25) / 2, 'unrated setting = setters average');

// Weak passers: a setter who sets all game isn't counted even with low receiving.
const lowSetter = combineRatings(players, [row(1, .25, .5), ...ratings.slice(1)]).combined;
const t = [[1, 2, 3, 4], [5, 6, 7, 8]].map(ids => ids.map(id => players[id - 1]));
const weakNone = teamProblems(t, teamSkills(players, lowSetter, new Set()), []).find(x => x.key === 'spread:weak');
const weakAll = teamProblems(t, teamSkills(players, lowSetter, new Set([1])), []).find(x => x.key === 'spread:weak');
ok(weakNone && !weakAll, 'all-game setter not a weak passer');

// Builder: with both mains setting all game, each team gets one, and the team with the weak setter gets more help.
const playing = players.map(p => ({ ...p, unrated: false }));
const res = buildTeams({ players: playing, skills: sk, numTeams: 2, maxRestarts: 400, timeBudgetMs: 1e9 });
const best = res.options[0].teams;
ok(best.every(t => t.players.filter(p => p.setting === 'M').length === 1), 'one main setter per team');
ok(best.every(t => t.sums.setting > 0) && Math.abs(best[0].weighted - best[1].weighted) < 1, `balanced with setting counted: ${best.map(t => t.weighted)}`);
ok(best.find(t => t.players.some(p => p.id === 1)).players.every(p => p.allGame === (p.id === 1 || p.id === 3) || p.setting === 'N'), 'allGame flag on players');

console.log(fail ? `${fail} failed` : 'ok');
process.exit(fail ? 1 : 0);
