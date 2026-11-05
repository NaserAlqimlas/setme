import { ask, avatar, filterChip, h, me, pageHead, q, render, sb, seg, TIER_OPTIONS, toast, toggle } from '../ui.mjs';
import { closestPlayers, compact, matchPasted } from '../paste.mjs';

// Players page (organizers): who's playing, setter roles, aliases, guests.

// ---------- players (organizers) ----------
// Who was playing before the last paste or clear, so Undo can put the list back. Lasts while the page is open.
let playingUndo = null;
// Playing only: kept while the app is open, so it stays on after a paste or Undo redraws the page.
let onlyPlaying = false;
export async function playersPage() {
  const [players, savedAliases] = await Promise.all([
    q(sb.from('players').select('*').order('name')),
    q(sb.from('player_aliases').select('alias,player_id')).catch(() => null), // null before aliases.sql
  ]);
  // Names matched by hand: remembered ones (aliases.sql), plus this visit's when they can't be remembered.
  const aliases = [...(savedAliases ?? [])];
  const update = async (p, patch) => {
    try { Object.assign(p, await q(sb.from('players').update(patch).eq('id', p.id).select().single())); toast('Saved'); count(); }
    catch (e) { toast(`Not saved: ${e.message}`); return false; }
  };
  const countEl = h('span', { class: 'stat' });
  const count = () => countEl.replaceChildren(String(players.filter(p => p.playing && p.active).length), h('small', {}, 'playing'));
  count();
  let search = '';
  const grid = h('div', { class: 'grid roster-list' });

  // One compact row per player: name, setter badge, Playing. Edit opens the rest (name, gender, setter role, anchor,
  // profile, delete), one player at a time.
  let editingId = null;
  const card = p => {
    const open = editingId === p.id;
    const el = h('div', { class: `card roster-row${open ? ' open' : ''}` });
    const setter = p.setting === 'M' ? h('span', { class: 'badge set' }, 'Setter') : p.setting === 'B' ? h('span', { class: 'badge backup' }, 'Backup') : null;
    const toggleEdit = () => { editingId = open ? null : p.id; draw(); if (!open) grid.querySelector('.roster-row.open input[aria-label="Name"]')?.focus(); };
    const head = h('div', { class: 'roster-head' },
      avatar(p.name),
      h('span', { class: 'roster-name' }, h('b', {}, p.name), setter, p.gender === 'U' && h('span', { class: 'muted small' }, ' · gender not set')),
      toggle('Playing', p.playing, v => update(p, { playing: v })),
      h('button', { type: 'button', class: 'ghost sm', 'aria-expanded': String(open), 'aria-label': `${open ? 'Close' : 'Edit'} ${p.name}`, onclick: toggleEdit }, open ? 'Done' : 'Edit'));
    if (!open) { el.append(head); return el; }
    // The name saves on change; a blank name is refused and put back.
    const nameIn = h('input', { type: 'text', value: p.name, 'aria-label': 'Name', maxlength: 60 });
    nameIn.onchange = async () => {
      const v = nameIn.value.trim();
      if (!v) { nameIn.value = p.name; return toast('A name can\'t be blank'); }
      if (v === p.name) return;
      if (await update(p, { name: v }) === false) nameIn.value = p.name; else draw();
    };
    el.append(head,
      h('div', { class: 'roster-edit' },
        h('label', { class: 'field' }, h('span', {}, 'Name'), nameIn),
        h('div', { class: 'fields' },
          h('div', { class: 'field' }, h('span', {}, 'Gender'), seg([['M', 'M'], ['F', 'F'], ['U', 'U', 'u']], p.gender, v => update(p, { gender: v }), `${p.name} gender`)),
          h('div', { class: 'field' }, h('span', {}, 'Setter'), seg([['M', 'Main'], ['B', 'Backup'], ['N', 'No']], p.setting, async v => { await update(p, { setting: v }); draw(); }, `${p.name} setter role`))),
        h('div', { class: 'row' },
          // Anchor players: every rater rates them first (only once the club upgrade adds the column).
          me.role === 'super' && 'anchor' in p && toggle('Anchor', p.anchor, v => update(p, { anchor: v })),
          h('span', { class: 'grow' }),
          h('a', { href: `#player/${p.id}`, class: 'name-link small' }, 'Profile'),
          me.role === 'super' && h('button', { class: 'danger sm', onclick: () => removePlayer(p) }, 'Delete'))));
    return el;
  };
  const removePlayer = async p => {
    if (!await ask(`Delete ${p.name}?`, 'Their ratings are deleted too. This can\'t be undone.', 'Delete player')) return;
    try {
      await q(sb.from('players').delete().eq('id', p.id));
      players.splice(players.indexOf(p), 1); draw(); count(); toast(`${p.name} deleted`);
    } catch (e) { toast(e.message); }
  };
  const draw = () => {
    // Unticking someone while Playing only is on leaves them listed until the next search or filter change,
    // so a mis-tap can be ticked again.
    const list = players.filter(p => p.name.toLowerCase().includes(search) && (!onlyPlaying || (p.playing && p.active)));
    const none = onlyPlaying && !search ? 'Nobody is ticked as playing. Paste the group\'s list above, or turn off Playing only to tick players.' : 'No players match.';
    grid.replaceChildren(...(list.length ? list.map(card) : [h('p', { class: 'empty' }, none)]));
  };
  draw();
  const playingChip = filterChip('Playing only', v => { onlyPlaying = v; draw(); });
  playingChip.setAttribute('aria-pressed', String(onlyPlaying));

  const name = h('input', { type: 'text', placeholder: 'New player name', 'aria-label': 'New player name' });
  let newTier = 'beginner';
  const tierPick = seg(TIER_OPTIONS, newTier, v => { newTier = v; }, 'New player level');
  const add = async e => {
    e.preventDefault();
    if (!name.value.trim()) return;
    try { await q(sb.from('players').insert({ name: name.value.trim(), tier: newTier })); toast('Added'); render(); }
    catch (err) { toast(err.message); }
  };
  // Paste the WhatsApp list; matches show live, and nothing changes until "Set playing list".
  const box = h('textarea', { rows: 5, placeholder: 'Paste the list from the WhatsApp group…', 'aria-label': 'Pasted list' });
  const pasteResult = h('div');
  const checkPaste = () => {
    const { matched, waitlist, unmatched, skipped, guests } = matchPasted(box.value, players, aliases);
    if (!matched.length && !waitlist.length && !unmatched.length) return pasteResult.replaceChildren();
    // The paste replaces the whole list, so say who comes off it (and who's new) before anything changes.
    const now = new Set(players.filter(p => p.playing).map(p => p.id)), next = new Set(matched.map(m => m.player.id));
    const adding = matched.filter(m => !now.has(m.player.id)), removing = players.filter(p => now.has(p.id) && !next.has(p.id));
    const apply = async () => {
      const before = [...now];
      try {
        await q(sb.from('players').update({ playing: false }).eq('playing', true));
        if (matched.length) await q(sb.from('players').update({ playing: true, active: true }).in('id', matched.map(m => m.player.id)));
        playingUndo = { ids: before, what: `Playing list set to ${matched.length}${removing.length ? `, ${removing.length} taken off` : ''}.` };
        toast(`${matched.length} players set as playing`); render();
      } catch (err) { toast(err.message); }
    };
    const section = (title, note, list, cls) => list.length > 0 && [
      h('p', { class: 'small', style: 'margin:12px 0 6px' }, h('b', {}, title), note && h('span', { class: 'muted' }, note)),
      h('div', { class: 'chips' }, list.map(([name, line]) => h('span', { class: `chip plain ${cls}`, title: line }, name)))];
    // Wrapped in a div: h() skips false and flattens lists, replaceChildren doesn't.
    pasteResult.replaceChildren(h('div', {},
      h('p', { class: 'small', style: 'margin:12px 0 6px' }, h('b', {}, `${matched.length} matched`)),
      h('div', { class: 'chips' }, matched.map(m => h('span', { class: 'chip plain', title: m.line }, m.player.name))),
      section(`${removing.length} taken off`, ' (playing now, not in the paste)', removing.map(p => [p.name]), ''),
      section(`${adding.length} new to the list`, null, adding.map(m => [m.player.name, m.line]), ''),
      matched.length > 0 && !removing.length && !adding.length && h('p', { class: 'small muted', style: 'margin:12px 0 0' }, 'Same as the current playing list.'),
      waitlist.length > 0 && h('p', { class: 'small muted', style: 'margin:12px 0 6px' }, h('b', {}, `${waitlist.length} on the waitlist`), ' (not ticked)'),
      waitlist.length > 0 && h('div', { class: 'chips' }, waitlist.map(m => h('span', { class: 'chip plain off', title: m.line }, m.player.name))),
      guests.length > 0 && h('p', { class: 'small muted', style: 'margin:12px 0 6px' }, h('b', {}, `+ ${guests.reduce((a, x) => a + x.n, 0)} guest${guests.reduce((a, x) => a + x.n, 0) === 1 ? '' : 's'}`),
        ` (${guests.map(x => x.host ? `${x.host.name} +${x.n}` : `+${x.n}`).join(', ')}). Guests aren't on the list; add them as players if they should be on a team.`),
      unmatched.length > 0 && h('p', { class: 'small', style: 'margin:12px 0 6px' },
        h('b', {}, `${unmatched.length} not recognized`), h('span', { class: 'muted' }, ' · pick who each one is, or leave them out')),
      unmatched.length > 0 && h('div', { class: 'unknown-list' }, unmatched.map(matchRow)),
      skipped.length > 0 && h('p', { class: 'small muted', style: 'margin:12px 0 0', title: skipped.join('\n') },
        `Skipped ${skipped.length} line${skipped.length === 1 ? '' : 's'} that ${skipped.length === 1 ? 'isn\'t a name' : 'aren\'t names'}: ${skipped.map(x => `"${x}"`).join(', ')}.`),
      h('div', { class: 'row', style: 'margin-top:14px' },
        h('button', { class: 'ball', onclick: apply, disabled: !matched.length }, `Set playing list (${matched.length})`),
        h('span', { class: 'muted small' }, removing.length ? `Takes ${removing.length} off. You can undo it.` : 'Replaces the current playing list.'))));
  };
  box.addEventListener('input', checkPaste);
  // An unrecognized name: pick who it is (closest names first). Remembered for the next paste, for everyone, once
  // aliases.sql has run. The super can also add them as a new player.
  const matchRow = line => {
    const active = players.filter(p => p.active);
    const near = closestPlayers(line, active, 5);
    const sel = h('select', { 'aria-label': `Who is ${line}?` },
      h('option', { value: '' }, 'Match to…'),
      h('optgroup', { label: 'Closest' }, near.map(p => h('option', { value: p.id }, p.name))),
      h('optgroup', { label: 'Everyone' }, active.filter(p => !near.includes(p)).map(p => h('option', { value: p.id }, p.name))),
      me.role === 'super' && h('optgroup', { label: 'New' }, h('option', { value: 'new' }, `Add "${line}" as a new player`)));
    sel.onchange = async () => {
      if (!sel.value) return;
      sel.disabled = true;
      try {
        if (sel.value === 'new') {
          const row = await q(sb.from('players').insert({ name: line, tier: 'beginner' }).select().single());
          players.push(row); players.sort((a, b) => a.name.localeCompare(b.name)); draw(); count();
          toast(`Added ${row.name}`);
        } else {
          const p = players.find(x => x.id === Number(sel.value)), alias = compact(line);
          const i = aliases.findIndex(a => a.alias === alias); if (i >= 0) aliases.splice(i, 1);
          aliases.push({ alias, player_id: p.id });
          if (savedAliases) {
            await q(sb.from('player_aliases').upsert({ alias, player_id: p.id }));
            toast(`"${line}" will match ${p.name} from now on`);
          } else toast(me.role === 'super' ? `Matched to ${p.name} for this paste. Run supabase/aliases.sql to remember it.` : `Matched to ${p.name} for this paste`);
        }
      } catch (err) { toast(err.message); }
      checkPaste();
    };
    return h('div', { class: 'unknown-row' }, h('span', { class: 'chip plain off' }, line), sel);
  };

  const clearPlaying = async () => {
    if (!await ask('Clear the playing list?', 'Everyone is unticked. You can undo it right after.', 'Clear list')) return;
    const before = players.filter(p => p.playing).map(p => p.id);
    try {
      await q(sb.from('players').update({ playing: false }).eq('playing', true));
      playingUndo = { ids: before, what: `Playing list cleared (${before.length} taken off).` }; render();
    } catch (err) { toast(err.message); }
  };
  const undoPlaying = async () => {
    try {
      await q(sb.from('players').update({ playing: false }).eq('playing', true));
      if (playingUndo.ids.length) await q(sb.from('players').update({ playing: true }).in('id', playingUndo.ids));
      toast(`Playing list put back (${playingUndo.ids.length})`); playingUndo = null; render();
    } catch (err) { toast(`Not undone: ${err.message}`); }
  };

  return h('div', {},
    pageHead('Players', 'Who\'s playing this session, and each player\'s setter role.', countEl),
    playingUndo && h('div', { class: 'card undo-line', role: 'status' }, h('span', {}, playingUndo.what),
      h('button', { class: 'ghost sm', onclick: undoPlaying }, 'Undo'),
      h('button', { class: 'ghost sm', 'aria-label': 'Dismiss', onclick: e => { playingUndo = null; e.target.closest('.undo-line').remove(); } }, '×')),
    me.role === 'super' && h('form', { class: 'card add-player', onsubmit: add },
      h('div', { class: 'row' }, name, h('button', {}, 'Add player')),
      h('div', { class: 'field' }, h('span', {}, 'Level until rated'), tierPick)),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h3', {}, 'Paste from WhatsApp'),
        h('p', { class: 'muted small', style: 'margin:2px 0 0' }, 'Paste the group\'s list to tick everyone who\'s playing.'))),
      box, pasteResult),
    me.role === 'super' && players.length && 'anchor' in players[0] && h('p', { class: 'muted small' }, h('b', {}, 'Anchor'),
      ': a well-known player every rater rates first. Pick 4 to 6 across the range (strong, average, newer), so a new rater\'s lean is known quickly.'),
    h('div', { class: 'card toolbar' },
      h('input', { type: 'search', placeholder: 'Search players', 'aria-label': 'Search players', oninput: e => { search = e.target.value.trim().toLowerCase(); draw(); } }),
      playingChip,
      h('button', { class: 'ghost', onclick: clearPlaying }, 'Clear playing list')),
    grid,
    h('p', { class: 'muted small', style: 'margin-top:16px' }, 'Main setters: one per team. Backups: at most one per team.'));
}
