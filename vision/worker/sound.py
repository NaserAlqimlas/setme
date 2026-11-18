"""How much louder it gets, moment to moment, than the sound around it: players reacting to a point. SetMe suggests
highlights and bloopers from it (site/js/suggest.mjs), by looking just after each rally ends.

Sound is read at 8 kHz mono, measured every 0.1 s, smoothed over a second (cheering lasts, a ball smack doesn't),
and compared with the median of the 40 seconds around it. The result is kept every 0.5 s, in tenths of a dB, so a
20-minute game is about 2,400 small numbers in the job's result.
"""
import subprocess

import numpy as np

RATE, FRAME, SMOOTH, AROUND, KEEP = 8000, 0.1, 1.0, 40.0, 0.5


def lift(samples: np.ndarray) -> np.ndarray:
    """dB above the surrounding sound, one value per FRAME."""
    n = int(RATE * FRAME)
    frames = samples[: len(samples) // n * n].reshape(-1, n).astype(np.float64)
    if not len(frames):
        return np.zeros(0)
    power = (frames ** 2).mean(1) + 1e-10
    k = int(SMOOTH / FRAME)
    db = 10 * np.log10(np.convolve(power, np.ones(k) / k, mode='same'))
    w = int(AROUND / FRAME)
    pad = np.pad(db, (w // 2, w - w // 2 - 1), mode='edge')
    base = np.median(np.lib.stride_tricks.sliding_window_view(pad, w), axis=1)[: len(db)]
    return db - base


def sound_track(source: str) -> dict:
    """{ hop, lift: [tenths of a dB, every hop seconds] } for a file or a link. Silent or soundless: all zeros."""
    out = subprocess.run(['ffmpeg', '-v', 'error', '-i', source, '-vn', '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'],
                         capture_output=True, timeout=1800)
    x = np.frombuffer(out.stdout, np.float32) if out.returncode == 0 else np.zeros(0, np.float32)
    v = lift(x)
    step = int(KEEP / FRAME)
    kept = [v[i: i + step].max() for i in range(0, len(v), step)]
    return {'version': 1, 'hop': KEEP, 'lift': [int(round(max(min(d, 60), -60) * 10)) for d in kept]}
