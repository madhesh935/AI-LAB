from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Body, Header, Query, Response

from api.deps import DbSession
from core.errors import ConfirmationRequiredError
from schemas.operations import (
    TaskAccept,
    TaskAssignBody,
    TaskCancelBody,
    TaskComplete,
    TaskCreate,
    TaskHistoryOut,
    TaskList,
    TaskOut,
    TaskPatch,
    TaskReportIssue,
    TaskResult,
    TaskStart,
)
from services.tasks import TaskService

store_router = APIRouter(prefix="/api/stores/{store_id}/tasks", tags=["tasks"])
router = APIRouter(prefix="/api/tasks", tags=["tasks"])

IdemKey = Header(default=None, alias="Idempotency-Key", max_length=80)


@store_router.get("", response_model=TaskList)
def list_tasks(
    store_id: str,
    db: DbSession,
    status: Optional[str] = Query(None, pattern="^(new|assigned|in_progress|completed|cancelled)$"),
    priority: Optional[str] = Query(None, pattern="^(critical|high|medium|low)$"),
    employee_id: Optional[str] = Query(None, alias="employeeId"),
    category: Optional[str] = Query(None, max_length=40),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    return TaskService(db).list(store_id, status, priority, employee_id, category, limit, offset)


@store_router.post("", response_model=TaskOut, status_code=201)
def create_task(store_id: str, body: TaskCreate, db: DbSession, response: Response, idempotency_key: Optional[str] = IdemKey):
    """201 = new task. 200 + `X-Idempotent-Replay: true` = the same key was already applied, or an OPEN task for the same
    alert / shelf / counter / camera already exists (that task is returned; no duplicate is created)."""
    task, created = TaskService(db).create_ex(store_id, body, idempotency_key=idempotency_key, force_assign=body.force)
    if not created:
        response.status_code = 200
        response.headers["X-Idempotent-Replay"] = "true"
    return task


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: str, db: DbSession):
    svc = TaskService(db)
    return svc.out(svc.get(task_id))


@router.patch("/{task_id}", response_model=TaskOut)
def patch_task(task_id: str, body: TaskPatch, db: DbSession):
    return TaskService(db).update(task_id, body)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: str, db: DbSession, confirm: bool = Query(False)):
    if not confirm:
        raise ConfirmationRequiredError("a task")
    TaskService(db).delete(task_id)
    return Response(status_code=204)


@router.get("/{task_id}/history", response_model=List[TaskHistoryOut])
def task_history(task_id: str, db: DbSession):
    return TaskService(db).history(task_id)


@router.post("/{task_id}/assign", response_model=TaskResult)
def assign_task(task_id: str, body: TaskAssignBody, db: DbSession, idempotency_key: Optional[str] = IdemKey):
    """Assign, reassign (to a different employee) or unassign (employeeId null)."""
    return TaskResult(task=TaskService(db).assign(task_id, body.employee_id, body.actor_employee_id, body.force, idempotency_key))


@router.post("/{task_id}/cancel", response_model=TaskResult)
def cancel_task(task_id: str, db: DbSession, body: TaskCancelBody = Body(default_factory=TaskCancelBody), idempotency_key: Optional[str] = IdemKey):
    return TaskResult(task=TaskService(db).cancel(task_id, body.actor_employee_id, body.reason, idempotency_key))


# ---- Staff PWA lifecycle (existing URLs, request bodies use camelCase) ----
@router.post("/{task_id}/accept", response_model=TaskResult)
def accept_task(task_id: str, body: TaskAccept, db: DbSession, idempotency_key: Optional[str] = IdemKey):
    return TaskResult(task=TaskService(db).accept(task_id, body.employee_id, idempotency_key))


@router.post("/{task_id}/start", response_model=TaskResult)
def start_task(task_id: str, db: DbSession, body: TaskStart = Body(default_factory=TaskStart), idempotency_key: Optional[str] = IdemKey):
    return TaskResult(task=TaskService(db).start(task_id, body.employee_id, idempotency_key))


@router.post("/{task_id}/on-the-way", response_model=TaskResult)
def on_the_way(task_id: str, body: TaskAccept, db: DbSession, idempotency_key: Optional[str] = IdemKey):
    """Customer assistance only: the assigned employee is walking to the shopper (the shopper's status page shows 'Staff on the way')."""
    return TaskResult(task=TaskService(db).on_the_way(task_id, body.employee_id, idempotency_key))


@router.post("/{task_id}/complete", response_model=TaskResult)
def complete_task(task_id: str, body: TaskComplete, db: DbSession, idempotency_key: Optional[str] = IdemKey):
    return TaskResult(task=TaskService(db).complete(task_id, body, idempotency_key))


@router.post("/{task_id}/report-issue", response_model=TaskResult)
def report_issue(task_id: str, body: TaskReportIssue, db: DbSession, idempotency_key: Optional[str] = IdemKey):
    return TaskResult(task=TaskService(db).report_issue(task_id, body, idempotency_key))
