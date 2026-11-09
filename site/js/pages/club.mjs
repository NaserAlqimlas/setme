import { ask, avatar, callFn, canProfile, fmt, LABEL, forPlayer, h, me, missing, needsUpgrade, pageHead, profileLink, q, render, sb, SHORT, stacked, TEAM_COLORS, toast, today, toggle } from '../ui.mjs';
import { combineRatings, RATED, SKILLS, teamNames, weightedTotal } from '../teams.mjs';
import { analyze, playerStats, resultAdjustments } from '../scores.mjs';
import { gameTallies, metrics, score, tallyFromCounts } from '../stats.mjs';
import { attendance, record } from '../club.mjs';
import { courtShare, dayTitle, setterBadge } from './teams.mjs';
import { pct, plusPts, withEarlier } from './scores.mjs';
import { openHistory, signed, svg } from './ratings.mjs';
import { GUIDE, STEPS } from './rate.mjs';
import { signupStatus } from '../gameday.mjs';

// Club pages: Sign up, Lineup (players and raters) and player profiles.

// ---------- sign up (everyone) ----------
// Game days people sign up for (supabase/club.sql). The first `cap` sign-ups are in; the rest wait, in order, and move
// up when someone drops out. Accounts linked to a player (Users page) sign themselves up or out while it's open;
// organizers add or remove anyone, open and close it, and turn the list into the Playing list.
export async function signupPage() {
  const organizer = me.role === 'organizer' || me.role === 'super';
  const head = pageHead('Sign up', organizer ? 'Open a game day, share the site, and turn who\'s in into the Playing list.' : 'Say you\'re coming. If it\'s full you go on the waitlist and move up when someone drops out.');
  let events, signups, players;
  try {
    [events, signups, players] = await Promise.all([
      q(sb.from('events').select('*').order('played_on')),
      q(sb.from('signups').select('*').order('created_at')),
      q(sb.from('players').select('id,name,active').order('name')),
    ]);
  } catch (e) { if (missing(e)) return h('div', {}, head, needsUpgrade('Signing up')); throw e; }
  const pname = new Map(players.map(p => [p.id, p.name]));
  const mine = me.player_id;
  const now = today();
  const upcoming = events.filter(e => e.played_on >= now), past = events.filter(e => e.played_on < now).reverse().slice(0, 4);
  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); render(); } catch (e) { toast(e.message); } };

  const eventCard = ev => {
    const list = signups.filter(x => x.event_id === ev.id);
    const ins = list.slice(0, ev.cap), wait = list.slice(ev.cap);
    const st = signupStatus(list, ev.cap, mine);
    const old = ev.played_on < now;
    const chip = (x, n) => h('span', { class: `chip${x.player_id === mine ? ' me' : ''}${organizer ? '' : ' plain'}` },
      n != null && h('span', { class: 'muted small' }, `${n}. `), profileLink(x.player_id, pname.get(x.player_id) ?? 'Removed player'),
      organizer && h('button', { type: 'button', 'aria-label': `Remove ${pname.get(x.player_id)}`, onclick: () => act(() => q(sb.from('signups').delete().eq('event_id', ev.id).eq('player_id', x.player_id))) }, '×'));
    const status = st.kind === 'in' ? h('span', { class: 'badge on' }, 'You\'re in') : st.kind === 'waitlist' ? h('span', { class: 'badge' }, `Waitlist #${st.place}`) : null;
    const meBtn = mine && !old && (st.kind === 'out'
      ? h('button', { class: 'ball', disabled: !ev.open, onclick: () => act(() => q(sb.from('signups').insert({ event_id: ev.id, player_id: mine })), ins.length >= ev.cap ? 'On the waitlist' : 'You\'re in') }, ins.length >= ev.cap ? 'Join the waitlist' : 'I\'m in')
      : h('button', { class: 'ghost', disabled: !ev.open, onclick: async () => await ask('Drop out of this game day?', 'If there\'s a waitlist, the next person gets your spot.', 'Drop out') && act(() => q(sb.from('signups').delete().eq('event_id', ev.id).eq('player_id', mine)), 'Dropped out') }, 'Drop out'));
    const add = organizer && h('select', { 'aria-label': 'Add a player' }, h('option', { value: '' }, '+ Add player'),
      players.filter(p => p.active && !list.some(x => x.player_id === p.id)).map(p => h('option', { value: p.id }, p.name)));
    if (add) add.onchange = () => add.value && act(() => q(sb.from('signups').insert({ event_id: ev.id, player_id: Number(add.value) })));
    const capIn = organizer && h('input', { type: 'number', min: 2, max: 200, value: ev.cap, class: 'score-in', 'aria-label': 'Spots' });
    if (capIn) capIn.onchange = () => { const v = Number(capIn.value); if (!Number.isInteger(v) || v < 2 || v > 200) { capIn.value = ev.cap; return toast('Spots: 2 to 200'); } act(() => q(sb.from('events').update({ cap: v }).eq('id', ev.id)), 'Saved'); };
    const toPlaying = async () => {
      if (!await ask('Set the playing list?', `The ${ins.length} people who are in become the Playing list. Everyone else is unticked.`, 'Set playing list', 'ball')) return;
      act(async () => {
        await q(sb.from('players').update({ playing: false }).eq('playing', true));
        if (ins.length) await q(sb.from('players').update({ playing: true, active: true }).in('id', ins.map(x => x.player_id)));
      }, `${ins.length} players set as playing`);
    };
    return h('div', { class: `card${old ? ' dim' : ''}` },
      h('div', { class: 'card-head' },
        h('div', {}, h('h3', {}, dayTitle(ev.played_on)), h('p', { class: 'muted small', style: 'margin:2px 0 0' },
          `${ins.length} of ${ev.cap} spots taken${wait.length ? `, ${wait.length} waiting` : ''}.${ev.open ? '' : ' Sign-ups closed.'}`, ev.note && h('br'), ev.note)),
        h('div', { class: 'row' }, status, meBtn)),
      !ev.open && mine && !old && h('p', { class: 'muted small' }, 'Sign-ups are closed. Message an organizer if something changed.'),
      h('div', { class: 'chips' }, ins.length ? ins.map(x => chip(x)) : h('span', { class: 'muted small' }, 'Nobody yet.')),
      wait.length > 0 && h('p', { class: 'small', style: 'margin:12px 0 6px' }, h('b', {}, 'Waitlist')),
      wait.length > 0 && h('div', { class: 'chips' }, wait.map((x, n) => chip(x, n + 1))),
      organizer && h('div', { class: 'row', style: 'margin-top:14px; padding-top:12px; border-top:1px solid var(--line)' },
        toggle('Open', ev.open, v => act(() => q(sb.from('events').update({ open: v }).eq('id', ev.id)), v ? 'Open for sign-ups' : 'Closed')),
        h('label', { class: 'row', style: 'gap:6px' }, h('span', { class: 'muted small' }, 'Spots'), capIn),
        add, h('span', { class: 'grow' }),
        h('button', { class: 'sm', disabled: !ins.length, onclick: toPlaying }, 'Set as Playing list'),
        h('button', { class: 'danger sm', onclick: async () => await ask(`Delete ${dayTitle(ev.played_on)}?`, `Its ${list.length} sign-up${list.length === 1 ? '' : 's'} are deleted too. This can't be undone.`, 'Delete') && act(() => q(sb.from('events').delete().eq('id', ev.id)), 'Deleted') }, 'Delete')));
  };

  const date = h('input', { type: 'date', value: now, 'aria-label': 'Game day' });
  const cap = h('input', { type: 'number', min: 2, max: 200, value: 24, class: 'score-in', 'aria-label': 'Spots' });
  const note = h('input', { type: 'text', placeholder: 'Note (time, place…)', 'aria-label': 'Note' });
  const create = e => {
    e.preventDefault();
    if (!date.value) return toast('Pick a date');
    if (events.some(x => x.played_on === date.value)) return toast('That day is already open');
    act(() => q(sb.from('events').insert({ played_on: date.value, cap: Number(cap.value) || 24, note: note.value.trim() || null })), 'Sign-ups open');
  };
  return h('div', {}, head,
    !mine && !organizer && h('div', { class: 'card' }, h('p', { style: 'margin:0' }, 'Your account isn\'t linked to a player yet, so you can\'t sign up here. Ask the organizer to link it.')),
    !mine && organizer && h('p', { class: 'muted small' }, 'To sign yourself up too, have the super link your account to your player on Users.'),
    organizer && h('form', { class: 'card build-bar', onsubmit: create },
      h('label', { class: 'field' }, h('span', {}, 'Game day'), date), h('label', { class: 'field' }, h('span', {}, 'Spots'), cap),
      h('label', { class: 'field grow' }, h('span', {}, 'Note'), note), h('button', { class: 'ball' }, 'Open sign-ups')),
    upcoming.length ? upcoming.map(eventCard) : h('div', { class: 'card empty' }, organizer ? 'No game days open. Open one above.' : 'No game days open for sign-ups right now.'),
    organizer && past.length > 0 && h('details', { class: 'card' }, h('summary', {}, h('h3', { style: 'display:inline' }, 'Past game days')), past.map(eventCard)));
}

// ---------- lineup (players, raters) ----------
// Game days whose teams an organizer published (Show to players on Scores): the teams and the scores, no numbers.
export async function lineupPage() {
  const head = pageHead('Lineup', 'Teams for recent game days, once the organizers share them.');
  let days;
  try { days = await q(sb.rpc('published_lineups', { p_limit: 5 })); }
  catch (e) { if (missing(e)) return h('div', {}, head, needsUpgrade('The lineup')); throw e; }
  if (!days.length) return h('div', {}, head, h('div', { class: 'card empty' }, 'No teams shared yet. Check back on game day.'));
  return h('div', {}, head, days.map((d, i) => {
    const teams = d.teams.map(players => ({ players }));
    const tn = teamNames(d.teams);
    // Rounds (rounds.sql): earlier rounds' teams, oldest first; the day's own teams are the round playing now.
    const past = d.rounds ?? [], cur = past.length + 1;
    const pastNames = new Map(past.map(r => [r.n, teamNames(r.teams)]));
    const nameIn = (k, n) => ((n ?? 1) === cur ? tn : pastNames.get(n) ?? [])[k - 1] ?? `Team ${k}`;
    const roundsWithGames = [...new Set(d.games.map(g => g.round ?? 1))].sort((a, b) => b - a);
    const share = courtShare(teams, { title: dayTitle(d.played_on), names: tn }, `teams-${d.played_on}.png`);
    const mineAt = teams.findIndex(t => t.players.some(p => p.id === me.player_id));
    return h('section', { class: 'option' },
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, dayTitle(d.played_on), cur > 1 ? h('span', { class: 'muted' }, ` · Round ${cur}`) : ''),
        mineAt >= 0 && h('p', { class: 'muted small', style: 'margin:2px 0 0' }, `You're on ${tn[mineAt]}${cur > 1 ? ` in round ${cur}` : ''}.`)),
        h('button', { class: 'sm', onclick: () => share() }, 'Share image')),
      h('div', { class: 'team-grid' }, teams.map((t, k) => h('article', { class: `team${k === mineAt ? ' mine' : ''}`, style: `--tc: ${TEAM_COLORS[k % TEAM_COLORS.length]}` },
        h('header', {}, h('h4', {}, tn[k])),
        h('ul', {}, t.players.map(p => h('li', {}, avatar(p.name, 28), h('span', { class: 'pname' }, p.id === me.player_id ? h('b', {}, p.name) : p.name), setterBadge(p))))))),
      d.games.length > 0 && h('div', { class: 'card', style: 'margin-top:12px' }, h('h3', {}, d.ended ? 'Final scores' : d.ended === false ? 'Scores so far' : 'Scores'),
        roundsWithGames.flatMap(n => [cur > 1 && h('h4', { class: 'round-head' }, `Round ${n}`),
          h('ol', { class: 'game-list' }, d.games.filter(g => (g.round ?? 1) === n).map(g => h('li', {}, h('div', { class: 'grow' }, h('b', {}, `${nameIn(g.team_a, n)} v ${nameIn(g.team_b, n)}`)),
            h('span', { class: 'game-score' }, `${g.score_a}–${g.score_b}`))))])),
      [...past].reverse().map(r => h('details', { class: 'round-past' },
        h('summary', {}, h('b', {}, `Round ${r.n} teams`)),
        h('div', { class: 'team-grid' }, r.teams.map((ps, k) => h('article', { class: 'team', style: `--tc: ${TEAM_COLORS[k % TEAM_COLORS.length]}` },
          h('header', {}, h('h4', {}, nameIn(k + 1, r.n))),
          h('ul', {}, ps.map(p => h('li', {}, avatar(p.name, 28), h('span', { class: 'pname' }, p.id === me.player_id ? h('b', {}, p.name) : p.name), setterBadge(p))))))))),
      i < days.length - 1 && h('hr', { class: 'sep' }));
  }));
}

// ---------- player profile ----------
// Everything about one player in one place. Organizers and super: anyone; everyone else: the player their account is
// linked to. Game days and record for all of those; ratings, results against ratings and match stats for the super only.
// Your own rating, on your own profile only: everyone's ratings of you averaged by the server (my-rating), with
// each day it moved. Never who rated you or how many did.
const WORDS = [[0, 'unwilling or unable'], [.25, 'below average'], [.5, 'average'], [.75, 'excels'], [1, 'top of the group']];
const wordFor = v => WORDS.reduce((a, b) => Math.abs(b[0] - v) < Math.abs(a[0] - v) ? b : a)[1];
const shortDate = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: y === new Date().getFullYear() ? undefined : 'numeric' }); };
// Total like everywhere else (All ratings, Teams): the five main skills added up, 0 to 5. null while any is hidden.
// Weighted like the Weighted column: skills counted the way team building counts them (WEIGHTS), also 0 to 5.
const totalOf = sk => SKILLS.every(s => sk[s] != null) ? Math.round(SKILLS.reduce((a, s) => a + sk[s], 0) * 100) / 100 : null;
const weightedOf = sk => SKILLS.every(s => sk[s] != null) ? Math.round(weightedTotal(sk) * 100) / 100 : null;
const moved = (a, b) => { const d = Math.round((b - a) * 100) / 100; return d > 0 ? `up ${fmt(d)}` : d < 0 ? `down ${fmt(-d)}` : 'no change'; };
async function ownRatingCard(player) {
  const card = h('div', { class: 'card own-rating' }, h('h3', {}, 'Your rating'));
  let res;
  try { res = await callFn('my-rating', {}); }
  catch { card.append(h('p', { class: 'muted' }, 'Your rating couldn\'t load right now. Try again later.')); return card; }
  if (!res?.linked) return null;
  const { current: cur, history: hist } = res;
  const withTotal = p => ({ ...p, overall: totalOf(p.skills), weighted: weightedOf(p.skills) });
  const current = withTotal(cur), history = hist.map(withTotal);
  const skills = ['receiving', 'hitting', 'hustle', 'serve', 'blocking', 'setting_skill', 'consistency'].filter(s => forPlayer(s, player));
  card.append(h('p', { class: 'muted small' }, 'Each skill is the average of what everyone who rated you gave, from 0 to 1, Total adds up the five main skills (0 to 5), and Weighted counts them the way team building does (also 0 to 5), like everywhere else. It never shows who rated you, and each skill shows once at least two people have rated it. Tap a skill to see what each level means.'));
  if (current.overall == null && !skills.some(s => current.skills[s] != null)) {
    card.append(h('p', {}, 'Not enough ratings yet.'));
    return card;
  }
  const prev = history.length > 1 ? history[history.length - 2] : null;
  // append() prints false, so drop the parts that don't apply.
  const now = h('div', { class: 'own-now' }, ...[
    current.overall != null && h('div', { class: 'own-totals' }, [['overall', 'Total', ` of 5 · ${wordFor(current.overall / SKILLS.length)}`], ['weighted', 'Weighted', ' of 5 · as team building counts it']]
      .map(([k, label, sub]) => h('div', { class: 'own-overall' }, h('span', { class: 'stat' }, fmt(current[k])),
        h('div', {}, h('b', {}, label), h('span', { class: 'muted small' }, sub),
          prev?.[k] != null && prev[k] !== current[k] && h('p', { class: 'small muted', style: 'margin:2px 0 0' }, `${moved(prev[k], current[k])} since ${prev.date ? shortDate(prev.date) : 'before'}`))))),
    h('ul', { class: 'own-skills' }, skills.map(s => {
      const v = current.skills[s];
      // The rating guide for this skill, with the level nearest their average marked.
      const [what, ...steps] = GUIDE[s];
      const here = v == null ? -1 : Math.round(v * 4);
      return h('li', {}, h('details', {},
        h('summary', {}, h('span', {}, LABEL[s]),
          v == null ? h('span', { class: 'muted small' }, 'Not enough ratings yet')
            : [h('span', { class: 'bar', 'aria-hidden': 'true' }, h('span', { style: `width:${v * 100}%` })), h('b', {}, fmt(v))]),
        h('div', { class: 'own-guide' }, h('p', {}, what),
          h('dl', {}, steps.flatMap((text, i) => [h('dt', { class: i === here ? 'here' : null }, STEPS[i]),
            h('dd', { class: i === here ? 'here' : null }, text, i === here && h('span', { class: 'muted small' }, ' · closest to you'))])))));
    }))].filter(Boolean));
  // Wide screens: where they stand on the left, the chart beside it.
  const chart = ownChart(history, skills);
  card.append(chart ? h('div', { class: 'own-cols' }, now, h('div', { class: 'own-time' }, chart)) : now);
  // Each day it moved, newest first: overall and the skills that changed.
  const changes = history.map((p, i) => ({ p, before: history[i - 1] })).filter(x => x.before).reverse();
  if (changes.length) {
    const line = ({ p, before }) => {
      const what = skills.filter(s => p.skills[s] !== before.skills[s] && p.skills[s] != null && before.skills[s] != null)
        .map(s => `${LABEL[s]} ${moved(before.skills[s], p.skills[s])}`);
      return h('li', {}, h('b', {}, p.date ? shortDate(p.date) : ''),
        h('span', {}, p.overall != null && before.overall != null ? `Total ${fmt(p.overall)} (${moved(before.overall, p.overall)}) · weighted ${fmt(p.weighted)} (${moved(before.weighted, p.weighted)})` : p.overall != null ? `Total ${fmt(p.overall)} · weighted ${fmt(p.weighted)}` : 'Skills changed'),
        what.length > 0 && h('span', { class: 'muted small' }, what.join(' · ')));
    };
    const first = changes.slice(0, 5), rest = changes.slice(5);
    card.append(...[h('h4', {}, 'How it changed'), h('ul', { class: 'own-changes' }, first.map(line)),
      rest.length > 0 && h('details', {}, h('summary', { class: 'small' }, `${rest.length} earlier change${rest.length === 1 ? '' : 's'}`), h('ul', { class: 'own-changes' }, rest.map(line)))].filter(Boolean));
  } else card.append(h('p', { class: 'muted small' }, 'No changes yet.'));
  return card;
}

// Your rating over time: one point per day it changed, 0 to 1, like every other rating. Overall or one skill at a time. null while there
// aren't two days to compare.
function ownChart(history, skills) {
  const pts = history.filter(p => p.date);
  if (history.length < 2 || !pts.length) return null;
  // How it stood before the first recorded change sits just before that day.
  const rows = history.map(p => ({ ...p, t: p.date ? Date.parse(p.date) : Date.parse(pts[0].date) - Math.max(864e5, (Date.parse(pts.at(-1).date) - Date.parse(pts[0].date)) * .08) }));
  const keys = [['overall', 'Total'], ['weighted', 'Weighted'], ...skills.filter(s => rows.some(r => r.skills[s] != null)).map(s => [s, LABEL[s]])];
  let key = 'overall';
  const val = (r, k) => k === 'overall' || k === 'weighted' ? r[k] : r.skills[k];
  const plot = h('div', { class: 'chart-plot' });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const draw = () => {
    const W = plot.clientWidth; if (!W) return;
    const H = 200, M = { l: 30, r: 14, t: 10, b: 24 };
    const t0 = rows[0].t, t1 = Math.max(rows.at(-1).t, t0 + 864e5);
    const top = key === 'overall' || key === 'weighted' ? SKILLS.length : 1; // Total and Weighted run 0 to 5, a skill 0 to 1
    const x = t => M.l + (t - t0) / (t1 - t0) * (W - M.l - M.r), y = v => M.t + (1 - v / top) * (H - M.t - M.b);
    const shown = rows.filter(r => val(r, key) != null);
    const label = r => r.date ? new Date(r.t).toLocaleDateString([], { day: 'numeric', month: 'short' }) : 'Before';
    const grid = (top === 1 ? [0, .25, .5, .75, 1] : [0, 1, 2, 3, 4, 5]).map(v => svg('g', {}, svg('line', { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), class: 'grid' }),
      svg('text', { x: M.l - 6, y: y(v), class: 'axis', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, top === 1 ? fmt(v) : String(v))));
    const ends = shown.length ? [shown[0], shown.at(-1)] : [];
    const xAxis = ends.map((r, i) => svg('text', { x: x(r.t), y: H - 6, class: 'axis', 'text-anchor': i ? 'end' : 'start' }, label(r)));
    const d = shown.map((r, i) => `${i ? 'L' : 'M'}${x(r.t)},${y(val(r, key))}`).join('');
    const dots = shown.map(r => svg('circle', { cx: x(r.t), cy: y(val(r, key)), r: 4, class: 'dot', fill: 'var(--s1)' }));
    const el = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${keys.find(k => k[0] === key)[1]} over time: ${shown.map(r => `${label(r)} ${fmt(val(r, key))}`).join(', ')}` },
      grid, xAxis, svg('path', { d, class: 'line', stroke: 'var(--s1)' }), dots);
    // Tap or hover: the nearest day's value.
    el.onpointermove = e => {
      if (!shown.length) return;
      const px = e.clientX - el.getBoundingClientRect().left;
      const r = shown.reduce((a, b) => Math.abs(x(b.t) - px) < Math.abs(x(a.t) - px) ? b : a);
      tip.replaceChildren(h('div', { class: 'chart-tip-head' }, r.date ? label(r) : 'Before the first change'), h('div', { class: 'chart-tip-row' }, h('b', {}, fmt(val(r, key)))));
      tip.hidden = false;
      tip.style.left = `${Math.max(0, Math.min(W - tip.offsetWidth, x(r.t) > W / 2 ? x(r.t) - tip.offsetWidth - 12 : x(r.t) + 12))}px`;
    };
    el.onpointerleave = () => { tip.hidden = true; };
    plot.replaceChildren(el, tip);
  };
  const box = h('div', { class: 'own-chart' },
    h('div', { class: 'own-chart-head' }, h('h4', {}, 'Over time'),
      keys.length > 1 && h('label', { class: 'sort' }, h('span', {}, 'Show'),
        h('select', { onchange: e => { key = e.target.value; draw(); } }, keys.map(([k, t]) => h('option', { value: k }, t))))), plot);
  new ResizeObserver(draw).observe(plot);
  return box;
}

// Match stats as tiles (Ratings page numbers for one player). m: metrics(tally).
const num2 = v => v == null ? '–' : (Math.round(v * 100) / 100).toFixed(2);
const statTiles = m => h('div', { class: 'tiles' }, [[pct(m.aceRate), 'Aces', `${m.serves} serves`], [num2(m.passAvg), 'Pass average', `${m.passes} passes, 0–3`],
  [pct(m.killRate), 'Kills', `${m.attacks} attacks`], [num2(m.attackEff), 'Attack efficiency', 'kills − errors − blocked'],
  [num2(m.stuffsPerGame), 'Blocks a game'], [num2(m.digsPerGame), 'Digs a game'], [num2(m.digAvg), 'Dig average', `${m.digs} digs, 0–3`]].map(([v, l, sub]) => h('div', { class: 'card tile' }, h('span', { class: 'stat' }, v), h('b', {}, l), sub && h('span', { class: 'muted small' }, sub))));
// One game in a line: what they did, counted.
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
function gameLine(c) {
  const n = a => Object.values(c[a]).reduce((x, y) => x + y, 0);
  const avg = a => n(a) ? Object.entries(c[a]).reduce((s, [g, k]) => s + g * k, 0) / n(a) : null;
  const up = c.dig[1] + c.dig[2] + c.dig[3];
  return [
    n('serve') && `${plural(n('serve'), 'serve')}${c.serve[3] ? ` (${plural(c.serve[3], 'ace')})` : ''}${c.serve[0] ? `, ${c.serve[0]} missed` : ''}`,
    n('pass') && `${plural(n('pass'), 'pass', 'passes')}, average ${num2(avg('pass'))}`,
    n('set') && plural(n('set'), 'set'),
    n('attack') && `${plural(n('attack'), 'attack')}${c.attack[3] ? ` (${plural(c.attack[3], 'kill')})` : ''}${c.attack[0] + c.attack[1] ? `, ${plural(c.attack[0] + c.attack[1], 'error')} or blocked` : ''}`,
    c.block[3] && plural(c.block[3], 'block'),
    up && `${plural(up, 'dig')}, average ${num2(avg('dig'))}`,
  ].filter(Boolean).join(' · ') || 'No touches tagged';
}
// Your match stats, on your own profile only: what you did in tagged games (my-stats), all of them and game by game.
// Hidden until a game you played in has been tagged.
async function ownStatsCard() {
  let res;
  try { res = await callFn('my-stats', {}); }
  catch { return h('div', { class: 'card' }, h('h3', {}, 'Your match stats'), h('p', { class: 'muted' }, 'Your match stats couldn\'t load right now. Try again later.')); }
  if (!res?.linked || !res.total || !res.games?.length) return null;
  const m = metrics(tallyFromCounts([res.total]).get(res.total.player_id));
  const games = gameTallies(res.touches ?? [], res.games);
  const first = games.slice(0, 5), rest = games.slice(5);
  const row = g => h('li', {}, h('b', {}, g.played_on ? dayTitle(g.played_on) : 'Game'),
    g.mine != null && g.theirs != null && h('span', { class: 'muted small' }, ` · ${g.mine > g.theirs ? 'Won' : g.mine < g.theirs ? 'Lost' : 'Tied'} ${g.mine}–${g.theirs}`),
    h('div', { class: 'small' }, gameLine(g.tally.counts)));
  return h('div', { class: 'card' }, h('h3', {}, 'Your match stats'),
    h('p', { class: 'muted small' }, `Official stats from ${plural(m.games, 'game')} you played in, each one watched and tagged touch by touch by a person. Only you and the organizers see these.`),
    statTiles(m),
    h('h4', {}, 'Game by game'), h('ul', { class: 'own-games' }, first.map(row)),
    ...(rest.length ? [h('details', {}, h('summary', { class: 'small' }, `${plural(rest.length, 'earlier game')}`), h('ul', { class: 'own-games' }, rest.map(row)))] : []));
}

export async function profilePage(id) {
  if (!canProfile(id)) return h('div', { class: 'card empty' }, 'You can only see your own profile.');
  const [player] = await q(sb.from('players').select('*').eq('id', id));
  if (!player) return h('div', { class: 'card empty' }, 'No such player.');
  const isSuper = me.role === 'super', organizer = isSuper || me.role === 'organizer';
  const head = h('div', { class: 'page-head' }, h('div', { class: 'row' }, avatar(player.name, 56),
    h('div', {}, h('h2', {}, player.name), h('p', {}, [player.setting === 'M' ? 'Setter' : player.setting === 'B' ? 'Backup setter' : null,
      player.playing ? 'Playing this session' : null, player.anchor ? 'Anchor player' : null, !player.active ? 'Inactive' : null, id === me.player_id ? 'You' : null].filter(Boolean).join(', ') || ' '))));
  const parts = [head];
  if (id === me.player_id) parts.push(await ownRatingCard(player), await ownStatsCard());

  // Game days and games (player_games works for the player themself, organizers and super).
  let days = null;
  try { days = await q(sb.rpc('player_games', { p_player: id })); } catch (e) { if (!missing(e)) throw e; }
  if (!days) parts.push(needsUpgrade('Game days on profiles'));
  else {
    const games = days.flatMap(d => d.games);
    const r = record(games, id);
    // Organizers can read every game day, so they also get how often and runs; players see their own days.
    const [allSes, allRounds] = organizer ? await Promise.all([
      q(sb.from('sessions').select('id,played_on,teams')).catch(() => null),
      q(sb.from('rounds').select('session_id,n,teams')).catch(() => null),
    ]) : [null, null];
    const all = allSes && withEarlier(allSes, allRounds);
    const allGames = organizer && all ? await q(sb.from('games').select('session_id,players_a,players_b')).catch(() => []) : [];
    const att = all ? attendance(all, allGames, today()).get(id) : null;
    const tile = (v, label, sub) => h('div', { class: 'card tile' }, h('span', { class: 'stat' }, v), h('b', {}, label), sub && h('span', { class: 'muted small' }, sub));
    parts.push(h('div', { class: 'tiles' },
      tile(String(days.length), 'Game days', att ? `${pct(att.rate)} since their first` : days.length ? `first ${dayTitle(days[0].played_on)}` : null),
      tile(r.games ? `${r.wins}–${r.losses}` : '—', 'Record', r.games ? `${pct(r.wins / r.games)} won` : 'no games yet'),
      tile(String(r.best), 'Best win streak', 'games in a row'),
      att ? tile(String(att.streak), 'Game days in a row', att.missing ? 'Stopped coming lately' : `best ${att.best}`) : tile(days.length ? dayTitle(days.at(-1).played_on) : '—', 'Last came')));
    if (att) parts.push(h('div', { class: 'card' }, h('h3', {}, 'Attendance'), h('p', { class: 'muted small' }, 'Every game day since their first, oldest on the left.'),
      h('span', { class: 'dots big' }, att.history.slice(att.history.findIndex(d => d.came)).map(d => h('i', { class: d.came ? 'on' : null, title: `${dayTitle(d.played_on)}: ${d.came ? 'came' : 'missed'}` })))));
    const recent = [...days].reverse().slice(0, 8);
    if (recent.length) parts.push(h('div', { class: 'card' }, h('h3', {}, 'Recent game days'),
      h('ol', { class: 'game-list' }, recent.map(d => {
        const res = record(d.games, id);
        const score = g => { const a = g.players_a.includes(id); const [us, them] = a ? [g.score_a, g.score_b] : [g.score_b, g.score_a]; return `${us > them ? 'W' : 'L'} ${us}–${them}`; };
        // Rounds (rounds.sql): each round's teams, so the team they were on is named per round. Without them (older
        // SQL, or a day not published yet) it's the team number as before.
        const rounds = Array.isArray(d.rounds) ? d.rounds : null;
        const many = rounds?.length > 1;
        const teamIn = r => {
          const k = r.teams.findIndex(t => t.some(p => p.id === id));
          if (k >= 0) return teamNames(r.teams, new Set(r.all_game ?? []))[k];
          const g = d.games.find(x => (x.round ?? 1) === r.n);
          return g ? teamNames(r.teams, new Set(r.all_game ?? []))[(g.players_a.includes(id) ? g.team_a : g.team_b) - 1] ?? null : null;
        };
        const where = rounds
          ? rounds.map(r => [r, teamIn(r)]).filter(([, name]) => name).map(([r, name]) => many ? `${name} (round ${r.n})` : name).join(', ')
          : d.team ? `Team ${d.team}` : '';
        const results = many
          ? rounds.map(r => [r.n, d.games.filter(g => (g.round ?? 1) === r.n)]).filter(([, gs]) => gs.length).map(([n, gs]) => `Round ${n}: ${gs.map(score).join(' · ')}`).join(' — ')
          : d.games.map(score).join(' · ');
        return h('li', {}, h('div', { class: 'grow' }, h('b', {}, dayTitle(d.played_on)), where && h('span', { class: 'muted small' }, ` · ${where}`),
          h('div', { class: 'muted small' }, results || 'No games entered')),
          res.games > 0 && h('span', { class: 'game-score' }, `${res.wins}–${res.losses}`));
      }))));
  }

  // Sign-ups ahead.
  const ev = await q(sb.from('events').select('id,played_on,cap').gte('played_on', today()).order('played_on')).catch(() => null);
  if (ev?.length) {
    const sg = await q(sb.from('signups').select('event_id,player_id,created_at').in('event_id', ev.map(e => e.id)).order('created_at')).catch(() => []);
    const lines = ev.map(e => { const list = sg.filter(x => x.event_id === e.id); const at = list.findIndex(x => x.player_id === id);
      return at < 0 ? null : h('li', {}, h('b', {}, dayTitle(e.played_on)), ': ', at < e.cap ? 'you\'re in' : `number ${at - e.cap + 1} on the waitlist`); }).filter(Boolean);
    parts.push(h('div', { class: 'card' }, h('h3', {}, 'Signed up for'), lines.length ? h('ul', {}, lines) : h('p', { class: 'muted' }, 'Nothing coming up.', id === me.player_id ? [' ', h('a', { href: '#signup' }, 'Sign up')] : [])));
  }

  // Super only: ratings, results against ratings, match stats.
  if (isSuper) {
    const [players, ratings, profiles, games] = await Promise.all([
      q(sb.from('players').select('id,name,tier,setting').eq('active', true)),
      q(sb.from('ratings').select('*')),
      q(sb.from('profiles').select('id,display_name')),
      q(sb.from('games').select('*')).catch(() => []),
    ]);
    const rn = new Map(profiles.map(p => [p.id, p.display_name]));
    const { combined } = combineRatings(players, ratings);
    const c = combined.get(id);
    const mineR = ratings.filter(r => r.player_id === id);
    if (c) {
      const adj = resultAdjustments(games).get(id);
      const a = analyze(games), st = a.n ? playerStats(games, a.k).find(p => p.id === id) : null;
      const row = (label, vals, extra) => h('tr', {}, h('td', {}, label), RATED.map((s, i) => h('td', { class: 'num' }, forPlayer(s, player) ? fmt(vals[i]) : '–')), h('td', { class: 'num' }, extra));
      parts.push(h('div', { class: 'card' }, h('h3', {}, 'Ratings'), h('p', { class: 'muted small' }, 'Only you see this. Combined has each rater\'s lean taken out.',
        c.guess ? ` Nobody has rated them, so the ${c.guess} stand-in level is used.` : ''),
        h('div', { class: 'scroll' }, stacked(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, ''), RATED.map(s => h('th', { class: 'num' }, SHORT[s])), h('th', { class: 'num' }, 'Weighted'))),
          h('tbody', {}, row(h('b', {}, 'Combined'), RATED.map(s => c.skills[s]), h('b', {}, fmt(weightedTotal(c.skills)))),
            mineR.map(r => { const v = RATED.map(s => r[s] == null ? null : Number(r[s])); const known = SKILLS.every(s => r[s] != null);
              return row(rn.get(r.rater_id) ?? 'Removed rater', v, known ? fmt(weightedTotal(Object.fromEntries(SKILLS.map(s => [s, Number(r[s])])))) : 'U'); }))))),
        st && h('p', { class: 'small' }, h('b', {}, 'Against their ratings: '), `${plusPts(st.over)} points a game over ${st.games} games`,
          adj != null ? ` · Adjust for results adds ${signed(adj)}` : ''),
        h('p', { class: 'small' }, h('a', { href: '#ratings', onclick: () => openHistory(id) }, 'Rating history →'))));
    }
    // Your own profile already has Your match stats.
    const statRow = id === me.player_id ? [] : await q(sb.from('player_stats').select('*').eq('player_id', id)).catch(() => []);
    if (statRow.length) {
      const m = metrics(tallyFromCounts(statRow).get(id));
      parts.push(h('div', { class: 'card' }, h('h3', {}, 'Match stats'), h('p', { class: 'muted small' }, `From ${m.games} tagged game${m.games === 1 ? '' : 's'}. Only you see these.`),
        statTiles(m)));
    }
  }
  return h('div', {}, parts);
}
