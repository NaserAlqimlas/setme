"""One video job, start to finish: download the upload, make the 720p copy people watch, find the rally times, and
tell SetMe how it's going. Runs on Modal (modal_app.py) but needs nothing from it, so it can be run and tested here:

    python -m worker.job <source url> <viewing put url> <callback url> <job id>    (with VIDEO_WORKER_SECRET set)

SetMe only ever hands this two links (one to read the upload, one to write the copy) and a callback address; the
worker has no database or storage keys. Its messages are signed with VIDEO_WORKER_SECRET, as netlify/lib/video.mjs
checks them.
"""
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

VIEW_HEIGHT = 720


def sign(body: bytes, secret: str, now: int = None) -> dict:
    now = int(time.time()) if now is None else now
    sig = hmac.new(secret.encode(), f'{now}.'.encode() + body, hashlib.sha256).hexdigest()
    return {'x-setme-time': str(now), 'x-setme-signature': sig}


def verify(body: bytes, headers, secret: str, now: float = None, slack: int = 600) -> bool:
    now = time.time() if now is None else now
    try:
        t = int(headers.get('x-setme-time', ''))
    except ValueError:
        return False
    got = headers.get('x-setme-signature', '')
    return bool(secret) and abs(now - t) <= slack and hmac.compare_digest(got, sign(body, secret, t)['x-setme-signature'])


class Reporter:
    """Posts signed updates to SetMe; progress at most every 10 seconds. A failed post is retried on the next one."""
    def __init__(self, callback, job, secret, post=None, key='job'):
        self.callback, self.job, self.secret, self.last, self.key = callback, job, secret, 0.0, key
        self.post = post or self._post

    def _post(self, body: bytes, headers: dict):
        req = urllib.request.Request(self.callback, data=body, method='POST', headers={'content-type': 'application/json', **headers})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status

    def send(self, **fields):
        body = json.dumps({self.key: self.job, **fields}).encode()
        for attempt in range(3):
            try:
                return self.post(body, sign(body, self.secret))
            except Exception as e:                      # SetMe briefly unreachable: the end result matters most
                print(f'update not sent ({e})', file=sys.stderr)
                time.sleep(2 * (attempt + 1) if fields.get('status') != 'processing' else 0)
                if fields.get('status') == 'processing':
                    return None

    def progress(self, p):
        if time.time() - self.last >= 10:
            self.last = time.time()
            self.send(status='processing', progress=round(min(max(p, 0), 1), 3))


def download(url, dest: Path, on_progress=None):
    with urllib.request.urlopen(url, timeout=60) as r, open(dest, 'wb') as f:
        total, got = int(r.headers.get('content-length') or 0), 0
        while chunk := r.read(8 * 1024 * 1024):
            f.write(chunk)
            got += len(chunk)
            if on_progress and total:
                on_progress(got / total)


def upload(url, path: Path):
    """PUT the file to the signed link (one request: R2 takes up to 5 GB that way; a viewing copy is well under)."""
    size = path.stat().st_size
    with open(path, 'rb') as f:
        req = urllib.request.Request(url, data=f, method='PUT', headers={'content-type': 'video/mp4', 'content-length': str(size)})
        with urllib.request.urlopen(req, timeout=600) as r:
            if r.status >= 300:
                raise RuntimeError(f'storage said {r.status}')


def probe(path: Path) -> float:
    """The video's length in seconds, or raises with a message for people when it can't be read."""
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'format=duration',
                          '-of', 'json', str(path)], capture_output=True, text=True)
    try:
        d = float(json.loads(out.stdout)['format']['duration'])
    except (KeyError, ValueError, json.JSONDecodeError):
        d = 0
    if out.returncode or d <= 0:
        raise ValueError("The video couldn't be read. Export it again as MP4 (or MOV) and upload that.")
    return d


HDR_TRANSFERS = ('smpte2084', 'arib-std-b67')   # PQ (HDR10, Dolby Vision) and HLG (iPhone HDR video)


def is_hdr(path: Path) -> bool:
    """Was it filmed in HDR (an iPhone's default)? Then its colours need turning into ordinary (SDR) ones."""
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_transfer',
                          '-of', 'json', str(path)], capture_output=True, text=True)
    try:
        return json.loads(out.stdout)['streams'][0].get('color_transfer') in HDR_TRANSFERS
    except (KeyError, IndexError, json.JSONDecodeError):
        return False


# HDR to ordinary colour: to linear light, to BT.709 primaries, tone mapped (hable keeps highlights from blowing
# out), back to BT.709. Squeezing HDR into 8 bits without this is what made a video come out washed out and too bright.
TONEMAP = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,'


def viewing_command(src: Path, dest: Path, hdr: bool = False):
    """720p H.264 with the index at the front (faststart), so it starts playing before it's all downloaded and any
    phone or browser plays it. HDR phone video is tone mapped to ordinary 8-bit colour, and the copy is labelled
    BT.709 so players don't guess. Never made bigger than it was."""
    return ['ffmpeg', '-y', '-v', 'error', '-i', str(src),
            '-vf', f"{TONEMAP if hdr else ''}scale=-2:'min({VIEW_HEIGHT},ih)',format=yuv420p",
            '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-profile:v', 'high',
            '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
            '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', str(dest)]


def make_viewing(src: Path, dest: Path, duration: float, on_progress=None, hdr: bool = None):
    """The copy to watch. An HDR video whose tone mapping fails (an ffmpeg without zscale) is made the old way."""
    if hdr is None:
        hdr = is_hdr(src)
    p = subprocess.Popen(viewing_command(src, dest, hdr), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    for line in p.stdout:
        m = re.match(r'out_time_us=(\d+)', line)
        if m and on_progress:
            on_progress(int(m.group(1)) / 1e6 / duration)
    err = p.stderr.read()
    if p.wait():
        if hdr:
            print(f'tone mapping failed, making the copy without it: {err.strip()[-300:]}', file=sys.stderr)
            return make_viewing(src, dest, duration, on_progress, hdr=False)
        raise RuntimeError(f"The copy to watch couldn't be made: {err.strip().splitlines()[-1] if err.strip() else 'ffmpeg failed'}")


def find_rallies(src: Path, on_progress=None) -> dict:
    """The rally finder, as python -m setme_vision runs it (club's yellow ball, whole frame) -> game.rallies.json."""
    import cv2
    from setme_vision.__main__ import find, result
    from setme_vision.detect import make
    from setme_vision.segment import Settings
    cap = cv2.VideoCapture(str(src))
    if not cap.isOpened():
        raise ValueError("The video couldn't be read. Export it again as MP4 (or MOV) and upload that.")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    size = (int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
    duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps
    rallies, _, s = find(cap, fps, max(1, round(fps / 30)), make('yellow', size), duration, s=Settings(),
                         on_progress=(lambda t: on_progress(t / duration)) if on_progress and duration else None)
    return result(src.name, duration, s, rallies)


def run(job, source, viewing, callback, secret=None, work=None, report=None):
    """The whole job. Never raises: whatever happens, SetMe is told (done or failed)."""
    report = report or Reporter(callback, job, secret or os.environ['VIDEO_WORKER_SECRET'])
    with tempfile.TemporaryDirectory(dir=work) as tmp:
        tmp = Path(tmp)
        src, out = tmp / 'original', tmp / 'viewing.mp4'
        try:
            report.send(status='processing', progress=0)
            # Downloading is the first 10%; then the copy and the rallies are made side by side (both read the
            # original), and the slower of the two sets the pace.
            download(source, src, lambda p: report.progress(0.1 * p))
            duration = probe(src)
            share = {'copy': 0.0, 'rallies': 0.0}
            def step(part):
                def f(p):
                    share[part] = min(max(p, 0), 1)
                    report.progress(0.1 + 0.85 * min(share.values()))
                return f
            found, problem = {}, []
            def rallies():
                try:
                    found.update(find_rallies(src, step('rallies')))
                except Exception as e:
                    problem.append(e)
            t = threading.Thread(target=rallies)
            t.start()
            make_viewing(src, out, duration, step('copy'))
            t.join()
            # The sound after each rally, for highlight suggestions. Nice to have: a failure here changes nothing else.
            try:
                from worker.sound import sound_track
                sound = sound_track(str(src))
            except Exception as e:
                print(f'sound scores failed: {e!r}', file=sys.stderr)
                sound = None
            upload(viewing, out)
            if problem:
                # The copy to watch is what matters most; no rally times just means tagging without Next rally.
                print(f'rally finder failed: {problem[0]}', file=sys.stderr)
                found = {'version': 1, 'video': src.name, 'duration': round(duration, 2), 'rallies': [], 'note': 'rally finder failed'}
            if sound:
                found['sound'] = sound
            report.send(status='done', viewing=True, result=found)
        except Exception as e:
            msg = str(e) if isinstance(e, (ValueError, RuntimeError)) else f'Something went wrong while analysing ({type(e).__name__}). Try again.'
            print(f'job {job} failed: {e!r}', file=sys.stderr)
            report.send(status='failed', error=msg[:300])


def run_sound(job, source, callback, secret=None, report=None):
    """Sound scores for a video already analysed (made before they existed), from its viewing copy. Never raises."""
    from worker.sound import sound_track
    report = report or Reporter(callback, job, secret or os.environ['VIDEO_WORKER_SECRET'])
    try:
        report.send(status='sound', sound=sound_track(source))
    except Exception as e:
        print(f'sound for {job} failed: {e!r}', file=sys.stderr)


if __name__ == '__main__':
    run(*sys.argv[1:5])
