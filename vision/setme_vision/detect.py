"""Ball candidates in each frame, for a camera that doesn't move.

The background (floor, walls, net) stays still, so whatever moves stands out. The ball is the small, roundish moving
thing; players are big. Many small things move too (hands, heads, a ball on the next court), so this returns every
candidate and leaves the choosing to track.py.
"""
import cv2
import numpy as np

WORK_HEIGHT = 540   # frames are shrunk to this height first: faster, and the sizes below are in these pixels


class MotionBallDetector:
    def __init__(self, frame_size, area=None, min_area=6, max_area=500, min_round=0.35):
        w, h = frame_size
        self.scale = WORK_HEIGHT / h
        self.size = (round(w * self.scale), WORK_HEIGHT)
        self.bg = cv2.createBackgroundSubtractorMOG2(history=200, varThreshold=32, detectShadows=False)
        self.kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        self.mask = None
        if area is not None:   # where to look: a polygon in the original video's pixels
            self.mask = np.zeros((WORK_HEIGHT, self.size[0]), np.uint8)
            cv2.fillPoly(self.mask, [np.round(np.asarray(area, float) * self.scale).astype(np.int32)], 255)
        self.min_area, self.max_area, self.min_round = min_area, max_area, min_round

    def __call__(self, frame):
        """frame: BGR image -> [(x, y)] in frame heights (0 top, 1 bottom; x from the left edge)."""
        small = cv2.resize(frame, self.size, interpolation=cv2.INTER_AREA)
        fg = self.bg.apply(small)
        if self.mask is not None:
            fg = cv2.bitwise_and(fg, self.mask)
        fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, self.kernel)
        n, _, stats, cents = cv2.connectedComponentsWithStats(fg, connectivity=8)
        out = []
        for i in range(1, n):
            x, y, w, h, a = stats[i]
            if not (self.min_area <= a <= self.max_area):
                continue
            # A fast ball smears into a short streak, so allow some stretch, but not a long thin arm or a line.
            if max(w, h) > 3.5 * max(1, min(w, h)):
                continue
            if a / float(w * h) < self.min_round * 0.785:   # fill of its box, compared with a circle's (pi / 4)
                continue
            cx, cy = cents[i]
            out.append((cx / WORK_HEIGHT, cy / WORK_HEIGHT))
        return out


# Ball colours as hue, saturation and brightness ranges (OpenCV's HSV: hue 0 to 180). The club's ball is yellow and
# blue. Its yellow sits around hue 24; lime shirts and wood floors are close (hue 35, and pale), so the range is tight.
COLOURS = {'yellow': ((19, 105, 100), (29, 255, 255))}


class ColourBallDetector:
    """Yellow blobs that are moving. Works at full resolution: from far back the ball is only a few pixels across.
    A blob counts as moving when part of it differs from the slowly learned background (the ball held still for a
    serve, a yellow shirt standing, or a yellow mark on the wall doesn't)."""
    def __init__(self, frame_size, area=None, colour='yellow', work_height=1080, min_area=70, max_area=4000, moving=True):
        w, h = frame_size
        self.scale = min(1.0, work_height / h)
        self.size = (round(w * self.scale), round(h * self.scale))
        self.height = self.size[1]
        self.lo, self.hi = COLOURS[colour]
        self.kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        self.bg = cv2.createBackgroundSubtractorMOG2(history=150, varThreshold=40, detectShadows=False) if moving else None
        self.mask = None
        if area is not None:
            self.mask = np.zeros((self.size[1], self.size[0]), np.uint8)
            cv2.fillPoly(self.mask, [np.round(np.asarray(area, float) * self.scale).astype(np.int32)], 255)
        k = (self.height / 1080) ** 2                      # sizes are for 1080 pixels high
        self.min_area, self.max_area = min_area * k, max_area * k

    def __call__(self, frame):
        small = frame if self.scale == 1.0 else cv2.resize(frame, self.size, interpolation=cv2.INTER_AREA)
        m = cv2.inRange(cv2.cvtColor(small, cv2.COLOR_BGR2HSV), self.lo, self.hi)
        if self.mask is not None:
            m = cv2.bitwise_and(m, self.mask)
        fg = None
        if self.bg is not None:
            # The background is learned on a quarter-size frame: plenty for "did this spot change", and fast.
            q = cv2.resize(small, (self.size[0] // 4, self.size[1] // 4), interpolation=cv2.INTER_AREA)
            fg = cv2.resize(self.bg.apply(q), self.size, interpolation=cv2.INTER_NEAREST)
        m = cv2.dilate(m, self.kernel)            # the blue panels split the yellow: join the pieces
        n, labels, stats, cents = cv2.connectedComponentsWithStats(m, connectivity=8)
        out = []
        for i in range(1, n):
            if not (self.min_area <= stats[i][4] <= self.max_area):
                continue
            if fg is not None:
                x, y, w, h = stats[i][:4]
                if not fg[y:y + h, x:x + w][labels[y:y + h, x:x + w] == i].any():
                    continue
            out.append((cents[i][0] / self.height, cents[i][1] / self.height))
        return out
