// Run: node tests/test_scores.mjs
import { margin25, analyze, playerStats, nextPairing, MIN_FIT } from '../site/js/scores.mjs';
import { SKILLS, WEIGHTS } from '../site/js/teams.mjs';

let fail = 0;
const ok = (title, cond, ...info) => { if (!cond) { fail++; console.log('FAIL', title, ...info); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// Margins: full games as played; time-up games scaled to a game to 25.
ok('full game', margin25(25, 20) === 5);
ok('deuce', margin25(27, 25) === 2);
ok('time up scaled', near(margin25(12, 8), 25 - 25 * 8 / 12), margin25(12, 8));
ok('0-0', margin25(0, 0) === 0);

// Round robin: 4 teams start with the share image's courts, then every pair before repeating.
const play = (n, k) => { const gs = []; for (let i = 0; i < k; i++) { const [a, b] = nextPairing(n, gs); gs.push({ team_a: a, team_b: b }); } return gs.map(g => `${g.team_a}v${g.team_b}`); };
ok('4 teams', play(4, 7).join() === '1v2,3v4,1v4,2v3,1v3,2v4,1v2', play(4, 7));
ok('3 teams', new Set(play(3, 3)).size === 3, play(3, 3));
ok('2 teams', play(2, 3).join() === '1v2,1v2,1v2');

// Fake games where the true weights differ from the current ones: hitting matters twice as much as we say.
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const TRUE = { ...WEIGHTS, hitting: WEIGHTS.hitting * 2, blocking: 0 };
const team = () => { const sums = Object.fromEntries(SKILLS.map(s => [s, 3 + rnd() * 1.5])); sums.setting = 0;
  return { sums, weighted: SKILLS.reduce((a, s) => a + sums[s] * WEIGHTS[s], 0), size: 6, women: 1, setters: 1, unrated: 0 }; };
const games = [];
for (let i = 0; i < 400; i++) {
  const a = team(), b = team();
  const m = SKILLS.reduce((x, s) => x + (a.sums[s] - b.sums[s]) * TRUE[s], 0) * 6 + (rnd() - .5) * 4;
  const win = Math.min(23, Math.round(Math.abs(m)));
  games.push({ session_id: i % 10, team_a: 1, team_b: 2, players_a: [1, 2], players_b: [3, 4], predicted: { a, b },
    score_a: m > 0 ? 25 : 25 - win, score_b: m > 0 ? 25 - win : 25 });
}
const r = analyze(games);
ok('count', r.n === 400 && r.sessions === 10);
ok('favourite usually wins', r.favWon > .75, r.favWon);
ok('k positive', r.k > 0, r.k);
ok('hitting weight goes up', r.weights.hitting > WEIGHTS.hitting * 1.3, r.weights);
ok('blocking weight goes down', r.weights.blocking < WEIGHTS.blocking, r.weights);
ok('same total', near(SKILLS.reduce((a, s) => a + r.weights[s], 0), SKILLS.reduce((a, s) => a + WEIGHTS[s], 0)));
ok('hitting has the strongest link', r.factors.filter(f => SKILLS.includes(f.key)).sort((x, y) => y.r - x.r)[0].key === 'hitting', r.factors.map(f => [f.key, f.r]));
ok('no weights below the minimum', analyze(games.slice(0, MIN_FIT - 1)).weights === null);
ok('games without a prediction skipped', analyze([{ ...games[0], predicted: null }]).n === 0);

// Players: team A always wins by 5 with no gap, so A's players are +5 vs ratings and B's -5.
const even = team();
const fixed = Array.from({ length: 4 }, () => ({ players_a: [1], players_b: [2], score_a: 25, score_b: 20, predicted: { a: even, b: even } }));
const ps = new Map(playerStats(fixed, 3).map(p => [p.id, p]));
ok('player plus', ps.get(1).over === 5 && ps.get(1).wins === 4 && ps.get(2).over === -5 && ps.get(2).games === 4, [...ps.values()]);

console.log(fail ? `${fail} failed` : 'ok');
process.exit(fail ? 1 : 0);
