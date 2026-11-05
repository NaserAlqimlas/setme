import { avatar, callFn, downloadFile, filterChip, fmt, forPlayer, h, LABEL, me, menu, pageHead, q, RATING_OPTIONS, render, sb, seg, toast } from '../ui.mjs';
import { RATED, SKILLS, weightedTotal } from '../teams.mjs';
import { ratingsExport, ratingsTemplate, readRatingsCsv } from '../csv.mjs';

// Rate page (everyone who rates): one player at a time, with the rating guide.

// ---------- rate (everyone) ----------
// What each skill means, and what each step of the scale looks like for it.
const STEPS = ['0', '.25', '.5', '.75', '1'];
const GUIDE = {
  receiving: ['Passing serves and digging attacks up to the setter.',
    'Can\'t control the ball; passes go anywhere.',
    'Gets easy serves up, but often off target or out of play.',
    'Gets most serves up, not always to the setter.',
    'Usually passes to the setter, even off harder serves.',
    'Passes tough serves right to the setter, every time.'],
  hitting: ['Attacking the ball over the net.',
    'Doesn\'t attack; just bumps or sets it over.',
    'Swings at times, but mostly tips or pushes it over, with lots of errors.',
    'Hits with some power, but with errors and easy balls.',
    'Hits hard and with placement; usually a tough ball to dig.',
    'Hits hard and smart, finds the floor, rarely errs.'],
  hustle: ['Effort and movement: chasing balls, covering hitters, calling the ball.',
    'Stands still and lets balls drop.',
    'Moves for balls near them; rarely chases or calls.',
    'Goes for the balls within reach.',
    'Chases most balls, covers hitters, and calls the ball.',
    'Chases everything, covers, dives, and talks.'],
  serve: ['Getting serves in, and making them hard to pass.',
    'Rarely gets it over the net.',
    'Gets it in about half the time.',
    'Reliably in, but easy to pass.',
    'Almost always in, with some pace or placement that causes trouble.',
    'Tough serves that win points, with few misses.'],
  blocking: ['Going up at the net to stop or slow attacks.',
    'Doesn\'t block.',
    'Goes up now and then, but usually late or off the hitter.',
    'Gets up and sometimes gets a touch.',
    'Blocks well-timed and often gets a hand on it.',
    'Reads the hitter, times it well, stuffs balls.'],
  setting_skill: ['How well they set: getting the second ball to a hitter they can attack. Only for setters, and only counts when they set all game.',
    'Can\'t set a hittable ball yet.',
    'Gets it up, but often too low, too tight or off the net.',
    'Hittable most of the time from a decent pass.',
    'Consistent, well-placed sets, and rescues some bad passes.',
    'Runs the offence: picks the right hitter, sets anything, hides bad passes.'],
  consistency: ['How steady they are from one day to the next. It doesn\'t add to their total; the most unpredictable players are spread across teams instead.',
    'You never know which version shows up.',
    'Good days and bad days, often in the same week.',
    'Plays about the same, with the odd off day.',
    'Rarely has an off day.',
    'Same level every single time.'],
};
// The rubric as a side panel (a bottom sheet on phones) that stays put while you rate. Tapping a rating on a card
// jumps the panel to that skill. Open or closed is remembered per browser.
function ratingGuide(onToggle) {
  let open = false;
  try { open = localStorage.getItem('setme.guide') === 'open'; } catch { /* storage blocked: start closed */ }
  const items = new Map(RATED.map(s => {
    const [what, ...steps] = GUIDE[s];
    return [s, h('section', { class: 'guide-item' }, h('h4', {}, LABEL[s]), h('p', {}, what),
      h('dl', {}, steps.flatMap((text, i) => [h('dt', {}, STEPS[i]), h('dd', {}, text)])))];
  }));
  const close = h('button', { type: 'button', class: 'ghost sm', 'aria-label': 'Close rating guide' }, '×');
  const panel = h('aside', { class: 'guide-panel', 'aria-label': 'Rating guide' },
    h('div', { class: 'guide-head' }, h('h3', {}, 'Rating guide'), close),
    h('p', { class: 'muted small' }, 'Rate each player against this group, not against volleyball players in general. Use U if you haven\'t seen enough to say.'),
    [...items.values()]);
  const fab = h('button', { type: 'button', class: 'guide-fab' }, '📖 Rating guide');
  const set = v => {
    open = v;
    try { localStorage.setItem('setme.guide', v ? 'open' : 'closed'); } catch { /* not remembered, that's fine */ }
    panel.classList.toggle('open', v); panel.inert = !v; fab.hidden = v;
    onToggle(v);
  };
  close.onclick = () => set(false);
  fab.onclick = () => set(!open);
  return {
    panel, fab, init: () => set(open),
    focus(skill) {
      if (!open) return;
      for (const [s, el] of items) el.classList.toggle('on', s === skill);
      const el = items.get(skill);
      panel.scrollTo({ top: el.offsetTop - panel.querySelector('.guide-head').offsetHeight - 8, behavior: 'smooth' });
    },
  };
}

// The sticky header's height, for things that stick just under it (Rate's progress bar).
{
  const top = document.querySelector('.top');
  if (top) new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', `${top.offsetHeight}px`)).observe(top);
}
// Ratings older than this are worth another look.
const STALE_DAYS = 120;
export async function ratePage() {
  const [players, mine, queue, hasUnknown] = await Promise.all([
    q(sb.from('players').select('*').eq('active', true).order('name')), // * so it works before the anchor column exists
    q(sb.from('ratings').select('*').eq('rater_id', me.id)),
    callFn('rate-queue', {}).catch(() => null),
    // The unknown column (rating_unknown.sql) tells don't know apart from not answered yet.
    q(sb.from('ratings').select('unknown').limit(1)).then(() => true, () => false),
  ]);
  const byPlayer = new Map(mine.map(r => [r.player_id, r]));
  const asked = p => RATED.filter(s => forPlayer(s, p));
  const unknownOf = r => r?.unknown ?? [];
  const answered = p => { const r = byPlayer.get(p.id); return r ? asked(p).filter(s => r[s] != null || unknownOf(r).includes(s)).length : 0; };
  // Rated = every skill answered. Before the upgrade a blank can't be told from U, so any saved row counts.
  const done = p => hasUnknown ? answered(p) === asked(p).length : byPlayer.has(p.id);
  // What a skill row shows: the number, U if they said don't know, or nothing pressed if not answered yet.
  const shown = (r, s) => r?.[s] != null ? Number(r[s]) : (hasUnknown ? unknownOf(r).includes(s) : r != null) ? 'U' : undefined;
  let onlyPlaying = false, onlyUnrated = false, onlyLook = false, search = '';
  // Why a player is worth a (fresh) look: ids only from the server, never which way.
  const sets = { results: new Set(queue?.results), few: new Set(queue?.few), anchors: new Set(queue?.anchors ?? players.filter(p => p.anchor).map(p => p.id)) };
  const reasons = p => {
    const r = byPlayer.get(p.id), out = [];
    if (sets.anchors.has(p.id) && !done(p)) out.push('Anchor player: rate them first');
    if (sets.results.has(p.id)) out.push('Results don\'t match their ratings');
    if (sets.few.has(p.id)) out.push('Few people have rated them');
    if (r?.updated_at && Date.now() - Date.parse(r.updated_at) > STALE_DAYS * 864e5) out.push(`Your rating is over ${Math.round(STALE_DAYS / 30)} months old`);
    return out;
  };
  const lookCard = h('div', { class: 'card' });
  const paintLook = () => {
    const list = players.map(p => ({ p, why: reasons(p) })).filter(x => x.why.length);
    const anchorsLeft = players.filter(p => sets.anchors.has(p.id) && !done(p));
    lookCard.hidden = !list.length;
    lookCard.replaceChildren(
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Worth a fresh look'),
        h('p', { class: 'muted small', style: 'margin:2px 0 0' }, anchorsLeft.length
          ? `New here? Start with the ${anchorsLeft.length} anchor player${anchorsLeft.length === 1 ? '' : 's'} everyone rates; it tells SetMe how you rate compared with the others, and until then your ratings count for less.`
          : 'Players where another look helps most. Nothing here says which way; just rate what you see.'))),
      h('ul', { class: 'look-list' }, list.map(({ p, why }) => h('li', { title: why.join('\n') },
        h('button', { type: 'button', class: 'look-name', onclick: () => jumpTo(p.id), 'aria-label': `Go to ${p.name}` }, p.name),
        h('span', { class: 'muted small' }, why[0] + (why.length > 1 ? `, and ${why.length - 1} more` : ''))))));
  };
  paintLook();
  const grid = h('div', { class: 'grid' });
  const layout = h('div', { class: 'rate-layout' }, grid);
  const guide = ratingGuide(open => document.body.classList.toggle('guide-open', open));
  layout.append(guide.panel, guide.fab);
  guide.init();
  const bar = h('span'), countEl = h('span', { class: 'small' });
  // Sticky under the header: how far along, and a button to the next player still to rate among those shown.
  const nextBtn = h('button', { type: 'button', class: 'sm next-unrated' });
  const progress = () => {
    const n = players.filter(done).length;
    bar.style.width = `${players.length ? n / players.length * 100 : 0}%`;
    countEl.replaceChildren(h('b', {}, `${n} of ${players.length}`), ' rated');
    const next = shownList().find(p => !done(p));
    const left = players.length - n;
    nextBtn.hidden = !left;
    nextBtn.disabled = !next;
    nextBtn.textContent = next ? `Next: ${next.name} →` : 'Everyone shown is rated';
    nextBtn.onclick = next ? () => jumpTo(next.id) : null;
  };
  // Scroll to a player's card and put focus on their first skill still to answer (or the card itself if none).
  const jumpTo = id => {
    let el = grid.querySelector(`.player-card[data-pid="${id}"]`);
    if (!el) { search = ''; searchIn.value = ''; draw(); el = grid.querySelector(`.player-card[data-pid="${id}"]`); }
    if (!el) return toast('That player is hidden by a filter above');
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    const open = [...el.querySelectorAll('.skill-row .seg')].find(sg => !sg.querySelector('[aria-pressed=true], [aria-checked=true]'));
    (open?.querySelector('button') ?? el).focus({ preventScroll: true });
  };

  // rowEl: the skill row tapped, which shows a quiet ✓ once saved (a toast on every tap was too much; errors still toast).
  const save = async (pid, skill, picked, rowEl) => {
    const value = picked === 'U' ? null : picked, prev = byPlayer.get(pid);
    const row = { ...Object.fromEntries(RATED.map(s => [s, null])), ...prev, [skill]: value };
    // U goes on the unknown list; a number takes the skill off it.
    const unknown = hasUnknown ? { unknown: [...unknownOf(prev).filter(s => s !== skill), ...(picked === 'U' ? [skill] : [])] } : {};
    // Send Setting only when it's the skill tapped or the saved row has it, so other taps still save before the
    // setting_skill column is added in Supabase.
    const cols = RATED.filter(s => s !== 'setting_skill' || skill === s || (byPlayer.get(pid) && s in byPlayer.get(pid)));
    try {
      const saved = await q(sb.from('ratings').upsert({ rater_id: me.id, player_id: pid, ...Object.fromEntries(cols.map(s => [s, row[s]])), ...unknown }).select().single());
      byPlayer.set(pid, saved); progress(); totals.get(pid)?.(); paintLook();
      if (rowEl) { rowEl.classList.remove('just-saved'); void rowEl.offsetWidth; rowEl.classList.add('just-saved'); }
    } catch (e) { toast(`Not saved: ${e.message}`); return false; }
  };
  // Totals follow the doc's rule: U if any skill is unknown.
  const totals = new Map();
  const card = p => {
    const r = byPlayer.get(p.id);
    const totalEl = h('div', { class: 'totals' });
    const leftEl = h('span', { class: 'muted small answered' });
    const paint = () => {
      const row = byPlayer.get(p.id);
      // How far along a started card is, so a half-rated player doesn't look finished.
      const n = answered(p), of = asked(p).length;
      leftEl.textContent = hasUnknown && n > 0 && n < of ? `${n} of ${of}` : '';
      const known = row && SKILLS.every(s => row[s] != null);
      const sk = known ? Object.fromEntries(SKILLS.map(s => [s, Number(row[s])])) : null;
      totalEl.replaceChildren(
        h('span', {}, h('small', {}, 'Total'), h('b', {}, known ? fmt(SKILLS.reduce((a, s) => a + sk[s], 0)) : 'U')),
        h('span', {}, h('small', {}, 'Weighted'), h('b', {}, known ? fmt(weightedTotal(sk)) : 'U')));
    };
    totals.set(p.id, paint); paint();
    return h('div', { class: 'card player-card', 'data-pid': p.id, tabindex: -1 },
      h('header', {}, avatar(p.name), h('b', {}, p.name), sets.anchors.has(p.id) && h('span', { class: 'badge backup', title: 'Anchor player: everyone rates them, so SetMe can compare raters' }, 'Anchor'),
        reasons(p).length > 0 && !sets.anchors.has(p.id) && h('span', { class: 'badge', title: reasons(p).join(' · ') }, 'Look again'),
        p.playing && h('span', { class: 'badge on' }, 'Playing'), leftEl),
      RATED.filter(s => forPlayer(s, p)).map(s => {
        const row = h('div', { class: `skill-row${s === 'consistency' ? ' trait' : ''}`, onclick: () => guide.focus(s) },
          h('span', {}, LABEL[s], h('span', { class: 'saved-tick', 'aria-hidden': 'true' }, ' ✓')));
        row.append(seg(RATING_OPTIONS, shown(r, s), v => save(p.id, s, v, row), `${p.name} ${LABEL[s]}`));
        return row;
      }),
      totalEl);
  };
  // Still to rate = not every skill answered, same as the progress count. A card stays put after a tap until the list is redrawn.
  const shownList = () => players.filter(p => (!onlyPlaying || p.playing) && (!onlyUnrated || !done(p)) && (!onlyLook || reasons(p).length) && p.name.toLowerCase().includes(search))
    // Anchors you haven't rated come first, so a new rater starts with them.
    .sort((a, b) => (sets.anchors.has(b.id) && !done(b)) - (sets.anchors.has(a.id) && !done(a)));
  const draw = () => {
    const list = shownList();
    grid.replaceChildren(...(list.length ? list.map(card) : [h('p', { class: 'empty' }, 'No players match.')]));
    progress();
  };
  const searchIn = h('input', { type: 'search', placeholder: 'Search players', 'aria-label': 'Search players', oninput: e => { search = e.target.value.trim().toLowerCase(); draw(); } });
  progress(); draw();

  // CSV import: preview first, save on confirm. Super can import on behalf of another rater.
  const importBox = h('div');
  const fileInput = h('input', { type: 'file', accept: '.csv,text/csv', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const { rows, unmatched, blank, errors } = readRatingsCsv(await file.text(), players);
    let raterId = me.id;
    const raterPick = me.role === 'super'
      ? await q(sb.from('profiles').select('id,display_name').order('display_name')).then(ps =>
        h('div', { class: 'field' }, h('span', {}, 'Import as'), h('select', { 'aria-label': 'Import as', onchange: e => { raterId = e.target.value; } },
          ps.map(p => h('option', { value: p.id, selected: p.id === me.id }, p.id === me.id ? `${p.display_name} (me)` : p.display_name)))))
      : null;
    const apply = async () => {
      try {
        await q(sb.from('ratings').upsert(rows.map(r => ({ rater_id: raterId, player_id: r.player.id, ...r.values, ...(hasUnknown && { unknown: r.unknown }) }))));
        toast(`${rows.length} ratings imported`);
        if (raterId !== me.id) sb.from('audit_log').insert({ action: 'ratings imported', detail: { players: rows.length, for: raterId, file: file.name } }).then(() => {}, () => {});
        if (raterId === me.id) render(); else importBox.replaceChildren();
      } catch (e) { toast(`Not imported: ${e.message}`); }
    };
    const list = (title, items, cls) => items.length > 0 && [
      h('p', { class: 'small', style: 'margin:12px 0 6px' }, h('b', {}, title)),
      h('div', { class: 'chips' }, items.map(t => h('span', { class: `chip plain ${cls}` }, t)))];
    importBox.replaceChildren(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Import CSV'), h('p', { class: 'muted small', style: 'margin:2px 0 0' }, file.name)),
        h('button', { class: 'ghost sm', onclick: () => importBox.replaceChildren() }, 'Cancel')),
      errors.map(e => h('p', { class: 'warn small' }, e)),
      list(`${rows.length} players with ratings`, rows.map(r => r.player.name), ''),
      list(`${blank.length} left blank (skipped)`, blank, 'off'),
      list(`${unmatched.length} names not recognized (skipped)`, unmatched, 'off'),
      h('div', { class: 'row', style: 'margin-top:14px; align-items:end' }, raterPick,
        h('button', { class: 'ball', onclick: apply, disabled: !rows.length }, `Import ${rows.length} ratings`),
        h('span', { class: 'muted small' }, hasUnknown ? 'Replaces existing ratings for these players. U means don\'t know; empty cells stay unanswered.' : 'Replaces existing ratings for these players. Empty cells and U count as unknown.'))));
    importBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const downloadCsv = (text, name) => downloadFile(text, name, 'text/csv');
  const downloadTemplate = () => downloadCsv(ratingsTemplate(players), 'setme-ratings-template.csv');
  const exportRatings = () => downloadCsv(ratingsExport(players, byPlayer), `setme-ratings-${new Date().toISOString().slice(0, 10)}.csv`);

  return h('div', {},
    pageHead('Rate players', 'Only the site owner sees your ratings. Every tap saves.',
      menu('Spreadsheet', [['Download a blank template', downloadTemplate], ['Import ratings from a file', () => fileInput.click()], ['Export my ratings', exportRatings]]), fileInput),
    importBox,
    h('div', { class: 'card' },
      h('div', { class: 'legend' },
        h('span', {}, h('b', {}, '0'), ' unwilling or unable'), h('span', {}, h('b', {}, '.25'), ' below average'),
        h('span', {}, h('b', {}, '.5'), ' average/consistent'), h('span', {}, h('b', {}, '.75'), ' excels'),
        h('span', {}, h('b', {}, '1'), ' top of the group'), h('span', {}, h('b', {}, 'U'), " don't know")),
      h('div', { class: 'toolbar', style: 'margin-top:12px' },
        searchIn,
        h('div', { class: 'filter-chips', role: 'group', 'aria-label': 'Show only' },
          filterChip('Playing this session', v => { onlyPlaying = v; draw(); }),
          filterChip(hasUnknown ? 'Still to rate' : 'Not rated yet', v => { onlyUnrated = v; draw(); }),
          filterChip('Worth a look', v => { onlyLook = v; draw(); })))),
    h('div', { class: 'rate-sticky' },
      h('div', { class: 'rate-sticky-row' }, countEl, h('span', { class: 'grow' }), nextBtn),
      h('div', { class: 'progress' }, bar)),
    lookCard,
    layout);
}
