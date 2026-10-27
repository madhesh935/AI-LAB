"""Capture workers (one thread per camera) + one shared inference thread + housekeeping.

Data flow per camera:
    source -> CameraWorker thread -> FrameQueue(bounded, drop-oldest) -> inference thread
                     |                                                      |
                     +--> JPEG for MJPEG viewers (only while someone watches)  +--> ByteTrack -> DetectionFrame
All stats exposed by this module are measured; nothing is simulated. Without a READY model a
camera still streams video, but no detections are produced.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional

import cv2
import numpy as np

from core.config import Settings
from vision.device import ResourceSampler, detect_hardware
from vision.outbox import EventOutbox
from vision.persistence import CameraConfig, WorkerStore
from vision.registry import ModelEntry, ModelRegistry
from vision.schemas import (
    CameraRuntime, DetectionFrame, NormBox, PixelBox, TrackedPerson, WorkerStatus,
)
from vision.sources import SourceError, open_capture, redact
from vision.tracker import CameraTracker
from analytics.shelf import Det, StockState, compare_planogram, sample_shelf
from vision.analytics_runtime import CameraAnalytics, CameraAnalyticsConfig, TrackIn

TRACK_FLOOR_CONF = 0.12
log = logging.getLogger("retailedge.vision.engine")

PERSON_TASK = "person_detection"
SHELF_TASK = "shelf_monitoring"
MAX_CONSECUTIVE_READ_FAILS = 25
QUEUE_SIZE = 2


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Frame:
    frame_id: int
    captured_at: datetime
    image: np.ndarray


class FrameQueue:
    """Bounded queue that drops the OLDEST frame when full (a live feed must prefer fresh frames)."""

    def __init__(self, maxsize: int = QUEUE_SIZE):
        self._dq: Deque[Frame] = deque(maxlen=maxsize)
        self._lock = threading.Lock()
        self.dropped = 0

    def put(self, frame: Frame) -> None:
        with self._lock:
            if len(self._dq) == self._dq.maxlen:
                self.dropped += 1
            self._dq.append(frame)

    def pop_latest(self) -> Optional[Frame]:
        """Newest frame; any older queued frames are skipped and counted as dropped."""
        with self._lock:
            if not self._dq:
                return None
            frame = self._dq.pop()
            self.dropped += len(self._dq)
            self._dq.clear()
            return frame

    def clear(self) -> None:
        with self._lock:
            self._dq.clear()


class _Rate:
    """Events-per-second over a short sliding window."""

    def __init__(self, window: float = 3.0):
        self.window, self._t = window, deque()

    def tick(self, now: Optional[float] = None) -> None:
        now = now or time.monotonic()
        self._t.append(now)
        self._trim(now)

    def _trim(self, now: float) -> None:
        while self._t and now - self._t[0] > self.window:
            self._t.popleft()

    def value(self) -> Optional[float]:
        now = time.monotonic()
        self._trim(now)
        if len(self._t) < 2:
            return None
        span = self._t[-1] - self._t[0]
        return round((len(self._t) - 1) / span, 1) if span > 0 else None


@dataclass
class StreamFrame:
    seq: int
    jpeg: bytes
    meta: str  # compact JSON describing this exact frame (+ the overlay that applies to it)


class CameraWorker:
    def __init__(self, cfg: CameraConfig, engine: "VisionEngine"):
        self.cfg = cfg
        self.engine = engine
        self.queue = FrameQueue()
        self.tracker = CameraTracker()
        self.state = "offline"
        self.message: Optional[str] = None
        self.error_code: Optional[str] = None
        self.frame_w: Optional[int] = None
        self.frame_h: Optional[int] = None
        self.reconnects = 0
        self.frame_id = 0
        self.last_frame_at: Optional[datetime] = None
        self.last_inference_at: Optional[datetime] = None
        self.last_infer_mono = 0.0
        self.inference_ms: Optional[float] = None  # median of the last 50 inferences
        self._inf_samples: Deque[float] = deque(maxlen=50)
        self.people_count: Optional[int] = None
        self.last_result: Optional[DetectionFrame] = None
        self.last_image: Optional[np.ndarray] = None
        self.in_rate, self.inf_rate = _Rate(), _Rate()
        self.viewers = 0
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._was_live = False
        self._announced: set[int] = set()
        self._last_event_mono = 0.0
        self._last_encode_mono = 0.0
        self.last_persist_mono = 0.0
        self.consecutive_infer_errors = 0
        # MJPEG hand-off
        self._stream_cond = threading.Condition()
        self._stream: Optional[StreamFrame] = None
        self._stream_seq = 0
        self._reconnect_now = threading.Event()
        # Phase 3
        self.acfg: Optional[CameraAnalyticsConfig] = None
        self.analytics: Optional[CameraAnalytics] = None
        self.shelf_state: Dict[str, StockState] = {}
        self.shelf_due: Dict[str, float] = {}
        self.shelf_counts: Dict[str, int] = {}  # shelf id -> items counted in the latest sample (for the live overlay)
        self.shelf_boxes: Dict[str, list] = {}

    def set_analytics(self, cfg: Optional[CameraAnalyticsConfig]) -> List[Dict[str, Any]]:
        """Swap in new zone/line/queue/shelf configuration. Returns events to flush from the old runtime (heatmap samples)."""
        flushed: List[Dict[str, Any]] = []
        if self.analytics is not None:
            flushed = self.analytics.flush(utcnow())
        self.acfg = cfg
        self.analytics = CameraAnalytics(cfg) if cfg is not None and cfg.has_people_analytics else None
        self.shelf_state = {k: v for k, v in self.shelf_state.items() if cfg and any(s.cfg.shelf_id == k for s in cfg.shelves)}
        return flushed

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> None:
        if not self.cfg.enabled or not self.cfg.source_ref or self.cfg.source_type == "unconfigured":
            self._set_state("offline", "Camera source not configured" if self.cfg.source_type == "unconfigured" else "Camera disabled",
                            "NOT_CONFIGURED" if self.cfg.source_type == "unconfigured" else "DISABLED")
            return
        self._thread = threading.Thread(target=self._run, name=f"capture-{self.cfg.camera_code}", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 8.0) -> None:
        self._stop.set()
        self._reconnect_now.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout)
        with self._stream_cond:
            self._stream_cond.notify_all()

    def request_reconnect(self) -> None:
        self._reconnect_now.set()

    # ------------------------------------------------------------------ state
    def _set_state(self, new: str, message: Optional[str] = None, code: Optional[str] = None) -> None:
        message = redact(message)
        if new == self.state and code == self.error_code and message == self.message:
            return
        old, changed = self.state, new != self.state
        self.state, self.message, self.error_code = new, message, code
        if changed:
            self.engine.on_transition(self, old, new, message, code)

    @property
    def inference_active(self) -> bool:
        return self.state == "live"

    # ------------------------------------------------------------------ capture loop
    def _run(self) -> None:
        cfg, fails, backoff, first = self.cfg, 0, 1.0, True
        while not self._stop.is_set():
            self._reconnect_now.clear()
            if first:
                self._set_state("connecting", "Connecting to source…")
            elif self.state != "offline":  # a camera that is already offline keeps retrying quietly (no state flapping)
                self._set_state("reconnecting", "Reconnecting…")
            first = False
            try:
                cap = open_capture(cfg.source_type, cfg.source_ref or "", self.engine.media_roots)
            except SourceError as exc:
                if exc.fatal:
                    self._set_state("error", exc.message, exc.code)
                    return  # configuration problem: retrying cannot help; fix the source and reload
                fails += 1
                self._set_state("offline" if fails >= 3 else "reconnecting", exc.message, exc.code)
                self._stop.wait(backoff)
                backoff = min(backoff * 2, 30.0)
                continue
            except Exception as exc:  # noqa: BLE001  (OpenCV/FFmpeg can raise unexpectedly)
                fails += 1
                self._set_state("offline" if fails >= 3 else "reconnecting", f"Unexpected open error: {type(exc).__name__}", "CONNECT_FAILED")
                self._stop.wait(backoff)
                backoff = min(backoff * 2, 30.0)
                continue

            try:
                fails, backoff = 0, 1.0
                outcome = self._read_loop(cap)
            except Exception as exc:  # noqa: BLE001  (a decoder error must not leave a dead thread showing 'live')
                log.exception("capture loop for %s crashed", self.cfg.camera_code)
                self._set_state("reconnecting", f"Capture error ({type(exc).__name__})", "CAPTURE_ERROR")
                outcome = "lost"
            finally:
                cap.release()  # always free the device / socket / file handle
            if outcome == "eof":
                return
            if self._stop.is_set():
                break
            self.reconnects += 1
            self.tracker.reset()  # IDs must not carry over a reconnect
            self._announced.clear()
            if self.analytics is not None:
                self.analytics.reset()
            self.queue.clear()
            self._stop.wait(min(backoff, 2.0))
        if self.state not in ("error",):
            self._set_state("offline", "Stopped", "STOPPED")

    def _read_loop(self, cap: cv2.VideoCapture) -> str:
        cfg = self.cfg
        file_fps = cap.get(cv2.CAP_PROP_FPS) if cfg.source_type == "file" else 0.0
        file_fps = file_fps if file_fps and 1 < file_fps < 240 else 25.0
        period = 1.0 / file_fps
        next_due = time.monotonic()
        fails = 0
        got_any = False
        while not self._stop.is_set() and not self._reconnect_now.is_set():
            ok, img = cap.read()
            if not ok or img is None:
                if cfg.source_type == "file":
                    if not got_any:
                        self._set_state("error", "Video file has no readable frames", "SOURCE_UNREADABLE")
                        return "eof"
                    if cfg.loop:
                        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        self.tracker.reset()
                        self._announced.clear()
                        if self.analytics is not None:
                            self.analytics.reset()
                        got_any = False
                        continue
                    self._set_state("offline", "End of video", "END_OF_FILE")
                    return "eof"
                fails += 1
                if fails >= MAX_CONSECUTIVE_READ_FAILS:
                    self._set_state("reconnecting", "Stream lost", "STREAM_LOST")
                    return "lost"
                time.sleep(0.04)
                continue
            fails, got_any = 0, True
            now_mono = time.monotonic()
            self.frame_id += 1
            self.in_rate.tick(now_mono)
            h, w = img.shape[:2]
            if (w, h) != (self.frame_w, self.frame_h):
                self.frame_w, self.frame_h = w, h
                self.engine.store.write_resolution(cfg, w, h)
            captured = utcnow()
            self.last_frame_at, self.last_image = captured, img
            if self.state != "live":
                self._was_live = True
                self._set_state("live", None, None)
            self.queue.put(Frame(self.frame_id, captured, img))
            self._publish_stream(img, self.frame_id, captured, now_mono)
            if cfg.source_type == "file" and cfg.playback_speed > 0:  # prerecorded footage plays at its own pace
                next_due += period / cfg.playback_speed
                delay = next_due - time.monotonic()
                if delay > 0:
                    self._stop.wait(delay)
                else:
                    next_due = time.monotonic()
        return "stopped"

    # ------------------------------------------------------------------ MJPEG hand-off
    def _publish_stream(self, img: np.ndarray, frame_id: int, captured: datetime, now_mono: float) -> None:
        if self.viewers <= 0 or now_mono - self._last_encode_mono < 1.0 / max(self.cfg.stream_fps, 1.0):
            return
        self._last_encode_mono = now_mono
        h, w = img.shape[:2]
        out = img
        if w > self.cfg.stream_width:
            out = cv2.resize(img, (self.cfg.stream_width, int(round(h * self.cfg.stream_width / w))), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, self.engine.jpeg_quality])
        if not ok:
            return
        self._stream_seq += 1
        meta = self.engine.frame_meta(self, frame_id, captured, w, h)
        with self._stream_cond:
            self._stream = StreamFrame(self._stream_seq, buf.tobytes(), meta)
            self._stream_cond.notify_all()

    def wait_stream(self, last_seq: int, timeout: float = 3.0) -> Optional[StreamFrame]:
        with self._stream_cond:
            if self._stream is None or self._stream.seq == last_seq:
                self._stream_cond.wait(timeout)
            if self._stream is not None and self._stream.seq != last_seq:
                return self._stream
        return None

    def latest_jpeg(self) -> Optional[bytes]:
        img = self.last_image
        if img is None:
            return None
        h, w = img.shape[:2]
        if w > self.cfg.stream_width:
            img = cv2.resize(img, (self.cfg.stream_width, int(round(h * self.cfg.stream_width / w))), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, self.engine.jpeg_quality])
        return buf.tobytes() if ok else None

    # ------------------------------------------------------------------ inference results
    def runtime(self) -> CameraRuntime:
        return CameraRuntime(
            camera_id=self.cfg.id, camera_code=self.cfg.camera_code, store_id=self.cfg.store_id,
            state=self.state, source_type=self.cfg.source_type, is_demo=self.cfg.is_demo,
            error_code=self.error_code, message=self.message, frame_width=self.frame_w, frame_height=self.frame_h,
            input_fps=self.in_rate.value() if self.state == "live" else None,
            inference_fps=self.inf_rate.value() if self.state == "live" else None,
            inference_ms=self.inference_ms if self.state == "live" else None,
            dropped_frames=self.queue.dropped, reconnects=self.reconnects, last_frame_at=self.last_frame_at,
            last_inference_at=self.last_inference_at, people_count=self.people_count, viewers=self.viewers,
            analytics=({**self.analytics.stats()} if self.analytics is not None else
                       ({"config": self.acfg.summary()} if self.acfg is not None else None)),
        )


class VisionEngine:
    def __init__(self, settings: Settings, registry: ModelRegistry, store: WorkerStore, outbox: EventOutbox,
                 worker_id: str, device: str):
        self.settings, self.registry, self.store, self.outbox = settings, registry, store, outbox
        self.worker_id, self.device = worker_id, device
        self.jpeg_quality = settings.vision_jpeg_quality
        self.media_roots: List[Path] = [settings.data_dir / "samples", settings.media_dir]
        self.workers: Dict[str, CameraWorker] = {}
        self._raw_cache: Optional[tuple] = None  # (image, detections, model id) of the last inference: shared webcams are detected once per frame
        self.started_at = utcnow()
        self.hardware = detect_hardware()
        self.sampler = ResourceSampler()
        self._stop = threading.Event()
        self._lock = threading.RLock()
        self._threads: List[threading.Thread] = []
        self._last_health_mono = 0.0
        self._next_reload_mono = 0.0
        self._event_period = 1.0 / max(settings.vision_event_hz, 0.1)

    # ------------------------------------------------------------------ control
    def start(self) -> None:
        self.sampler.start()
        self.reload()
        for target, name in ((self._inference_loop, "inference"), (self._housekeeping_loop, "housekeeping")):
            t = threading.Thread(target=target, name=name, daemon=True)
            t.start()
            self._threads.append(t)

    def stop(self) -> None:
        self._stop.set()
        with self._lock:
            workers = list(self.workers.values())
        for w in workers:
            w.stop()
        for t in self._threads:
            t.join(3)
        self.sampler.stop()
        self.outbox.stop()

    def reload(self) -> Dict[str, int]:
        """Reconcile running workers with the cameras table. Only changed sources restart."""
        configs = {c.id: c for c in self.store.load_cameras()}
        started = stopped = 0
        with self._lock:
            for cid in list(self.workers):
                if cid not in configs:
                    self.workers.pop(cid).stop()
                    stopped += 1
            for cid, cfg in configs.items():
                cur = self.workers.get(cid)
                if cur is not None and cur.cfg.same_source(cfg):
                    cur.cfg = cfg  # tuning changes (fps/width) apply live
                    continue
                if cur is not None:
                    cur.stop()
                    stopped += 1
                worker = CameraWorker(cfg, self)
                self.workers[cid] = worker
                worker.start()
                started += 1
        self._apply_analytics()
        return {"started": started, "stopped": stopped, "total": len(configs)}

    def _apply_analytics(self) -> None:
        """Push zone / line / queue / shelf configuration (SQLite) into running workers; only changed cameras are rebuilt."""
        try:
            cfgs = self.store.load_analytics()
        except Exception:  # noqa: BLE001
            log.exception("could not load analytics configuration")
            return
        with self._lock:
            workers = list(self.workers.values())
        for w in workers:
            new = cfgs.get(w.cfg.id)
            if (new.digest if new else "") == (w.acfg.digest if w.acfg else ""):
                continue
            for e in w.set_analytics(new):
                self._emit_analytics(w, e)
            log.info("analytics configuration applied to %s: %s", w.cfg.camera_code, new.summary() if new else "none")

    def _emit_analytics(self, w: CameraWorker, e: Dict[str, Any]) -> None:
        self.outbox.emit(e["type"], w.cfg.store_id, w.cfg.id, e["payload"], at=e["at"])

    def get(self, camera_id: str) -> Optional[CameraWorker]:
        return self.workers.get(camera_id)

    # ------------------------------------------------------------------ callbacks
    def on_transition(self, w: CameraWorker, old: str, new: str, message: Optional[str], code: Optional[str]) -> None:
        log.info("camera %s: %s -> %s %s", w.cfg.camera_code, old, new, f"[{code}] {message}" if code else "")
        self.store.record_transition(w.cfg, old, new, message, code)
        base = {"cameraId": w.cfg.id, "cameraCode": w.cfg.camera_code, "state": new, "previousState": old,
                "errorCode": code, "message": message, "isDemo": w.cfg.is_demo}
        if new == "live":
            self.outbox.emit("camera.connected", w.cfg.store_id, w.cfg.id, base)
        elif new in ("offline", "error") or (old == "live" and new == "reconnecting"):
            self.outbox.emit("camera.disconnected", w.cfg.store_id, w.cfg.id, base)

    def on_model_status(self, entry: ModelEntry) -> None:
        self.store.sync_model(entry)
        if entry.status not in ("READY", "ERROR"):
            return
        stores = {w.cfg.store_id for w in self.workers.values()}
        payload = entry.to_status().model_dump(mode="json", by_alias=True)
        for sid in stores:
            self.outbox.emit("model.ready" if entry.status == "READY" else "model.error", sid, None, payload)

    # ------------------------------------------------------------------ per-frame metadata for MJPEG parts
    def frame_meta(self, w: CameraWorker, frame_id: int, captured: datetime, src_w: int, src_h: int) -> str:
        import json

        res = w.last_result
        overlay = None
        if res is not None:
            overlay = {
                "frameId": res.frame_id,
                "lagFrames": max(frame_id - res.frame_id, 0),
                "inferenceMs": res.inference_ms,
                "boxes": [
                    {"id": d.track_id, "c": round(d.confidence, 2),
                     "x": round(d.bbox.x, 4), "y": round(d.bbox.y, 4), "w": round(d.bbox.w, 4), "h": round(d.bbox.h, 4)}
                    for d in res.detections
                ],
            }
        rt = w.runtime()
        return json.dumps({
            "cameraId": w.cfg.id, "frameId": frame_id, "ts": captured.isoformat(), "w": src_w, "h": src_h,
            "isDemo": w.cfg.is_demo, "inferenceFps": rt.inference_fps, "inputFps": rt.input_fps,
            "model": self._model_label(), "overlay": overlay, "context": self._context(w), "encodedAt": utcnow().isoformat(),
        }, separators=(",", ":"))

    def _context(self, w: CameraWorker) -> Optional[Dict[str, Any]]:
        """What THIS camera is for, from its configured geometry (entrance line / checkout lanes / aisle zones / shelf regions), with live counts.

        The same webcam can feed several cameras; each one reports only what its own configuration measures."""
        a = w.acfg
        if a is None or not (a.lines or a.queues or a.zones or a.shelves):
            return None
        from analytics.geometry import point_in_polygon, reference_point

        names = a.names
        dets = w.last_result.detections if w.last_result is not None else []
        feet = [reference_point(d.bbox.x, d.bbox.y, d.bbox.w, d.bbox.h) for d in dets]

        def inside(poly) -> int:
            return sum(1 for p in feet if point_in_polygon(p, poly))

        counter_zones = [z for z in a.zones if a.kinds.get(z.zone_id) == "checkout"]
        area_zones = [z for z in a.zones if a.kinds.get(z.zone_id) != "checkout"]
        exit_line = bool(a.lines) and all(lc.count_only == "out" for lc in a.lines)
        kind = ("exit" if exit_line else "entrance") if a.lines else "queue" if a.queues else "checkout" if counter_zones else "shelf" if a.shelves else "aisle"
        ctx: Dict[str, Any] = {"kind": kind}
        if a.lines:
            lines = []
            for lc, counter in zip(a.lines, w.analytics.counters if w.analytics is not None else []):
                dx, dy = lc.p2[0] - lc.p1[0], lc.p2[1] - lc.p1[1]
                n = (-dy, dx) if lc.in_side == "positive" else (dy, -dx)
                lines.append({"id": lc.line_id, "name": names.get(lc.line_id, lc.line_id), "p1": list(lc.p1), "p2": list(lc.p2), "inDir": [round(n[0], 3), round(n[1], 3)],
                              "in": counter.entries, "out": counter.exits, "countOnly": lc.count_only})
            ctx["lines"] = lines
        if a.queues:
            ctx["queues"] = [{"id": q.counter_id, "name": names.get(q.counter_id, q.counter_id), "poly": [list(p) for p in q.queue_polygon], "n": inside(q.queue_polygon)} for q in a.queues]
        if area_zones:
            ctx["zones"] = [{"id": z.zone_id, "name": names.get(z.zone_id, z.zone_id), "poly": [list(p) for p in z.polygon], "n": inside(z.polygon)} for z in area_zones]
        if counter_zones:  # checkout counters: drawn as numbered markers; n = people standing at the counter now
            ctx["counters"] = [{"id": z.zone_id, "name": names.get(z.zone_id, z.zone_id), "poly": [list(p) for p in z.polygon], "n": inside(z.polygon)} for z in counter_zones]
        if a.shelves:
            ctx["shelves"] = [{"id": s.cfg.shelf_id, "name": names.get(s.cfg.shelf_id, s.cfg.shelf_id), "poly": [list(p) for p in s.cfg.polygon], "n": w.shelf_counts.get(s.cfg.shelf_id)}
                              for s in a.shelves]
            ctx["items"] = [b for sid in w.shelf_boxes for b in w.shelf_boxes[sid]][:300]
            ctx["shelfModel"] = self.registry.get_ready(SHELF_TASK) is not None
        return ctx

    def _model_label(self) -> Optional[str]:
        m = self.registry.get_ready(PERSON_TASK)
        return f"{m.id}@{m.version}" if m else None

    # ------------------------------------------------------------------ inference thread
    def _inference_loop(self) -> None:
        # OpenMP thread counts are per-thread: without this the inference thread oversubscribes the CPU
        # (measured: 196 ms vs 86 ms per frame on CPU) when OpenCV/FFmpeg threads are also busy.
        import psutil
        import torch

        torch.set_num_threads(self.settings.vision_torch_threads or psutil.cpu_count(logical=False) or 4)
        while not self._stop.is_set():
            entry = self.registry.get_ready(PERSON_TASK)
            did = False
            if entry is not None:
                with self._lock:
                    ready = [w for w in self.workers.values() if w.inference_active]
                ready.sort(key=lambda w: w.last_infer_mono)  # least-recently served first
                for w in ready:
                    if self._stop.is_set():
                        break
                    if time.monotonic() - w.last_infer_mono < 1.0 / max(w.cfg.inference_fps, 0.5):
                        continue
                    frame = w.queue.pop_latest()
                    if frame is None:
                        continue
                    did = True
                    try:
                        self._infer_one(w, frame, entry)
                        if w.acfg is not None and w.acfg.shelves:
                            self._shelf_step(w, frame)
                    except Exception:  # noqa: BLE001  (one bad frame must never kill the shared inference thread)
                        log.exception("inference step failed for %s", w.cfg.camera_code)
            if not did:
                self._stop.wait(0.004)

    def _infer_one(self, w: CameraWorker, frame: Frame, entry: ModelEntry) -> None:
        w.last_infer_mono = time.monotonic()
        try:
            cached = self._raw_cache
            if cached is not None and cached[0] is frame.image and cached[2] == entry.id:
                raw = cached[1]  # another camera entry on the same webcam already ran the detector on this exact frame
            else:
                # Detect down to a LOW floor and let ByteTrack decide: its 2nd pass keeps an already-tracked person alive through weak (motion-blurred) detections,
                # while new tracks still need the normal confidence (tracker.new_track_thresh). Filtering at 0.35 first would hide exactly those frames.
                raw = entry.instance.detect(frame.image, conf=min(entry.instance.conf, TRACK_FLOOR_CONF))
                self._raw_cache = (frame.image, raw, entry.id)
            tracks = w.tracker.update(raw.xyxy, raw.conf, raw.cls, frame.captured_at)
        except Exception as exc:  # noqa: BLE001
            w.consecutive_infer_errors += 1
            log.error("inference failed on %s: %s", w.cfg.camera_code, exc)
            if w.consecutive_infer_errors >= 20:
                entry.status, entry.last_error = "ERROR", f"inference failing: {exc}"[:390]
                self.on_model_status(entry)
            return
        w.consecutive_infer_errors = 0
        h, wd = frame.image.shape[:2]
        people = [
            TrackedPerson(
                track_id=t.track_id, confidence=min(max(t.confidence, 0.0), 1.0),
                bbox=NormBox(x=min(max(t.x1 / wd, 0), 1), y=min(max(t.y1 / h, 0), 1),
                             w=min(max((t.x2 - t.x1) / wd, 0), 1), h=min(max((t.y2 - t.y1) / h, 0), 1)),
                bbox_px=PixelBox(x1=round(t.x1, 1), y1=round(t.y1, 1), x2=round(t.x2, 1), y2=round(t.y2, 1)),
                first_seen=t.first_seen, last_seen=t.last_seen, age_frames=t.age_frames,
            )
            for t in tracks
        ]
        result = DetectionFrame(
            event_id=uuid.uuid4().hex, frame_id=frame.frame_id, camera_id=w.cfg.id, store_id=w.cfg.store_id,
            source_timestamp=frame.captured_at, model_id=entry.id, model_version=entry.version,
            frame_width=wd, frame_height=h, detections=people, people_count=len(people),
            inference_ms=raw.inference_ms, is_demo_footage=w.cfg.is_demo,
        )
        w.last_result, w.people_count = result, len(people)
        w._inf_samples.append(raw.inference_ms)
        w.inference_ms = round(float(np.median(w._inf_samples)), 2)
        w.last_inference_at = utcnow()
        w.inf_rate.tick()

        if w.analytics is not None:
            tin = [TrackIn(p.track_id, p.bbox.x, p.bbox.y, p.bbox.w, p.bbox.h, p.age_frames) for p in people]
            for e in w.analytics.process(tin, frame.captured_at):
                self._emit_analytics(w, e)

        # new anonymous tracks -> person.detected (camera-local ids, no identity)
        for p in people:
            if p.track_id not in w._announced:
                w._announced.add(p.track_id)
                self.outbox.emit("person.detected", w.cfg.store_id, w.cfg.id, {
                    "cameraId": w.cfg.id, "frameId": result.frame_id, "modelVersion": entry.version,
                    "track": p.model_dump(mode="json", by_alias=True), "frameWidth": wd, "frameHeight": h,
                })
        if len(w._announced) > 500:
            w._announced = {p.track_id for p in people}
        now = time.monotonic()
        if now - w._last_event_mono >= self._event_period:
            w._last_event_mono = now
            self.outbox.emit("camera.frame", w.cfg.store_id, w.cfg.id, result.model_dump(mode="json", by_alias=True))

    def _shelf_step(self, w: CameraWorker, frame: Frame) -> None:
        """Shelf product counting. Runs ONLY with a READY shelf model; without one nothing is produced (never a fake count)."""
        shelf_model = self.registry.get_ready(SHELF_TASK)
        if shelf_model is None or w.acfg is None:
            return
        now = time.monotonic()
        due = [s for s in w.acfg.shelves if now - w.shelf_due.get(s.cfg.shelf_id, 0.0) >= s.interval_seconds]
        if not due:
            return
        det = shelf_model.instance
        raw = det.detect(frame.image)
        names = det.names if isinstance(det.names, dict) else dict(enumerate(det.names))
        h, wd = frame.image.shape[:2]
        dets = [Det(cls=str(names.get(int(c), int(c))), conf=float(cf), x=float(b[0]) / wd, y=float(b[1]) / h,
                    w=float(b[2] - b[0]) / wd, h=float(b[3] - b[1]) / h) for b, cf, c in zip(raw.xyxy, raw.conf, raw.cls)]
        people = [(p.bbox.x, p.bbox.y, p.bbox.w, p.bbox.h) for p in (w.last_result.detections if w.last_result else [])]
        labels = set(shelf_model.labels or [])
        for s in due:
            sid = s.cfg.shelf_id
            w.shelf_due[sid] = now
            sample = sample_shelf(s.cfg, dets, people, frame.captured_at, model_ready=True)
            state = w.shelf_state.setdefault(sid, StockState(confirm_n=s.cfg.confirm_n))
            confirmed, changed = state.feed(sample.raw_status)
            w.shelf_counts[sid], w.shelf_boxes[sid] = sample.count, [list(b[2:]) for b in sample.boxes[:300]]
            plano = None
            if s.slots:
                pr = compare_planogram(s.slots, dets, labels, s.cfg.polygon, s.cfg.min_conf)
                plano = {"compliancePct": pr.compliance_pct, "supportedSlots": pr.supported_slots, "totalSlots": pr.total_slots, "note": pr.note,
                         "violations": [{"slotId": r.slot_id, "state": r.state, "expected": r.expected, "observed": r.observed}
                                        for r in pr.slots if r.state in ("missing_product", "wrong_category")],
                         "unsupported": [r.slot_id for r in pr.slots if r.state == "unsupported"],
                         "unexpected": [{"class": c, "x": x, "y": y} for c, x, y in pr.unexpected[:20]]}
            self.outbox.emit("shelf.observation", w.cfg.store_id, w.cfg.id, {
                "shelfId": sid, "status": confirmed, "rawStatus": sample.raw_status, "changed": changed, "count": sample.count,
                "perClass": sample.per_class, "meanConfidence": sample.mean_confidence, "availabilityPct": sample.availability_pct,
                "expectedUnits": s.cfg.expected_capacity, "occludedFraction": round(sample.occluded_fraction, 3), "reason": sample.reason,
                "modelId": shelf_model.id, "modelVersion": shelf_model.version, "boxes": [list(b) for b in sample.boxes[:80]],
                "planogram": plano, "observedAt": frame.captured_at.isoformat()}, at=frame.captured_at)

    # ------------------------------------------------------------------ housekeeping
    def _housekeeping_loop(self) -> None:
        interval = self.settings.vision_stats_persist_seconds
        while not self._stop.wait(1.0):
            now = time.monotonic()
            if now >= self._next_reload_mono:
                self._next_reload_mono = now + 5.0
                try:
                    self.reload()
                except Exception:  # noqa: BLE001
                    log.exception("camera reload failed")
            with self._lock:
                workers = list(self.workers.values())
            for w in workers:
                if w._thread is None or now - w.last_persist_mono < interval or w.state == "connecting":  # stubs never touch Phase-1 status rows
                    continue
                w.last_persist_mono = now
                rt = w.runtime()
                self.store.write_stats(
                    w.cfg, state=w.state, input_fps=rt.input_fps, inference_fps=rt.inference_fps,
                    inference_ms=rt.inference_ms, width=rt.frame_width, height=rt.frame_height,
                    last_frame_at=rt.last_frame_at, last_inference_at=rt.last_inference_at,
                    message=w.message, error_code=w.error_code,
                )
            if now - self._last_health_mono >= 60.0:
                self._last_health_mono = now
                entry = self.registry.get_ready(PERSON_TASK)
                if entry is not None:
                    live = [w for w in workers if w.state == "live"]
                    lat = [w.inference_ms for w in live if w.inference_ms is not None]
                    fps = [w.inf_rate.value() for w in live if w.inf_rate.value() is not None]
                    self.store.write_model_health(entry.id, live[0].cfg.store_id if live else None, "ok",
                                                  round(sum(lat) / len(lat), 2) if lat else None,
                                                  round(sum(fps), 1) if fps else None)

    # ------------------------------------------------------------------ status
    def status(self) -> WorkerStatus:
        with self._lock:
            cams = [w.runtime() for w in self.workers.values()]
        return WorkerStatus(
            worker_id=self.worker_id, pid=__import__("os").getpid(), started_at=self.started_at, device=self.device,
            hardware=self.hardware, models=self.registry.statuses(), cameras=cams, resources=self.sampler.latest(),
            api_events_sent=self.outbox.sent, api_events_dropped=self.outbox.dropped,
        )
