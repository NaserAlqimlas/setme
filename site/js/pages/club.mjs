import { ask, avatar, canProfile, fmt, forPlayer, h, me, missing, needsUpgrade, pageHead, profileLink, q, render, sb, SHORT, stacked, TEAM_COLORS, toast, today, toggle } from '../ui.mjs';
import { combineRatings, RATED, SKILLS, teamNames, weightedTotal } from '../teams.mjs';
import { courtImage } from '../courtimg.mjs';
import { analyze, playerStats, resultAdjustments } from '../scores.mjs';
import { metrics, score, tallyFromCounts } from '../stats.mjs';
import { attendance, record } from '../club.mjs';
import { dayTitle, setterBadge, sharePng } from './teams.mjs';
import { pct, plusPts, withEarlier } from './scores.mjs';
import { openHistory, signed } from './ratings.mjs';

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
    const at = list.findIndex(x => x.player_id === mine);
    const old = ev.played_on < now;
    const chip = (x, n) => h('span', { class: `chip${x.player_id === mine ? ' me' : ''}${organizer ? '' : ' plain'}` },
      n != null && h('span', { class: 'muted small' }, `${n}. `), profileLink(x.player_id, pname.get(x.player_id) ?? 'Removed player'),
      organizer && h('button', { type: 'button', 'aria-label': `Remove ${pname.get(x.player_id)}`, onclick: () => act(() => q(sb.from('signups').delete().eq('event_id', ev.id).eq('player_id', x.player_id))) }, '×'));
    const status = at < 0 ? null : at < ev.cap ? h('span', { class: 'badge on' }, 'You\'re in') : h('span', { class: 'badge' }, `Waitlist #${at - ev.cap + 1}`);
    const meBtn = mine && !old && (at < 0
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
    let blob = null; const ready = courtImage(teams, { title: dayTitle(d.played_on), colors: TEAM_COLORS, names: tn }).then(b => (blob = b));
    const mineAt = teams.findIndex(t => t.players.some(p => p.id === me.player_id));
    return h('section', { class: 'option' },
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, dayTitle(d.played_on), cur > 1 ? h('span', { class: 'muted' }, ` · Round ${cur}`) : ''),
        mineAt >= 0 && h('p', { class: 'muted small', style: 'margin:2px 0 0' }, `You're on ${tn[mineAt]}${cur > 1 ? ` in round ${cur}` : ''}.`)),
        h('button', { class: 'sm', onclick: async () => sharePng(blob ?? await ready, `teams-${d.played_on}.png`) }, 'Share image')),
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
export async function profilePage(id) {
  if (!canProfile(id)) return h('div', { class: 'card empty' }, 'You can only see your own profile.');
  const [player] = await q(sb.from('players').select('*').eq('id', id));
  if (!player) return h('div', { class: 'card empty' }, 'No such player.');
  const isSuper = me.role === 'super', organizer = isSuper || me.role === 'organizer';
  const head = h('div', { class: 'page-head' }, h('div', { class: 'row' }, avatar(player.name, 56),
    h('div', {}, h('h2', {}, player.name), h('p', {}, [player.setting === 'M' ? 'Setter' : player.setting === 'B' ? 'Backup setter' : null,
      player.playing ? 'Playing this session' : null, player.anchor ? 'Anchor player' : null, !player.active ? 'Inactive' : null, id === me.player_id ? 'You' : null].filter(Boolean).join(', ') || ' '))));
  const parts = [head];

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
    const statRow = await q(sb.from('player_stats').select('*').eq('player_id', id)).catch(() => []);
    if (statRow.length) {
      const m = metrics(tallyFromCounts(statRow).get(id));
      const num = v => v == null ? '–' : (Math.round(v * 100) / 100).toFixed(2);
      parts.push(h('div', { class: 'card' }, h('h3', {}, 'Match stats'), h('p', { class: 'muted small' }, `From ${m.games} tagged game${m.games === 1 ? '' : 's'}. Only you see these.`),
        h('div', { class: 'tiles' }, [[pct(m.aceRate), 'Aces', `${m.serves} serves`], [num(m.passAvg), 'Pass average', `${m.passes} passes, 0–3`],
          [pct(m.killRate), 'Kills', `${m.attacks} attacks`], [num(m.attackEff), 'Attack efficiency', 'kills − errors − blocked'],
          [num(m.stuffsPerGame), 'Blocks a game'], [num(m.digsPerGame), 'Digs a game']].map(([v, l, sub]) => h('div', { class: 'card tile' }, h('span', { class: 'stat' }, v), h('b', {}, l), sub && h('span', { class: 'muted small' }, sub))))));
    }
  }
  return h('div', {}, parts);
}
