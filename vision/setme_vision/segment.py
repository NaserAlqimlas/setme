"""Rally segmentation: turns ball flights into rallies. Pure Python, no OpenCV, so it's easy to test.

A flight is a stretch of time the ball was seen moving like a ball in play (see track.py). A rally is one or more
flights close together: the ball goes out of sight for a moment behind players or the net, so short gaps are bridged.
Between rallies the ball is held, bounced before a serve or rolled back, which is slow and short, so it doesn't count.
"""
from dataclasses import dataclass, field


@dataclass
class Flight:
    start: float      # seconds into the video
    end: float
    speed: float      # fastest the ball moved in this flight, in frame heights per second
    rise: float       # how far up the frame the ball travelled, in frame heights


@dataclass
class Settings:
    gap: float = 3.0          # seconds without a flight that still counts as the same rally
    min_len: float = 2.0      # shortest rally kept, in seconds
    min_speed: float = 0.5    # a rally needs at least one flight this fast (frame heights per second): a serve or a hit
    min_rise: float = 0.0     # ... and a flight that climbs at least this much of the frame (off: speed was enough)
    pad_before: float = 1.0   # seconds kept before the first flight: the serve toss is often missed
    pad_after: float = 1.0    # seconds kept after the last flight: the ball landing


@dataclass
class Rally:
    start: float
    end: float
    confidence: float
    flights: list = field(default_factory=list)

    def as_dict(self):
        return {'start': round(self.start, 2), 'end': round(self.end, 2), 'confidence': round(self.confidence, 2)}


def segment(flights, duration=None, s=None):
    """flights: [Flight] in any order -> [Rally], oldest first, never overlapping."""
    s = s or Settings()
    groups = []
    for f in sorted(flights, key=lambda f: f.start):
        if groups and f.start - groups[-1][-1].end <= s.gap:
            groups[-1].append(f)
        else:
            groups.append([f])

    rallies = []
    for g in groups:
        start, end = g[0].start, max(f.end for f in g)
        lively = [f for f in g if f.speed >= s.min_speed and f.rise >= s.min_rise]
        if end - start < s.min_len or not lively:
            continue
        seen = sum(f.end - f.start for f in g)
        # How sure: how much of the rally the ball was actually seen, and how many real hits it had.
        confidence = min(1.0, 0.5 * seen / (end - start) + 0.15 * len(lively))
        start = max(0.0, start - s.pad_before)
        end = end + s.pad_after if duration is None else min(duration, end + s.pad_after)
        if rallies and start < rallies[-1].end:      # padding never makes two rallies overlap
            start = rallies[-1].end
        rallies.append(Rally(start, end, confidence, g))
    return rallies
