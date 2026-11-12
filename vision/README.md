# SetMe vision: rally times from game video

Finds when each rally starts and ends in a game video, so taggers can jump from rally to rally on the tag screen
instead of scrubbing through the time between. It runs on your computer; the video never leaves it.

Works for a camera that doesn't move (a phone on a tripod or propped up), anywhere it can see the court. It spots
the club's yellow-and-blue ball by its colour.

**How well it works:** on a 20-minute game tagged in SetMe (37 rallies) it found all 37, split one in two, and added
3 stretches that weren't rallies (the ball thrown back to the server). Each jump lands about 2 seconds before the serve.
It reads a 20-minute iPhone video in under 3 minutes on an M1 laptop.

## Set up (once)

```sh
cd vision
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Use

```sh
cd vision
.venv/bin/python -m setme_vision ~/Movies/game.mp4
```

- It writes `game.rallies.json` next to the video.
- If another court (with another yellow ball) is in view, add `--court`: a window shows one frame, click the court's
  corners in order (near left, near right, far right, far left) and press Enter. They're saved as `game.court.json`
  next to the video; copy that file next to the next video from the same spot to skip this step.
- A different ball: `--ball motion` looks for anything small that moves instead of the yellow colour (less accurate).
- On the tag screen: open the video, then **Load rally times** and pick that file. **Next rally** (or N) jumps to
  the next rally's serve; Shift N goes back.
- YouTube videos: download the file first (for example with `yt-dlp`), then run it on the file.

## Checking what it saw

`--preview` also writes `game.preview.mp4` with the search area outlined and a green circle on everything it took
for the ball. `--start 600 --stop 720` runs on minutes 10 to 12 only, for quick tries.

If rallies are split in two, raise `--gap` (seconds the ball can be lost within a rally, default 3). If dead time
counts as rallies, raise `--min-speed` (default 0.5) or `--min-len` (default 2 seconds).

## Checking against a tagged game

The real test is a game already tagged in SetMe. In the Supabase SQL Editor, run (with the game's video file name):

```sql
select r.seq, r.won_by, coalesce(min(t.video_t), r.video_t) as first_touch, max(t.video_t) as last_touch
from rallies r join games g on g.id = r.game_id left join touches t on t.rally_id = r.id
where g.video_ref = 'IMG_5276.MOV'
group by r.id order by r.seq;
```

Download the result as CSV, then:

```sh
.venv/bin/python -m setme_vision.evaluate ~/Movies/game.mp4 tags.csv
```

It says how many tagged rallies were found, missed, or found where there was none, and tries other settings to show
which would do better. The first run reads the video; later runs reuse what it saw (`game.candidates-*.pkl`).

## How it works

1. **detect.py**: the club's ball is the only strong yellow in the gym, so yellow blobs are ball candidates. (With
   `--ball motion`: the camera is still, so small, roundish things that move stand out from the background.)
2. **track.py**: candidates are linked frame to frame. Between touches a ball in the air follows a smooth curve, so
   a *flight* is a stretch that fits one closely and moves fast enough. Hands, heads and noise don't; a ball held,
   bounced or rolled back is too slow.
3. **segment.py**: flights less than 3 seconds apart are one rally (the ball disappears behind players). A rally
   needs at least one fast, rising flight (a serve or a hit). A little time is kept before the first flight for the
   serve toss.

Tests: `.venv/bin/python -m pytest tests` (they make a short test video and check the rallies found in it).

Next steps: more tagged games to check against (different days, light and camera spots), then in/out calls, which
need the court lines mapped to real distances and the moment the ball touches the floor.
