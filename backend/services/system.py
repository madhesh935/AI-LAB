from __future__ import annotations

from datetime import timedelta
from typing import Any, Dict

from sqlalchemy import func, inspect, select, text
from sqlalchemy.orm import Session

from core.config import Settings
from core.events import event_bus
from database.connection import Database
from database.models import (
    Alert,
    Camera,
    Employee,
    FootfallAggregate,
    InferenceEvent,
    QueueObservation,
    ShelfObservation,
    Store,
    Task,
)
from schemas.platform import SystemStatusOut
from services.common import now_utc

COUNTED = {"stores": Store, "cameras": Camera, "employees": Employee, "tasks": Task, "alerts": Alert, "shelfObservations": ShelfObservation, "queueObservations": QueueObservation}


class SystemService:
    def __init__(self, db: Session, database: Database, settings: Settings):
        self.db = db
        self.database = database
        self.settings = settings

    def schema_revision(self) -> str | None:
        if not inspect(self.database.engine).has_table("alembic_version"):
            return None
        return self.db.execute(text("SELECT version_num FROM alembic_version")).scalar()

    def status(self) -> SystemStatusOut:
        counts: Dict[str, int] = {k: self.db.scalar(select(func.count()).select_from(m)) or 0 for k, m in COUNTED.items()}
        last_inference = self.db.scalar(select(func.max(InferenceEvent.observed_at)))
        recent = bool(last_inference and now_utc() - last_inference < timedelta(minutes=5))
        demo = any(
            (self.db.scalar(select(func.count()).select_from(m).where(m.source == "demo")) or 0) > 0
            for m in (ShelfObservation, QueueObservation, FootfallAggregate, Alert, Task)
        )
        db_ok = self.database.ping()
        return SystemStatusOut(
            status="ok" if db_ok else "degraded",
            version=self.settings.app_version,
            environment=self.settings.environment,
            database={
                "ok": db_ok,
                "path": str(self.settings.db_path),
                "schemaRevision": self.schema_revision(),
                "journalMode": self.database.pragma("journal_mode") if db_ok else None,
                "foreignKeys": bool(self.database.pragma("foreign_keys")) if db_ok else None,
            },
            inference={
                "modelsConnected": recent,
                "lastEventAt": last_inference.isoformat() if last_inference else None,
                "note": "No computer-vision models ship in Phase 1; workers report through /api/stores/{id}/ingest.",
            },
            counts=counts,
            demo_data_present=demo,
            realtime_subscribers=event_bus.subscriber_count(),
            bound_host=self.settings.host,
        )
