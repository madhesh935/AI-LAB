"""Visible-product COUNTING accuracy (separate from detection mAP):

    python -m ml.shelf.evaluate_counts --weights ai_models/shelf/shelf-v1/weights/best.pt --data prepared/data.yaml --split test --conf 0.4

Per image: predicted count (boxes >= conf) vs ground-truth box count. Reports MAE, MAPE, exact-match rate, bias, per-class MAE and how often a
shelf with ZERO ground-truth products receives detections (the false 'in stock' / ghost-product risk). Occlusion / lighting / angle stratification
needs those attributes recorded per image (see README); without them they are reported as 'not measurable', never guessed."""

from __future__ import annotations

import argparse
import json
import statistics
from collections import defaultdict
from pathlib import Path

import yaml


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--weights", required=True, type=Path)
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--split", default="test")
    ap.add_argument("--conf", type=float, default=0.4)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args(argv)
    from ultralytics import YOLO

    cfg = yaml.safe_load(args.data.read_text())
    root = Path(cfg["path"])
    names = cfg["names"]
    model = YOLO(str(args.weights))
    errs, rel, exact, bias = [], [], 0, []
    per_class = defaultdict(list)
    empty_total = empty_with_dets = 0
    n = 0
    for img in sorted((root / "images" / args.split).glob("*")):
        lab = root / "labels" / args.split / (img.stem + ".txt")
        if not lab.exists():
            continue
        gt = defaultdict(int)
        for line in lab.read_text().splitlines():
            if line.strip():
                gt[int(line.split()[0])] += 1
        pred = defaultdict(int)
        for b in model.predict(str(img), imgsz=args.imgsz, conf=args.conf, device=args.device, verbose=False)[0].boxes:
            pred[int(b.cls)] += 1
        g, p = sum(gt.values()), sum(pred.values())
        n += 1
        errs.append(abs(p - g))
        bias.append(p - g)
        exact += int(p == g)
        if g:
            rel.append(abs(p - g) / g)
        else:
            empty_total += 1
            empty_with_dets += int(p > 0)
        for c in set(gt) | set(pred):
            per_class[names[c]].append(abs(pred[c] - gt[c]))
    report = {
        "split": args.split, "images": n, "confidence_threshold": args.conf,
        "count_mae": round(statistics.fmean(errs), 3) if errs else None, "count_mape": round(statistics.fmean(rel), 3) if rel else None,
        "exact_match_rate": round(exact / n, 3) if n else None, "count_bias(pred-gt)": round(statistics.fmean(bias), 3) if bias else None,
        "per_class_mae": {k: round(statistics.fmean(v), 3) for k, v in per_class.items()},
        "empty_shelf_images": empty_total, "empty_shelf_false_detection_rate": round(empty_with_dets / empty_total, 3) if empty_total else "not measurable (no empty-shelf test images)",
        "occlusion_lighting_angle": "not measurable: per-image attributes were not recorded in this dataset",
    }
    text = json.dumps(report, indent=1)
    print(text)
    if args.out:
        args.out.write_text(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
