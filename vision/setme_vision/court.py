"""The court, marked once per camera setup by clicking its four corners on one frame.

The camera behind a baseline sees the court as a trapezoid: near corners wide at the bottom, far corners narrower
up the frame. The ball flies above the court, so the area searched for it is the court stretched up to the top of
the frame, a little wider than the lines. That keeps out balls on the next court and people walking past.
"""
import json
from pathlib import Path

import cv2
import numpy as np

ORDER = ['near left', 'near right', 'far right', 'far left']


def search_area(corners, frame_size, margin=0.08):
    """corners: 4 (x, y) in ORDER, in video pixels -> polygon of where to look for the ball."""
    w, h = frame_size
    nl, nr, fr, fl = corners
    pad = margin * (nr[0] - nl[0])
    bottom = min(h, max(nl[1], nr[1]) + 0.04 * h)
    # Up to the top of the frame, halfway between the near and far sidelines: a ball high over the near court shows
    # up high in the frame too, so the far corners alone would cut it off.
    return [(nl[0] - pad, bottom), (nr[0] + pad, bottom), ((nr[0] + fr[0]) / 2 + pad, 0), ((nl[0] + fl[0]) / 2 - pad, 0)]


def court_file(video):
    return Path(video).with_suffix('.court.json')


def load(video):
    p = court_file(video)
    return json.loads(p.read_text())['corners'] if p.exists() else None


def pick(video, at=5.0):
    """Shows one frame and asks for the four corners in ORDER. Saves them next to the video."""
    cap = cv2.VideoCapture(str(video))
    cap.set(cv2.CAP_PROP_POS_MSEC, at * 1000)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise SystemExit(f'Could not read a frame from {video}')
    h, w = frame.shape[:2]
    scale = min(1.0, 1280 / w, 800 / h)
    view = cv2.resize(frame, (round(w * scale), round(h * scale)))
    corners, title = [], 'Click the court corners (Esc to cancel, Backspace to undo)'

    def draw():
        img = view.copy()
        pts = [(round(x * scale), round(y * scale)) for x, y in corners]
        for i, p in enumerate(pts):
            cv2.circle(img, p, 6, (0, 220, 255), -1)
            cv2.putText(img, ORDER[i], (p[0] + 8, p[1] - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 220, 255), 2)
        for a, b in zip(pts, pts[1:] + pts[:1] if len(pts) == 4 else pts[1:]):
            cv2.line(img, a, b, (0, 220, 255), 2)
        msg = f'Click the {ORDER[len(corners)]} corner' if len(corners) < 4 else 'Enter to save, Backspace to redo'
        cv2.putText(img, msg, (16, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 4)
        cv2.putText(img, msg, (16, 32), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
        cv2.imshow(title, img)

    def click(ev, x, y, *_):
        if ev == cv2.EVENT_LBUTTONDOWN and len(corners) < 4:
            corners.append((x / scale, y / scale)); draw()

    cv2.namedWindow(title)
    cv2.setMouseCallback(title, click)
    draw()
    while True:
        k = cv2.waitKey(50) & 0xFF
        if k == 27:
            cv2.destroyAllWindows(); raise SystemExit('Cancelled')
        if k in (8, 127) and corners:
            corners.pop(); draw()
        if k in (10, 13) and len(corners) == 4:
            break
    cv2.destroyAllWindows()
    court_file(video).write_text(json.dumps({'corners': [[round(x, 1), round(y, 1)] for x, y in corners], 'order': ORDER}, indent=2))
    return corners


# ----- the court in metres, for ball positions and in/out calls -----
# x across the court (0 at the camera's left sideline, 9 at the right), y along it (0 at the near end line, 18 at the
# far one, the net over y = 9). Lines belong to the court: the 9 x 18 m is measured to their outer edges.
WIDTH, LENGTH, NET = 9.0, 18.0, 9.0
POINTS = {   # the places that can be clicked, nearest first; any 4 or more that aren't all on one line will do
    'near left corner': (0, 0), 'near right corner': (9, 0),
    'near attack line, left': (0, 6), 'near attack line, right': (9, 6),
    'centre line, left': (0, 9), 'centre line, right': (9, 9),
    'far attack line, left': (0, 12), 'far attack line, right': (9, 12),
    'far left corner': (0, 18), 'far right corner': (9, 18),
}
LINES = [((0, 0), (9, 0)), ((0, 18), (9, 18)), ((0, 0), (0, 18)), ((9, 0), (9, 18)),
         ((0, 9), (9, 9)), ((0, 6), (9, 6)), ((0, 12), (9, 12))]


def spread_out(pts):
    """True when some 4 of the points have no 3 in a line, which is what fixing the floor's perspective needs."""
    from itertools import combinations
    line = lambda a, b, c: abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-6
    return any(not any(line(*t) for t in combinations(q, 3)) for q in combinations(pts, 4))


class Court:
    """Where a point on the floor in the picture is on the court. Only true for things touching the floor: a ball in
    the air shows up above the floor spot under it, which is why only landings are placed."""
    def __init__(self, marks):
        """marks: {point name from POINTS: (x, y) in video pixels}."""
        names = [n for n in marks if n in POINTS]
        if len(names) < 4:
            raise ValueError('Mark at least 4 court points')
        img = np.float32([marks[n] for n in names]); world = np.float32([POINTS[n] for n in names])
        if not spread_out(world.tolist()):
            raise ValueError('Too many of those points are on one line: mark points on both sidelines, at two distances')
        self.marks = {n: tuple(map(float, marks[n])) for n in names}
        self.to_court, _ = cv2.findHomography(img, world, 0)
        self.to_image = np.linalg.inv(self.to_court)
        back = self.image(world)
        self.error = float(np.sqrt(((back - img) ** 2).sum(1)).max())   # px: how well the clicks agree (0 for exactly 4)

    @staticmethod
    def _apply(H, pts):
        pts = np.asarray(pts, np.float64).reshape(-1, 2)
        return cv2.perspectiveTransform(pts[None], H)[0]

    def place(self, pts):
        """Video pixels on the floor -> court metres."""
        return self._apply(self.to_court, pts)

    def image(self, pts):
        """Court metres -> video pixels."""
        return self._apply(self.to_image, pts)

    def blur(self, px, pixels=4.0):
        """How far (metres) a click or detection off by `pixels` moves the court spot, at this picture point: far
        away, a pixel covers more floor."""
        (x, y), = np.asarray(px, float).reshape(1, 2)
        d = [self.place([(x + dx, y + dy)])[0] for dx, dy in ((pixels, 0), (-pixels, 0), (0, pixels), (0, -pixels))]
        return float(max(np.hypot(*(a - b)) for a, b in ((d[0], d[1]), (d[2], d[3]))) / 2)

    def corners(self):
        """The four corners in the picture, in ORDER, for search_area()."""
        return [tuple(map(float, p)) for p in self.image([(0, 0), (9, 0), (9, 18), (0, 18)])]

    def save(self, video, frame_t=None):
        data = {'marks': {n: [round(x, 1), round(y, 1)] for n, (x, y) in self.marks.items()},
                'corners': [[round(x, 1), round(y, 1)] for x, y in self.corners()], 'order': ORDER, 'frame_t': frame_t}
        court_file(video).write_text(json.dumps(data, indent=2))


def load_court(video):
    p = court_file(video)
    if not p.exists():
        return None
    d = json.loads(p.read_text())
    return Court(d['marks']) if 'marks' in d else None


def call(spot, blur, margin=0.03):
    """A landing spot (court metres) -> 'in', 'out' or 'close'. In includes the lines. margin: the ball's contact with
    the floor reaches a few centimetres past its centre. Within `blur` of the boundary it's too close to call."""
    x, y = spot
    inside = min(x, WIDTH - x, y, LENGTH - y) + margin   # metres inside the boundary (negative: outside)
    if abs(inside) <= blur:
        return 'close'
    return 'in' if inside > 0 else 'out'
