"""Finds the rallies in a game video and writes their times for the SetMe tag screen.

    python -m setme_vision game.mp4                 # looks for the club's yellow ball anywhere in the frame
    python -m setme_vision game.mp4 --court         # only on the court: for gyms with another court in view
    python -m setme_vision game.mp4 --preview       # also writes game.preview.mp4 to check what it saw

Writes game.rallies.json next to the video. On the tag screen, Load rally times picks it up.
"""
import argparse
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np

from . import court
from .detect import COLOURS, ColourBallDetector, MotionBallDetector
from .segment import Settings, segment
from .track import TrackSettings, flights_of, track

VERSION = 1


def frames(cap, fps, detector, step, start, stop, on_frame=None):
    """Yields (t, candidates) for every step-th frame between start and stop seconds."""
    cap.set(cv2.CAP_PROP_POS_MSEC, start * 1000)
    i = round(start * fps)
    while True:
        ok = cap.grab()
        if not ok:
            return
        t = i / fps
        if stop is not None and t > stop:
            return
        if i % step == 0:
            ok, frame = cap.retrieve()
            if not ok:
                return
            cands = detector(frame)
            if on_frame:
                on_frame(t, frame, cands)
            yield t, cands
        i += 1


def main(argv=None):
    ap = argparse.ArgumentParser(prog='setme_vision', description='Find the rallies in a game video.')
    ap.add_argument('video')
    ap.add_argument('--ball', default='yellow', choices=[*COLOURS, 'motion'],
                    help="how to spot the ball: by its colour (the club's yellow ball), or anything small that moves")
    ap.add_argument('--court', action='store_true', help='only look on and above the court (asks for its corners the first time)')
    ap.add_argument('--pick-court', action='store_true', help='mark the court corners again (implies --court)')
    ap.add_argument('--out', help='where to write the rally times (default: next to the video)')
    ap.add_argument('--preview', action='store_true', help='also write a video showing what it saw')
    ap.add_argument('--start', type=float, default=0, help='seconds into the video to start')
    ap.add_argument('--stop', type=float, help='seconds into the video to stop')
    ap.add_argument('--gap', type=float, default=Settings.gap, help='seconds the ball can be lost within one rally')
    ap.add_argument('--min-len', type=float, default=Settings.min_len, help='shortest rally, in seconds')
    ap.add_argument('--min-speed', type=float, default=Settings.min_speed, help='how fast the ball must move at least once (frame heights a second)')
    a = ap.parse_args(argv)

    video = Path(a.video)
    cap = cv2.VideoCapture(str(video))
    if not cap.isOpened():
        sys.exit(f"Can't open {video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    size = (int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps
    step = max(1, round(fps / 30))   # 30 frames a second is plenty

    area = None
    if a.court or a.pick_court:
        corners = None if a.pick_court else court.load(video)
        if corners is None:
            print('Click the four court corners in the window that opens (near left, near right, far right, far left).')
            corners = court.pick(video, at=a.start + 5)
        area = court.search_area(corners, size)

    detector = MotionBallDetector(size, area) if a.ball == 'motion' else ColourBallDetector(size, area, a.ball)
    writer, on_frame = None, None
    if a.preview:
        pv = video.with_suffix('.preview.mp4')
        ph = 540; pw = round(size[0] * ph / size[1])
        writer = cv2.VideoWriter(str(pv), cv2.VideoWriter_fourcc(*'mp4v'), fps / step, (pw, ph))
        poly = None if area is None else [(round(x * ph / size[1]), round(y * ph / size[1])) for x, y in area]

        def on_frame(t, frame, cands):
            img = cv2.resize(frame, (pw, ph))
            if poly:
                cv2.polylines(img, [np.array(poly, np.int32)], True, (0, 200, 255), 1)
            for x, y in cands:
                cv2.circle(img, (round(x * ph), round(y * ph)), 7, (0, 255, 0), 2)
            cv2.putText(img, f'{int(t // 60)}:{t % 60:04.1f}', (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            writer.write(img)

    began, last = time.time(), 0.0
    def progress(it):
        nonlocal last
        for t, c in it:
            if time.time() - last > 2:
                last = time.time()
                end = a.stop or duration
                print(f'\r  {t / 60:5.1f} of {end / 60:.1f} min', end='', flush=True)
            yield t, c

    tracks = track(progress(frames(cap, fps, detector, step, a.start, a.stop, on_frame)), TrackSettings())
    cap.release()
    if writer:
        writer.release()
    flights = [f for tr in tracks for f in flights_of(tr)]
    s = Settings(gap=a.gap, min_len=a.min_len, min_speed=a.min_speed)
    rallies = segment(flights, duration, s)
    print(f'\r  done in {time.time() - began:.0f} s: {len(rallies)} rallies, {len(flights)} ball flights.          ')

    out = Path(a.out) if a.out else video.with_suffix('.rallies.json')
    out.write_text(json.dumps({
        'version': VERSION, 'video': video.name, 'duration': round(duration, 2),
        'settings': {'gap': s.gap, 'min_len': s.min_len, 'min_speed': s.min_speed},
        'rallies': [r.as_dict() for r in rallies],
    }, indent=1))
    print(f'Wrote {out}')
    if writer:
        print(f'Wrote {pv}: green circles are what it took for the ball.')


if __name__ == '__main__':
    main()
