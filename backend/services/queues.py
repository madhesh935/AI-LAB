from __future__ import annotations

from typing import List, Optional

from sqlalchemy.orm import Session

from core.errors import NotFoundError
from core.events import event_bus
from database.models import CheckoutCounter, QueueRules
from repositories.base import get_or_404
from repositories.telemetry import QueueRepository
from schemas.common import Meta
from schemas.monitoring import (
    CounterOut,
    DeployRecommendationBody,
    QueueForecastOut,
    QueueIntelligenceOut,
    QueueKpisOut,
    QueueRulesBody,
)
from schemas.operations import TaskCreate, TaskOut
from services.alerts import AlertService
from services.common import congestion_level, get_store_or_404, resolve_window
from services.tasks import TaskService

SECTION_TYPES = {"main": "standard", "express": "express", "self_checkout": "self_checkout"}


class QueueService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = QueueRepository(db)

    def rules(self, store_id: str) -> QueueRulesBody:
        row = self.repo.rules(store_id)
        return QueueRulesBody(**(row.config if row and row.config else {}))

    def counters(self, store_id: str, section: Optional[str] = None) -> List[CounterOut]:
        get_store_or_404(self.db, store_id)
        sla = self.rules(store_id).sla_critical_wait_minutes
        observations = self.repo.latest_observations(store_id)
        counters = list(self.repo.counters(store_id))
        names = self.repo.employee_names([c.cashier_employee_id for c in counters if c.cashier_employee_id])
        wanted = SECTION_TYPES.get(section or "")

        out: List[CounterOut] = []
        for c in counters:
            if wanted and c.counter_type != wanted:
                continue
            obs = observations.get(c.id)
            wait_min = (obs.estimated_wait_seconds / 60) if obs and obs.estimated_wait_seconds is not None else None
            out.append(
                CounterOut(
                    id=c.id,
                    name=c.name,
                    counter_type=c.counter_type,
                    status=c.status,
                    cashier_name=names.get(c.cashier_employee_id or ""),
                    camera_id=c.camera_id,
                    waiting_customers=obs.queue_length if obs else None,
                    estimated_wait_minutes=round(wait_min, 1) if wait_min is not None else None,
                    congestion=congestion_level(wait_min, sla) if wait_min is not None else "optimal",
                    avg_items_per_customer=obs.avg_items_per_customer if obs else None,
                    service_rate_per_min=c.service_rate_per_min,
                    last_observation_at=obs.observed_at if obs else None,
                )
            )
        return out

    def kpis(self, counters: List[CounterOut]) -> QueueKpisOut:
        observed = [c for c in counters if c.waiting_customers is not None and c.status == "open"]
        waits = [c.estimated_wait_minutes for c in observed if c.estimated_wait_minutes is not None]
        return QueueKpisOut(
            active_counters=sum(1 for c in counters if c.status == "open"),
            total_counters=len(counters),
            customers_waiting=sum(c.waiting_customers or 0 for c in observed) if observed else None,
            average_wait_minutes=round(sum(waits) / len(waits), 1) if waits else None,
            longest_wait_minutes=max(waits) if waits else None,
            congested_counters=sum(1 for c in counters if c.congestion in ("high", "critical")),
        )

    def meta(self, store_id: str, counters: List[CounterOut]) -> Meta:
        stamps = [c.last_observation_at for c in counters if c.last_observation_at]
        if not counters:
            return Meta(data_state="empty", note="No checkout counters are configured for this store.")
        if not stamps:
            return Meta(data_state="unavailable", note="Counters are configured but no camera has reported queue lengths yet.")
        return Meta(data_state="available", last_observation_at=max(stamps), sources=["queue_observations"])

    def overview(self, store_id: str, range_key: str = "today", section: Optional[str] = None) -> QueueIntelligenceOut:
        store = get_store_or_404(self.db, store_id)
        counters = self.counters(store_id, section)
        wanted = {c.id for c in counters}
        forecasts = [
            QueueForecastOut(counter_id=f.counter_id, horizon_minutes=f.horizon_minutes, predicted_length=f.predicted_length, confidence=f.confidence, generated_at=f.generated_at)
            for f in self.repo.latest_forecasts(store_id)
            if f.counter_id in wanted
        ]
        return QueueIntelligenceOut(
            store_id=store_id,
            range=resolve_window(store, range_key).label,
            kpis=self.kpis(counters),
            counters=counters,
            forecast=forecasts,
            alerts=AlertService(self.db).list(store_id, module="queue", limit=100).items,
            rules=self.rules(store_id),
            meta=self.meta(store_id, counters),
        )

    # -------------------------------------------------------------- commands
    def set_status(self, store_id: str, counter_id: str, status: str) -> CounterOut:
        counter = get_or_404(self.db, CheckoutCounter, counter_id, "Counter")
        if counter.store_id != store_id:
            raise NotFoundError("Counter", counter_id)
        counter.status = status
        self.db.flush()
        event_bus.publish(store_id, "COUNTER_STATUS", {"counterId": counter_id, "status": status})
        return next(c for c in self.counters(store_id) if c.id == counter_id)

    def save_rules(self, store_id: str, body: QueueRulesBody) -> QueueRulesBody:
        get_store_or_404(self.db, store_id)
        row = self.db.get(QueueRules, store_id) or QueueRules(store_id=store_id, config={})
        row.config = body.model_dump()
        self.db.add(row)
        self.db.flush()
        return body

    def deploy_recommendation(self, store_id: str, recommendation_id: str, body: DeployRecommendationBody) -> TaskOut:
        """Turns an accepted staffing recommendation into a real, assignable task."""
        get_store_or_404(self.db, store_id)
        counter = None
        if body.counter_id:
            counter = self.db.get(CheckoutCounter, body.counter_id)
            if counter is None or counter.store_id != store_id:
                raise NotFoundError("Counter", body.counter_id)
        title = body.title or (f"Support {counter.name}" if counter else "Checkout assistance")
        return TaskService(self.db).create(
            store_id,
            TaskCreate(
                title=title,
                description=f"Queue staffing recommendation {recommendation_id}",
                category="checkout_assistance",
                counter_id=counter.id if counter else None,
                priority="high",
                zone=counter.name if counter else None,
                assigned_employee_id=body.employee_id,
                due_in_minutes=10,
                notes=body.notes,
            ),
            source="queue_recommendation",
            force_assign=True,
        )
