"""Real-time snapshot + control-message helpers for the /ws/stores/{id}/events feed."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.config import Settings
from core.events import event_bus
from database.models import Alert, CustomerAssistanceRequest, Store
from repositories.operations import TaskRepository
from services.analytics_read import AnalyticsReadService
from services.cameras import LIVE_STATES, CameraService

HEARTBEAT_SECONDS = 15


def control(store_id: str, type_: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    """A control message (hello / snapshot / heartbeat / resync): same envelope, never consumes a sequence number."""
    return {"eventId": uuid.uuid4().hex, "seq": event_bus.current_seq(store_id), "storeId": store_id, "type": type_,
            "timestamp": datetime.now(timezone.utc).isoformat(), "source": "system", "payload": payload}


def snapshot(db: Session, settings: Settings, store: Store) -> Dict[str, Any]:
    """Cheap current-state summary sent right after connecting; pages still refetch their own detail."""
    store_id = store.id
    occ = AnalyticsReadService(db, settings).occupancy(store_id)
    active = db.scalar(select(func.count()).select_from(Alert).where(Alert.store_id == store_id).where(Alert.status == "active")) or 0
    critical = db.scalar(select(func.count()).select_from(Alert).where(Alert.store_id == store_id).where(Alert.status == "active").where(Alert.severity == "critical")) or 0
    pending = db.scalar(select(func.count()).select_from(CustomerAssistanceRequest).where(CustomerAssistanceRequest.store_id == store_id)
                        .where(CustomerAssistanceRequest.status.in_(("submitted", "assigned", "in_progress")))) or 0
    feeds = CameraService(db, settings).feeds(store_id)
    return {
        "dataMode": store.data_mode, "epoch": event_bus.epoch, "seq": event_bus.current_seq(store_id),
        "occupancy": {"estimate": occ["estimate"], "status": occ["status"]},
        "activeAlerts": active, "criticalAlerts": critical, "openTasks": TaskRepository(db).open_count(store_id),
        "pendingAssistanceRequests": pending, "camerasOnline": sum(1 for f in feeds if f.status in LIVE_STATES), "camerasTotal": len(feeds),
    }


def hello(store_id: str, replay: str) -> Dict[str, Any]:
    return control(store_id, "hello", {"epoch": event_bus.epoch, "heartbeatSeconds": HEARTBEAT_SECONDS, "replay": replay})
