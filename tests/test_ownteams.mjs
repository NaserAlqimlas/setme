// Run: node tests/test_ownteams.mjs
import { parseTeams } from '../site/js/paste.mjs';

const names = ['Reem', 'Mishal', 'HQ', 'Fuwaires', 'Nasser', 'Adi', 'Abdullah H', 'Abdullah', 'Aziz Z', 'Ahmed A', 'MT', 'JC'];
const players = names.map((name, id) => ({ id, name }));
let fail = 0;
const check = (title, text, want, extra = () => true) => {
  const res = parseTeams(text, players);
  const got = res.teams.map(t => t.players.map(p => p.name));
  const ok = JSON.stringify(got) === JSON.stringify(want) && extra(res);
  if (!ok) { fail++; console.log('FAIL', title, JSON.stringify(got), JSON.stringify(res.teams.map(t => t.unmatched)), res.dupes); }
};

// What "Copy text" produces, setter marks included.
check('copy text', 'Team 1: Reem (S), Mishal, HQ\nTeam 2: Fuwaires (B), Nasser, Adi',
  [['Reem', 'Mishal', 'HQ'], ['Fuwaires', 'Nasser', 'Adi']]);
// Header lines, then names.
check('blocks', 'Team A\n1. Reem\n2. Mishal\n\nTeam B:\n- Nasser\n- Adi\n',
  [['Reem', 'Mishal'], ['Nasser', 'Adi']], r => r.teams[0].label === 'Team A' && r.teams[1].label === 'Team B');
// Blank lines only.
check('blank lines', 'Reem\nMishal\n\n\nNasser\nAdi', [['Reem', 'Mishal'], ['Nasser', 'Adi']], r => r.teams[1].label === 'Team 2');
// CSV rows, BOM, tabs.
check('csv', '\uFEFFReem,Mishal,HQ\r\nNasser;Adi;JC\r\nMT\tAziz Z\tAhmed A', [['Reem', 'Mishal', 'HQ'], ['Nasser', 'Adi', 'JC'], ['MT', 'Aziz Z', 'Ahmed A']]);
// "Red team:" header with names on following lines; unknown names and duplicates.
check('unmatched + dupes', 'Red team:\nReem\nGhost Guy\nMishal\nBlue team:\nReem\nAbdullah Hamad',
  [['Reem', 'Mishal'], ['Abdullah H']], r => r.teams[0].unmatched[0] === 'Ghost Guy' && r.dupes[0] === 'Reem');
// Header followed directly by a team on the same line with no comma (single player) stays open for more lines.
check('header one name', 'Team 1: Reem\nMishal\nTeam 2: Nasser\nAdi', [['Reem', 'Mishal'], ['Nasser', 'Adi']]);

console.log(fail ? `${fail} failed` : 'ok');
process.exit(fail ? 1 : 0);
