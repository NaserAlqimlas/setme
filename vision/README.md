# SetMe vision: rally times from game video

Finds when each rally starts and ends in a game video, so taggers can jump from rally to rally on the tag screen
instead of scrubbing through the time between. It runs on your computer; the video never leaves it.

Works for a camera that doesn't move (a phone on a tripod or propped up), anywhere it can see the court. It spots
the club's yellow-and-blue ball by its colour.

**How well it works:** checked against seven games tagged in SetMe (342 rallies, two gyms, several camera spots),
with the same settings for all: 279 found (82%), and about 10 stretches per game that weren't rallies (mostly the ball
thrown back to the server). The settings were tuned on two of the games; on the five it never saw it found 205 of 255
(80%). Each jump lands about 3 seconds before the serve. It reads a 20-minute iPhone video in about 3 minutes on an M1
laptop.

| Game | Found | Missed | Extra | |
|---|---|---|---|---|
| IMG_5276 | 34 of 37 | 3 | 6 | tuned on |
| IMG_5289 | 40 of 50 | 10 | 10 | tuned on |
| IMG_5277 | 36 of 41 | 5 | 13 | |
| IMG_5278 | 24 of 46 | 22 | 2 | camera tilted down: the frame ends just above the net |
| IMG_5279 | 35 of 37 | 2 | 7 | |
| IMG_5290 | 37 of 48 | 11 | 10 | |
| IMG_0300 | 73 of 83 | 10 | 21 | |

**Filming tip:** keep plenty of room above the net in the frame. The ball spends most of a rally up there; a camera
tilted down (IMG_5278) loses it and misses half the rallies.

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
which would do better. Give it a folder instead of a video to check every tagged video in it with the current
settings and get the table above. The first run reads the video; later runs reuse what it saw (`game.candidates-*.pkl`).

## How it works

1. **detect.py**: blobs of the ball's yellow (hue around 24, saturated) that are moving and at least ball-sized are
   candidates, at full resolution since the ball can be only a few pixels across. Lime shirts and pale wood are
   close in colour, which is why the range is tight and the edges of a shirt (small blobs) don't count. (With
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
