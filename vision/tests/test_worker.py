"""The video worker: its signatures match SetMe's, and a whole job (download, 720p copy, rally times, upload, updates)
runs end to end against a stand-in for storage."""
import http.server
import json
import subprocess
import threading
from pathlib import Path

import pytest

from worker.job import run, sign, verify, viewing_command

# netlify/lib/video.mjs sign('{"job":"j"}', 'shh', 1800000000), so the two sides agree.
JS = 'b32d1b5e11b5ac177b2acc0da1c3f23479e2b56d557bc07557e8417df9527091'


def test_signatures_match_setme():
    assert sign(b'{"job":"j"}', 'shh', 1800000000)['x-setme-signature'] == JS
    h = sign(b'{"job":"j"}', 'shh', 1800000000)
    assert verify(b'{"job":"j"}', h, 'shh', now=1800000005)
    assert not verify(b'{"job":"j"}', h, 'shh', now=1800003600)
    assert not verify(b'{"job":"k"}', h, 'shh', now=1800000005)
    assert not verify(b'{"job":"j"}', h, '', now=1800000005)


def test_never_made_bigger():
    assert "min(720,ih)" in ' '.join(viewing_command(Path('a'), Path('b')))


class Storage(http.server.BaseHTTPRequestHandler):
    files = {}

    def do_GET(self):
        data = self.files.get(self.path)
        self.send_response(200 if data else 404)
        self.send_header('content-length', str(len(data or b'')))
        self.end_headers()
        self.wfile.write(data or b'')

    def do_PUT(self):
        self.files[self.path] = self.rfile.read(int(self.headers['content-length']))
        self.send_response(200)
        self.end_headers()

    def log_message(self, *a):
        pass


class Notes:
    def __init__(self):
        self.sent = []

    def send(self, **f):
        self.sent.append(f)

    def progress(self, p):
        self.sent.append({'status': 'processing', 'progress': p})


@pytest.fixture
def storage(tmp_path):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Storage)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f'http://127.0.0.1:{srv.server_port}'
    srv.shutdown()


def test_a_whole_job(tmp_path, storage):
    src = tmp_path / 'game.mov'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=3',
                    '-f', 'lavfi', '-i', 'sine=duration=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-shortest', str(src)], check=True)
    Storage.files['/originals/j/game.mov'] = src.read_bytes()
    notes = Notes()
    run('j', f'{storage}/originals/j/game.mov', f'{storage}/viewing/j.mp4', 'unused', report=notes)
    assert notes.sent[-1]['status'] == 'done', notes.sent[-1]
    assert all(r['end'] > r['start'] for r in notes.sent[-1]['result']['rallies'])   # the test pattern's yellow shapes may count
    assert any(n['status'] == 'processing' for n in notes.sent)
    out = tmp_path / 'out.mp4'
    out.write_bytes(Storage.files['/viewing/j.mp4'])
    info = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(out)], capture_output=True, text=True).stdout)
    video = next(s for s in info['streams'] if s['codec_type'] == 'video')
    assert (video['codec_name'], video['height'], video['width']) == ('h264', 720, 1280)
    assert out.read_bytes().find(b'moov') < out.read_bytes().find(b'mdat')   # plays before it's all downloaded


def test_an_unreadable_upload_says_so(tmp_path, storage):
    Storage.files['/originals/k/x.mov'] = b'not a video at all'
    notes = Notes()
    run('k', f'{storage}/originals/k/x.mov', f'{storage}/viewing/k.mp4', 'unused', report=notes)
    assert notes.sent[-1] == {'status': 'failed', 'error': "The video couldn't be read. Export it again as MP4 (or MOV) and upload that."}
    assert '/viewing/k.mp4' not in Storage.files


def test_hdr_is_tone_mapped(tmp_path):
    """An iPhone-style HDR (HLG, BT.2020, 10-bit) clip comes out as ordinary BT.709 8-bit, not washed out."""
    from worker.job import is_hdr, make_viewing
    hdr, sdr, out = tmp_path / 'hdr.mov', tmp_path / 'sdr.mp4', tmp_path / 'out.mp4'
    base = ['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=1']
    subprocess.run(base + ['-pix_fmt', 'yuv420p10le', '-c:v', 'libx265', '-tag:v', 'hvc1',
                           '-x265-params', 'colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:log-level=error', str(hdr)], check=True)
    subprocess.run(base + ['-pix_fmt', 'yuv420p', '-c:v', 'libx264', str(sdr)], check=True)
    assert is_hdr(hdr) and not is_hdr(sdr)
    assert 'tonemap' in ' '.join(viewing_command(hdr, out, hdr=True))
    assert 'tonemap' not in ' '.join(viewing_command(sdr, out))
    make_viewing(hdr, out, 1.0)
    s = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', str(out)],
                                  capture_output=True, text=True).stdout)['streams'][0]
    assert (s['pix_fmt'], s.get('color_transfer'), s.get('color_primaries')) == ('yuv420p', 'bt709', 'bt709')
