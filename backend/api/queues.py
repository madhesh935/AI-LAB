from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from api.deps import DbSession
from schemas.monitoring import CounterOut, CounterStatusBody, DeployRecommendationBody, QueueIntelligenceOut, QueueRulesBody
from schemas.operations import AlertOut, TaskOut
from services.alerts import AlertService
from services.queues import QueueService

router = APIRouter(prefix="/api/stores/{store_id}", tags=["queues"])


@router.get("/queue-intelligence", response_model=QueueIntelligenceOut)
def queue_intelligence(store_id: str, db: DbSession, range: str = Query("today"), section: Optional[str] = Query(None)):
    return QueueService(db).overview(store_id, range, section)


@router.post("/counters/{counter_id}/status", response_model=CounterOut)
def set_counter_status(store_id: str, counter_id: str, body: CounterStatusBody, db: DbSession):
    return QueueService(db).set_status(store_id, counter_id, body.status)


@router.post("/queue/recommendations/{recommendation_id}/deploy", response_model=TaskOut)
def deploy_recommendation(store_id: str, recommendation_id: str, body: DeployRecommendationBody, db: DbSession):
    return QueueService(db).deploy_recommendation(store_id, recommendation_id, body)


@router.post("/queue/alerts/{alert_id}/resolve", response_model=AlertOut)
def resolve_queue_alert(store_id: str, alert_id: str, db: DbSession):
    return AlertService(db).resolve(alert_id)


@router.put("/queue/rules", response_model=QueueRulesBody)
def save_rules(store_id: str, body: QueueRulesBody, db: DbSession):
    return QueueService(db).save_rules(store_id, body)
