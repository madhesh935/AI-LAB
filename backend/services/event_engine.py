"""Central event engine: the ONE processor for every analytics/vision event (no per-page processors).

For each event: validate payload -> deduplicate (memory + durable unique ids) -> assign severity -> persist
(aggregates / observations / domain-event log) -> run alert lifecycle -> publish to the WebSocket EventBus.

Raw worker events handled here:
  footfall.crossing  zone.visit  zone.occupancy  zone.transition  heatmap.flush  queue.updated  queue.service
  shelf.observation  camera.connected  camera.disconnected  (+ pass-through: camera.frame person.detected model.ready model.error)
Published (WebSocket) event names:
  footfall.updated  zone.occupancy.updated  queue.updated  queue.congestion  shelf.updated  occupancy.updated  camera.status
  inventory.low_stock  inventory.out_of_stock  camera.disconnected  camera.connected  camera.frame  person.detected  model.*
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from analytics.forecast import forecast_queue
from analytics.occupancy import Occupancy, OccupancyEstimator
from analytics.waittime import estimate_wait
from core.config import Settings, get_settings
from core.events import event_bus
from database.models import (
    Camera, CameraStatus, CameraZone, CheckoutCounter, DomainEvent, DwellTimeAggregate, FootfallAggregate, FootfallEvent,
    HeatmapCell, MovementAggregate, OccupancyState, QueueForecast, QueueObservation, QueueRegion, QueueServiceSample, Shelf,
    ShelfObservation, ShelfRegion, Store, ZoneOccupancy, ZoneVisit,
)
from schemas.events import (
    CrossingPayload, HeatmapPayload, QueueServicePayload, QueueUpdatePayload, ShelfObservationPayload, TransitionPayload,
    ZoneOccupancyPayload, ZoneVisitPayload,
)
from services.alert_lifecycle import AlertLifecycle
from services.common import store_tz

log = logging.getLogger("retailedge.events")

PASSTHROUGH = {"camera.frame", "person.detected", "model.ready", "model.error"}
SIGNIFICANT = {"footfall.crossing", "camera.connected", "camera.disconnected", "model.error", "model.ready",
               "inventory.low_stock", "inventory.out_of_stock", "queue.congestion", "alert.raised"}
CONGESTION_RANK = {"optimal": 0, "moderate": 1, "high": 2, "critical": 3}


def parse_ts(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def hour_bucket(dt: datetime, tz=timezone.utc) -> datetime:
    """Start of the STORE-LOCAL hour containing dt, as UTC (so buckets line up with local hours even in +05:30 zones)."""
    return dt.astimezone(tz).replace(minute=0, second=0, microsecond=0).astimezone(timezone.utc)


@dataclass
class EngineMemory:
    """Volatile helper state (throttles + alert hold/clear timers). Durable state lives in SQLite."""

    last_write: Dict[str, datetime] = field(default_factory=dict)
    last_level: Dict[str, str] = field(default_factory=dict)
    cond: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def reset(self) -> None:
        with self.lock:
            self.last_write.clear(), self.last_level.clear(), self.cond.clear()

    def due(self, key: str, now: datetime, every_seconds: float) -> bool:
        with self.lock:
            last = self.last_write.get(key)
            if last is None or (now - last).total_seconds() >= every_seconds or now < last:
                self.last_write[key] = now
                return True
            return False

    def hold(self, key: str, is_true: bool, now: datetime, hold_s: float, clear_s: float) -> Optional[str]:
        """Debounce a condition. Returns 'raise' once it has held for hold_s, 'clear' once it has been false for clear_s."""
        with self.lock:
            c = self.cond.setdefault(key, {"since": None, "off_since": None, "raised": False})
            if is_true:
                c["off_since"] = None
                if c["since"] is None:
                    c["since"] = now
                if not c["raised"] and (now - c["since"]).total_seconds() >= hold_s:
                    c["raised"] = True
                    return "raise"
                return "refresh" if c["raised"] else None
            c["since"] = None
            if c["off_since"] is None:
                c["off_since"] = now
            if c["raised"] and (now - c["off_since"]).total_seconds() >= clear_s:
                c["raised"] = False
                return "clear"
            return None


MEMORY = EngineMemory()


@dataclass
class EngineResult:
    accepted: int = 0
    duplicates: int = 0
    rejected: Dict[str, str] = field(default_factory=dict)
    published: int = 0


def severity_for(event_type: str, payload: Optional[Dict[str, Any]] = None) -> str:
    payload = payload or {}
    if event_type in ("inventory.out_of_stock", "model.error"):
        return "critical"
    if event_type == "queue.congestion":
        return "critical" if payload.get("level") == "critical" else "warning" if payload.get("level") == "high" else "info"
    if event_type in ("inventory.low_stock", "camera.disconnected"):
        return "warning"
    return "info"


class EventEngine:
    def __init__(self, db: Session, settings: Optional[Settings] = None, memory: EngineMemory = MEMORY):
        self.db = db
        self.settings = settings or get_settings()
        self.mem = memory
        self.alerts = AlertLifecycle(db, self.settings.alert_reopen_cooldown_seconds)
        self.occ = OccupancyEstimator(self.settings.occupancy_stale_minutes)
        self._published: List[Tuple[str, str, Dict[str, Any]]] = []
        self._store_cache: Dict[str, Optional[Store]] = {}
        self._handlers: Dict[str, Callable[[Dict[str, Any], datetime], None]] = {
            "footfall.crossing": self._crossing, "zone.visit": self._zone_visit, "zone.occupancy": self._zone_occupancy,
            "zone.transition": self._transition, "heatmap.flush": self._heatmap, "queue.updated": self._queue_updated,
            "queue.service": self._queue_service, "shelf.observation": self._shelf_observation,
            "camera.connected": self._camera_connected, "camera.disconnected": self._camera_disconnected,
        }

    # ------------------------------------------------------------------ entry point
    def process(self, events: List[Dict[str, Any]], dedupe: Optional[Callable[[Dict[str, Any]], bool]] = None) -> EngineResult:
        """`events` are VisionEvent dumps (camelCase). `dedupe(event)` returns False for an event id seen before."""
        res = EngineResult()
        for ev in events:
            etype, store_id = ev.get("type"), ev.get("storeId")
            try:
                if dedupe is not None and not dedupe(ev):
                    res.duplicates += 1
                    continue
                if not self._store_exists(store_id):
                    res.rejected[ev.get("eventId", "?")] = f"unknown store '{store_id}'"
                    continue
                at = parse_ts(ev["timestamp"])
                with self.db.begin_nested():  # a bad event rolls back alone, never the batch
                    if etype in PASSTHROUGH:
                        self._passthrough(ev, at)
                    elif etype in self._handlers:
                        self._handlers[etype](ev, at)
                    else:
                        raise ValueError(f"unsupported event type '{etype}'")
                res.accepted += 1
            except _Duplicate:
                res.duplicates += 1
            except (ValidationError, ValueError, KeyError, IntegrityError) as exc:  # a bad event is rejected alone, never fatal to the batch
                res.rejected[ev.get("eventId", "?")] = f"{etype}: {str(exc)[:160]}"
                log.warning("event rejected", extra={"type": etype, "reason": str(exc)[:160]})
        for store_id, kind, payload in self._published:
            event_bus.publish(store_id, kind, payload, source="vision")
        res.published = len(self._published)
        self._published = []
        return res

    # ------------------------------------------------------------------ helpers
    def _store_exists(self, store_id: Optional[str]) -> bool:
        if not store_id:
            return False
        if store_id not in self._store_cache:
            self._store_cache[store_id] = self.db.get(Store, store_id)
        return self._store_cache[store_id] is not None

    def _bucket(self, store_id: str, dt: datetime) -> datetime:
        store = self._store_cache.get(store_id)
        return hour_bucket(dt, store_tz(store) if store is not None else timezone.utc)

    def _publish(self, store_id: str, kind: str, payload: Dict[str, Any]) -> None:
        self._published.append((store_id, kind, payload))

    def _log_event(self, ev: Dict[str, Any], at: datetime, event_type: Optional[str] = None, severity: Optional[str] = None,
                   payload: Optional[Dict[str, Any]] = None, event_id: Optional[str] = None) -> None:
        etype = event_type or ev["type"]
        row = DomainEvent(id=(event_id or ev["eventId"])[:40], store_id=ev["storeId"], camera_id=ev.get("cameraId"), event_type=etype,
                          severity=severity or severity_for(etype, payload or ev.get("payload")), occurred_at=at,
                          payload=payload if payload is not None else ev.get("payload", {}))
        try:
            with self.db.begin_nested():
                self.db.add(row)
                self.db.flush()
        except IntegrityError:
            raise _Duplicate()

    def _passthrough(self, ev: Dict[str, Any], at: datetime) -> None:
        base = {"eventId": ev["eventId"], "seq": ev.get("seq"), "cameraId": ev.get("cameraId"), "occurredAt": ev["timestamp"]}
        p = ev.get("payload", {})
        if ev["type"] == "camera.frame":
            self._publish(ev["storeId"], ev["type"], p)
        else:
            self._publish(ev["storeId"], ev["type"], {**base, **p})
        if ev["type"] in ("model.error", "model.ready"):
            self._log_event(ev, at, severity=severity_for(ev["type"]))

    def _camera_zone(self, zone_id: str, store_id: str) -> CameraZone:
        z = self.db.get(CameraZone, zone_id)
        if z is None or z.store_id != store_id:
            raise ValueError(f"camera zone '{zone_id}' not found in store")
        return z

    # ------------------------------------------------------------------ footfall / occupancy
    def _load_occupancy(self, store_id: str) -> Tuple[OccupancyState, Occupancy]:
        row = self.db.get(OccupancyState, store_id)
        if row is None:
            row = OccupancyState(store_id=store_id, status="unknown", entries_since_reset=0, exits_since_reset=0,
                                 negative_clamps=0, updated_at=datetime.now(timezone.utc))
            self.db.add(row)
            self.db.flush()
        occ = Occupancy(
            estimate=row.estimate, status=row.status, reason=row.reason, entries=row.entries_since_reset, exits=row.exits_since_reset,
            negative_clamps=row.negative_clamps, last_event_at=row.last_event_at, last_reset_at=row.last_reset_at,
            reset_reason=row.reset_reason, baseline_set=row.last_reset_at is not None,
            camera_down_since=row.camera_down_since, camera_gap=bool(row.camera_gap),
        )
        return row, occ

    def _save_occupancy(self, row: OccupancyState, occ: Occupancy, at: datetime) -> None:
        row.estimate, row.status, row.reason = occ.estimate, occ.status, occ.reason
        row.entries_since_reset, row.exits_since_reset, row.negative_clamps = occ.entries, occ.exits, occ.negative_clamps
        row.last_event_at, row.last_reset_at, row.reset_reason, row.updated_at = occ.last_event_at, occ.last_reset_at, occ.reset_reason, at
        row.camera_down_since, row.camera_gap = occ.camera_down_since, occ.camera_gap

    def _crossing(self, ev: Dict[str, Any], at: datetime) -> None:
        p = CrossingPayload.model_validate({**ev["payload"], "occurredAt": ev["payload"].get("occurredAt", ev["timestamp"])})
        zone = self._camera_zone(p.line_id, ev["storeId"])
        if not zone.line:
            raise ValueError(f"camera zone '{p.line_id}' has no counting line")
        store_id = ev["storeId"]
        try:
            with self.db.begin_nested():
                self.db.add(FootfallEvent(store_id=store_id, camera_id=zone.camera_id, direction=p.direction, count=1,
                                          observed_at=p.occurred_at, source="cv", line_id=zone.id, event_id=ev["eventId"][:40]))
                self.db.flush()
        except IntegrityError:
            raise _Duplicate()
        # hourly aggregate (the Phase-1 footfall/shopper endpoints read these)
        bucket = self._bucket(store_id, p.occurred_at)
        agg = self.db.scalars(select(FootfallAggregate).where(FootfallAggregate.store_id == store_id)
                              .where(FootfallAggregate.bucket_start == bucket).where(FootfallAggregate.bucket_minutes == 60)).first()
        if agg is None:
            agg = FootfallAggregate(store_id=store_id, bucket_start=bucket, bucket_minutes=60, entries=0, exits=0, source="cv")
            self.db.add(agg)
        if p.direction == "in":
            agg.entries += 1
        else:
            agg.exits += 1
        row, occ = self._load_occupancy(store_id)
        occ = self.occ.apply_crossing(occ, p.direction, p.occurred_at)
        self._save_occupancy(row, occ, at)
        if occ.estimate is not None:
            agg.peak_occupancy = max(agg.peak_occupancy or 0, occ.estimate)
        self._capacity_alert(store_id, occ, at)
        payload = {"eventId": ev["eventId"], "occurredAt": p.occurred_at.isoformat(), "cameraId": zone.camera_id, "lineId": zone.id,
                   "direction": p.direction, "occupancy": {"estimate": occ.estimate, "status": occ.status, "reason": occ.reason},
                   "hour": {"entries": agg.entries, "exits": agg.exits}}
        self._log_event(ev, at, event_type="footfall.crossing", severity="info", payload={k: payload[k] for k in ("lineId", "direction", "occupancy")})
        self._publish(store_id, "footfall.updated", payload)
        self._publish(store_id, "occupancy.updated", {"occurredAt": payload["occurredAt"], "cameraId": zone.camera_id, "estimate": occ.estimate,
                                                      "status": occ.status, "reason": occ.reason, "capacity": (self.db.get(Store, store_id).max_capacity or None)})

    def _capacity_alert(self, store_id: str, occ: Occupancy, at: datetime) -> None:
        store = self.db.get(Store, store_id)
        if store is None or not store.max_capacity or occ.estimate is None or occ.status == "unknown":
            return
        key = f"occupancy:{store_id}:capacity"
        if occ.estimate > store.max_capacity and occ.status in ("ok",):
            self.alerts.raise_alert(store_id, key, now=at, module="shopper", category="unusual_customer_traffic", severity="warning",
                                    title="Occupancy above store capacity", description=f"Estimated {occ.estimate} people; capacity is {store.max_capacity}.",
                                    recommended_action="Check the entrance and manage entry if the count is confirmed.",
                                    evidence={"estimate": occ.estimate, "capacity": store.max_capacity, "status": occ.status})
        elif occ.estimate <= int(store.max_capacity * 0.9):
            self.alerts.resolve(store_id, key, at)

    # ------------------------------------------------------------------ zones / dwell / movement / heatmap
    def _zone_visit(self, ev: Dict[str, Any], at: datetime) -> None:
        p = ZoneVisitPayload.model_validate(ev["payload"])
        z = self._camera_zone(p.camera_zone_id, ev["storeId"])
        try:
            with self.db.begin_nested():
                self.db.add(ZoneVisit(store_id=ev["storeId"], camera_id=z.camera_id, camera_zone_id=z.id, store_zone_id=z.store_zone_id,
                                      track_ref=p.track_ref, entered_at=p.entered_at, exited_at=p.exited_at,
                                      dwell_seconds=p.dwell_seconds, event_id=ev["eventId"][:40]))
                self.db.flush()
        except IntegrityError:
            raise _Duplicate()
        if z.store_zone_id:
            bucket = self._bucket(ev["storeId"], p.entered_at)
            agg = self.db.scalars(select(DwellTimeAggregate).where(DwellTimeAggregate.store_id == ev["storeId"])
                                  .where(DwellTimeAggregate.zone_id == z.store_zone_id).where(DwellTimeAggregate.bucket_start == bucket)).first()
            if agg is None:
                self.db.add(DwellTimeAggregate(store_id=ev["storeId"], zone_id=z.store_zone_id, bucket_start=bucket, visitors=1,
                                               avg_dwell_seconds=p.dwell_seconds, source="cv"))
            else:  # running mean over COMPLETE visits only
                agg.avg_dwell_seconds = (agg.avg_dwell_seconds * agg.visitors + p.dwell_seconds) / (agg.visitors + 1)
                agg.visitors += 1

    def _zone_occupancy(self, ev: Dict[str, Any], at: datetime) -> None:
        p = ZoneOccupancyPayload.model_validate(ev["payload"])
        zones = []
        for zid, count in p.counts.items():
            z = self.db.get(CameraZone, zid)
            if z is None or z.store_id != ev["storeId"]:
                continue
            zones.append({"cameraZoneId": zid, "zoneId": z.store_zone_id, "count": count})
            if z.store_zone_id:
                self.db.add(ZoneOccupancy(store_id=ev["storeId"], zone_id=z.store_zone_id, count=max(0, count), observed_at=at, source="cv"))
        if zones:
            self._publish(ev["storeId"], "zone.occupancy.updated", {"eventId": ev["eventId"], "occurredAt": ev["timestamp"],
                                                                  "cameraId": ev.get("cameraId"), "zones": zones})

    def _transition(self, ev: Dict[str, Any], at: datetime) -> None:
        p = TransitionPayload.model_validate({**ev["payload"], "occurredAt": ev["payload"].get("occurredAt", ev["timestamp"])})
        a, b = self._camera_zone(p.from_zone_id, ev["storeId"]), self._camera_zone(p.to_zone_id, ev["storeId"])
        if not a.store_zone_id or not b.store_zone_id or a.store_zone_id == b.store_zone_id:
            return  # transitions are only aggregated between distinct, mapped store zones
        bucket = self._bucket(ev["storeId"], p.occurred_at)
        agg = self.db.scalars(select(MovementAggregate).where(MovementAggregate.store_id == ev["storeId"])
                              .where(MovementAggregate.from_zone_id == a.store_zone_id).where(MovementAggregate.to_zone_id == b.store_zone_id)
                              .where(MovementAggregate.bucket_start == bucket)).first()
        if agg is None:
            self.db.add(MovementAggregate(store_id=ev["storeId"], from_zone_id=a.store_zone_id, to_zone_id=b.store_zone_id,
                                          bucket_start=bucket, transitions=1, source="cv"))
        else:
            agg.transitions += 1

    def _heatmap(self, ev: Dict[str, Any], at: datetime) -> None:
        p = HeatmapPayload.model_validate(ev["payload"])
        cam = ev.get("cameraId")
        if not cam or self.db.get(Camera, cam) is None:
            raise ValueError("heatmap.flush needs a known cameraId")
        bucket = self._bucket(ev["storeId"], p.bucket_start)
        existing = {(r.gx, r.gy): r for r in self.db.scalars(select(HeatmapCell).where(HeatmapCell.camera_id == cam)
                                                                .where(HeatmapCell.bucket_start == bucket))}
        merged: Dict[Tuple[int, int], int] = {}
        for cell in p.cells:  # a payload may repeat a cell: merge first so one UPSERT per cell reaches the unique index
            if len(cell) != 3 or not (0 <= cell[0] < p.grid_w and 0 <= cell[1] < p.grid_h) or cell[2] <= 0:
                raise ValueError("invalid heatmap cell")
            merged[(cell[0], cell[1])] = merged.get((cell[0], cell[1]), 0) + cell[2]
        for (gx, gy), n in merged.items():
            row = existing.get((gx, gy))
            if row is None:
                self.db.add(HeatmapCell(store_id=ev["storeId"], camera_id=cam, bucket_start=bucket, grid_w=p.grid_w, grid_h=p.grid_h, gx=gx, gy=gy, count=n))
            else:
                row.count += n

    # ------------------------------------------------------------------ queue
    def _queue_service(self, ev: Dict[str, Any], at: datetime) -> None:
        p = QueueServicePayload.model_validate(ev["payload"])
        c = self.db.get(CheckoutCounter, p.counter_id)
        if c is None or c.store_id != ev["storeId"]:
            raise ValueError(f"counter '{p.counter_id}' not found in store")
        try:
            with self.db.begin_nested():
                self.db.add(QueueServiceSample(store_id=ev["storeId"], counter_id=c.id, service_seconds=p.service_seconds,
                                               wait_seconds=p.wait_seconds, completed_at=p.completed_at, event_id=ev["eventId"][:40]))
                self.db.flush()
        except IntegrityError:
            raise _Duplicate()

    def _queue_updated(self, ev: Dict[str, Any], at: datetime) -> None:
        p = QueueUpdatePayload.model_validate(ev["payload"])
        store_id = ev["storeId"]
        counter = self.db.get(CheckoutCounter, p.counter_id)
        if counter is None or counter.store_id != store_id:
            raise ValueError(f"counter '{p.counter_id}' not found in store")
        region = self.db.get(QueueRegion, counter.id)
        assumed = region.assumed_service_rate_per_min if region else None
        w = estimate_wait(p.length, p.in_service, p.service_rate_per_min, assumed, counter_open=counter.status != "closed", reliable=p.reliable)
        warn_len = region.warning_length if region else 4
        crit_len = region.critical_length if region else 7
        warn_wait = region.warning_wait_seconds if region else 180.0
        crit_wait = region.critical_wait_seconds if region else 270.0
        level = p.congestion
        if w.seconds is not None and w.basis in ("measured", "assumption"):
            if w.seconds >= crit_wait:
                level = max(level, "critical", key=CONGESTION_RANK.get)
            elif w.seconds >= warn_wait:
                level = max(level, "high", key=CONGESTION_RANK.get)
        if not p.reliable:
            level = "optimal"  # an unreliable observation must not trigger congestion
        key = f"queue:{counter.id}"
        forecasts = forecast_queue(at, p.length, p.arrival_rate_per_min, p.service_rate_per_min, warn_len, crit_len, in_service=p.in_service) if p.reliable else []

        prev_level = self.mem.last_level.get(key)
        level_changed = prev_level is not None and prev_level != level
        self.mem.last_level[key] = level
        if self.mem.due(f"{key}:obs", at, self.settings.analytics_queue_persist_seconds) or level_changed:
            self.db.add(QueueObservation(store_id=store_id, counter_id=counter.id, queue_length=p.length, estimated_wait_seconds=w.seconds,
                                         camera_id=ev.get("cameraId"), arrival_rate_per_min=p.arrival_rate_per_min,
                                         service_rate_per_min=p.service_rate_per_min, wait_basis=w.basis, congestion=level,
                                         in_service=p.in_service, observed_at=at, source="cv"))
            if p.service_rate_per_min:
                counter.service_rate_per_min = p.service_rate_per_min  # measured rate replaces any manual value
        if forecasts and self.mem.due(f"{key}:fc", at, self.settings.analytics_forecast_persist_seconds):
            for f in forecasts:
                self.db.add(QueueForecast(store_id=store_id, counter_id=counter.id, horizon_minutes=f.horizon_minutes, predicted_length=f.predicted_length,
                                          confidence=None, forecast_for=f.forecast_for, predicted_wait_seconds=f.predicted_wait_seconds,
                                          congestion_risk=f.congestion_risk, model_version=f.model_version, generated_at=at, source="cv",
                                          inputs={"length": p.length, "arrivalRate": p.arrival_rate_per_min, "serviceRate": p.service_rate_per_min,
                                                  "basis": f.basis, "driftPerMin": f.drift_per_min}))
        self._queue_alerts(store_id, counter, region, p, level, w, forecasts, at, ev.get("cameraId"))
        out = {"eventId": ev["eventId"], "occurredAt": ev["timestamp"], "cameraId": ev.get("cameraId"), "counterId": counter.id,
               "length": p.length, "inService": p.in_service, "arrivalRatePerMin": p.arrival_rate_per_min, "serviceRatePerMin": p.service_rate_per_min,
               "estimatedWaitSeconds": w.seconds, "waitBasis": w.basis, "congestion": level, "reliable": p.reliable,
               "forecast": [{"horizonMinutes": f.horizon_minutes, "predictedLength": f.predicted_length, "risk": f.congestion_risk, "basis": f.basis} for f in forecasts]}
        self._publish(store_id, "queue.updated", out)
        if level_changed:
            cong = {"eventId": f"{ev['eventId']}-c"[:40], "counterId": counter.id, "level": level, "previousLevel": prev_level, "length": p.length,
                    "occurredAt": ev["timestamp"]}
            self._log_event(ev, at, event_type="queue.congestion", severity=severity_for("queue.congestion", cong), payload=cong,
                            event_id=cong["eventId"])
            self._publish(store_id, "queue.congestion", {**cong, "severity": severity_for("queue.congestion", cong)})

    def _queue_alerts(self, store_id: str, counter: CheckoutCounter, region: Optional[QueueRegion], p: QueueUpdatePayload, level: str,
                      w, forecasts, at: datetime, camera_id: Optional[str]) -> None:
        s = self.settings
        name = counter.name
        evidence = {"length": p.length, "inService": p.in_service, "waitSeconds": w.seconds, "waitBasis": w.basis,
                    "arrivalRate": p.arrival_rate_per_min, "serviceRate": p.service_rate_per_min}
        action = "Open another counter or call for checkout help."
        # 1) excessive length / wait
        k = f"queue:{counter.id}:congestion"
        act = self.mem.hold(k, level in ("high", "critical"), at, s.alert_hold_seconds, s.alert_clear_seconds)
        if act in ("raise", "refresh"):
            sev = "critical" if level == "critical" else "warning"
            wait_txt = f"; estimated wait {w.seconds / 60:.1f} min ({w.basis})" if w.seconds is not None else ""
            self.alerts.raise_alert(store_id, k, now=at, module="queue", category="queue_congestion", severity=sev,
                                    title=f"{name}: {p.length} waiting", description=f"{p.length} customers waiting{wait_txt}.",
                                    counter_id=counter.id, camera_id=camera_id, recommended_action=action, evidence=evidence)
        elif act == "clear":
            self.alerts.resolve(store_id, k, at)
        # 2) congestion expected to build (only while not already congested)
        k2 = f"queue:{counter.id}:trend"
        # A factual rule, not a prediction: measured arrivals clearly exceed measured service capacity while a queue exists.
        lam, mu = p.arrival_rate_per_min, p.service_rate_per_min
        building = bool(p.reliable and lam is not None and mu and lam >= 1.3 * mu and level not in ("high", "critical")
                        and p.length >= max(2, (region.warning_length if region else 4) // 2))
        act = self.mem.hold(k2, building, at, s.alert_hold_seconds, s.alert_clear_seconds)
        if act in ("raise", "refresh"):
            self.alerts.raise_alert(store_id, k2, now=at, module="queue", category="queue_congestion", severity="warning",
                                    title=f"{name}: queue is growing",
                                    description=f"Customers are arriving ({lam:.1f}/min) faster than they are served ({mu:.1f}/min).",
                                    counter_id=counter.id, camera_id=camera_id, recommended_action="Prepare an additional cashier.",
                                    evidence={**evidence, "arrivalToServiceRatio": round(lam / mu, 2)})
        elif act == "clear":
            self.alerts.resolve(store_id, k2, at)

    # ------------------------------------------------------------------ shelf / inventory
    def _shelf_observation(self, ev: Dict[str, Any], at: datetime) -> None:
        p = ShelfObservationPayload.model_validate({**ev["payload"], "observedAt": ev["payload"].get("observedAt", ev["timestamp"])})
        store_id = ev["storeId"]
        shelf = self.db.get(Shelf, p.shelf_id)
        if shelf is None or shelf.store_id != store_id:
            raise ValueError(f"shelf '{p.shelf_id}' not found in store")
        region = self.db.get(ShelfRegion, shelf.id)
        key = f"shelf:{shelf.id}"
        persist = p.changed or self.mem.due(f"{key}:obs", at, self.settings.analytics_shelf_persist_seconds)
        product_id = None
        if len(p.per_class) == 1:
            cand = next(iter(p.per_class))
            from database.models import Product
            product_id = cand if self.db.get(Product, cand) is not None else None
        if persist:
            self.db.add(ShelfObservation(
                store_id=store_id, shelf_id=shelf.id, product_id=product_id, detected_units=p.count, confidence=p.mean_confidence,
                planogram_compliance_pct=(p.planogram or {}).get("compliancePct"), camera_id=ev.get("cameraId"), status=p.status,
                availability_pct=p.availability_pct, expected_units=p.expected_units, model_id=p.model_id, observed_at=p.observed_at, source="cv",
                evidence={"perClass": p.per_class, "rawStatus": p.raw_status, "occludedFraction": p.occluded_fraction, "reason": p.reason,
                          "modelVersion": p.model_version, "boxes": p.boxes[:60], "planogram": p.planogram}))
        if p.changed or persist:
            self._publish(store_id, "shelf.updated", {"eventId": ev["eventId"], "occurredAt": ev["timestamp"], "cameraId": ev.get("cameraId"),
                                                         "shelfId": shelf.id, "status": p.status, "count": p.count, "expected": p.expected_units,
                                                         "availabilityPct": p.availability_pct, "confidence": p.mean_confidence})
        k = f"inventory:{shelf.id}:stock"
        zone = shelf.aisle_location or shelf.department
        evidence = {"observed": p.count, "expected": p.expected_units, "availabilityPct": p.availability_pct, "cameraId": ev.get("cameraId"),
                    "modelId": p.model_id, "perClass": p.per_class, "status": p.status}
        if p.status in ("low_stock", "out_of_stock"):
            out = p.status == "out_of_stock"
            alert = self.alerts.raise_alert(
                store_id, k, now=at, module="inventory", category="stock_shortage", severity="critical" if out else "warning",
                title=f"{shelf.shelf_code} is out of stock" if out else f"{shelf.shelf_code} is running low",
                description=(f"No product visible on the shelf (expected about {p.expected_units})." if out else
                             f"{p.count} of about {p.expected_units} units visible ({p.availability_pct}%)."),
                zone=zone, camera_id=ev.get("cameraId"), shelf_id=shelf.id, recommended_action="Restock this shelf.", evidence=evidence)
            if p.changed:
                kind = "inventory.out_of_stock" if out else "inventory.low_stock"
                pay = {"eventId": f"{ev['eventId']}-s"[:40], "shelfId": shelf.id, "cameraId": ev.get("cameraId"), "observed": p.count,
                       "expected": p.expected_units, "availabilityPct": p.availability_pct, "occurredAt": ev["timestamp"],
                       "alertId": alert.id if alert else None, "severity": severity_for(kind)}
                self._log_event(ev, at, event_type=kind, severity=severity_for(kind), payload=pay, event_id=pay["eventId"])
                self._publish(store_id, kind, pay)
        elif p.status == "in_stock" and p.changed:
            self.alerts.resolve(store_id, k, at, "stock restored (confirmed)")

    # ------------------------------------------------------------------ camera health
    def _entrance_cameras(self, store_id: str) -> List[str]:
        return [z.camera_id for z in self.db.scalars(select(CameraZone).where(CameraZone.store_id == store_id).where(CameraZone.enabled.is_(True))) if z.line]

    def _camera_disconnected(self, ev: Dict[str, Any], at: datetime) -> None:
        store_id, cam_id = ev["storeId"], ev.get("cameraId")
        p = ev.get("payload", {})
        self._log_event(ev, at, severity="warning")
        cam = self.db.get(Camera, cam_id) if cam_id else None
        name = cam.name if cam else cam_id
        self.alerts.raise_alert(store_id, f"camera:{cam_id}:offline", now=at, module="camera", category="camera_disconnected", severity="warning",
                                title=f"{name} is offline", description=p.get("message") or "The camera stopped delivering frames.",
                                camera_id=cam_id if cam else None, recommended_action="Check power, network and the camera source.",
                                evidence={"state": p.get("state"), "errorCode": p.get("errorCode"), "previous": p.get("previousState")})
        if cam_id in self._entrance_cameras(store_id):
            row, occ = self._load_occupancy(store_id)
            occ = self.occ.camera_lost(occ, at)
            self._save_occupancy(row, occ, at)
        for r in self.db.scalars(select(QueueRegion).where(QueueRegion.camera_id == cam_id)):
            self.alerts.raise_alert(store_id, f"queue:{r.counter_id}:camera", now=at, module="queue", category="camera_disconnected", severity="warning",
                                    title="Queue camera unavailable", description="Queue length and wait time are not being observed.",
                                    counter_id=r.counter_id, camera_id=cam_id, recommended_action="Restore the checkout camera.")
        self._publish(store_id, "camera.disconnected", {"eventId": ev["eventId"], "occurredAt": ev["timestamp"], "cameraId": cam_id, **p})
        self._publish(store_id, "camera.status", {"cameraId": cam_id, "state": p.get("state") or "offline", "previousState": p.get("previousState"),
                                                  "errorCode": p.get("errorCode"), "message": p.get("message"), "occurredAt": ev["timestamp"]})

    def _camera_connected(self, ev: Dict[str, Any], at: datetime) -> None:
        store_id, cam_id = ev["storeId"], ev.get("cameraId")
        self._log_event(ev, at, severity="info")
        self.alerts.resolve(store_id, f"camera:{cam_id}:offline", at, "camera back online")
        for r in self.db.scalars(select(QueueRegion).where(QueueRegion.camera_id == cam_id)):
            self.alerts.resolve(store_id, f"queue:{r.counter_id}:camera", at, "camera back online")
        if cam_id in self._entrance_cameras(store_id):
            down = [c for c in self._entrance_cameras(store_id) if c != cam_id and (self.db.get(CameraStatus, c) or CameraStatus(camera_id=c)).state not in ("live", "buffering")]
            if not down:
                row, occ = self._load_occupancy(store_id)
                occ = self.occ.camera_restored(occ, at)
                self._save_occupancy(row, occ, at)
        self._publish(store_id, "camera.connected", {"eventId": ev["eventId"], "occurredAt": ev["timestamp"], "cameraId": cam_id, **ev.get("payload", {})})
        cp = ev.get("payload", {})
        self._publish(store_id, "camera.status", {"cameraId": cam_id, "state": cp.get("state") or "live", "previousState": cp.get("previousState"),
                                                  "errorCode": None, "message": None, "occurredAt": ev["timestamp"]})


class _Duplicate(Exception):
    """Raised inside a handler when a durable unique id shows the event was already stored."""
