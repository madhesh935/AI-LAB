"""TEST 1 - camera to dashboard, through REAL separate processes (API + vision worker) on a scratch database.

    python scripts/e2e_pipeline.py [--device auto|cuda:0|cpu] [--keep]

Input: data/samples/people-detection.mp4 (CC BY 4.0 prerecorded clip, shown as DEMO footage - NOT a live CCTV feed) with manual ground truth
data/samples/ground_truth/people-detection.json (3 line crossings: 1 in, 2 out; a small smoke-level truth set).

Chain exercised: video file -> real YOLO11n person detector -> ByteTrack -> entrance line -> central event engine -> SQLite -> WebSocket -> REST
(`/overview`, `/shopper-analytics`, `/occupancy`). Measured: crossing counts vs ground truth, event timing, WebSocket delivery delay.
It uses its own ports (8010/8110) and a temp data directory; it never touches the real database.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
PY = BACKEND / ".venv" / "Scripts" / "python.exe"
if not PY.exists():
    PY = Path(sys.executable)
API, WORKER = 8010, 8110
STORE, CAM = "store-blr-104", "cam-store-blr-104-cam-01"


def req(method, path, body=None, timeout=10):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"http://127.0.0.1:{API}{path}", data=data, method=method, headers={"content-type": "application/json"})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read() or b"null")


def wait(fn, secs, every=0.5):
    end = time.monotonic() + secs
    while time.monotonic() < end:
        try:
            v = fn()
            if v:
                return v
        except Exception:  # noqa: BLE001
            pass
        time.sleep(every)
    return None


async def listen(seconds: float, sink: list) -> None:
    import websockets  # type: ignore

    async with websockets.connect(f"ws://127.0.0.1:{API}/ws/stores/{STORE}/events", max_size=2**22) as ws:
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=1.0))
            except asyncio.TimeoutError:
                continue
            sink.append((time.time(), msg))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default="auto")
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--out", default=str(BACKEND / "docs" / "eval" / "pipeline_e2e.json"))
    args = ap.parse_args()
    tmp = Path(tempfile.mkdtemp(prefix="retailedge-e2e-"))
    env = {**os.environ, "RETAILEDGE_DATA_DIR": str(tmp), "RETAILEDGE_MEDIA_DIR": str(BACKEND / "data" / "samples"), "RETAILEDGE_PORT": str(API), "RETAILEDGE_VISION_WORKER_PORT": str(WORKER),
           "RETAILEDGE_VISION_PUBLIC_URL": f"http://127.0.0.1:{WORKER}", "RETAILEDGE_API_INTERNAL_URL": f"http://127.0.0.1:{API}", "RETAILEDGE_LOG_JSON": "false", "PYTHONPATH": str(BACKEND),
           "RETAILEDGE_COPILOT_PROVIDER": "none"}
    procs = []
    result: dict = {"input": "people-detection.mp4 (prerecorded, DEMO footage)", "groundTruth": {"entries": 1, "exits": 2, "crossings": 3}}
    try:
        subprocess.run([str(PY), "-m", "database.manage", "setup"], cwd=BACKEND, env=env, capture_output=True, check=True)
        subprocess.run([str(PY), "-m", "database.manage", "seed-demo"], cwd=BACKEND, env=env, capture_output=True, check=True)
        procs.append(subprocess.Popen([str(PY), "run.py"], cwd=BACKEND, env=env, stdout=open(tmp / "api.log", "wb"), stderr=subprocess.STDOUT))
        if not wait(lambda: req("GET", "/api/health"), 40):
            raise SystemExit("API did not start")
        procs.append(subprocess.Popen([str(PY), "-m", "vision", "--device", args.device], cwd=BACKEND, env=env, stdout=open(tmp / "worker.log", "wb"), stderr=subprocess.STDOUT))
        if not wait(lambda: json.loads(urllib.request.urlopen(f"http://127.0.0.1:{WORKER}/health", timeout=2).read()), 150):
            raise SystemExit("vision worker did not start (see " + str(tmp / "worker.log") + ")")
        # the detector must be loaded BEFORE the clip starts (CUDA init + warm-up takes ~25 s), otherwise the 50 s clip is partly played unseen
        health = wait(lambda: (lambda h: h if h.get("modelsReady", 0) >= 1 else None)(json.loads(urllib.request.urlopen(f"http://127.0.0.1:{WORKER}/health", timeout=2).read())), 180)
        if not health:
            raise SystemExit("the person detector did not become READY (see " + str(tmp / "worker.log") + ")")
        result["worker"] = health
        # configure: file source (flagged DEMO) + entrance counting line, as DATA
        req("PUT", f"/api/cameras/{CAM}/source", {"sourceType": "file", "sourceRef": "people-detection.mp4", "enabled": True, "isDemo": True, "loop": False})
        req("POST", f"/api/stores/{STORE}/camera-zones", {"cameraId": CAM, "name": "Main entrance", "zoneType": "entrance", "line": {"p1": [0.5, 0.2], "p2": [0.5, 1.0], "insidePoint": [0.9, 0.6]}})
        req("POST", "/api/vision/reload", {})
        base_ov = req("GET", f"/api/stores/{STORE}/overview")["metrics"]
        result["footfallBefore"] = base_ov["totalFootfallToday"]
        sink: list = []
        t0 = time.time()
        listener = asyncio.run_coroutine_threadsafe if False else None  # (kept simple: run the listener in the foreground below)
        _ = listener
        live = wait(lambda: req("GET", f"/api/cameras/{CAM}")["status"] == "live", 60)
        result["cameraBecameLiveAfterSeconds"] = round(time.time() - t0, 1) if live else None
        asyncio.run(listen(70, sink))  # the clip is ~50 s at 12 fps
        # collect what the system recorded
        occ = req("GET", f"/api/stores/{STORE}/occupancy")
        ov = req("GET", f"/api/stores/{STORE}/overview")["metrics"]
        sa = req("GET", f"/api/stores/{STORE}/shopper-analytics?range=today")
        ev = req("GET", f"/api/stores/{STORE}/footfall/events") if True else {}
        crossings = [m for _, m in sink if m.get("type") == "footfall.updated"]
        delays = []
        for at, m in sink:
            if m.get("type") in ("footfall.updated", "occupancy.updated"):
                try:
                    src = datetime.fromisoformat(m["timestamp"].replace("Z", "+00:00")).timestamp()
                    delays.append(round(at - src, 3))
                except Exception:  # noqa: BLE001
                    pass
        types: dict = {}
        for _, m in sink:
            types[m.get("type")] = types.get(m.get("type"), 0) + 1
        result.update({
            "websocketEventTypes": types, "footfallUpdatedEvents": len(crossings), "occupancy": {k: occ.get(k) for k in ("estimate", "status", "entriesSinceReset", "exitsSinceReset", "reason")},
            "overview": {k: ov.get(k) for k in ("totalFootfallToday", "currentOccupancy", "occupancyStatus", "latestObservationAt")},
            "shopperAnalytics": {"totalEntries": sa.get("totalEntries"), "totalExits": sa.get("totalExits"), "dataState": sa["meta"]["dataState"]},
            "crossingEventsInSQLite": len(ev.get("items", ev)) if isinstance(ev, (dict, list)) else None,
            "websocketDelaySeconds": {"n": len(delays), "median": sorted(delays)[len(delays) // 2] if delays else None, "max": max(delays) if delays else None},
        })
        gt_e, gt_x = 1, 2
        result["verdict"] = {
            "entryErrorVsTruth": (occ.get("entriesSinceReset") or 0) - gt_e, "exitErrorVsTruth": (occ.get("exitsSinceReset") or 0) - gt_x,
            "overviewMatchesOccupancy": ov.get("totalFootfallToday") == (sa.get("totalEntries")), "note": "one 50 s clip with 3 crossings: a smoke-level check, not an accuracy estimate",
        }
    finally:
        for p in procs:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True)
            else:
                p.terminate()
        if not args.keep:
            time.sleep(1)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=1, default=str), encoding="utf-8")
    print(json.dumps(result, indent=1, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
