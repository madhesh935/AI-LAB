from __future__ import annotations

import uuid
from typing import List, Optional

from sqlalchemy.orm import Session

from core.errors import InvalidStateError, NotFoundError
from core.events import event_bus
from database.models import Alert, Camera, CheckoutCounter, Shelf
from repositories.base import get_or_404
from repositories.operations import AlertRepository
from schemas.common import Meta
from schemas.operations import AlertCreate, AlertList, AlertOut, AlertPatch
from services.common import get_store_or_404, humanize, now_utc


def to_alert_out(alert: Alert, now=None) -> AlertOut:
    return AlertOut(
        id=alert.id,
        store_id=alert.store_id,
        title=alert.title,
        description=alert.description,
        category=alert.category,
        module=alert.module,
        severity=alert.severity,
        zone=alert.zone,
        timestamp=humanize(alert.created_at, now),
        created_at=alert.created_at,
        recommended_action=alert.recommended_action,
        evidence=alert.evidence,
        status=alert.status,
        acknowledged_by=alert.acknowledged_by,
        acknowledged_at=alert.acknowledged_at,
        resolved_at=alert.resolved_at,
        camera_id=alert.camera_id,
        shelf_id=alert.shelf_id,
        counter_id=alert.counter_id,
        task_id=alert.task_id,
        source=alert.source,
    )


class AlertService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = AlertRepository(db)

    def list(self, store_id: str, status: Optional[str] = None, severity: Optional[str] = None, module: Optional[str] = None, limit: int = 200, offset: int = 0) -> AlertList:
        get_store_or_404(self.db, store_id)
        rows, total = self.repo.list(store_id, status, severity, module, limit, offset)
        now = now_utc()
        items = [to_alert_out(a, now) for a in rows]
        meta = Meta(data_state="available" if items else "empty", sources=["alerts"], note=None if items else "No alerts match the filters.")
        return AlertList(items=items, total=total, meta=meta)

    def get(self, alert_id: str) -> Alert:
        return get_or_404(self.db, Alert, alert_id, "Alert")

    def create(self, store_id: str, body: AlertCreate) -> AlertOut:
        get_store_or_404(self.db, store_id)
        # Referenced entities must belong to this store.
        for model, ident, label in ((Camera, body.camera_id, "Camera"), (Shelf, body.shelf_id, "Shelf"), (CheckoutCounter, body.counter_id, "Counter")):
            if ident:
                row = self.db.get(model, ident)
                if row is None or row.store_id != store_id:
                    raise NotFoundError(label, ident)
        alert = Alert(id=f"ALT-{uuid.uuid4().hex[:8].upper()}", store_id=store_id, **body.model_dump(exclude={"source"}), source=body.source)
        self.db.add(alert)
        self.db.flush()
        event_bus.publish(store_id, "ALERT_CREATED", {"alertId": alert.id, "severity": alert.severity, "title": alert.title})
        return to_alert_out(alert)

    def update(self, alert_id: str, body: AlertPatch) -> AlertOut:
        alert = self.get(alert_id)
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(alert, field, value)
        self.db.flush()
        event_bus.publish(alert.store_id, "ALERT_UPDATED", {"alertId": alert.id})
        return to_alert_out(alert)

    def acknowledge(self, alert_id: str, actor: Optional[str] = None) -> AlertOut:
        alert = self.get(alert_id)
        if alert.status == "resolved":
            raise InvalidStateError("A resolved alert cannot be acknowledged")
        if alert.status == "active":
            alert.status = "acknowledged"
            alert.acknowledged_at = now_utc()
            alert.acknowledged_by = actor or alert.acknowledged_by
            self.db.flush()
            event_bus.publish(alert.store_id, "ALERT_ACKNOWLEDGED", {"alertId": alert.id})
        return to_alert_out(alert)

    def resolve(self, alert_id: str, actor: Optional[str] = None) -> AlertOut:
        alert = self.get(alert_id)
        if alert.status != "resolved":
            alert.status = "resolved"
            alert.resolved_at = now_utc()
            if actor and not alert.acknowledged_by:
                alert.acknowledged_by = actor
            self.db.flush()
            event_bus.publish(alert.store_id, "ALERT_RESOLVED", {"alertId": alert.id})
        return to_alert_out(alert)

    def delete(self, alert_id: str) -> None:
        alert = self.get(alert_id)
        store_id = alert.store_id
        self.db.delete(alert)
        self.db.flush()
        event_bus.publish(store_id, "ALERT_DELETED", {"alertId": alert_id})
