"""Shelf dataset / training TOOLING tests on a SYNTHETIC fixture (coloured rectangles). The fixture exists only to exercise
the pipeline; no model trained on it is meaningful and none may be registered (the tests assert that)."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from core.config import BACKEND_DIR
from ml.shelf import prepare as prepare_cli
from ml.shelf import train as train_cli
from ml.shelf.dataset import audit, check_leakage, load_yolo_dataset, make_synthetic_fixture, split_by_group

CLASSES = ["bottle", "box"]


@pytest.fixture(scope="module")
def raw(tmp_path_factory):
    return make_synthetic_fixture(tmp_path_factory.mktemp("raw"), sessions=6, per_session=8, classes=CLASSES)


def test_audit_reports_counts_classes_sessions_and_an_honest_verdict(raw):
    samples = load_yolo_dataset(raw, CLASSES)
    a = audit(samples, CLASSES)
    assert a["images"] == 48 and a["labeled_images"] == 48 and a["annotation_coverage"] == 1.0
    assert set(a["classes"]) <= set(CLASSES) and a["boxes"] > 100 and a["recording_sessions"]["count"] == 6
    assert a["near_duplicate_clusters"] >= 1  # frames of one session are near-identical by construction
    assert a["verdict"]["trainable"] is False
    assert any("labeled images" in m for m in a["verdict"]["missing"])  # tiny dataset: not enough to trust a model


def test_audit_flags_unlabeled_images_and_invalid_labels(tmp_path):
    root = make_synthetic_fixture(tmp_path / "d", sessions=2, per_session=3, classes=CLASSES)
    (root / "labels" / "sess00_000.txt").unlink()  # unlabeled (NOT the same as an empty shelf)
    (root / "labels" / "sess00_001.txt").write_text("7 0.5 0.5 0.2 0.2\n")  # class id out of range
    (root / "labels" / "sess00_002.txt").write_text("0 0.99 0.5 0.4 0.2\n0 abc 0.5 0.1 0.1\n0 0.5 0.5 0.1\n")  # beyond image, non-numeric, wrong arity
    a = audit(load_yolo_dataset(root, CLASSES), CLASSES)
    assert a["unlabeled_images"] == 1 and a["label_problems"] >= 4 and "sess00_001.jpg" in a["files_with_problems"]
    assert any("label problems" in m for m in a["verdict"]["missing"])


def test_split_keeps_every_recording_session_in_one_split_and_leakage_check_detects_violations(raw):
    samples = load_yolo_dataset(raw, CLASSES)
    splits = split_by_group(samples, (0.5, 0.25, 0.25), seed=1)
    assert sum(len(v) for v in splits.values()) == 48 and all(len(v) > 0 for v in splits.values())
    assert check_leakage(splits)["clean"] is True
    assert all(len({s.group for s in v} & {s.group for s in w}) == 0 for a, v in splits.items() for b, w in splits.items() if a < b)
    leaked = {k: list(v) for k, v in splits.items()}
    leaked["test"].append(leaked["train"][0])  # force the same session into two splits
    bad = check_leakage(leaked)
    assert bad["clean"] is False and bad["group_leaks"]


def test_prepare_refuses_small_datasets_and_ignores_unverified_prelabels(raw, tmp_path):
    out = tmp_path / "prep"
    assert prepare_cli.main(["--root", str(raw), "--classes", ",".join(CLASSES), "--out", str(out)]) == 3 and not (out / "data.yaml").exists()
    rawcopy = tmp_path / "raw2"
    shutil.copytree(raw, rawcopy)
    pre = rawcopy / "prelabels_UNVERIFIED"
    pre.mkdir()
    (pre / "sess00_000.txt").write_text("0 0.5 0.5 0.2 0.2\n")
    assert prepare_cli.main(["--root", str(rawcopy), "--classes", ",".join(CLASSES), "--out", str(out), "--allow-small"]) == 0
    report = json.loads((out / "audit_report.json").read_text())
    assert report["trusted"] is False and report["leakage_check"]["clean"] and set(report["split_sizes"]) == {"train", "val", "test"}
    assert not any("prelabels" in str(p) for p in out.rglob("*"))
    manifest = json.loads((out / "manifest.json").read_text())
    assert manifest["classes"] == CLASSES and all(len(r["sha256"]) == 64 for rows in manifest["splits"].values() for r in rows)


def test_training_refuses_untrusted_data_and_untrusted_data_can_never_be_registered(raw, tmp_path):
    out = tmp_path / "prep"
    prepare_cli.main(["--root", str(raw), "--classes", ",".join(CLASSES), "--out", str(out), "--allow-small"])
    assert train_cli.main(["--data", str(out / "data.yaml"), "--name", "pytest-refuse"]) == 3
    assert train_cli.main(["--data", str(out / "data.yaml"), "--name", "pytest-refuse", "--allow-untrusted", "--register"]) == 3
    models = json.loads((BACKEND_DIR / "ai_models" / "configs" / "models.json").read_text())
    shelf = next(m for m in models["models"] if m["id"] == "shelf-monitor")
    assert shelf["enabled"] is False and shelf["path"] is None  # nothing was registered


def test_training_loop_smoke_on_synthetic_data_writes_real_metrics_and_validates_onnx_export(raw, tmp_path):
    out = tmp_path / "prep"
    prepare_cli.main(["--root", str(raw), "--classes", ",".join(CLASSES), "--out", str(out), "--allow-small"])
    name = "pytest-smoke-synthetic"
    card_dir = BACKEND_DIR / "ai_models" / "shelf" / name
    runs = BACKEND_DIR / "ml" / "runs"
    try:
        rc = train_cli.main(["--data", str(out / "data.yaml"), "--name", name, "--epochs", "2", "--imgsz", "160", "--batch", "8", "--allow-untrusted",
                             "--skip-smoke", "--export-onnx", "--device", "cpu"])
        assert rc == 0
        card = json.loads((card_dir / "model_card.json").read_text())
        assert card["trusted"] is False and card["registered"] is False
        for split in ("val", "test"):
            assert 0.0 <= card[split]["mAP50"] <= 1.0 and set(card[split]["per_class"]) <= set(CLASSES) and card[split]["images_evaluated"] > 0
        assert card["training_seconds"] > 0 and card["losses"]["epochs_run"] >= 1 and len(card["weights"]["sha256"]) == 64
        assert card["onnx"]["ok"] is True, card["onnx"]  # ONNX output reproduces the PyTorch detections
    finally:
        shutil.rmtree(card_dir, ignore_errors=True)
        shutil.rmtree(runs / name, ignore_errors=True)
