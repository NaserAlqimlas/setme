// Draw a lineup as a PNG: Team 1 v Team 2 (or the teams' names) on court 1, Team 3 v Team 4 on court 2, ...
// An odd team out goes on a "next up" bench under the courts.
// Setters and backups are marked S (unless setters: false). A team of six stands in a rotation (1 back right, 2 front right, 3 front middle,
// 4 front left, 5 back left, 6 back middle) turned so the main setter (or, with none, a backup) is in 3; the order
// around the court is the serving order (servingOrder in teams.mjs). Other sizes put them as near front middle as
// the rows allow.
import { servingOrder } from './teams.mjs';

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
    ctx.fillStyle = YELLOW;
    ctx.beginPath(); ctx.arc(tx + 15, y, 15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = NAVY; ctx.font = `700 20px ${HEAD}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(mark, tx + 15, y + 1);
    tx += 40;
    ctx.font = `600 ${size}px ${BODY}`;
  }
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(name, tx, y + 1, w - (tx - (x - w / 2)) - 16);
}

// Main setters and backups both get S.
const markOf = p => (p.setting === 'M' || p.setting === 'B' ? 'S' : null);
// Players in serving order (setter first; the lineup's own order otherwise: setter, backups, strongest to weakest).
const ordered = players => servingOrder([...players].sort((a, b) => 'MBN'.indexOf(a.setting ?? 'N') - 'MBN'.indexOf(b.setting ?? 'N')));
// Rotation spots for serving order 1–6 as [column (0 back, 1 front), row from the team's right]; see the top.
const SPOTS = [[0, 0], [1, 0], [1, 1], [1, 2], [0, 2], [0, 1]];

// One half of the court: two columns (back, front) of up to ceil(n/2) rows. The left team faces right, so its right
// is the bottom of the image; the right team's right is the top.
function half(ctx, x0, y0, w, h, players, color, side, mark) {
  const list = ordered(players), n = list.length, rows = Math.ceil(n / 2);
  const colX = side === 'left' ? [x0 + w * 0.28, x0 + w * 0.72] : [x0 + w * 0.72, x0 + w * 0.28];
  const spot = i => n === 6 ? SPOTS[i] : [i % 2, Math.floor(i / 2)];
  // Where the main setter goes: 3 (front middle) for six; otherwise the front spot nearest the middle row.
  const front = [...Array(n).keys()].filter(i => spot(i)[0] === 1);
  const target = n === 6 ? 2 : front.sort((a, b) => Math.abs(spot(a)[1] - (rows - 1) / 2) - Math.abs(spot(b)[1] - (rows - 1) / 2))[0] ?? 0;
  // Turn the whole order so the setter lands there; who follows whom (the serving order) stays the same.
  // With no main setter, ordered() puts a backup first, so the backup takes the spot.
  const shift = ['M', 'B'].includes(list[0]?.setting) ? target : 0;
  list.forEach((p, k) => {
    let [col, row] = spot((k + shift) % n);
    if (n === 6 && side === 'left') row = 2 - row;
    pill(ctx, colX[col], y0 + h * (row + 0.5) / rows, p.name, color, mark(p), w * 0.42);
  });
}

function court(ctx, y, a, b, colorA, colorB, mark) {
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
  half(ctx, cx, cy, cw / 2, ch, a.players, colorA, 'left', mark);
  if (b) half(ctx, mid, cy, cw / 2, ch, b.players, colorB, 'right', mark);
}

// Matchup title: "COURT 1   TEAM 1  vs  TEAM 2", team names in their colours.
function matchTitle(ctx, y, n, parts) {
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  let x = PAD;
  ctx.font = `700 30px ${HEAD}`; ctx.fillStyle = '#9fb0e0';
  ctx.fillText(`COURT ${n}`, x, y); x += ctx.measureText(`COURT ${n}`).width + 24;
  // Team names can be long ("Mohammed's Team"): shrink the line so it fits the image.
  const font = (color, k) => color ? `700 ${Math.round(44 * k)}px ${HEAD}` : `600 ${Math.round(30 * k)}px ${HEAD}`;
  const width = k => parts.reduce((w, [text, color]) => { ctx.font = font(color, k); return w + ctx.measureText(text).width + 16; }, 0);
  const k = Math.min(1, (W - PAD - x) / width(1));
  for (const [text, color] of parts) {
    ctx.font = font(color, k);
    ctx.fillStyle = color ?? '#9fb0e0';
    ctx.fillText(text, x, y); x += ctx.measureText(text).width + 16;
  }
}

function bench(ctx, y, team, label, color, mark) {
  ctx.font = `700 44px ${HEAD}`; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(label.toUpperCase(), PAD, y);
  const lw = ctx.measureText(label.toUpperCase()).width;
  ctx.font = `600 30px ${HEAD}`; ctx.fillStyle = '#9fb0e0';
  ctx.fillText('NEXT UP', PAD + lw + 16, y);
  const colW = COURT_W / 3;
  ordered(team.players).forEach((p, i) => pill(ctx, PAD + colW * (i % 3 + 0.5), y + 60 + Math.floor(i / 3) * 76, p.name, color, mark(p), colW - 16));
}

// teams: [{players: [{name, setting}]}] -> Promise<Blob> (image/png)
// names: each team's name (default Team 1, Team 2, ...). setters: false leaves off the S marks.
export async function courtImage(teams, { title = '', colors, names = teams.map((_, k) => `Team ${k + 1}`), setters = true }) {
  const mark = setters ? markOf : () => null;
  try { await Promise.all([document.fonts.load(`700 44px ${HEAD}`), document.fonts.load(`600 30px ${BODY}`)]); } catch { /* fall back to system fonts */ }
  const courts = Math.floor(teams.length / 2), odd = teams.length % 2 ? teams[teams.length - 1] : null;
  const benchH = odd ? 90 + Math.ceil(odd.players.length / 3) * 76 : 0;
  const top = title ? 140 : 20;
  const H = top + courts * (COURT_H + 110) + benchH + 10;
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
    matchTitle(ctx, y + 50, c + 1, [[names[a].toUpperCase(), colors[a % colors.length]], ['vs'], [names[b].toUpperCase(), colors[b % colors.length]]]);
    court(ctx, y + 80, teams[a], teams[b], colors[a % colors.length], colors[b % colors.length], mark);
    y += COURT_H + 110;
  }
  if (odd) bench(ctx, y + 50, odd, names[teams.length - 1], colors[(teams.length - 1) % colors.length], mark);

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
