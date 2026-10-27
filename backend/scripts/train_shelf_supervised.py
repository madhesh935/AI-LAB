"""Run the SKU-110K shelf training to completion, surviving crashes.

    python scripts/train_shelf_supervised.py [--epochs 10] [--batch 4] [--max-attempts 15]

On this Windows machine the OS commit limit is shared with the IDE, browsers and the dev servers; when it runs out a training process dies
mid-epoch ("Insufficient memory" in OpenCV, access violations). Ultralytics writes `last.pt` after every epoch, so this supervisor simply
re-launches the driver (which auto-resumes from `last.pt`) until the run has produced its final model card, waiting for memory to free up
between attempts. It also keeps Windows from sleeping while it runs. It never fakes a result: the model card is only written by a finished run.
"""

from __future__ import annotations

import argparse
import ctypes
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
NAME = "shelf-sku110k-v1"
CARD = BACKEND / "ai_models" / "shelf" / NAME / "model_card.json"
LAST = BACKEND / "ml" / "runs" / NAME / "weights" / "last.pt"
LOG = BACKEND / "data" / "logs" / "shelf_supervisor.log"
ES_CONTINUOUS, ES_SYSTEM_REQUIRED = 0x80000000, 0x00000001


def log(msg: str) -> None:
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def free_commit_gb() -> float:
    import psutil

    # Windows: available virtual (commit) headroom; psutil.virtual_memory().available is physical, so use the pagefile-aware figure
    class MS(ctypes.Structure):
        _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong), ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong), ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]

    m = MS()
    m.dwLength = ctypes.sizeof(MS)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
    _ = psutil  # imported only to fail early if the venv is incomplete
    return m.ullAvailPageFile / 1e9


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", default="10")
    ap.add_argument("--batch", default="4")
    ap.add_argument("--max-attempts", type=int, default=15)
    ap.add_argument("--min-free-gb", type=float, default=3.0, help="wait for this much free commit memory before (re)starting")
    a = ap.parse_args()

    LOG.parent.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        ctypes.windll.kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)  # no sleep while training; reset when this process exits
    started = time.time()
    for attempt in range(1, a.max_attempts + 1):
        if CARD.exists() and CARD.stat().st_mtime > started:
            break
        waited = 0
        while sys.platform == "win32" and free_commit_gb() < a.min_free_gb and waited < 600:
            if waited == 0:
                log(f"waiting for memory: only {free_commit_gb():.1f} GB commit free (need {a.min_free_gb})")
            time.sleep(15)
            waited += 15
        log(f"attempt {attempt}: starting driver ({'resuming from last.pt' if LAST.exists() else 'fresh'}); commit free {free_commit_gb():.1f} GB")
        cmd = [sys.executable, str(BACKEND / "scripts" / "train_shelf_sku110k.py"), "--epochs", a.epochs, "--batch", a.batch, "--skip-download"]
        proc = subprocess.Popen(cmd, cwd=str(BACKEND))
        try:
            import psutil

            psutil.Process(proc.pid).nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
        except Exception:  # noqa: BLE001
            pass
        code = proc.wait()
        done = CARD.exists() and CARD.stat().st_mtime > started
        log(f"attempt {attempt}: driver exit code {code}; finished={done}")
        if done:
            break
        time.sleep(20)  # let the OS release the dead process's memory
    else:
        log("GAVE UP: max attempts reached without a finished run (last.pt is kept; rerun to continue)")
        return 2
    log(f"DONE: model card written at {CARD}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
