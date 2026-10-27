from __future__ import annotations

import logging
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.errors import ConflictError, NotFoundError
from core.events import event_bus
from database.models import Alert, Camera, CameraStatus, CameraStatusEvent, CameraZoneMapping, DomainEvent, Store, StoreZone
from repositories.base import get_or_404
from repositories.telemetry import CameraRepository
from schemas.common import Meta
from schemas.monitoring import CameraCreate, CameraFeedOut, CameraKpisOut, CamerasOut, ReconnectOut
from services.common import get_store_or_404, humanize, now_utc
from services.vision import vision_state, worker_client_for
from vision.source_validation import SourceError, validate_source
from core.config import Settings, get_settings
from core.errors import InvalidSourceError

log = logging.getLogger("retailedge.cameras")

# States that count as "reachable" for KPI purposes.
LIVE_STATES = {"live", "buffering"}


def feed_status(status: Optional[CameraStatus]) -> str:
    """The frontend has no 'unknown' state; a camera that never reported is offline."""
    if status is None or status.state == "unknown":
        return "offline"
    return status.state


class CameraService:
    def __init__(self, db: Session, settings: Optional[Settings] = None):
        self.db = db
        self.settings = settings or get_settings()
        self.repo = CameraRepository(db)

    def feeds(self, store_id: str, query: Optional[str] = None, zone: Optional[str] = None, state: Optional[str] = None) -> List[CameraFeedOut]:
        now = now_utc()
        feeds: List[CameraFeedOut] = []
        worker_online = worker_client_for(self.settings).online()
        for cam, status, zone_row in self.repo.list_with_status(store_id):
            current = feed_status(status)
            configured = cam.source_type != "unconfigured" and bool(cam.source_ref)
            code, message = (status.error_code, status.message) if status else (None, "No heartbeat received yet")
            if configured and cam.enabled and not worker_online:
                # A persisted 'live' means nothing once the worker that wrote it is gone.
                current, code, message = "offline", "WORKER_OFFLINE", "Vision worker is not running"
            elif configured and not cam.enabled:
                current, code, message = "offline", "DISABLED", "Camera disabled"
            is_live = configured and cam.enabled and worker_online and current == "live"
            latest = vision_state.fresh_latest(cam.id) if is_live else None
            if query and query.lower() not in f"{cam.name} {cam.camera_code}".lower():
                continue
            if zone and zone.lower() not in ("all", "all zones") and zone_row and zone_row.name != zone:
                continue
            if state and state.lower() != "all" and current != state:
                continue
            feeds.append(
                CameraFeedOut(
                    id=cam.id,
                    name=cam.name,
                    camera_code=cam.camera_code,
                    type=cam.camera_type,
                    zone=zone_row.name if zone_row else None,
                    zone_id=cam.zone_id,
                    resolution=cam.resolution,
                    stream_type=cam.stream_type,  # URL / credentials are intentionally never returned
                    fps=status.fps if status else None,
                    status=current,
                    last_frame_timestamp=humanize(status.last_frame_at, now) if status and status.last_frame_at else None,
                    last_frame_at=status.last_frame_at if status else None,
                    latency_ms=status.latency_ms if status else None,
                    packet_loss_pct=status.packet_loss_pct if status else None,
                    ai_module=cam.ai_module,
                    purpose=cam.purpose,
                    message=message,
                    people_count=latest["peopleCount"] if latest else None,
                    source_type=cam.source_type, enabled=cam.enabled, is_demo=cam.is_demo, error_code=code,
                    input_fps=status.input_fps if status and is_live else None,
                    inference_fps=status.inference_fps if status and is_live else None,
                    inference_ms=status.inference_ms if status and is_live else None,
                    last_inference_at=status.last_inference_at if status and configured else None,
                    frame_width=status.frame_width if status and is_live else None,
                    frame_height=status.frame_height if status and is_live else None,
                )
            )
        return feeds

    def kpis(self, feeds: List[CameraFeedOut]) -> CameraKpisOut:
        fps = [f.fps for f in feeds if f.fps is not None and f.status in LIVE_STATES]
        return CameraKpisOut(
            total=len(feeds),
            live=sum(1 for f in feeds if f.status in LIVE_STATES),
            offline=sum(1 for f in feeds if f.status in ("offline", "error")),
            unknown=sum(1 for f in feeds if f.status not in LIVE_STATES and f.status not in ("offline", "error")),
            average_fps=round(sum(fps) / len(fps), 1) if fps else None,
        )

    def meta(self, store_id: str, feeds: List[CameraFeedOut]) -> Meta:
        last = self.repo.last_inference_at(store_id)
        heartbeat = [f.last_frame_at for f in feeds if f.last_frame_at]
        latest = max(heartbeat + ([last] if last else []), default=None)
        if not feeds:
            return Meta(data_state="empty", note="No cameras are registered for this store.")
        if latest is None:
            return Meta(data_state="unavailable", note="Cameras are registered but none has reported a heartbeat yet.")
        return Meta(data_state="available", last_observation_at=latest, sources=["camera_status"])

    def overview(self, store_id: str, **filters) -> CamerasOut:
        get_store_or_404(self.db, store_id)
        feeds = self.feeds(store_id, **filters)
        return CamerasOut(store_id=store_id, cameras=feeds, kpis=self.kpis(feeds), meta=self.meta(store_id, feeds))

    # ------------------------------------------------------------------ event timeline
    TIMELINE_TITLES = {
        "footfall.crossing": ("footfall", "Entrance line crossed"), "camera.connected": ("offline", "Camera connected"),
        "camera.disconnected": ("offline", "Camera disconnected"), "queue.congestion": ("queue", "Queue congestion detected"),
        "inventory.low_stock": ("shelf_gap", "Low shelf stock detected"), "inventory.out_of_stock": ("shelf_gap", "Empty shelf detected"),
        "model.error": ("offline", "Detection model error"), "model.ready": ("motion", "Detection model ready"),
    }

    def timeline(self, store_id: str, camera_id: Optional[str] = None, limit: int = 60) -> dict:
        """Camera-related history, newest first. Every item carries the time it OCCURRED at its source (not when it was fetched)."""
        get_store_or_404(self.db, store_id)
        cams = {c.id: (c, z) for c, _s, z in self.repo.list_with_status(store_id)}
        if camera_id and camera_id not in cams:
            raise NotFoundError("Camera", camera_id)
        items: list = []

        def base(cam_id: Optional[str]) -> dict:
            cam, zone = cams.get(cam_id or "", (None, None))
            return {"cameraId": cam_id, "cameraCode": cam.camera_code if cam else None, "cameraName": cam.name if cam else None, "zone": zone.name if zone else None}

        status_q = select(CameraStatusEvent).where(CameraStatusEvent.camera_id.in_(list(cams) or [""])).order_by(CameraStatusEvent.occurred_at.desc()).limit(limit)
        if camera_id:
            status_q = select(CameraStatusEvent).where(CameraStatusEvent.camera_id == camera_id).order_by(CameraStatusEvent.occurred_at.desc()).limit(limit)
        for e in self.db.scalars(status_q):
            down = e.to_state not in LIVE_STATES
            items.append({**base(e.camera_id), "id": f"cs-{e.id}", "kind": "status", "category": "offline", "severity": "warning" if down else "info",
                          "title": f"Camera {e.to_state}", "description": e.message or f"{e.from_state or 'unknown'} -> {e.to_state}", "occurredAt": e.occurred_at.isoformat(),
                          "detectionCount": None})
        ev_q = select(DomainEvent).where(DomainEvent.store_id == store_id).order_by(DomainEvent.occurred_at.desc()).limit(limit)
        if camera_id:
            ev_q = ev_q.where(DomainEvent.camera_id == camera_id)
        for e in self.db.scalars(ev_q):
            category, title = self.TIMELINE_TITLES.get(e.event_type, ("motion", e.event_type))
            if e.event_type.startswith("camera.") and e.event_type in ("camera.connected", "camera.disconnected"):
                continue  # already covered by the status transitions above
            items.append({**base(e.camera_id), "id": f"ev-{e.id}", "kind": "event", "category": category, "severity": e.severity, "title": title,
                          "description": ", ".join(f"{k}: {v}" for k, v in list((e.payload or {}).items())[:4]), "occurredAt": e.occurred_at.isoformat(), "detectionCount": None})
        al_q = select(Alert).where(Alert.store_id == store_id).where(Alert.camera_id.is_not(None)).order_by(Alert.created_at.desc()).limit(limit)
        if camera_id:
            al_q = al_q.where(Alert.camera_id == camera_id)
        for a in self.db.scalars(al_q):
            items.append({**base(a.camera_id), "id": f"al-{a.id}", "kind": "alert", "category": "offline" if a.category == "camera_disconnected" else "motion",
                          "severity": a.severity, "title": a.title, "description": a.description or "", "occurredAt": a.created_at.isoformat(), "detectionCount": None})
        items.sort(key=lambda i: i["occurredAt"], reverse=True)
        items = items[:limit]
        return {"storeId": store_id, "items": items,
                "meta": {"dataState": "available" if items else "empty", "lastObservationAt": items[0]["occurredAt"] if items else None,
                         "sources": ["camera_status_events", "domain_events", "alerts"], "note": None if items else "No camera events have been recorded yet."}}

    def register(self, store_id: str, body: CameraCreate) -> CameraFeedOut:
        get_store_or_404(self.db, store_id)
        code_taken = self.db.scalars(select(Camera).where(Camera.store_id == store_id).where(Camera.camera_code == body.camera_code)).first()
        if code_taken:
            raise ConflictError(f"A camera with code '{body.camera_code}' already exists in this store")
        if body.zone_id:
            zone = self.db.get(StoreZone, body.zone_id)
            if zone is None or zone.store_id != store_id:
                raise NotFoundError("Zone", body.zone_id)

        ref = body.source_ref.strip() if body.source_ref else None
        if body.source_type != "unconfigured":
            settings = self.settings
            try:
                validate_source(body.source_type, ref, [settings.data_dir / "samples", settings.media_dir])
            except SourceError as exc:
                raise InvalidSourceError(exc.message, {"code": exc.code}) from None
        cam = Camera(
            id=f"cam-{store_id}-{body.camera_code}".lower()[:64],
            store_id=store_id,
            camera_code=body.camera_code,
            name=body.name,
            camera_type=body.type,
            zone_id=body.zone_id,
            resolution=body.resolution,
            stream_type=body.stream_type,
            stream_url=body.stream_url,
            ai_module=body.ai_module,
            purpose=body.purpose,
            source_type=body.source_type,
            source_ref=ref if body.source_type != "unconfigured" else None,
            enabled=body.enabled and body.source_type != "unconfigured",
            is_demo=body.is_demo,
        )
        self.db.add(cam)
        self.db.add(CameraStatus(camera_id=cam.id, state="unknown", message="Registered; awaiting first heartbeat"))
        if body.zone_id:
            self.db.add(CameraZoneMapping(camera_id=cam.id, zone_id=body.zone_id))
        self.db.flush()
        feeds = [f for f in self.feeds(store_id) if f.id == cam.id]
        event_bus.publish(store_id, "CAMERA_REGISTERED", {"cameraId": cam.id})
        return feeds[0]

    def request_reconnect(self, store_id: str, camera_id: str) -> ReconnectOut:
        """Ask the vision worker to drop and reopen the source. The state only changes when the
        worker reports it; if the worker is not running nothing is pretended."""
        cam = get_or_404(self.db, Camera, camera_id, "Camera")
        if cam.store_id != store_id:
            raise NotFoundError("Camera", camera_id)
        client = worker_client_for(self.settings)
        configured = cam.source_type != "unconfigured" and bool(cam.source_ref)
        if not configured:
            return ReconnectOut(requested=False, camera_id=camera_id, state="offline",
                                note="This camera has no source configured, so there is nothing to reconnect.")
        if not client.online():
            return ReconnectOut(requested=False, camera_id=camera_id, state="offline",
                                note="The vision worker is not running. Start it with `python -m vision`.")
        result = client.post(f"/control/cameras/{camera_id}/reconnect")
        if result is None:
            return ReconnectOut(requested=False, camera_id=camera_id, state="offline",
                                note="The vision worker did not accept the reconnect request.")
        event_bus.publish(store_id, "CAMERA_STATUS", {"cameraId": camera_id, "state": result.get("state", "reconnecting")})
        return ReconnectOut(requested=True, camera_id=camera_id, state=result.get("state", "reconnecting"),
                            note="Reconnect requested from the vision worker; the camera state updates when it reports back.")
