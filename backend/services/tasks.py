"""The ONE task engine. Admin Staff Management, the Staff PWA, inventory/queue/camera modules and customer assistance all create and
change tasks through this service, so a task is the same record everywhere.

* Statuses: new -> assigned -> in_progress -> completed, cancelled from any open state. Transitions are validated and applied with a
  compare-and-swap so two simultaneous requests cannot both win.
* Idempotency: every state-changing call may carry a client key; a replay returns the current task and changes nothing.
* No duplicates: creating work for something that already has an OPEN task of the same category (same alert / shelf / counter / camera /
  customer request) returns the existing task instead of a second one.
* Completing a task never edits observed stock, queue or camera data - observations come only from the vision pipeline.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from core.errors import ConflictError, InvalidStateError, NotFoundError
from core.events import event_bus
from database.models import (
    Alert, Camera, CheckoutCounter, CustomerAssistanceRequest, CustomerRequestHistory, Employee, IdempotencyRecord, Product, Shelf, Task,
    TaskHistory,
)
from repositories.base import get_or_404
from repositories.operations import TaskRepository
from schemas.common import Meta
from schemas.operations import (
    TaskComplete,
    TaskCreate,
    TaskHistoryOut,
    TaskList,
    TaskOut,
    TaskPatch,
    TaskReportIssue,
)
from services.common import get_store_or_404, humanize, now_utc

OPEN_STATUSES = ("new", "assigned", "in_progress")

# Allowed status moves. 'completed' and 'cancelled' are terminal (a cancelled task is re-created, not resurrected).
TRANSITIONS: Dict[str, set] = {
    "new": {"assigned", "in_progress", "cancelled"},
    "assigned": {"new", "in_progress", "cancelled"},
    "in_progress": {"assigned", "completed", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}

CATEGORIES = ("shelf_replenishment", "checkout_assistance", "inventory_inspection", "customer_assistance", "camera_maintenance", "general_operations")
_LEGACY_CATEGORIES = {
    "general": "general_operations", "checkout_assist": "checkout_assistance", "inventory_replenishment": "shelf_replenishment",
    "restock": "shelf_replenishment", "replenishment": "shelf_replenishment", "inspection": "inventory_inspection", "customer_help": "customer_assistance",
    "camera": "camera_maintenance", "operations": "general_operations", "stock_shortage": "shelf_replenishment", "queue_congestion": "checkout_assistance",
}
# Roles that may take each kind of work (soft rule: a supervisor can override with force=true and the override is recorded).
ELIGIBLE_ROLES = {
    "shelf_replenishment": {"inventory_associate", "shelf_replenishment", "floor_supervisor", "store_manager"},
    "inventory_inspection": {"inventory_associate", "shelf_replenishment", "floor_supervisor", "store_manager"},
    "checkout_assistance": {"cashier", "floor_supervisor", "store_manager", "customer_support"},
    "customer_assistance": {"customer_support", "floor_supervisor", "store_manager", "cashier"},
    "camera_maintenance": {"security", "floor_supervisor", "store_manager"},
    "general_operations": None,  # anyone
}
# Work an unassigned task may be matched to; used for availability ranking.
CATEGORY_LABELS = {
    "shelf_replenishment": "Inventory Replenishment", "checkout_assistance": "Checkout Assistance", "inventory_inspection": "Inventory Inspection",
    "customer_assistance": "Customer Assistance", "camera_maintenance": "Camera Maintenance", "general_operations": "General Operations",
}


def normalize_category(value: Optional[str]) -> str:
    v = (value or "general_operations").strip().lower()
    v = _LEGACY_CATEGORIES.get(v, v)
    if v not in CATEGORIES:
        raise InvalidStateError(f"Unknown task category '{value}'. Use one of: {', '.join(CATEGORIES)}")
    return v


# Role keys the roster may use (seeded or hand-entered) -> the canonical keys used by ELIGIBLE_ROLES and the Staff Management UI.
ROLE_ALIASES = {
    "supervisor": "floor_supervisor", "manager": "store_manager", "restock_specialist": "shelf_replenishment", "stockroom_clerk": "inventory_associate",
    "floor_runner": "shelf_replenishment", "associate": "customer_support", "customer_service": "customer_support", "loss_prevention": "security",
}


def canonical_role(role: Optional[str]) -> str:
    r = (role or "").strip().lower().replace(" ", "_").replace("-", "_")
    return ROLE_ALIASES.get(r, r)


def is_eligible(emp: Employee, category: str) -> bool:
    roles = ELIGIBLE_ROLES.get(category)
    return roles is None or canonical_role(emp.role) in roles


def _due_within(task: Task, now) -> Optional[str]:
    if task.status == "completed":
        return "Done"
    if task.due_at is None:
        return None
    minutes = int((task.due_at - now).total_seconds() // 60)
    if minutes < 0:
        return f"Overdue {abs(minutes)} mins"
    if minutes >= 120:
        return f"{minutes // 60} hrs"
    return f"{minutes} mins"


def to_task_out(task: Task, emps: Dict[str, Employee], shelves: Dict[str, Shelf], products: Dict[str, Product], now=None,
                counters: Optional[Dict[str, CheckoutCounter]] = None, cameras: Optional[Dict[str, Camera]] = None,
                requests: Optional[Dict[str, str]] = None) -> TaskOut:
    now = now or now_utc()
    emp = emps.get(task.assigned_employee_id or "")
    shelf = shelves.get(task.shelf_id or "")
    product = products.get(task.product_id or "")
    counter = (counters or {}).get(task.counter_id or "")
    camera = (cameras or {}).get(task.camera_id or "")
    related = None
    if shelf:
        related = {"type": "shelf", "id": shelf.id, "label": shelf.shelf_code}
    elif counter:
        related = {"type": "counter", "id": counter.id, "label": counter.name}
    elif camera:
        related = {"type": "camera", "id": camera.id, "label": camera.name}
    elif task.zone:
        related = {"type": "zone", "id": task.zone, "label": task.zone}
    return TaskOut(
        id=task.id, store_id=task.store_id, title=task.title, description=task.description, category=task.category, priority=task.priority,
        status=task.status, zone=task.zone, assigned_employee_id=task.assigned_employee_id, assigned_employee_name=emp.name if emp else None,
        assigned_role=(emp.role_label or emp.role) if emp else None, shelf_id=task.shelf_id, shelf_code=shelf.shelf_code if shelf else None,
        product_id=task.product_id, product_name=product.name if product else None, alert_id=task.alert_id, counter_id=task.counter_id,
        counter_name=counter.name if counter else None, camera_id=task.camera_id, customer_request_id=task.customer_request_id,
        customer_request_status=(requests or {}).get(task.customer_request_id or ""), related_entity=related, quantity=task.quantity, due_at=task.due_at, due_within=_due_within(task, now), created_at=task.created_at,
        time_created=humanize(task.created_at, now), updated_at=task.updated_at, completed_at=task.completed_at,
        completion_notes=task.completion_notes, has_photo_evidence=task.has_photo_evidence, camera_verified=task.camera_verified,
        camera_verified_at=task.camera_verified_at, issue_reported=task.issue_reported, notes=task.notes, source=task.source,
    )


class TaskService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = TaskRepository(db)

    # ------------------------------------------------------------ helpers
    def _out(self, tasks: Sequence[Task]) -> List[TaskOut]:
        emps, shelves, products = self.repo.lookups(tasks)
        counter_ids = {t.counter_id for t in tasks if t.counter_id}
        camera_ids = {t.camera_id for t in tasks if t.camera_id}
        counters = {c.id: c for c in self.db.scalars(select(CheckoutCounter).where(CheckoutCounter.id.in_(counter_ids)))} if counter_ids else {}
        cameras = {c.id: c for c in self.db.scalars(select(Camera).where(Camera.id.in_(camera_ids)))} if camera_ids else {}
        req_ids = {t.customer_request_id for t in tasks if t.customer_request_id}
        requests = dict(self.db.execute(select(CustomerAssistanceRequest.id, CustomerAssistanceRequest.status)
                                        .where(CustomerAssistanceRequest.id.in_(req_ids))).all()) if req_ids else {}
        now = now_utc()
        return [to_task_out(t, emps, shelves, products, now, counters, cameras, requests) for t in tasks]

    def out(self, task: Task) -> TaskOut:
        return self._out([task])[0]

    def get(self, task_id: str) -> Task:
        return get_or_404(self.db, Task, task_id, "Task")

    def _employee(self, store_id: str, employee_id: Optional[str]) -> Optional[Employee]:
        if not employee_id:
            return None
        emp = self.db.get(Employee, employee_id)
        if emp is None or emp.store_id != store_id or not emp.is_active:
            raise NotFoundError("Employee", employee_id)
        return emp

    def _log(self, task: Task, from_status: Optional[str], to_status: str, actor: Optional[str], note: Optional[str] = None) -> None:
        self.db.add(TaskHistory(task_id=task.id, from_status=from_status, to_status=to_status, actor_employee_id=actor, note=note))

    def _publish(self, task: Task, event: str, extra: Optional[dict] = None) -> None:
        event_bus.publish(task.store_id, event, {
            "taskId": task.id, "status": task.status, "assignedEmployeeId": task.assigned_employee_id, "category": task.category,
            "priority": task.priority, "title": task.title, "shelfId": task.shelf_id, "counterId": task.counter_id,
            "customerRequestId": task.customer_request_id, **(extra or {})})

    # -- idempotency
    def _replayed(self, scope: str, key: Optional[str]) -> Optional[str]:
        if not key:
            return None
        row = self.db.get(IdempotencyRecord, (key, scope))
        return row.ref if row else None

    def _remember(self, scope: str, key: Optional[str], ref: str) -> None:
        if key:
            self.db.add(IdempotencyRecord(key=key, scope=scope, ref=ref))

    # -- state machine
    def _move(self, task: Task, new_status: str, actor: Optional[str] = None, note: Optional[str] = None, force: bool = False) -> None:
        if new_status == task.status:
            return
        if not force and new_status not in TRANSITIONS[task.status]:
            raise InvalidStateError(f"Cannot move a task from '{task.status}' to '{new_status}'")
        if task.status in ("completed", "cancelled"):
            raise InvalidStateError(f"A {task.status} task is final")
        old = task.status
        self.db.flush()  # persist pending attribute changes (assignee, notes) before the compare-and-swap refresh
        values = {"status": new_status}
        if new_status == "completed":
            values["completed_at"] = now_utc()
        # compare-and-swap: only succeeds if nobody changed the status since we read it
        res = self.db.execute(update(Task).where(Task.id == task.id).where(Task.status == old).values(**values))
        if res.rowcount != 1:
            self.db.refresh(task)
            raise ConflictError(f"The task was changed by someone else (now '{task.status}'). Refresh and try again.")
        self.db.refresh(task)
        self._log(task, old, new_status, actor, note)
        self._sync_customer_request(task)

    def _sync_customer_request(self, task: Task) -> None:
        """Keep the customer's request status in step with its task (customer PWA reads the request)."""
        if not task.customer_request_id:
            return
        req = self.db.get(CustomerAssistanceRequest, task.customer_request_id)
        if req is None:
            return
        mapping = {"new": "submitted", "assigned": "assigned", "in_progress": "in_progress", "completed": "resolved", "cancelled": "cancelled"}
        new = mapping.get(task.status, req.status)
        req.assigned_employee_id = task.assigned_employee_id
        if new != req.status:
            req.status = new
            self.db.add(CustomerRequestHistory(request_id=req.id, status=new, note=f"Task {task.id} is {task.status}"))
            event_bus.publish(req.store_id, "customer.assistance.updated", {"requestId": req.id, "status": new, "taskId": task.id})

    # --------------------------------------------------------------- queries
    def list(self, store_id: str, status: Optional[str] = None, priority: Optional[str] = None, employee_id: Optional[str] = None,
             category: Optional[str] = None, limit: int = 200, offset: int = 0) -> TaskList:
        get_store_or_404(self.db, store_id)
        rows, total = self.repo.list(store_id, status, priority, employee_id, normalize_category(category) if category else None, limit, offset)
        items = self._out(rows)
        return TaskList(items=items, total=total, meta=Meta(data_state="available" if items else "empty", sources=["tasks"]))

    # ---------------------------------------------------------------- create
    def _existing_open(self, store_id: str, category: str, body: TaskCreate, customer_request_id: Optional[str]) -> Optional[Task]:
        conds = []
        if body.alert_id:
            conds.append(Task.alert_id == body.alert_id)
        if customer_request_id:
            conds.append(Task.customer_request_id == customer_request_id)
        if body.shelf_id and category in ("shelf_replenishment", "inventory_inspection"):
            conds.append(Task.shelf_id == body.shelf_id)
        if body.counter_id and category == "checkout_assistance":
            conds.append(Task.counter_id == body.counter_id)
        if body.camera_id and category == "camera_maintenance":
            conds.append(Task.camera_id == body.camera_id)
        for cond in conds:
            row = self.db.scalars(select(Task).where(Task.store_id == store_id).where(Task.category == category)
                                  .where(Task.status.in_(OPEN_STATUSES)).where(cond).order_by(Task.created_at).limit(1)).first()
            if row is not None:
                return row
        return None

    def create_ex(self, store_id: str, body: TaskCreate, source: str = "manual", idempotency_key: Optional[str] = None,
                  customer_request_id: Optional[str] = None, force_assign: bool = False) -> Tuple[TaskOut, bool]:
        """Returns (task, created). created=False means an idempotent replay or an existing OPEN task for the same thing."""
        get_store_or_404(self.db, store_id)
        key = idempotency_key or body.idempotency_key
        prior = self._replayed("task.create", key)
        if prior:
            return self.out(self.get(prior)), False
        category = normalize_category(body.category)
        existing = self._existing_open(store_id, category, body, customer_request_id)
        if existing is not None:
            self._remember("task.create", key, existing.id)
            return self.out(existing), False

        emp = self._employee(store_id, body.assigned_employee_id)
        if emp is not None and not is_eligible(emp, category) and not force_assign:
            raise InvalidStateError(f"{emp.name} ({emp.role_label or emp.role}) is not eligible for {CATEGORY_LABELS[category]} work. "
                                    "Pick an eligible employee or confirm a supervisor override (force=true).")
        for model, ident, label in ((Shelf, body.shelf_id, "Shelf"), (Product, body.product_id, "Product"), (Alert, body.alert_id, "Alert"),
                                    (CheckoutCounter, body.counter_id, "Counter"), (Camera, body.camera_id, "Camera")):
            if ident:
                row = self.db.get(model, ident)
                if row is None or row.store_id != store_id:
                    raise NotFoundError(label, ident)

        task = Task(
            id=f"TSK-{uuid.uuid4().hex[:6].upper()}", store_id=store_id, title=body.title, description=body.description, category=category,
            priority=body.priority, status="assigned" if emp else "new", zone=body.zone, assigned_employee_id=emp.id if emp else None,
            shelf_id=body.shelf_id, product_id=body.product_id, alert_id=body.alert_id, counter_id=body.counter_id, camera_id=body.camera_id,
            customer_request_id=customer_request_id, quantity=body.quantity,
            due_at=now_utc() + timedelta(minutes=body.due_in_minutes) if body.due_in_minutes else None, notes=body.notes, source=source,
            idempotency_key=key,
        )
        self.db.add(task)
        self.db.flush()
        self._log(task, None, task.status, None, "Task created" + (" (supervisor override of role eligibility)" if emp and force_assign and not is_eligible(emp, category) else ""))
        if body.alert_id:
            alert = self.db.get(Alert, body.alert_id)
            if alert and not alert.task_id:
                alert.task_id = task.id
        self._remember("task.create", key, task.id)
        self.db.flush()
        self._publish(task, "TASK_CREATED")
        if emp:
            self._publish(task, "TASK_ASSIGNED", {"assignedBy": "create"})
        return self.out(task), True

    def create(self, store_id: str, body: TaskCreate, source: str = "manual", force_assign: bool = False) -> TaskOut:
        return self.create_ex(store_id, body, source, force_assign=force_assign)[0]

    # ---------------------------------------------------------------- update
    def update(self, task_id: str, body: TaskPatch) -> TaskOut:
        task = self.get(task_id)
        data = body.model_dump(exclude_unset=True)
        actor = data.pop("actor_employee_id", None)

        if task.status in ("completed", "cancelled") and any(k in data for k in ("title", "priority", "assigned_employee_id", "quantity", "due_in_minutes", "status")):
            raise InvalidStateError(f"A {task.status} task can no longer be edited")

        if "assigned_employee_id" in data:
            new_id = data.pop("assigned_employee_id")
            self._assign(task, new_id, actor, force=bool(data.pop("force", False)), also_status="status" not in data)

        data.pop("force", None)
        if "due_in_minutes" in data:
            minutes = data.pop("due_in_minutes")
            task.due_at = now_utc() + timedelta(minutes=minutes) if minutes else None

        new_status = data.pop("status", None)
        camera_verified = data.pop("camera_verified", None)
        for field, value in data.items():
            setattr(task, field, value)
        if camera_verified is not None:
            if camera_verified and task.status != "completed":
                raise InvalidStateError("Only a completed task can be camera-verified")
            task.camera_verified = camera_verified
            task.camera_verified_at = now_utc() if camera_verified else None
        if new_status:
            if new_status == "assigned" and not task.assigned_employee_id:
                raise InvalidStateError("Assign an employee before marking a task as assigned")
            self._move(task, new_status, actor)
        self.db.flush()
        self._publish(task, "TASK_UPDATED")
        return self.out(task)

    def _assign(self, task: Task, employee_id: Optional[str], actor: Optional[str], force: bool = False, also_status: bool = True) -> None:
        emp = self._employee(task.store_id, employee_id)
        if emp is not None and not is_eligible(emp, task.category) and not force:
            raise InvalidStateError(f"{emp.name} ({emp.role_label or emp.role}) is not eligible for {CATEGORY_LABELS.get(task.category, task.category)} work. "
                                    "Confirm a supervisor override (force=true) to assign anyway.")
        previous = task.assigned_employee_id
        task.assigned_employee_id = emp.id if emp else None
        if also_status:
            if emp and task.status == "new":
                self._move(task, "assigned", actor, f"Assigned to {emp.name}")
            elif not emp and task.status == "assigned":
                self._move(task, "new", actor, "Unassigned")
            elif emp and previous and previous != emp.id:
                self._log(task, task.status, task.status, actor, f"Reassigned to {emp.name}")
            elif emp and previous != emp.id:
                self._log(task, task.status, task.status, actor, f"Assigned to {emp.name}")
        if previous != task.assigned_employee_id:
            self._reset_on_the_way(task)

    def _reset_on_the_way(self, task: Task) -> None:
        """A new (or no) assignee has not set off yet - never leave the customer reading 'Staff on the way'."""
        req = self.db.get(CustomerAssistanceRequest, task.customer_request_id) if task.customer_request_id else None
        if req is not None and req.status == "on_the_way":
            req.status = "assigned" if task.assigned_employee_id else "submitted"
            req.assigned_employee_id = task.assigned_employee_id
            self.db.add(CustomerRequestHistory(request_id=req.id, status=req.status, note=f"Task {task.id} was reassigned"))
            event_bus.publish(req.store_id, "customer.assistance.updated", {"requestId": req.id, "status": req.status, "taskId": task.id})

    def assign(self, task_id: str, employee_id: Optional[str], actor: Optional[str] = None, force: bool = False, idempotency_key: Optional[str] = None) -> TaskOut:
        task = self.get(task_id)
        if self._replayed("task.assign", idempotency_key):
            return self.out(task)
        if task.status in ("completed", "cancelled"):
            raise InvalidStateError(f"A {task.status} task can no longer be assigned")
        previous = task.assigned_employee_id
        self._assign(task, employee_id, actor, force)
        self._remember("task.assign", idempotency_key, task.id)
        self.db.flush()
        self._publish(task, "TASK_REASSIGNED" if previous and employee_id and previous != employee_id else "TASK_ASSIGNED", {"previousEmployeeId": previous})
        return self.out(task)

    def cancel(self, task_id: str, actor: Optional[str] = None, reason: Optional[str] = None, idempotency_key: Optional[str] = None) -> TaskOut:
        task = self.get(task_id)
        if self._replayed("task.cancel", idempotency_key):
            return self.out(task)
        self._move(task, "cancelled", actor, reason or "Cancelled")
        self._remember("task.cancel", idempotency_key, task.id)
        self.db.flush()
        self._publish(task, "TASK_CANCELLED", {"reason": reason})
        return self.out(task)

    def delete(self, task_id: str) -> None:
        task = self.get(task_id)
        store_id = task.store_id
        self.db.delete(task)
        self.db.flush()
        event_bus.publish(store_id, "TASK_DELETED", {"taskId": task_id})

    def history(self, task_id: str) -> List[TaskHistoryOut]:
        self.get(task_id)
        return [TaskHistoryOut.model_validate(h) for h in self.repo.history(task_id)]

    # ------------------------------------------------- staff PWA operations
    def _must_be_assignee(self, task: Task, employee_id: Optional[str]) -> None:
        """Without authentication this is a CONSISTENCY rule (one task, one owner), not a security control."""
        if employee_id and task.assigned_employee_id and task.assigned_employee_id != employee_id:
            raise ConflictError("This task is assigned to another employee")

    def accept(self, task_id: str, employee_id: str, idempotency_key: Optional[str] = None) -> TaskOut:
        task = self.get(task_id)
        if self._replayed("task.accept", idempotency_key):
            return self.out(task)
        emp = self._employee(task.store_id, employee_id)
        if task.status in ("completed", "cancelled"):
            raise InvalidStateError(f"A {task.status} task cannot be accepted")
        self._must_be_assignee(task, employee_id)
        if not is_eligible(emp, task.category):  # type: ignore[arg-type]
            raise InvalidStateError(f"Your role is not eligible for {CATEGORY_LABELS.get(task.category, task.category)} work; ask a supervisor to assign it")
        task.assigned_employee_id = emp.id  # type: ignore[union-attr]
        if task.status == "new":
            self._move(task, "assigned", emp.id, f"Accepted by {emp.name}")  # type: ignore[union-attr]
        self._remember("task.accept", idempotency_key, task.id)
        self.db.flush()
        self._publish(task, "TASK_ASSIGNED", {"assignedBy": "accept"})
        return self.out(task)

    def start(self, task_id: str, employee_id: Optional[str], idempotency_key: Optional[str] = None) -> TaskOut:
        task = self.get(task_id)
        if self._replayed("task.start", idempotency_key):
            return self.out(task)
        self._must_be_assignee(task, employee_id)
        if employee_id and not task.assigned_employee_id:
            task.assigned_employee_id = self._employee(task.store_id, employee_id).id  # type: ignore[union-attr]
        self._move(task, "in_progress", employee_id or task.assigned_employee_id, force=task.status in ("new", "assigned"))
        self._remember("task.start", idempotency_key, task.id)
        self.db.flush()
        self._publish(task, "TASK_STARTED")
        return self.out(task)

    def on_the_way(self, task_id: str, employee_id: Optional[str], idempotency_key: Optional[str] = None) -> TaskOut:
        """The assigned employee is walking to the customer. Only this explicit action makes the customer see 'Staff on the way'.

        The task itself stays 'assigned' (the task state machine is shared with every other task category); the customer request moves
        to 'on_the_way'. Starting / completing the task moves the request on as usual.
        """
        task = self.get(task_id)
        if self._replayed("task.on_the_way", idempotency_key):
            return self.out(task)
        if task.category != "customer_assistance" or not task.customer_request_id:
            raise InvalidStateError("'On my way' only applies to customer assistance requests")
        if task.status != "assigned":
            raise InvalidStateError("Accept the request first" if task.status == "new" else f"This request is already {task.status.replace('_', ' ')}")
        if not employee_id:
            raise InvalidStateError("employeeId is required")
        emp = self._employee(task.store_id, employee_id)
        self._must_be_assignee(task, employee_id)
        req = self.db.get(CustomerAssistanceRequest, task.customer_request_id)
        if req is None:
            raise NotFoundError("Customer request", task.customer_request_id)
        if req.status != "on_the_way":
            req.status = "on_the_way"
            req.assigned_employee_id = emp.id  # type: ignore[union-attr]
            self.db.add(CustomerRequestHistory(request_id=req.id, status="on_the_way", note="Staff member is on the way"))
            self._log(task, task.status, task.status, emp.id, "On the way to the customer")  # type: ignore[union-attr]
            event_bus.publish(req.store_id, "customer.assistance.updated", {"requestId": req.id, "status": "on_the_way", "taskId": task.id})
        self._remember("task.on_the_way", idempotency_key, task.id)
        self.db.flush()
        self._publish(task, "TASK_UPDATED", {"customerRequestStatus": "on_the_way"})
        return self.out(task)

    def complete(self, task_id: str, body: TaskComplete, idempotency_key: Optional[str] = None) -> TaskOut:
        task = self.get(task_id)
        if self._replayed("task.complete", idempotency_key):
            return self.out(task)
        if task.status == "cancelled":
            raise InvalidStateError("A cancelled task cannot be completed")
        if task.status == "new":
            raise InvalidStateError("Accept the task before completing it")
        self._must_be_assignee(task, body.employee_id)
        task.completion_notes = body.completion_notes
        task.has_photo_evidence = body.has_photo_evidence
        self._move(task, "completed", body.employee_id or task.assigned_employee_id, body.completion_notes or None, force=task.status in ("new", "assigned"))
        self._remember("task.complete", idempotency_key, task.id)
        self.db.flush()
        self._publish(task, "TASK_COMPLETED")
        return self.out(task)

    def report_issue(self, task_id: str, body: TaskReportIssue, idempotency_key: Optional[str] = None) -> TaskOut:
        task = self.get(task_id)
        if self._replayed("task.issue", idempotency_key):
            return self.out(task)
        if task.status in ("completed", "cancelled"):
            raise InvalidStateError(f"A {task.status} task cannot report an issue")
        self._must_be_assignee(task, body.employee_id)
        task.issue_reported = body.issue_reason
        self._move(task, "new", body.employee_id or task.assigned_employee_id, f"Issue: {body.issue_reason}", force=True)
        task.assigned_employee_id = None
        self._remember("task.issue", idempotency_key, task.id)
        self.db.flush()
        self._publish(task, "TASK_ISSUE_REPORTED")
        return self.out(task)
