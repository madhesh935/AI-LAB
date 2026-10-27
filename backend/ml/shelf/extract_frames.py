"""Build an annotation queue from shelf video:

    python -m ml.shelf.extract_frames --video shelf1.mp4 --session store1-aisle3-2026-10-25 --out annotation_queue --every 2.0

Extracts representative, sharp, non-duplicate frames into <out>/images/<session>/, writes classes.txt (edit it with the real product
classes), metadata.csv, and a README for the annotators. Frames are NOT labeled - a human draws the boxes (CVAT / Label Studio /
Roboflow, export as YOLO 1.1). The session name is the split unit, so give every recording its own."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import cv2

from ml.shelf.dataset import dhash, hamming


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--video", required=True, type=Path)
    ap.add_argument("--session", required=True, help="recording/shelf-configuration id (becomes the split unit)")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--every", type=float, default=2.0, help="seconds between candidate frames")
    ap.add_argument("--min-sharpness", type=float, default=40.0)
    ap.add_argument("--dedupe-bits", type=int, default=5)
    ap.add_argument("--max-frames", type=int, default=200)
    args = ap.parse_args(argv)

    cap = cv2.VideoCapture(str(args.video))
    if not cap.isOpened():
        raise SystemExit(f"cannot open {args.video}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    step = max(1, int(round(args.every * fps)))
    out_dir = args.out / "images" / args.session
    out_dir.mkdir(parents=True, exist_ok=True)
    kept, rows, hashes, i = 0, [], [], 0
    while kept < args.max_frames:
        ok, frame = cap.read()
        if not ok:
            break
        if i % step == 0:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            sharp = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            h = dhash(gray)
            if sharp >= args.min_sharpness and all(hamming(h, o) > args.dedupe_bits for o in hashes):
                name = f"{args.session}_{kept:04d}.jpg"
                cv2.imwrite(str(out_dir / name), frame)
                hashes.append(h)
                rows.append({"image": name, "session": args.session, "video": args.video.name, "frame": i, "time_s": round(i / fps, 2), "sharpness": round(sharp, 1)})
                kept += 1
        i += 1
    with (args.out / "metadata.csv").open("a", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["image", "session", "video", "frame", "time_s", "sharpness"])
        if fh.tell() == 0:
            w.writeheader()
        w.writerows(rows)
    classes = args.out / "classes.txt"
    if not classes.exists():
        classes.write_text("# one product class per line, in id order (0, 1, 2, ...). Replace this placeholder before annotating.\nproduct_class_1\n")
    (args.out / "README.md").write_text(
        "# Annotation queue\n\n1. Define classes in classes.txt (specific, visually distinct products or categories you really need).\n"
        "2. Annotate every visible product with a tight box (include partially occluded ones; mark nothing you cannot see).\n"
        "3. Export as YOLO 1.1 into <dataset>/labels/<session>/ keeping image names.\n4. Run `python -m ml.shelf.audit` then `python -m ml.shelf.prepare`.\n"
        "Model pre-labels (ml.shelf.prelabel) are suggestions only and are ignored by prepare until a human review manifest lists them.\n")
    print(f"extracted {kept} frames from {args.video.name} ({i} read) -> {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
