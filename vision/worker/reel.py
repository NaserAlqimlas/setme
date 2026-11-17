"""A highlight reel made into one video file: cut each clip from its game's viewing copy, make them all alike
(720p, 30 fps, H.264 and stereo AAC), join them, and upload the file. Like job.py, it only gets links (one to read
each game's copy, one to write the file) and a callback, and tells SetMe how it's going (signed, with `reel`).

    python -m worker.reel <clips.json> <output put url> <callback url> <reel id>    (with VIDEO_WORKER_SECRET set)
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from worker.job import Reporter, upload

WIDTH, HEIGHT, FPS = 1280, 720, 30


def has_audio(source: str) -> bool:
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', source],
                         capture_output=True, text=True, timeout=120)
    return bool(out.stdout.strip())


def clip_command(source: str, start: float, end: float, dest: Path, audio: bool):
    """One clip, seeking in the link (the viewing copies have their index at the front, so only the clip is read).
    Letterboxed to 1280x720 so clips from different phones join cleanly; silence added if the game has no sound."""
    cmd = ['ffmpeg', '-y', '-v', 'error', '-ss', f'{max(start, 0):.3f}', '-to', f'{end:.3f}', '-i', source]
    if not audio:
        cmd += ['-f', 'lavfi', '-t', f'{end - start:.3f}', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000']
    cmd += ['-vf', f'scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2,fps={FPS},format=yuv420p',
            '-map', '0:v:0', '-map', '0:a:0' if audio else '1:a:0',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
            '-shortest', str(dest)]
    return cmd


def join_command(listing: Path, dest: Path):
    return ['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', str(listing), '-c', 'copy', '-movflags', '+faststart', str(dest)]


def run_reel(reel, clips, output, callback, secret=None, work=None, report=None):
    """The whole reel. Never raises: SetMe is told done or failed. clips: [{ source, start, end }]."""
    report = report or Reporter(callback, reel, secret or os.environ['VIDEO_WORKER_SECRET'], key='reel')
    with tempfile.TemporaryDirectory(dir=work) as tmp:
        tmp = Path(tmp)
        try:
            report.send(status='processing', progress=0)
            sound = {}
            parts = []
            for i, c in enumerate(clips):
                src = c['source']
                if src not in sound:
                    sound[src] = has_audio(src)
                part = tmp / f'clip{i:04d}.mp4'
                out = subprocess.run(clip_command(src, float(c['start']), float(c['end']), part, sound[src]), capture_output=True, text=True)
                if out.returncode or not part.exists():
                    raise RuntimeError(f"Clip {i + 1} couldn't be cut: {out.stderr.strip().splitlines()[-1] if out.stderr.strip() else 'ffmpeg failed'}")
                parts.append(part)
                report.progress(0.9 * (i + 1) / len(clips))
            listing = tmp / 'clips.txt'
            listing.write_text(''.join(f"file '{p}'\n" for p in parts))
            final = tmp / 'reel.mp4'
            out = subprocess.run(join_command(listing, final), capture_output=True, text=True)
            if out.returncode:
                raise RuntimeError(f"The clips couldn't be joined: {out.stderr.strip().splitlines()[-1] if out.stderr.strip() else 'ffmpeg failed'}")
            upload(output, final)
            report.send(status='done')
        except Exception as e:
            msg = str(e) if isinstance(e, (ValueError, RuntimeError)) else f'Something went wrong while making the file ({type(e).__name__}). Try again.'
            print(f'reel {reel} failed: {e!r}', file=sys.stderr)
            report.send(status='failed', error=msg[:300])


if __name__ == '__main__':
    run_reel(sys.argv[4], json.loads(Path(sys.argv[1]).read_text()), sys.argv[2], sys.argv[3])
