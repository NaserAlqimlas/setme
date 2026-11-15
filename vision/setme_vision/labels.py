"""Training data for a ball detector (YOLO): frames from tagged games with the ball marked.

    python -m setme_vision.labels propose ~/Documents/setme-test-video tags.csv     # pick frames, propose boxes
    python -m setme_vision.review ~/Documents/setme-test-video/labels               # check them (see review.py)
    python -m setme_vision.labels export ~/Documents/setme-test-video/labels --val IMG_5277,IMG_5290

propose picks frames from each tagged video and guesses where the ball is, so a person only has to check:
  - flight: the tracker followed the ball through a clean curve here, so the box is very likely right;
  - colour: a ball-coloured blob that wasn't part of a flight (held, rolling, or a shirt);
  - none:   nothing found, often during a rally (the ball blurred, far away or hidden), which is what the
            detector most needs to learn.
Frames and labels.json go in <folder>/labels. Running it again adds frames and never touches reviewed ones.

export writes the reviewed frames in YOLO's layout, split by game: whole games go to validation, so the model is
checked on games it never trained on.
"""
import argparse
import json
import os
import shutil
from pathlib import Path

import cv2
import numpy as np

from .detect import ColourBallDetector
from .evaluate import camera_name, read_tags, seen_in
from .track import TrackSettings, flights_of, track

VIDEO_EXT = ('.mov', '.mp4', '.m4v')
SHARE = {'flight': 0.6, 'rally': 0.25, 'between': 0.15}   # where the frames come from
DEFAULT_SIZE = 18                                          # px: a box when the ball's size isn't known
REVIEWED = ('ok', 'moved', 'no-ball')


def load(folder):
    p = Path(folder) / 'labels.json'
    return json.loads(p.read_text()) if p.exists() else {'version': 1, 'items': []}


def save(folder, data):
    """Written whole and swapped in, so a crash never leaves half a file."""
    p = Path(folder) / 'labels.json'
    tmp = p.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(data, indent=1))
    os.replace(tmp, p)


def spread(times, n, rng, apart=0.5):
    """Up to n of the times, at least `apart` seconds from each other, spread through the game."""
    times = sorted(times)
    if not times or n <= 0:
        return []
    picked = []
    for t in sorted(rng.permutation(times)[:n * 6]):
        if not picked or t - picked[-1] >= apart:
            picked.append(t)
    if len(picked) > n:
        picked = [picked[i] for i in np.linspace(0, len(picked) - 1, n).round().astype(int)]
    return picked


def plan(seen, truth, n, rng):
    """Which frames to label: [(t, kind, expected (x, y) in frame heights or None)]."""
    sure = []   # (t, x, y) on a clean flight
    for tr in track(seen, TrackSettings()):
        for f in flights_of(tr):
            sure.extend(p for p in tr.points if f.start <= p[0] <= f.end)
    at = {round(t, 3): (x, y) for t, x, y in sure}
    in_rally = lambda t: any(a - 1 <= t <= b + 2 for a, b in truth)
    near_sure = set(round(t, 1) for t, _, _ in sure)
    times = [t for t, _ in seen]
    rally = [t for t in times if in_rally(t) and round(t, 1) not in near_sure]
    between = [t for t in times if not in_rally(t)]
    out = [(t, 'flight', at[round(t, 3)]) for t in spread(list(at), round(n * SHARE['flight']), rng)]
    out += [(t, 'rally', None) for t in spread(rally, round(n * SHARE['rally']), rng)]
    out += [(t, 'between', None) for t in spread(between, round(n * SHARE['between']), rng, apart=2.0)]
    return sorted(out)


def frames_at(video, indices):
    """Yields (index, frame) for the wanted frame numbers, in order: reads forward when close, seeks when far."""
    cap = cv2.VideoCapture(str(video))
    pos = 0
    for i in sorted(indices):
        if i < pos or i - pos > 90:
            cap.set(cv2.CAP_PROP_POS_FRAMES, i); pos = i
        while pos < i:
            cap.grab(); pos += 1
        ok, frame = cap.read(); pos += 1
        if ok:
            yield i, frame
    cap.release()


def guess(boxes, expected, h):
    """The detector's box nearest where the flight says the ball is, or the biggest one."""
    if not boxes:
        return None
    if expected is None:
        return max(boxes, key=lambda b: b[2] * b[3])
    ex, ey = expected[0] * h, expected[1] * h
    b = min(boxes, key=lambda b: (b[0] - ex) ** 2 + (b[1] - ey) ** 2)
    return b if ((b[0] - ex) ** 2 + (b[1] - ey) ** 2) ** 0.5 <= 0.03 * h else None


def propose(folder, tags, out=None, per_video=400, seed=1):
    folder = Path(folder).expanduser()
    out = Path(out).expanduser() if out else folder / 'labels'
    (out / 'frames').mkdir(parents=True, exist_ok=True)
    data = load(out)
    have = {it['id'] for it in data['items']}
    rng = np.random.default_rng(seed)
    opts = argparse.Namespace(ball='yellow', court=False, fresh=False)
    for video in sorted(p for p in folder.iterdir() if p.suffix.lower() in VIDEO_EXT):
        try:
            truth = read_tags(tags, video)
        except SystemExit:
            print(f'{video.name}: no tags, skipped'); continue
        seen, _, _ = seen_in(video, truth, opts)
        cap = cv2.VideoCapture(str(video))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        cap.release()
        wanted = {}
        for t, kind, exp in plan(seen, truth, per_video, rng):
            i = round(t * fps)
            key = f'{video.stem}_{i:06d}'
            if key not in have:
                wanted[i] = (key, t, kind, exp)
        det = ColourBallDetector((w, h), moving=False)
        added = 0
        for i, frame in frames_at(video, wanted):
            key, t, kind, exp = wanted[i]
            b = guess(det.boxes(frame), exp, det.height)
            if b is not None and det.scale != 1.0:
                b = tuple(v / det.scale for v in b)
            if b is None and exp is not None:            # the flight says it's here even if this frame's blob isn't
                b, source = (exp[0] * h, exp[1] * h, DEFAULT_SIZE, DEFAULT_SIZE), 'flight-guess'
            else:
                source = 'none' if b is None else 'flight' if kind == 'flight' else 'colour'
            cv2.imwrite(str(out / 'frames' / f'{key}.jpg'), frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
            data['items'].append({'id': key, 'video': video.name, 'frame': i, 't': round(t, 2), 'kind': kind,
                                  'width': w, 'height': h, 'source': source, 'status': 'pending',
                                  'box': None if b is None else [round(v, 1) for v in b]})
            added += 1
        save(out, data)
        print(f'{video.name}: {added} frames added', flush=True)
    counts = {}
    for it in data['items']:
        counts[it['source']] = counts.get(it['source'], 0) + 1
    print(f"{len(data['items'])} frames in {out}: " + ', '.join(f'{v} {k}' for k, v in sorted(counts.items())))


def export(folder, out=None, val=()):
    """Reviewed frames -> a YOLO dataset: images/ and labels/ for train and val, and data.yaml."""
    folder = Path(folder).expanduser()
    out = Path(out).expanduser() if out else folder.parent / 'yolo'
    val = {camera_name(v) for v in val}
    for split in ('train', 'val'):
        for kind in ('images', 'labels'):
            d = out / kind / split
            shutil.rmtree(d, ignore_errors=True); d.mkdir(parents=True)
    n = {'train': 0, 'val': 0}
    for it in load(folder)['items']:
        if it['status'] not in REVIEWED:
            continue
        split = 'val' if camera_name(it['video']) in val else 'train'
        src = folder / 'frames' / f"{it['id']}.jpg"
        dst = out / 'images' / split / src.name
        try:
            os.link(src, dst)        # same disk: no copy
        except OSError:
            shutil.copy2(src, dst)
        line = ''
        if it['status'] != 'no-ball' and it['box']:
            cx, cy, bw, bh = it['box']
            line = f"0 {cx / it['width']:.6f} {cy / it['height']:.6f} {bw / it['width']:.6f} {bh / it['height']:.6f}\n"
        (out / 'labels' / split / f"{it['id']}.txt").write_text(line)   # empty file = no ball in this frame
        n[split] += 1
    (out / 'data.yaml').write_text(f'path: {out}\ntrain: images/train\nval: images/val\nnames:\n  0: ball\n')
    print(f"{n['train']} training and {n['val']} validation frames in {out}")
    return n


def main(argv=None):
    ap = argparse.ArgumentParser(prog='setme_vision.labels')
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('propose', help='pick frames from tagged videos and guess the ball')
    p.add_argument('folder'); p.add_argument('tags')
    p.add_argument('--out', help='default: <folder>/labels')
    p.add_argument('--per-video', type=int, default=400)
    e = sub.add_parser('export', help='write the reviewed frames as a YOLO dataset')
    e.add_argument('folder', help='the labels folder')
    e.add_argument('--out', help='default: next to the labels folder, in yolo/')
    e.add_argument('--val', default='', help='games kept for checking, by name: IMG_5277,IMG_5290')
    a = ap.parse_args(argv)
    if a.cmd == 'propose':
        propose(a.folder, a.tags, a.out, a.per_video)
    else:
        export(a.folder, a.out, [v.strip() for v in a.val.split(',') if v.strip()])


if __name__ == '__main__':
    main()
