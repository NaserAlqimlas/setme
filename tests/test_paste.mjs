// Run: node tests/test_paste.mjs
import { matchPasted, closestPlayers } from '../site/js/paste.mjs';

const names = ['Reem', 'Mishal', 'HQ', 'Fuwaires', 'Nasser', 'Adi', 'Abdullah H', 'Abdullah', 'Abdullah + 1', 'Aziz Z', 'Ahmed A', 'MT', 'JC', 'Ali'];
const players = names.map((name, id) => ({ id, name }));
const text = `Volleyball Thursday 9pm 🏐
1. Reem ✅
2) mishal
3- HQ
- Fuwaires 🔥
• Nasser
6.Adi
7. Abdullah Hamad
8. Abdullah
9. Abdullah +1
10. aziz z
11. Ahmed A.
12. ⁠MT⁠
[31/10/2026, 12:01] Nasser: JC
Ali
Ali
13. Unknown Guy

`;
const { matched, unmatched, skipped } = matchPasted(text, players);
const got = matched.map(m => m.player.name);
const want = ['Reem', 'Mishal', 'HQ', 'Fuwaires', 'Nasser', 'Adi', 'Abdullah H', 'Abdullah', 'Abdullah + 1', 'Aziz Z', 'Ahmed A', 'MT', 'JC', 'Ali'];
let fail = 0;
for (const w of want) if (!got.includes(w)) { fail++; console.log('FAIL missing', w); }
if (got.length !== want.length) { fail++; console.log('FAIL count', got.length, got); }
// The heading line is skipped, not reported; a numbered unknown name is.
if (JSON.stringify(unmatched) !== JSON.stringify(['Unknown Guy'])) { fail++; console.log('FAIL unmatched', unmatched); }
if (JSON.stringify(skipped) !== JSON.stringify(['Volleyball Thursday 9pm 🏐'])) { fail++; console.log('FAIL skipped', skipped); }
for (const m of matched) console.log(`${m.line.padEnd(22)} -> ${m.player.name}`);

// The group's real format, with a waitlist.
const roster = ['Reem', 'Mishal', 'HQ', 'Fuwaires', 'Nasser', 'Adi', 'Abdullah H', 'Ghala', 'Malaak', 'Shoug', 'Othman', 'JC', 'Abdullah', 'Yazan',
  'Yaser', 'Vuk', 'Jassim', 'Kamal', 'Ahmed A', 'Nayef', 'MT', 'Samer', 'Ajlan', 'Aziz Z', 'AQ', 'Abdullah + 1', 'Ali'].map((name, id) => ({ id, name }));
const group = `Saturday Oct. 31 🎃👻
Al Arabi - Mansouriya
6-8 PM

1. Reem
2. Mishal
3. HQ
4. Fuwaires 
5. Nasser 
6. Adi
7. Abdullah H
8. Ghala
9. AQ
10. Shoug
11. Abdullah + 1
12. JC
13. Abdullah
14. Yazan
15. Yaser
16.  Ali
17. Jassim
18. Kamal
19. Ahmed A
20. Nayef
21. MT
22. Samer
23. Ajlan
24. Aziz Z
Waitlist
25. Vuk
26. Othman`;
const g = matchPasted(group, roster);
console.log(`group list: ${g.matched.length} playing, waitlist: ${g.waitlist.map(m => m.player.name).join(', ')}, unrecognized: ${JSON.stringify(g.unmatched)}`);
if (g.matched.length !== 24) { fail++; console.log('FAIL group count', g.matched.map(m => m.player.name)); }
if (g.waitlist.map(m => m.player.name).join() !== 'Vuk,Othman') { fail++; console.log('FAIL waitlist'); }
if (g.unmatched.length !== 0) { fail++; console.log('FAIL group unmatched', g.unmatched); }
if (g.skipped.length !== 3) { fail++; console.log('FAIL group skipped', g.skipped); }

// Guests: "Mishal +1" ticks Mishal and counts a guest; a player really called "Abdullah + 1" still matches;
// a bare "+1" is a guest with no host; an info line after the names is skipped.
const gx = matchPasted('1. Mishal +1\n2. Abdullah + 1\n3. +2\n4. Reem\nSee you at 8 PM', roster);
if (gx.matched.map(m => m.player.name).join() !== 'Mishal,Abdullah + 1,Reem') { fail++; console.log('FAIL guests matched', gx.matched.map(m => m.player.name)); }
if (JSON.stringify(gx.guests.map(x => [x.host?.name ?? null, x.n])) !== JSON.stringify([['Mishal', 1], [null, 2]])) { fail++; console.log('FAIL guests', gx.guests); }
if (gx.unmatched.length || gx.skipped.join() !== 'See you at 8 PM') { fail++; console.log('FAIL guests leftovers', gx.unmatched, gx.skipped); }

// Names matched by hand before (aliases) match from then on.
const al = matchPasted('1. Reem\n2. Abood\n3. Faw', roster, [{ alias: 'abood', player_id: roster.find(p => p.name === 'Abdullah').id }]);
if (al.matched.map(m => m.player.name).join() !== 'Reem,Abdullah' || al.unmatched.join() !== 'Faw') { fail++; console.log('FAIL aliases', al.matched.map(m => m.player.name), al.unmatched); }

// Suggestions for an unrecognized name: the closest names first.
const near = closestPlayers('Fuwairs', roster, 3).map(p => p.name);
if (near[0] !== 'Fuwaires') { fail++; console.log('FAIL closest', near); }
const near2 = closestPlayers('Abdulla', roster, 3).map(p => p.name);
if (!near2[0].startsWith('Abdullah')) { fail++; console.log('FAIL closest abdulla', near2); }
console.log(fail ? `${fail} checks failed` : 'all checks passed');
process.exit(fail ? 1 : 0);
