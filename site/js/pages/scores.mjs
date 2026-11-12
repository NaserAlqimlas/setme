import { ask, avatar, callFn, choose, firstName, fmt, h, LABEL, me, missing, pageHead, profileLink, q, render, sb, seg, stacked, TEAM_COLORS, toast, today, toggle } from '../ui.mjs';
import { SKILLS, teamNames, WEIGHTS } from '../teams.mjs';
import { ADJUST_MIN_GAMES, analyze, BLOWOUT, CLOSE, finished, MIN_FIT, nextPairing, playerStats, PRIOR_GAMES, resultAdjustments, TARGET } from '../scores.mjs';
import { ACTIONS, endsRally, flipSides, fromRows, gradeLabel, nextServer, other, recap, score, sideOf, suggestAction, tally, teamSummary } from '../stats.mjs';
import { attendance, MIN_GAMES_FOR_RECORD, record, REGULAR_GAP, seasonRecap } from '../club.mjs';
import { seasonImage } from '../seasonimg.mjs';
import { dayTitle, evenness, GAP_SCALE, num2, recapButton, setGameDate, previewPng } from './teams.mjs';
import { signed, svg } from './ratings.mjs';

// Scores page (organizers): games and rounds, match stats tagging, insights, attendance, season recap.

// ---------- scores (organizers) ----------
// Tagging closes this many days after a game day, except for the super (the database enforces it too: tag_window.sql).
export const TAG_DAYS = 3;
export const tagClosed = (playedOn, now = today()) => me.role !== 'super' && (Date.parse(now) - Date.parse(playedOn)) / 864e5 > TAG_DAYS;

let scoresTab = 'games', scoresDay = null;
// Set when a new round starts on Scores with the same teams, so the page comes back with Change players open.
let scoresEditNext = false;
// A game day's rounds, oldest first: [{ n, teams, raters, all_game, current }]. The last is the round playing now
// (the session's own teams); earlier ones come from rounds (rows: that table, null before rounds.sql).
function roundsOf(ses, rows) {
  const kept = (rows ?? []).filter(r => r.session_id === ses.id).sort((a, b) => a.n - b.n);
  return [...kept.map(r => ({ ...r, current: false })), { n: kept.length + 1, teams: ses.teams, raters: ses.raters, all_game: ses.all_game, source: ses.source, current: true }];
}
// Sessions with their earlier rounds' teams attached (earlier), so attendance counts everyone who was on a team.
export const withEarlier = (sessions, rows) => sessions.map(s => ({ ...s, earlier: roundsOf(s, rows).filter(r => !r.current).map(r => r.teams) }));
const roundOf = g => g.round ?? 1;
// (session id, team number from 1, round) -> that team's name in that round, from who is on it (late changes
// included). No round = the round playing now.
function sessionTeamNamer(sessions, players, rounds) {
  const byId = new Map(players.map(p => [p.id, p])), byS = new Map(sessions.map(s => [s.id, s]));
  return (sid, k, round) => {
    const s = byS.get(sid);
    const rs = s ? roundsOf(s, rounds) : [];
    const r = rs.find(x => x.n === round) ?? rs.at(-1);
    const names = r && Array.isArray(r.teams) ? teamNames(r.teams.map(t => (Array.isArray(t) ? t : []).map(id => byId.get(id)).filter(Boolean)), new Set(r.all_game ?? [])) : [];
    return names[k - 1] ?? `Team ${k}`;
  };
}
export async function scoresPage() {
  const [sessions, players, rounds] = await Promise.all([
    q(sb.from('sessions').select('*').order('played_on', { ascending: false })),
    q(sb.from('players').select('id,name,setting,active').order('name')),
    q(sb.from('rounds').select('*')).catch(() => null), // null before rounds.sql
  ]);
  const pname = new Map(players.map(p => [p.id, p.name]));
  const tname = sessionTeamNamer(sessions, players, rounds);
  const body = h('div');
  const tabs = seg([['games', 'Games'], ['insights', 'Insights'], ['attendance', 'Attendance'], ['season', 'Season']], scoresTab, v => { scoresTab = v; draw(); }, 'Scores view');
  const views = { games: () => gamesView(sessions, players, pname, tname, rounds), insights: () => insightsView(sessions, pname, tname, rounds),
    attendance: () => attendanceView(withEarlier(sessions, rounds), players, pname), season: () => seasonView(withEarlier(sessions, rounds), pname, tname) };
  const draw = async () => {
    body.replaceChildren(h('p', { class: 'empty' }, 'Loading…'));
    try { body.replaceChildren(...await views[scoresTab]()); }
    catch (e) { body.replaceChildren(h('p', { class: 'warn' }, e.message)); }
  };
  draw();
  return h('div', {}, pageHead('Scores', 'Enter each game\'s score. Insights show how well the teams were balanced.', tabs), body);
}

async function gamesView(sessions, players, pname, tname, roundRows) {
  if (!sessions.length) return [h('div', { class: 'card empty' }, 'No teams saved yet. On Teams, build or check a lineup and tap ', h('b', {}, 'Save'), '.')];
  if (!sessions.some(s => s.played_on === scoresDay)) scoresDay = sessions[0].played_on;
  const ses = sessions.find(s => s.played_on === scoresDay);
  let games = await q(sb.from('games').select('*').eq('session_id', ses.id).order('created_at'));
  // Finished rallies tagged per game (null = the match stats SQL hasn't been run).
  const tags = games.length ? await q(sb.from('rallies').select('game_id').in('game_id', games.map(g => g.id)).not('won_by', 'is', null))
    .then(rows => rows.reduce((m, r) => m.set(r.game_id, (m.get(r.game_id) ?? 0) + 1), new Map()), () => null) : new Map();
  const tagGame = games.find(g => g.id === taggingGame);
  if (tagGame) return [await tagView(tagGame, games.indexOf(tagGame) + 1, pname, tname, () => { taggingGame = null; render(); }, tagClosed(ses.played_on), { games, tags })];
  taggingGame = null;
  const wrap = h('div');
  const daySel = h('select', { 'aria-label': 'Game day' }, sessions.map(s => h('option', { value: s.played_on, selected: s.played_on === scoresDay }, dayTitle(s.played_on) + (s.ended ? ' (ended)' : ''))));
  daySel.onchange = () => { scoresDay = daySel.value; render(); };

  // Delete day: only on the day itself (or a day still to come). Once the date has passed, the day stays.
  const delDay = ses.played_on >= today() && h('button', { class: 'danger sm', onclick: async () => {
    const n = games.length;
    if (await choose(`Delete ${dayTitle(ses.played_on)}?`, `Its teams${n ? `, all ${n} game${n === 1 ? '' : 's'} and their tags` : ''} are deleted too. This can't be undone.`, [[true, 'Delete day', 'danger']]) !== true) return;
    try { await q(sb.from('sessions').delete().eq('id', ses.id)); toast('Deleted'); render(); } catch (e) { toast(e.message); }
  } }, 'Delete day');

  // Rounds: the last is the one playing now (ses.teams); new games go into it. One round before rounds.sql.
  const rounds = roundsOf(ses, roundRows), cur = rounds.at(-1).n, hasRounds = roundRows != null;
  const inRound = n => games.filter(g => roundOf(g) === n);
  const teamsIn = n => n === cur ? ses.teams : rounds.find(r => r.n === n)?.teams ?? [];
  const N = () => ses.teams.length;
  const teamName = (k, n = cur) => tname(ses.id, k, n);
  const teamsBox = h('div'), entry = h('div'), list = h('div', { class: 'card' });
  let editing = scoresEditNext; scoresEditNext = false;
  // Swapping while changing players: the player tapped first, as [team index, player id].
  let picked = null;
  // Setters who set all game: as saved with the teams; a main setter who arrived later does by default.
  const allGameFor = ids => { const known = new Set(ses.all_game); return [...known, ...ids.filter(id => !known.has(id) && players.find(p => p.id === id)?.setting === 'M')]; };
  // While changing players: how even the teams are now, from the same ratings the lineup was built with.
  const balance = h('p', { class: 'small verdict', 'aria-live': 'polite' });
  const paintBalance = async () => {
    const teams = ses.teams;
    if (!editing || teams.length < 2 || teams.some(t => !t.length)) return balance.replaceChildren();
    try {
      const r = await callFn('build-teams', { predict: true, teams, raters: ses.raters, allGame: allGameFor(teams.flat()) });
      if (teams !== ses.teams) return; // changed again meanwhile
      const t = r.teams.map(x => x.weighted), gap = Math.max(...t) - Math.min(...t);
      balance.replaceChildren(h('b', {}, evenness(gap)), h('span', { class: 'muted' }, ` · team totals ${num2(Math.min(...t))} to ${num2(Math.max(...t))}, a gap of ${num2(gap)}. ${GAP_SCALE}`));
    } catch { balance.replaceChildren(); }
  };
  // Cards are drawn again on each tap: focus goes back to the player tapped (after a swap, to where they went).
  const refocus = id => teamsBox.querySelector(`.pick[data-pid="${id}"]`)?.focus();
  const swap = async (i, id) => {
    if (!picked || picked[0] === i) { picked = picked?.[1] === id ? null : [i, id]; paintTeams(); return refocus(id); }
    const [j, other] = picked; picked = null;
    await saveTeams(ses.teams.map((t, k) => k === i ? t.map(x => x === id ? other : x) : k === j ? t.map(x => x === other ? id : x) : t));
    refocus(other);
  };

  // Late changes: remove someone, or add anyone (picking a player on another team moves them). Saved straight away;
  // games already entered keep who they had.
  const saveTeams = async teams => {
    const before = ses.teams; ses.teams = teams;
    try { await q(sb.from('sessions').update({ teams }).eq('id', ses.id)); toast('Saved. Next games use these players.'); }
    catch (e) { ses.teams = before; toast(e.message); }
    paintTeams(); paintEntry(); paintBalance();
  };
  const record = (k, n = cur) => {
    const mine = inRound(n).filter(g => g.team_a === k || g.team_b === k);
    const won = mine.filter(g => (g.team_a === k ? g.score_a - g.score_b : g.score_b - g.score_a) > 0).length;
    const diff = mine.reduce((a, g) => a + (g.team_a === k ? g.score_a - g.score_b : g.score_b - g.score_a), 0);
    return mine.length ? `${won}–${mine.length - won} · ${diff > 0 ? '+' : ''}${diff}` : 'No games yet';
  };
  const paintTeams = () => {
    const active = players.filter(p => p.active);
    const canRound = hasRounds && !editing && !ses.ended && inRound(cur).length > 0;
    teamsBox.replaceChildren(h('div', { class: 'card-head' },
      h('div', {}, h('h3', {}, cur > 1 ? `Round ${cur} teams` : 'Teams'), h('p', { class: 'muted small', style: 'margin:2px 0 0' },
        editing ? `Tap a player, then one on another team, to swap them. Remove someone who left, or add a late arrival. Games already saved keep who they had.` : 'Wins–losses and points for minus points against.')),
      cur > 1 && !inRound(cur).length && !editing && h('button', { class: 'ghost sm', onclick: backRound }, `Back to round ${cur - 1}`),
      canRound && h('button', { class: 'ghost sm', onclick: newRound }, `Start round ${cur + 1}`),
      h('button', { class: editing ? 'sm' : 'ghost sm', onclick: () => { editing = !editing; picked = null; paintTeams(); paintBalance(); } }, editing ? 'Done' : 'Change players')),
    editing && balance,
    picked && h('p', { class: 'small swap-hint', role: 'status' }, h('b', {}, `Picked: ${pname.get(picked[1]) ?? 'player'}.`), ' Tap someone on another team to swap, or tap them again to cancel.'),
    h('div', { class: `team-grid${picked ? ' picking' : ''}` }, ses.teams.map((ids, i) => {
      const k = i + 1;
      const add = editing && h('select', { 'aria-label': `Add a player to ${teamName(k)}` },
        h('option', { value: '' }, '+ Add player'),
        active.filter(p => !ids.includes(p.id)).map(p => {
          const on = ses.teams.findIndex(t => t.includes(p.id));
          return h('option', { value: p.id }, on >= 0 ? `${p.name} (from ${teamName(on + 1)})` : p.name);
        }));
      if (add) add.onchange = () => {
        const id = Number(add.value); if (!id) return;
        saveTeams(ses.teams.map((t, j) => j === i ? [...t, id] : t.filter(x => x !== id)));
      };
      const who = id => editing
        ? h('button', { type: 'button', class: 'pick', 'data-pid': id, 'aria-pressed': String(picked?.[1] === id), onclick: () => swap(i, id),
          'aria-label': picked && picked[0] !== i ? `Swap ${pname.get(id)} with ${pname.get(picked[1])}` : `Pick ${pname.get(id)} to swap` },
          avatar(pname.get(id) ?? '?', 28), h('span', { class: 'pname' }, pname.get(id) ?? 'Removed player'))
        : [avatar(pname.get(id) ?? '?', 28), h('span', { class: 'pname' }, pname.get(id) ?? 'Removed player')];
      return h('article', { class: `team${picked?.[0] === i ? ' from' : ''}`, style: `--tc: ${TEAM_COLORS[i % TEAM_COLORS.length]}` },
        h('header', {}, h('h4', {}, teamName(k)), h('span', { class: 'muted small' }, record(k))),
        h('ul', {}, ids.map(id => h('li', {}, who(id),
          editing && h('button', { type: 'button', class: 'ghost sm', 'aria-label': `Remove ${pname.get(id)}`,
            onclick: () => ids.length > 1 ? saveTeams(ses.teams.map((t, j) => j === i ? t.filter(x => x !== id) : t)) : toast('A team needs at least one player') }, '×')))),
        add);
    })),
    ...rounds.filter(r => !r.current).reverse().map(r => h('details', { class: 'round-past' },
      h('summary', {}, h('b', {}, `Round ${r.n}`), h('span', { class: 'muted small' }, ` · ${inRound(r.n).length} game${inRound(r.n).length === 1 ? '' : 's'}`)),
      h('div', { class: 'team-grid' }, r.teams.map((ids, i) => h('article', { class: 'team', style: `--tc: ${TEAM_COLORS[i % TEAM_COLORS.length]}` },
        h('header', {}, h('h4', {}, teamName(i + 1, r.n)), h('span', { class: 'muted small' }, record(i + 1, r.n))),
        h('ul', {}, ids.map(id => h('li', {}, avatar(pname.get(id) ?? '?', 28), h('span', { class: 'pname' }, pname.get(id) ?? 'Removed player')))))))))
    );
  };
  // Start the next round from here: keep this round with its games and standings, then either play on with the same
  // teams (Change players opens to swap a few people) or build new ones on Teams.
  const newRound = async () => {
    const pick = await choose(`Start round ${cur + 1}?`, `Round ${cur} is kept with its ${inRound(cur).length} game${inRound(cur).length === 1 ? '' : 's'} and standings. Start round ${cur + 1} with the same teams and swap players here, or build new teams on Teams.`,
      [['here', 'Same teams, swap here', 'ball'], ['teams', 'Build new teams', 'ghost']]);
    if (pick === 'teams') { setGameDate(ses.played_on); location.hash = '#teams'; return; }
    if (pick !== 'here') return;
    try {
      await q(sb.rpc('start_round', { p_session: ses.id, p_teams: ses.teams, p_raters: ses.raters ?? null, p_all_game: ses.all_game ?? [], p_source: ses.source ?? null }));
      toast(`Round ${cur + 1} started. Swap players, then tap Done.`);
      scoresEditNext = true; render();
    } catch (e) { toast(e.message); }
  };
  // Undo a new round before any game is entered in it: the previous round's teams come back.
  const backRound = async () => {
    if (await choose(`Go back to round ${cur - 1}?`, `Round ${cur}'s teams are dropped and round ${cur - 1}'s teams are playing again. No games are lost.`, [[true, `Back to round ${cur - 1}`, 'danger']]) !== true) return;
    try { await q(sb.rpc('undo_round', { p_session: ses.id })); toast(`Back to round ${cur - 1}`); render(); }
    catch (e) { toast(e.message); }
  };

  // New game: which two teams, then the score. Played to 25; a game cut short by time is saved as it stood.
  const paintEntry = () => {
    const [pa, pb] = nextPairing(N(), inRound(cur)) ?? [1, 2];
    const pick = (v, label) => h('select', { 'aria-label': label }, ses.teams.map((_, i) => h('option', { value: i + 1, selected: i + 1 === v }, teamName(i + 1))));
    const ta = pick(pa, 'First team'), tb = pick(pb, 'Second team');
    const num = label => h('input', { type: 'number', min: 0, max: 99, inputmode: 'numeric', class: 'score-in', 'aria-label': label, placeholder: '0' });
    const sa = num('First team score'), sB = num('Second team score');
    const btn = h('button', { class: 'ball' }, 'Save game');
    const note = h('p', { class: 'muted small' });
    const hint = () => {
      const a = Number(sa.value), b = Number(sB.value);
      note.textContent = sa.value === '' || sB.value === '' ? `Games go to ${TARGET}. Time up? Save the score as it stood.`
        : Math.max(a, b) < TARGET ? `Saved as stopped early (time up). It counts as if scaled to a game to ${TARGET}.` : '';
    };
    sa.oninput = sB.oninput = hint; hint();
    btn.onclick = async () => {
      const a = Number(ta.value), b = Number(tb.value);
      if (a === b) return toast('Pick two different teams');
      if (sa.value === '' || sB.value === '') return toast('Enter both scores');
      const A = Number(sa.value), B = Number(sB.value);
      if (![A, B].every(v => Number.isInteger(v) && v >= 0 && v <= 99)) return toast('Scores are whole numbers from 0 to 99');
      if (A === B) return toast('A game can\'t end in a tie');
      btn.disabled = true; btn.textContent = 'Saving…';
      const players_a = ses.teams[a - 1], players_b = ses.teams[b - 1];
      const allGame = allGameFor([...players_a, ...players_b]);
      let predicted = null;
      try {
        const r = await callFn('build-teams', { predict: true, teams: [players_a, players_b], raters: ses.raters, allGame });
        predicted = { a: r.teams[0], b: r.teams[1] };
      } catch (e) { toast(`Saved without a prediction: ${e.message}`); }
      try {
        const [g] = await q(sb.from('games').insert({ session_id: ses.id, team_a: a, team_b: b, players_a, players_b, score_a: A, score_b: B, predicted, ...(hasRounds ? { round: cur } : {}) }).select());
        games = [...games, g];
        if (predicted) toast('Game saved');
        paintTeams(); paintEntry(); paintList();
      } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = 'Save game'; }
    };
    entry.replaceChildren(h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, `Game ${games.length + 1}`),
      h('p', { class: 'muted small', style: 'margin:2px 0 0' }, N() > 2 ? 'Next up from the rotation; change it if you played someone else.' : 'Same two teams until time is up.'))),
      h('div', { class: 'score-row' }, h('div', { class: 'score-side' }, ta, sa), h('span', { class: 'muted vs' }, 'v'), h('div', { class: 'score-side right' }, sB, tb), btn),
      note);
  };

  // Saved games, newest first. Scores can be fixed in place; the players and prediction stay as saved.
  const paintList = () => {
    list.hidden = !games.length;
    if (!games.length) return list.replaceChildren();
    const lineup = (ids, k, n) => ids.join() !== (teamsIn(n)[k - 1] ?? []).join() ? ` (${ids.map(id => firstName(pname.get(id))).join(', ')})` : '';
    // Newest round first, each round's games newest first. Game numbers run through the whole day.
    list.replaceChildren(h('h3', {}, 'Games'), ...[...rounds].reverse().filter(r => inRound(r.n).length).flatMap(r => [cur > 1 && h('h4', { class: 'round-head' }, `Round ${r.n}`), h('ol', { class: 'game-list' }, [...inRound(r.n)].reverse().map(g => {
      const n = games.indexOf(g) + 1;
      const input = (key, label) => {
        const el = h('input', { type: 'number', min: 0, max: 99, inputmode: 'numeric', class: 'score-in sm', value: g[key], 'aria-label': label });
        el.onchange = async () => {
          const v = Number(el.value);
          if (!Number.isInteger(v) || v < 0 || v > 99) { el.value = g[key]; return toast('Scores are whole numbers from 0 to 99'); }
          try { await q(sb.from('games').update({ [key]: v }).eq('id', g.id)); g[key] = v; toast('Saved'); paintTeams(); }
          catch (e) { el.value = g[key]; toast(e.message); }
        };
        return el;
      };
      const changed = [lineup(g.players_a, g.team_a, roundOf(g)) && `${teamName(g.team_a, roundOf(g))}${lineup(g.players_a, g.team_a, roundOf(g))}`, lineup(g.players_b, g.team_b, roundOf(g)) && `${teamName(g.team_b, roundOf(g))}${lineup(g.players_b, g.team_b, roundOf(g))}`].filter(Boolean).join(' · ');
      return h('li', {},
        h('span', { class: 'game-no muted' }, String(n)),
        h('div', { class: 'grow' }, h('b', {}, `${teamName(g.team_a, roundOf(g))} v ${teamName(g.team_b, roundOf(g))}`),
          !finished(g) && h('span', { class: 'muted small' }, ' · time up'),
          changed && h('div', { class: 'muted small' }, changed)),
        h('span', { class: 'game-score' }, input('score_a', `Game ${n} ${teamName(g.team_a, roundOf(g))} score`), '–', input('score_b', `Game ${n} ${teamName(g.team_b, roundOf(g))} score`)),
        tagClosed(ses.played_on) ? h('button', { class: 'ghost sm', disabled: !tags?.get(g.id), title: `Tagging closes ${TAG_DAYS} days after the game day${tags?.get(g.id) ? '; the tags can still be viewed' : ''}`,
          onclick: () => { taggingGame = g.id; render(); } }, tags?.get(g.id) ? `View tags (${tags.get(g.id)})` : 'Tagging closed') :
        h('button', { class: 'ghost sm', title: 'Tag who did what from the game\'s video', onclick: () => {
          if (!tags) return toast('Match stats need the database upgrade (supabase/match_stats.sql)');
          taggingGame = g.id; render();
        } }, tags?.get(g.id) ? `Tags (${tags.get(g.id)})` : 'Tag'),
        h('button', { class: 'ghost sm', 'aria-label': `Delete game ${n}`, onclick: async () => {
          if (!await ask(`Delete game ${n}?`, `${teamName(g.team_a, roundOf(g))} v ${teamName(g.team_b, roundOf(g))}, ${g.score_a}–${g.score_b}${tags?.get(g.id) ? `, and its ${tags.get(g.id)} tagged rallies` : ''}. This can't be undone.`, 'Delete game')) return;
          try { await q(sb.from('games').delete().eq('id', g.id)); games = games.filter(x => x !== g); paintTeams(); paintEntry(); paintList(); }
          catch (e) { toast(e.message); }
        } }, 'Delete'));
    }))]).filter(Boolean));
  };
  // Once the day is ended the entry box gives way to the final standings: most wins, then point difference.
  const standings = (n = cur) => teamsIn(n).map((_, i) => {
    const k = i + 1, mine = inRound(n).filter(g => g.team_a === k || g.team_b === k);
    const diff = mine.reduce((a, g) => a + (g.team_a === k ? g.score_a - g.score_b : g.score_b - g.score_a), 0);
    const won = mine.filter(g => (g.team_a === k ? g.score_a > g.score_b : g.score_b > g.score_a)).length;
    return { k, won, lost: mine.length - won, diff };
  }).sort((a, b) => b.won - a.won || b.diff - a.diff);
  const setEnded = async v => {
    try { await q(sb.from('sessions').update({ ended: v }).eq('id', ses.id)); ses.ended = v; toast(v ? 'Game day ended' : 'Game day reopened'); render(); }
    catch (e) { toast(e.message); }
  };
  const paintEnded = () => entry.replaceChildren(
    h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Game day over'),
      h('p', { class: 'muted small', style: 'margin:2px 0 0' }, games.length
        ? `${games.length} game${games.length === 1 ? '' : 's'} played. You can still fix a score below.`
        : 'No games were entered.')),
      h('button', { class: 'ghost sm', onclick: () => setEnded(false) }, 'Reopen')),
    ...[...rounds].reverse().filter(r => inRound(r.n).length).flatMap(r => [cur > 1 && h('h4', { class: 'round-head' }, `Round ${r.n}`),
      h('ol', { class: 'standings' }, standings(r.n).map(t => h('li', { style: `--tc: ${TEAM_COLORS[(t.k - 1) % TEAM_COLORS.length]}` },
        h('b', {}, teamName(t.k, r.n)), h('span', {}, `${t.won} won, ${t.lost} lost`), h('span', { class: 'muted' }, `${t.diff > 0 ? '+' : ''}${t.diff} points`))))]));
  paintTeams(); ses.ended ? paintEnded() : paintEntry(); paintList(); paintBalance();
  // Day recap: every game's result, plus standouts and team numbers from whatever has been tagged.
  const dayRecap = recapButton('Day recap', 'Game day recap', dayTitle(ses.played_on), `recap-${ses.played_on}.png`, pname, (k, n) => teamName(k, n),
    () => rounds.filter(r => inRound(r.n).length).map(r => ({ round: r.n, teams: teamsIn(r.n).map((ids, i) => ({ k: i + 1, ids })) })));
  if (games.length) {
    const stored = tags ? await q(sb.from('rallies').select('id,game_id,seq,video_t,serving,won_by,touches(seq,player_id,action,grade,video_t)').in('game_id', games.map(g => g.id))).catch(() => []) : [];
    dayRecap.refresh(games.map(g => ({ game: g, rallies: fromRows(stored.filter(r => r.game_id === g.id)) })));
  }
  // Players see a game day's teams and scores on Lineup only once an organizer turns this on (club upgrade).
  const publish = 'published' in ses && h('span', { title: 'Show these teams and scores to everyone on the Lineup page' }, toggle('Show to players', ses.published, async v => {
    try { await q(sb.from('sessions').update({ published: v }).eq('id', ses.id)); ses.published = v; toast(v ? 'Players can see these teams' : 'Hidden from players'); }
    catch (e) { toast(e.message); return false; }
  }));
  const endDay = 'ended' in ses && !ses.ended && h('button', { class: 'ghost sm', onclick: async () => {
    if (await ask(`End ${dayTitle(ses.played_on)}?`, 'The score entry closes and players see the scores as final. You can reopen it.', 'End the day', 'ball')) setEnded(true);
  } }, 'End the day');
  wrap.append(
    h('div', { class: 'card build-bar' }, h('label', { class: 'field' }, h('span', {}, 'Game day'), daySel), publish, h('span', { class: 'grow' }), endDay, games.length ? dayRecap.btn : null, delDay),
    h('div', { class: 'card' }, entry),
    h('div', { class: 'card' }, teamsBox),
    list);
  return [wrap];
}

// ---------- match stats: tagging a game ----------
// Watch the game's video and tap player → action → grade for each touch. Grades that end a rally (ace, kill, error…)
// award the point on their own; "Point" buttons cover the rest. The video stays on this device (a file) or on
// YouTube; tags keep the video time so tapping one jumps back to it. Works without a video too (tagging live).
// Saved a moment after each change: only rallies that changed since the last save, plus deleted ones, through
// save_game_tags (one transaction). Rally ids are made here, so a resent save can't double up, and two people
// tagging the same game don't wipe each other's rallies. A copy stays on this device until the save goes through.
let taggingGame = null;
const clock = t => t == null ? '' : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const ytId = s => (String(s).match(/(?:youtu\.be\/|[?&]v=|embed\/|shorts\/|live\/)([\w-]{11})/) ?? String(s).trim().match(/^([\w-]{11})$/))?.[1] ?? null;
let ytReady = null;
const loadYouTube = () => ytReady ??= new Promise((res, rej) => {
  window.onYouTubeIframeAPIReady = () => res(window.YT);
  const s = h('script', { src: 'https://www.youtube.com/iframe_api' });
  s.onerror = () => { ytReady = null; rej(new Error('Could not load YouTube')); };
  document.head.append(s);
});
// One interface for a local file or a YouTube embed. Both are put in `box` before use.
function fileVideo(box, file) {
  const v = h('video', { controls: true, playsinline: true, preload: 'auto' });
  v.src = URL.createObjectURL(file);
  box.replaceChildren(v);
  return { now: () => v.currentTime, seek: t => { v.currentTime = Math.max(0, t); }, toggle: () => v.paused ? v.play() : v.pause(), dispose: () => URL.revokeObjectURL(v.src) };
}
async function youtubeVideo(box, id) {
  const YT = await loadYouTube();
  const host = h('div');
  box.replaceChildren(h('div', { class: 'yt' }, host));
  const p = await new Promise((res, rej) => {
    const pl = new YT.Player(host, { videoId: id, playerVars: { playsinline: 1, rel: 0 }, events: { onReady: () => res(pl), onError: () => rej(new Error('YouTube could not play that video')) } });
  });
  return { now: () => p.getCurrentTime(), seek: t => p.seekTo(Math.max(0, t), true), toggle: () => p.getPlayerState() === 1 ? p.pauseVideo() : p.playVideo(), dispose: () => p.destroy() };
}

// ro (read only): tagging has closed for this game day; the tags, video and recap can be looked at, not changed.
// day: the day's games and how many tagged rallies each has, for moving tags put on the wrong game.
async function tagView(g, n, pname, tname, back, ro = false, day = { games: [g], tags: new Map() }) {
  const stored = fromRows(await q(sb.from('rallies').select('id,seq,video_t,serving,won_by,touches(seq,player_id,action,grade,video_t)').eq('game_id', g.id)));
  // What the database has: each rally as last saved (to send only what changed), and the video.
  const saved = new Map(stored.map(r => [r.id, JSON.stringify(r)]));
  // Rallies played on after the game really ended count for player stats, not for the score. end = seq of the last rally that counts.
  const hasEnd = 'tags_end' in g;
  let end = g.tags_end ?? null;
  const videoOf = () => ({ ...(video ? { video_kind: video.kind, video_ref: video.kind === 'file' ? video.name : video.id } : { video_kind: null, video_ref: null }), ...(hasEnd ? { tags_end: end } : {}) });
  let video = g.video_kind === 'file' ? { kind: 'file', name: g.video_ref } : g.video_kind === 'youtube' ? { kind: 'youtube', id: g.video_ref } : null;
  let savedVideo = JSON.stringify(videoOf());
  const draftKey = `setme-tags-${g.id}`;
  let draft = null;
  if (!ro) try { draft = JSON.parse(localStorage.getItem(draftKey)); } catch { /* no draft */ }
  // Changes on this device that never reached the database: apply them on top of what's saved. Rallies someone
  // else added since stay; only rallies this device knew about and deleted are deleted.
  let rallies = stored;
  if (draft?.rallies) {
    const mine = new Map(draft.rallies.map(r => [r.id, r]));
    const gone = new Set((draft.known ?? []).filter(id => !mine.has(id)));
    rallies = [...draft.rallies, ...stored.filter(r => !mine.has(r.id) && !gone.has(r.id))].sort((a, b) => a.seq - b.seq);
    video = draft.video ?? video;
    if (hasEnd && 'end' in draft) end = draft.end;
    setTimeout(() => toast('Restored tags that hadn\'t saved yet'), 300);
  }

  const name = { a: tname(g.session_id, g.team_a, roundOf(g)), b: tname(g.session_id, g.team_b, roundOf(g)) };
  const color = { a: TEAM_COLORS[(g.team_a - 1) % TEAM_COLORS.length], b: TEAM_COLORS[(g.team_b - 1) % TEAM_COLORS.length] };
  const lineup = { a: g.players_a, b: g.players_b };
  const pn = id => firstName(pname.get(id) ?? '?');
  const side = p => sideOf(g, p);
  let player = null, sel = null, firstServe = 'a', history = [], saveTimer = null, saving = null, dirty = !!draft?.rallies;
  const now = () => player ? Math.round(player.now() * 10) / 10 : null;
  const open = () => { const r = rallies.at(-1); return r && !r.won ? r : null; };
  const serving = () => open()?.serve ?? (rallies.length ? rallies.at(-1).won : firstServe);

  // ----- saving -----
  const status = h('span', { class: 'muted small tag-status' }, ro ? `Read only: tagging closes ${TAG_DAYS} days after the game day` : stored.length ? 'Saved' : '');
  const save = async () => {
    clearTimeout(saveTimer); saveTimer = null;
    await saving;
    if (!dirty) return;
    dirty = false; status.textContent = 'Saving…';
    const ids = new Set(rallies.map(r => r.id));
    const changedRallies = rallies.filter(r => saved.get(r.id) !== JSON.stringify(r));
    const deleted = [...saved.keys()].filter(id => !ids.has(id));
    const sent = new Map(changedRallies.map(r => [r.id, JSON.stringify(r)])), vid = JSON.stringify(videoOf());
    saving = (async () => {
      if (changedRallies.length || deleted.length) await q(sb.rpc('save_game_tags', { p_game: g.id, p_rallies: changedRallies, p_deleted: deleted }));
      if (vid !== savedVideo) { await q(sb.from('games').update(videoOf()).eq('id', g.id)); savedVideo = vid; }
    })().then(() => {
      for (const id of deleted) saved.delete(id);
      for (const [id, j] of sent) saved.set(id, j);
      if (!dirty) { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } }
      status.textContent = dirty ? 'Unsaved' : 'Saved';
    }, e => {
      dirty = true; status.textContent = `Not saved (${e.message}). Kept on this device, retrying…`;
      saveTimer = setTimeout(save, 10e3);
    }).finally(() => { saving = null; });
    await saving;
  };
  const changed = () => {
    if (ro) return paint();
    dirty = true; status.textContent = 'Unsaved';
    try { localStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), rallies, video, end, known: [...saved.keys()] })); } catch { /* storage full or blocked */ }
    clearTimeout(saveTimer); saveTimer = setTimeout(save, 1500);
    paint();
  };
  const snapshot = () => { history.push(JSON.stringify(rallies)); if (history.length > 100) history.shift(); };
  const undo = () => { if (!history.length) return toast('Nothing to undo'); rallies = JSON.parse(history.pop()); sel = null; changed(); };

  // ----- tagging -----
  const newRally = () => ({ id: crypto.randomUUID(), seq: Math.max(0, ...rallies.map(r => r.seq)) + 1, t: now(), serve: serving(), won: null, touches: [] });
  const addTouch = (p, a, grade) => {
    snapshot();
    let r = open();
    if (!r) { r = newRally(); rallies.push(r); }
    r.touches.push({ p, a, g: grade, t: now() });
    const end = endsRally(a, grade);
    if (end) r.won = end === 'won' ? side(p) : other(side(p));
    sel = null; changed();
    if (end) toast(`Point ${name[r.won]}`);
  };
  const point = s => {
    snapshot();
    const r = open() ?? (rallies.push(newRally()), rallies.at(-1));
    r.won = s; sel = null; changed();
  };
  // Picking a player suggests the likely action (serve first, then pass, set, attack…).
  const pick = p => { sel = sel?.p === p ? null : { p, a: suggestAction(open() ?? { serve: serving(), touches: [] }, side(p), g) }; paintPad(); };
  // At the start of a rally the expected server is ready to grade.
  const autoSel = () => {
    if (sel || open()?.touches.length) return;
    const p = nextServer(rallies, serving(), lineup[serving()]);
    if (p != null) sel = { p, a: 'serve', auto: true };
  };

  // ----- layout -----
  const scoreEl = h('div', { class: 'tag-score' });
  const summary = h('div', { class: 'tag-summary muted small' });
  const videoBox = h('div', { class: 'tag-video' });
  const sourceRow = h('div', { class: 'row tag-source' });
  const pad = h('div', { class: 'tag-pad' });
  const list = h('ol', { class: 'rally-list' });

  const counted = () => end == null ? rallies : rallies.filter(r => r.seq <= end);
  // Where the tags first reach the saved score, if more rallies were tagged after it: the likely end of the game.
  const endsAt = () => {
    const s = { a: 0, b: 0 };
    for (const [i, r] of rallies.entries()) {
      if (r.won) s[r.won]++;
      if (s.a === g.score_a && s.b === g.score_b) return i < rallies.length - 1 ? i : null;
    }
    return null;
  };
  const setEnd = v => { end = v; changed(); };
  const paintScore = () => {
    const s = score(counted());
    scoreEl.replaceChildren(
      h('span', { style: `--tc:${color.a}` }, name.a, h('b', {}, String(s.a))), h('span', { class: 'muted' }, '–'),
      h('span', { style: `--tc:${color.b}` }, h('b', {}, String(s.b)), name.b));
    const ts = teamSummary(rallies, g), done = rallies.filter(r => r.won).length;
    const line = k => `${name[k]}: side-out ${ts[k].sideOutRate == null ? '—' : `${Math.round(ts[k].sideOutRate * 100)}%`}, ${ts[k].aces} aces, ${ts[k].kills} kills, ${ts[k].stuffs} blocks, ${ts[k].errors} errors`;
    // Only once the tags cover as many points as the saved score.
    const off = done >= g.score_a + g.score_b && (s.a !== g.score_a || s.b !== g.score_b);
    const after = end == null ? 0 : rallies.filter(r => r.seq > end).length;
    const at = off && end == null && hasEnd && !ro ? endsAt() : null;
    summary.replaceChildren(...(done ? [h('div', {}, line('a')), h('div', {}, line('b'))] : []),
      ...(off ? [h('div', { class: 'warn' }, `Tags give ${s.a}–${s.b}; the saved score is ${g.score_a}–${g.score_b}.`,
        at != null ? [` The tags reach ${g.score_a}–${g.score_b} after rally ${at + 1}. `,
          h('button', { class: 'ghost sm', onclick: () => setEnd(rallies[at].seq) }, `Game ended after rally ${at + 1}`)]
        : end == null ? ' If points were miscounted during the game, keep the saved score; the tags still count for player stats.' : '')] : []),
      ...(end != null ? [h('div', {}, `Game ended after rally ${rallies.filter(r => r.seq <= end).length}. `,
        after ? `${after} ${after === 1 ? 'rally' : 'rallies'} played on after it still count for player stats, not the score. ` : '',
        !ro && h('button', { class: 'ghost sm', onclick: () => setEnd(null) }, 'Not the end'))] : []));
  };

  const paintSource = () => {
    const file = h('input', { type: 'file', accept: 'video/*', hidden: true });
    file.onchange = () => {
      const f = file.files[0]; if (!f) return;
      player?.dispose(); player = fileVideo(videoBox, f);
      if (video?.kind !== 'file' || video.name !== f.name) { video = { kind: 'file', name: f.name }; changed(); }
      paintSource();
    };
    const yt = h('input', { type: 'url', placeholder: 'YouTube link', 'aria-label': 'YouTube link', value: video?.kind === 'youtube' ? `https://youtu.be/${video.id}` : '' });
    const loadYt = async () => {
      const id = ytId(yt.value); if (!id) return toast('That doesn\'t look like a YouTube link');
      try { player?.dispose(); player = null; player = await youtubeVideo(videoBox, id); } catch (e) { return toast(e.message); }
      if (video?.kind !== 'youtube' || video.id !== id) { video = { kind: 'youtube', id }; changed(); }
    };
    yt.onkeydown = e => { if (e.key === 'Enter') loadYt(); };
    sourceRow.replaceChildren(
      h('button', { class: 'ghost sm', onclick: () => file.click() }, video?.kind === 'file' ? `Open ${video.name}` : 'Open video file'), file,
      h('span', { class: 'muted small' }, 'or'), yt, h('button', { class: 'ghost sm', onclick: loadYt }, 'Load'));
    if (!player && !videoBox.children.length) videoBox.replaceChildren(h('p', { class: 'muted small' },
      video?.kind === 'file' ? `Open ${video.name} again to see the video. It never leaves this device.` : 'Open the game\'s video, or tag live without one. Files stay on this device.'));
    return loadYt;
  };

  const paintPad = () => {
    autoSel();
    const r = open(), sv = serving();
    const col = s => h('div', { class: 'tag-team', style: `--tc:${color[s]}` },
      h('div', { class: 'tag-team-head' }, h('b', {}, name[s]), sv === s && h('span', { class: 'badge set' }, 'Serving')),
      h('div', { class: 'tag-players' }, lineup[s].map(p => h('button', { type: 'button', class: 'tag-player', 'aria-pressed': String(sel?.p === p), onclick: () => pick(p) },
        avatar(pname.get(p) ?? '?', 26), h('span', {}, pn(p))))),
      h('button', { type: 'button', class: 'ghost sm tag-point', onclick: () => point(s) }, `Point ${name[s]}`));
    const choose = sel && h('div', { class: 'tag-choose' },
      h('div', { class: 'muted small' }, h('b', {}, pname.get(sel.p)), sel.auto ? ' is up to serve' : '', ' · pick what they did'),
      seg(Object.entries(ACTIONS).map(([a, d]) => [a, d.label]), sel.a, a => { sel = { ...sel, a, auto: false }; paintPad(); }, 'Action'),
      h('div', { class: 'tag-grades' }, ACTIONS[sel.a].grades.map(([gr, label, end]) => h('button', { type: 'button', class: `tag-grade${end ? ` ${end}` : ''}`, onclick: () => addTouch(sel.p, sel.a, gr) },
        h('small', {}, String(gr)), label))));
    pad.replaceChildren(
      h('div', { class: 'row tag-rally-head' },
        h('b', {}, `Rally ${rallies.filter(x => x.won).length + 1}`),
        h('span', { class: 'muted small' }, r ? r.touches.map(t => `${pn(t.p)} ${ACTIONS[t.a].label.toLowerCase()}`).join(' → ') : `${name[sv]} to serve`),
        h('span', { class: 'grow' }),
        !rallies.length && h('span', { class: 'row' }, h('span', { class: 'muted small' }, 'First serve'), seg([['a', name.a], ['b', name.b]], firstServe, v => { firstServe = v; sel = null; paintPad(); }, 'First serve')),
        h('button', { class: 'ghost sm', onclick: undo, disabled: !history.length }, 'Undo')),
      h('div', { class: 'tag-teams' }, col('a'), col('b')),
      ...(choose ? [choose] : []));
  };

  const paintList = () => {
    const shown = [...rallies.entries()].reverse();
    const markable = hasEnd && !ro && end == null && rallies.filter(r => r.won).length > g.score_a + g.score_b;
    const divider = h('li', { class: 'end-mark muted small' }, 'Game ended here · rallies above were played on after it');
    list.replaceChildren(...shown.flatMap(([i, r]) => [...(end != null && r.seq === end && i < rallies.length - 1 ? [divider] : []), h('li', { class: end != null && r.seq > end ? 'after-end' : null },
      h('div', { class: 'rally-head' },
        h('span', { class: 'muted small' }, `#${i + 1}`),
        r.t != null && h('button', { class: 'ghost sm', onclick: () => player?.seek(r.t - 2), disabled: !player, title: 'Watch this rally' }, `▶ ${clock(r.t)}`),
        h('span', { class: 'muted small' }, `${name[r.serve]} served`),
        h('span', { class: 'grow' }),
        ro ? h('span', { class: `chip plain point ${r.won ?? 'open'}`, style: r.won ? `--tc:${color[r.won]}` : null }, r.won ? `Point ${name[r.won]}` : 'In play') :
        h('button', { class: `chip plain point ${r.won ?? 'open'}`, style: r.won ? `--tc:${color[r.won]}` : null, title: 'Change who won the point',
          onclick: () => { snapshot(); r.won = r.won === 'a' ? 'b' : r.won === 'b' ? (i === rallies.length - 1 ? null : 'a') : 'a'; changed(); } },
          r.won ? `Point ${name[r.won]}` : 'In play'),
        markable && r.won && h('button', { class: 'ghost sm', title: 'The game ended with this rally; later ones were played on after it', onclick: () => setEnd(r.seq) }, 'Ended here'),
        !ro && h('button', { class: 'ghost sm', 'aria-label': `Delete rally ${i + 1}`, onclick: async () => {
          if (!await ask(`Delete rally ${i + 1}?`, `Are you sure you want to delete this rally${r.touches.length ? ` and its ${r.touches.length} touch${r.touches.length === 1 ? '' : 'es'}` : ''}?`, 'Delete rally')) return;
          snapshot(); rallies.splice(i, 1); changed();
        } }, '×')),
      h('div', { class: 'chips' }, r.touches.map((t, j) => h('span', { class: `chip tag-touch ${endsRally(t.a, t.g) ?? ''}`, style: `--tc:${color[side(t.p)] ?? 'var(--muted)'}` },
        h('button', { type: 'button', class: 'touch-btn', onclick: () => t.t != null && player?.seek(t.t - 1) }, `${pn(t.p)} · ${ACTIONS[t.a].label} ${gradeLabel(t.a, t.g)}`),
        !ro && h('button', { type: 'button', 'aria-label': 'Delete this touch', onclick: () => { snapshot(); r.touches.splice(j, 1); changed(); } }, '×')))))]));
    if (!rallies.length) list.replaceChildren(h('li', { class: 'muted' }, 'No rallies tagged yet.'));
  };
  const gameRecap = recapButton('Share recap', `Game ${n} recap`, `${name.a} v ${name.b}`, `recap-game-${g.id}.png`, pname, k => tname(g.session_id, k, roundOf(g)),
    () => [{ round: roundOf(g), teams: [{ k: g.team_a, ids: g.players_a }, { k: g.team_b, ids: g.players_b }] }]);
  const paint = () => { paintScore(); if (!ro) paintPad(); paintList(); gameRecap.refresh([{ game: g, rallies }]); };

  const loadYt = paintSource();
  paint();
  if (video?.kind === 'youtube') loadYt();

  // Keys: space play/pause, ←/→ 2 s (shift 5 s), 0–3 grade, s/p/t/a/b/d action, Esc clear, u undo.
  const keys = e => {
    if (!wrap.isConnected) return document.removeEventListener('keydown', keys);
    if (e.target.closest('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); player?.toggle(); }
    else if (k === 'arrowleft' || k === 'arrowright') { e.preventDefault(); player?.seek(player.now() + (k === 'arrowright' ? 1 : -1) * (e.shiftKey ? 5 : 2)); }
    else if (ro) return;
    else if (k === 'escape') { sel = null; paintPad(); }
    else if (k === 'u') undo();
    else if (sel && /^[0-3]$/.test(k) && ACTIONS[sel.a].grades.some(x => x[0] === Number(k))) addTouch(sel.p, sel.a, Number(k));
    else if (sel) { const a = Object.keys(ACTIONS).find(x => ACTIONS[x].key === k); if (a) { sel = { ...sel, a, auto: false }; paintPad(); } }
  };
  document.addEventListener('keydown', keys);
  const leave = async () => { await save(); player?.dispose(); document.removeEventListener('keydown', keys); back(); };

  // Tagged the wrong game: move these tags (and the video) to the right one. If it has tags too, the two swap.
  const others = day.games.filter(x => x.id !== g.id);
  const moveTags = async () => {
    const gameLabel = x => `Game ${day.games.indexOf(x) + 1} · ${tname(x.session_id, x.team_a, roundOf(x))} v ${tname(x.session_id, x.team_b, roundOf(x))} (${x.score_a}–${x.score_b})`;
    const to = await choose('Move these tags to another game', `They're on Game ${n} (${g.score_a}–${g.score_b}). Pick the game they belong to. If it has tags too, the two games swap tags.`,
      others.map(x => [x, gameLabel(x) + (day.tags?.get(x.id) ? ' · has tags, swap' : '')]));
    if (!to) return;
    await save();
    if (dirty) return toast('Save the tags first, then move them');
    try {
      const theirs = fromRows(await q(sb.from('rallies').select('id,seq,video_t,serving,won_by,touches(seq,player_id,action,grade,video_t)').eq('game_id', to.id)));
      const lineupOf = x => new Set([...x.players_a, ...x.players_b]);
      const away = (rs, x) => [...new Set(rs.flatMap(r => r.touches.map(t => t.p)))].filter(p => !lineupOf(x).has(p)).map(pn);
      const notThere = [...away(rallies, to), ...away(theirs, g)];
      const swap = theirs.length > 0;
      if (!await ask(swap ? `Swap tags between Game ${n} and Game ${day.games.indexOf(to) + 1}?` : `Move these tags to Game ${day.games.indexOf(to) + 1}?`,
        `${rallies.length} rall${rallies.length === 1 ? 'y' : 'ies'} ${swap ? `and the other game's ${theirs.length} swap places` : `move, and Game ${n} is left untagged`}. The video goes with them.`
        + (notThere.length ? ` Not in the other lineup: ${notThere.join(', ')}. Their touches move anyway; check this is the right game.` : ''),
        swap ? 'Swap tags' : 'Move tags', 'ball')) return;
      await q(sb.rpc('move_game_tags', { p_from: g.id, p_to: to.id, p_flip_from: flipSides(rallies, g, to), p_flip_to: flipSides(theirs, to, g) }));
      for (const id of [g.id, to.id]) try { localStorage.removeItem(`setme-tags-${id}`); } catch { /* nothing kept */ }
      toast(swap ? 'Tags swapped' : `Tags moved to Game ${day.games.indexOf(to) + 1}`);
      player?.dispose(); document.removeEventListener('keydown', keys); back();
    } catch (e) { toast(missing(e) || /move_game_tags/.test(e.message) ? 'Moving tags needs supabase/move_tags.sql run in Supabase first' : e.message); }
  };

  const wrap = h('div', { class: 'tagger' },
    h('div', { class: 'card tag-top' },
      h('button', { class: 'ghost sm', onclick: leave }, '← Games'),
      h('div', { class: 'grow' }, h('h3', {}, `Game ${n} · ${name.a} v ${name.b}`), status),
      scoreEl, gameRecap.btn,
      !ro && others.length > 0 && h('button', { class: 'ghost sm', title: 'These tags belong to another game: move them there', onclick: moveTags }, 'Wrong game?')),
    // Wide screens: the video stays on the left while the panels scroll on the right.
    h('div', { class: 'tag-cols' },
      h('div', { class: 'tag-left' },
        h('div', { class: 'card' }, videoBox, sourceRow,
          h('p', { class: 'muted small' }, ro ? 'Keys: space play/pause · ← → skip 2 s · tap a rally or touch to watch it'
            : 'Keys: space play/pause · ← → skip 2 s · 0–3 grade · S P T A B D action · U undo · Esc clear'))),
      h('div', { class: 'tag-right' },
        !ro && h('div', { class: 'card' }, pad),
        h('div', { class: 'card' }, h('h3', {}, 'Rallies'), summary, list))));
  return wrap;
}

export const pct = v => v == null ? '—' : `${Math.round(v * 100)}%`;
export const pts = v => v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1);
export const plusPts = v => v == null ? '—' : `${v > 0 ? '+' : ''}${pts(v)}`;

async function insightsView(sessions, pname, tname, roundRows) {
  const games = await q(sb.from('games').select('*').order('created_at'));
  const day = new Map(sessions.map(s => [s.id, s.played_on]));
  const a = analyze(games);
  if (!a.n) return [h('div', { class: 'card empty' }, 'No games with scores yet. Enter a few on the Games tab and come back.')];
  const tile = (value, label, sub) => h('div', { class: 'card tile' }, h('span', { class: 'stat' }, value), h('b', {}, label), sub && h('span', { class: 'muted small' }, sub));
  const early = a.n < 15 && h('p', { class: 'warn small' }, `Only ${a.n} game${a.n === 1 ? '' : 's'} so far. Treat these numbers as a first look; they settle after a few game days.`);

  const tiles = h('div', { class: 'tiles' },
    tile(String(a.n), 'Games', `${a.sessions} game day${a.sessions === 1 ? '' : 's'}`),
    tile(pct(a.close), 'Close games', `won by ${CLOSE} or less`),
    tile(pct(a.blowouts), 'Blowouts', `won by ${BLOWOUT} or more`),
    tile(pts(a.avgMargin), 'Average margin', 'points, per game to 25'),
    tile(pct(a.favWon), 'Stronger team won', a.called ? `of ${a.called} games with a gap` : 'no games with a gap'));

  // Predicted gap vs actual margin, one dot per game.
  const chartBox = h('div');
  const chartCard = h('div', { class: 'card' },
    h('h3', {}, 'Predicted gap vs actual margin'),
    h('p', { class: 'muted small', style: 'margin:2px 0 0' }, 'Each dot is a game, from the first team\'s side: right = they were rated stronger, up = they won by more. ',
      'Dots near the middle line up with balanced teams. If the dots follow the dashed line, bigger rating gaps really do mean bigger wins',
      a.k > 0 ? ` (about ${pts(a.k)} points per 1.0 of gap).` : '.', ' Hollow dots stopped early (time up).'),
    chartBox);
  scatterChart(chartBox, a.rows.map(r => ({ x: r.gap, y: r.m, early: !finished(r.g),
    label: [`${dayTitle(day.get(r.g.session_id) ?? '')}`, `${tname(r.g.session_id, r.g.team_a, roundOf(r.g))} v ${tname(r.g.session_id, r.g.team_b, roundOf(r.g))}: ${r.g.score_a}–${r.g.score_b}`, `Rated gap ${plusPts(r.gap)}`] })), a.k);

  // Per game day.
  // A day with several rounds gets a row per round (each round has its own teams, built its own way).
  const bySes = sessions.flatMap(s => {
    const rows = a.rows.filter(r => r.g.session_id === s.id), rs = roundsOf(s, roundRows);
    if (rs.length < 2) return [{ s, rows, source: s.source }];
    return rs.map(r => ({ s, round: r.n, rows: rows.filter(x => roundOf(x.g) === r.n), source: r.source }));
  }).filter(x => x.rows.length);
  const days = h('div', { class: 'card' }, h('h3', {}, 'By game day'), stacked(h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Day'), h('th', { class: 'num' }, 'Games'), h('th', { class: 'num' }, 'Average margin'), h('th', { class: 'num' }, 'Close'), h('th', { class: 'num' }, 'Rated gap'))),
    h('tbody', {}, bySes.map(({ s, rows, round, source }) => {
      const m = rows.map(r => Math.abs(r.m));
      return h('tr', {}, h('td', {}, dayTitle(s.played_on), round && h('span', {}, ` · round ${round}`), source && h('span', { class: 'muted small' }, ` · ${{ built: 'built', edited: 'built, then swapped', own: 'own teams' }[source] ?? source}`)),
        h('td', { class: 'num' }, String(rows.length)),
        h('td', { class: 'num' }, pts(m.reduce((x, y) => x + y, 0) / m.length)),
        h('td', { class: 'num' }, pct(m.filter(v => v <= CLOSE).length / m.length)),
        h('td', { class: 'num' }, pts(rows.reduce((x, r) => x + Math.abs(r.gap), 0) / rows.length)));
    })))));

  // Which differences between teams go with winning.
  const word = r => r == null ? 'not enough games' : Math.abs(r) < .15 ? 'little or no link' : `${Math.abs(r) < .35 ? 'some' : 'strong'} link`;
  const factors = h('div', { class: 'card' }, h('h3', {}, 'What goes with winning'),
    h('p', { class: 'muted small', style: 'margin:2px 0 0' }, 'How each difference between the two teams lines up with the margin, from −1 to 1. ',
      'Positive: the team with more of it tended to win by more. Spread: how far apart teams typically were on it. A factor that hardly differs between teams (because the builder evens it out) can\'t show much.'),
    stacked(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Difference in'), h('th', { class: 'num' }, 'Link'), h('th', {}, ''), h('th', { class: 'num' }, 'Spread'))),
      h('tbody', {}, [...a.factors].sort((x, y) => Math.abs(y.r ?? 0) - Math.abs(x.r ?? 0)).map(f => h('tr', {},
        h('td', {}, f.label), h('td', { class: 'num' }, f.r == null ? '—' : fmt(f.r)), h('td', { class: 'muted' }, word(f.r)), h('td', { class: 'num' }, fmt(f.spread))))))));

  // Suggested weights, once there are enough games.
  const weights = h('div', { class: 'card' }, h('h3', {}, 'Strength weights'),
    a.weights
      ? [h('p', { class: 'muted small', style: 'margin:2px 0 0' }, `Weights that best explain the margins of these ${a.n} games, starting from the current ones as if they'd been seen in ${PRIOR_GAMES} games, so they move slowly. Same total as now. A big move that holds up over more game days is worth trying in teams.mjs.`),
        stacked(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Skill'), h('th', { class: 'num' }, 'Now'), h('th', { class: 'num' }, 'From results'), h('th', { class: 'num' }, 'Change'))),
          h('tbody', {}, SKILLS.map(s => h('tr', {}, h('td', {}, LABEL[s]), h('td', { class: 'num' }, fmt(WEIGHTS[s])), h('td', { class: 'num' }, h('b', {}, fmt(a.weights[s]))),
            h('td', { class: 'num muted' }, `${a.weights[s] >= WEIGHTS[s] ? '+' : ''}${fmt(a.weights[s] - WEIGHTS[s])}`))))))]
      : h('p', { class: 'muted small' }, `Suggested weights show up after ${MIN_FIT} games (${a.n} so far). Until then there's too little to tell the skills apart.`));

  const parts = [early, tiles, chartCard, factors, weights, days].filter(Boolean);

  // Super: players whose teams did better or worse than their ratings said. Based on results only, but it points at
  // players who may be rated too low or too high, so organizers don't get it.
  if (me.role === 'super') {
    const ps = playerStats(games, a.k).filter(p => pname.has(p.id)).sort((x, y) => y.over - x.over);
    const adj = resultAdjustments(games);
    parts.push(h('div', { class: 'card' }, h('h3', {}, 'Players vs their ratings'),
      h('p', { class: 'muted small', style: 'margin:2px 0 0' }, 'Only you see this. ', h('b', {}, 'Vs ratings'), ' is how many points per game their teams did better (+) or worse (−) than the rating gap predicted. ',
        'High and steady: maybe rated too low. Low: maybe too high. Under 10 games it\'s mostly luck. ',
        h('b', {}, 'Adjust'), ` is what Adjust for results on Teams adds to their strength (same scale as a team total; pulled toward 0 for few games${adj.size ? '' : `; starts after ${ADJUST_MIN_GAMES} games`}).`),
      stacked(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Player'), h('th', { class: 'num' }, 'Games'), h('th', { class: 'num' }, 'Won'), h('th', { class: 'num' }, 'Margin'), h('th', { class: 'num' }, 'Vs ratings'), h('th', { class: 'num' }, 'Adjust'))),
        h('tbody', {}, ps.map(p => h('tr', { class: p.games < 10 ? 'dim' : null },
          h('td', {}, profileLink(p.id, pname.get(p.id))), h('td', { class: 'num' }, String(p.games)), h('td', { class: 'num' }, pct(p.wins / p.games)),
          h('td', { class: 'num' }, plusPts(p.margin)), h('td', { class: 'num' }, h('b', {}, plusPts(p.over))),
          h('td', { class: 'num' }, adj.has(p.id) ? signed(adj.get(p.id)) : '—'))))))));
  }
  return parts;
}

// ---------- attendance (organizers) ----------
// Who comes, how often, and regulars who've stopped coming, from saved game days.
async function attendanceView(sessions, players, pname) {
  if (!sessions.length) return [h('div', { class: 'card empty' }, 'No game days saved yet. Attendance comes from the teams saved for scores.')];
  const games = await q(sb.from('games').select('session_id,players_a,players_b'));
  const att = attendance(sessions, games, today());
  const active = new Set(players.filter(p => p.active).map(p => p.id));
  const rows = [...att.values()].filter(a => pname.has(a.id));
  const gone = rows.filter(a => a.missing && active.has(a.id)).sort((a, b) => b.total - a.total);
  let sortKey = 'total';
  const body = h('tbody');
  const draw = () => {
    const by = { total: (a, b) => b.total - a.total, rate: (a, b) => b.rate - a.rate || b.total - a.total, last: (a, b) => b.last.localeCompare(a.last), streak: (a, b) => b.streak - a.streak || b.best - a.best, name: (a, b) => pname.get(a.id).localeCompare(pname.get(b.id)) };
    body.replaceChildren(...[...rows].sort((a, b) => by[sortKey](a, b) || pname.get(a.id).localeCompare(pname.get(b.id))).map(a => h('tr', {},
      h('td', {}, profileLink(a.id, pname.get(a.id)), a.missing && active.has(a.id) && ' ', a.missing && active.has(a.id) && h('span', { class: 'badge' }, 'Stopped coming')),
      h('td', { class: 'num' }, h('b', {}, String(a.total))),
      h('td', { class: 'num', title: `${a.total} of the ${a.of} game days since their first` }, pct(a.rate)),
      h('td', { class: 'num' }, `${a.streak}${a.best > a.streak ? ` (best ${a.best})` : ''}`),
      h('td', {}, dayTitle(a.last)),
      h('td', {}, h('span', { class: 'dots', 'aria-label': 'Last 10 game days' }, a.history.slice(-10).map(d => h('i', { class: d.came ? 'on' : null, title: `${dayTitle(d.played_on)}: ${d.came ? 'came' : 'missed'}` })))))));
  };
  draw();
  return [
    h('div', { class: 'tiles' },
      h('div', { class: 'card tile' }, h('span', { class: 'stat' }, String(sessions.length)), h('b', {}, 'Game days')),
      h('div', { class: 'card tile' }, h('span', { class: 'stat' }, String(rows.length)), h('b', {}, 'Players'), h('span', { class: 'muted small' }, 'came at least once')),
      h('div', { class: 'card tile' }, h('span', { class: 'stat' }, String(rows.filter(a => a.rate >= .5 && a.of >= 3 && !a.missing).length)), h('b', {}, 'Regulars'), h('span', { class: 'muted small' }, 'half the game days or more'))),
    gone.length > 0 && h('div', { class: 'card' }, h('h3', {}, 'Stopped coming'),
      h('p', { class: 'muted small' }, `Came to at least half the game days before, but none of the last ${REGULAR_GAP}. Maybe worth a message.`),
      h('div', { class: 'chips' }, gone.map(a => h('span', { class: 'chip plain' }, profileLink(a.id, pname.get(a.id)), h('span', { class: 'muted small' }, ` · last ${dayTitle(a.last)}`))))),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, 'Attendance'),
        h('label', { class: 'sort' }, h('span', {}, 'Sort by'), h('select', { 'aria-label': 'Sort by', onchange: e => { sortKey = e.target.value; draw(); } },
          [['total', 'Game days'], ['rate', 'How often'], ['streak', 'In a row'], ['last', 'Last came'], ['name', 'Name']].map(([v, t]) => h('option', { value: v }, t))))),
      h('p', { class: 'muted small' }, 'From the teams saved for scores (and anyone who played a game that day). ', h('b', {}, 'How often'), ' counts game days since their first. ', h('b', {}, 'In a row'), ' is their current run.'),
      h('div', { class: 'scroll' }, stacked(h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Player'), h('th', { class: 'num' }, 'Game days'), h('th', { class: 'num' }, 'How often'), h('th', { class: 'num' }, 'In a row'), h('th', {}, 'Last came'), h('th', {}, 'Last 10'))),
        body)))),
  ].filter(Boolean);
}

// ---------- season recap (organizers) ----------
// Awards for a month, a few months or the year, from results (and tagged games), shared as an image.
let seasonPick = 'month';
async function seasonView(sessions, pname, tname) {
  if (!sessions.length) return [h('div', { class: 'card empty' }, 'No game days saved yet.')];
  const ym = d => d.slice(0, 7);
  const now = today();
  const monthName = m => new Date(`${m}-15`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const months = [...new Set(sessions.map(s => ym(s.played_on)))].sort().reverse();
  const back = n => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toLocaleDateString('en-CA'); };
  const periods = [
    ...months.map(m => [`m:${m}`, monthName(m), s => ym(s.played_on) === m]),
    ['3m', 'Last 3 months', s => s.played_on >= back(3)],
    ['year', `${now.slice(0, 4)} so far`, s => s.played_on.startsWith(now.slice(0, 4))],
    ['all', 'Everything', () => true],
  ];
  if (seasonPick === 'month' || !periods.some(p => p[0] === seasonPick)) seasonPick = periods[0][0];
  const allGames = await q(sb.from('games').select('*').order('created_at'));
  const out = h('div');
  const draw = async () => {
    const [, label, keep] = periods.find(p => p[0] === seasonPick);
    const ses = sessions.filter(keep);
    const ids = new Set(ses.map(s => s.id));
    const games = allGames.filter(g => ids.has(g.session_id));
    // Tagged games in the period, for kills, aces, blocks and digs (none before the match stats upgrade).
    const rallies = games.length ? await q(sb.from('rallies').select('game_id,id,seq,video_t,serving,won_by,touches(seq,player_id,action,grade,video_t)').in('game_id', games.map(g => g.id))).catch(() => []) : [];
    const docs = games.map(g => ({ game: g, rallies: fromRows(rallies.filter(r => r.game_id === g.id)) })).filter(d => d.rallies.some(r => r.won));
    const rec = seasonRecap(ses, games, docs.length ? tally(docs) : null);
    if (rec.closest) rec.closest.names = [tname(rec.closest.session_id, rec.closest.team_a, rec.closest.round), tname(rec.closest.session_id, rec.closest.team_b, rec.closest.round)];
    const names = who => who.map(id => pname.get(id) ?? 'Someone');
    let blob = null;
    const ready = seasonImage(rec, { title: label, name: id => pname.get(id) ?? 'Someone' }).then(b => (blob = b));
    const file = `season-${seasonPick.replace(/[^\w-]/g, '')}.png`;
    out.replaceChildren(
      h('div', { class: 'tiles' },
        h('div', { class: 'card tile' }, h('span', { class: 'stat' }, String(rec.days)), h('b', {}, 'Game days')),
        h('div', { class: 'card tile' }, h('span', { class: 'stat' }, String(rec.games)), h('b', {}, 'Games')),
        h('div', { class: 'card tile' }, h('span', { class: 'stat' }, String(rec.players)), h('b', {}, 'Players'))),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, label), h('p', { class: 'muted small', style: 'margin:2px 0 0' },
          `From results${docs.length ? ` and ${docs.length} tagged game${docs.length === 1 ? '' : 's'}` : ''}; nothing here comes from ratings, so it's fine to share. Best record needs ${MIN_GAMES_FOR_RECORD}+ games.`)),
          h('button', { class: 'sm', disabled: !rec.games, onclick: async () => previewPng(blob ?? await ready, file) }, 'Share image')),
        rec.awards.length || rec.closest ? h('ul', { class: 'awards' },
          rec.awards.map(a => h('li', {}, h('b', {}, a.title), h('span', {}, names(a.who).join(', ')), h('span', { class: 'muted small' }, a.detail))),
          rec.closest && h('li', {}, h('b', {}, 'Closest game'), h('span', {}, `${rec.closest.names.join(' v ')}, ${rec.closest.score_a}–${rec.closest.score_b}`), h('span', { class: 'muted small' }, dayTitle(rec.closest.played_on))))
          : h('p', { class: 'muted' }, 'No games with scores in this stretch yet.')));
  };
  const sel = h('select', { 'aria-label': 'Period', onchange: e => { seasonPick = e.target.value; draw().catch(err => out.replaceChildren(h('p', { class: 'warn' }, err.message))); } },
    periods.map(([v, t]) => h('option', { value: v, selected: v === seasonPick }, t)));
  await draw();
  return [h('div', { class: 'card build-bar' }, h('label', { class: 'field' }, h('span', {}, 'Recap for'), sel)), out];
}

// Dots: x = rated gap, y = margin (both from the first team's side). Dashed line: margin = k × gap.
function scatterChart(box, dots, k) {
  const plot = h('div', { class: 'chart-plot' });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  plot.append(tip);
  box.replaceChildren(h('div', { class: 'chart-legend' }, h('span', {}, h('i', { class: 'dot-key' }), 'Game to 25'), h('span', {}, h('i', { class: 'dot-key hollow' }), 'Stopped early'), k > 0 && h('span', {}, h('i', { class: 'dash-key' }), 'Trend')), plot);
  const H = 260, M = { l: 34, r: 12, t: 10, b: 30 };
  const xMax = Math.max(.5, ...dots.map(d => Math.abs(d.x))) * 1.1;
  const yMax = Math.max(TARGET * .6, ...dots.map(d => Math.abs(d.y))) * 1.05;
  let W = 0;
  const render = () => {
    W = plot.clientWidth; if (!W) return;
    const xOf = x => M.l + (x + xMax) / (2 * xMax) * (W - M.l - M.r);
    const yOf = y => M.t + (1 - (y + yMax) / (2 * yMax)) * (H - M.t - M.b);
    const yTicks = [-20, -10, 0, 10, 20].filter(v => Math.abs(v) <= yMax);
    const step = xMax > 2 ? 1 : .5;
    const xTicks = []; for (let v = -Math.floor(xMax / step) * step; v <= xMax; v += step) xTicks.push(Math.round(v * 100) / 100);
    const grid = [
      ...yTicks.map(v => svg('g', {}, svg('line', { x1: M.l, x2: W - M.r, y1: yOf(v), y2: yOf(v), class: v ? 'grid' : 'cross' }),
        svg('text', { x: M.l - 6, y: yOf(v), class: 'axis', 'text-anchor': 'end', 'dominant-baseline': 'middle' }, v > 0 ? `+${v}` : String(v)))),
      svg('line', { x1: xOf(0), x2: xOf(0), y1: M.t, y2: H - M.b, class: 'cross' }),
      ...xTicks.map(v => svg('text', { x: xOf(v), y: H - 12, class: 'axis', 'text-anchor': 'middle' }, v > 0 ? `+${fmt(v)}` : fmt(v))),
      svg('text', { x: W - M.r, y: H - 1, class: 'axis', 'text-anchor': 'end' }, 'Rated gap →'),
    ];
    const lo = Math.max(-xMax, -yMax / (k || 1)), hi = -lo;
    const trend = k > 0 && svg('line', { x1: xOf(lo), x2: xOf(hi), y1: yOf(k * lo), y2: yOf(k * hi), class: 'trend' });
    const marks = dots.map(d => {
      const g = svg('g', { class: 'pt', tabindex: 0, role: 'img', 'aria-label': d.label.join(', ') },
        svg('circle', { cx: xOf(d.x), cy: yOf(d.y), r: 12, fill: 'transparent' }),
        svg('circle', { cx: xOf(d.x), cy: yOf(d.y), r: 5, class: d.early ? 'dot hollow' : 'dot', fill: d.early ? 'var(--surface)' : 'var(--s1)', stroke: 'var(--s1)' }));
      const show = () => {
        tip.replaceChildren(h('div', { class: 'chart-tip-head' }, d.label[0]), ...d.label.slice(1).map(t => h('div', { class: 'chart-tip-row' }, t)));
        tip.hidden = false;
        const x = xOf(d.x), tw = tip.offsetWidth;
        tip.style.left = `${Math.max(0, Math.min(W - tw, x > W / 2 ? x - tw - 14 : x + 14))}px`;
        tip.style.top = `${Math.max(0, Math.min(H - tip.offsetHeight, yOf(d.y) - 20))}px`;
      };
      const hide = () => { tip.hidden = true; };
      g.onpointerenter = show; g.onfocus = show; g.onpointerleave = hide; g.onblur = hide;
      return g;
    });
    const el = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': `Rated gap against margin, ${dots.length} games` }, grid, trend, marks);
    plot.querySelector('svg')?.remove();
    plot.prepend(el);
  };
  const ro = new ResizeObserver(() => { if (!plot.isConnected) { if (W) ro.disconnect(); return; } if (plot.clientWidth !== W) render(); });
  ro.observe(plot);
  requestAnimationFrame(render);
}
