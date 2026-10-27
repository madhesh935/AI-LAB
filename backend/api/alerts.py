from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Body, Query, Response

from api.deps import DbSession
from core.errors import ConfirmationRequiredError
from schemas.operations import AlertActionBody, AlertCreate, AlertList, AlertOut, AlertPatch
from services.alerts import AlertService, to_alert_out

store_router = APIRouter(prefix="/api/stores/{store_id}/alerts", tags=["alerts"])
router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@store_router.get("", response_model=AlertList)
def list_alerts(
    store_id: str,
    db: DbSession,
    status: Optional[str] = Query(None, pattern="^(active|acknowledged|resolved)$"),
    severity: Optional[str] = Query(None, pattern="^(critical|warning|info)$"),
    module: Optional[str] = Query(None, max_length=32),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    return AlertService(db).list(store_id, status, severity, module, limit, offset)


@store_router.post("", response_model=AlertOut, status_code=201)
def create_alert(store_id: str, body: AlertCreate, db: DbSession):
    return AlertService(db).create(store_id, body)


@router.get("/{alert_id}", response_model=AlertOut)
def get_alert(alert_id: str, db: DbSession):
    return to_alert_out(AlertService(db).get(alert_id))


@router.patch("/{alert_id}", response_model=AlertOut)
def update_alert(alert_id: str, body: AlertPatch, db: DbSession):
    return AlertService(db).update(alert_id, body)


@router.post("/{alert_id}/acknowledge", response_model=AlertOut)
def acknowledge(alert_id: str, db: DbSession, body: AlertActionBody = Body(default_factory=AlertActionBody)):
    return AlertService(db).acknowledge(alert_id, body.actor)


@router.post("/{alert_id}/resolve", response_model=AlertOut)
def resolve(alert_id: str, db: DbSession, body: AlertActionBody = Body(default_factory=AlertActionBody)):
    return AlertService(db).resolve(alert_id, body.actor)


@router.delete("/{alert_id}", status_code=204)
def delete_alert(alert_id: str, db: DbSession, confirm: bool = Query(False)):
    if not confirm:
        raise ConfirmationRequiredError("an alert")
    AlertService(db).delete(alert_id)
    return Response(status_code=204)
