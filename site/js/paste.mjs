// Match a pasted WhatsApp list ("1. Reem ✅", "- Fuwaires", "Abdullah +1") against the roster.

// Lowercase, no invisible characters, emojis, numbering or spaces. Keeps letters, digits and '+'.
export const compact = s => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}+]/gu, '');

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

// Lines about the game day rather than a person: a weekday or month, a time, "6-8 PM", a venue line with " - ".
const INFO = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d|\b\d{1,2}(:\d{2})?\s*(am|pm)\b|\d\s*[-–]\s*\d+\s*(am|pm)?\b|\s[-–]\s/i;
// "Mishal +1", "Mishal + 2": someone bringing guests. Only when the whole line isn't a player's name ("Abdullah + 1").
const GUESTS = /\s*\+\s*(\d{1,2})\s*$/;

// players: [{id, name}]; aliases (optional): [{ alias, player_id }], names matched by hand before (compact form).
// -> { matched: [{line, player}], waitlist: [{line, player}], unmatched: [line], skipped: [line], guests: [{ line, host, n }] }
// Everyone after a "Waitlist" line goes to waitlist instead of matched. Lines before the first name that aren't
// numbered, and lines about the date, time or place, are skipped rather than reported as unrecognized.
// host: the player bringing the guests (null for a bare "+1").
export function matchPasted(text, players, aliases = []) {
  const roster = players.map(p => ({ p, key: compact(p.name) })).filter(r => r.key);
  const byId = new Map(players.map(p => [p.id, p]));
  const alias = new Map(aliases.filter(a => byId.has(a.player_id)).map(a => [a.alias, { p: byId.get(a.player_id), key: a.alias }]));
  const find = key => roster.find(r => r.key === key) ?? alias.get(key) ?? lookup(key, roster);
  const matched = [], waitlist = [], unmatched = [], skipped = [], guests = [], seen = new Set();
  let target = matched;
  for (const raw of text.split(/\r?\n/)) {
    const line = cleanLine(raw);
    const key = compact(line);
    if (!key) continue;
    if (/^(wait\s*-?\s*list|waiting\s+list|reserves?)\b/i.test(line)) { target = waitlist; continue; }
    const numbered = cleanLine(raw) !== raw.replace(/[\u200b-\u200f\u2060\ufeff]/g, '').trim();
    let hit = roster.find(r => r.key === key) ?? alias.get(key);
    const g = !hit && line.match(GUESTS);
    if (g) {
      const hostLine = line.replace(GUESTS, '').trim();
      const host = compact(hostLine) ? find(compact(hostLine)) : null;
      guests.push({ line, host: host?.p ?? null, n: Number(g[1]) });
      if (!host) { if (compact(hostLine)) unmatched.push(hostLine); continue; }
      hit = host;
    }
    hit ??= lookup(key, roster);
    if (!hit) {
      if ((!matched.length && !waitlist.length && !numbered) || INFO.test(line)) skipped.push(line);
      else unmatched.push(line);
      continue;
    }
    if (seen.has(hit.p.id)) continue;
    seen.add(hit.p.id);
    target.push({ line, player: hit.p });
  }
  return { matched, waitlist, unmatched, skipped, guests };
}

// Edit distance between two compact names, for suggesting who an unrecognized name might be.
function distance(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}
// The players an unrecognized name most likely means, best first (shared start, then fewest edits). n at most.
export function closestPlayers(name, players, n = 5) {
  const key = compact(name);
  if (!key) return [];
  const score = p => {
    const k = compact(p.name);
    let pre = 0; while (pre < Math.min(k.length, key.length) && k[pre] === key[pre]) pre++;
    return distance(key, k) - pre * 1.5;
  };
  return players.map(p => [p, score(p)]).sort((a, b) => a[1] - b[1]).slice(0, n).map(([p]) => p);
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
