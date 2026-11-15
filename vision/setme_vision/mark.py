"""Mark the court once per video: click a few known court points, check the court drawn back over the picture, save.

    python -m setme_vision.mark ~/Documents/setme-test-video

Opens http://127.0.0.1:8766 (only this computer can reach it). Saves <video>.court.json next to each video, used for
ball positions and in/out calls (and by --court in the rally finder).
"""
import argparse
import json
import threading
import webbrowser
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import cv2
import numpy as np

from . import court

PAGE = Path(__file__).with_name('mark.html')
VIDEO_EXT = ('.mov', '.mp4', '.m4v')
LOCK = threading.Lock()


def videos(folder):
    return sorted(p for p in Path(folder).iterdir() if p.suffix.lower() in VIDEO_EXT and not p.name.startswith('.'))


@lru_cache(maxsize=16)
def frame_jpeg(path, t):
    with LOCK:
        cap = cv2.VideoCapture(path)
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        cap.release()
    return cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 88])[1].tobytes() if ok else None


def info(video):
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    out = {'name': video.name, 'width': int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), 'height': int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
           'duration': round(cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps, 1), 'marks': None, 't': None}
    cap.release()
    f = court.court_file(video)
    if f.exists():
        d = json.loads(f.read_text())
        out['marks'], out['t'] = d.get('marks'), d.get('frame_t')
    return out


def fit(marks, size):
    """marks -> what the page shows: the whole court drawn through the marks, and how exact it is."""
    c = court.Court({n: tuple(v) for n, v in marks.items()})
    lines = []
    for a, b in court.LINES:
        pts = c.image(np.linspace(a, b, 24))
        lines.append([[round(x, 1), round(y, 1)] for x, y in pts])
    w, h = size
    def blur_at(spot):
        px = c.image([spot])[0]
        return round(c.blur(px), 2) if 0 <= px[0] < w and 0 <= px[1] < h else None
    return c, {'lines': lines, 'error': round(c.error, 1),
               'blur': {'near end line': blur_at((4.5, 0)), 'net': blur_at((4.5, 9)), 'far end line': blur_at((4.5, 18))}}


def handler(folder):
    vids = {v.name: v for v in videos(folder)}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body, kind='application/json'):
            if isinstance(body, (dict, list)):
                body = json.dumps(body).encode()
            self.send_response(code)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            u = urlparse(self.path)
            if u.path == '/':
                return self.send(200, PAGE.read_bytes(), 'text/html; charset=utf-8')
            if u.path == '/api/videos':
                return self.send(200, {'videos': [info(v) for v in vids.values()], 'points': court.POINTS, 'lines': court.LINES})
            if u.path.startswith('/frame/'):
                v = vids.get(unquote(u.path[len('/frame/'):]))
                t = float(parse_qs(u.query).get('t', ['60'])[0])
                body = v and frame_jpeg(str(v), round(max(0.0, t), 1))
                return self.send(200, body, 'image/jpeg') if body else self.send(404, {'error': 'no frame'})
            self.send(404, {'error': 'not found'})

        def do_POST(self):
            path = urlparse(self.path).path
            try:
                body = json.loads(self.rfile.read(min(int(self.headers.get('Content-Length', 0)), 100_000)))
                v = vids.get(body.get('video'))
                if v is None:
                    raise ValueError('unknown video')
                marks = body.get('marks') or {}
                if not all(n in court.POINTS and isinstance(p, list) and len(p) == 2 for n, p in marks.items()):
                    raise ValueError('bad marks')
                size = (body.get('width') or 1920, body.get('height') or 1080)
                c, shown = fit(marks, size)
                if path == '/api/save':
                    c.save(v, body.get('t'))
                    shown['saved'] = True
                elif path != '/api/fit':
                    return self.send(404, {'error': 'not found'})
                return self.send(200, shown)
            except (ValueError, json.JSONDecodeError, cv2.error) as e:
                return self.send(400, {'error': str(e)})
    return H


def serve(folder, port=8766, open_browser=True):
    folder = Path(folder).expanduser()
    srv = ThreadingHTTPServer(('127.0.0.1', port), handler(folder))
    url = f'http://127.0.0.1:{srv.server_address[1]}/'
    print(f'{len(videos(folder))} videos. Open {url}  (Ctrl+C to stop)')
    if open_browser:
        webbrowser.open(url)
    return srv


def main(argv=None):
    ap = argparse.ArgumentParser(prog='setme_vision.mark')
    ap.add_argument('folder', help='the folder with the game videos')
    ap.add_argument('--port', type=int, default=8766)
    a = ap.parse_args(argv)
    srv = serve(a.folder, a.port)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')


if __name__ == '__main__':
    main()
