// Rally times found in a game video by the vision tool (vision/ in this repo: python -m setme_vision game.mp4 writes
// game.rallies.json). The tag screen loads them so taggers can jump from rally to rally and skip the time between.
// Kept on this device only, like the video.

// The file's text -> { video, rallies: [{ start, end }] } (oldest first), or throws with a message for the tagger.
export function parseRallyTimes(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That isn\'t a rally times file (game.rallies.json)'); }
  if (!data || !Array.isArray(data.rallies)) throw new Error('That isn\'t a rally times file (game.rallies.json)');
  const rallies = data.rallies
    .map(r => ({ start: Number(r?.start), end: Number(r?.end) }))
    .filter(r => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start && r.start >= 0)
    .sort((a, b) => a.start - b.start);
  if (!rallies.length) throw new Error('No rallies in that file');
  return { video: typeof data.video === 'string' ? data.video : null, rallies };
}

// Where to jump from video time t. dir 1: the next rally starting after t. dir -1: the start of the rally t is in,
// or the one before when t is right at its start (so pressing back twice keeps going back). -> index or -1.
export function jumpTo(rallies, t, dir) {
  if (dir > 0) return rallies.findIndex(r => r.start > t + 0.5);
  for (let i = rallies.length - 1; i >= 0; i--) if (rallies[i].start < t - 1.5) return i;
  return -1;
}

// Which rally t falls in -> index or -1.
export const rallyAt = (rallies, t) => rallies.findIndex(r => t >= r.start && t <= r.end);
