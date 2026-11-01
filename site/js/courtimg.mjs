// Draw a lineup as a PNG: Team 1 v Team 2 on court 1, Team 3 v Team 4 on court 2, ...
// An odd team out goes on a "next up" bench under the courts.

const W = 1080, PAD = 60, COURT_W = W - 2 * PAD, COURT_H = 520, INSET = 40;
const NAVY = '#14244f', FREE = '#1d3fbf', FLOOR = '#eab676', LINE = '#ffffff', YELLOW = '#ffc531';
const HEAD = '"Barlow Condensed", "Arial Narrow", sans-serif', BODY = 'Inter, system-ui, sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// A coloured name pill centred on (x, y); the font shrinks to fit maxW.
function pill(ctx, x, y, name, color, mark, maxW) {
  const markW = mark ? 40 : 0;
  let size = 34;
  ctx.font = `600 ${size}px ${BODY}`;
  while (size > 18 && ctx.measureText(name).width + markW + 36 > maxW) ctx.font = `600 ${--size}px ${BODY}`;
  const w = Math.min(maxW, ctx.measureText(name).width + markW + 36), h = 62;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  ctx.fillStyle = color;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 3; ctx.strokeStyle = LINE; ctx.stroke();
  let tx = x - w / 2 + 18;
  if (mark) {
    ctx.fillStyle = mark === 'S' ? YELLOW : '#ffffff';
    ctx.beginPath(); ctx.arc(tx + 15, y, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = NAVY; ctx.font = `700 20px ${HEAD}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(mark, tx + 15, y + 1);
    tx += markW;
    ctx.font = `600 ${size}px ${BODY}`;
  }
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(name, tx, y + 1, w - (tx - (x - w / 2)) - 16);
}

const markOf = p => (p.setting === 'M' ? 'S' : p.setting === 'B' ? 'B' : null);
// Setter first, then backup, then the rest, so the setter sits in the same spot on every team.
const ordered = players => [...players].sort((a, b) => 'MBN'.indexOf(a.setting ?? 'N') - 'MBN'.indexOf(b.setting ?? 'N'));

// One half of the court: two columns (back, front) of up to ceil(n/2) rows.
function half(ctx, x0, y0, w, h, players, color, side) {
  const list = ordered(players), rows = Math.ceil(list.length / 2);
  const colX = side === 'left' ? [x0 + w * 0.28, x0 + w * 0.72] : [x0 + w * 0.72, x0 + w * 0.28];
  list.forEach((p, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    pill(ctx, colX[col], y0 + h * (row + 0.5) / rows, p.name, color, markOf(p), w * 0.42);
  });
}

function court(ctx, y, a, b, colorA, colorB) {
  roundRect(ctx, PAD, y, COURT_W, COURT_H, 24);
  ctx.fillStyle = FREE; ctx.fill();
  const cx = PAD + INSET, cy = y + INSET, cw = COURT_W - 2 * INSET, ch = COURT_H - 2 * INSET, mid = cx + cw / 2;
  ctx.fillStyle = FLOOR; ctx.fillRect(cx, cy, cw, ch);
  ctx.strokeStyle = LINE; ctx.lineWidth = 5;
  ctx.strokeRect(cx, cy, cw, ch);
  // Attack lines are 3m from the net on an 18m court.
  ctx.globalAlpha = 0.8;
  for (const ax of [mid - cw / 6, mid + cw / 6]) { ctx.beginPath(); ctx.moveTo(ax, cy); ctx.lineTo(ax, cy + ch); ctx.stroke(); }
  ctx.globalAlpha = 1;
  // Net with posts.
  ctx.lineWidth = 9; ctx.strokeStyle = NAVY;
  ctx.beginPath(); ctx.moveTo(mid, cy - 22); ctx.lineTo(mid, cy + ch + 22); ctx.stroke();
  ctx.fillStyle = LINE;
  for (const py of [cy - 22, cy + ch + 22]) { ctx.beginPath(); ctx.arc(mid, py, 9, 0, Math.PI * 2); ctx.fill(); }
  half(ctx, cx, cy, cw / 2, ch, a.players, colorA, 'left');
  if (b) half(ctx, mid, cy, cw / 2, ch, b.players, colorB, 'right');
}

// Matchup title: "COURT 1   TEAM 1  vs  TEAM 2", team names in their colours.
function matchTitle(ctx, y, n, parts) {
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  let x = PAD;
  ctx.font = `700 30px ${HEAD}`; ctx.fillStyle = '#9fb0e0';
  ctx.fillText(`COURT ${n}`, x, y); x += ctx.measureText(`COURT ${n}`).width + 24;
  for (const [text, color] of parts) {
    ctx.font = color ? `700 44px ${HEAD}` : `600 30px ${HEAD}`;
    ctx.fillStyle = color ?? '#9fb0e0';
    ctx.fillText(text, x, y); x += ctx.measureText(text).width + 16;
  }
}

function bench(ctx, y, team, label, color) {
  ctx.font = `700 44px ${HEAD}`; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(label.toUpperCase(), PAD, y);
  const lw = ctx.measureText(label.toUpperCase()).width;
  ctx.font = `600 30px ${HEAD}`; ctx.fillStyle = '#9fb0e0';
  ctx.fillText('NEXT UP', PAD + lw + 16, y);
  const colW = COURT_W / 3;
  ordered(team.players).forEach((p, i) => pill(ctx, PAD + colW * (i % 3 + 0.5), y + 60 + Math.floor(i / 3) * 76, p.name, color, markOf(p), colW - 16));
}

// teams: [{players: [{name, setting}]}] -> Promise<Blob> (image/png)
export async function courtImage(teams, { title = '', colors }) {
  try { await Promise.all([document.fonts.load(`700 44px ${HEAD}`), document.fonts.load(`600 30px ${BODY}`)]); } catch { /* fall back to system fonts */ }
  const courts = Math.floor(teams.length / 2), odd = teams.length % 2 ? teams[teams.length - 1] : null;
  const benchH = odd ? 90 + Math.ceil(odd.players.length / 3) * 76 : 0;
  const top = title ? 140 : 20;
  const H = top + courts * (COURT_H + 110) + benchH + 50;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = NAVY; ctx.fillRect(0, 0, W, H);

  if (title) {
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.font = `700 64px ${HEAD}`; ctx.fillStyle = '#ffffff';
    ctx.fillText(title.toUpperCase(), PAD, 100);
  }

  let y = top;
  for (let c = 0; c < courts; c++) {
    const a = 2 * c, b = a + 1;
    matchTitle(ctx, y + 50, c + 1, [[`TEAM ${a + 1}`, colors[a % colors.length]], ['vs'], [`TEAM ${b + 1}`, colors[b % colors.length]]]);
    court(ctx, y + 80, teams[a], teams[b], colors[a % colors.length], colors[b % colors.length]);
    y += COURT_H + 110;
  }
  if (odd) bench(ctx, y + 50, odd, `Team ${teams.length}`, colors[(teams.length - 1) % colors.length]);
  ctx.font = `500 22px ${BODY}`; ctx.fillStyle = '#6f80b8'; ctx.textAlign = 'left';
  ctx.fillText('S = setter   B = backup setter', PAD, H - 24);

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
