// Run: node tests/test_rallytimes.mjs
// Rally times from the vision tool: reading the file, and jumping between rallies on the tag screen.
import { jumpTo, parseRallyTimes, playAt, rallyAt } from '../site/js/rallytimes.mjs';

let fail = 0;
const check = (ok, msg, got) => { if (!ok) { fail++; console.log('FAIL', msg, got === undefined ? '' : JSON.stringify(got)); } };
const throws = (f, re) => { try { f(); return false; } catch (e) { return re.test(e.message); } };

const file = JSON.stringify({ version: 1, video: 'game.mp4', rallies: [{ start: 40, end: 52, confidence: .8 }, { start: 2.5, end: 9.8 }, { start: 14.5, end: 23 }, { start: 'x', end: 3 }, { start: 30, end: 29 }] });
const { video, rallies } = parseRallyTimes(file);
check(video === 'game.mp4', 'video name');
check(rallies.map(r => r.start).join() === '2.5,14.5,40', 'sorted, bad rows dropped', rallies);
check(throws(() => parseRallyTimes('nope'), /rally times file/), 'not JSON');
check(throws(() => parseRallyTimes('{"a":1}'), /rally times file/), 'wrong JSON');
check(throws(() => parseRallyTimes('{"rallies":[]}'), /No rallies/), 'empty');

check(jumpTo(rallies, 0, 1) === 0, 'next from the start');
check(jumpTo(rallies, 2.5, 1) === 1, 'next from a rally start goes on');
check(jumpTo(rallies, 20, 1) === 2, 'next from inside a rally');
check(jumpTo(rallies, 60, 1) === -1, 'no next after the last');
check(jumpTo(rallies, 20, -1) === 1, 'back goes to the start of this rally');
check(jumpTo(rallies, 14.6, -1) === 0, 'back from its start goes to the one before');
check(jumpTo(rallies, 1, -1) === -1, 'nothing before the first');
check(rallyAt(rallies, 20) === 1 && rallyAt(rallies, 12) === -1, 'which rally');

// playAt: a video that hasn't loaded yet plays inside the tap and jumps once it knows its length.
const fake = (readyState, duration = NaN) => { const ls = {}; return { readyState, duration, currentTime: 0, played: 0,
  addEventListener: (e, f) => { ls[e] = f; }, fire: e => ls[e]?.(), play() { this.played++; return Promise.resolve(); } }; };
let v = fake(0); playAt(v, 30);
check(v.currentTime === 0 && v.played === 1, 'plays at once, waits to jump');
v.duration = 600; v.fire('loadedmetadata');
check(v.currentTime === 30, 'jumps once loaded', v.currentTime);
v = fake(4, 600); playAt(v, -3); check(v.currentTime === 0, 'not before the start');
v = fake(4, 20); playAt(v, 30, false); check(v.currentTime === 19.5 && v.played === 0, 'not past the end, and only plays when asked', v.currentTime);

console.log(fail ? `${fail} checks failed` : 'all checks passed');
process.exit(fail ? 1 : 0);
