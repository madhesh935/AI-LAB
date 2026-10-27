"""Store Copilot API. The LLM endpoint and every tool stay server-side; the browser only sends questions and button presses."""

from __future__ import annotations

import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from api.deps import DbSession
from schemas.common import ApiModel
from services.common import get_store_or_404
from services.copilot import CopilotService

router = APIRouter(prefix="/api/copilot", tags=["copilot"])


class ChatBody(ApiModel):
    query: str = Field(min_length=1, max_length=4000)
    store_id: str
    conversation_id: Optional[str] = Field(default=None, max_length=48)
    request_id: Optional[str] = Field(default=None, max_length=64)


class RenameBody(ApiModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=160)
    is_pinned: Optional[bool] = None


class ConfirmBody(ApiModel):
    action_id: str = Field(max_length=48)
    idempotency_key: str = Field(min_length=4, max_length=64)
    store_id: str


class CancelBody(ApiModel):
    action_id: str = Field(max_length=48)
    store_id: str


def engine(request: Request):
    return request.app.state.copilot


@router.get("/health")
def copilot_health(request: Request, refresh: bool = Query(False)) -> Dict[str, Any]:
    """Real probe of the language model (model installed? local? tool-capable? loaded?). `mode` says how answers are produced right now."""
    st = engine(request).status(force=refresh)
    return {"service": "RetailEdge Store Copilot", "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(), **st}


@router.get("/context")
def copilot_context(db: DbSession, store_id: str = Query(...)) -> Dict[str, Any]:
    """Live telemetry for the right-hand panel - the SAME values as the dashboards (overview service)."""
    from services.alerts import AlertService
    from services.overview import OverviewService
    from services.tasks import OPEN_STATUSES, TaskService

    get_store_or_404(db, store_id)
    overview = OverviewService(db).build(store_id)
    ov = overview.model_dump(by_alias=True, mode="json")
    open_tasks = sum(TaskService(db).list(store_id, status=s, limit=1).total for s in OPEN_STATUSES)
    crit = AlertService(db).list(store_id, status="active", severity="critical", limit=5)
    return {
        "storeId": store_id, "dataMode": ov["dataMode"], "metrics": ov["metrics"], "dataAvailability": ov["dataAvailability"], "freshness": ov["freshness"],
        "cameras": {"online": ov["metrics"]["camerasOnline"], "total": ov["metrics"]["camerasTotal"]}, "pendingTasks": open_tasks,
        "criticalAlerts": [{"id": a.id, "title": a.title, "createdAt": a.created_at.isoformat()} for a in crit.items], "lastUpdated": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }


@router.get("/conversations")
def conversations(db: DbSession, store_id: str = Query(...), include_messages: bool = Query(True)) -> List[Dict[str, Any]]:
    return CopilotService(db).list(store_id, include_messages)


@router.get("/conversations/{conversation_id}")
def conversation(conversation_id: str, db: DbSession, store_id: Optional[str] = Query(None)) -> Dict[str, Any]:
    return CopilotService(db).get(conversation_id, store_id)


@router.patch("/conversations/{conversation_id}")
def rename_conversation(conversation_id: str, body: RenameBody, db: DbSession) -> Dict[str, Any]:
    return CopilotService(db).rename(conversation_id, body.title, body.is_pinned)


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: str, db: DbSession) -> Dict[str, Any]:
    """Archives (soft-deletes) so history is recoverable; no hard delete exists."""
    return CopilotService(db).archive(conversation_id)


@router.post("/chat")
def chat(body: ChatBody, request: Request) -> Dict[str, Any]:
    """Runs synchronously in a worker thread WITHOUT holding a database transaction while the model thinks."""
    return engine(request).chat(body.store_id, body.query, body.conversation_id, body.request_id)


@router.post("/chat/{request_id}/stop")
def stop_chat(request_id: str, request: Request) -> Dict[str, Any]:
    return {"stopped": engine(request).stops.stop(request_id)}


@router.post("/actions/confirm")
def confirm_action(body: ConfirmBody, request: Request) -> Dict[str, Any]:
    """The ONLY place a Copilot-proposed change is executed - a human pressed Confirm. Not proof of identity (no authentication)."""
    return engine(request).confirm(body.action_id, body.idempotency_key, body.store_id)


@router.post("/actions/cancel")
def cancel_action(body: CancelBody, request: Request) -> Dict[str, Any]:
    return engine(request).cancel_action(body.action_id, body.store_id)


_ = BaseModel
