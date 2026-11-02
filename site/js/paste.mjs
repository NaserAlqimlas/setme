// Match a pasted WhatsApp list ("1. Reem ✅", "- Fuwaires", "Abdullah +1") against the roster.

// Lowercase, no invisible characters, emojis, numbering or spaces. Keeps letters, digits and '+'.
const compact = s => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+]/gu, '');

function cleanLine(line) {
  return line
    .replace(/[​-‏⁠﻿]/g, '')
    .replace(/^\s*\[[^\]]*\][^:]*:\s*/, '')          // "[12:01, 31/10/2026] Nasser: " from copied messages
    .replace(/^\s*(\d+\s*[.)\-:]+|[-*•–—·]+)\s*/, '') // "1." "2)" "3-" "-" "•"
    .trim();
}

// Exact name, else the longest roster name the text starts with ("Abdullah Hamad" -> "Abdullah H"),
// else the only roster name that starts with the text ("Fuwa" -> "Fuwaires").
function lookup(key, roster) {
  let hit = roster.find(r => r.key === key);
  if (!hit) hit = roster.filter(r => key.startsWith(r.key)).sort((a, b) => b.key.length - a.key.length)[0];
  if (!hit) {
    const starts = roster.filter(r => r.key.startsWith(key));
    if (starts.length === 1 && key.length >= 3) hit = starts[0];
  }
  return hit;
}

// One name -> player, or undefined.
export function findPlayer(name, players) {
  const key = compact(name);
  return key ? lookup(key, players.map(p => ({ p, key: compact(p.name) })).filter(r => r.key))?.p : undefined;
}

// players: [{id, name}] -> { matched: [{line, player}], waitlist: [{line, player}], unmatched: [line] }
// Everyone after a "Waitlist" line goes to waitlist instead of matched.
export function matchPasted(text, players) {
  const roster = players.map(p => ({ p, key: compact(p.name) })).filter(r => r.key);
  const matched = [], waitlist = [], unmatched = [], seen = new Set();
  let target = matched;
  for (const raw of text.split(/\r?\n/)) {
    const line = cleanLine(raw);
    const key = compact(line);
    if (!key) continue;
    if (/^(wait\s*-?\s*list|waiting\s+list|reserves?)\b/i.test(line)) { target = waitlist; continue; }
    const hit = lookup(key, roster);
    if (!hit) { unmatched.push(line); continue; }
    if (seen.has(hit.p.id)) continue;
    seen.add(hit.p.id);
    target.push({ line, player: hit.p });
  }
  return { matched, waitlist, unmatched };
}

// Teams you made yourself, pasted or from a file. Understands:
//   "Team 1: Reem, Mishal (S), HQ"      one team per line (also what Copy text produces)
//   "Team 1" / "Red team:" then one name per line, or teams separated by blank lines
//   "Reem, Mishal, HQ"                   a line with commas (or tabs/semicolons, e.g. a CSV row) is one team
// -> { teams: [{ label, players: [player], unmatched: [name] }], dupes: [name] } (a player listed twice stays in the first team)
const HEADER = /^(team|group|squad|court)\b|\bteam\s*\S{0,3}$/i;
export function parseTeams(text, players) {
  const roster = players.map(p => ({ p, key: compact(p.name) })).filter(r => r.key);
  const teams = [], dupes = [], seen = new Set();
  let cur = null;
  const start = label => (cur = { label, players: [], unmatched: [] }, teams.push(cur), cur);
  const close = () => { cur = null; };
  const add = name => {
    const clean = name.replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();
    const key = compact(clean);
    if (!key) return;
    if (!cur) start('');
    const hit = lookup(key, roster);
    if (!hit) return cur.unmatched.push(clean);
    if (seen.has(hit.p.id)) return dupes.push(hit.p.name);
    seen.add(hit.p.id); cur.players.push(hit.p);
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = cleanLine(raw.replace(/^﻿/, ''));
    if (!compact(line)) { close(); continue; }
    const m = line.match(/^([^:,;\t]{1,30}?)\s*[:：]\s*(.*)$/);
    if (m && HEADER.test(m[1].trim())) {
      start(m[1].trim());
      m[2].split(/[,;\t|،]+/).forEach(add);
      if (/[,;\t|،]/.test(m[2])) close();
    } else if (HEADER.test(line) && !/[,;\t|،]/.test(line) && !lookup(compact(line), roster)) {
      start(line.replace(/[:：]\s*$/, ''));
    } else if (/[,;\t|،]/.test(line)) {
      close(); start(''); line.split(/[,;\t|،]+/).forEach(add); close();
    } else add(line);
  }
  const kept = teams.filter(t => t.players.length || t.unmatched.length);
  kept.forEach((t, i) => { if (!t.label) t.label = `Team ${i + 1}`; });
  return { teams: kept, dupes };
}
