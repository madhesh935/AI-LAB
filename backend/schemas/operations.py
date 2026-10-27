"""Alerts, tasks, staff - request and response contracts."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import Field, field_validator

from schemas.common import ApiModel, Meta

Severity = Literal["critical", "warning", "info"]
Priority = Literal["critical", "high", "medium", "low"]
AlertStatus = Literal["active", "acknowledged", "resolved"]
TaskStatus = Literal["new", "assigned", "in_progress", "completed", "cancelled"]


# ------------------------------------------------------------------ alerts
class AlertOut(ApiModel):
    id: str
    store_id: str
    title: str
    description: str
    category: str
    module: str
    severity: Severity
    zone: Optional[str] = None
    timestamp: str  # "4 mins ago" - displayed verbatim by the UI
    created_at: datetime
    recommended_action: Optional[str] = None
    evidence: Optional[str] = None
    status: AlertStatus
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    camera_id: Optional[str] = None
    shelf_id: Optional[str] = None
    counter_id: Optional[str] = None
    task_id: Optional[str] = None
    source: str


class AlertCreate(ApiModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=2000)
    category: str = Field(min_length=2, max_length=40)
    module: str = Field(default="overview", max_length=32)
    severity: Severity = "info"
    zone: Optional[str] = Field(default=None, max_length=160)
    camera_id: Optional[str] = None
    shelf_id: Optional[str] = None
    counter_id: Optional[str] = None
    recommended_action: Optional[str] = Field(default=None, max_length=2000)
    evidence: Optional[str] = Field(default=None, max_length=2000)
    source: str = Field(default="system", max_length=16)


class AlertPatch(ApiModel):
    title: Optional[str] = Field(default=None, min_length=3, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    severity: Optional[Severity] = None
    recommended_action: Optional[str] = Field(default=None, max_length=2000)


class AlertActionBody(ApiModel):
    actor: Optional[str] = Field(default=None, max_length=120)


class AlertList(ApiModel):
    items: List[AlertOut]
    total: int
    meta: Meta


# ------------------------------------------------------------------- tasks
class TaskOut(ApiModel):
    id: str
    store_id: str
    title: str
    description: Optional[str] = None
    category: str
    priority: Priority
    status: TaskStatus
    zone: Optional[str] = None
    assigned_employee_id: Optional[str] = None
    assigned_employee_name: Optional[str] = None
    assigned_role: Optional[str] = None
    shelf_id: Optional[str] = None
    shelf_code: Optional[str] = None
    product_id: Optional[str] = None
    product_name: Optional[str] = None
    alert_id: Optional[str] = None
    counter_id: Optional[str] = None
    counter_name: Optional[str] = None
    camera_id: Optional[str] = None
    customer_request_id: Optional[str] = None
    customer_request_status: Optional[str] = None  # submitted / assigned / on_the_way / in_progress / resolved / cancelled
    related_entity: Optional[Dict[str, str]] = None  # {type: shelf|counter|camera|zone, id, label}
    quantity: Optional[int] = None
    due_at: Optional[datetime] = None
    due_within: Optional[str] = None
    created_at: datetime
    time_created: str
    updated_at: datetime
    completed_at: Optional[datetime] = None
    completion_notes: Optional[str] = None
    has_photo_evidence: bool = False
    camera_verified: bool = False
    camera_verified_at: Optional[datetime] = None
    issue_reported: Optional[str] = None
    notes: Optional[str] = None
    source: str


class TaskCreate(ApiModel):
    title: str = Field(min_length=3, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    category: str = Field(default="general", max_length=40)
    priority: Priority = "medium"
    zone: Optional[str] = Field(default=None, max_length=160)
    assigned_employee_id: Optional[str] = None
    shelf_id: Optional[str] = None
    product_id: Optional[str] = None
    alert_id: Optional[str] = None
    counter_id: Optional[str] = None
    camera_id: Optional[str] = None
    quantity: Optional[int] = Field(default=None, ge=0, le=100000)
    due_in_minutes: Optional[int] = Field(default=None, ge=1, le=60 * 24 * 14)
    notes: Optional[str] = Field(default=None, max_length=2000)
    idempotency_key: Optional[str] = Field(default=None, max_length=80)
    force: bool = False  # supervisor override of role eligibility (recorded in the task history)


class TaskPatch(ApiModel):
    title: Optional[str] = Field(default=None, min_length=3, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    priority: Optional[Priority] = None
    status: Optional[TaskStatus] = None
    zone: Optional[str] = Field(default=None, max_length=160)
    assigned_employee_id: Optional[str] = None
    quantity: Optional[int] = Field(default=None, ge=0, le=100000)
    due_in_minutes: Optional[int] = Field(default=None, ge=1, le=60 * 24 * 14)
    notes: Optional[str] = Field(default=None, max_length=2000)
    completion_notes: Optional[str] = Field(default=None, max_length=2000)
    has_photo_evidence: Optional[bool] = None
    camera_verified: Optional[bool] = None
    actor_employee_id: Optional[str] = None
    force: Optional[bool] = None


class TaskAssignBody(ApiModel):
    employee_id: Optional[str] = Field(default=None, alias="employeeId", max_length=32)  # null unassigns
    actor_employee_id: Optional[str] = Field(default=None, alias="actorEmployeeId", max_length=32)
    force: bool = False


class TaskCancelBody(ApiModel):
    actor_employee_id: Optional[str] = Field(default=None, alias="actorEmployeeId", max_length=32)
    reason: Optional[str] = Field(default=None, max_length=500)


class TaskAccept(ApiModel):
    employee_id: str = Field(alias="employeeId", min_length=1, max_length=32)


class TaskStart(ApiModel):
    employee_id: Optional[str] = Field(default=None, alias="employeeId")


class TaskComplete(ApiModel):
    employee_id: Optional[str] = Field(default=None, alias="employeeId")
    completion_notes: str = Field(default="", alias="completionNotes", max_length=2000)
    has_photo_evidence: bool = Field(default=False, alias="hasPhotoEvidence")


class TaskReportIssue(ApiModel):
    employee_id: Optional[str] = Field(default=None, alias="employeeId")
    issue_reason: str = Field(default="Unable to complete task", alias="issueReason", min_length=2, max_length=1000)


class TaskHistoryOut(ApiModel):
    id: int
    task_id: str
    from_status: Optional[str] = None
    to_status: str
    actor_employee_id: Optional[str] = None
    note: Optional[str] = None
    created_at: datetime


class TaskList(ApiModel):
    items: List[TaskOut]
    total: int
    meta: Meta


class TaskResult(ApiModel):
    success: bool = True
    task: TaskOut


# ------------------------------------------------------------------- staff
class EmployeeOut(ApiModel):
    id: str
    store_id: str
    name: str
    role: str
    role_label: Optional[str] = None
    department: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    assigned_zone: Optional[str] = None
    availability: str
    skills: List[str] = []
    avatar_url: Optional[str] = None
    joined_date: Optional[date] = None
    is_active: bool
    active_tasks_count: int = 0
    completed_tasks_count: int = 0


class EmployeeCreate(ApiModel):
    name: str = Field(min_length=2, max_length=120)
    role: str = Field(min_length=2, max_length=48)
    role_label: Optional[str] = Field(default=None, max_length=120)
    department: Optional[str] = Field(default=None, max_length=80)
    email: Optional[str] = Field(default=None, max_length=160)
    phone: Optional[str] = Field(default=None, max_length=32)
    assigned_zone: Optional[str] = Field(default=None, max_length=160)
    skills: List[str] = Field(default_factory=list, max_length=30)

    @field_validator("email")
    @classmethod
    def _email_shape(cls, v: Optional[str]) -> Optional[str]:
        if v and ("@" not in v or " " in v):
            raise ValueError("must be a valid email address")
        return v


class EmployeePatch(ApiModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    role: Optional[str] = Field(default=None, min_length=2, max_length=48)
    email: Optional[str] = Field(default=None, max_length=160)
    role_label: Optional[str] = Field(default=None, max_length=120)
    department: Optional[str] = Field(default=None, max_length=80)
    phone: Optional[str] = Field(default=None, max_length=32)
    assigned_zone: Optional[str] = Field(default=None, max_length=160)
    availability: Optional[Literal["available", "busy", "on_break", "off_duty", "on_leave"]] = None
    is_active: Optional[bool] = None
    skills: Optional[List[str]] = Field(default=None, max_length=30)


class StaffKpisOut(ApiModel):
    total_staff: int
    on_duty: int
    available: int
    busy: int
    open_tasks: int
    attendance_rate_pct: float


class StaffList(ApiModel):
    items: List[EmployeeOut]
    total: int
    kpis: StaffKpisOut
    meta: Meta


class ShiftOut(ApiModel):
    id: int
    employee_id: str
    shift_date: date
    shift_name: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    break_time: Optional[str] = None
    zone: Optional[str] = None
    status: str


class AttendanceOut(ApiModel):
    id: str
    employee_id: str
    work_date: date
    shift_name: Optional[str] = None
    scheduled_in: Optional[str] = None
    scheduled_out: Optional[str] = None
    actual_in: Optional[datetime] = None
    actual_out: Optional[datetime] = None
    status: str
    hours_worked: float


class CheckInBody(ApiModel):
    employee_id: str = Field(alias="employeeId", min_length=1, max_length=32)
