// Run: node tests/test_paste.mjs
import { matchPasted } from '../site/js/paste.mjs';

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
const { matched, unmatched } = matchPasted(text, players);
const got = matched.map(m => m.player.name);
const want = ['Reem', 'Mishal', 'HQ', 'Fuwaires', 'Nasser', 'Adi', 'Abdullah H', 'Abdullah', 'Abdullah + 1', 'Aziz Z', 'Ahmed A', 'MT', 'JC', 'Ali'];
let fail = 0;
for (const w of want) if (!got.includes(w)) { fail++; console.log('FAIL missing', w); }
if (got.length !== want.length) { fail++; console.log('FAIL count', got.length, got); }
const wantUnmatched = ['Volleyball Thursday 9pm 🏐', 'Unknown Guy'];
if (JSON.stringify(unmatched) !== JSON.stringify(wantUnmatched)) { fail++; console.log('FAIL unmatched', unmatched); }
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
if (g.unmatched.length !== 3) { fail++; console.log('FAIL group unmatched', g.unmatched); }
console.log(fail ? `${fail} checks failed` : 'all checks passed');
process.exit(fail ? 1 : 0);
