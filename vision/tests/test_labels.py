"""Training-data tools: picking frames, guessing the ball, the review server, and the YOLO export."""
import json
import threading
import urllib.request

import cv2
import numpy as np
import pytest

from setme_vision import labels, review
from setme_vision.detect import ColourBallDetector


def test_spread_keeps_times_apart_and_through_the_game():
    rng = np.random.default_rng(0)
    times = [i / 30 for i in range(30 * 600)]            # ten minutes of frames
    got = labels.spread(times, 50, rng)
    assert len(got) == 50
    assert all(b - a >= 0.5 for a, b in zip(got, got[1:]))
    assert got[0] < 60 and got[-1] > 540                  # from the start to the end, not bunched
    assert labels.spread([], 5, rng) == [] and labels.spread(times, 0, rng) == []


def test_guess_takes_the_blob_where_the_flight_says_and_refuses_one_far_away():
    boxes = [(100, 100, 20, 20), (500, 300, 18, 18)]
    assert labels.guess(boxes, (505 / 1080, 298 / 1080), 1080) == boxes[1]
    assert labels.guess(boxes, (900 / 1080, 900 / 1080), 1080) is None
    assert labels.guess(boxes, None, 1080) == boxes[0]   # no flight: the biggest
    assert labels.guess([], None, 1080) is None


def test_colour_boxes_are_the_ball_size():
    frame = np.full((1080, 1920, 3), 60, np.uint8)
    cv2.circle(frame, (700, 400), 10, (30, 210, 240), -1)   # the club's yellow, 21 px across
    det = ColourBallDetector((1920, 1080), moving=False)
    [(cx, cy, w, h)] = det.boxes(frame)
    assert (cx, cy) == pytest.approx((700, 400), abs=1)
    assert 17 <= w <= 25 and 17 <= h <= 25


def test_frames_at_reads_the_frames_asked_for(tmp_path):
    path = tmp_path / 'count.mp4'
    out = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*'mp4v'), 30, (64, 48))
    for i in range(300):
        out.write(np.full((48, 64, 3), i % 250, np.uint8))  # each frame's brightness is its number
    out.release()
    got = {i: int(f.mean()) for i, f in labels.frames_at(path, [250, 3, 10, 11, 200])}
    assert sorted(got) == [3, 10, 11, 200, 250]
    assert all(abs(got[i] - i % 250) <= 3 for i in got)


@pytest.fixture
def folder(tmp_path):
    d = tmp_path / 'labels'
    (d / 'frames').mkdir(parents=True)
    items = []
    for name, video, box in [('IMG_1_000010', 'IMG_1.MOV', [320, 240, 20, 20]), ('IMG_1_000020', 'IMG_1.MOV', None),
                             ('IMG_2_000030', 'IMG_2.mp4', [100, 50, 16, 16])]:
        cv2.imwrite(str(d / 'frames' / f'{name}.jpg'), np.zeros((480, 640, 3), np.uint8))
        items.append({'id': name, 'video': video, 'frame': 10, 't': 1.0, 'kind': 'flight', 'width': 640, 'height': 480,
                      'source': 'flight' if box else 'none', 'status': 'pending', 'box': box})
    labels.save(d, {'version': 1, 'items': items})
    return d


def test_store_saves_good_answers_and_refuses_bad_ones(folder):
    s = review.Store(folder)
    s.update([{'id': 'IMG_1_000010', 'status': 'ok'}, {'id': 'IMG_1_000020', 'status': 'moved', 'box': [10, 20, 12, 12]}])
    saved = {it['id']: it for it in labels.load(folder)['items']}
    assert saved['IMG_1_000010']['status'] == 'ok'
    assert saved['IMG_1_000020']['box'] == [10, 20, 12, 12] and saved['IMG_1_000020']['status'] == 'moved'
    for bad in [{'id': 'nope', 'status': 'ok'}, {'id': 'IMG_2_000030', 'status': 'great'},
                {'id': 'IMG_2_000030', 'status': 'moved', 'box': [9999, 1, 10, 10]},
                {'id': 'IMG_2_000030', 'status': 'ok', 'box': None}]:
        with pytest.raises(ValueError):
            s.update([bad])
    s.update([{'id': 'IMG_2_000030', 'status': 'no-ball', 'box': None}])
    assert s.by_id['IMG_2_000030']['box'] is None


def test_review_server(folder):
    srv = review.serve(folder, port=0, open_browser=False)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{srv.server_address[1]}'
    try:
        get = lambda p: urllib.request.urlopen(base + p)
        assert b'Ball labels' in get('/').read()
        assert len(json.load(get('/api/items'))['items']) == 3
        crop = get('/crop/IMG_1_000010.jpg?s=200').read()
        assert cv2.imdecode(np.frombuffer(crop, np.uint8), cv2.IMREAD_COLOR).shape == (200, 200, 3)
        assert get('/frames/IMG_1_000020.jpg').headers['Content-Type'] == 'image/jpeg'
        post = urllib.request.Request(base + '/api/update', json.dumps([{'id': 'IMG_1_000010', 'status': 'ok'}]).encode(),
                                      {'Content-Type': 'application/json'})
        assert json.load(urllib.request.urlopen(post))['items'][0]['status'] == 'ok'
        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(urllib.request.Request(base + '/api/update', b'[{"id": "x", "status": "ok"}]'))
        assert e.value.code == 400
        with pytest.raises(urllib.error.HTTPError):
            get('/frames/../labels.json')
    finally:
        srv.shutdown()


def test_export_writes_yolo_files_split_by_game(folder, tmp_path):
    s = review.Store(folder)
    s.update([{'id': 'IMG_1_000010', 'status': 'ok'}, {'id': 'IMG_1_000020', 'status': 'no-ball'},
              {'id': 'IMG_2_000030', 'status': 'moved', 'box': [320, 240, 32, 48]}])
    out = tmp_path / 'yolo'
    assert labels.export(folder, out, val=['IMG_2']) == {'train': 2, 'val': 1}
    assert (out / 'labels/train/IMG_1_000010.txt').read_text() == '0 0.500000 0.500000 0.031250 0.041667\n'
    assert (out / 'labels/train/IMG_1_000020.txt').read_text() == ''        # no ball: an empty file
    assert (out / 'labels/val/IMG_2_000030.txt').read_text() == '0 0.500000 0.500000 0.050000 0.100000\n'
    assert (out / 'images/val/IMG_2_000030.jpg').exists()
    assert 'names:\n  0: ball' in (out / 'data.yaml').read_text()
