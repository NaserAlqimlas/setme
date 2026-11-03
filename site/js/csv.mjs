// Read a ratings CSV: name,receiving,hitting,setting,hustle,serve,blocking[,consistency] (extra columns are ignored).
// The setting column holds setter letters (M/B/N) and is ignored; the Setting rating is setting_skill, optional like consistency.
// Consistency is optional, so older files still import; without the column, saved consistency ratings are left alone.
import { SKILLS, RATED } from './teams.mjs';
import { findPlayer } from './paste.mjs';

const VALID = [0, .25, .5, .75, 1];
const ALIASES = { 'setting skill': 'setting_skill', 'setting rating': 'setting_skill', consistent: 'consistency', consistancy: 'consistency', recieving: 'receiving', reception: 'receiving', passing: 'receiving', hit: 'hitting', attack: 'hitting', serving: 'serve', block: 'blocking', player: 'name' };

// Minimal CSV: quoted fields, commas or semicolons (some Excel locales save with ';').
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const sep = first.includes(';') && !first.includes(',') ? ';' : ',';
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim()));
}

// -> { rows: [{ player, values: {receiving..} }], unmatched: [name], errors: [message], blank: [name] }
export function readRatingsCsv(text, players) {
  const [header, ...lines] = parseCsv(text);
  if (!header) return { rows: [], unmatched: [], blank: [], errors: ['The file is empty.'] };
  const cols = header.map(c => { const k = c.trim().toLowerCase(); return ALIASES[k] ?? k; });
  const nameCol = cols.indexOf('name');
  const missing = ['name', ...SKILLS].filter(c => !cols.includes(c));
  if (missing.length) return { rows: [], unmatched: [], blank: [], errors: [`Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. The first row must be: name,receiving,hitting,setting,hustle,serve,blocking`] };

  const rows = [], unmatched = [], blank = [], errors = [], seen = new Set();
  for (const line of lines) {
    const name = (line[nameCol] ?? '').replace(/[\u200B-\u200F\u2060\uFEFF]/g, '').trim();
    if (!name) continue;
    const values = {};
    let bad = false;
    for (const s of RATED.filter(s => cols.includes(s))) {
      const raw = (line[cols.indexOf(s)] ?? '').trim();
      if (raw === '' || /^u$/i.test(raw)) { values[s] = null; continue; }
      const v = Number(raw.replace(',', '.'));
      if (!VALID.includes(v)) { errors.push(`${name}: ${s} is "${raw}" (use 0, .25, .5, .75, 1 or U)`); bad = true; }
      else values[s] = v;
    }
    if (bad) continue;
    const player = findPlayer(name, players);
    if (!player) { unmatched.push(name); continue; }
    if (seen.has(player.id)) { errors.push(`${name}: ${player.name} appears more than once; using the first row`); continue; }
    seen.add(player.id);
    if (Object.values(values).every(v => v == null)) { blank.push(player.name); continue; }
    rows.push({ player, values });
  }
  return { rows, unmatched, blank, errors };
}

const HEADER = 'name,receiving,hitting,setting,hustle,serve,blocking,consistency,setting_skill';
const COLS = ['receiving', 'hitting', null, 'hustle', 'serve', 'blocking', 'consistency', 'setting_skill'];
const esc = s => /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
const toFile = lines => '\uFEFF' + [HEADER, ...lines].join('\r\n') + '\r\n';

// A blank template with every current player's name.
export function ratingsTemplate(players) {
  return toFile(players.map(p => `${esc(p.name)},,,,,,,,`));
}

// Your saved ratings in the same layout, so the file imports straight back. byPlayer: Map player id -> ratings row.
// Unrated players get an empty row; a saved but unknown skill is U. The setting column holds the player's setter letter.
export function ratingsExport(players, byPlayer) {
  return toFile(players.map(p => {
    const r = byPlayer.get(p.id);
    return [esc(p.name), ...COLS.map(c => c === null ? (p.setting ?? '') : !r ? '' : r[c] == null ? 'U' : String(Number(r[c])))].join(',');
  }));
}
