"""Receiving structured results from AI inference workers.

Phase 1 ships NO computer-vision models. This is the write-side contract that
future workers use. Only structured observations are stored - never frames.
"""

from __future__ import annotations

import logging
from typing import Dict, List

from sqlalchemy.orm import Session

from core.events import event_bus
from database.models import (
    Camera,
    CameraStatus,
    CheckoutCounter,
    FootfallEvent,
    InferenceEvent,
    ModelRegistry,
    Product,
    QueueObservation,
    Shelf,
    ShelfObservation,
    Store,
    StoreZone,
    ZoneOccupancy,
)
from database.base import SOURCE_CV
from schemas.platform import IngestBatch, IngestResult
from services.common import get_store_or_404, now_utc

log = logging.getLogger("retailedge.ingest")


class IngestService:
    def __init__(self, db: Session):
        self.db = db

    def _owned(self, model, ident, store_id: str) -> bool:
        if ident is None:
            return True
        row = self.db.get(model, ident)
        return row is not None and getattr(row, "store_id", store_id) == store_id

    def ingest(self, store_id: str, batch: IngestBatch) -> IngestResult:
        store = get_store_or_404(self.db, store_id)
        now = now_utc()
        accepted: Dict[str, int] = {}
        rejected: Dict[str, int] = {}
        errors: List[str] = []
        model_id = batch.model_id if batch.model_id and self.db.get(ModelRegistry, batch.model_id) else None
        if batch.model_id and model_id is None:
            errors.append(f"Unknown model_id '{batch.model_id}' ignored")

        def ok(kind: str) -> None:
            accepted[kind] = accepted.get(kind, 0) + 1

        def bad(kind: str, why: str) -> None:
            rejected[kind] = rejected.get(kind, 0) + 1
            if len(errors) < 20:
                errors.append(f"{kind}: {why}")

        for item in batch.footfall:
            if not self._owned(Camera, item.camera_id, store_id):
                bad("footfall", f"camera '{item.camera_id}' not in store")
                continue
            self.db.add(FootfallEvent(store_id=store_id, camera_id=item.camera_id, direction=item.direction, count=item.count, observed_at=item.observed_at or now, source=SOURCE_CV))
            ok("footfall")

        for item in batch.shelf_observations:
            if not self._owned(Shelf, item.shelf_id, store_id) or self.db.get(Shelf, item.shelf_id) is None:
                bad("shelfObservations", f"shelf '{item.shelf_id}' not in store")
                continue
            if not self._owned(Product, item.product_id, store_id):
                bad("shelfObservations", f"product '{item.product_id}' not in store")
                continue
            self.db.add(ShelfObservation(store_id=store_id, shelf_id=item.shelf_id, product_id=item.product_id, detected_units=item.detected_units, confidence=item.confidence, planogram_compliance_pct=item.planogram_compliance_pct, observed_at=item.observed_at or now, source=SOURCE_CV))
            ok("shelfObservations")

        for item in batch.queue_observations:
            if self.db.get(CheckoutCounter, item.counter_id) is None or not self._owned(CheckoutCounter, item.counter_id, store_id):
                bad("queueObservations", f"counter '{item.counter_id}' not in store")
                continue
            self.db.add(QueueObservation(store_id=store_id, counter_id=item.counter_id, queue_length=item.queue_length, estimated_wait_seconds=item.estimated_wait_seconds, avg_items_per_customer=item.avg_items_per_customer, observed_at=item.observed_at or now, source=SOURCE_CV))
            ok("queueObservations")

        for item in batch.zone_occupancy:
            zone = self.db.get(StoreZone, item.zone_id)
            if zone is None or zone.store_id != store_id:
                bad("zoneOccupancy", f"zone '{item.zone_id}' not in store")
                continue
            self.db.add(ZoneOccupancy(store_id=store_id, zone_id=item.zone_id, count=item.count, observed_at=item.observed_at or now, source=SOURCE_CV))
            ok("zoneOccupancy")

        for item in batch.camera_status:
            cam = self.db.get(Camera, item.camera_id)
            if cam is None or cam.store_id != store_id:
                bad("cameraStatus", f"camera '{item.camera_id}' not in store")
                continue
            status = self.db.get(CameraStatus, cam.id) or CameraStatus(camera_id=cam.id)
            status.state = item.state
            status.fps = item.fps
            status.latency_ms = item.latency_ms
            status.packet_loss_pct = item.packet_loss_pct
            status.message = item.message
            status.last_checked_at = now
            if item.state in ("live", "buffering"):
                status.last_frame_at = now
            self.db.add(status)
            ok("cameraStatus")

        total = sum(accepted.values())
        if total:
            self.db.add(InferenceEvent(store_id=store_id, model_id=model_id, event_type="batch_ingest", payload={"accepted": accepted, "rejected": rejected}, observed_at=now, source=SOURCE_CV))
            if store.edge_server_status != "connected":
                store.edge_server_status = "connected"
            event_bus.publish(store_id, "TELEMETRY_UPDATED", {"accepted": accepted})
        self.db.flush()
        log.info("ingest batch", extra={"store_id": store_id, "accepted": accepted, "rejected": rejected})
        return IngestResult(accepted=accepted, rejected=rejected, errors=errors)
