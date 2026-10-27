"""SKU-110K converter: CSV boxes -> normalised YOLO labels, official splits kept, audit never claims more than was converted."""

from __future__ import annotations

import json

import cv2
import numpy as np

from ml.shelf import sku110k


def make_raw(root):
    (root / "images").mkdir(parents=True)
    (root / "annotations").mkdir()
    for split, names in {"train": ["train_0.jpg", "train_1.jpg"], "val": ["val_0.jpg"], "test": ["test_0.jpg"]}.items():
        rows = []
        for n in names:
            cv2.imwrite(str(root / "images" / n), np.zeros((100, 200, 3), np.uint8))
            rows.append([n, "20", "10", "60", "50", "object", "200", "100"])
            rows.append([n, "100", "0", "100", "40", "object", "200", "100"])  # zero-width: must be dropped, not repaired
        (root / "annotations" / f"annotations_{split}.csv").write_text("\n".join(",".join(r) for r in rows) + "\n")


def test_convert_writes_normalised_labels_and_drops_degenerate_boxes(tmp_path):
    raw, out = tmp_path / "raw", tmp_path / "out"
    make_raw(raw)
    assert sku110k.main(["--raw", str(raw), "--out", str(out)]) == 0
    label = (out / "labels" / "train" / "train_0.txt").read_text().split()
    assert label == ["0", "0.20000", "0.30000", "0.20000", "0.40000"]  # (20..60)/200 centre .2 width .2; (10..50)/100 centre .3 height .4
    assert len(list((out / "images" / "train").glob("*.jpg"))) == 2 and len(list((out / "labels" / "train").glob("*.txt"))) == 2
    audit = json.loads((out / "audit_report.json").read_text())
    assert audit["split_sizes"] == {"train": 2, "val": 1, "test": 1} and audit["trusted"] is False, "a tiny conversion must never be marked trusted"
    assert "item" in (out / "data.yaml").read_text()
