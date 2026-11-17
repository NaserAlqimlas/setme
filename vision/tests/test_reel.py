"""Highlight reels made into one file: clips cut from two games (one filmed sideways and silent) come out alike and
joined, and SetMe is told how it went (signed with `reel`)."""
import json
import subprocess

from worker.job import Reporter
from worker.reel import run_reel
from tests.test_worker import Notes, Storage, storage  # noqa: F401 (the fixture)


def make(path, size, sound):
    cmd = ['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', f'testsrc2=size={size}:rate=30:duration=8']
    if sound:
        cmd += ['-f', 'lavfi', '-i', 'sine=duration=8', '-shortest']
    subprocess.run([*cmd, '-c:v', 'libx264', '-preset', 'ultrafast', '-movflags', '+faststart', str(path)], check=True)
    return path.read_bytes()


def probe(path):
    return json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)],
                                     capture_output=True, text=True).stdout)


def test_a_whole_reel(tmp_path, storage):  # noqa: F811
    Storage.files['/viewing/a.mp4'] = make(tmp_path / 'a.mp4', '1280x720', True)
    Storage.files['/viewing/b.mp4'] = make(tmp_path / 'b.mp4', '720x1280', False)
    notes = Notes()
    clips = [{'source': f'{storage}/viewing/a.mp4', 'start': 1, 'end': 3},
             {'source': f'{storage}/viewing/b.mp4', 'start': 2, 'end': 5},
             {'source': f'{storage}/viewing/a.mp4', 'start': 5, 'end': 7}]
    run_reel('r', clips, f'{storage}/reels/r.mp4', 'unused', report=notes)
    assert notes.sent[-1] == {'status': 'done'}, notes.sent[-1]
    out = tmp_path / 'reel.mp4'
    out.write_bytes(Storage.files['/reels/r.mp4'])
    info = probe(out)
    video = next(s for s in info['streams'] if s['codec_type'] == 'video')
    assert (video['width'], video['height']) == (1280, 720)
    assert any(s['codec_type'] == 'audio' for s in info['streams'])
    assert abs(float(info['format']['duration']) - 7) < 0.6, info['format']['duration']
    assert out.read_bytes().find(b'moov') < out.read_bytes().find(b'mdat')


def test_a_missing_game_video_says_so(tmp_path, storage):  # noqa: F811
    notes = Notes()
    run_reel('s', [{'source': f'{storage}/viewing/gone.mp4', 'start': 0, 'end': 2}], f'{storage}/reels/s.mp4', 'unused', report=notes)
    assert notes.sent[-1]['status'] == 'failed' and notes.sent[-1]['error'].startswith('Clip 1')
    assert '/reels/s.mp4' not in Storage.files


def test_reports_say_reel():
    sent = []
    Reporter('x', 'r1', 'shh', post=lambda body, headers: sent.append(json.loads(body)), key='reel').send(status='done')
    assert sent == [{'reel': 'r1', 'status': 'done'}]
