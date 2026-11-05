// Draw a season (or month) recap as a PNG, in the same style as the court and game recap images:
// the period, a few headline numbers, then one row per award. Results only, nothing from ratings.

const W = 1080, PAD = 60;
const NAVY = '#14244f', ROW = '#1a2d63', SOFT = '#9fb0e0', DIM = '#6f80b8', YELLOW = '#ffc531';
const HEAD = '"Barlow Condensed", "Arial Narrow", sans-serif', BODY = 'Inter, system-ui, sans-serif';
const NAMES = 30, LINE = 40; // names: font size, line height
const MAX_LINES = 2;

// Shrink the font until text fits maxW; returns the size used.
function fit(ctx, text, weight, size, family, maxW, min = 18) {
  ctx.font = `${weight} ${size}px ${family}`;
  while (size > min && ctx.measureText(text).width > maxW) ctx.font = `${weight} ${--size}px ${family}`;
  return size;
}

// Names joined with commas in at most MAX_LINES lines of maxW; whoever doesn't fit becomes "and 8 more".
function nameLines(ctx, names, maxW) {
  ctx.font = `600 ${NAMES}px ${BODY}`;
  const lines = [''];
  for (let i = 0; i < names.length; i++) {
    const rest = names.length - i - 1, last = lines.length === MAX_LINES;
    const add = `${lines.at(-1) ? ', ' : ''}${names[i]}`;
    const tail = last && rest ? ` and ${rest} more` : '';
    if (ctx.measureText(lines.at(-1) + add + tail).width <= maxW) { lines[lines.length - 1] += add; continue; }
    if (!last && lines.at(-1)) { lines.push(names[i]); continue; }
    lines[lines.length - 1] += ` and ${names.length - i} more`;
    break;
  }
  return lines;
}

// rec: seasonRecap() from club.mjs. name: player id -> display name.
export async function seasonImage(rec, { title, name }) {
  try { await Promise.all([document.fonts.load(`700 44px ${HEAD}`), document.fonts.load(`600 30px ${BODY}`)]); } catch { /* fall back to system fonts */ }
  const rows = [...rec.awards.map(a => ({ title: a.title, who: a.who.map(name), detail: a.detail })),
    ...(rec.closest ? [{ title: 'Closest game', who: [rec.closest.names?.join(' v ') ?? `Team ${rec.closest.team_a} v Team ${rec.closest.team_b}`], detail: `${rec.closest.score_a}–${rec.closest.score_b}` }] : [])];
  // Lay out first: the number on the right gets its width, the names wrap in what's left.
  const measure = document.createElement('canvas').getContext('2d');
  const laid = rows.map(r => {
    const size = fit(measure, r.detail, 700, 40, HEAD, 280);
    const detailW = measure.measureText(r.detail).width;
    return { ...r, size, lines: nameLines(measure, r.who, W - 2 * PAD - 24 - detailW - 40) };
  });
  const rowH = r => 66 + r.lines.length * LINE;
  const H = 330 + (laid.length ? laid.reduce((a, r) => a + rowH(r) + 14, 0) : 132) + 80;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = NAVY; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';

  ctx.font = `700 30px ${HEAD}`; ctx.fillStyle = YELLOW; ctx.fillText('SEASON RECAP', PAD, 80);
  fit(ctx, title.toUpperCase(), 700, 72, HEAD, W - 2 * PAD); ctx.fillStyle = '#ffffff'; ctx.fillText(title.toUpperCase(), PAD, 150);

  // Headline numbers.
  const stats = [[rec.days, rec.days === 1 ? 'GAME DAY' : 'GAME DAYS'], [rec.games, rec.games === 1 ? 'GAME' : 'GAMES'], [rec.players, rec.players === 1 ? 'PLAYER' : 'PLAYERS']];
  const colW = (W - 2 * PAD) / stats.length;
  stats.forEach(([v, label], i) => {
    const x = PAD + colW * i;
    ctx.font = `700 64px ${HEAD}`; ctx.fillStyle = '#ffffff'; ctx.fillText(String(v), x, 245);
    ctx.font = `600 24px ${HEAD}`; ctx.fillStyle = SOFT; ctx.fillText(label, x, 278);
  });

  let y = 320;
  if (!rows.length) { ctx.font = `500 28px ${BODY}`; ctx.fillStyle = SOFT; ctx.fillText('No games with scores yet.', PAD, y + 60); }
  for (const r of laid) {
    const hh = rowH(r);
    ctx.fillStyle = ROW; ctx.beginPath(); ctx.roundRect(PAD - 14, y, W - 2 * PAD + 28, hh, 14); ctx.fill();
    ctx.fillStyle = YELLOW; ctx.fillRect(PAD - 14, y, 6, hh);
    ctx.textAlign = 'left';
    ctx.font = `700 26px ${HEAD}`; ctx.fillStyle = SOFT; ctx.fillText(r.title.toUpperCase(), PAD + 12, y + 40);
    ctx.font = `600 ${NAMES}px ${BODY}`; ctx.fillStyle = '#ffffff';
    r.lines.forEach((line, i) => ctx.fillText(line, PAD + 12, y + 84 + i * LINE));
    ctx.textAlign = 'right'; ctx.font = `700 ${r.size}px ${HEAD}`; ctx.fillStyle = YELLOW;
    ctx.fillText(r.detail, W - PAD, y + hh / 2 + 14);
    y += hh + 14;
  }

  ctx.textAlign = 'left'; ctx.font = `500 21px ${BODY}`; ctx.fillStyle = DIM;
  ctx.fillText('From game results and tagged games · SetMe', PAD, H - 30);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
