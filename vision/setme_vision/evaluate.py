"""Checks rally finding against a game already tagged in SetMe, and tries settings to find the best.

    python -m setme_vision.evaluate game.mp4 tags.csv [--court] [--ball yellow]
    python -m setme_vision.evaluate folder/ tags.csv     # every tagged video in the folder, current settings only

tags.csv comes from the Supabase SQL Editor (see vision/README.md): one row per tagged rally with first_touch and
last_touch in seconds. Only the part of the video that was tagged is checked. What the video showed is saved next to
it (game.candidates.pkl), so trying settings again doesn't read the whole video again.
"""
import argparse
import csv
import re
import itertools
import pickle
import statistics
from pathlib import Path

import cv2

from . import court
from .__main__ import frames
from .detect import COLOURS, ColourBallDetector, MotionBallDetector
from .segment import Settings, segment
from .track import TrackSettings, flights_of, track


def read_tags(path, video=None):
    """Tagged rallies for one video: [(first_touch, last_touch)]. The CSV may hold several games (a video_ref
    column); then only the rows for this video count, matched by name: IMG_5276.MOV matches IMG_5276_tag.mp4."""
    # The camera's name for the recording (IMG_5276), without what was added when it was copied (_tag, _rallies).
    key = lambda name: (m.group(0) if (m := re.match(r'[A-Za-z]+_?\d+', Path(name).stem)) else Path(name).stem).lower()
    stem = key(video) if video else None
    out, refs = [], set()
    with open(path, newline='') as f:
        for r in csv.DictReader(f):
            ref = r.get('video_ref')
            if ref is not None:
                refs.add(ref)
                if stem and key(ref) != stem:
                    continue
            a, b = r.get('first_touch'), r.get('last_touch')
            if a not in (None, ''):
                out.append((float(a), float(b or a)))
    if not out:
        raise SystemExit(f"No tags for {Path(video).name} in {path}. Videos in it: {', '.join(sorted(refs)) or 'none'}")
    return sorted(out)


def score(found, truth, slack=1.0):
    """found: [Rally]; truth: [(first_touch, last_touch)] -> dict. Each tagged rally matches at most one found rally
    that overlaps it; a found rally covering two tagged ones only counts for one (the other is missed)."""
    used, hits, leads = set(), 0, []
    for a, b in truth:
        for i, r in enumerate(found):
            if i not in used and r.start <= b + slack and r.end >= a - slack:
                used.add(i); hits += 1; leads.append(a - r.start); break
    return {'hits': hits, 'missed': len(truth) - hits, 'extra': len(found) - len(used),
            'lead': statistics.median(leads) if leads else None}


def seen_in(video, truth, a):
    """What the detector saw in the tagged part of the video, read once and kept next to it."""
    lo, hi = truth[0][0] - 15, truth[-1][1] + 15
    cache = Path(video).with_suffix(f'.candidates-{a.ball}{"-court" if a.court else "-whole"}.pkl')
    if cache.exists() and not a.fresh:
        return pickle.loads(cache.read_bytes()), lo, hi
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    size = (int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    area = None if not a.court else court.search_area(court.load(video) or court.pick(video), size)
    det = MotionBallDetector(size, area) if a.ball == 'motion' else ColourBallDetector(size, area, a.ball)
    print(f'Reading {Path(video).name}, {lo:.0f} s to {hi:.0f} s…', flush=True)
    seen = list(frames(cap, fps, det, max(1, round(fps / 30)), max(0, lo), hi))
    cap.release()
    cache.write_bytes(pickle.dumps(seen))
    return seen, lo, hi


def current(seen, truth, lo, hi):
    ts = TrackSettings()
    fl = [f for tr in track(seen, ts) for f in flights_of(tr, ts)]
    return score([r for r in segment(fl, None, Settings()) if r.end >= lo and r.start <= hi], truth)


def everything(folder, a):
    """Each video in the folder that has tags, with the current settings, then the total."""
    rows = []
    for v in sorted(p for p in Path(folder).iterdir() if p.suffix.lower() in ('.mov', '.mp4', '.m4v')):
        try:
            truth = read_tags(a.tags, v)
        except SystemExit:
            print(f'{v.name}: no tags, skipped'); continue
        seen, lo, hi = seen_in(v, truth, a)
        sc = current(seen, truth, lo, hi)
        rows.append((v.name, len(truth), sc))
        print(f"{v.name:24} {sc['hits']:3} of {len(truth):3} found, {sc['missed']:3} missed, {sc['extra']:3} extra", flush=True)
    if rows:
        n = sum(r[1] for r in rows); hits = sum(r[2]['hits'] for r in rows); extra = sum(r[2]['extra'] for r in rows)
        print(f"{'Total':24} {hits:3} of {n:3} found ({100 * hits / n:.0f}%), {n - hits} missed, {extra} extra")


def main(argv=None):
    ap = argparse.ArgumentParser(prog='setme_vision.evaluate')
    ap.add_argument('video', help='a video, or a folder of them'); ap.add_argument('tags')
    ap.add_argument('--court', action='store_true', help='only look on and above the court')
    ap.add_argument('--ball', default='yellow', choices=[*COLOURS, 'motion'])
    ap.add_argument('--fresh', action='store_true', help='read the video again even if it was read before')
    a = ap.parse_args(argv)
    if Path(a.video).is_dir():
        return everything(a.video, a)

    truth = read_tags(a.tags, a.video)
    seen, lo, hi = seen_in(a.video, truth, a)
    print(f'{len(truth)} tagged rallies, {len(seen)} frames.')

    tracks = track(seen, TrackSettings())
    results = []
    for wobble, track_speed in itertools.product([0.004, 0.006, 0.01], [0.3, 0.5]):
        ts = TrackSettings(max_wobble=wobble, min_speed=track_speed)
        fl = [f for tr in tracks for f in flights_of(tr, ts)]
        for gap, min_len, min_speed in itertools.product([2.0, 3.0, 4.0, 5.0], [1.0, 2.0, 3.0], [0.3, 0.5, 0.9]):
            s = Settings(gap=gap, min_len=min_len, min_speed=min_speed)
            sc = score([r for r in segment(fl, None, s) if r.end >= lo and r.start <= hi], truth)
            results.append((sc['hits'] - sc['extra'], sc, dict(wobble=wobble, track_speed=track_speed, gap=gap, min_len=min_len, min_speed=min_speed)))
    results.sort(key=lambda x: (-x[0], abs((x[1]['lead'] or 9) - 1.5)))
    now = current(seen, truth, lo, hi)
    print(f"Current settings: {now['hits']} found, {now['missed']} missed, {now['extra']} extra, start {now['lead']:.1f} s early")
    print('Best settings:')
    for _, sc, st in results[:8]:
        print(f"  {sc['hits']:3} found, {sc['missed']:3} missed, {sc['extra']:3} extra, start {sc['lead']:.1f} s early   {st}")


if __name__ == '__main__':
    main()
