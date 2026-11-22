// The upload panel, bottom right on every page (like Google Drive's): each video uploading or waiting, with its
// progress and a Stop, while you carry on around SetMe. Also offers to finish uploads a reload or a dropped
// connection cut short. The super only (only the super uploads). Uploads stop if the tab is closed.
import { ask, fill, h, toast } from './ui.mjs';
import { forgetUpload, onTray, savedUpload, trayClearFinished, trayItems, unfinishedUploads, uploadVideo } from './upload.mjs';
import { sameFile, sentShare } from './uploadparts.mjs';

let box = null, small = false, closed = false, baseTitle = null;
const pct = v => `${Math.round((v ?? 0) * 100)}%`;
const gb = n => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`;

export function mountTray() {
  if (box) return;
  box = h('aside', { class: 'up-tray', 'aria-label': 'Uploads', hidden: true });
  document.body.append(box);
  baseTitle = document.title;
  onTray(() => { if (trayItems().some(i => i.state === 'uploading' || i.state === 'waiting')) closed = false; paint(); });
  paint();
}

// Only the bars and the words change while bytes move; the rest is drawn when an upload starts, ends or stops.
let shape = '';
function paint() {
  if (!box) return;
  const items = trayItems(), left = unfinishedUploads().filter(l => !items.some(i => i.game === l.game));
  const busy = items.filter(i => i.state === 'uploading' || i.state === 'waiting');
  const up = items.find(i => i.state === 'uploading');
  document.title = up ? `${pct(up.progress)} uploading · ${baseTitle}` : baseTitle;
  if (closed && !busy.length) { box.hidden = true; return; }
  box.hidden = !items.length && !left.length;
  if (box.hidden) return;
  const now = JSON.stringify([small, items.map(i => [i.game, i.state, i.error]), left.map(l => l.game)]);
  if (now === shape) {   // progress only
    for (const i of items) {
      const row = box.querySelector(`[data-game="${i.game}"]`);
      row?.querySelector('progress')?.setAttribute('value', i.progress ?? 0);
      const note = row?.querySelector('.up-note'); if (note) note.textContent = noteOf(i);
    }
    box.querySelector('.up-head b').textContent = headOf(items, left);
    return;
  }
  shape = now;
  const done = items.filter(i => i.state === 'done').length;
  fill(box,
    h('div', { class: 'up-head' },
      h('b', {}, headOf(items, left)),
      h('button', { type: 'button', class: 'up-icon', 'aria-label': small ? 'Show uploads' : 'Hide the list', 'aria-expanded': String(!small), onclick: () => { small = !small; paint(); } }, small ? '▴' : '▾'),
      !busy.length && h('button', { type: 'button', class: 'up-icon', 'aria-label': 'Close', onclick: () => { closed = true; trayClearFinished(); paint(); } }, '✕')),
    !small && h('ul', { class: 'up-list' },
      items.map(i => h('li', { 'data-game': i.game, class: `up-${i.state}` },
        h('div', { class: 'up-row' },
          h('span', { class: 'up-name', title: i.name }, i.name),
          (i.state === 'uploading' || i.state === 'waiting') && i.stop && h('button', { type: 'button', class: 'up-icon', 'aria-label': `Stop ${i.name}`, title: 'Stop this one',
            onclick: async () => { if (await ask(`Stop ${i.name}?`, i.state === 'uploading' ? 'What was sent so far is thrown away. The others carry on.' : 'It won\'t be uploaded. The others carry on.', 'Stop')) i.stop(); } }, '✕')),
        i.state === 'uploading' && h('progress', { max: 1, value: i.progress ?? 0 }),
        h('span', { class: `up-note small ${i.state === 'failed' ? 'warn-text' : 'muted'}` }, noteOf(i)))),
      left.map(l => h('li', { 'data-game': `left-${l.game}`, class: 'up-left' },
        h('div', { class: 'up-row' }, h('span', { class: 'up-name', title: l.name }, l.name)),
        h('span', { class: 'small muted' }, `Stopped at ${pct(sentShare(l))}. Pick the same file to carry on.`),
        h('div', { class: 'up-row', style: 'justify-content:flex-start;gap:6px' },
          h('button', { type: 'button', class: 'sm', onclick: () => resume(l.game) }, 'Pick file'),
          h('button', { type: 'button', class: 'ghost sm', onclick: async () => { if (await ask(`Forget ${l.name}?`, 'What was sent is thrown away.', 'Forget')) { await forgetUpload(l.game); shape = ''; paint(); } } }, 'Forget'))))),
    !small && busy.length > 0 && h('p', { class: 'small muted up-foot' }, 'Keep this tab open. You can use the rest of SetMe meanwhile.'),
    !small && !busy.length && done > 0 && h('p', { class: 'small muted up-foot' }, 'Each one is analysed now; you\'ll get an email. ', h('a', { href: '#games' }, 'Games')));
}

function headOf(items, left) {
  const busy = items.filter(i => i.state === 'uploading' || i.state === 'waiting').length;
  const done = items.filter(i => i.state === 'done').length, failed = items.filter(i => i.state === 'failed').length;
  const up = items.find(i => i.state === 'uploading');
  if (busy) return `Uploading ${items.length - busy + 1} of ${items.length}${up ? ` · ${pct(up.progress)}` : ''}`;
  if (failed) return `${failed} upload${failed === 1 ? '' : 's'} stopped`;
  if (done) return `${done} uploaded`;
  return `${left.length} upload${left.length === 1 ? '' : 's'} to finish`;
}
function noteOf(i) {
  return i.state === 'uploading' ? `${pct(i.progress)} of ${gb(i.size ?? 0)}`
    : i.state === 'waiting' ? 'Waiting'
    : i.state === 'done' ? 'Uploaded · being analysed'
    : `Stopped: ${i.error ?? 'something went wrong'}`;
}

// Carry on an upload a reload cut short: the same file sends only what's missing.
function resume(game) {
  const s = savedUpload(game);
  if (!s) return;
  const pick = h('input', { type: 'file', accept: 'video/*', hidden: true });
  pick.onchange = () => {
    const f = pick.files[0]; pick.remove();
    if (!f) return;
    if (!sameFile(s, f)) return toast(`That isn't ${s.name}. Pick that file to carry on, or Forget it.`);
    uploadVideo(game, f).done.catch(() => {});
    shape = ''; paint();
  };
  document.body.append(pick);
  pick.click();
}
