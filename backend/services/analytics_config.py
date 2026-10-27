"""Configuration of camera-space zones, counting lines, calibration, queue regions and shelf regions.

All geometry is data (SQLite rows). The vision worker re-reads it every few seconds, so changes take effect without a restart
and no camera geometry is ever hardcoded in inference code.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from analytics.geometry import fit_homography, infer_in_side, reprojection_rmse
from core.errors import ConflictError, InvalidStateError, NotFoundError
from core.events import event_bus
from database.models import (
    Camera, CameraCalibration, CameraZone, CheckoutCounter, QueueRegion, Shelf, ShelfRegion, StoreZone,
)
from schemas.analytics import CalibrationBody, CameraZoneBody, QueueRegionBody, ShelfRegionBody
from services.common import get_store_or_404


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "zone"


def zone_out(z: CameraZone) -> Dict[str, Any]:
    cfg = z.config or {}
    return {
        "id": z.id, "storeId": z.store_id, "cameraId": z.camera_id, "storeZoneId": z.store_zone_id, "name": z.name,
        "zoneType": z.zone_type, "polygon": z.polygon or [], "line": z.line, "enabled": z.enabled,
        "minDwellSeconds": cfg.get("minDwellSeconds"), "exitGraceSeconds": cfg.get("exitGraceSeconds"),
    }


class AnalyticsConfigService:
    def __init__(self, db: Session):
        self.db = db

    def _camera(self, store_id: str, camera_id: str) -> Camera:
        cam = self.db.get(Camera, camera_id)
        if cam is None or cam.store_id != store_id:
            raise NotFoundError("Camera", camera_id)
        return cam

    def _changed(self, store_id: str, what: str, ident: str) -> None:
        event_bus.publish(store_id, "ANALYTICS_CONFIG_UPDATED", {"kind": what, "id": ident})

    # ------------------------------------------------------------------ camera zones
    def list_zones(self, store_id: str, camera_id: Optional[str] = None) -> List[Dict[str, Any]]:
        get_store_or_404(self.db, store_id)
        q = select(CameraZone).where(CameraZone.store_id == store_id).order_by(CameraZone.camera_id, CameraZone.id)
        if camera_id:
            q = q.where(CameraZone.camera_id == camera_id)
        return [zone_out(z) for z in self.db.scalars(q)]

    def save_zone(self, store_id: str, body: CameraZoneBody, zone_id: Optional[str] = None) -> Dict[str, Any]:
        get_store_or_404(self.db, store_id)
        self._camera(store_id, body.camera_id)
        if body.store_zone_id:
            sz = self.db.get(StoreZone, body.store_zone_id)
            if sz is None or sz.store_id != store_id:
                raise NotFoundError("Zone", body.store_zone_id)
        ident = zone_id or body.id or f"cz-{_slug(body.camera_id)}-{_slug(body.name)}"
        row = self.db.get(CameraZone, ident)
        if zone_id is None and row is not None:
            raise ConflictError(f"A camera zone with id '{ident}' already exists")
        if zone_id is not None and (row is None or row.store_id != store_id):
            raise NotFoundError("Camera zone", zone_id)
        if row is None:
            row = CameraZone(id=ident, store_id=store_id)
        row.camera_id, row.name, row.zone_type, row.store_zone_id = body.camera_id, body.name, body.zone_type, body.store_zone_id
        row.polygon, row.enabled = body.polygon, body.enabled
        cfg: Dict[str, Any] = {}
        if body.min_dwell_seconds is not None:
            cfg["minDwellSeconds"] = body.min_dwell_seconds
        if body.exit_grace_seconds is not None:
            cfg["exitGraceSeconds"] = body.exit_grace_seconds
        row.config = cfg
        if body.line is not None:
            ln = body.line
            in_side = ln.in_side or infer_in_side(tuple(ln.p1), tuple(ln.p2), tuple(ln.inside_point))  # type: ignore[arg-type]
            row.line = {"p1": ln.p1, "p2": ln.p2, "inSide": in_side, "margin": ln.margin, "minTrackAge": ln.min_track_age,
                        "cooldownSeconds": ln.cooldown_seconds, "countOnly": ln.count_only}
        else:
            row.line = None
        self.db.add(row)
        self.db.flush()
        self._changed(store_id, "camera_zone", row.id)
        return zone_out(row)

    def delete_zone(self, store_id: str, zone_id: str) -> None:
        row = self.db.get(CameraZone, zone_id)
        if row is None or row.store_id != store_id:
            raise NotFoundError("Camera zone", zone_id)
        self.db.delete(row)
        self.db.flush()
        self._changed(store_id, "camera_zone", zone_id)

    # ------------------------------------------------------------------ calibration
    def save_calibration(self, store_id: str, camera_id: str, body: CalibrationBody) -> Dict[str, Any]:
        self._camera(store_id, camera_id)
        try:
            h = fit_homography(body.image_points, body.floor_points)
            rmse = reprojection_rmse(h, body.image_points, body.floor_points)
        except ValueError as exc:
            raise InvalidStateError(f"Calibration rejected: {exc}") from None
        row = self.db.get(CameraCalibration, camera_id) or CameraCalibration(camera_id=camera_id)
        row.image_points, row.floor_points, row.homography, row.rmse = body.image_points, body.floor_points, h, round(rmse, 4)
        self.db.add(row)
        self.db.flush()
        self._changed(store_id, "calibration", camera_id)
        return self.get_calibration(store_id, camera_id) or {}

    def get_calibration(self, store_id: str, camera_id: str) -> Optional[Dict[str, Any]]:
        self._camera(store_id, camera_id)
        row = self.db.get(CameraCalibration, camera_id)
        if row is None:
            return None
        return {"cameraId": camera_id, "imagePoints": row.image_points, "floorPoints": row.floor_points, "homography": row.homography,
                "rmse": row.rmse, "updatedAt": row.updated_at.isoformat() if getattr(row, "updated_at", None) else None}

    def delete_calibration(self, store_id: str, camera_id: str) -> None:
        self._camera(store_id, camera_id)
        row = self.db.get(CameraCalibration, camera_id)
        if row is not None:
            self.db.delete(row)
            self.db.flush()
            self._changed(store_id, "calibration", camera_id)

    # ------------------------------------------------------------------ queue regions
    def _counter(self, store_id: str, counter_id: str) -> CheckoutCounter:
        c = self.db.get(CheckoutCounter, counter_id)
        if c is None or c.store_id != store_id:
            raise NotFoundError("Counter", counter_id)
        return c

    def queue_region_out(self, r: QueueRegion) -> Dict[str, Any]:
        return {"counterId": r.counter_id, "cameraId": r.camera_id, "queuePolygon": r.queue_polygon, "servicePolygon": r.service_polygon,
                "priority": r.priority, "warningLength": r.warning_length, "criticalLength": r.critical_length,
                "warningWaitSeconds": r.warning_wait_seconds, "criticalWaitSeconds": r.critical_wait_seconds,
                "assumedServiceRatePerMin": r.assumed_service_rate_per_min, "enabled": r.enabled}

    def list_queue_regions(self, store_id: str) -> List[Dict[str, Any]]:
        get_store_or_404(self.db, store_id)
        return [self.queue_region_out(r) for r in self.db.scalars(select(QueueRegion).where(QueueRegion.store_id == store_id).order_by(QueueRegion.counter_id))]

    def save_queue_region(self, store_id: str, counter_id: str, body: QueueRegionBody) -> Dict[str, Any]:
        counter = self._counter(store_id, counter_id)
        self._camera(store_id, body.camera_id)
        row = self.db.get(QueueRegion, counter_id) or QueueRegion(counter_id=counter_id, store_id=store_id)
        row.camera_id, row.queue_polygon, row.service_polygon, row.priority = body.camera_id, body.queue_polygon, body.service_polygon, body.priority
        row.warning_length, row.critical_length = body.warning_length, body.critical_length
        row.warning_wait_seconds, row.critical_wait_seconds = body.warning_wait_seconds, body.critical_wait_seconds
        row.assumed_service_rate_per_min, row.enabled = body.assumed_service_rate_per_min, body.enabled
        counter.camera_id = body.camera_id  # keep the Phase-1 counter->camera mapping consistent
        self.db.add(row)
        self.db.flush()
        self._changed(store_id, "queue_region", counter_id)
        return self.queue_region_out(row)

    def delete_queue_region(self, store_id: str, counter_id: str) -> None:
        self._counter(store_id, counter_id)
        row = self.db.get(QueueRegion, counter_id)
        if row is not None:
            self.db.delete(row)
            self.db.flush()
            self._changed(store_id, "queue_region", counter_id)

    # ------------------------------------------------------------------ shelf regions
    def _shelf(self, store_id: str, shelf_id: str) -> Shelf:
        s = self.db.get(Shelf, shelf_id)
        if s is None or s.store_id != store_id:
            raise NotFoundError("Shelf", shelf_id)
        return s

    def shelf_region_out(self, r: ShelfRegion) -> Dict[str, Any]:
        return {"shelfId": r.shelf_id, "cameraId": r.camera_id, "polygon": r.polygon, "classMap": r.class_map,
                "expectedVisibleCapacity": r.expected_visible_capacity, "lowStockPct": r.low_stock_pct, "outOfStockPct": r.out_of_stock_pct,
                "confirmObservations": r.confirm_observations, "minConfidence": r.min_confidence, "intervalSeconds": r.interval_seconds,
                "slots": r.slots or [], "enabled": r.enabled}

    def list_shelf_regions(self, store_id: str) -> List[Dict[str, Any]]:
        get_store_or_404(self.db, store_id)
        return [self.shelf_region_out(r) for r in self.db.scalars(select(ShelfRegion).where(ShelfRegion.store_id == store_id).order_by(ShelfRegion.shelf_id))]

    def save_shelf_region(self, store_id: str, shelf_id: str, body: ShelfRegionBody) -> Dict[str, Any]:
        shelf = self._shelf(store_id, shelf_id)
        self._camera(store_id, body.camera_id)
        row = self.db.get(ShelfRegion, shelf_id) or ShelfRegion(shelf_id=shelf_id, store_id=store_id)
        row.camera_id, row.polygon, row.class_map = body.camera_id, body.polygon, body.class_map
        row.expected_visible_capacity, row.low_stock_pct, row.out_of_stock_pct = body.expected_visible_capacity, body.low_stock_pct, body.out_of_stock_pct
        row.confirm_observations, row.min_confidence, row.interval_seconds = body.confirm_observations, body.min_confidence, body.interval_seconds
        row.slots, row.enabled = [{"slotId": s.slot_id, "rect": s.rect, "expectedClass": s.expected_class} for s in body.slots], body.enabled
        shelf.camera_id = body.camera_id
        self.db.add(row)
        self.db.flush()
        self._changed(store_id, "shelf_region", shelf_id)
        return self.shelf_region_out(row)

    def delete_shelf_region(self, store_id: str, shelf_id: str) -> None:
        self._shelf(store_id, shelf_id)
        row = self.db.get(ShelfRegion, shelf_id)
        if row is not None:
            self.db.delete(row)
            self.db.flush()
            self._changed(store_id, "shelf_region", shelf_id)

    def overview(self, store_id: str) -> Dict[str, Any]:
        return {"storeId": store_id, "cameraZones": self.list_zones(store_id), "queueRegions": self.list_queue_regions(store_id),
                "shelfRegions": self.list_shelf_regions(store_id)}
