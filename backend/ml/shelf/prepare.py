"""Validate and split a labeled shelf dataset:

    python -m ml.shelf.prepare --root <raw yolo dataset> --classes cola,juice --out <prepared dir> [--reviewed reviewed.json]

* refuses images whose labels come from model pre-labelling unless they are listed in a human review manifest;
* rejects invalid boxes / unknown class ids / undecodable images (reported, never silently fixed);
* splits by recording session (near-duplicate clusters merged), then re-verifies there is no leakage;
* writes YOLO images/labels per split, data.yaml, manifest.json (sha256 per image) and audit_report.json.
Exit code 3 if the dataset is too small to train and trust a model (use --allow-small for tooling smoke tests only)."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from ml.shelf.dataset import audit, check_leakage, load_yolo_dataset, split_by_group, write_yolo_split


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", required=True, type=Path)
    ap.add_argument("--classes", required=True)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--group-regex", default=None)
    ap.add_argument("--reviewed", type=Path, default=None, help="JSON list of image names whose pre-labels a human verified")
    ap.add_argument("--ratios", default="0.7,0.15,0.15")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--allow-small", action="store_true", help="tooling smoke tests only: skip the size gate (the result is marked untrusted)")
    args = ap.parse_args(argv)
    names = [c for c in args.classes.split(",") if c]
    samples = load_yolo_dataset(args.root, names, args.group_regex)

    prelabel_dir = args.root / "prelabels_UNVERIFIED"
    unverified = []
    if prelabel_dir.exists():
        reviewed = set(json.loads(args.reviewed.read_text())) if args.reviewed else set()
        unverified = [p.name for p in prelabel_dir.glob("*.txt") if p.stem + ".jpg" not in reviewed and p.name not in reviewed]
        if unverified:
            print(f"NOTE: {len(unverified)} model pre-labels in {prelabel_dir.name} are NOT used (no human review recorded)")

    report = audit(samples, names)
    usable = [s for s in samples if s.label is not None and s.boxes and not s.problems]
    report["usable_images"] = len(usable)
    if not report["verdict"]["trainable"] and not args.allow_small:
        print(json.dumps(report, indent=1))
        print("\nREFUSING to prepare: dataset is not sufficient (see verdict.missing).")
        return 3
    ratios = tuple(float(x) for x in args.ratios.split(","))
    splits = split_by_group(usable, ratios, args.seed)  # type: ignore[arg-type]
    leak = check_leakage(splits)
    if not leak["clean"]:
        print(json.dumps(leak, indent=1))
        print("REFUSING: split leakage detected")
        return 4
    args.out.mkdir(parents=True, exist_ok=True)
    manifest = write_yolo_split(splits, args.out, names)
    report["trusted"] = bool(report["verdict"]["trainable"])
    report["split_sizes"] = {k: len(v) for k, v in splits.items()}
    report["split_groups"] = {k: sorted({s.group for s in v}) for k, v in splits.items()}
    report["leakage_check"] = leak
    (args.out / "audit_report.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({k: report[k] for k in ("usable_images", "split_sizes", "trusted", "leakage_check")}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
