"""Audit a shelf dataset:   python -m ml.shelf.audit --root <dataset> [--classes a,b,c] [--out report.json]

Reports size, classes, annotation coverage, class imbalance, image quality, recording sessions, near-duplicates and a plain verdict
on whether the data is enough to train a model worth trusting. Does not modify anything."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ml.shelf.dataset import audit, load_yolo_dataset


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", required=True, type=Path)
    ap.add_argument("--classes", default="", help="comma separated class names in id order")
    ap.add_argument("--group-regex", default=None, help="regex whose group(1) names the recording session of an image path")
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args(argv)
    names = [c for c in args.classes.split(",") if c] or None
    samples = load_yolo_dataset(args.root, names, args.group_regex)
    report = audit(samples, names)
    text = json.dumps(report, indent=1)
    print(text)
    if args.out:
        args.out.write_text(text)
    return 0 if report["verdict"]["trainable"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
