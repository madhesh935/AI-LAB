"""Fine-tune a lightweight pretrained detector on a PREPARED shelf dataset, evaluate on the held-out test split, export, optionally register.

    python -m ml.shelf.train --data prepared/data.yaml --name shelf-v1 --epochs 60 [--base yolo11n.pt] [--register]

Gates (the script refuses rather than produce a model that looks trustworthy but is not):
  * prepared/audit_report.json must say `trusted: true` (enough labeled images / instances / recording sessions), unless --allow-untrusted
    (tooling smoke tests): such a run writes `"trusted": false` into its model card and can never be registered;
  * registration additionally needs test mAP50 >= --min-map50 and a visible-count evaluation on the test split.
Always reports the REAL measured numbers (loss, P, R, mAP50, mAP50-95, class-wise, training time). Checkpoint selection is by the
validation split (Ultralytics best.pt); the test split is only used once at the end.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parent.parent.parent
MODELS_JSON = ROOT / "ai_models" / "configs" / "models.json"
SHELF_DIR = ROOT / "ai_models" / "shelf"
LICENSE = "AGPL-3.0 (Ultralytics fine-tune of YOLO11 pretrained weights)"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_data_yaml(path: Path) -> Dict[str, Any]:
    import yaml

    return yaml.safe_load(path.read_text())


def last_epoch_losses(save_dir: Path) -> Dict[str, Any]:
    import csv

    f = save_dir / "results.csv"
    if not f.exists():
        return {}
    rows = list(csv.DictReader(f.open()))
    if not rows:
        return {}
    last = {k.strip(): v for k, v in rows[-1].items()}
    best = max(rows, key=lambda r: float({k.strip(): v for k, v in r.items()}.get("metrics/mAP50(B)", 0) or 0))
    keep = ("epoch", "train/box_loss", "train/cls_loss", "train/dfl_loss", "val/box_loss", "val/cls_loss", "val/dfl_loss")
    return {"epochs_run": len(rows), "last_epoch": {k: float(last[k]) for k in keep if k in last},
            "best_epoch_by_val_map50": int(float({k.strip(): v for k, v in best.items()}.get("epoch", 0)))}


def evaluate_split(weights: Path, data_yaml: Path, split: str, imgsz: int, device: str) -> Dict[str, Any]:
    from ultralytics import YOLO

    m = YOLO(str(weights)).val(data=str(data_yaml), split=split, imgsz=imgsz, device=device, verbose=False, plots=False, workers=0)
    b = m.box
    names = m.names
    per_class = {}
    for i, c in enumerate(b.ap_class_index):
        p, r, ap50, ap = b.class_result(i)
        per_class[names[int(c)]] = {"precision": round(float(p), 4), "recall": round(float(r), 4), "mAP50": round(float(ap50), 4), "mAP50-95": round(float(ap), 4)}
    return {"split": split, "precision": round(float(b.mp), 4), "recall": round(float(b.mr), 4), "mAP50": round(float(b.map50), 4),
            "mAP50-95": round(float(b.map), 4), "per_class": per_class,
            "images_evaluated": len([p for p in (Path(parse_data_yaml(data_yaml)["path"]) / "images" / split).glob("*") if p.is_file()])}


def export_onnx(weights: Path, imgsz: int) -> Path:
    from ultralytics import YOLO

    return Path(YOLO(str(weights)).export(format="onnx", imgsz=imgsz, simplify=False, dynamic=False, opset=17))


def verify_onnx(pt: Path, onnx: Path, images: List[Path], imgsz: int, conf: float = 0.25) -> Dict[str, Any]:
    """Export is only 'validated' if the ONNX model reproduces the PyTorch detections on real images."""
    from ultralytics import YOLO

    a, b = YOLO(str(pt)), YOLO(str(onnx), task="detect")
    same_count, max_dx, n = 0, 0.0, 0
    for img in images:
        ra = a.predict(str(img), imgsz=imgsz, conf=conf, verbose=False, device="cpu")[0].boxes
        rb = b.predict(str(img), imgsz=imgsz, conf=conf, verbose=False, device="cpu")[0].boxes
        n += 1
        if len(ra) == len(rb):
            same_count += 1
            if len(ra):
                xa = ra.xyxyn.sort(dim=0).values.numpy()
                xb = rb.xyxyn.sort(dim=0).values.numpy()
                max_dx = max(max_dx, float(abs(xa - xb).max()))
    return {"images": n, "same_detection_count": same_count, "max_normalised_box_difference": round(max_dx, 5),
            "ok": n > 0 and same_count == n and max_dx < 0.02}


def register(name: str, best: Path, labels: List[str], imgsz: int, version: str, conf: float) -> None:
    cfg = json.loads(MODELS_JSON.read_text())
    entry = next(m for m in cfg["models"] if m["id"] == "shelf-monitor")
    entry.update({"name": f"Shelf product detector ({name})", "version": version, "path": str(best.relative_to(ROOT / "ai_models")).replace("\\", "/"),
                  "runtime": "ultralytics", "inputSize": imgsz, "labels": labels, "confidenceThreshold": conf, "device": "auto", "enabled": True,
                  "license": LICENSE, "sha256": sha256(best), "notes": f"Fine-tuned on a validated shelf dataset; see {best.parent.parent.name}/model_card.json"})
    MODELS_JSON.write_text(json.dumps(cfg, indent=2))


def harden_image_loading(retries: int = 40, wait_s: float = 15.0) -> None:
    """On Windows the OS commit limit is shared with every other program; when it is momentarily exhausted OpenCV raises "Insufficient memory"
    while decoding one training image and Ultralytics lets that kill the whole run. Waiting for memory to come back and retrying that one image
    (up to ~10 min) turns such a spike into a pause instead of a crash. Nothing about the data or the training changes."""
    import gc

    import cv2
    from ultralytics.data import base

    original = base.imread

    def patient_imread(*args, **kwargs):
        for attempt in range(retries):
            try:
                return original(*args, **kwargs)
            except (cv2.error, MemoryError) as exc:
                if "memory" not in str(exc).lower() and not isinstance(exc, MemoryError):
                    raise
                gc.collect()
                time.sleep(wait_s)
        return original(*args, **kwargs)

    base.imread = patient_imread


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True, type=Path, help="data.yaml produced by ml.shelf.prepare")
    ap.add_argument("--name", required=True)
    ap.add_argument("--base", default=str(ROOT / "ai_models" / "person" / "yolo11n.pt") if (ROOT / "ai_models" / "person" / "yolo11n.pt").exists() else "yolo11n.pt",
                    help="pretrained COCO checkpoint to transfer-learn from (yolo11n fits 6 GB VRAM). The person-detector file is only a starting point here; "
                         "the shelf model is a separate checkpoint and the person detector is never retrained")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--patience", type=int, default=15)
    ap.add_argument("--workers", type=int, default=0, help="data-loader processes (0 = in-process; use 4+ for a large dataset)")
    ap.add_argument("--cache", default="", help="ultralytics image cache: '' (off) | ram | disk")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--allow-untrusted", action="store_true")
    ap.add_argument("--skip-smoke", action="store_true")
    ap.add_argument("--resume", action="store_true", help="continue an interrupted run of the same --name from ml/runs/<name>/weights/last.pt (epoch counter, optimiser state and schedule are restored)")
    ap.add_argument("--export-onnx", action="store_true")
    ap.add_argument("--register", action="store_true")
    ap.add_argument("--min-map50", type=float, default=0.5)
    ap.add_argument("--conf", type=float, default=0.4)
    args = ap.parse_args(argv)

    data_dir = args.data.parent
    audit_path = data_dir / "audit_report.json"
    audit = json.loads(audit_path.read_text()) if audit_path.exists() else {}
    trusted = bool(audit.get("trusted"))
    if not trusted and not args.allow_untrusted:
        print("REFUSING to train: the prepared dataset is not marked trusted (see audit_report.json -> verdict.missing).")
        print(json.dumps(audit.get("verdict", {"missing": ["audit_report.json not found - run ml.shelf.prepare"]}), indent=1))
        return 3
    if args.register and not trusted:
        print("REFUSING --register: an untrusted dataset can never produce a registered model")
        return 3

    import torch
    from ultralytics import YOLO

    harden_image_loading()
    device = "0" if (args.device == "auto" and torch.cuda.is_available()) else ("cpu" if args.device == "auto" else args.device)
    project = ROOT / "ml" / "runs"
    labels = [v for _, v in sorted(parse_data_yaml(args.data)["names"].items())]
    report: Dict[str, Any] = {"name": args.name, "base": args.base, "device": device, "classes": labels, "trusted": trusted, "imgsz": args.imgsz,
                              "epochs_requested": args.epochs, "torch": torch.__version__, "dataset": {"split_sizes": audit.get("split_sizes"), "groups": audit.get("split_groups")}}

    if not args.skip_smoke:  # validate the loop on a couple of batches before spending time on the real run
        t0 = time.perf_counter()
        YOLO(args.base).train(data=str(args.data), epochs=1, imgsz=min(args.imgsz, 320), batch=4, device=device, project=str(project), name=f"{args.name}-smoke",
                              exist_ok=True, workers=0, fraction=0.2, plots=False, verbose=False, seed=args.seed)
        report["smoke_test"] = {"ok": True, "seconds": round(time.perf_counter() - t0, 1)}

    t0 = time.perf_counter()
    last = project / args.name / "weights" / "last.pt"
    if args.resume and last.exists():
        # an interrupted run (power loss, closed session) continues from its last saved epoch; nothing is retrained from scratch
        report["resumed_from"] = str(last.relative_to(ROOT))
        YOLO(str(last)).train(resume=True, workers=args.workers)
    else:
        model = YOLO(args.base)
        model.train(data=str(args.data), epochs=args.epochs, imgsz=args.imgsz, batch=args.batch, device=device, project=str(project), name=args.name,
                    exist_ok=True, workers=args.workers, cache=(args.cache or False), patience=args.patience, seed=args.seed, plots=False, verbose=False)
    report["training_seconds"] = round(time.perf_counter() - t0, 1)  # of THIS invocation (a resumed run adds to epochs already done)
    save_dir = project / args.name
    best = save_dir / "weights" / "best.pt"
    report["losses"] = last_epoch_losses(save_dir)

    out_dir = SHELF_DIR / args.name
    (out_dir / "weights").mkdir(parents=True, exist_ok=True)
    final = out_dir / "weights" / "best.pt"
    final.write_bytes(best.read_bytes())
    report["val"] = evaluate_split(final, args.data, "val", args.imgsz, device)
    report["test"] = evaluate_split(final, args.data, "test", args.imgsz, device)  # held out: used once, after checkpoint selection
    report["weights"] = {"path": str(final.relative_to(ROOT)), "sha256": sha256(final), "bytes": final.stat().st_size}
    (out_dir / "classes.json").write_text(json.dumps({str(i): n for i, n in enumerate(labels)}, indent=1))

    if args.export_onnx:
        try:
            onnx = export_onnx(final, args.imgsz)
            imgs = sorted((data_dir / "images" / "test").glob("*"))[:20]
            report["onnx"] = {"path": str(onnx.relative_to(ROOT)), **verify_onnx(final, onnx, imgs, args.imgsz)}
        except Exception as exc:  # noqa: BLE001
            report["onnx"] = {"ok": False, "error": str(exc)[:300]}

    gate = trusted and report["test"]["mAP50"] >= args.min_map50
    report["registered"] = False
    report["deployment"] = {"input": f"{args.imgsz}px long side, RGB, letterbox", "runtime": "ultralytics (PyTorch) - ONNX export validated: " + str(report.get("onnx", {}).get("ok", "not exported")),
                            "how_to_use": "python -m ml.shelf.train ... --register  (or edit ai_models/configs/models.json shelf-monitor), then restart the vision worker"}
    if args.register:
        if gate:
            register(args.name, final, labels, args.imgsz, args.name, args.conf)
            report["registered"] = True
        else:
            report["registration_refused"] = f"test mAP50 {report['test']['mAP50']} < {args.min_map50} or dataset untrusted"
    (out_dir / "model_card.json").write_text(json.dumps(report, indent=1))
    print(json.dumps({k: report[k] for k in ("name", "trusted", "training_seconds", "val", "test", "registered") if k in report}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
