"""Checks rally finding against a game already tagged in SetMe, and tries settings to find the best.

    python -m setme_vision.evaluate game.mp4 tags.csv [--court] [--ball yellow]

tags.csv comes from the Supabase SQL Editor (see vision/README.md): one row per tagged rally with first_touch and
last_touch in seconds. Only the part of the video that was tagged is checked. What the video showed is saved next to
it (game.candidates.pkl), so trying settings again doesn't read the whole video again.
"""
import argparse
import csv
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


def read_tags(path):
    out = []
    with open(path, newline='') as f:
        for r in csv.DictReader(f):
            a, b = r.get('first_touch'), r.get('last_touch')
            if a not in (None, ''):
                out.append((float(a), float(b or a)))
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


def main(argv=None):
    ap = argparse.ArgumentParser(prog='setme_vision.evaluate')
    ap.add_argument('video'); ap.add_argument('tags')
    ap.add_argument('--court', action='store_true', help='only look on and above the court')
    ap.add_argument('--ball', default='yellow', choices=[*COLOURS, 'motion'])
    ap.add_argument('--fresh', action='store_true', help='read the video again even if it was read before')
    a = ap.parse_args(argv)

    truth = read_tags(a.tags)
    lo, hi = truth[0][0] - 15, truth[-1][1] + 15
    cache = Path(a.video).with_suffix(f'.candidates-{a.ball}{"-court" if a.court else "-whole"}.pkl')
    if cache.exists() and not a.fresh:
        seen = pickle.loads(cache.read_bytes())
    else:
        cap = cv2.VideoCapture(str(a.video))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        size = (int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
        area = None if not a.court else court.search_area(court.load(a.video) or court.pick(a.video), size)
        det = MotionBallDetector(size, area) if a.ball == 'motion' else ColourBallDetector(size, area, a.ball)
        print(f'Reading {lo:.0f} s to {hi:.0f} s of the video…')
        seen = list(frames(cap, fps, det, max(1, round(fps / 30)), max(0, lo), hi))
        cap.release()
        cache.write_bytes(pickle.dumps(seen))
    print(f'{len(truth)} tagged rallies, {len(seen)} frames.')

    tracks = track(seen, TrackSettings())
    results = []
    for wobble, track_speed in itertools.product([0.004, 0.006, 0.01], [0.3, 0.5]):
        ts = TrackSettings(max_wobble=wobble, min_speed=track_speed)
        fl = [f for tr in tracks for f in flights_of(tr, ts)]
        for gap, min_len, min_speed, min_rise in itertools.product([2.0, 3.0, 4.0, 5.0], [1.0, 2.0, 3.0], [0.5, 0.9, 1.5], [0.0, 0.04, 0.08]):
            s = Settings(gap=gap, min_len=min_len, min_speed=min_speed, min_rise=min_rise)
            found = [r for r in segment(fl, None, s) if r.end >= lo and r.start <= hi]
            sc = score(found, truth)
            results.append((sc['hits'] - sc['extra'], sc, dict(wobble=wobble, track_speed=track_speed, gap=gap, min_len=min_len, min_speed=min_speed, min_rise=min_rise)))
    results.sort(key=lambda x: (-x[0], abs((x[1]['lead'] or 9) - 1.5)))
    ts, st = TrackSettings(), Settings()
    fl = [f for tr in tracks for f in flights_of(tr, ts)]
    now = score([r for r in segment(fl, None, st) if r.end >= lo and r.start <= hi], truth)
    print(f"Current settings: {now['hits']} found, {now['missed']} missed, {now['extra']} extra, start {now['lead']:.1f} s early")
    print('Best settings:')
    for _, sc, st in results[:8]:
        print(f"  {sc['hits']:3} found, {sc['missed']:3} missed, {sc['extra']:3} extra, start {sc['lead']:.1f} s early   {st}")


if __name__ == '__main__':
    main()
