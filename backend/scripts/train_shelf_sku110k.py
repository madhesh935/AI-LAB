"""Unattended pipeline: download SKU-110K -> extract/convert -> train the shelf detector -> evaluate counts -> register (only if the gates pass).

    python scripts/train_shelf_sku110k.py [--epochs 30] [--skip-download]

Every step logs to data/logs/shelf_train.log. Nothing is claimed that was not measured: the model card (ai_models/shelf/<name>/model_card.json) holds the
real validation/test numbers, and ml.shelf.train only registers the model in ai_models/configs/models.json if the TEST mAP50 gate passes.
Safe to re-run: the download resumes, extraction/conversion are skipped when already done.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
URL = "http://trax-geometry.s3.amazonaws.com/cvpr_challenge/SKU110K_fixed.tar.gz"
DATA = BACKEND / "data" / "datasets"
ARCHIVE = DATA / "SKU110K_fixed.tar.gz"
PREPARED = DATA / "sku110k_prepared"
LOG = BACKEND / "data" / "logs" / "shelf_train.log"


def log(msg: str) -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def remote_size() -> int:
    req = urllib.request.Request(URL, method="HEAD")
    with urllib.request.urlopen(req, timeout=60) as r:
        return int(r.headers["Content-Length"])


def download() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    want = remote_size()
    for attempt in range(1, 50):
        have = ARCHIVE.stat().st_size if ARCHIVE.exists() else 0
        if have == want:
            log(f"archive complete ({have} bytes)")
            return
        log(f"downloading (attempt {attempt}): {have / 1e6:.0f} of {want / 1e6:.0f} MB")
        subprocess.run(["curl", "-L", "-C", "-", "--retry", "10", "--retry-delay", "5", "-s", "-o", str(ARCHIVE), URL], check=False)
    raise SystemExit("download did not complete")


def run(cmd: list, name: str) -> int:
    log(f"RUN {name}: {' '.join(cmd)}")
    with (BACKEND / "data" / "logs" / f"shelf_{name}.log").open("ab") as fh:
        rc = subprocess.run(cmd, cwd=BACKEND, stdout=fh, stderr=subprocess.STDOUT).returncode
    log(f"{name} exit code {rc}")
    return rc


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--batch", type=int, default=12)
    ap.add_argument("--name", default="shelf-sku110k-v1")
    ap.add_argument("--skip-download", action="store_true")
    args = ap.parse_args()
    py = sys.executable
    if not args.skip_download:
        download()
    if not (PREPARED / "audit_report.json").exists():
        if run([py, "-m", "ml.shelf.sku110k", "--archive", str(ARCHIVE), "--out", str(PREPARED)], "convert") != 0:
            return 2
    rc = run([py, "-m", "ml.shelf.train", "--data", str(PREPARED / "data.yaml"), "--name", args.name, "--epochs", str(args.epochs), "--batch", str(args.batch),
              "--workers", "0", "--imgsz", "512", "--patience", "8", "--skip-smoke", "--export-onnx", "--register", "--min-map50", "0.5", "--conf", "0.3"]
             + (["--resume"] if (BACKEND / "ml" / "runs" / args.name / "weights" / "last.pt").exists() else []), "train")
    if rc != 0:
        return rc
    weights = BACKEND / "ai_models" / "shelf" / args.name / "weights" / "best.pt"
    run([py, "-m", "ml.shelf.evaluate_counts", "--weights", str(weights), "--data", str(PREPARED / "data.yaml"), "--split", "test", "--conf", "0.3", "--device", "0",
         "--out", str(BACKEND / "ai_models" / "shelf" / args.name / "count_eval_test.json")], "counts")
    log("pipeline finished; see ai_models/shelf/%s/model_card.json" % args.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
