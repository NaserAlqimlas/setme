"""Train the ball detector (YOLO) on the exported frames (see labels.py).

    python -m setme_vision.train ~/Documents/setme-test-video/yolo

The trained model is saved as ball.pt next to the dataset. Training runs on the Mac's GPU when there is one.
The ball is only about 20 pixels across in a 1080p frame, so the model looks at 1280-pixel images rather than
YOLO's usual 640, where the ball would shrink to a few pixels.
"""
import argparse
import shutil
from pathlib import Path


def device():
    import torch
    return 'mps' if torch.backends.mps.is_available() else 0 if torch.cuda.is_available() else 'cpu'


def train(data, model='yolo11n.pt', epochs=60, imgsz=1280, batch=8, out=None):
    from ultralytics import YOLO
    data = Path(data).expanduser()
    runs = data / 'runs'
    m = YOLO(model)
    m.train(data=str(data / 'data.yaml'), epochs=epochs, imgsz=imgsz, batch=batch, device=device(), project=str(runs),
            name='ball', exist_ok=True, patience=15, plots=False, workers=2,
            fliplr=0.5, mosaic=1.0, scale=0.3, degrees=0, hsv_h=0.005)   # keep the ball's colour: it's a strong clue
    best = runs / 'ball' / 'weights' / 'best.pt'
    dest = Path(out).expanduser() if out else data.parent / 'ball.pt'
    shutil.copy2(best, dest)
    metrics = YOLO(str(dest)).val(data=str(data / 'data.yaml'), imgsz=imgsz, batch=batch, device=device(), plots=False)
    print(f'Saved {dest}. On the held-out games: precision {metrics.box.mp:.2f}, recall {metrics.box.mr:.2f}, '
          f'mAP50 {metrics.box.map50:.2f}')
    return dest


def main(argv=None):
    ap = argparse.ArgumentParser(prog='setme_vision.train')
    ap.add_argument('data', help='the folder made by setme_vision.labels export')
    ap.add_argument('--model', default='yolo11n.pt', help='the starting model (downloaded once)')
    ap.add_argument('--epochs', type=int, default=60)
    ap.add_argument('--imgsz', type=int, default=1280)
    ap.add_argument('--batch', type=int, default=8)
    ap.add_argument('--out', help='default: ball.pt next to the dataset')
    a = ap.parse_args(argv)
    train(a.data, a.model, a.epochs, a.imgsz, a.batch, a.out)


if __name__ == '__main__':
    main()
