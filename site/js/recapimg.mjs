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
const RESULT_H = 66, TEAM_HEAD = 90, ROW_H = 52;

// data: recap() from stats.mjs. name: player id -> display name. colors: by team number - 1.
// teamName: (team number, round) -> the team's name (default Team 1, Team 2, ...). With more than one round, each
// round's results get a heading and box scores say their round.
// lineups: who was on each team, drawn under the results: [{ round, teams: [{ k, ids: [player id, ...] }] }].
const ROUND_H = 48, LINEUP_HEAD = 44, LINEUP_LINE = 36, LINEUP_GAP = 18;
const NAMES_FONT = `500 26px ${BODY}`;
// Names joined with " · ", broken into lines no wider than max.
function wrapNames(ctx, names, max) {
  ctx.font = NAMES_FONT;
  const lines = [];
  let line = '';
  for (const n of names) {
    const next = line ? `${line} · ${n}` : n;
    if (line && ctx.measureText(next).width > max) { lines.push(line); line = n; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
export async function recapImage(data, { title, subtitle = '', name, colors, teamName = k => `Team ${k}`, lineups = [] }) {
  try { await Promise.all([document.fonts.load(`700 44px ${HEAD}`), document.fonts.load(`600 30px ${BODY}`)]); } catch { /* fall back to system fonts */ }
  const color = k => colors[(k - 1) % colors.length];
  const rounds = [...new Set(data.results.map(r => r.round ?? 1))].sort((a, b) => a - b), many = rounds.length > 1;
  // Box score groups: one per round and team, in order.
  const groups = [...new Map(data.players.map(p => [`${p.round ?? 1}:${p.team}`, { round: p.round ?? 1, team: p.team }])).values()];
  const inGroup = (p, g) => (p.round ?? 1) === g.round && p.team === g.team;
  const boxH = groups.length ? 60 + groups.reduce((a, g) => a + TEAM_HEAD + data.players.filter(p => inGroup(p, g)).length * ROW_H + 24, 0) : 0;
  // Teams section: measured first so the canvas is tall enough.
  const measure = document.createElement('canvas').getContext('2d');
  const lineupRounds = lineups.filter(l => l.teams.some(t => t.ids.length));
  const wrapped = lineupRounds.map(l => ({ ...l, teams: l.teams.filter(t => t.ids.length).map(t => ({ ...t, lines: wrapNames(measure, t.ids.map(name), W - 2 * PAD) })) }));
  const lineupH = wrapped.length ? 60 + wrapped.reduce((a, l) => a + (lineupRounds.length > 1 ? ROUND_H : 0)
    + l.teams.reduce((b, t) => b + LINEUP_HEAD + t.lines.length * LINEUP_LINE + LINEUP_GAP, 0), 0) : 0;
  const H = 170 + 50 + data.results.length * RESULT_H + (many ? rounds.length * ROUND_H : 0) + lineupH + boxH + 90;
  // Long team names ("Mohammed's Team") shrink to fit their space.
  const fit = (text, max, size, weight = 700) => {
    ctx.font = `${weight} ${size}px ${HEAD}`;
    while (size > 22 && ctx.measureText(text).width > max) ctx.font = `${weight} ${--size}px ${HEAD}`;
  };

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
  const side = W / 2 - 100 - PAD;
  for (const round of rounds) {
    if (many) {
      ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.font = `700 26px ${HEAD}`; ctx.fillStyle = DIM;
      ctx.fillText(`ROUND ${round}`, PAD, y + 36); y += ROUND_H;
    }
    for (const r of data.results.filter(x => (x.round ?? 1) === round)) {
      const aWon = r.score_a > r.score_b, mid = W / 2;
      const a = teamName(r.team_a, round).toUpperCase(), b = teamName(r.team_b, round).toUpperCase();
      fit(a, side, 42); ctx.textAlign = 'right'; ctx.fillStyle = color(r.team_a); ctx.globalAlpha = aWon ? 1 : .55; ctx.fillText(a, mid - 100, y + 48);
      fit(b, side, 42); ctx.textAlign = 'left'; ctx.fillStyle = color(r.team_b); ctx.globalAlpha = aWon ? .55 : 1; ctx.fillText(b, mid + 100, y + 48);
      ctx.globalAlpha = 1; ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff';
      ctx.font = `700 46px ${HEAD}`; ctx.fillText(`${r.score_a} – ${r.score_b}`, mid, y + 50);
      y += RESULT_H;
    }
  }

  // Teams: each round's teams with their players.
  if (wrapped.length) {
    y += 40;
    ctx.globalAlpha = 1; ctx.textAlign = 'left'; ctx.font = `700 28px ${HEAD}`; ctx.fillStyle = SOFT; ctx.fillText('TEAMS', PAD, y);
    y += 20;
    for (const l of wrapped) {
      if (lineupRounds.length > 1) { ctx.font = `700 26px ${HEAD}`; ctx.fillStyle = DIM; ctx.fillText(`ROUND ${l.round}`, PAD, y + 36); y += ROUND_H; }
      for (const t of l.teams) {
        const head = teamName(t.k, l.round).toUpperCase();
        fit(head, W - 2 * PAD, 34); ctx.fillStyle = color(t.k); ctx.fillText(head, PAD, y + 34);
        y += LINEUP_HEAD;
        ctx.font = NAMES_FONT; ctx.fillStyle = '#ffffff';
        for (const line of t.lines) { ctx.fillText(line, PAD, y + 26); y += LINEUP_LINE; }
        y += LINEUP_GAP;
      }
    }
  }

  // Box score per team.
  if (groups.length) {
    y += 60;
    const nameW = 270, x0 = PAD + nameW, step = (W - PAD - x0) / COLS.length;
    for (const g of groups) {
      const k = g.team, list = data.players.filter(p => inGroup(p, g));
      const head = `${teamName(k, g.round)}${many ? ` · round ${g.round}` : ''}`.toUpperCase();
      // The team's name gets its own line (names can be long), the column labels the line under it.
      ctx.textAlign = 'left'; fit(head, W - 2 * PAD, 40); ctx.fillStyle = color(k); ctx.fillText(head, PAD, y + 36);
      ctx.textAlign = 'center'; ctx.font = `600 22px ${HEAD}`; ctx.fillStyle = DIM;
      COLS.forEach(([label], i) => ctx.fillText(label, x0 + step * (i + .5), y + 72));
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
