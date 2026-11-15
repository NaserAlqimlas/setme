"""The review page for ball labels: check the proposed boxes quickly, fix the wrong ones, mark frames with no ball.

    python -m setme_vision.review ~/Documents/setme-test-video/labels

Opens http://127.0.0.1:8765 in the browser. Only this computer can reach it. Every answer is saved to labels.json
straight away, so closing the page loses nothing.
"""
import argparse
import json
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import cv2

from .labels import load, save

PAGE = Path(__file__).with_name('review.html')
STATUSES = ('pending', 'ok', 'moved', 'no-ball', 'skip')


class Store:
    """labels.json in memory, written back after every change."""
    def __init__(self, folder):
        self.folder = Path(folder).expanduser()
        self.data = load(self.folder)
        self.by_id = {it['id']: it for it in self.data['items']}
        self.lock = threading.Lock()

    def update(self, changes):
        """changes: [{id, status, box?, check?}] -> the updated items. Unknown ids and bad values are refused."""
        out = []
        with self.lock:
            for c in changes:
                it = self.by_id.get(c.get('id'))
                if it is None or c.get('status') not in STATUSES:
                    raise ValueError(f"bad change: {c.get('id')!r} {c.get('status')!r}")
                if 'box' in c:
                    b = c['box']
                    if b is not None and not (isinstance(b, list) and len(b) == 4 and all(isinstance(v, (int, float)) for v in b)
                                              and 0 <= b[0] <= it['width'] and 0 <= b[1] <= it['height'] and 2 <= b[2] <= 400 and 2 <= b[3] <= 400):
                        raise ValueError(f"bad box for {it['id']}")
                    it['box'] = None if b is None else [round(float(v), 1) for v in b]
                if c['status'] in ('ok', 'moved') and not it['box']:
                    raise ValueError(f"{it['id']} has no box to accept")
                it['status'] = c['status']
                if 'check' in c:
                    it['check'] = bool(c['check'])
                out.append(it)
            save(self.folder, self.data)
        return out


def crop(store, item, size):
    """A square around the box (or the middle), zoomed to size px, with the box outlined, as JPEG bytes."""
    img = cv2.imread(str(store.folder / 'frames' / f"{item['id']}.jpg"))
    if img is None:
        return None
    h, w = img.shape[:2]
    cx, cy, bw, bh = item['box'] or (w / 2, h / 2, 40, 40)
    side = int(max(96, 5 * max(bw, bh)))
    x0, y0 = int(min(max(0, cx - side / 2), max(0, w - side))), int(min(max(0, cy - side / 2), max(0, h - side)))
    part = img[y0:y0 + side, x0:x0 + side].copy()
    if item['box']:
        r = max(bw, bh) / 2 + 3
        cv2.circle(part, (int(cx - x0), int(cy - y0)), int(r), (255, 0, 255), 1, cv2.LINE_AA)
    part = cv2.resize(part, (size, size), interpolation=cv2.INTER_NEAREST if side < size else cv2.INTER_AREA)
    return cv2.imencode('.jpg', part, [cv2.IMWRITE_JPEG_QUALITY, 88])[1].tobytes()


def handler(store):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body, kind='application/json'):
            if isinstance(body, (dict, list)):
                body = json.dumps(body).encode()
            elif isinstance(body, str):
                body = body.encode()
            self.send_response(code)
            self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store' if kind == 'application/json' else 'max-age=3600')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            u = urlparse(self.path)
            if u.path == '/':
                return self.send(200, PAGE.read_bytes(), 'text/html; charset=utf-8')
            if u.path == '/api/items':
                return self.send(200, {'items': store.data['items']})
            parts = u.path.strip('/').split('/')
            if len(parts) == 2 and parts[0] in ('frames', 'crop') and parts[1].endswith('.jpg'):
                it = store.by_id.get(parts[1][:-4])
                if it is None:
                    return self.send(404, {'error': 'no such frame'})
                if parts[0] == 'frames':
                    p = store.folder / 'frames' / f"{it['id']}.jpg"
                    return self.send(200, p.read_bytes(), 'image/jpeg') if p.exists() else self.send(404, {'error': 'missing'})
                size = int(parse_qs(u.query).get('s', ['160'])[0])
                body = crop(store, it, max(64, min(480, size)))
                return self.send(200, body, 'image/jpeg') if body else self.send(404, {'error': 'missing'})
            self.send(404, {'error': 'not found'})

        def do_POST(self):
            if urlparse(self.path).path != '/api/update':
                return self.send(404, {'error': 'not found'})
            try:
                n = int(self.headers.get('Content-Length', 0))
                changes = json.loads(self.rfile.read(min(n, 2_000_000)))
                if not isinstance(changes, list):
                    raise ValueError('expected a list of changes')
                return self.send(200, {'items': store.update(changes)})
            except (ValueError, json.JSONDecodeError) as e:
                return self.send(400, {'error': str(e)})
    return H


def serve(folder, port=8765, open_browser=True):
    store = Store(folder)
    srv = ThreadingHTTPServer(('127.0.0.1', port), handler(store))
    url = f'http://127.0.0.1:{srv.server_address[1]}/'
    print(f"{len(store.data['items'])} frames. Open {url}  (Ctrl+C to stop)")
    if open_browser:
        webbrowser.open(url)
    return srv


def main(argv=None):
    ap = argparse.ArgumentParser(prog='setme_vision.review')
    ap.add_argument('folder', help='the labels folder made by setme_vision.labels propose')
    ap.add_argument('--port', type=int, default=8765)
    a = ap.parse_args(argv)
    srv = serve(a.folder, a.port)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped. Everything is saved in labels.json.')


if __name__ == '__main__':
    main()
