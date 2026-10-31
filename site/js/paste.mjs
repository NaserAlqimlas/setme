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
    // Exact name, else the longest roster name the line starts with ("Abdullah Hamad" -> "Abdullah H"),
    // else the only roster name that starts with the line ("Fuwa" -> "Fuwaires").
    let hit = roster.find(r => r.key === key);
    if (!hit) hit = roster.filter(r => key.startsWith(r.key)).sort((a, b) => b.key.length - a.key.length)[0];
    if (!hit) {
      const starts = roster.filter(r => r.key.startsWith(key));
      if (starts.length === 1 && key.length >= 3) hit = starts[0];
    }
    if (!hit) { unmatched.push(line); continue; }
    if (seen.has(hit.p.id)) continue;
    seen.add(hit.p.id);
    target.push({ line, player: hit.p });
  }
  return { matched, waitlist, unmatched };
}
