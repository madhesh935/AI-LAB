"""Measure the real vision pipeline on this machine (nothing simulated).

    python scripts/benchmark_vision.py detector --device auto --frames 300
    python scripts/benchmark_vision.py pipeline --device cuda:0 --cameras 2 --seconds 60
    python scripts/benchmark_vision.py pipeline --device cpu --cameras 1 --seconds 30

`detector` times the model alone on frames of a video file. `pipeline` runs the full engine
(capture threads -> bounded queues -> inference -> ByteTrack -> SQLite persistence) on a throw-away
database and samples FPS, latency, drops, process CPU/RAM and GPU utilisation while it runs.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import psutil  # noqa: E402

from core.config import Settings  # noqa: E402
from vision.device import _nvidia_smi, detect_hardware, select_device  # noqa: E402
from vision.registry import ModelRegistry  # noqa: E402

SAMPLES = ROOT / "data" / "samples"


def pct(values, p):
    return round(float(np.percentile(values, p)), 2) if values else None


def bench_detector(args) -> dict:
    device = select_device(args.device)
    t0 = time.perf_counter()
    reg = ModelRegistry.from_file(device)
    reg.load_all()
    entry = reg.entries["person-yolo11n"]
    load_s = round(time.perf_counter() - t0, 1)
    if entry.status != "READY":
        raise SystemExit(f"model not ready: {entry.last_error}")
    det = entry.instance
    video = SAMPLES / args.video
    cap = cv2.VideoCapture(str(video))
    decode, tot, pre, mdl, post = [], [], [], [], []
    boxes = 0
    n = 0
    proc = psutil.Process()
    proc.cpu_percent(None)
    wall0 = time.perf_counter()
    while n < args.frames:
        t = time.perf_counter()
        ok, frame = cap.read()
        if not ok:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            continue
        decode.append((time.perf_counter() - t) * 1000)
        r = det.detect(frame)
        tot.append(r.inference_ms), pre.append(r.preprocess_ms), mdl.append(r.model_ms), post.append(r.postprocess_ms)
        boxes += len(r.xyxy)
        n += 1
    wall = time.perf_counter() - wall0
    gpu = _nvidia_smi("utilization.gpu,memory.used")
    skip = 10  # warm-up frames excluded from the percentiles
    return {
        "mode": "detector", "device": device, "path": det.mode, "video": video.name, "frames": n,
        "model_load_seconds": load_s, "throughput_fps": round(n / wall, 1),
        "decode_ms_p50": pct(decode[skip:], 50),
        "latency_ms": {k: {"p50": pct(v[skip:], 50), "p95": pct(v[skip:], 95), "max": round(max(v[skip:]), 2)}
                       for k, v in (("total", tot), ("preprocess", pre), ("model", mdl), ("postprocess", post))},
        "boxes_per_frame": round(boxes / n, 2), "process_cpu_percent": round(proc.cpu_percent(None) / (psutil.cpu_count() or 1), 1),
        "process_rss_mb": round(proc.memory_info().rss / 2**20, 0),
        "gpu_util_percent_end": float(gpu[0]) if gpu else None, "gpu_mem_used_mb_end": float(gpu[1]) if gpu else None,
    }


class NullOutbox:
    sent = dropped = 0

    def __init__(self):
        self.by_type = {}

    def emit(self, type_, *a, **k):
        self.sent += 1
        self.by_type[type_] = self.by_type.get(type_, 0) + 1

    def stop(self):
        pass


def bench_pipeline(args) -> dict:
    from database import manage
    from database.connection import Database
    from database.models import Camera, Store
    from vision.engine import VisionEngine
    from vision.persistence import WorkerStore

    tmp = Path(tempfile.mkdtemp(prefix="retailedge-bench-"))
    settings = Settings(data_dir=tmp / "data", media_dir=SAMPLES, log_json=False, log_level="WARNING",
                        vision_stats_persist_seconds=5.0)
    manage.upgrade(settings)
    db = Database(settings.database_url)
    with db.transaction() as s:
        s.add(Store(id="bench", code="B", name="Bench", max_capacity=10, edge_server_status="disconnected"))
        s.flush()
        for i in range(args.cameras):
            s.add(Camera(id=f"cam-{i + 1}", store_id="bench", camera_code=f"CAM-{i + 1:02d}", name=f"bench {i + 1}",
                         camera_type="aisle", source_type="file", source_ref=args.video, enabled=True, is_demo=True,
                         config={"inferenceFps": args.inference_fps, "playbackSpeed": 1.0}))
    if args.analytics:  # a counting line + an interior zone + a queue region per camera, as data
        from database.models import CameraZone, CheckoutCounter, QueueRegion

        with db.transaction() as s:
            for i in range(args.cameras):
                cid = f"cam-{i + 1}"
                s.add(CameraZone(id=f"line-{i + 1}", store_id="bench", camera_id=cid, name="line", zone_type="entrance", polygon=[],
                                 line={"p1": [0.5, 0.2], "p2": [0.5, 1.0], "inSide": "negative", "margin": 0.025, "minTrackAge": 3, "cooldownSeconds": 2.0}))
                s.add(CameraZone(id=f"zone-{i + 1}", store_id="bench", camera_id=cid, name="room", zone_type="aisle",
                                 polygon=[[0.12, 0.05], [0.88, 0.05], [0.88, 0.78], [0.12, 0.78]], config={}))
                s.flush()
                s.add(CheckoutCounter(id=f"cnt-{i + 1}", store_id="bench", name=f"C{i + 1}", counter_type="standard", status="open", camera_id=cid))
                s.flush()
                s.add(QueueRegion(counter_id=f"cnt-{i + 1}", store_id="bench", camera_id=cid, queue_polygon=[[0.0, 0.5], [0.5, 0.5], [0.5, 1.0], [0.0, 1.0]],
                                  service_polygon=[[0.5, 0.5], [1.0, 0.5], [1.0, 1.0], [0.5, 1.0]]))
    device = select_device(args.device)
    reg = ModelRegistry.from_file(device)
    t0 = time.perf_counter()
    reg.load_all()
    load_s = round(time.perf_counter() - t0, 1)
    if reg.entries["person-yolo11n"].status != "READY":
        raise SystemExit(f"model not ready: {reg.entries['person-yolo11n'].last_error}")
    store = WorkerStore(db, {"inference_fps": args.inference_fps, "stream_fps": 15, "stream_width": 960})
    outbox = NullOutbox()
    engine = VisionEngine(settings, reg, store, outbox, "bench", device)
    engine.start()
    # Optional: attach MJPEG viewers so JPEG encoding is part of the measurement.
    for w in engine.workers.values():
        w.viewers = args.viewers

    proc = psutil.Process()
    proc.cpu_percent(None)
    time.sleep(3)
    samples = []
    end = time.monotonic() + args.seconds
    while time.monotonic() < end:
        time.sleep(2.0)
        rt = [w.runtime() for w in engine.workers.values()]
        res = engine.sampler.latest()
        samples.append({
            "input_fps": [r.input_fps for r in rt], "inference_fps": [r.inference_fps for r in rt],
            "inference_ms": [r.inference_ms for r in rt], "dropped": [r.dropped_frames for r in rt],
            "states": [r.state for r in rt], "rss_mb": res.process_rss_mb, "cpu": res.process_cpu_percent,
            "gpu_util": res.gpu_util_percent, "gpu_mem": res.gpu_mem_used_mb,
        })
    final = [w.runtime() for w in engine.workers.values()]
    people = [w.people_count for w in engine.workers.values()]
    engine.stop()
    db.dispose()

    def flat(key):
        return [x for s in samples for x in (s[key] if isinstance(s[key], list) else [s[key]]) if x is not None]

    return {
        "mode": "pipeline", "device": device, "cameras": args.cameras, "viewers_per_camera": args.viewers,
        "seconds": args.seconds, "video": args.video, "model_load_seconds": load_s,
        "input_fps_mean": round(statistics.mean(flat("input_fps")), 1) if flat("input_fps") else None,
        "inference_fps_per_camera_mean": round(statistics.mean(flat("inference_fps")), 1) if flat("inference_fps") else None,
        "inference_ms_median": round(statistics.median(flat("inference_ms")), 1) if flat("inference_ms") else None,
        "inference_ms_max_window_median": round(max(flat("inference_ms")), 1) if flat("inference_ms") else None,
        "dropped_frames_total": sum(r.dropped_frames for r in final), "reconnects": sum(r.reconnects for r in final),
        "all_live_throughout": all(st == "live" for s in samples for st in s["states"]),
        "process_cpu_percent_mean": round(statistics.mean(flat("cpu")), 1) if flat("cpu") else None,
        "process_rss_mb_start_end": [flat("rss_mb")[0], flat("rss_mb")[-1]] if flat("rss_mb") else None,
        "gpu_util_percent_mean": round(statistics.mean(flat("gpu_util")), 1) if flat("gpu_util") else None,
        "gpu_mem_used_mb_max": max(flat("gpu_mem")) if flat("gpu_mem") else None,
        "analytics_enabled": bool(args.analytics), "events_emitted": outbox.sent, "events_by_type": dict(sorted(outbox.by_type.items())), "last_people_counts": people, "db_write_errors": store.errors,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("mode", choices=["detector", "pipeline"])
    ap.add_argument("--device", default="auto")
    ap.add_argument("--video", default="people-detection.mp4")
    ap.add_argument("--frames", type=int, default=300)
    ap.add_argument("--cameras", type=int, default=1)
    ap.add_argument("--seconds", type=int, default=30)
    ap.add_argument("--inference-fps", type=float, default=15.0)
    ap.add_argument("--viewers", type=int, default=0, help="simulated MJPEG viewers per camera (enables JPEG encoding)")
    ap.add_argument("--torch-threads", type=int, default=0, help="CPU inference threads (0 = library default)")
    ap.add_argument("--analytics", action="store_true", help="enable line/zone/queue analytics on every benchmark camera")
    ap.add_argument("--json", action="store_true", help="print JSON only")
    args = ap.parse_args()
    if args.torch_threads:
        import torch

        torch.set_num_threads(args.torch_threads)
    result = bench_detector(args) if args.mode == "detector" else bench_pipeline(args)
    if not args.json:
        print(json.dumps({"hardware": {k: v for k, v in detect_hardware().items() if k in ("cpu", "cpu_cores_logical", "ram_total_gb", "nvidia_gpu")}}, indent=1))
    print(json.dumps(result, indent=1))


if __name__ == "__main__":
    main()
