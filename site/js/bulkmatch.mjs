// Bulk upload on Videos (super): which game each picked video file belongs to. Kept apart so it can be tested.
// games: [{ id, session_id, created_at, played_on, video_kind, video_ref, score_a, score_b }]

// The calendar day a file was last changed, on this device's clock: for phone videos, usually the day it was filmed.
export const fileDay = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Each game's number within its day (1, 2, …), newest day first.
export function numbered(games) {
  const byDay = new Map();
  for (const g of [...games].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    const list = byDay.get(g.session_id) ?? []; list.push(g); byDay.set(g.session_id, list);
  }
  return [...byDay.values()].flatMap(list => list.map((g, i) => ({ ...g, n: i + 1 })))
    .sort((a, b) => b.played_on.localeCompare(a.played_on) || a.n - b.n);
}

// files: [{ name, size, lastModified }] -> [{ file, game, how }] in the files' order.
// how: 'name' (the game was tagged from a file with this name), 'day' (the only game that day without a video), or
// null (pick one). A game is never suggested for two files.
export function matchFiles(files, games) {
  const byName = new Map(games.filter(g => g.video_kind === 'file' && g.video_ref).map(g => [g.video_ref.toLowerCase(), g]));
  const out = files.map(file => {
    const g = byName.get(file.name.toLowerCase());
    if (g) return { file, game: g.id, how: 'name' };
    const free = games.filter(x => x.played_on === fileDay(file.lastModified) && !x.video_kind);
    return { file, game: free.length === 1 ? free[0].id : null, how: free.length === 1 ? 'day' : null };
  });
  const count = new Map();
  for (const m of out) if (m.game != null) count.set(m.game, (count.get(m.game) ?? 0) + 1);
  return out.map(m => m.game != null && count.get(m.game) > 1 && m.how === 'day' ? { ...m, game: null, how: null } : m);
}

// What stops the list from being uploaded as it stands -> [messages], empty when it can go.
export function problems(rows, games) {
  const byId = new Map(games.map(g => [g.id, g]));
  const out = [];
  const seen = new Map();
  for (const r of rows) {
    if (r.skip) continue;
    if (r.game == null) { out.push(`Pick a game for ${r.file.name}, or skip it`); continue; }
    if (seen.has(r.game)) out.push(`${seen.get(r.game)} and ${r.file.name} are both set to the same game`);
    seen.set(r.game, r.file.name);
    if (!byId.has(r.game)) out.push(`The game for ${r.file.name} is gone`);
  }
  return out;
}
