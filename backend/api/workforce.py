"""Shifts, attendance, availability, staffing recommendations and workload.

No authentication: `actorEmployeeId` / `employeeId` values are the selected demo context, recorded for audit but NOT verified identity.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Query

from api.deps import DbSession
from core.errors import ConfirmationRequiredError
from schemas.workforce import (
    AttendanceEventBody, AttendanceList, AttendanceOverride, AvailabilityOut, RecommendationDecisionBody, RecommendationsOut, ShiftCreate,
    ShiftDetailOut, ShiftList, ShiftPatch, WorkloadOut,
)
from services.workforce import AttendanceService, AvailabilityService, RecommendationService, ShiftService, WorkloadService

store_router = APIRouter(prefix="/api/stores/{store_id}", tags=["workforce"])
router = APIRouter(prefix="/api", tags=["workforce"])


# ------------------------------------------------------------------ shifts
@store_router.get("/shifts", response_model=ShiftList)
def list_shifts(store_id: str, db: DbSession, start: Optional[date] = Query(None, alias="from"), end: Optional[date] = Query(None, alias="to"),
                employee_id: Optional[str] = Query(None, alias="employeeId")):
    return ShiftService(db).list(store_id, start, end, employee_id)


@store_router.post("/shifts", response_model=ShiftDetailOut, status_code=201)
def create_shift(store_id: str, body: ShiftCreate, db: DbSession):
    return ShiftService(db).create(store_id, body)


@router.patch("/shifts/{shift_id}", response_model=ShiftDetailOut)
def update_shift(shift_id: int, body: ShiftPatch, db: DbSession):
    return ShiftService(db).update(shift_id, body)


@router.delete("/shifts/{shift_id}", status_code=204)
def delete_shift(shift_id: int, db: DbSession, confirm: bool = Query(False)):
    if not confirm:
        raise ConfirmationRequiredError("a shift")
    ShiftService(db).delete(shift_id)


# -------------------------------------------------------------- attendance
@store_router.get("/attendance", response_model=AttendanceList)
def list_attendance(store_id: str, db: DbSession, day: Optional[date] = Query(None, alias="date")):
    return AttendanceService(db).list(store_id, day)


@store_router.post("/attendance/events")
def attendance_event(store_id: str, body: AttendanceEventBody, db: DbSession) -> Dict[str, Any]:
    """Supervisor-recorded check-in / check-out (server timestamp). Never derived from camera footage."""
    rec = AttendanceService(db).event(store_id, body)
    return {"success": True, "attendanceId": rec.id, "status": rec.status, "actualIn": rec.actual_in.isoformat() if rec.actual_in else None,
            "actualOut": rec.actual_out.isoformat() if rec.actual_out else None, "source": rec.source}


@router.patch("/attendance/{attendance_id}")
def override_attendance(attendance_id: str, body: AttendanceOverride, db: DbSession) -> Dict[str, Any]:
    rec = AttendanceService(db).override(attendance_id, body)
    return {"success": True, "attendanceId": rec.id, "status": rec.status, "hoursWorked": rec.hours_worked, "overrideReason": rec.override_reason}


# -------------------------------------------------------- availability etc.
@store_router.get("/staff/availability", response_model=AvailabilityOut)
def availability(store_id: str, db: DbSession, category: Optional[str] = Query(None, max_length=40)):
    return AvailabilityService(db).availability(store_id, category)


@store_router.get("/staff/recommendations", response_model=RecommendationsOut)
def recommendations(store_id: str, db: DbSession):
    return RecommendationService(db).list(store_id)


@store_router.post("/staff/recommendations/{recommendation_id}/accept")
def accept_recommendation(store_id: str, recommendation_id: str, db: DbSession, body: RecommendationDecisionBody = Body(default_factory=RecommendationDecisionBody)):
    return RecommendationService(db).accept(store_id, recommendation_id, body.employee_id)


@store_router.post("/staff/recommendations/{recommendation_id}/reject")
def reject_recommendation(store_id: str, recommendation_id: str, db: DbSession):
    return RecommendationService(db).reject(store_id, recommendation_id)


@store_router.get("/staff/workload", response_model=WorkloadOut)
def workload(store_id: str, db: DbSession):
    return WorkloadService().workload(db, store_id)
