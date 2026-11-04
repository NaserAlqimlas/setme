// Draw a season (or month) recap as a PNG, in the same style as the court and game recap images:
// the period, a few headline numbers, then one row per award. Results only, nothing from ratings.

const W = 1080, PAD = 60;
const NAVY = '#14244f', ROW = '#1a2d63', SOFT = '#9fb0e0', DIM = '#6f80b8', YELLOW = '#ffc531';
const HEAD = '"Barlow Condensed", "Arial Narrow", sans-serif', BODY = 'Inter, system-ui, sans-serif';
const ROW_H = 118;

// Shrink the font until text fits maxW; returns the size used.
function fit(ctx, text, weight, size, family, maxW, min = 18) {
  ctx.font = `${weight} ${size}px ${family}`;
  while (size > min && ctx.measureText(text).width > maxW) ctx.font = `${weight} ${--size}px ${family}`;
  return size;
}

// rec: seasonRecap() from club.mjs. name: player id -> display name.
export async function seasonImage(rec, { title, name }) {
  try { await Promise.all([document.fonts.load(`700 44px ${HEAD}`), document.fonts.load(`600 30px ${BODY}`)]); } catch { /* fall back to system fonts */ }
  const rows = [...rec.awards.map(a => ({ title: a.title, who: a.who.map(name).join(', '), detail: a.detail })),
    ...(rec.closest ? [{ title: 'Closest game', who: `Team ${rec.closest.team_a} v Team ${rec.closest.team_b}`, detail: `${rec.closest.score_a}–${rec.closest.score_b}` }] : [])];
  const H = 330 + Math.max(1, rows.length) * (ROW_H + 14) + 80;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = NAVY; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';

  ctx.font = `700 30px ${HEAD}`; ctx.fillStyle = YELLOW; ctx.fillText('SEASON RECAP', PAD, 80);
  fit(ctx, title.toUpperCase(), 700, 72, HEAD, W - 2 * PAD); ctx.fillStyle = '#ffffff'; ctx.fillText(title.toUpperCase(), PAD, 150);

  // Headline numbers.
  const stats = [[rec.days, 'GAME DAYS'], [rec.games, 'GAMES'], [rec.players, 'PLAYERS']];
  const colW = (W - 2 * PAD) / stats.length;
  stats.forEach(([v, label], i) => {
    const x = PAD + colW * i;
    ctx.font = `700 64px ${HEAD}`; ctx.fillStyle = '#ffffff'; ctx.fillText(String(v), x, 245);
    ctx.font = `600 24px ${HEAD}`; ctx.fillStyle = SOFT; ctx.fillText(label, x, 278);
  });

  let y = 320;
  if (!rows.length) { ctx.font = `500 28px ${BODY}`; ctx.fillStyle = SOFT; ctx.fillText('No games with scores yet.', PAD, y + 60); }
  for (const r of rows) {
    ctx.fillStyle = ROW; ctx.beginPath(); ctx.roundRect(PAD - 14, y, W - 2 * PAD + 28, ROW_H, 14); ctx.fill();
    ctx.fillStyle = YELLOW; ctx.fillRect(PAD - 14, y, 6, ROW_H);
    ctx.textAlign = 'left';
    ctx.font = `700 26px ${HEAD}`; ctx.fillStyle = SOFT; ctx.fillText(r.title.toUpperCase(), PAD + 12, y + 40);
    fit(ctx, r.who, 600, 36, BODY, W - 2 * PAD - 280); ctx.fillStyle = '#ffffff'; ctx.fillText(r.who, PAD + 12, y + 88);
    ctx.textAlign = 'right'; fit(ctx, r.detail, 700, 40, HEAD, 250); ctx.fillStyle = YELLOW; ctx.fillText(r.detail, W - PAD, y + 86);
    y += ROW_H + 14;
  }

  ctx.textAlign = 'left'; ctx.font = `500 21px ${BODY}`; ctx.fillStyle = DIM;
  ctx.fillText('From game results and tagged games · SetMe', PAD, H - 30);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
