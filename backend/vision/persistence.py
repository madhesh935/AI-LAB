"""SQLite persistence for the worker: camera config, connection transitions, model registry, health.

The worker shares retailedge.db (WAL) with the API. Only low-frequency data is written:
  * camera_status_events - one row per connection-state transition
  * camera_status        - latest state + measured stats, at most every `stats_interval` seconds
  * model_registry       - on every model status change
  * model_health         - one row per camera-model pair per minute
Individual bounding boxes are never stored.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select

from database.connection import Database
from analytics.footfall import LineConfig
from analytics.queue import QueueRegionCfg
from analytics.shelf import ShelfCfg, Slot
from analytics.zones import ZoneConfig
from database.models import (
    Camera, CameraStatus, CameraStatusEvent, CameraZone, CheckoutCounter, ModelHealth, QueueRegion, Shelf, ShelfRegion, Store,
)
from vision.analytics_runtime import CameraAnalyticsConfig, ShelfRuntimeCfg, digest_of
from database.models import ModelRegistry as ModelRegistryRow
from vision.registry import ModelEntry
from vision.sources import redact

log = logging.getLogger("retailedge.vision.persistence")


@dataclass
class CameraConfig:
    id: str
    camera_code: str
    store_id: str
    name: str
    source_type: str
    source_ref: Optional[str] = field(repr=False)
    enabled: bool
    is_demo: bool
    inference_fps: float
    stream_fps: float
    stream_width: int
    loop: bool
    playback_speed: float = 1.0  # file sources only; 0 = as fast as decoding allows (tests)

    def same_source(self, other: "CameraConfig") -> bool:
        return (self.source_type, self.source_ref, self.enabled) == (other.source_type, other.source_ref, other.enabled)


class WorkerStore:
    def __init__(self, db: Database, defaults: Dict[str, Any]):
        self.db = db
        self.defaults = defaults
        self.errors = 0

    # ------------------------------------------------------------------ cameras
    def load_cameras(self) -> List[CameraConfig]:
        out: List[CameraConfig] = []
        with self.db.session() as s:
            for cam in s.scalars(select(Camera).order_by(Camera.store_id, Camera.camera_code)):
                cfg = cam.config or {}
                out.append(CameraConfig(
                    id=cam.id, camera_code=cam.camera_code, store_id=cam.store_id, name=cam.name,
                    source_type=cam.source_type, source_ref=cam.source_ref, enabled=bool(cam.enabled),
                    is_demo=bool(cam.is_demo),
                    inference_fps=float(cfg.get("inferenceFps", self.defaults["inference_fps"])),
                    stream_fps=float(cfg.get("streamFps", self.defaults["stream_fps"])),
                    stream_width=int(cfg.get("streamWidth", self.defaults["stream_width"])),
                    loop=bool(cfg.get("loop", True)),
                    playback_speed=float(cfg.get("playbackSpeed", 1.0)),
                ))
        return out

    # ------------------------------------------------------------------ analytics configuration
    def load_analytics(self) -> Dict[str, CameraAnalyticsConfig]:
        """Zones, counting lines, queue regions and shelf regions per camera (all geometry is data)."""
        out: Dict[str, CameraAnalyticsConfig] = {}

        def cfg_for(camera_id: str) -> CameraAnalyticsConfig:
            return out.setdefault(camera_id, CameraAnalyticsConfig(camera_id=camera_id))

        raw: Dict[str, list] = {}
        with self.db.session() as s:
            for z in s.scalars(select(CameraZone).where(CameraZone.enabled.is_(True))):
                c = cfg_for(z.camera_id)
                zc = z.config or {}
                c.names[z.id] = z.name
                c.kinds[z.id] = z.zone_type
                if z.line:
                    ln = z.line
                    c.lines.append(LineConfig(
                        line_id=z.id, p1=tuple(ln["p1"]), p2=tuple(ln["p2"]), in_side=ln.get("inSide", "positive"),
                        margin=float(ln.get("margin", 0.025)), min_track_age=int(ln.get("minTrackAge", 3)),
                        cooldown_seconds=float(ln.get("cooldownSeconds", 2.0)), count_only=ln.get("countOnly")))
                if z.polygon and len(z.polygon) >= 3:
                    c.zones.append(ZoneConfig(
                        zone_id=z.id, polygon=z.polygon, exit_grace_seconds=float(zc.get("exitGraceSeconds", 1.5)),
                        min_dwell_seconds=float(zc.get("minDwellSeconds", 1.0))))
                raw.setdefault(z.camera_id, []).append(["zone", z.id, z.polygon, z.line, zc])
            for r in s.scalars(select(QueueRegion).where(QueueRegion.enabled.is_(True))):
                c = cfg_for(r.camera_id)
                ctr = s.get(CheckoutCounter, r.counter_id)
                c.names[r.counter_id] = ctr.name if ctr is not None else r.counter_id
                c.queues.append(QueueRegionCfg(
                    counter_id=r.counter_id, queue_polygon=r.queue_polygon, service_polygon=r.service_polygon or (), priority=r.priority,
                    warning_length=r.warning_length, critical_length=r.critical_length, warning_wait_seconds=r.warning_wait_seconds,
                    critical_wait_seconds=r.critical_wait_seconds, assumed_service_rate_per_min=r.assumed_service_rate_per_min))
                raw.setdefault(r.camera_id, []).append(["queue", r.counter_id, r.queue_polygon, r.service_polygon, r.priority, r.warning_length, r.critical_length])
            for sh in s.scalars(select(ShelfRegion).where(ShelfRegion.enabled.is_(True))):
                c = cfg_for(sh.camera_id)
                shelf_row = s.get(Shelf, sh.shelf_id)
                c.names[sh.shelf_id] = shelf_row.shelf_code if shelf_row is not None else sh.shelf_id
                slots = [Slot(x["slotId"], tuple(x["rect"]), x["expectedClass"]) for x in (sh.slots or [])]
                c.shelves.append(ShelfRuntimeCfg(
                    cfg=ShelfCfg(shelf_id=sh.shelf_id, polygon=sh.polygon, class_map=dict(sh.class_map or {}), expected_capacity=sh.expected_visible_capacity,
                                 low_pct=sh.low_stock_pct, out_pct=sh.out_of_stock_pct, confirm_n=sh.confirm_observations, min_conf=sh.min_confidence),
                    camera_id=sh.camera_id, interval_seconds=sh.interval_seconds, slots=slots))
                raw.setdefault(sh.camera_id, []).append(["shelf", sh.shelf_id, sh.polygon, sh.class_map, sh.expected_visible_capacity, sh.low_stock_pct,
                                                          sh.out_of_stock_pct, sh.confirm_observations, sh.min_confidence, sh.interval_seconds, sh.slots])
        for cid, parts in raw.items():
            out[cid].digest = digest_of(sorted(parts, key=str))
        return out

    def record_transition(self, cam: CameraConfig, from_state: Optional[str], to_state: str,
                          message: Optional[str], error_code: Optional[str]) -> None:
        now = datetime.now(timezone.utc)
        message = redact(message)
        try:
            with self.db.transaction() as s:
                s.add(CameraStatusEvent(camera_id=cam.id, from_state=from_state, to_state=to_state,
                                        message=(message or "")[:240] or None, occurred_at=now))
                st = s.get(CameraStatus, cam.id) or CameraStatus(camera_id=cam.id)
                st.state, st.message, st.error_code, st.last_checked_at = to_state, (message or "")[:240] or None, error_code, now
                if to_state != "live":
                    st.fps = st.input_fps = st.inference_fps = st.inference_ms = None
                s.add(st)
        except Exception:  # noqa: BLE001
            self.errors += 1
            log.exception("could not persist transition for %s", cam.id)

    def write_stats(self, cam: CameraConfig, *, state: str, input_fps: Optional[float], inference_fps: Optional[float],
                    inference_ms: Optional[float], width: Optional[int], height: Optional[int],
                    last_frame_at: Optional[datetime], last_inference_at: Optional[datetime],
                    message: Optional[str], error_code: Optional[str]) -> None:
        try:
            with self.db.transaction() as s:
                st = s.get(CameraStatus, cam.id) or CameraStatus(camera_id=cam.id)
                st.state, st.fps, st.input_fps = state, input_fps, input_fps
                st.inference_fps, st.inference_ms = inference_fps, inference_ms
                st.frame_width, st.frame_height = width, height
                st.last_frame_at, st.last_inference_at = last_frame_at, last_inference_at
                st.latency_ms = inference_ms
                st.message, st.error_code = redact(message), error_code
                st.last_checked_at = datetime.now(timezone.utc)
                s.add(st)
        except Exception:  # noqa: BLE001
            self.errors += 1
            log.exception("could not persist stats for %s", cam.id)

    def write_resolution(self, cam: CameraConfig, width: int, height: int) -> None:
        try:
            with self.db.transaction() as s:
                row = s.get(Camera, cam.id)
                if row is not None and row.resolution != f"{width}x{height}":
                    row.resolution = f"{width}x{height}"
        except Exception:  # noqa: BLE001
            self.errors += 1

    # ------------------------------------------------------------------ models
    def sync_model(self, entry: ModelEntry) -> None:
        try:
            with self.db.transaction() as s:
                row = s.get(ModelRegistryRow, entry.id) or ModelRegistryRow(id=entry.id)
                row.name, row.version, row.task = entry.name, entry.version, entry.task
                row.artifact_path, row.runtime, row.input_size = entry.path, entry.runtime, entry.input_size
                row.labels, row.confidence_threshold = entry.labels, entry.confidence_threshold
                row.device, row.enabled, row.license, row.sha256 = entry.device, entry.enabled, entry.license, entry.sha256
                row.status, row.last_error, row.loaded_at = entry.status, entry.last_error, entry.loaded_at
                row.notes = (entry.notes or "")[:400] or None
                s.add(row)
        except Exception:  # noqa: BLE001
            self.errors += 1
            log.exception("could not persist model %s", entry.id)

    def write_model_health(self, model_id: str, store_id: Optional[str], status: str,
                           latency_ms: Optional[float], fps: Optional[float]) -> None:
        try:
            with self.db.transaction() as s:
                if s.get(ModelRegistryRow, model_id) is None:
                    return  # health rows only make sense for a registered model
                if store_id is not None and s.get(Store, store_id) is None:
                    store_id = None
                s.add(ModelHealth(model_id=model_id, store_id=store_id, status=status, latency_ms=latency_ms, fps=fps))
        except Exception:  # noqa: BLE001
            self.errors += 1
            log.exception("could not persist model health")
