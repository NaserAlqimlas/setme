"""Sound scores: a cheer after quiet play stands out; steady noise doesn't; a whole job carries them."""
import subprocess

import numpy as np

from worker.job import run_sound
from worker.sound import KEEP, RATE, lift, sound_track
from tests.test_worker import Notes, Storage, storage  # noqa: F401 (the fixture)


def test_a_cheer_stands_out_and_steady_noise_does_not():
    rng = np.random.default_rng(1)
    x = rng.normal(0, 0.02, RATE * 90).astype(np.float32)          # 90 s of steady gym noise
    x[RATE * 50: RATE * 52] += rng.normal(0, 0.2, RATE * 2).astype(np.float32)   # a 2-second cheer at 50 s
    v = lift(x)
    assert v[int(51 / 0.1)] > 15                                     # about 20 dB over the noise around it
    assert abs(np.median(v)) < 1                                     # the rest is level


def test_a_short_smack_counts_for_less_than_a_cheer():
    rng = np.random.default_rng(2)
    base = rng.normal(0, 0.02, RATE * 60).astype(np.float32)
    smack, cheer = base.copy(), base.copy()
    smack[RATE * 30: RATE * 30 + RATE // 20] += rng.normal(0, 0.3, RATE // 20).astype(np.float32)   # 50 ms
    cheer[RATE * 30: RATE * 32] += rng.normal(0, 0.3, RATE * 2).astype(np.float32)                 # 2 s, as loud
    assert lift(cheer).max() > lift(smack).max() + 10


def test_from_a_video_link(tmp_path, storage):  # noqa: F811
    src = tmp_path / 'g.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=10:duration=60',
                    '-f', 'lavfi', '-i', 'anoisesrc=d=60:a=0.02', '-filter_complex', '[1:a]volume=enable=between(t\\,40\\,42):volume=12[a]',
                    '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-shortest', '-movflags', '+faststart', str(src)], check=True)
    Storage.files['/viewing/g.mp4'] = src.read_bytes()
    track = sound_track(f'{storage}/viewing/g.mp4')
    assert track['hop'] == KEEP and abs(len(track['lift']) - 120) <= 1
    loud = int(np.argmax(track['lift'])) * KEEP
    assert 39 <= loud <= 43 and max(track['lift']) > 100            # tenths of a dB
    notes = Notes()
    run_sound('j', f'{storage}/viewing/g.mp4', 'unused', report=notes)
    assert notes.sent[-1]['status'] == 'sound' and len(notes.sent[-1]['sound']['lift']) == len(track['lift'])


def test_no_sound_is_all_level(tmp_path, storage):  # noqa: F811
    src = tmp_path / 'quiet.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=10:duration=5',
                    '-c:v', 'libx264', '-preset', 'ultrafast', str(src)], check=True)
    Storage.files['/viewing/q.mp4'] = src.read_bytes()
    assert sound_track(f'{storage}/viewing/q.mp4')['lift'] == []
