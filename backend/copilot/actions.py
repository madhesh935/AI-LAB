"""Two-phase Copilot actions.

PREPARE (called by write tools): validate shelf / employee / counter / task / alert against the database and store a CopilotAction in state
`awaiting_confirmation`. Nothing else changes. The model can never execute.

CONFIRM (called only by POST /api/copilot/actions/confirm, i.e. a human pressing the button): run the operation through the same services
the dashboards use (TaskService / AlertService - idempotent, validated, event-publishing), READ IT BACK from SQLite, and only then report success.

There is no authentication: a confirmation is not proof of identity. These operations are for the controlled local demo environment.
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, Optional

from pydantic import BaseModel
from sqlalchemy import select

from copilot.tools import ToolContext, ToolError, find_counter, find_employee, find_shelf
from core.errors import AppError, InvalidStateError, NotFoundError
from database.models import Alert, CopilotAction, Task
from schemas.operations import TaskCreate
from services.alerts import AlertService
from services.common import now_utc
from services.tasks import ELIGIBLE_ROLES, TaskService, canonical_role, is_eligible

ACTION_TITLES = {
    "create_replenishment_task": "Create replenishment task",
    "assign_staff_task": "Assign staff to task",
    "acknowledge_alert": "Acknowledge alert",
    "update_task_status": "Update task status",
    "create_checkout_assistance_task": "Create checkout assistance task",
}


def _eligible_names(ctx: ToolContext, category: str) -> str:
    from services.workforce import AvailabilityService

    av = AvailabilityService(ctx.db).availability(ctx.store_id, category)
    names = [r.name for r in av.items if r.eligible_for_category and r.status == "available"][:5]
    return ", ".join(names) or "nobody currently available"


def _check_eligible(ctx: ToolContext, emp, category: str) -> None:
    if not is_eligible(emp, category):
        raise ToolError(
            f"{emp.name} ({canonical_role(emp.role).replace('_', ' ')}) is not eligible for {category.replace('_', ' ')} work. "
            f"Eligible and available now: {_eligible_names(ctx, category)}."
        )


def prepare(ctx: ToolContext, name: str, a: BaseModel) -> Dict[str, Any]:
    params: Dict[str, Any]
    desc: str
    evidence: Dict[str, Any] = {}
    if name == "create_replenishment_task":
        shelf = find_shelf(ctx, a.shelf)  # type: ignore[attr-defined]
        emp = find_employee(ctx, a.employee) if getattr(a, "employee", None) else None
        if emp:
            _check_eligible(ctx, emp, "shelf_replenishment")
        open_task = ctx.db.scalars(select(Task).where(Task.store_id == ctx.store_id).where(Task.shelf_id == shelf.id).where(Task.status.in_(("new", "assigned", "in_progress")))).first()
        if open_task:
            raise ToolError(f"Shelf {shelf.shelf_code} already has an open task ({open_task.id}: {open_task.title}). Use assign_staff_task for it instead.")
        params = {"shelfId": shelf.id, "shelfCode": shelf.shelf_code, "employeeId": emp.id if emp else None, "employeeName": emp.name if emp else None, "quantity": getattr(a, "quantity", None)}
        desc = f"Create a replenishment task for {shelf.shelf_code}" + (f" and assign it to {emp.name}" if emp else " (unassigned)") + "."
        evidence = {"shelf": shelf.shelf_code}
    elif name == "assign_staff_task":
        emp = find_employee(ctx, a.employee)  # type: ignore[attr-defined]
        task: Optional[Task] = None
        if getattr(a, "task_id", None):
            task = ctx.db.get(Task, a.task_id)  # type: ignore[attr-defined]
        elif getattr(a, "shelf", None):
            shelf = find_shelf(ctx, a.shelf)  # type: ignore[attr-defined]
            task = ctx.db.scalars(select(Task).where(Task.store_id == ctx.store_id).where(Task.shelf_id == shelf.id).where(Task.status.in_(("new", "assigned", "in_progress")))).first()
        if task is None or task.store_id != ctx.store_id:
            raise ToolError("No matching open task was found. Use get_pending_tasks to list tasks, or create_replenishment_task for a shelf without one.")
        if task.status in ("completed", "cancelled"):
            raise ToolError(f"Task {task.id} is {task.status} and cannot be reassigned.")
        _check_eligible(ctx, emp, task.category)
        params = {"taskId": task.id, "taskTitle": task.title, "employeeId": emp.id, "employeeName": emp.name}
        desc = f"Assign {emp.name} to task {task.id} ({task.title})."
    elif name == "acknowledge_alert":
        alert = ctx.db.get(Alert, a.alert_id)  # type: ignore[attr-defined]
        if alert is None or alert.store_id != ctx.store_id:
            raise ToolError(f"Alert '{a.alert_id}' does not exist in this store.")  # type: ignore[attr-defined]
        if alert.status != "active":
            raise ToolError(f"Alert {alert.id} is already {alert.status}.")
        params = {"alertId": alert.id, "alertTitle": alert.title}
        desc = f"Acknowledge alert {alert.id}: {alert.title}."
    elif name == "update_task_status":
        task = ctx.db.get(Task, a.task_id)  # type: ignore[attr-defined]
        if task is None or task.store_id != ctx.store_id:
            raise ToolError(f"Task '{a.task_id}' does not exist in this store.")  # type: ignore[attr-defined]
        if task.status in ("completed", "cancelled"):
            raise ToolError(f"Task {task.id} is already {task.status}.")
        params = {"taskId": task.id, "taskTitle": task.title, "fromStatus": task.status, "toStatus": a.status}  # type: ignore[attr-defined]
        desc = f"Move task {task.id} ({task.title}) from {task.status} to {a.status}."  # type: ignore[attr-defined]
    elif name == "create_checkout_assistance_task":
        counter = find_counter(ctx, a.counter)  # type: ignore[attr-defined]
        emp = find_employee(ctx, a.employee) if getattr(a, "employee", None) else None
        if emp:
            _check_eligible(ctx, emp, "checkout_assistance")
        open_task = ctx.db.scalars(select(Task).where(Task.store_id == ctx.store_id).where(Task.counter_id == counter.id).where(Task.status.in_(("new", "assigned", "in_progress")))).first()
        if open_task:
            raise ToolError(f"{counter.name} already has an open task ({open_task.id}: {open_task.title}).")
        params = {"counterId": counter.id, "counterName": counter.name, "employeeId": emp.id if emp else None, "employeeName": emp.name if emp else None}
        desc = f"Create a checkout assistance task for {counter.name}" + (f" assigned to {emp.name}" if emp else " (unassigned)") + "."
    else:  # pragma: no cover - registry only exposes the names above
        raise ToolError(f"Unsupported action '{name}'.")

    action_id = f"ACT-{uuid.uuid4().hex[:8].upper()}"
    row = CopilotAction(id=action_id, store_id=ctx.store_id, conversation_id=ctx.conversation_id, action_type=name, idempotency_key=f"cop-{uuid.uuid4().hex[:24]}", params=params)
    ctx.db.add(row)
    ctx.db.flush()
    preview = {
        "actionId": row.id, "idempotencyKey": row.idempotency_key, "actionType": name, "title": ACTION_TITLES[name], "description": desc, "params": params,
        "requiresConfirmation": True, "status": "awaiting_confirmation", "createdAt": row.created_at.isoformat(),
    }
    return {"storeId": ctx.store_id, "storeName": ctx.store.name, "dataMode": ctx.store.data_mode, "queriedAt": now_utc().isoformat(), "dataState": "available", "preview": preview,
            "data": {"status": "PREVIEW_ONLY_NOTHING_CHANGED", "description": desc, "tellTheUser": "Show this preview and ask the user to confirm. Do not say it was done."}, **evidence}


def execute(db, ctx_settings, action: CopilotAction) -> Dict[str, Any]:
    """Run a confirmed action and verify the outcome in SQLite. Raises on failure (nothing is reported as success)."""
    p = action.params or {}
    tasks = TaskService(db)
    key = action.idempotency_key
    store_id = action.store_id
    if action.action_type == "create_replenishment_task":
        task, created = tasks.create_ex(
            store_id,
            TaskCreate(title=f"Replenish {p.get('shelfCode') or 'shelf'}", category="shelf_replenishment", priority="high", shelf_id=p.get("shelfId"), assigned_employee_id=p.get("employeeId"),
                       quantity=p.get("quantity"), notes="Created from a confirmed Store Copilot action.", due_in_minutes=30),
            source="copilot", idempotency_key=key,
        )
        row = db.get(Task, task.id)
        if row is None or row.store_id != store_id:
            raise InvalidStateError("The task could not be confirmed in the database")
        return {"message": f"Task {task.id} {'created' if created else 'already existed'}" + (f" and assigned to {p['employeeName']}" if p.get("employeeName") else ""), "reference": task.id, "verified": {"status": row.status, "assignedEmployeeId": row.assigned_employee_id}}
    if action.action_type == "assign_staff_task":
        out = tasks.assign(p["taskId"], p["employeeId"], actor="Store Copilot", idempotency_key=key)
        row = db.get(Task, p["taskId"])
        if row is None or row.assigned_employee_id != p["employeeId"]:
            raise InvalidStateError("The assignment could not be confirmed in the database")
        return {"message": f"Task {p['taskId']} is now assigned to {p['employeeName']} (status {out.status})", "reference": p["taskId"], "verified": {"status": row.status, "assignedEmployeeId": row.assigned_employee_id}}
    if action.action_type == "acknowledge_alert":
        AlertService(db).acknowledge(p["alertId"], "Store Copilot")
        row = db.get(Alert, p["alertId"])
        if row is None or row.status not in ("acknowledged", "resolved"):
            raise InvalidStateError("The acknowledgement could not be confirmed in the database")
        return {"message": f"Alert {p['alertId']} acknowledged", "reference": p["alertId"], "verified": {"status": row.status}}
    if action.action_type == "update_task_status":
        from schemas.operations import TaskPatch, TaskComplete

        tid, target = p["taskId"], p["toStatus"]
        if target == "cancelled":
            tasks.cancel(tid, actor="Store Copilot", idempotency_key=key)
        elif target == "completed":
            row = db.get(Task, tid)
            tasks.complete(tid, TaskComplete(employee_id=row.assigned_employee_id if row else None, completion_notes="Completed via confirmed Store Copilot action"), idempotency_key=key)
        else:
            tasks.update(tid, TaskPatch(status=target))
        row = db.get(Task, tid)
        if row is None or row.status != target:
            raise InvalidStateError("The status change could not be confirmed in the database")
        return {"message": f"Task {tid} is now {row.status}", "reference": tid, "verified": {"status": row.status}}
    if action.action_type == "create_checkout_assistance_task":
        task, created = tasks.create_ex(
            store_id,
            TaskCreate(title=f"Assist at {p.get('counterName')}", category="checkout_assistance", priority="high", counter_id=p.get("counterId"), assigned_employee_id=p.get("employeeId"),
                       notes="Created from a confirmed Store Copilot action.", due_in_minutes=15),
            source="copilot", idempotency_key=key,
        )
        row = db.get(Task, task.id)
        if row is None:
            raise InvalidStateError("The task could not be confirmed in the database")
        return {"message": f"Task {task.id} {'created' if created else 'already existed'} for {p.get('counterName')}", "reference": task.id, "verified": {"status": row.status, "assignedEmployeeId": row.assigned_employee_id}}
    raise InvalidStateError(f"Action type '{action.action_type}' is not supported")


_ = (AppError, NotFoundError, ELIGIBLE_ROLES)
