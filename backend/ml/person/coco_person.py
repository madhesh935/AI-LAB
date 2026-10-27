"""Person-detector evaluation and (optional) fine-tuning on REAL labelled images: COCO val2017 persons.

    python -m ml.person.coco_person prepare --coco data/datasets/coco --out data/datasets/coco_person
    python -m ml.person.coco_person eval    --weights ai_models/person/yolo11n.pt --data data/datasets/coco_person --split test
    python -m ml.person.coco_person train   --data data/datasets/coco_person --name person-coco-ft1 --epochs 30

Why val2017: the shipped YOLO11n was trained on COCO *train2017*, so val2017 images are unseen by it and carry human-made person boxes.
`prepare` splits val2017 BY IMAGE into train/val/test (60/20/20, seeded) and writes YOLO labels (class 0 = person; crowd boxes are ignored, never
used as targets). It also tags a "closeup" subset: images with a person whose box covers >= 20 % of the image or touches the image border
(truncated people) - the situation of a laptop webcam, where only head and shoulders are visible.
`eval` reports precision / recall / F1 at IoU 0.5 for several confidence thresholds on all test images and on the closeup subset, and
Ultralytics mAP50 / mAP50-95. `train` fine-tunes from the given weights; the model card records both before and after, measured on the SAME test split,
and the result is only worth deploying if it beats the base on BOTH the overall and the closeup numbers.
Licence note: COCO annotations CC BY 4.0; images carry Flickr licences (see the COCO terms). The fine-tuned weights stay AGPL-3.0 like YOLO11.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import time
import zipfile
from pathlib import Path
from typing import Dict, List, Tuple

ROOT = Path(__file__).resolve().parent.parent.parent
SPLITS = (("train", 0.6), ("val", 0.2), ("test", 0.2))


def _unzip(zpath: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zpath) as z:
        z.extractall(dest)


def prepare(coco: Path, out: Path, seed: int = 0) -> dict:
    if not (coco / "val2017").is_dir():
        _unzip(coco / "val2017.zip", coco)
    ann_path = coco / "annotations" / "instances_val2017.json"
    if not ann_path.exists():
        with zipfile.ZipFile(coco / "annotations_trainval2017.zip") as z:
            z.extract("annotations/instances_val2017.json", coco)
    data = json.loads(ann_path.read_text())
    imgs = {i["id"]: i for i in data["images"]}
    boxes: Dict[int, List[Tuple[float, float, float, float]]] = {}
    crowd: Dict[int, int] = {}
    for a in data["annotations"]:
        if a["category_id"] != 1:
            continue
        if a.get("iscrowd"):
            crowd[a["image_id"]] = crowd.get(a["image_id"], 0) + 1
            continue
        x, y, w, h = a["bbox"]
        if w < 2 or h < 2:
            continue
        boxes.setdefault(a["image_id"], []).append((x, y, w, h))
    ids = sorted(imgs)
    rnd = random.Random(seed)
    rnd.shuffle(ids)
    n = len(ids)
    cuts, start, assign = [], 0, {}
    for name, frac in SPLITS:
        end = start + int(round(n * frac)) if name != "test" else n
        for i in ids[start:end]:
            assign[i] = name
        start = end
    stats = {s: {"images": 0, "images_with_person": 0, "persons": 0, "closeup_images": 0} for s, _ in SPLITS}
    closeup_list: Dict[str, List[str]] = {s: [] for s, _ in SPLITS}
    for iid, split in assign.items():
        info = imgs[iid]
        W, H = info["width"], info["height"]
        src = coco / "val2017" / info["file_name"]
        if not src.is_file():
            continue
        (out / "images" / split).mkdir(parents=True, exist_ok=True)
        (out / "labels" / split).mkdir(parents=True, exist_ok=True)
        dst = out / "images" / split / info["file_name"]
        if not dst.exists():
            try:
                os.link(src, dst)
            except OSError:
                shutil.copy2(src, dst)
        lines, closeup = [], False
        for x, y, w, h in boxes.get(iid, []):
            lines.append(f"0 {(x + w / 2) / W:.5f} {(y + h / 2) / H:.5f} {w / W:.5f} {h / H:.5f}")
            if (w * h) / (W * H) >= 0.20 or x <= 2 or y <= 2 or x + w >= W - 2 or y + h >= H - 2:
                closeup = True
        (out / "labels" / split / (Path(info["file_name"]).stem + ".txt")).write_text("\n".join(lines) + ("\n" if lines else ""))
        st = stats[split]
        st["images"] += 1
        st["persons"] += len(lines)
        st["images_with_person"] += 1 if lines else 0
        if closeup:
            st["closeup_images"] += 1
            closeup_list[split].append(info["file_name"])
    (out / "closeup_images.json").write_text(json.dumps(closeup_list))
    (out / "data.yaml").write_text(f"path: {out.resolve().as_posix()}\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n  0: person\n")
    (out / "prepare_report.json").write_text(json.dumps({"source": "COCO val2017 (instances_val2017.json)", "seed": seed, "splits": stats, "note": "crowd annotations are ignored"}, indent=1))
    print(json.dumps(stats, indent=1))
    return stats


def _iou(a, b) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    iw, ih = max(0.0, min(ax2, bx2) - max(ax1, bx1)), max(0.0, min(ay2, by2) - max(ay1, by1))
    inter = iw * ih
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - inter
    return inter / union if union > 0 else 0.0


def _gt(label: Path, W: int, H: int):
    out = []
    if label.exists():
        for ln in label.read_text().split("\n"):
            if ln.strip():
                _, cx, cy, w, h = (float(v) for v in ln.split())
                out.append(((cx - w / 2) * W, (cy - h / 2) * H, (cx + w / 2) * W, (cy + h / 2) * H))
    return out


def evaluate(weights: Path, data: Path, split: str, imgsz: int = 640, device: str = "0", confs=(0.1, 0.2, 0.25, 0.3, 0.35, 0.5)) -> dict:
    import cv2
    from ultralytics import YOLO

    model = YOLO(str(weights))
    closeup = set(json.loads((data / "closeup_images.json").read_text()).get(split, []))
    files = sorted((data / "images" / split).glob("*.jpg"))
    per = {c: {"all": [0, 0, 0], "closeup": [0, 0, 0]} for c in confs}  # tp, fp, fn
    t0 = time.perf_counter()
    for f in files:
        img = cv2.imread(str(f))
        if img is None:
            continue
        H, W = img.shape[:2]
        gts = _gt(data / "labels" / split / (f.stem + ".txt"), W, H)
        r = model.predict(img, imgsz=imgsz, conf=min(confs), classes=[0] if model.names.get(0) == "person" else None, device=device, verbose=False)[0]
        dets = [(float(c), tuple(float(v) for v in xy)) for c, xy in zip(r.boxes.conf, r.boxes.xyxy)]
        for conf in confs:
            kept = sorted([d for d in dets if d[0] >= conf], key=lambda d: -d[0])
            used, tp = set(), 0
            for _, box in kept:
                best, bj = 0.0, -1
                for j, g in enumerate(gts):
                    if j in used:
                        continue
                    v = _iou(box, g)
                    if v > best:
                        best, bj = v, j
                if best >= 0.5:
                    used.add(bj)
                    tp += 1
            fp, fn = len(kept) - tp, len(gts) - tp
            for key in ("all",) + (("closeup",) if f.name in closeup else ()):
                c = per[conf][key]
                c[0] += tp
                c[1] += fp
                c[2] += fn
    def prf(t):
        tp, fp, fn = t
        p = tp / (tp + fp) if tp + fp else 0.0
        r = tp / (tp + fn) if tp + fn else 0.0
        return {"precision": round(p, 4), "recall": round(r, 4), "f1": round(2 * p * r / (p + r), 4) if p + r else 0.0, "tp": tp, "fp": fp, "fn": fn}
    table = {str(c): {k: prf(v) for k, v in per[c].items()} for c in confs}
    m = model.val(data=str(data / "data.yaml"), split=split, imgsz=imgsz, device=device, verbose=False, plots=False, workers=0, classes=[0] if model.names.get(0) == "person" else None)
    best = max(confs, key=lambda c: table[str(c)]["all"]["f1"])
    best_cl = max(confs, key=lambda c: table[str(c)]["closeup"]["f1"])
    return {"weights": str(weights), "split": split, "images": len(files), "closeup_images": len(closeup), "imgsz": imgsz, "by_conf": table,
            "best_conf_all_images_f1": best, "best_conf_closeup_f1": best_cl, "mAP50": round(float(m.box.map50), 4), "mAP50-95": round(float(m.box.map), 4),
            "seconds": round(time.perf_counter() - t0, 1)}


def train(data: Path, name: str, epochs: int, base: Path, batch: int, imgsz: int, workers: int = 2) -> dict:
    from ultralytics import YOLO

    project = ROOT / "ml" / "runs"
    # Keep the base model's 80-class head (only person is labelled): the pretrained weights then load completely and the fine-tune starts from the
    # shipped accuracy instead of from a re-initialised 1-class head (which would have to relearn "person" from 3000 images).
    names = YOLO(str(base)).names
    keep = data / "data_coco80.yaml"
    header = f"path: {data.resolve().as_posix()}\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n"
    keep.write_text(header + "".join(f"  {i}: {n}\n" for i, n in names.items()))
    YOLO(str(base)).train(data=str(keep), epochs=epochs, imgsz=imgsz, batch=batch, device="0", project=str(project), name=name, exist_ok=True, workers=workers, patience=10,
                          seed=0, plots=False, verbose=False, scale=0.9, translate=0.2)  # strong scale/translate aug: people are often large and cut by the frame edge
    best = project / name / "weights" / "best.pt"
    out_dir = ROOT / "ai_models" / "person" / name
    out_dir.mkdir(parents=True, exist_ok=True)
    final = out_dir / "best.pt"
    shutil.copy2(best, final)
    return {"weights": str(final)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("--coco", type=Path, default=ROOT / "data" / "datasets" / "coco")
    p.add_argument("--out", type=Path, default=ROOT / "data" / "datasets" / "coco_person")
    e = sub.add_parser("eval")
    e.add_argument("--weights", type=Path, default=ROOT / "ai_models" / "person" / "yolo11n.pt")
    e.add_argument("--data", type=Path, default=ROOT / "data" / "datasets" / "coco_person")
    e.add_argument("--split", default="test")
    e.add_argument("--imgsz", type=int, default=640)
    e.add_argument("--out", type=Path, default=None)
    t = sub.add_parser("train")
    t.add_argument("--data", type=Path, default=ROOT / "data" / "datasets" / "coco_person")
    t.add_argument("--name", default="person-coco-ft1")
    t.add_argument("--epochs", type=int, default=30)
    t.add_argument("--base", type=Path, default=ROOT / "ai_models" / "person" / "yolo11n.pt")
    t.add_argument("--batch", type=int, default=16)
    t.add_argument("--imgsz", type=int, default=640)
    t.add_argument("--workers", type=int, default=2, help="data-loader processes (each one imports torch: keep low on a 24 GB machine that also runs the worker)")
    a = ap.parse_args(argv)
    if a.cmd == "prepare":
        prepare(a.coco, a.out)
    elif a.cmd == "eval":
        res = evaluate(a.weights, a.data, a.split, a.imgsz)
        text = json.dumps(res, indent=1)
        print(text)
        if a.out:
            a.out.parent.mkdir(parents=True, exist_ok=True)
            a.out.write_text(text)
    else:
        print(json.dumps(train(a.data, a.name, a.epochs, a.base, a.batch, a.imgsz, a.workers)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
