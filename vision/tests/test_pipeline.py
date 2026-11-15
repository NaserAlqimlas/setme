"""Run: vision/.venv/bin/python -m pytest vision/tests

Segmentation and tracking on made-up numbers, then the whole pipeline on a made-up video: a still court, two
players drifting about, a ball flying in arcs during three rallies, and a ball rolled slowly between them.
"""
import json
import math

import cv2
import numpy as np
import pytest

from setme_vision import court
from setme_vision.__main__ import main
from setme_vision.segment import Flight, Settings, segment
from setme_vision.track import flights_of, track


# ----- segmentation -----
def fast(a, b):
    return Flight(a, b, speed=2.0, rise=0.3)


def test_flights_close_together_are_one_rally():
    r = segment([fast(10, 11.5), fast(12.5, 14), fast(15, 16)])
    assert len(r) == 1 and r[0].start == pytest.approx(9.0) and r[0].end == pytest.approx(17)


def test_a_long_gap_starts_a_new_rally():
    r = segment([fast(10, 13), fast(30, 33)])
    assert [round(x.start, 1) for x in r] == [9.0, 29.0]


def test_slow_or_short_movement_is_not_a_rally():
    slow = Flight(10, 14, speed=0.3, rise=0.02)          # ball rolled back to the server
    assert segment([slow]) == []
    assert segment([fast(10, 11)]) == []                 # too short on its own


def test_padding_never_overlaps_and_stays_in_the_video():
    r = segment([fast(0.5, 3), fast(6.5, 9)], duration=9.5, s=Settings(gap=3.0))
    assert len(r) == 2 and r[0].start == 0 and r[1].start >= r[0].end and r[1].end == 9.5


# ----- tracking -----
def arc(t0, n=30, fps=30, x0=0.4, vx=0.5, vy=-1.6, g=3.0):
    return [(t0 + i / fps, x0 + vx * i / fps, 0.8 + vy * i / fps + g * (i / fps) ** 2 / 2) for i in range(n)]


def test_a_smooth_arc_is_a_flight_among_noise():
    rng = np.random.default_rng(1)
    pts = arc(5.0)
    frames = [(t, [(x, y)] + [tuple(rng.uniform(0, 1, 2)) for _ in range(3)]) for t, x, y in pts]
    flights = [f for tr in track(frames) for f in flights_of(tr)]
    assert len(flights) == 1
    f = flights[0]
    assert f.start == pytest.approx(5.0) and f.end == pytest.approx(pts[-1][0]) and f.speed > 1 and f.rise > 0.2


def test_jitter_in_place_is_not_a_flight():
    frames = [(i / 30, [(0.5 + 0.002 * (i % 2), 0.5)]) for i in range(60)]
    assert [f for tr in track(frames) for f in flights_of(tr)] == []


# ----- court -----
def test_search_area_covers_the_court_and_the_air_above_it():
    corners = [(200, 650), (1080, 650), (820, 300), (460, 300)]
    poly = np.array(court.search_area(corners, (1280, 720)), np.float32)
    inside = lambda p: cv2.pointPolygonTest(poly, p, False) >= 0
    assert all(inside(c) for c in corners)
    assert inside((640, 50))              # high above the court
    assert not inside((40, 400))          # off to the side: the next court


# ----- the whole thing on a made-up video -----
RALLIES = [(4.0, 9.0), (16.0, 22.0), (30.0, 34.0)]   # seconds


def make_video(path, fps=30, seconds=40, size=(960, 540), ball=(30, 210, 240)):   # ball: BGR, the club's yellow
    w, h = size
    out = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*'mp4v'), fps, size)
    bg = np.full((h, w, 3), (60, 110, 170), np.uint8)
    cv2.polylines(bg, [np.array([(150, 500), (810, 500), (620, 230), (340, 230)], np.int32)], True, (240, 240, 240), 3)
    cv2.line(bg, (300, 330), (660, 330), (30, 30, 30), 4)                      # the net
    rng = np.random.default_rng(7)
    for i in range(fps * seconds):
        t = i / fps
        img = bg.copy()
        for k, px in enumerate((330, 600)):                                    # players drifting about
            x = int(px + 40 * math.sin(t * 0.7 + k))
            cv2.rectangle(img, (x, 360), (x + 40, 470), (20, 20, 90), -1)
        live = next(((a, b) for a, b in RALLIES if a <= t <= b), None)
        if live:
            # Back and forth over the net: each crossing is an arc lasting 1.2 s.
            u = (t - live[0]) % 1.2 / 1.2
            leg = int((t - live[0]) // 1.2)
            x0, x1 = (380, 560) if leg % 2 == 0 else (560, 380)
            y0, y1 = (470, 260) if leg % 2 == 0 else (260, 470)
            x = x0 + (x1 - x0) * u
            y = y0 + (y1 - y0) * u - 260 * 4 * u * (1 - u)
            cv2.circle(img, (int(x), int(y)), 7, ball, -1)
        elif any(b < t < b + 4 for _, b in RALLIES):                           # ball rolled back slowly
            b = next(b for _, b in RALLIES if b < t < b + 4)
            cv2.circle(img, (int(300 + 30 * (t - b)), 480), 7, ball, -1)
        img = cv2.add(img, rng.integers(0, 6, img.shape, dtype=np.uint8))       # sensor noise
        out.write(img)
    out.release()


@pytest.mark.parametrize('ball, how', [((30, 210, 240), 'yellow'), ((250, 250, 250), 'motion')])
def test_finds_the_rallies_in_a_made_up_video(tmp_path, ball, how):
    video = tmp_path / 'game.mp4'
    make_video(video, ball=ball)
    (tmp_path / 'game.court.json').write_text(json.dumps({'corners': [[150, 500], [810, 500], [620, 230], [340, 230]]}))
    main([str(video), '--ball', how, '--court'])
    got = json.loads((tmp_path / 'game.rallies.json').read_text())
    assert got['video'] == 'game.mp4' and got['version'] == 1
    found = [(r['start'], r['end']) for r in got['rallies']]
    assert len(found) == len(RALLIES), found
    for (a, b), (fa, fb) in zip(RALLIES, found):
        assert abs(fa - a) <= 2.0 and abs(fb - b) <= 2.0, (a, b, fa, fb)
