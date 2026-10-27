"""Draw the shelf model's detections on real held-out TEST images (never seen in training) and save them for viewing.

    python scripts/show_shelf_detections.py [--n 4] [--conf 0.3] [--out docs/eval/shelf_detections]

Each picture is labelled with how many items the model found and how many the dataset's own annotation has for that image, so the counts can be
compared honestly. Images are picked evenly across the test split (not hand-picked for looking good).
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2

BACKEND = Path(__file__).resolve().parent.parent
DATA = BACKEND / "data" / "datasets" / "sku110k_prepared"
WEIGHTS = BACKEND / "ai_models" / "shelf" / "shelf-sku110k-v1" / "weights" / "best.pt"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=4)
    ap.add_argument("--conf", type=float, default=0.3)
    ap.add_argument("--imgsz", type=int, default=512)
    ap.add_argument("--out", default=str(BACKEND / "docs" / "eval" / "shelf_detections"))
    a = ap.parse_args()
    from ultralytics import YOLO

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    files = sorted((DATA / "images" / "test").glob("*.jpg"))
    step = max(1, len(files) // a.n)
    picks = files[::step][: a.n]
    model = YOLO(str(WEIGHTS))
    for f in picks:
        img = cv2.imread(str(f))
        res = model.predict(img, imgsz=a.imgsz, conf=a.conf, verbose=False, device=0)[0]
        lab = DATA / "labels" / "test" / (f.stem + ".txt")
        truth = len([ln for ln in lab.read_text().splitlines() if ln.strip()]) if lab.exists() else None
        for (x1, y1, x2, y2), c in zip(res.boxes.xyxy.cpu().numpy(), res.boxes.conf.cpu().numpy()):
            cv2.rectangle(img, (int(x1), int(y1)), (int(x2), int(y2)), (60, 200, 60), 2)
        h, w = img.shape[:2]
        band = f"{f.name}: model found {len(res.boxes)} items | dataset annotation {truth} | conf >= {a.conf}"
        cv2.rectangle(img, (0, 0), (w, 46), (0, 0, 0), -1)
        cv2.putText(img, band, (12, 32), cv2.FONT_HERSHEY_SIMPLEX, max(0.7, w / 1600), (255, 255, 255), 2, cv2.LINE_AA)
        scale = 1600 / max(h, w)
        if scale < 1:
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        path = out / f"{f.stem}_detected.jpg"
        cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 88])
        print(f"{path}  model={len(res.boxes)} annotated={truth}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
