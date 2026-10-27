from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query

from api.deps import DbSession, SettingsDep
from schemas.platform import (
    InsightActionBody,
    InsightCreate,
    InsightOut,
    InsightsOut,
    InsightTaskBody,
    InsightTaskOut,
)
from services.insights import InsightService

router = APIRouter(prefix="/api/stores/{store_id}/insights", tags=["insights"])


@router.get("", response_model=InsightsOut)
def insights(
    store_id: str,
    db: DbSession,
    settings: SettingsDep,
    range: str = Query("today"),
    category: Optional[str] = Query(None, max_length=40),
    severity: Optional[str] = Query(None, max_length=8),
    status: Optional[str] = Query(None, max_length=12),
):
    return InsightService(db, settings).overview(store_id, range, category, severity, status)


@router.post("", response_model=InsightOut, status_code=201)
def create_insight(store_id: str, body: InsightCreate, db: DbSession):
    return InsightService(db).create(store_id, body)


@router.post("/{insight_id}/actions", response_model=InsightOut)
def insight_action(store_id: str, insight_id: str, body: InsightActionBody, db: DbSession):
    return InsightService(db).act(insight_id, body)


@router.post("/{insight_id}/tasks", response_model=InsightTaskOut, status_code=201)
def insight_task(store_id: str, insight_id: str, body: InsightTaskBody, db: DbSession):
    return InsightService(db).create_task(insight_id, body)
