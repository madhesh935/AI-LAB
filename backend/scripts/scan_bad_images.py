"""Find training images that crash or break the decoder (an access violation inside OpenCV kills the whole training process).

    python scripts/scan_bad_images.py [--split train] [--quarantine]

The scan decodes every image of the prepared SKU-110K split the way Ultralytics does (cv2.imdecode) in a CHILD process. If the child dies, the
image it was on is recorded and the scan continues after it. With --quarantine the offending image and its label are moved to
`<dataset>/quarantine/` (never deleted), so a deterministic crash cannot repeat on every resume. Reports exactly what it found.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
DATA = BACKEND / "data" / "datasets" / "sku110k_prepared"


def child(files_json: str, progress: str, start: int) -> int:
    import cv2
    import numpy as np

    files = json.loads(Path(files_json).read_text())
    bad = []
    for i in range(start, len(files)):
        Path(progress).write_text(str(i))  # recorded BEFORE decoding: if this process dies, this is the culprit
        raw = np.fromfile(files[i], np.uint8)
        im = cv2.imdecode(raw, cv2.IMREAD_COLOR)
        if im is None or im.size == 0 or im.shape[0] < 8 or im.shape[1] < 8:
            bad.append(files[i])
    Path(progress).write_text("done")
    Path(progress + ".bad").write_text(json.dumps(bad))
    return 0


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--child":
        return child(sys.argv[2], sys.argv[3], int(sys.argv[4]))
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="train")
    ap.add_argument("--quarantine", action="store_true")
    a = ap.parse_args()
    img_dir = DATA / "images" / a.split
    files = sorted(str(p) for p in img_dir.iterdir() if p.is_file())
    work = BACKEND / "data" / "logs"
    fl, prog = work / "scan_files.json", work / "scan_progress.txt"
    fl.write_text(json.dumps(files))
    crashed, undecodable, start = [], [], 0
    while start < len(files):
        code = subprocess.call([sys.executable, str(Path(__file__)), "--child", str(fl), str(prog), str(start)])
        state = prog.read_text().strip()
        if state == "done":
            undecodable += json.loads(Path(str(prog) + ".bad").read_text())
            break
        idx = int(state)
        print(f"child exited with code {code} on image #{idx}: {files[idx]}", flush=True)
        crashed.append(files[idx])
        start = idx + 1
    print(json.dumps({"images": len(files), "crashed_decoder": crashed, "undecodable": undecodable}, indent=1))
    if a.quarantine and (crashed or undecodable):
        q = DATA / "quarantine" / a.split
        q.mkdir(parents=True, exist_ok=True)
        for f in crashed + undecodable:
            f = Path(f)
            lab = DATA / "labels" / a.split / (f.stem + ".txt")
            shutil.move(str(f), str(q / f.name))
            if lab.exists():
                shutil.move(str(lab), str(q / lab.name))
        print(f"moved {len(crashed) + len(undecodable)} image(s) (+labels) to {q}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
