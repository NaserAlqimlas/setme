"""Linking ball candidates frame to frame into tracks, and finding the stretches where the ball was in flight.

Positions are in frame heights (0 at the top, 1 at the bottom), so the numbers don't depend on the video's size.
Each frame can have several candidates (heads, hands, a ball on the next court). Between touches a ball in the air
follows a smooth curve, so a flight is a stretch of a track that fits one closely and moves fast enough. Random blobs
strung together don't fit a curve; a ball held, bounced in place or rolled back is too slow.
"""
import math
from dataclasses import dataclass, field

import numpy as np

from .segment import Flight


@dataclass
class Track:
    points: list = field(default_factory=list)   # [(t, x, y)]
    misses: int = 0

    def predict(self, t):
        if len(self.points) < 2:
            return self.points[-1][1:]
        (t0, x0, y0), (t1, x1, y1) = self.points[-2], self.points[-1]
        dt = (t1 - t0) or 1e-6
        return x1 + (x1 - x0) / dt * (t - t1), y1 + (y1 - y0) / dt * (t - t1)


@dataclass
class TrackSettings:
    max_jump: float = 0.08     # how far a candidate can be from where the track was heading, in frame heights
    new_jump: float = 0.10     # the same for a track with one point, which has no heading yet
    max_misses: int = 5        # frames a track may go without a candidate before it ends
    window: int = 7            # points checked together for a smooth curve
    max_wobble: float = 0.006  # how far points may stray from the curve (root mean square, frame heights)
    min_speed: float = 0.5     # slower than this (frame heights a second) is held, bounced or rolled, not flying
    max_speed: float = 8.0     # faster is a jump between two different things
    join: float = 0.35         # seconds: curve stretches this close together are one flight


def track(frames, s=None):
    """frames: iterable of (t, [(x, y), ...]) in time order -> [Track]."""
    s = s or TrackSettings()
    live, done = [], []
    for t, cands in frames:
        # Pair every track and candidate, closest to where the track was heading first.
        pairs = []
        for ti, tr in enumerate(live):
            px, py = tr.predict(t)
            limit = (s.max_jump if len(tr.points) > 1 else s.new_jump) * (tr.misses + 1)
            for ci, (x, y) in enumerate(cands):
                d = math.hypot(x - px, y - py)
                if d <= limit:
                    pairs.append((d, -len(tr.points), ti, ci))
        used_t, used_c = set(), set()
        for _, _, ti, ci in sorted(pairs):
            if ti in used_t or ci in used_c:
                continue
            used_t.add(ti); used_c.add(ci)
            live[ti].points.append((t, *cands[ci])); live[ti].misses = 0
        for ti, tr in enumerate(live):
            if ti not in used_t:
                tr.misses += 1
        done.extend(tr for tr in live if tr.misses > s.max_misses)
        live = [tr for tr in live if tr.misses <= s.max_misses]
        live.extend(Track([(t, *c)]) for ci, c in enumerate(cands) if ci not in used_c)
    done.extend(live)
    return [tr for tr in done if len(tr.points) >= s.window]


def flights_of(tr, s=None):
    """A track -> [Flight]: the stretches where it moved like a ball in the air."""
    s = s or TrackSettings()
    p = np.asarray(tr.points, float)
    n, w = len(p), s.window
    if n < w:
        return []
    active = np.zeros(n, bool)
    speed_at = np.zeros(n)
    for i in range(n - w + 1):
        t, x, y = p[i:i + w].T
        span = t[-1] - t[0]
        if span <= 0:
            continue
        tt = t - t[0]
        wob = max(np.sqrt(np.mean((np.polyval(np.polyfit(tt, v, 2), tt) - v) ** 2)) for v in (x, y))
        steps = np.hypot(np.diff(x), np.diff(y)) / np.maximum(np.diff(t), 1e-6)
        sp = float(np.hypot(x[-1] - x[0], y[-1] - y[0]) / span)
        if wob <= s.max_wobble and s.min_speed <= sp and steps.max() <= s.max_speed:
            active[i:i + w] = True
            speed_at[i:i + w] = np.maximum(speed_at[i:i + w], sp)

    # Runs of active points [first, last], then runs close together in time joined (a touch breaks the curve).
    runs = []
    for i in np.flatnonzero(active):
        if runs and i == runs[-1][1] + 1:
            runs[-1][1] = i
        else:
            runs.append([i, i])
    joined = []
    for a, b in runs:
        if joined and p[a, 0] - p[joined[-1][1], 0] <= s.join:
            joined[-1][1] = b
        else:
            joined.append([a, b])
    out = []
    for a, b in joined:
        ys = p[a:b + 1, 2]
        rise = float(np.max(np.maximum.accumulate(ys) - ys))   # biggest climb up the frame (y shrinks going up)
        out.append(Flight(float(p[a, 0]), float(p[b, 0]), float(speed_at[a:b + 1].max()), rise))
    return out
