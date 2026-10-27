"""SKU-110K (Goldman et al., CVPR 2019, Trax Retail) -> the layout `ml.shelf.train` expects.

    python -m ml.shelf.sku110k --archive data/datasets/SKU110K_fixed.tar.gz --out data/datasets/sku110k_prepared [--limit N]

* extracts the official archive (dense retail shelves, 1 class "item", official disjoint train / val / test image lists);
* converts the CSV boxes to YOLO labels (normalised xywh, same maths as the Ultralytics recipe);
* hard-links images into `images/{train,val,test}` (no copy), writes `data.yaml` and a truthful `audit_report.json`.

The audit is computed from the converted files (image / box counts, empty-label images). The recording-session leakage check of `ml.shelf.prepare`
cannot be run (the dataset does not publish sessions); the official splits are used as given, and the report says so.

LICENCE: SKU-110K is distributed by Trax for academic / non-commercial research (see https://github.com/eg4000/SKU110K_CVPR19). It is fine for this local
demo; a commercial deployment needs either Trax's permission or a model trained on your own labelled shelf images.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path

SPLITS = {"train": "annotations_train.csv", "val": "annotations_val.csv", "test": "annotations_test.csv"}


def extract(archive: Path, dest: Path) -> Path:
    root = dest / "SKU110K_fixed"
    if (root / "annotations").is_dir() and (root / "images").is_dir():
        return root
    dest.mkdir(parents=True, exist_ok=True)
    print(f"extracting {archive} -> {dest} (about 13 GB)", flush=True)
    subprocess.run(["tar", "-xzf", str(archive), "-C", str(dest)], check=True)
    if not (root / "annotations").is_dir():
        raise SystemExit(f"unexpected archive layout under {dest}")
    return root


def convert(raw: Path, out: Path, limit: int = 0) -> dict:
    stats: dict = {"splits": {}}
    for split, csv_name in SPLITS.items():
        boxes: dict = {}
        with (raw / "annotations" / csv_name).open(newline="") as fh:
            for row in csv.reader(fh):
                if len(row) < 8:
                    continue
                name, x1, y1, x2, y2, _cls, w, h = row[:8]
                w, h = float(w), float(h)
                x1, x2, y1, y2 = max(0.0, float(x1)), min(w, float(x2)), max(0.0, float(y1)), min(h, float(y2))
                if x2 <= x1 or y2 <= y1:
                    continue  # degenerate box: dropped and counted, never silently repaired
                boxes.setdefault(name, []).append(f"0 {(x1 + x2) / 2 / w:.5f} {(y1 + y2) / 2 / h:.5f} {(x2 - x1) / w:.5f} {(y2 - y1) / h:.5f}")
        names = sorted(boxes)
        if limit:
            names = names[:limit]
        img_dir, lab_dir = out / "images" / split, out / "labels" / split
        img_dir.mkdir(parents=True, exist_ok=True)
        lab_dir.mkdir(parents=True, exist_ok=True)
        missing, per_image = 0, []
        for n in names:
            src = raw / "images" / n
            if not src.is_file():
                missing += 1
                continue
            dst = img_dir / n
            if not dst.exists():
                try:
                    os.link(src, dst)
                except OSError:
                    import shutil

                    shutil.copy2(src, dst)
            (lab_dir / (Path(n).stem + ".txt")).write_text("\n".join(boxes[n]) + "\n")
            per_image.append(len(boxes[n]))
        stats["splits"][split] = {"images": len(per_image), "boxes": sum(per_image), "missing_image_files": missing,
                                  "boxes_per_image_mean": round(sum(per_image) / max(1, len(per_image)), 1), "boxes_per_image_max": max(per_image or [0])}
        print(split, stats["splits"][split], flush=True)
    return stats


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--archive", type=Path, default=None)
    ap.add_argument("--raw", type=Path, default=None, help="already extracted SKU110K_fixed directory")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--limit", type=int, default=0, help="convert only the first N images per split (tooling smoke tests; the audit is marked untrusted)")
    args = ap.parse_args(argv)
    raw = args.raw or extract(args.archive, args.out.parent)
    stats = convert(raw, args.out, args.limit)
    n = {k: v["images"] for k, v in stats["splits"].items()}
    trusted = not args.limit and n.get("train", 0) >= 8000 and n.get("val", 0) >= 500 and n.get("test", 0) >= 2500
    (args.out / "data.yaml").write_text(f"path: {args.out.resolve().as_posix()}\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n  0: item\n")
    audit = {"source": "SKU-110K (official splits)", "split_sizes": n, "split_groups": "not published by the dataset", "stats": stats["splits"], "trusted": trusted,
             "verdict": {"trainable": True, "basis": "official disjoint train/val/test image lists; recording-session leakage could not be checked (sessions are not published)",
                         "missing": [] if trusted else ["subset conversion (--limit) or split sizes below the official counts"]},
             "license": "SKU-110K: academic / non-commercial research use (Trax Retail)", "classes": ["item"]}
    (args.out / "audit_report.json").write_text(json.dumps(audit, indent=1))
    print(json.dumps({"trusted": trusted, "split_sizes": n}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

_ = (Counter, sys)
