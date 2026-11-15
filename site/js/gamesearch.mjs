// The Games page search: which games match what was typed. Kept apart so it can be tested.
// Every word typed must match something about the game: a player's or team's name, the day ("nov 10", "tuesday",
// "2026-11-10", "november"), "game 2", or video / tagged / untagged. Case and accents don't matter.

const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// The words a game can be found by.
export function gameWords(g, playedOn) {
  const [y, m, d] = playedOn.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const fmt = o => date.toLocaleDateString('en-US', o);
  return fold([
    g.a.name, g.b.name, ...g.a.players.map(p => p.name), ...g.b.players.map(p => p.name),
    playedOn, fmt({ weekday: 'long' }), fmt({ month: 'long' }), fmt({ month: 'short', day: 'numeric' }), fmt({ month: 'long', day: 'numeric' }), String(y),
    `game ${g.n}`, g.video ? 'video' : '', g.tagged ? 'tagged stats' : 'untagged',
  ].join(' | '));
}

// days: as from game-view ([{ played_on, games }]) -> the same with only matching games (and days that have some).
export function searchDays(days, query) {
  const raw = fold(query).trim();
  if (!raw) return days;
  // "nov 10" and "game 2" stay together, so 10 doesn't match any 10 and 2 any 2.
  const terms = raw.match(/[a-z]+ \d{1,2}\b|game \d+|\S+/g) ?? [];
  // A word has to start where the typed word starts ("om" finds Omar, not Tom), and a number has to end there too
  // ("nov 3" isn't Nov 30).
  const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const has = (words, t) => t === 'tagged' ? / tagged stats/.test(words) : t === 'untagged' ? /untagged/.test(words)
    : new RegExp(`(?:^|[^a-z0-9])${esc(t)}${/\d$/.test(t) ? '(?![0-9])' : ''}`).test(words);
  return days.map(d => ({ ...d, games: d.games.filter(g => { const w = gameWords(g, d.played_on); return terms.every(t => has(w, t)); }) }))
    .filter(d => d.games.length);
}
