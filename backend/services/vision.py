"""API-side view of the vision worker: truthful camera status, stream descriptors, event relay.

The API never runs inference or touches video. It (a) reads what the worker persisted in SQLite,
(b) asks the worker for live numbers when it is reachable, and (c) relays the worker's metadata
events to the existing WebSocket EventBus. When the worker is not running, configured cameras are
reported as offline (WORKER_OFFLINE) instead of showing a stale 'live'.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.request
from collections import OrderedDict, deque
from typing import Any, Deque, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.config import Settings
from core.errors import InvalidSourceError, NotFoundError
from core.events import event_bus
from database.models import Camera, CameraStatus, CameraStatusEvent, ModelRegistry, StoreZone
from repositories.base import get_or_404
from schemas.vision import (
    CameraLiveOut, CameraSourceUpdate, CameraStatusOut, DetectionHistoryPoint, DetectionsOut, ModelsStatusOut,
    ReloadOut, StreamDescriptor, VisionStatusOut,
)
from services.common import now_utc
from vision.source_validation import SourceError, validate_source

log = logging.getLogger("retailedge.vision.api")

HISTORY = 120
FRESH_SECONDS = 6.0


class WorkerClient:
    """Tiny loopback client with a short cache so list endpoints don't hammer the worker."""

    def __init__(self, base_url: str):
        self.base = base_url.rstrip("/")
        self._health: Optional[Dict[str, Any]] = None
        self._checked = 0.0
        self._rt: Dict[str, Dict[str, Any]] = {}
        self._rt_at = 0.0
        self._lock = threading.Lock()

    def _get(self, path: str, timeout: float = 0.6) -> Optional[Dict[str, Any]]:
        try:
            with urllib.request.urlopen(self.base + path, timeout=timeout) as r:
                return json.loads(r.read())
        except Exception:  # noqa: BLE001
            return None

    def health(self) -> Optional[Dict[str, Any]]:
        with self._lock:
            if time.monotonic() - self._checked < 1.5:
                return self._health
        result = self._get("/health")
        with self._lock:
            self._health, self._checked = result, time.monotonic()
        return result

    def online(self) -> bool:
        return self.health() is not None

    def status(self) -> Optional[Dict[str, Any]]:
        return self._get("/status", timeout=1.5)

    def runtimes(self) -> Dict[str, Dict[str, Any]]:
        """Live per-camera numbers straight from the worker (cached ~1 s). Empty when it is down."""
        with self._lock:
            if time.monotonic() - self._rt_at < 1.0:
                return self._rt
        data = self._get("/cameras", timeout=1.0)  # type: ignore[assignment]
        rt = {c["cameraId"]: c for c in data} if isinstance(data, list) else {}
        with self._lock:
            self._rt, self._rt_at = rt, time.monotonic()
        return rt

    def post(self, path: str) -> Optional[Dict[str, Any]]:
        req = urllib.request.Request(self.base + path, data=b"", method="POST")
        try:
            with urllib.request.urlopen(req, timeout=2.0) as r:
                return json.loads(r.read())
        except Exception:  # noqa: BLE001
            return None

    def forget(self) -> None:
        with self._lock:
            self._checked = 0.0
            self._rt_at = 0.0


class VisionState:
    """In-memory cache of the worker's recent metadata events (bounded; the DB stays the record)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.latest: Dict[str, Dict[str, Any]] = {}
        self.latest_at: Dict[str, float] = {}
        self.history: Dict[str, Deque[Dict[str, Any]]] = {}
        self._seen: "OrderedDict[str, None]" = OrderedDict()
        self.accepted = 0
        self.duplicates = 0

    def reset(self) -> None:
        with self._lock:
            self.latest.clear(), self.latest_at.clear(), self.history.clear(), self._seen.clear()
            self.accepted = self.duplicates = 0

    def accept(self, event: Dict[str, Any]) -> bool:
        eid = event["eventId"]
        with self._lock:
            if eid in self._seen:
                self.duplicates += 1
                return False
            self._seen[eid] = None
            while len(self._seen) > 5000:
                self._seen.popitem(last=False)
            self.accepted += 1
            if event["type"] == "camera.frame" and event.get("cameraId"):
                cid, p = event["cameraId"], event["payload"]
                self.latest[cid] = p
                self.latest_at[cid] = time.monotonic()
                self.history.setdefault(cid, deque(maxlen=HISTORY)).append({
                    "frameId": p["frameId"], "sourceTimestamp": p["sourceTimestamp"],
                    "peopleCount": p["peopleCount"], "inferenceMs": p["inferenceMs"],
                })
        return True

    def fresh_latest(self, camera_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            at = self.latest_at.get(camera_id)
            if at is None or time.monotonic() - at > FRESH_SECONDS:
                return None
            return self.latest.get(camera_id)

    def history_for(self, camera_id: str, limit: int) -> List[Dict[str, Any]]:
        with self._lock:
            return list(self.history.get(camera_id, []))[-limit:]


vision_state = VisionState()


class VisionService:
    def __init__(self, db: Session, settings: Settings, client: Optional[WorkerClient] = None):
        self.db, self.settings = db, settings
        self.client = client or worker_client_for(settings)

    # ------------------------------------------------------------------ cameras
    def _stream(self, cam: Camera, configured: bool, online: bool, state: str) -> StreamDescriptor:
        base = self.settings.vision_public_url.rstrip("/")
        if not configured or not cam.enabled:
            return StreamDescriptor(kind="none", available=False, is_demo=cam.is_demo,
                                    reason="Camera source not configured" if not configured else "Camera disabled")
        if not online:
            return StreamDescriptor(kind="none", available=False, is_demo=cam.is_demo, reason="Vision worker is not running")
        return StreamDescriptor(
            kind="mjpeg", available=state in ("live", "connecting", "reconnecting"),
            url=f"{base}/stream/{cam.id}.mjpg", snapshot_url=f"{base}/snapshot/{cam.id}.jpg",
            content_type="multipart/x-mixed-replace", overlay="per-frame-header", is_demo=cam.is_demo,
            reason=None if state == "live" else f"Camera is {state}",
            alternatives=[],  # WebRTC/HLS need MediaMTX+FFmpeg, which are not installed (see docs)
        )

    def _live_out(self, cam: Camera, status: Optional[CameraStatus], zone: Optional[StoreZone], online: bool) -> CameraLiveOut:
        configured = cam.source_type != "unconfigured" and bool(cam.source_ref)
        state = status.state if status and status.state != "unknown" else "offline"
        code, message = (status.error_code, status.message) if status else (None, None)
        if not configured:
            state, code, message = "offline", "NOT_CONFIGURED", "Camera source not configured"
        elif not cam.enabled:
            state, code, message = "offline", "DISABLED", "Camera disabled"
        elif not online:
            state, code, message = "offline", "WORKER_OFFLINE", "Vision worker is not running"
        rt = self.client.runtimes().get(cam.id) if (configured and cam.enabled and online) else None
        if rt is not None:  # the worker's own view is fresher than the last DB write
            state, code, message = rt["state"], rt.get("errorCode"), rt.get("message")
        live = configured and cam.enabled and online and state == "live"
        people = None
        if live:
            people = rt.get("peopleCount") if rt else None
            if people is None:
                latest = vision_state.fresh_latest(cam.id)
                people = latest["peopleCount"] if latest else None
        return CameraLiveOut(
            id=cam.id, store_id=cam.store_id, camera_code=cam.camera_code, name=cam.name, type=cam.camera_type,
            zone=zone.name if zone else None, source_type=cam.source_type, source_configured=configured,
            enabled=cam.enabled, is_demo=cam.is_demo, status=state, error_code=code, message=message,
            resolution=cam.resolution,
            frame_width=(rt or {}).get("frameWidth") if live and rt else (status.frame_width if status and live else None),
            frame_height=(rt or {}).get("frameHeight") if live and rt else (status.frame_height if status and live else None),
            input_fps=(rt or {}).get("inputFps") if live and rt else (status.input_fps if status and live else None),
            inference_fps=(rt or {}).get("inferenceFps") if live and rt else (status.inference_fps if status and live else None),
            inference_ms=(rt or {}).get("inferenceMs") if live and rt else (status.inference_ms if status and live else None),
            last_frame_at=(rt or {}).get("lastFrameAt") if rt else (status.last_frame_at if status and configured else None),
            last_inference_at=(rt or {}).get("lastInferenceAt") if rt else (status.last_inference_at if status and configured else None),
            people_count=people, worker_online=online, stream=self._stream(cam, configured, online, state),
        )

    def list_cameras(self, store_id: Optional[str] = None) -> List[CameraLiveOut]:
        online = self.client.online()
        q = select(Camera, CameraStatus, StoreZone).outerjoin(CameraStatus, CameraStatus.camera_id == Camera.id) \
            .outerjoin(StoreZone, StoreZone.id == Camera.zone_id).order_by(Camera.store_id, Camera.camera_code)
        if store_id:
            q = q.where(Camera.store_id == store_id)
        return [self._live_out(c, s, z, online) for c, s, z in self.db.execute(q).all()]

    def _row(self, camera_id: str):
        row = self.db.execute(
            select(Camera, CameraStatus, StoreZone).outerjoin(CameraStatus, CameraStatus.camera_id == Camera.id)
            .outerjoin(StoreZone, StoreZone.id == Camera.zone_id).where(Camera.id == camera_id)
        ).first()
        if row is None:
            raise NotFoundError("Camera", camera_id)
        return row

    def camera(self, camera_id: str) -> CameraLiveOut:
        c, s, z = self._row(camera_id)
        return self._live_out(c, s, z, self.client.online())

    def status(self, camera_id: str) -> CameraStatusOut:
        c, s, z = self._row(camera_id)
        out = self._live_out(c, s, z, self.client.online())
        live = self.client.online() and out.status == "live"
        runtime = self.client._get(f"/cameras/{camera_id}") if live else None
        transitions = self.db.scalars(
            select(CameraStatusEvent).where(CameraStatusEvent.camera_id == camera_id)
            .order_by(CameraStatusEvent.occurred_at.desc(), CameraStatusEvent.id.desc()).limit(10)
        ).all()
        return CameraStatusOut(
            camera_id=camera_id, status=out.status, error_code=out.error_code, message=out.message,
            worker_online=out.worker_online,
            input_fps=(runtime or {}).get("inputFps", out.input_fps), inference_fps=(runtime or {}).get("inferenceFps", out.inference_fps),
            inference_ms=(runtime or {}).get("inferenceMs", out.inference_ms),
            dropped_frames=(runtime or {}).get("droppedFrames"), reconnects=(runtime or {}).get("reconnects"),
            last_frame_at=out.last_frame_at, last_inference_at=out.last_inference_at,
            last_transitions=[{"from": t.from_state, "to": t.to_state, "message": t.message, "at": t.occurred_at.isoformat()} for t in transitions],
        )

    def stream(self, camera_id: str) -> StreamDescriptor:
        return self.camera(camera_id).stream

    def detections(self, camera_id: str, limit: int = 60) -> DetectionsOut:
        out = self.camera(camera_id)
        if out.status != "live":
            return DetectionsOut(camera_id=camera_id, available=False, reason=out.message or f"Camera is {out.status}")
        latest = vision_state.fresh_latest(camera_id)
        if latest is None:
            return DetectionsOut(camera_id=camera_id, available=False, reason="No inference result yet (model not ready or warming up)")
        hist = [DetectionHistoryPoint(frame_id=h["frameId"], source_timestamp=h["sourceTimestamp"],
                                      people_count=h["peopleCount"], inference_ms=h["inferenceMs"])
                for h in vision_state.history_for(camera_id, limit)]
        return DetectionsOut(camera_id=camera_id, available=True, latest=latest, history=hist)

    # ------------------------------------------------------------------ configuration
    def update_source(self, camera_id: str, body: CameraSourceUpdate) -> CameraLiveOut:
        cam = get_or_404(self.db, Camera, camera_id, "Camera")
        ref = body.source_ref.strip() if body.source_ref else None
        if body.source_type != "unconfigured":
            try:
                validate_source(body.source_type, ref, [self.settings.data_dir / "samples", self.settings.media_dir])
            except SourceError as exc:
                raise InvalidSourceError(exc.message, {"code": exc.code}) from None
        cam.source_type, cam.source_ref = body.source_type, (ref if body.source_type != "unconfigured" else None)
        cam.enabled = body.enabled and body.source_type != "unconfigured"
        cam.is_demo = body.is_demo
        cfg = dict(cam.config or {})
        for key, val in (("inferenceFps", body.inference_fps), ("streamFps", body.stream_fps),
                         ("streamWidth", body.stream_width), ("loop", body.loop)):
            if val is not None:
                cfg[key] = val
        cam.config = cfg
        self.db.add(cam)
        self.db.flush()
        event_bus.publish(cam.store_id, "CAMERA_SOURCE_UPDATED", {"cameraId": cam.id})
        return self.camera(camera_id)

    def reload_worker(self) -> ReloadOut:
        online = self.client.online()
        if not online:
            return ReloadOut(requested=False, worker_online=False,
                             note="Vision worker is not running. Start it with `python -m vision`; it picks up camera settings on start.")
        result = self.client.post("/control/reload")
        return ReloadOut(requested=result is not None, worker_online=True, result=result)

    # ------------------------------------------------------------------ models / worker
    def models(self) -> ModelsStatusOut:
        live = self.client.status()
        if live is not None:
            return ModelsStatusOut(worker_online=True, device=live.get("device"), models=live["models"])
        rows = self.db.scalars(select(ModelRegistry).order_by(ModelRegistry.id)).all()
        models = [{
            "id": r.id, "name": r.name, "version": r.version, "task": r.task, "runtime": r.runtime, "path": r.artifact_path,
            "inputSize": r.input_size, "labels": r.labels or [], "confidenceThreshold": r.confidence_threshold,
            "device": r.device, "enabled": r.enabled, "license": r.license, "sha256": r.sha256,
            # A model can only be READY while a worker holds it in memory.
            "status": "NOT_CONFIGURED" if r.status == "READY" else r.status,
            "loadedAt": r.loaded_at.isoformat() if r.loaded_at else None, "lastError": r.last_error,
        } for r in rows]
        return ModelsStatusOut(worker_online=False, models=models,
                               note="Vision worker is not running, so no model is loaded. Showing the last persisted registry.")

    def vision_status(self) -> VisionStatusOut:
        live = self.client.status()
        if live is None:
            return VisionStatusOut(worker_online=False, note="Vision worker is not running (start with `python -m vision`).")
        return VisionStatusOut(worker_online=True, worker=live)

    # ------------------------------------------------------------------ events from the worker
    def relay_events(self, events: List[Dict[str, Any]]) -> "EngineResult":
        """Hand worker events to the ONE central event engine (validation, dedupe, severity, persistence, alerts, WebSocket)."""
        from services.event_engine import EventEngine

        def first_seen(ev: Dict[str, Any]) -> bool:
            flat = {"eventId": ev["eventId"], "seq": ev["seq"], "type": ev["type"], "cameraId": ev.get("cameraId"),
                    "occurredAt": ev["timestamp"], "payload": ev["payload"]}
            return vision_state.accept(flat)

        return EventEngine(self.db, self.settings).process(events, dedupe=first_seen)


_clients: Dict[str, WorkerClient] = {}


def worker_client_for(settings: Settings) -> WorkerClient:
    url = f"http://{settings.vision_worker_host}:{settings.vision_worker_port}"
    if url not in _clients:
        _clients[url] = WorkerClient(url)
    return _clients[url]
