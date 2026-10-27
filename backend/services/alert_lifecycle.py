"""Alert lifecycle shared by every module: one open alert per dedupe key, escalate in place, auto-resolve, no flapping."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.events import event_bus
from database.models import Alert

SEVERITY_RANK = {"info": 0, "warning": 1, "critical": 2}
OPEN = ("active", "acknowledged")


class AlertLifecycle:
    def __init__(self, db: Session, reopen_cooldown_seconds: float = 300.0):
        self.db = db
        self.reopen_cooldown = timedelta(seconds=reopen_cooldown_seconds)

    def _latest(self, store_id: str, key: str) -> Optional[Alert]:
        return self.db.scalars(
            select(Alert).where(Alert.store_id == store_id).where(Alert.dedupe_key == key)
            .order_by(Alert.created_at.desc(), Alert.id.desc()).limit(1)
        ).first()

    def raise_alert(self, store_id: str, key: str, *, now: datetime, module: str, category: str, severity: str, title: str,
                    description: str, zone: Optional[str] = None, camera_id: Optional[str] = None, shelf_id: Optional[str] = None,
                    counter_id: Optional[str] = None, recommended_action: Optional[str] = None,
                    evidence: Optional[Dict[str, Any]] = None) -> Optional[Alert]:
        """Create, escalate or refresh the alert for `key`. Returns the Alert only when something NEW happened
        (created / reopened / escalated); a plain repeat just bumps the counter and returns None."""
        ev_text = json.dumps(evidence, default=str, separators=(",", ":")) if evidence is not None else None
        cur = self._latest(store_id, key)
        if cur is not None and cur.status in OPEN:
            cur.occurrences += 1
            cur.last_seen_at = now
            if ev_text:
                cur.evidence = ev_text
            if SEVERITY_RANK.get(severity, 0) > SEVERITY_RANK.get(cur.severity, 0):
                cur.severity, cur.title, cur.description = severity, title, description
                self._emit("ALERT_UPDATED", cur)
                return cur
            return None
        if cur is not None and cur.status == "resolved" and cur.resolved_at and now - cur.resolved_at < self.reopen_cooldown:
            cur.status, cur.resolved_at, cur.severity = "active", None, severity  # re-open instead of flapping a new row
            cur.occurrences += 1
            cur.last_seen_at, cur.title, cur.description = now, title, description
            if ev_text:
                cur.evidence = ev_text
            self._emit("ALERT_UPDATED", cur)
            return cur
        alert = Alert(
            id=f"ALT-{uuid.uuid4().hex[:8].upper()}", store_id=store_id, module=module, category=category, severity=severity,
            title=title, description=description, zone=zone, camera_id=camera_id, shelf_id=shelf_id, counter_id=counter_id,
            recommended_action=recommended_action, evidence=ev_text, status="active", source="cv", dedupe_key=key,
            occurrences=1, last_seen_at=now, created_at=now,
        )
        self.db.add(alert)
        self.db.flush()
        self._emit("ALERT_CREATED", alert)
        return alert

    def resolve(self, store_id: str, key: str, now: datetime, note: str = "condition cleared") -> Optional[Alert]:
        cur = self._latest(store_id, key)
        if cur is None or cur.status not in OPEN:
            return None
        cur.status, cur.resolved_at, cur.last_seen_at = "resolved", now, now
        cur.acknowledged_by = cur.acknowledged_by or "system"
        self.db.flush()
        self._emit("ALERT_RESOLVED", cur, extra={"note": note})
        return cur

    def _emit(self, kind: str, alert: Alert, extra: Optional[Dict[str, Any]] = None) -> None:
        payload = {"alertId": alert.id, "severity": alert.severity, "title": alert.title, "module": alert.module,
                   "dedupeKey": alert.dedupe_key, "shelfId": alert.shelf_id, "counterId": alert.counter_id, "cameraId": alert.camera_id, **(extra or {})}
        event_bus.publish(alert.store_id, kind, payload, source="system")
        if alert.module == "inventory" and kind in ("ALERT_CREATED", "ALERT_UPDATED"):
            event_bus.publish(alert.store_id, "inventory.alert", {**payload, "status": alert.status}, source="system")
