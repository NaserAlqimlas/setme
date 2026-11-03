// Draw a game or game-day recap as a PNG, in the same style as the court image (courtimg.mjs):
// the results, then a box score per team (one stat line per player).

const W = 1080, PAD = 50;
const NAVY = '#14244f', ROW = '#1a2d63', SOFT = '#9fb0e0', DIM = '#6f80b8';
const HEAD = '"Barlow Condensed", "Arial Narrow", sans-serif', BODY = 'Inter, system-ui, sans-serif';

// Columns after the name: header, value. "a/b" = good out of total.
const COLS = [
  ['PTS', p => p.points],
  ['KILLS', p => p.kills],
  ['HITS', p => p.attacks],
  ['ACES', p => p.aces],
  ['SERVES', p => p.serves ? `${p.servesIn}/${p.serves}` : '–'],
  ['RECV', p => p.passes ? `${p.passesGood}/${p.passes}` : '–'],
  ['BLK', p => p.blocks],
  ['DIGS', p => p.digs],
];
const RESULT_H = 66, TEAM_HEAD = 64, ROW_H = 52;

// data: recap() from stats.mjs. name: player id -> display name. colors: by team number - 1.
export async function recapImage(data, { title, subtitle = '', name, colors }) {
  try { await Promise.all([document.fonts.load(`700 44px ${HEAD}`), document.fonts.load(`600 30px ${BODY}`)]); } catch { /* fall back to system fonts */ }
  const color = k => colors[(k - 1) % colors.length];
  const teams = [...new Set(data.players.map(p => p.team))];
  const boxH = teams.length ? 60 + teams.reduce((a, k) => a + TEAM_HEAD + data.players.filter(p => p.team === k).length * ROW_H + 24, 0) : 0;
  const H = 170 + 50 + data.results.length * RESULT_H + boxH + 90;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = NAVY; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';

  ctx.font = `700 64px ${HEAD}`; ctx.fillStyle = '#ffffff';
  ctx.fillText(title.toUpperCase(), PAD, 100);
  if (subtitle) { ctx.font = `600 30px ${HEAD}`; ctx.fillStyle = SOFT; ctx.fillText(subtitle.toUpperCase(), PAD, 145); }

  // Results: TEAM 1  25 – 21  TEAM 2, the loser dimmed.
  let y = 215;
  ctx.font = `700 28px ${HEAD}`; ctx.fillStyle = SOFT; ctx.fillText(data.results.length > 1 ? 'RESULTS' : 'RESULT', PAD, y);
  y += 8;
  for (const r of data.results) {
    const aWon = r.score_a > r.score_b, mid = W / 2;
    ctx.font = `700 42px ${HEAD}`;
    ctx.textAlign = 'right'; ctx.fillStyle = color(r.team_a); ctx.globalAlpha = aWon ? 1 : .55; ctx.fillText(`TEAM ${r.team_a}`, mid - 100, y + 48);
    ctx.textAlign = 'left'; ctx.fillStyle = color(r.team_b); ctx.globalAlpha = aWon ? .55 : 1; ctx.fillText(`TEAM ${r.team_b}`, mid + 100, y + 48);
    ctx.globalAlpha = 1; ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff';
    ctx.font = `700 46px ${HEAD}`; ctx.fillText(`${r.score_a} – ${r.score_b}`, mid, y + 50);
    y += RESULT_H;
  }

  // Box score per team.
  if (teams.length) {
    y += 60;
    const nameW = 270, x0 = PAD + nameW, step = (W - PAD - x0) / COLS.length;
    for (const k of teams) {
      const list = data.players.filter(p => p.team === k);
      ctx.textAlign = 'left'; ctx.font = `700 40px ${HEAD}`; ctx.fillStyle = color(k); ctx.fillText(`TEAM ${k}`, PAD, y + 36);
      ctx.textAlign = 'center'; ctx.font = `600 22px ${HEAD}`; ctx.fillStyle = DIM;
      COLS.forEach(([label], i) => ctx.fillText(label, x0 + step * (i + .5), y + 36));
      y += TEAM_HEAD;
      list.forEach((p, i) => {
        if (i % 2 === 0) { ctx.fillStyle = ROW; ctx.beginPath(); ctx.roundRect(PAD - 12, y - 4, W - 2 * PAD + 24, ROW_H, 10); ctx.fill(); }
        ctx.fillStyle = color(k); ctx.fillRect(PAD - 12, y - 4, 5, ROW_H);
        ctx.textAlign = 'left'; ctx.font = `600 28px ${BODY}`; ctx.fillStyle = '#ffffff';
        let size = 28;
        while (size > 18 && ctx.measureText(name(p.pid)).width > nameW - 20) ctx.font = `600 ${--size}px ${BODY}`;
        ctx.fillText(name(p.pid), PAD + 6, y + 32);
        ctx.textAlign = 'center';
        COLS.forEach(([, get], c) => {
          const v = get(p);
          ctx.font = c === 0 ? `700 30px ${BODY}` : `500 26px ${BODY}`;
          ctx.fillStyle = v === 0 || v === '–' ? DIM : '#ffffff';
          ctx.fillText(String(v), x0 + step * (c + .5), y + 32);
        });
        y += ROW_H;
      });
      y += 24;
    }
  }

  ctx.textAlign = 'left'; ctx.font = `500 21px ${BODY}`; ctx.fillStyle = DIM;
  ctx.fillText('PTS = kills + aces + blocks · HITS = attacks · SERVES / RECV = in or good out of total', PAD, H - 56);
  ctx.fillText(data.tagged ? `From ${data.tagged} tagged game${data.tagged === 1 ? '' : 's'} · SetMe` : 'No games tagged yet · SetMe', PAD, H - 26);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
