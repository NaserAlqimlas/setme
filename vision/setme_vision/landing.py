"""Where the ball first touches the floor after the last touch of a rally, and whether that was in or out.

A falling ball moves down the picture; when it hits the floor it suddenly goes back up (or stops). That sharp turn is
the landing. A frame is 1/30 s, and a hard-hit ball travels up to half a metre in that time, so the moment of contact
is worked out between frames: the path just before and just after the bounce are each fitted with a curve, and the
contact is where they meet.

Positions here are in video pixels (x right, y down). The ball's centre is a radius above the floor at contact, so the
spot placed on the court is the bottom of the ball.
"""
from dataclasses import dataclass

import numpy as np

from .court import call
from .track import TrackSettings, track

BALL = 0.21        # m across
FIT = 0.2          # s of path fitted on each side of a bounce
MIN_FALL = 0.12    # frame heights a second: slower than this down the picture isn't falling


@dataclass
class Landing:
    t: float           # seconds into the video
    x: float           # the ball's centre at contact, video pixels
    y: float
    score: float       # how sharp the turn was (bigger is surer)
    spot: tuple = None      # court metres of the ball's bottom, when the court is marked
    blur: float = None      # metres: how finely the spot is known
    call: str = None        # 'in', 'out' or 'close'


def _fit(t, v, at):
    """Value and slope at `at` of a curve through (t, v): straight for a few points, else a parabola."""
    deg = 2 if len(t) >= 5 else 1
    c = np.polyfit(t - at, v, deg)
    return np.polyval(c, 0.0), np.polyval(np.polyder(c), 0.0), c


def bounces(points, height):
    """points: [(t, x, y)] of one track, video pixels -> [Landing], in time order: every sharp turn from falling to
    rising (or stopping) in the picture."""
    p = np.asarray(points, float)
    if len(p) < 6:
        return []
    t, x, y = p.T
    out = []
    for k in range(2, len(p) - 2):
        if y[k] < y[max(0, k - 3):k + 4].max():          # the lowest point in the picture nearby
            continue
        b = (t >= t[k] - FIT) & (t < t[k]); a = (t > t[k]) & (t <= t[k] + FIT)   # the lowest frame could be either side
        if b.sum() < 3 or a.sum() < 3:
            continue
        _, vb, cb = _fit(t[b], y[b], t[k]); _, va, ca = _fit(t[a], y[a], t[k])
        vb, va = vb / height, va / height                 # frame heights a second
        if vb < MIN_FALL or va > 0.35 * vb:               # wasn't falling, or kept falling at much the same speed
            continue
        # Contact: where the falling curve and the rising curve meet, close to the lowest frame.
        d = np.polysub(np.pad(cb, (3 - len(cb), 0)), np.pad(ca, (3 - len(ca), 0)))
        roots = [r.real for r in np.roots(d) if abs(r.imag) < 1e-9 and -0.04 <= r.real <= 0.04] if np.any(d) else []
        dt = min(roots, key=abs) if roots else 0.0
        _, _, cx = _fit(t[b], x[b], t[k])
        out.append(Landing(float(t[k] + dt), float(np.polyval(cx, dt)), float(np.polyval(cb, dt)), float(vb - va)))
    # Neighbouring frames of one bounce: keep the sharpest.
    kept = []
    for l in out:
        if kept and l.t - kept[-1].t < 0.15:
            if l.score > kept[-1].score:
                kept[-1] = l
        else:
            kept.append(l)
    return kept


def landing_after(seen, last_t, height, window=2.5, court=None, early=1.0):
    """seen: [(t, [(x, y)])] in frame heights (as the detectors give them); last_t: the rally's last touch as tagged.
    -> the first landing after it, or None when the ball wasn't seen landing (out of shot, hidden, or into the net).
    early: tags are pressed after the touch is seen, often half a second to a second late, and a hard hit lands about
    half a second after the touch, so the search starts this many seconds before the tagged time (checked on six
    tagged games: 1 s found the landing a team's kills agree on most often)."""
    part = [(t, c) for t, c in seen if last_t - early - 0.5 <= t <= last_t + window]
    found = []
    for tr in track(part, TrackSettings()):
        pts = [(t, x * height, y * height) for t, x, y in tr.points]
        found += [l for l in bounces(pts, height) if l.t > last_t - early]
    if not found:
        return None
    first = min(found, key=lambda l: l.t)
    if court is not None:
        place(first, court)
    return first


def place(l, court):
    """Puts the landing on the court: the floor spot under the ball's bottom, and the call."""
    spot = court.place([(l.x, l.y)])[0]
    for _ in range(3):                                     # the ball's radius in pixels depends on where it is
        ahead = court.image([spot, spot + (BALL, 0)])
        r = np.hypot(*(ahead[1] - ahead[0])) / 2
        spot = court.place([(l.x, l.y + r)])[0]
    l.spot = (float(spot[0]), float(spot[1]))
    l.blur = court.blur((l.x, l.y + r))
    l.call = call(l.spot, l.blur)
    return l
