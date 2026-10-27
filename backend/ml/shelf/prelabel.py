"""Optional model-assisted PRE-labelling (suggestions for annotators; never ground truth):

    python -m ml.shelf.prelabel --images annotation_queue/images --weights some_detector.pt --map bottle=0,cup=1 --out dataset/prelabels_UNVERIFIED

Writes YOLO .txt files into a directory whose name says UNVERIFIED plus REQUIRES_HUMAN_REVIEW.md. `ml.shelf.prepare` ignores that directory
until a human review manifest lists the verified files. A generic COCO detector knows bottles/cups, not your SKUs: expect to correct most boxes."""

from __future__ import annotations

import argparse
from pathlib import Path


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--images", required=True, type=Path)
    ap.add_argument("--weights", required=True, type=Path)
    ap.add_argument("--map", required=True, help="detector_class_name=target_class_id,... (only these classes are suggested)")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--conf", type=float, default=0.3)
    args = ap.parse_args(argv)
    if "UNVERIFIED" not in args.out.name:
        raise SystemExit("output directory name must contain UNVERIFIED so these labels can never be mistaken for ground truth")
    mapping = {k: int(v) for k, v in (kv.split("=") for kv in args.map.split(","))}
    from ultralytics import YOLO

    model = YOLO(str(args.weights))
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "REQUIRES_HUMAN_REVIEW.md").write_text("These boxes were guessed by a model. Correct them in an annotation tool, then list the verified image names in a review manifest.\n")
    n_img = n_box = 0
    for img in sorted(p for p in args.images.rglob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png"}):
        r = model.predict(str(img), conf=args.conf, verbose=False)[0]
        lines = []
        for b in r.boxes:
            name = r.names[int(b.cls)]
            if name in mapping:
                cx, cy, w, h = b.xywhn[0].tolist()
                lines.append(f"{mapping[name]} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
        (args.out / (img.stem + ".txt")).write_text("\n".join(lines) + ("\n" if lines else ""))
        n_img, n_box = n_img + 1, n_box + len(lines)
    print(f"wrote {n_box} UNVERIFIED suggestions for {n_img} images into {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
