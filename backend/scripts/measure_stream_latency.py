"""Measure the live-video latency of the vision worker's MJPEG stream (real, on this machine).

    python scripts/measure_stream_latency.py [--camera cam-store-blr-104-cam-01] [--seconds 15] [--port 8100]

Each MJPEG part carries the capture timestamp of ITS frame (`ts`) and the frame id of the detections drawn on it (`overlay.frameId`, `lagFrames`).
This script reads the stream like a browser would and reports, per frame:
  * capture -> received   (now - ts): camera capture + encode + localhost transfer; the browser decode/paint adds a few ms on top (not measured here)
  * detection lag in frames (overlay.lagFrames) and inference_ms
  * received frame rate
Clock: the worker and this script run on the same machine, so the timestamps are comparable.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import time
import urllib.request
from datetime import datetime, timezone


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--camera", default="cam-store-blr-104-cam-01")
    ap.add_argument("--seconds", type=float, default=15.0)
    ap.add_argument("--port", type=int, default=8100)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    resp = urllib.request.urlopen(f"http://127.0.0.1:{a.port}/stream/{a.camera}.mjpg", timeout=10)
    buf = b""
    lat, lag, inf, stamps, enc = [], [], [], [], []
    end = time.monotonic() + a.seconds
    while time.monotonic() < end:
        chunk = resp.read1(65536)  # read1: return what has arrived instead of waiting to fill the buffer
        if not chunk:
            break
        buf += chunk
        while True:
            h = buf.find(b"\r\n\r\n")
            if h < 0:
                break
            head = buf[:h].decode("ascii", "ignore")
            m = re.search(r"content-length:\s*(\d+)", head, re.I)
            if not m:
                buf = buf[h + 4:]
                continue
            n = int(m.group(1))
            if len(buf) < h + 4 + n + 2:
                break
            meta = re.search(r"x-frame-meta:\s*(.+)", head, re.I)
            buf = buf[h + 4 + n + 2:]
            now = datetime.now(timezone.utc)
            if meta:
                d = json.loads(meta.group(1))
                lat.append((now - datetime.fromisoformat(d["ts"].replace("Z", "+00:00"))).total_seconds() * 1000)
                stamps.append(time.monotonic())
                if d.get("encodedAt"):
                    enc.append((datetime.fromisoformat(d["encodedAt"].replace("Z", "+00:00")) - datetime.fromisoformat(d["ts"].replace("Z", "+00:00"))).total_seconds() * 1000)
                if d.get("overlay"):
                    lag.append(d["overlay"]["lagFrames"])
                    inf.append(d["overlay"]["inferenceMs"])
    resp.close()

    def pct(v, p):
        s = sorted(v)
        return round(s[min(len(s) - 1, int(len(s) * p))], 1) if s else None

    out = {"camera": a.camera, "frames": len(lat), "received_fps": round(len(lat) / a.seconds, 1),
           "capture_to_received_ms": {"median": round(statistics.median(lat), 1) if lat else None, "p95": pct(lat, 0.95), "max": round(max(lat), 1) if lat else None},
           "capture_to_encoded_ms_median": round(statistics.median(enc), 1) if enc else None,
           "detection_lag_frames": {"median": statistics.median(lag) if lag else None, "max": max(lag) if lag else None},
           "inference_ms_median": round(statistics.median(inf), 1) if inf else None}
    print(json.dumps(out, indent=1))
    if a.out:
        open(a.out, "w").write(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
