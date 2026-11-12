"""The court, marked once per camera setup by clicking its four corners on one frame.

The camera behind a baseline sees the court as a trapezoid: near corners wide at the bottom, far corners narrower
up the frame. The ball flies above the court, so the area searched for it is the court stretched up to the top of
the frame, a little wider than the lines. That keeps out balls on the next court and people walking past.
"""
import json
from pathlib import Path

import cv2

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
