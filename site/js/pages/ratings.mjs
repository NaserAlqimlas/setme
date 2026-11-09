import { callFn, fmt, forPlayer, h, LABEL, me, pageHead, q, render, sb, seg, SHORT, stacked, toast, today } from '../ui.mjs';
import { combineRatings, RATED, SKILLS, weightedTotal } from '../teams.mjs';
import { metrics, MIN_PLAYERS, SKILL_STATS, statRatings, tallyFromCounts } from '../stats.mjs';
import { raterPicker } from './teams.mjs';
import { pct, pts } from './scores.mjs';

// All ratings / My ratings: coverage, rating history charts, raters.

// Set by a profile's "Rating history" link: the All ratings page opens that player's history.
let pendingHistory = null;
export const openHistory = id => { pendingHistory = id; };

// ---------- all ratings (super) ----------
// Super: everyone's ratings, combined or one rater at a time, plus rater leans and disagreements.
// Raters and organizers: their own ratings only (the database only returns their rows anyway).
export async function ratingsPage() {
  const all = me.role === 'super';
  const [players, ratings, profiles] = await Promise.all([
    q(sb.from('players').select('*').eq('active', true).order('name')), // * so it works before the anchor column exists
    all ? q(sb.from('ratings').select('*')) : q(sb.from('ratings').select('*').eq('rater_id', me.id)),
    all ? q(sb.from('profiles').select('id,display_name')) : [],
  ]);
  // Super gets everyone's changes; anyone else only their own (the database enforces this too).
  const histQ = sb.from('rating_history').select('*').order('changed_at', { ascending: false }).limit(1000);
  const changeLog = await q(all ? histQ : histQ.eq('rater_id', me.id)).catch(() => null);
  const pname = new Map(profiles.map(p => [p.id, p.display_name]));
  const raters = [...new Set(ratings.map(r => r.rater_id))];
  // First name only ("Reem Al-Khaled" -> "Reem"), unless two raters share it.
  const first = id => (pname.get(id) ?? '?').split(/[\s.@]/)[0];
  const short = id => raters.filter(r => first(r) === first(id)).length > 1 ? pname.get(id) : first(id);
  short.full = id => pname.get(id) ?? id;
  // Super picks whose ratings to look at, like on Teams. Several raters: their ratings combined (leans and
  // disagreements worked out among just them). One rater: exactly what they entered. null = everyone.
  let sel = null, combined, offsets, stats, disagreements;
  const extra = h('div');
  const recompute = () => {
    const used = sel ?? raters;
    ({ combined, offsets, raters: stats, disagreements } = combineRatings(players, ratings.filter(r => used.includes(r.rater_id))));
    extra.replaceChildren(...(used.length > 1 ? [raterCard(used, offsets, stats, short), disagreeCard(disagreements, short)] : []));
    hist?.draw(used);
  };
  const hist = historyCard(changeLog, players, ratings, raters, pname, short, all);
  if (!all) hist.draw([me.id]);
  // Arrived from a profile's "Rating history" link.
  if (pendingHistory != null && players.some(p => p.id === pendingHistory)) { const id = pendingHistory; setTimeout(() => hist.show(id), 0); }
  pendingHistory = null;
  if (all) recompute();
  const picker = all ? await raterPicker(ids => {
    sel = ids;
    if (ids?.length === 0) { extra.replaceChildren(); hist?.draw([]); } else recompute();
    draw();
  }, { ratings, profiles }) : null;

  // Sorting: tap a column header, or use the dropdown (the only way on phones, where headers are hidden).
  const COLS = [['name', 'Player'], ...RATED.map(s => [s, LABEL[s]]), ['total', 'Total'], ['weighted', 'Weighted'], ...(all ? [['raters', 'Raters']] : [])];
  let sortKey = 'name', desc = false, show = 'all';
  const sortSel = h('select', { 'aria-label': 'Sort by' }, COLS.map(([k, t]) => h('option', { value: k }, t)));
  const dirBtn = h('button', { type: 'button', class: 'ghost sm sort-dir' });
  const heads = new Map(COLS.map(([k, t]) => [k, h('th', { class: k === 'name' ? 'sortable' : 'num sortable', tabindex: 0, 'aria-sort': 'none', 'data-label': RATED.includes(k) ? SHORT[k] : t })]));
  const sortBy = (k, d) => { sortKey = k; desc = d; draw(); };
  sortSel.onchange = () => sortBy(sortSel.value, sortSel.value !== 'name');
  dirBtn.onclick = () => sortBy(sortKey, !desc);
  for (const [k, th] of heads) {
    const pick = () => sortBy(k, k === sortKey ? !desc : k !== 'name');
    th.onclick = pick;
    th.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
  }

  const body = h('tbody');
  const draw = () => {
    if (all && sel?.length === 0) return body.replaceChildren(h('tr', {}, h('td', { colspan: COLS.length, class: 'warn' }, 'Please select at least one rater.')));
    const rid = !all ? me.id : sel?.length === 1 ? sel[0] : '';
    const mine = new Map(ratings.filter(r => r.rater_id === rid).map(r => [r.player_id, r]));
    // Combined: nobody has rated them. One rater: that rater left a skill as U (consistency doesn't count).
    const rows = players.map(p => {
      const vals = rid ? RATED.map(s => mine.get(p.id)?.[s] ?? null).map(v => v == null ? null : Number(v)) : RATED.map(s => combined.get(p.id).skills[s]);
      const unknown = rid ? vals.slice(0, SKILLS.length).some(v => v == null) : !!combined.get(p.id).guess;
      const key = { name: p.name, ...Object.fromEntries(RATED.map((s, i) => [s, vals[i]])),
        total: unknown ? null : vals.slice(0, SKILLS.length).reduce((a, b) => a + b, 0),
        weighted: unknown ? null : weightedTotal(Object.fromEntries(SKILLS.map((s, i) => [s, vals[i]]))),
        raters: all && !rid ? combined.get(p.id).raters : null };
      return { p, vals, unknown, key };
    }).filter(r => show === 'all' || (show === 'unrated') === r.unknown);
    // U (unknown) always sorts last, whichever way.
    rows.sort((a, b) => {
      const x = a.key[sortKey], y = b.key[sortKey];
      if (x == null || y == null) return (x == null) - (y == null) || a.p.name.localeCompare(b.p.name);
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return (desc ? -c : c) || a.p.name.localeCompare(b.p.name);
    });
    sortSel.value = sortKey;
    dirBtn.textContent = desc ? '↓ High to low' : '↑ Low to high';
    if (sortKey === 'name') dirBtn.textContent = desc ? '↓ Z to A' : '↑ A to Z';
    for (const [k, th] of heads) {
      const label = COLS.find(c => c[0] === k)[1];
      th.setAttribute('aria-sort', k === sortKey ? (desc ? 'descending' : 'ascending') : 'none');
      th.replaceChildren(k === 'name' || k === 'total' || k === 'weighted' || k === 'raters' ? label : SHORT[k], h('span', { class: 'arrow' }, k === sortKey ? (desc ? ' ↓' : ' ↑') : ''));
    }
    if (!rows.length) return body.replaceChildren(h('tr', {}, h('td', { colspan: COLS.length, class: 'muted' }, show === 'rated' ? 'Nobody is rated yet.' : all ? 'Everyone is rated.' : 'You\'ve rated everyone.')));
    body.replaceChildren(...rows.map(({ p, vals, key }) => {
      const guess = all && !rid && combined.get(p.id).guess;
      return h('tr', {}, h('td', {}, h('button', { type: 'button', class: 'name-link', title: 'Show rating history', onclick: () => hist.show(p.id) }, p.name),
        all && ' ', all && h('a', { href: `#player/${p.id}`, class: 'profile-link', title: `${p.name}'s profile`, 'aria-label': `${p.name}'s profile` }, '↗'),
        p.playing && ' ', p.playing && h('span', { class: 'badge on' }, 'Playing'),
        guess && ' ', guess && h('span', { class: 'badge' }, `${guess[0].toUpperCase()}${guess.slice(1)} (guess)`)), vals.map((v, i) => h('td', { class: 'num' }, forPlayer(RATED[i], p) ? fmt(v) : '–')),
        h('td', { class: 'num' }, h('b', {}, fmt(key.total))),
        h('td', { class: 'num' }, fmt(key.weighted)),
        all && h('td', { class: 'num' }, rid ? '' : `${key.raters}`));
    }));
  };
  draw();

  return h('div', {},
    all ? pageHead('All ratings', 'Only you can see this page.')
      : pageHead('My ratings', 'Only you and the site owner can see your ratings. Change them on the Rate page.'),
    picker && h('div', { class: 'card' }, picker),
    h('div', { class: 'card toolbar' },
      h('label', { class: 'sort' }, h('span', {}, 'Sort by'), sortSel), dirBtn,
      seg([['all', 'All'], ['rated', 'Rated'], ['unrated', all ? 'Unrated' : 'Not rated yet']], show, v => { show = v; draw(); }, 'Show')),
    h('div', { class: 'card scroll' }, stacked(h('table', {}, h('thead', {}, h('tr', {}, [...heads.values()])), body))),
    hist.el,
    all && coverageCard(players, ratings, short),
    all && matchStatsCard(players, ratings),
    all && extra);
}

// A card that folds shut by tapping its title. Open or shut is remembered on this device; open the first time.
function foldCard(key, title, ...kids) {
  const store = `setme-fold-${key}`;
  let open = true;
  try { open = localStorage.getItem(store) !== 'shut'; } catch { /* storage blocked */ }
  const body = h('div', { class: 'fold-body' }, ...kids);
  const card = h('details', { class: 'card fold', open }, h('summary', {}, h('h3', {}, title)), body);
  card.addEventListener('toggle', () => { try { localStorage.setItem(store, card.open ? 'open' : 'shut'); } catch { /* ignore */ } });
  card.body = body;
  return card;
}

// Super only: who has been rated by how many people, and how much of the group each rater covers. One rater's view
// of a player swings the combined number; two or more (with leans taken out) settle it.
function coverageCard(players, ratings, short) {
  const by = new Map(players.map(p => [p.id, new Set()]));
  for (const r of ratings) if (by.has(r.player_id) && SKILLS.some(s => r[s] != null)) by.get(r.player_id).add(r.rater_id);
  const n = id => by.get(id).size;
  const buckets = [[0, 'Nobody'], [1, 'One rater'], [2, 'Two'], [3, 'Three or more']].map(([k, label]) => ({ label, count: players.filter(p => k === 3 ? n(p.id) >= 3 : n(p.id) === k).length }));
  const thin = players.filter(p => n(p.id) < 2).sort((a, b) => (b.playing - a.playing) || n(a.id) - n(b.id) || a.name.localeCompare(b.name));
  const raters = [...new Set(ratings.map(r => r.rater_id))];
  const covers = raters.map(rid => ({ rid, n: players.filter(p => by.get(p.id).has(rid)).length })).sort((a, b) => b.n - a.n);
  const anchors = players.filter(p => p.anchor);
  return foldCard('coverage', 'Coverage',
    h('p', { class: 'muted small' }, 'How many people have rated each player. Players with one rater or none show up on everyone\'s Rate page under ', h('b', {}, 'Worth a fresh look'), '.'),
    h('div', { class: 'tiles' }, buckets.map(b => h('div', { class: 'card tile' }, h('span', { class: 'stat' }, String(b.count)), h('b', {}, b.label), h('span', { class: 'muted small' }, 'players')))),
    thin.length > 0 && h('div', { class: 'chips', style: 'margin:10px 0' }, thin.map(p => h('span', { class: `chip plain${n(p.id) ? '' : ' off'}` }, p.name, h('span', { class: 'muted small' }, ` · ${n(p.id)}`), p.playing && h('span', { class: 'badge on', style: 'margin-left:6px' }, 'Playing')))),
    h('div', { class: 'scroll' }, stacked(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Rater'), h('th', { class: 'num' }, 'Players rated'), h('th', { class: 'num' }, 'Of the group'), anchors.length > 0 && h('th', { class: 'num' }, 'Anchors rated'))),
      h('tbody', {}, covers.map(c => h('tr', {}, h('td', {}, short(c.rid)), h('td', { class: 'num' }, String(c.n)), h('td', { class: 'num' }, pct(c.n / players.length)),
        anchors.length > 0 && h('td', { class: 'num' }, `${anchors.filter(a => by.get(a.id).has(c.rid)).length} of ${anchors.length}`))))))));
}

// Super only: per-player numbers from tagged games, and SetMe's ratings worked out from them (see statRatings in
// stats.mjs). SetMe is a rater account of its own, so its ratings are combined, picked and charted like anyone's.
function matchStatsCard(players, ratings) {
  const el = foldCard('match-stats', 'Match stats', h('p', { class: 'muted' }, 'Loading…'));
  (async () => {
    let rows, tagged;
    try {
      [rows, [{ games: tagged }]] = await Promise.all([q(sb.from('player_stats').select('*')), q(sb.from('tagged_games').select('games'))]);
    } catch { return el.body.replaceChildren(h('p', { class: 'muted' }, 'Not set up yet: run supabase/match_stats.sql in Supabase, then tag games on Scores.')); }
    if (!tagged) return el.body.replaceChildren(h('p', { class: 'muted' }, 'No games tagged yet. On Scores, tap Tag on a saved game.'));
    const tallies = tallyFromCounts(rows);
    const pct = v => v == null ? '–' : `${Math.round(v * 100)}%`, num = v => v == null ? '–' : (Math.round(v * 100) / 100).toFixed(2);
    // [sort key, header, hover text]. Tap a header to sort by it (numbers high to low first); tap again to flip.
    const COLS = [['name', 'Player'], ['games', 'Games'], ['serves', 'Serves'], ['aceRate', 'Aces', 'Ace %'], ['serveErr', 'Srv err', 'Serve errors'],
      ['passAvg', 'Pass', 'Pass average (0–3)'], ['setAvg', 'Set', 'Set average (0–3)'], ['attacks', 'Attacks'], ['killRate', 'Kill', 'Kill %'],
      ['attackEff', 'Eff', 'Attack efficiency: (kills − errors − blocked) ÷ attacks'], ['stuffsPerGame', 'Blk/g', 'Stuff blocks per game'], ['digsPerGame', 'Dig/g', 'Digs per game'], ['digAvg', 'Dig', 'Dig average (0–3)']];
    const list = players.filter(p => tallies.has(p.id)).map(p => ({ p, m: metrics(tallies.get(p.id)) }));
    const val = (r, k) => k === 'name' ? r.p.name : (k === 'passAvg' && !r.m.passes) || (k === 'setAvg' && !r.m.sets) || (k === 'digAvg' && !r.m.digs) ? null : r.m[k] ?? null;
    let sortKey = 'name', desc = false;
    const heads = COLS.map(([k, t, title]) => {
      const th = h('th', { class: k === 'name' ? 'sortable' : 'num sortable', title, tabindex: 0, 'aria-sort': 'none', 'data-label': t });
      const pick = () => { desc = k === sortKey ? !desc : k !== 'name'; sortKey = k; draw(); };
      th.onclick = pick;
      th.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
      return th;
    });
    const tbody = h('tbody');
    const draw = () => {
      // No data (–) always sorts last, whichever way.
      list.sort((a, b) => {
        const x = val(a, sortKey), y = val(b, sortKey);
        if (x == null || y == null) return (x == null) - (y == null) || a.p.name.localeCompare(b.p.name);
        const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
        return (desc ? -c : c) || a.p.name.localeCompare(b.p.name);
      });
      heads.forEach((th, i) => {
        const k = COLS[i][0];
        th.setAttribute('aria-sort', k === sortKey ? (desc ? 'descending' : 'ascending') : 'none');
        th.replaceChildren(COLS[i][1], h('span', { class: 'arrow' }, k === sortKey ? (desc ? ' ↓' : ' ↑') : ''));
      });
      tbody.replaceChildren(...list.map(({ p, m }) => h('tr', {}, h('td', {}, p.name),
        [m.games, m.serves, pct(m.aceRate), pct(m.serveErr), m.passes ? `${num(m.passAvg)} (${m.passes})` : '–', m.sets ? `${num(m.setAvg)} (${m.sets})` : '–', m.attacks, pct(m.killRate), num(m.attackEff),
          num(m.stuffsPerGame), num(m.digsPerGame), m.digs ? `${num(m.digAvg)} (${m.digs})` : '–'].map(v => h('td', { class: 'num' }, String(v))))));
    };
    draw();
    const table = stacked(h('table', {}, h('thead', {}, h('tr', {}, heads)), tbody));

    // SetMe's ratings: preview the changes, then write them as the SetMe rater.
    const [setme] = await q(sb.from('profiles').select('id').eq('email', 'setme@setme.invalid'));
    const current = new Map(setme ? ratings.filter(r => r.rater_id === setme.id).map(r => [r.player_id, r]) : []);
    const out = h('div');
    const preview = () => {
      const { ratings: next, detail } = statRatings(tallies, players);
      const skills = Object.keys(SKILL_STATS);
      const changes = [];
      for (const [pid, sk] of next) for (const s of skills) if (s in sk) {
        const was = current.get(pid)?.[s]; const old = was == null ? null : Number(was);
        if (old !== sk[s]) changes.push({ pid, s, old, new: sk[s] });
      }
      const skipped = skills.filter(s => detail[s].skipped).map(s => detail[s].flat ? `${LABEL[s]} (no differences between players yet)`
        : `${LABEL[s]} (${detail[s].players} of ${MIN_PLAYERS} players have ${SKILL_STATS[s].min}+ ${s === 'blocking' || s === 'hustle' ? 'games' : 'attempts'})`);
      const apply = h('button', { class: 'ball', disabled: !changes.length }, changes.length ? `Save ${changes.length} change${changes.length === 1 ? '' : 's'} as SetMe` : 'Nothing to change');
      apply.onclick = async () => {
        apply.disabled = true; apply.textContent = 'Saving…';
        try {
          const { id } = await callFn('admin', { action: 'setme' });
          // Every row carries every derived skill (unchanged ones as they were), so nothing gets blanked.
          const body = [...next].map(([pid, sk]) => ({ rater_id: id, player_id: pid,
            ...Object.fromEntries(skills.map(s => [s, s in sk ? sk[s] : current.get(pid)?.[s] ?? null])) }));
          await q(sb.from('ratings').upsert(body));
          toast('SetMe\'s ratings saved'); render();
        } catch (e) { toast(e.message); apply.disabled = false; apply.textContent = 'Try again'; }
      };
      const name = new Map(players.map(p => [p.id, p.name]));
      out.replaceChildren(
        ...(skipped.length ? [h('p', { class: 'muted small' }, `Not rated yet, too little data: ${skipped.join('; ')}.`)] : []),
        changes.length ? h('div', { class: 'chips' }, changes.map(c => h('span', { class: `chip plain ${c.old == null ? '' : c.new > c.old ? 'up' : 'down'}` },
          `${name.get(c.pid)} · ${SHORT[c.s]} ${fmt(c.old)} → ${fmt(c.new)}`))) : h('p', { class: 'muted' }, 'SetMe\'s ratings already match the stats.'),
        h('div', { class: 'row', style: 'margin-top:10px' }, apply));
    };
    el.body.replaceChildren(
      h('p', { class: 'muted small' }, `From ${tagged} tagged game${tagged === 1 ? '' : 's'}. Only you can see these. Tap a heading to sort.`),
      h('div', { class: 'scroll' }, table),
      statsKey(),
      h('h3', { style: 'margin-top:18px' }, 'SetMe\'s ratings'),
      h('p', { class: 'muted small' }, 'SetMe rates players from these stats as a rater of its own: ',
        Object.entries(SKILL_STATS).map(([s, d]) => `${LABEL[s]} from ${d.label.toLowerCase()}`).join(', '),
        '. Small samples are pulled toward the average, then players are ranked and spread over 0 to 1. Pick SetMe in Ratings from to see or use them.'),
      h('button', { class: 'ghost sm', onclick: preview }, 'Preview changes'), out);
  })().catch(e => el.body.replaceChildren(h('p', { class: 'warn' }, e.message)));
  return el;
}

// What each Match stats column means, folded under the table.
function statsKey() {
  const rows = [
    ['Games', 'Tagged games they played in.'],
    ['Serves', 'Serves tagged.'],
    ['Aces', 'Share of their serves that were aces.'],
    ['Srv err', 'Share of their serves that were errors (lower is better).'],
    ['Pass', 'Average pass grade: 0 error, 1 poor, 2 good, 3 perfect. The number in brackets is how many passes it comes from, so 2.38 (8) is an average of 2.38 over 8 passes.'],
    ['Set', 'Average set grade, the same way: 0 error, 1 poor, 2 good, 3 perfect, with how many sets in brackets.'],
    ['Attacks', 'Attacks tagged.'],
    ['Kill', 'Share of their attacks that won the point.'],
    ['Eff', 'Attack efficiency: kills minus errors and blocked attacks, divided by attacks. From −1 to 1; 0 means as many attacks lost the point as won it.'],
    ['Blk/g', 'Stuff blocks (block won the point) per game.'],
    ['Dig/g', 'Digs that kept the ball up (Up, Good or Perfect) per game.'],
    ['Dig', 'Average dig grade: 0 miss, 1 up, 2 good, 3 perfect (right to the setter), with how many digs in brackets.'],
  ];
  return h('details', { class: 'stats-key' }, h('summary', {}, 'What the columns mean'),
    h('dl', {}, rows.flatMap(([t, d]) => [h('dt', {}, t), h('dd', {}, d)])),
    h('p', { class: 'muted small' }, 'Small numbers move a lot: one bad pass out of 8 shifts the average by more than 0.1. SetMe only rates a skill from these once a player has enough: ',
      Object.values(SKILL_STATS).map(d => `${d.min}+ ${d.label === 'Blocks per game' || d.label === 'Digs per game' ? 'games' : 'attempts'} for ${d.label.toLowerCase()}`).join(', '), '.'));
}

// Who changed what and when, newest first. Changes one person made to one player within a few minutes show as one entry.
// Super: filtered to the raters picked above. Anyone else: their own changes only, without rater names.
// Narrowed to one player when their name is tapped in the table.
function historyCard(changeLog, players, ratings, allRaters, pname, short, all) {
  const el = foldCard('history', 'Rating history');
  if (!changeLog) {
    el.body.append(h('p', { class: 'muted' }, all ? 'Not set up yet: run the rating history SQL from the README in Supabase.' : 'Not available yet.'));
    return { el, draw() {}, show() {} };
  }
  const known = new Map(players.map(p => [p.id, p]));
  let used = [], player = '', limit = 30, mode = 'skill', chartRater = null, allMode = 'count';
  const playerBox = comboBox([['', 'All players'], ...players.map(p => [String(p.id), p.name])], v => { player = v; limit = 30; paint(); }, 'Player');
  const list = h('div', { class: 'history' });
  // Chart for one player: their skills over time from one rater, or each rater's total over time.
  const modeSeg = seg([['skill', 'By skill'], ['total', all ? 'Total by rater' : 'Total']], mode, v => { mode = v; paintChart(); }, 'Chart');
  const raterRow = h('div', { class: 'row chart-raters' });
  const chartBox = h('div', { class: 'chart-box' });
  // Chart for all players: changes per day, or every player's total / weighted total over time.
  const allSeg = seg([['count', 'Changes per day'], ['total', 'Total'], ['weighted', 'Weighted']], allMode, v => { allMode = v; paintChart(); }, 'Chart');
  const chartWrap = h('div', { class: 'history-chart' }, h('div', { class: 'toolbar' }, modeSeg, allSeg, raterRow), chartBox);
  let stopChart = () => {};
  const paintChart = () => {
    stopChart(); stopChart = () => {};
    modeSeg.hidden = !player;
    allSeg.hidden = !!player;
    if (!player) {
      raterRow.replaceChildren();
      const rows = changeLog.filter(c => known.has(c.player_id) && used.includes(c.rater_id));
      allSeg.hidden = !rows.length;
      if (!rows.length) return chartBox.replaceChildren();
      stopChart = allMode === 'count' ? changesChart(chartBox, rows, all && used.length > 1 ? short : null)
        : playersChart(chartBox, { log: changeLog, ratings, players, raters: used, metric: allMode, onpick: id => show(id) });
      return;
    }
    const pid = Number(player);
    const withRows = used.filter(r => changeLog.some(c => c.rater_id === r && c.player_id === pid));
    if (!withRows.length) { raterRow.replaceChildren(); chartBox.replaceChildren(h('p', { class: 'muted' }, 'No changes for this player yet.')); return; }
    if (!withRows.includes(chartRater)) chartRater = changeLog.find(c => c.player_id === pid && withRows.includes(c.rater_id)).rater_id;
    raterRow.replaceChildren(...(mode === 'skill' && all && withRows.length > 1
      ? [h('span', { class: 'muted small' }, 'Rater'), seg(withRows.map(r => [r, short(r)]), chartRater, v => { chartRater = v; paintChart(); }, 'Rater for chart')]
      : mode === 'skill' && all ? [h('span', { class: 'muted small' }, short(chartRater))] : []));
    stopChart = historyChart(chartBox, { log: changeLog, ratings, pid, mode, raters: mode === 'skill' ? [chartRater] : withRows,
      slotOf: r => allRaters.indexOf(r), name: all ? short : () => 'Total' });
  };
  const more = h('button', { type: 'button', class: 'ghost sm' }, 'Show more');
  more.onclick = () => { limit += 30; paint(); };
  const when = t => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  const paint = () => {
    // Group rows (already newest first) by rater, player and who changed it, within 5 minutes of each other.
    const groups = [];
    for (const r of changeLog) {
      if (!known.has(r.player_id) || !used.includes(r.rater_id)) continue;
      if (player && String(r.player_id) !== player) continue;
      const g = groups.at(-1);
      if (g && g.rater_id === r.rater_id && g.player_id === r.player_id && g.changed_by === r.changed_by && new Date(g.last) - new Date(r.changed_at) < 5 * 60e3) {
        g.rows.push(r); g.last = r.changed_at;
      } else groups.push({ rater_id: r.rater_id, player_id: r.player_id, changed_by: r.changed_by, at: r.changed_at, last: r.changed_at, rows: [r] });
    }
    list.replaceChildren(...(groups.length ? groups.slice(0, limit).map(g => h('div', { class: 'history-item' },
      h('div', { class: 'history-head' },
        h('span', {}, h('b', {}, known.get(g.player_id).name), all && ' · ', all && short(g.rater_id),
          g.changed_by && g.changed_by !== g.rater_id && h('span', { class: 'muted' }, ` (entered by ${pname.get(g.changed_by) ?? 'someone else'})`)),
        h('span', { class: 'muted small' }, when(g.at))),
      h('div', { class: 'chips' }, RATED.filter(s => g.rows.some(r => r.skill === s)).map(s => {
        // Oldest row's "from" and newest row's "to" for this skill.
        const rs = g.rows.filter(r => r.skill === s), from = rs.at(-1).old_value, to = rs[0].new_value;
        const dir = from == null || to == null ? '' : Number(to) > Number(from) ? 'up' : 'down';
        return h('span', { class: `chip plain ${dir}` }, `${SHORT[s]} ${fmt(from == null ? null : Number(from))} → ${fmt(to == null ? null : Number(to))}`);
      }))))
      : [h('p', { class: 'muted' }, used.length ? 'No changes yet.' : 'Please select at least one rater.')]));
    more.hidden = groups.length <= limit;
    paintChart();
  };
  el.body.append(
    h('p', { class: 'muted small' }, 'How many ratings changed each day, or every player\'s total over time. Pick a player (or tap their name in the table) to chart just their ratings. Recorded from when history was switched on.'),
    h('div', { class: 'toolbar' }, h('div', { class: 'sort' }, h('span', {}, 'Player'), playerBox.el)),
    chartWrap, list, more);
  const show = id => { player = String(id); playerBox.set(player); limit = 30; paint(); el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return { el, draw(ids) { used = ids; paint(); }, show };
}

// ---------- rating history chart ----------
// Step lines: a rating holds its value until someone changes it. U / no rating = a gap in the line.
// mode 'skill': one rater, a line per skill (0 to 1). mode 'total': a line per rater, total of the five skills (0 to 5),
// a gap while any of them is U. Colours follow the skill or rater (fixed slots), never their position in the list.
export const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
};
const SLOTS = 7;
function historyChart(box, { log, ratings, pid, mode, raters, slotOf, name }) {
  const num = v => v == null ? null : Number(v);
  const now = Date.now();
  // Value of each skill over time for one rater: [[time, value], ...], starting before the first change.
  const timeline = rid => {
    const rows = log.filter(c => c.rater_id === rid && c.player_id === pid).map(c => ({ ...c, t: new Date(c.changed_at).getTime() })).sort((a, b) => a.t - b.t);
    const cur = ratings.find(r => r.rater_id === rid && r.player_id === pid);
    const out = {};
    for (const sk of RATED) {
      const rs = rows.filter(r => r.skill === sk);
      out[sk] = rs.length ? [[-Infinity, num(rs[0].old_value)], ...rs.map(r => [r.t, num(r.new_value)])] : [[-Infinity, num(cur?.[sk])]];
    }
    return { rows, out };
  };
  const at = (steps, t) => { let v = steps[0][1]; for (const [st, sv] of steps) { if (st <= t) v = sv; else break; } return v; };
  const lines = raters.map(rid => ({ rid, ...timeline(rid) }));
  const times = [...new Set(lines.flatMap(l => l.rows.map(r => r.t)))].sort((a, b) => a - b);
  const series = mode === 'skill'
    ? RATED.map((sk, i) => ({ key: sk, label: LABEL[sk], slot: i, value: t => at(lines[0].out[sk], t) }))
      // Setting only for players who have a setting rating at some point.
      .filter(se => se.key !== 'setting_skill' || lines[0].out.setting_skill.some(([, v]) => v != null))
    : lines.map(l => ({ key: l.rid, label: name(l.rid), slot: slotOf(l.rid), value: t => {
        const vs = SKILLS.map(sk => at(l.out[sk], t));
        return vs.some(v => v == null) ? null : vs.reduce((a, b) => a + b, 0);
      } }));
  const yMax = mode === 'skill' ? 1 : SKILLS.length;
  const yTicks = mode === 'skill' ? [0, .25, .5, .75, 1] : [0, 1, 2, 3, 4, 5];
  const first = times[0], span = Math.max(now - first, 60e3), pad = Math.max(span * .08, 30 * 60e3);
  const t0 = first - pad, t1 = now;
  const stops = [t0, ...times, t1]; // where the crosshair can rest
  const color = slot => slot >= 0 && slot < SLOTS ? `var(--s${slot + 1})` : 'var(--muted)';

  const legend = h('div', { class: 'chart-legend' }, series.map(se => h('span', {}, h('i', { style: `background:${color(se.slot)}` }), se.label)));
  const plot = h('div', { class: 'chart-plot' });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  plot.append(tip);
  box.replaceChildren(legend, plot);

  let W = 0, svgEl = null, cross = null, xOf, yOf, focusIdx = stops.length - 1;
  const H = 220, M = { l: 34, r: 12, t: 10, b: 26 };
  const sameDay = span < 36 * 3600e3;
  const tickLabel = t => new Date(t).toLocaleString([], sameDay ? { hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short' });
  const tipTime = t => t === t0 ? 'Before the first change' : t === t1 ? 'Now' : new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  const render = () => {
    W = plot.clientWidth; if (!W) return;
    xOf = t => M.l + (t - t0) / (t1 - t0) * (W - M.l - M.r);
    yOf = v => M.t + (1 - v / yMax) * (H - M.t - M.b);
    const grid = yTicks.map(v => svg('g', {},
      svg('line', { x1: M.l, x2: W - M.r, y1: yOf(v), y2: yOf(v), class: 'grid' }),
      svg('text', { x: M.l - 6, y: yOf(v), class: 'axis', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, mode === 'skill' ? fmt(v) : String(v))));
    const n = Math.max(2, Math.min(5, Math.floor((W - M.l - M.r) / 90)));
    const xt = Array.from({ length: n }, (_, i) => t0 + (t1 - t0) * i / (n - 1));
    const xAxis = xt.map((t, i) => svg('text', { x: xOf(t), y: H - 6, class: 'axis', 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, i === n - 1 ? 'Now' : tickLabel(t)));
    const paths = series.map(se => {
      // Steps from t0 to now; a null value lifts the pen.
      const pts = stops.map(t => [t, se.value(t)]);
      let d = '', prev = null;
      for (let i = 0; i < pts.length; i++) {
        const [t, v] = pts[i], next = pts[i + 1]?.[0] ?? t1;
        if (v == null) { prev = null; continue; }
        // The previous step ended at (t, prev): rise or fall straight up/down, then run flat to the next change.
        if (prev == null) d += `M${xOf(t)},${yOf(v)}`; else if (v !== prev) d += `L${xOf(t)},${yOf(v)}`;
        d += `L${xOf(next)},${yOf(v)}`;
        prev = v;
      }
      const dots = times.filter(t => { const v = se.value(t), b = se.value(t - 1); return v != null && v !== b; })
        .map(t => svg('circle', { cx: xOf(t), cy: yOf(se.value(t)), r: 4, class: 'dot', fill: color(se.slot) }));
      return svg('g', {}, svg('path', { d, class: 'line', stroke: color(se.slot) }), dots);
    });
    cross = svg('line', { y1: M.t, y2: H - M.b, class: 'cross', visibility: 'hidden' });
    const hit = svg('rect', { x: M.l, y: 0, width: W - M.l - M.r, height: H, fill: 'transparent' });
    svgEl = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: 0,
      'aria-label': `Rating history chart. ${series.length} lines. Use left and right arrow keys to step through changes.` }, grid, xAxis, cross, paths, hit);
    svgEl.onpointermove = e => { const x = e.clientX - svgEl.getBoundingClientRect().left; show(nearest(x)); };
    svgEl.onpointerleave = hide;
    svgEl.onfocus = () => show(focusIdx);
    svgEl.onblur = hide;
    svgEl.onkeydown = e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); show(Math.max(0, Math.min(stops.length - 1, focusIdx + (e.key === 'ArrowRight' ? 1 : -1))));
    };
    plot.querySelector('svg')?.remove();
    plot.prepend(svgEl);
  };
  const nearest = x => stops.reduce((best, t, i) => Math.abs(xOf(t) - x) < Math.abs(xOf(stops[best]) - x) ? i : best, 0);
  const show = i => {
    focusIdx = i; const t = stops[i], x = xOf(t);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    tip.replaceChildren(h('div', { class: 'chart-tip-head' }, tipTime(t)),
      ...series.map(se => { const v = se.value(t); return h('div', { class: 'chart-tip-row' }, h('i', { style: `background:${color(se.slot)}` }), h('b', {}, fmt(v)), ' ', se.label); }));
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(W - tw, x > W / 2 ? x - tw - 12 : x + 12))}px`;
  };
  const hide = () => { tip.hidden = true; cross?.setAttribute('visibility', 'hidden'); };
  const ro = new ResizeObserver(() => { if (plot.clientWidth !== W) render(); });
  ro.observe(plot);
  render();
  return () => ro.disconnect();
}

// All players: each player's total (or weighted total) over time, a faint step line per player whose number moved.
// Ratings at any moment = today's ratings with every later change undone. One rater: what they entered (a gap while
// any skill is U). Several: combined like the table (leans taken out), a gap while nobody has rated them.
// Hover or arrow keys pick out one player (up/down to switch players); click or Enter opens their history.
function playersChart(box, { log, ratings, players, raters, metric, onpick }) {
  const metricOf = metric === 'weighted' ? weightedTotal : sk => SKILLS.reduce((a, s) => a + sk[s], 0);
  const known = new Set(players.map(p => p.id));
  const rows = log.filter(c => raters.includes(c.rater_id) && known.has(c.player_id))
    .map(c => ({ ...c, t: new Date(c.changed_at).getTime() })).sort((a, b) => a.t - b.t);
  // One stop per burst of changes (gaps under 5 minutes), at the burst's last change.
  const times = [];
  for (const r of rows) if (times.length && r.t - times.at(-1) < 5 * 60e3) times[times.length - 1] = r.t; else times.push(r.t);
  const now = Date.now(), first = times[0], span = Math.max(now - first, 60e3), pad = Math.max(span * .08, 30 * 60e3);
  const t0 = first - pad, t1 = now, stops = [t0, ...times, t1];

  // Walk back from today's ratings, undoing changes newer than each stop.
  const key = (rid, pid) => `${rid}|${pid}`;
  const snap = new Map(ratings.filter(r => raters.includes(r.rater_id) && known.has(r.player_id)).map(r => [key(r.rater_id, r.player_id), { ...r }]));
  const raw = raters.length === 1;
  const valuesNow = () => {
    if (raw) return new Map(players.map(p => {
      const r = snap.get(key(raters[0], p.id));
      const sk = Object.fromEntries(SKILLS.map(s => [s, r?.[s] == null ? null : Number(r[s])]));
      return [p.id, SKILLS.some(s => sk[s] == null) ? null : metricOf(sk)];
    }));
    const { combined } = combineRatings(players, [...snap.values()]);
    return new Map(players.map(p => { const c = combined.get(p.id); return [p.id, c.guess ? null : metricOf(c.skills)]; }));
  };
  const vals = new Array(stops.length);
  let undo = rows.length - 1;
  for (let i = stops.length - 1; i >= 0; i--) {
    for (; undo >= 0 && rows[undo].t > stops[i]; undo--) {
      const r = rows[undo], k = key(r.rater_id, r.player_id);
      if (!snap.has(k)) snap.set(k, { rater_id: r.rater_id, player_id: r.player_id });
      snap.get(k)[r.skill] = r.old_value;
    }
    vals[i] = valuesNow();
  }
  const series = players.map(p => ({ p, v: vals.map(m => m.get(p.id)) }))
    .filter(se => se.v.some((v, i) => i && v != null && (se.v[i - 1] == null || Math.abs(v - se.v[i - 1]) > 1e-9)));
  if (!series.length) { box.replaceChildren(h('p', { class: 'muted' }, 'No totals have changed yet.')); return () => {}; }

  const vs = series.flatMap(se => se.v).filter(v => v != null);
  let lo = Math.floor(Math.min(...vs) * 2) / 2, hi = Math.ceil(Math.max(...vs) * 2) / 2;
  if (hi - lo < 1) { lo = Math.max(0, lo - .5); hi = lo + 1; }
  const tickStep = hi - lo > 3 ? 1 : .5;
  const yTicks = []; for (let v = Math.ceil(lo / tickStep) * tickStep; v <= hi + 1e-9; v += tickStep) yTicks.push(v);
  const sameDay = span < 36 * 3600e3;
  const tickLabel = t => new Date(t).toLocaleString([], sameDay ? { hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short' });
  const tipTime = t => t === t0 ? 'Before the first change' : t === t1 ? 'Now' : new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const signed = v => `${v > 0 ? '+' : ''}${fmt(v)}`;

  const label = metric === 'weighted' ? 'Weighted total' : 'Total';
  const head = h('div', { class: 'chart-legend' }, `${label} over time for the ${series.length} ${series.length === 1 ? 'player' : 'players'} whose ${label.toLowerCase()} changed. Hover to pick one out, tap to open their history.`);
  const plot = h('div', { class: 'chart-plot' });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  plot.append(tip);
  box.replaceChildren(head, plot);

  let W = 0, svgEl = null, cross = null, xOf, yOf, focusIdx = stops.length - 1, focusSe = null, paths = [];
  const H = 240, M = { l: 34, r: 12, t: 10, b: 26 };
  const render = () => {
    W = plot.clientWidth; if (!W) return;
    xOf = t => M.l + (t - t0) / (t1 - t0) * (W - M.l - M.r);
    yOf = v => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);
    const grid = yTicks.map(v => svg('g', {},
      svg('line', { x1: M.l, x2: W - M.r, y1: yOf(v), y2: yOf(v), class: 'grid' }),
      svg('text', { x: M.l - 6, y: yOf(v), class: 'axis', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, fmt(v))));
    const n = Math.max(2, Math.min(5, Math.floor((W - M.l - M.r) / 90)));
    const xt = Array.from({ length: n }, (_, i) => t0 + (t1 - t0) * i / (n - 1));
    const xAxis = xt.map((t, i) => svg('text', { x: xOf(t), y: H - 6, class: 'axis', 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, i === n - 1 ? 'Now' : tickLabel(t)));
    paths = series.map(se => {
      let d = '', prev = null;
      se.v.forEach((v, i) => {
        if (v == null) { prev = null; return; }
        if (prev == null) d += `M${xOf(stops[i])},${yOf(v)}`; else if (v !== prev) d += `L${xOf(stops[i])},${yOf(v)}`;
        d += `L${xOf(stops[i + 1] ?? t1)},${yOf(v)}`;
        prev = v;
      });
      return svg('path', { d, class: 'line faint' });
    });
    cross = svg('line', { y1: M.t, y2: H - M.b, class: 'cross', visibility: 'hidden' });
    const hit = svg('rect', { x: M.l, y: 0, width: W - M.l - M.r, height: H, fill: 'transparent' });
    svgEl = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: 0, class: 'clickable',
      'aria-label': `${label} over time for ${series.length} players. Left and right arrow keys step through changes, up and down switch players, Enter opens a player's history.` },
      grid, xAxis, ...paths, cross, hit);
    svgEl.onpointermove = e => {
      const b = svgEl.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
      const i = stops.reduce((best, t, j) => Math.abs(xOf(t) - x) < Math.abs(xOf(stops[best]) - x) ? j : best, 0);
      // The line closest to the pointer at that moment.
      const se = series.filter(s => s.v[i] != null).reduce((best, s) => !best || Math.abs(yOf(s.v[i]) - y) < Math.abs(yOf(best.v[i]) - y) ? s : best, null);
      show(i, se);
    };
    svgEl.onpointerleave = hide;
    svgEl.onclick = () => focusSe && onpick(focusSe.p.id);
    svgEl.onfocus = () => show(focusIdx, focusSe);
    svgEl.onblur = hide;
    svgEl.onkeydown = e => {
      if (e.key === 'Enter' && focusSe) { e.preventDefault(); onpick(focusSe.p.id); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); show(Math.max(0, Math.min(stops.length - 1, focusIdx + (e.key === 'ArrowRight' ? 1 : -1))), focusSe); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        // Players with a value at this moment, top of the chart first.
        const order = series.filter(s => s.v[focusIdx] != null).sort((a, b) => b.v[focusIdx] - a.v[focusIdx]);
        if (!order.length) return;
        const at = order.indexOf(focusSe);
        show(focusIdx, order[at < 0 ? 0 : Math.max(0, Math.min(order.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]);
      }
    };
    plot.querySelector('svg')?.remove();
    plot.prepend(svgEl);
    if (focusSe) mark(focusSe);
  };
  // Highlight one line and draw it above the others (the crosshair and hit area stay on top).
  const mark = se => paths.forEach((p, j) => {
    const on = series[j] === se;
    p.classList.toggle('hot', on);
    if (on) p.parentNode.insertBefore(p, cross);
  });
  const show = (i, se) => {
    focusIdx = i; const t = stops[i], x = xOf(t);
    se ??= series.filter(s => s.v[i] != null).sort((a, b) => b.v[i] - a.v[i])[0] ?? null;
    focusSe = se; mark(se);
    cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
    const v = se?.v[i], start = se?.v.find(x => x != null);
    // How many of the lines moved at this stop.
    const moved = i ? series.filter(s => s.v[i] != null && s.v[i - 1] != null && Math.abs(s.v[i] - s.v[i - 1]) > 1e-9).length : 0;
    tip.replaceChildren(h('div', { class: 'chart-tip-head' }, tipTime(t)),
      se && h('div', { class: 'chart-tip-row' }, h('i', { style: 'background:var(--s1)' }), h('b', {}, fmt(v)), ' ', se.p.name),
      se && v != null && start != null && h('div', { class: 'chart-tip-row muted' }, `${signed(v - start)} since first shown`),
      i > 0 && i < stops.length - 1 && h('div', { class: 'chart-tip-row muted' }, `${moved} ${moved === 1 ? 'player' : 'players'} moved here`));
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(W - tw, x > W / 2 ? x - tw - 12 : x + 12))}px`;
  };
  const hide = () => { tip.hidden = true; cross?.setAttribute('visibility', 'hidden'); focusSe = null; mark(null); };
  const ro = new ResizeObserver(() => { if (plot.clientWidth !== W) render(); });
  ro.observe(plot);
  render();
  return () => ro.disconnect();
}

// All players: how many skill ratings changed each day (last 60 days at most), one column per day.
// Hover or arrow keys show the day's count, split by rater when byRater is given.
function changesChart(box, rows, byRater) {
  const DAY = 864e5, dayOf = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const today = dayOf(Date.now()), firstDay = Math.max(dayOf(Math.min(...rows.map(r => new Date(r.changed_at)))), today - 59 * DAY);
  const days = [];
  for (let t = firstDay; t <= today; t = dayOf(t + DAY * 1.5)) days.push({ t, rows: [] });
  for (const r of rows) { const d = days.find(x => x.t === dayOf(r.changed_at)); if (d) d.rows.push(r); }
  const max = Math.max(1, ...days.map(d => d.rows.length));
  const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : Math.ceil(max / 5 / 10) * 10;
  const yMax = Math.ceil(max / step) * step, yTicks = Array.from({ length: yMax / step + 1 }, (_, i) => i * step);
  const dayLabel = t => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });

  const head = h('div', { class: 'chart-legend' }, 'Rating changes per day');
  const plot = h('div', { class: 'chart-plot' });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  plot.append(tip);
  box.replaceChildren(head, plot);

  let W = 0, bars = [], focusIdx = days.length - 1, xOf, bw;
  const H = 180, M = { l: 30, r: 8, t: 10, b: 26 };
  const render = () => {
    W = plot.clientWidth; if (!W) return;
    const band = (W - M.l - M.r) / days.length;
    bw = Math.max(2, Math.min(24, band * .7));
    xOf = i => M.l + band * i + band / 2;
    const yOf = v => M.t + (1 - v / yMax) * (H - M.t - M.b);
    const grid = yTicks.map(v => svg('g', {},
      svg('line', { x1: M.l, x2: W - M.r, y1: yOf(v), y2: yOf(v), class: 'grid' }),
      svg('text', { x: M.l - 6, y: yOf(v), class: 'axis', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, String(v))));
    // Date labels: first, last, and evenly spaced ones in between that fit.
    const every = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor((W - M.l - M.r) / 70))));
    const xAxis = days.map((d, i) => (i === days.length - 1 || (i % every === 0 && days.length - 1 - i >= every / 2)) &&
      svg('text', { x: xOf(i), y: H - 6, class: 'axis', 'text-anchor': days.length === 1 ? 'middle' : i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle' }, i === days.length - 1 ? 'Today' : dayLabel(d.t)));
    // Column with a 4px rounded top, square at the baseline.
    const col = (x, y, w, hgt) => { const r = Math.min(4, w / 2, hgt); return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`; };
    bars = days.map((d, i) => d.rows.length ? svg('path', { d: col(xOf(i) - bw / 2, yOf(d.rows.length), bw, yOf(0) - yOf(d.rows.length)), class: 'bar' }) : null);
    const hit = svg('rect', { x: M.l, y: 0, width: W - M.l - M.r, height: H, fill: 'transparent' });
    const el = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: 0,
      'aria-label': `Rating changes per day, ${dayLabel(days[0].t)} to today. Use left and right arrow keys to step through days.` }, grid, xAxis, bars, hit);
    el.onpointermove = e => { const x = e.clientX - el.getBoundingClientRect().left; show(Math.max(0, Math.min(days.length - 1, Math.floor((x - M.l) / band)))); };
    el.onpointerleave = hide; el.onblur = hide;
    el.onfocus = () => show(focusIdx);
    el.onkeydown = e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); show(Math.max(0, Math.min(days.length - 1, focusIdx + (e.key === 'ArrowRight' ? 1 : -1))));
    };
    plot.querySelector('svg')?.remove();
    plot.prepend(el);
  };
  const show = i => {
    focusIdx = i; const d = days[i];
    bars.forEach((b, j) => b?.classList.toggle('dim', j !== i));
    const counts = byRater ? [...d.rows.reduce((m, r) => m.set(r.rater_id, (m.get(r.rater_id) ?? 0) + 1), new Map())] : [];
    tip.replaceChildren(h('div', { class: 'chart-tip-head' }, dayLabel(d.t)),
      h('div', {}, h('b', {}, String(d.rows.length)), d.rows.length === 1 ? ' change' : ' changes'),
      ...counts.sort((a, b) => b[1] - a[1]).map(([rid, n]) => h('div', { class: 'chart-tip-row muted' }, h('b', {}, String(n)), ' ', byRater(rid))));
    tip.hidden = false;
    const tw = tip.offsetWidth, x = xOf(i);
    tip.style.left = `${Math.max(0, Math.min(W - tw, x > W / 2 ? x - bw / 2 - tw - 8 : x + bw / 2 + 8))}px`;
  };
  const hide = () => { tip.hidden = true; bars.forEach(b => b?.classList.remove('dim')); };
  const ro = new ResizeObserver(() => { if (plot.clientWidth !== W) render(); });
  ro.observe(plot);
  render();
  return () => ro.disconnect();
}

// Dropdown you can type into: tap to see every option, type to narrow the list, arrows + Enter to pick, Esc to close.
// options: [[value, label], ...]; the first one is the "nothing picked" choice shown when the box is cleared.
let comboSeq = 0;
function comboBox(options, onchange, label) {
  const id = `combo-${++comboSeq}`;
  let value = options[0][0], shown = [], active = -1;
  const labelOf = v => options.find(o => o[0] === v)?.[1] ?? '';
  const input = h('input', { type: 'text', role: 'combobox', 'aria-label': label, 'aria-expanded': 'false', 'aria-controls': id,
    'aria-autocomplete': 'list', autocomplete: 'off', spellcheck: 'false', value: labelOf(value) });
  const list = h('ul', { id, role: 'listbox', class: 'combo-list', hidden: true });
  const arrow = h('button', { type: 'button', class: 'combo-arrow', tabindex: -1, 'aria-label': `Show ${label} options` }, '▾');
  const el = h('div', { class: 'combo' }, input, arrow, list);

  const render = filter => {
    const f = filter.trim().toLowerCase();
    shown = f ? options.filter(([, t]) => t.toLowerCase().includes(f)) : options;
    active = shown.findIndex(o => o[0] === value);
    if (active < 0 && f) active = 0;
    list.replaceChildren(...(shown.length ? shown.map(([v, t], i) => {
      const li = h('li', { role: 'option', id: `${id}-${i}`, 'aria-selected': String(v === value), class: i === active ? 'active' : '' }, t);
      li.onmousedown = e => { e.preventDefault(); pick(v); };
      return li;
    }) : [h('li', { class: 'muted empty' }, 'No matches')]));
    mark();
  };
  const mark = () => {
    [...list.children].forEach((li, i) => li.classList.toggle('active', i === active));
    const cur = list.children[active];
    if (cur?.id) { input.setAttribute('aria-activedescendant', cur.id); cur.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  };
  const open = (filter = '') => { list.hidden = false; input.setAttribute('aria-expanded', 'true'); render(filter); };
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); input.value = labelOf(value); };
  const pick = v => { const changed = v !== value; value = v; close(); if (changed) onchange(v); };

  input.onfocus = () => { input.select(); open(); };
  input.onclick = () => { if (list.hidden) open(); };
  input.oninput = () => open(input.value);
  input.onblur = close;
  input.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) return open();
      if (shown.length) { active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; mark(); }
    } else if (e.key === 'Enter') {
      if (!list.hidden) { e.preventDefault(); if (shown[active]) pick(shown[active][0]); }
    } else if (e.key === 'Escape') { if (!list.hidden) { e.preventDefault(); close(); } }
  };
  arrow.onmousedown = e => { e.preventDefault(); if (list.hidden) { input.focus(); } else close(); };
  return { el, set(v) { value = v; close(); } };
}

const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
export const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v));
const leanClass = v => Math.abs(v) < .05 ? null : v > 0 ? 'lean-up' : 'lean-down';

// One row per rater: their lean per skill (taken out of combined ratings), how far off the group they land, and on how much.
function raterCard(raters, offsets, stats, short) {
  const rows = [...raters].sort((a, b) => short(a).localeCompare(short(b))).map(rid => {
    const st = stats.get(rid), o = offsets.get(rid);
    const used = SKILLS.filter(s => st.applied[s]);
    const overall = used.length ? avg(used.map(s => o[s])) : null;
    const misses = SKILLS.map(s => st.miss[s]).filter(v => v != null);
    return h('tr', {},
      h('td', { title: short.full(rid) }, h('b', {}, short(rid))),
      RATED.map(s => st.applied[s]
        ? h('td', { class: `num ${leanClass(o[s]) ?? ''}` }, signed(o[s]))
        : h('td', { class: 'num muted', title: 'Fewer than 5 shared ratings, so not adjusted yet' }, '—')),
      h('td', { class: `num ${overall == null ? 'muted' : leanClass(overall) ?? ''}` }, h('b', {}, overall == null ? '—' : signed(overall))),
      h('td', { class: 'num' }, misses.length ? fmt(avg(misses)) : '—'),
      h('td', { class: 'num muted' }, String(Math.max(0, ...RATED.map(s => st.shared[s])))));
  });
  return foldCard('leans', 'How each rater rates',
    h('p', { class: 'muted small' },
      h('b', { class: 'lean-up' }, '+'), ' rates higher than the group on the same players, ', h('b', { class: 'lean-down' }, '−'), ' lower. ',
      'Combined ratings take this out. ', h('b', {}, 'Off by'), ' is how far they typically land from the group after that; ',
      'a high number means their ratings don\'t line up with everyone else\'s. ', h('b', {}, 'Shared'), ' is how many of their players someone else also rated; ',
      '— means fewer than 5, so no adjustment yet.'),
    rows.length ? h('div', { class: 'scroll' }, stacked(h('table', { class: 'rater-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Rater'), RATED.map(s => h('th', { class: 'num' }, SHORT[s])),
        h('th', { class: 'num' }, 'Overall'), h('th', { class: 'num' }, 'Off by'), h('th', { class: 'num' }, 'Shared'))),
      h('tbody', {}, rows))))
      : h('p', { class: 'muted' }, 'No ratings yet.'));
}

// Players whose raters are a point or more apart, with each rater's total and, on tap, what they entered per skill.
function disagreeCard(disagreements, short) {
  return foldCard('disagree', 'Raters disagree',
    h('p', { class: 'muted small' }, 'Totals after each rater\'s lean is taken out, so these are real differences of opinion. Gap of 1 or more.'),
    disagreements.length ? h('div', { class: 'disagree' }, disagreements.map(d => h('div', { class: 'disagree-item' },
      h('div', { class: 'disagree-head' }, h('b', {}, d.name), h('span', { class: 'badge' }, `Gap ${fmt(d.gap)}`)),
      h('div', { class: 'chips' }, d.totals.map((t, i) => h('span', {
        class: `chip plain ${i === 0 ? 'hi' : i === d.totals.length - 1 ? 'lo' : ''}`, title: short.full(t.rater_id),
      }, `${short(t.rater_id)} ${fmt(t.total)}`))),
      h('details', {}, h('summary', {}, 'By skill (as entered)'),
        h('table', { class: 'mini' },
          h('thead', {}, h('tr', {}, h('th', {}), RATED.map(s => h('th', { class: 'num' }, SHORT[s])))),
          h('tbody', {}, d.totals.map(t => h('tr', {}, h('td', {}, short(t.rater_id)), RATED.map(s => h('td', { class: 'num' }, fmt(t.raw[s])))))))))))
      : h('p', { class: 'muted' }, 'No player has raters a full point apart.'));
}
