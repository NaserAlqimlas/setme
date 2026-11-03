// Run: node tests/test_csv.mjs [path/to/ratings.csv]
import { readFileSync } from 'node:fs';
import { readRatingsCsv, ratingsTemplate, ratingsExport } from '../site/js/csv.mjs';

const names = ['Reem', 'Mishal', 'HQ', 'Fuwaires', 'Nasser', 'Adi', 'Abdullah H', 'Ghala', 'Malaak', 'Shoug', 'Othman', 'JC', 'Abdullah', 'Yazan',
  'Yaser', 'Vuk', 'Jassim', 'Kamal', 'Ahmed A', 'Nayef', 'MT', 'Samer', 'Ajlan', 'Aziz Z', 'AQ', 'Abdullah + 1', 'Ali'];
const players = names.map((name, id) => ({ id, name }));
let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('FAIL', msg); } };

// Reem's real file: 0.75 style decimals, setting letters, a trailing total column, U for unknown.
if (process.argv[2]) {
  const r = readRatingsCsv(readFileSync(process.argv[2], 'utf8'), players);
  console.log(`file: ${r.rows.length} rows, blank ${r.blank.join(', ') || 'none'}, unmatched ${r.unmatched.join(', ') || 'none'}, errors ${r.errors.length}`);
  check(r.errors.length === 0 && r.unmatched.length === 0, 'real file parses cleanly');
  const reem = r.rows.find(x => x.player.name === 'Reem');
  check(reem && reem.values.receiving === .75 && reem.values.serve === .5, 'Reem values');
  const malaak = r.rows.find(x => x.player.name === 'Malaak');
  check(malaak && malaak.values.hitting === null && malaak.values.receiving === .5, 'U becomes null');
}

const tricky = '\uFEFFName;Recieving;Hitting;Setting;Hustle;Serve;Blocking\r\n"Abdullah + 1";.5;0,75;N;u;1;0\r\nnobody;.5;.5;N;.5;.5;.5\r\nAdi;.6;.5;N;.5;.5;.5\r\nadi;.5;.5;N;.5;.5;.5\r\nHQ;;;;;;\r\n';
const t = readRatingsCsv(tricky, players);
check(t.rows.length === 2 && t.rows[0].player.name === 'Abdullah + 1' && t.rows[0].values.hitting === .75 && t.rows[0].values.hustle === null, 'semicolons, misspelled header, comma decimals');
check(t.unmatched.join() === 'nobody', 'unmatched name');
check(t.errors.length === 1 && t.errors[0].includes('.6'), 'invalid value reported');
check(t.blank.join() === 'HQ', 'blank row');
check(readRatingsCsv('name,receiving\nReem,.5', players).errors[0].startsWith('Missing columns'), 'missing columns');
const tpl = readRatingsCsv(ratingsTemplate(players), players);
check(tpl.blank.length === 27 && tpl.errors.length === 0, 'template round-trips');
const ss = readRatingsCsv('name,receiving,hitting,setting,hustle,serve,blocking,setting skill\nReem,.5,.5,M,.5,.5,.5,.75\nAdi,.5,.5,N,.5,.5,.5,', players);
check(ss.errors.length === 0 && ss.rows[0].values.setting_skill === .75 && ss.rows[1].values.setting_skill === null, 'setting letters ignored, setting skill read');
const saved = new Map([[0, { receiving: .75, hitting: '0.50', hustle: null, serve: 1, blocking: 0, consistency: .25, setting_skill: null }]]);
const exp = ratingsExport([{ id: 0, name: 'Reem', setting: 'M' }, { id: 26, name: 'Ali, Jr', setting: 'N' }, { id: 1, name: 'Mishal' }], saved);
check(exp.split('\r\n')[1] === 'Reem,0.75,0.5,M,U,1,0,0.25,U' && exp.includes('"Ali, Jr",,,N,'), 'export layout');
const back = readRatingsCsv(exp, [...players, { id: 26, name: 'Ali, Jr' }]);
check(back.errors.length === 0 && back.rows.length === 1 && back.rows[0].values.hitting === .5 && back.rows[0].values.hustle === null && back.blank.length === 2, 'export round-trips');
console.log(fail ? `${fail} checks failed` : 'all checks passed');
process.exit(fail ? 1 : 0);
