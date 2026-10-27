"""Shifts, attendance and availability contracts (Phase 4)."""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import Field, field_validator, model_validator

from schemas.common import ApiModel, Meta

HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
ShiftStatus = Literal["scheduled", "confirmed", "completed", "swapped", "absent"]


def _hhmm(v: Optional[str]) -> Optional[str]:
    if v is not None and not HHMM.match(v):
        raise ValueError("time must be HH:MM (24 h)")
    return v


class ShiftCreate(ApiModel):
    employee_id: str = Field(min_length=1, max_length=32)
    shift_date: date
    shift_name: str = Field(min_length=2, max_length=48)
    start_time: str
    end_time: str  # an end at or before the start means the shift ends the next day (overnight)
    break_time: Optional[str] = Field(default=None, max_length=48)
    zone: Optional[str] = Field(default=None, max_length=160)
    status: ShiftStatus = "scheduled"

    _t = field_validator("start_time", "end_time")(_hhmm)


class ShiftPatch(ApiModel):
    shift_date: Optional[date] = None
    shift_name: Optional[str] = Field(default=None, min_length=2, max_length=48)
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    break_time: Optional[str] = Field(default=None, max_length=48)
    zone: Optional[str] = Field(default=None, max_length=160)
    status: Optional[ShiftStatus] = None

    _t = field_validator("start_time", "end_time")(_hhmm)


class ShiftDetailOut(ApiModel):
    id: int
    store_id: str
    employee_id: str
    employee_name: Optional[str] = None
    department: Optional[str] = None
    shift_date: date
    shift_name: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    overnight: bool = False
    duration_minutes: Optional[int] = None
    break_time: Optional[str] = None
    zone: Optional[str] = None
    status: str


class ShiftList(ApiModel):
    items: List[ShiftDetailOut]
    total: int
    meta: Meta


class AttendanceEventBody(ApiModel):
    employee_id: str = Field(min_length=1, max_length=32)
    type: Literal["check_in", "check_out"]
    actor_employee_id: Optional[str] = Field(default=None, max_length=32)  # demo supervisor context, NOT verified identity
    note: Optional[str] = Field(default=None, max_length=300)


class AttendanceOverride(ApiModel):
    actual_in: Optional[datetime] = None
    actual_out: Optional[datetime] = None
    status: Optional[Literal["present", "late", "absent", "completed", "on_leave"]] = None
    override_reason: str = Field(min_length=3, max_length=300)
    actor_employee_id: Optional[str] = Field(default=None, max_length=32)

    @model_validator(mode="after")
    def _order(self):
        if self.actual_in and self.actual_out and self.actual_out < self.actual_in:
            raise ValueError("check-out cannot be before check-in")
        return self


class AttendanceRow(ApiModel):
    id: str
    derived: bool = False  # true = computed from the shift roster (no attendance record exists)
    employee_id: str
    employee_name: Optional[str] = None
    department: Optional[str] = None
    work_date: date
    shift_name: Optional[str] = None
    scheduled_in: Optional[str] = None
    scheduled_out: Optional[str] = None
    actual_in: Optional[datetime] = None
    actual_out: Optional[datetime] = None
    status: str  # scheduled | present | late | completed | absent | on_leave
    hours_worked: float = 0.0
    late_minutes: Optional[int] = None
    override_reason: Optional[str] = None
    source: Optional[str] = None
    recorded_by: Optional[str] = None


class AttendanceList(ApiModel):
    date: date
    items: List[AttendanceRow]
    summary: Dict[str, int]
    meta: Meta


class AvailabilityRow(ApiModel):
    employee_id: str
    name: str
    role: str
    role_label: Optional[str] = None
    department: Optional[str] = None
    skills: List[str] = []
    scheduled_now: bool
    checked_in: bool
    on_duty: bool  # checked in (a scheduled but not checked-in employee is NOT on duty)
    status: str  # available | busy | on_break | off_duty | on_leave | scheduled_not_checked_in
    active_tasks: int
    eligible_for_category: Optional[bool] = None
    shift: Optional[str] = None


class AvailabilityOut(ApiModel):
    store_id: str
    at: datetime
    scheduled_now: int
    checked_in: int
    scheduled_not_checked_in: int
    on_duty_estimate: int
    available_now: int
    items: List[AvailabilityRow]
    basis: str
    meta: Meta


class RecommendationOut(ApiModel):
    id: str
    kind: str  # checkout_assistance | shelf_replenishment | camera_maintenance
    title: str
    reason: str
    zone: Optional[str] = None
    priority: str
    recommended_action: str
    suggested_employee_id: Optional[str] = None
    suggested_employee_name: Optional[str] = None
    source_alert_id: str
    source_metrics: str
    status: Literal["pending", "accepted", "rejected"] = "pending"
    task_id: Optional[str] = None


class RecommendationDecisionBody(ApiModel):
    employee_id: Optional[str] = Field(default=None, max_length=32)
    actor_employee_id: Optional[str] = Field(default=None, max_length=32)


class RecommendationsOut(ApiModel):
    store_id: str
    items: List[RecommendationOut]
    basis: str
    meta: Meta


class WorkloadOut(ApiModel):
    store_id: str
    departments: List[Dict[str, Any]]
    employees: List[Dict[str, Any]]
    basis: str
    meta: Meta
