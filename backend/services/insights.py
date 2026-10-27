from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy.orm import Session

from core.errors import InvalidStateError
from core.events import event_bus
from database.models import Insight
from repositories.base import get_or_404
from repositories.platform import InsightRepository
from schemas.common import Meta
from schemas.operations import TaskCreate
from schemas.platform import (
    InsightActionBody,
    InsightCreate,
    InsightKpisOut,
    InsightOut,
    InsightsOut,
    InsightTaskBody,
    InsightTaskOut,
)
from services.common import get_store_or_404, humanize, now_utc, resolve_window
from services.derived_insights import InsightDeriver
from services.tasks import TaskService


def to_insight_out(i: Insight, now=None) -> InsightOut:
    return InsightOut(
        id=i.id,
        code=i.code,
        category=i.category,
        severity=i.severity,
        status=i.status,
        title=i.title,
        zone=i.zone,
        timestamp=humanize(i.created_at, now),
        summary=i.summary,
        explanation=i.explanation,
        recommended_action=i.recommended_action,
        evidence=i.evidence or {},
        dismissed_reason=i.dismissed_reason,
        task_id=i.task_id,
        created_at=i.created_at,
        completed_at=i.completed_at,
        source=i.source,
    )


def _task_category(insight_category: str) -> str:
    """Map an insight category onto the single task-category vocabulary."""
    c = (insight_category or "").lower()
    if "stock" in c or "inventory" in c or "shelf" in c:
        return "shelf_replenishment"
    if "queue" in c or "checkout" in c:
        return "checkout_assistance"
    if "camera" in c:
        return "camera_maintenance"
    return "general_operations"


class InsightService:
    def __init__(self, db: Session, settings=None):
        self.db = db
        self.settings = settings
        self.repo = InsightRepository(db)

    def get(self, insight_id: str) -> Insight:
        return get_or_404(self.db, Insight, insight_id, "Insight")

    def overview(self, store_id: str, range_key: str = "today", category: Optional[str] = None, severity: Optional[str] = None, status: Optional[str] = None) -> InsightsOut:
        store = get_store_or_404(self.db, store_id)
        now = now_utc()
        deriver = InsightDeriver(self.db, self.settings)
        opportunities = deriver.sync(store_id)  # rule-based insights from live measurements, stored so the existing actions work on them
        rows = self.repo.list(store_id, category, severity, status)
        everything = self.repo.counts(store_id)

        def total(status_set, sev=None):
            return sum(n for (st, sv), n in everything.items() if st in status_set and (sev is None or sv == sev))

        kpis = InsightKpisOut(
            active_insights=total({"pending", "in_progress"}),
            critical_issues=total({"pending", "in_progress"}, "critical"),
            pending_actions=total({"pending"}),
            completed_recommendations=total({"completed"}),
        )
        has_any = bool(everything)
        return InsightsOut(
            store_id=store_id,
            range=resolve_window(store, range_key).label,
            kpis=kpis,
            insights=[to_insight_out(i, now) for i in rows],
            footfall_forecast=deriver.forecast_status(store_id),  # unavailable until a model is trained on >= 14 days of real counts
            opportunities=opportunities,
            meta=Meta(
                data_state="available" if has_any else "unavailable",
                sources=["insights"] if has_any else [],
                note=None if has_any else "No insight rule has fired: queues, shelves and cameras are within their limits.",
            ),
        )

    def create(self, store_id: str, body: InsightCreate, source: str = "system") -> InsightOut:
        get_store_or_404(self.db, store_id)
        insight = Insight(id=f"INS-{uuid.uuid4().hex[:8].upper()}", store_id=store_id, source=source, **body.model_dump())
        self.db.add(insight)
        self.db.flush()
        event_bus.publish(store_id, "INSIGHT_CREATED", {"insightId": insight.id, "severity": insight.severity})
        return to_insight_out(insight)

    def act(self, insight_id: str, body: InsightActionBody) -> InsightOut:
        insight = self.get(insight_id)
        if insight.status in ("completed", "dismissed") and body.action != "complete":
            raise InvalidStateError(f"This recommendation is already {insight.status}")
        if body.action in ("acknowledge", "start"):
            insight.status = "in_progress"
        elif body.action == "complete":
            insight.status = "completed"
            insight.completed_at = now_utc()
        elif body.action == "dismiss":
            insight.status = "dismissed"
            insight.dismissed_reason = body.reason or "Dismissed"
        self.db.flush()
        event_bus.publish(insight.store_id, "INSIGHT_UPDATED", {"insightId": insight.id, "status": insight.status})
        return to_insight_out(insight)

    def create_task(self, insight_id: str, body: InsightTaskBody) -> InsightTaskOut:
        insight = self.get(insight_id)
        task = TaskService(self.db).create(
            insight.store_id,
            TaskCreate(
                title=insight.title[:200],
                description=body.instructions or insight.recommended_action,
                category=_task_category(insight.category),
                priority=body.priority,
                zone=insight.zone,
                assigned_employee_id=body.employee_id,
                due_in_minutes=body.due_in_minutes,
            ),
            source="insight",
            force_assign=True,  # the manager picked this employee explicitly
        )
        insight.task_id = task.id
        if insight.status == "pending":
            insight.status = "in_progress"
        self.db.flush()
        return InsightTaskOut(insight=to_insight_out(insight), task=task)
