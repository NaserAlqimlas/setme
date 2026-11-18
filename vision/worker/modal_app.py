"""The video worker on Modal (modal.com): SetMe calls `start`, which checks the signature and hands the job to
`analyse` in the background, then answers straight away.

One-time setup, from the vision folder (see vision/README.md, "Game videos"):

    pip install modal && modal setup
    modal secret create setme-video VIDEO_WORKER_SECRET=<the same value as in Netlify>
    modal deploy worker/modal_app.py

`modal deploy` prints the start URL: put it in Netlify as MODAL_VIDEO_URL. The same URL starts highlight reels
(kind: 'reel'); redeploy after pulling changes to the worker.
"""
from __future__ import annotations

import modal

app = modal.App('setme-video')

image = (
    modal.Image.debian_slim(python_version='3.12')
    .apt_install('ffmpeg')
    .pip_install('opencv-python-headless>=4.10', 'numpy>=2.0', 'fastapi[standard]')
    .add_local_python_source('setme_vision', 'worker')
)
secret = modal.Secret.from_name('setme-video')

with image.imports():
    from fastapi import HTTPException, Request


# 4 cores and 8 GB: about 10 minutes for a 20-minute game, about $0.05. An hour at most, then SetMe marks it failed.
@app.function(image=image, secrets=[secret], cpu=4, memory=8192, timeout=3600)
def analyse(job: str, source: str, viewing: str, callback: str):
    from worker.job import run
    run(job, source, viewing, callback)


# A highlight reel made into one file (worker/reel.py): a few minutes of 720p clips, 2 cores is plenty.
@app.function(image=image, secrets=[secret], cpu=2, memory=4096, timeout=1800)
def reel(reel_id: str, clips: list, output: str, callback: str):
    from worker.reel import run_reel
    run_reel(reel_id, clips, output, callback)


# Sound scores for a video analysed before they existed: reads only the sound of its viewing copy, a minute or so.
@app.function(image=image, secrets=[secret], cpu=1, memory=2048, timeout=1800)
def sound(job: str, source: str, callback: str):
    from worker.job import run_sound
    run_sound(job, source, callback)


@app.function(image=image, secrets=[secret])
@modal.fastapi_endpoint(method='POST')
async def start(request: Request):
    import json
    import os
    from worker.job import verify
    body = await request.body()
    if not verify(body, request.headers, os.environ['VIDEO_WORKER_SECRET']):
        raise HTTPException(status_code=401, detail='Not signed')
    j = json.loads(body)
    if j.get('kind') == 'sound':
        await sound.spawn.aio(j['job'], j['source'], j['callback'])
    elif j.get('kind') == 'reel':
        await reel.spawn.aio(j['reel'], j['clips'], j['output'], j['callback'])
    else:
        await analyse.spawn.aio(j['job'], j['source'], j['viewing'], j['callback'])
    return {'ok': True}
