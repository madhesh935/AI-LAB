from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query

from api.deps import DbSession
from schemas.operations import (
    CheckInBody,
    EmployeeCreate,
    EmployeeOut,
    EmployeePatch,
    StaffList,
    TaskOut,
)
from services.staff import StaffService
from services.tasks import TaskService
from repositories.operations import TaskRepository

store_router = APIRouter(prefix="/api/stores/{store_id}/staff", tags=["staff"])
router = APIRouter(prefix="/api/staff", tags=["staff"])


@store_router.get("", response_model=StaffList)
def list_staff(store_id: str, db: DbSession, include_inactive: bool = Query(False, alias="includeInactive")):
    return StaffService(db).list(store_id, include_inactive)


@store_router.post("", response_model=EmployeeOut, status_code=201)
def create_employee(store_id: str, body: EmployeeCreate, db: DbSession):
    return StaffService(db).create(store_id, body)


@router.patch("/{employee_id}", response_model=EmployeeOut)
def update_employee(employee_id: str, body: EmployeePatch, db: DbSession):
    return StaffService(db).update(employee_id, body)


@router.post("/{employee_id}/deactivate", response_model=EmployeeOut)
def deactivate_employee(employee_id: str, db: DbSession):
    """Soft removal; history is preserved."""
    return StaffService(db).deactivate(employee_id)


# ---- Staff PWA ("me") - the employee is chosen by the client; this is context, not identity ----
@router.get("/me")
def me(db: DbSession, employee_id: str = Query("STF-01", min_length=1, max_length=32)) -> Dict[str, Any]:
    return StaffService(db).profile(employee_id)


@router.get("/me/tasks", response_model=List[TaskOut])
def my_tasks(db: DbSession, employee_id: str = Query("STF-01", min_length=1, max_length=32)):
    staff = StaffService(db).get(employee_id)
    svc = TaskService(db)
    return svc._out(TaskRepository(db).for_employee(employee_id, staff.store_id))


@router.get("/me/schedule")
def my_schedule(db: DbSession, employee_id: str = Query("STF-01", min_length=1, max_length=32)) -> Dict[str, Any]:
    return StaffService(db).schedule(employee_id)


@router.get("/me/attendance")
def my_attendance(db: DbSession, employee_id: str = Query("STF-01", min_length=1, max_length=32)) -> Dict[str, Any]:
    return StaffService(db).attendance(employee_id)


@router.post("/me/check-in")
def check_in(body: CheckInBody, db: DbSession) -> Dict[str, Any]:
    return StaffService(db).check_in(body.employee_id)


@router.post("/me/check-out")
def check_out(body: CheckInBody, db: DbSession) -> Dict[str, Any]:
    return StaffService(db).check_out(body.employee_id)


@router.get("/me/notifications")
def my_notifications(db: DbSession, employee_id: str = Query("STF-01", min_length=1, max_length=32)) -> List[Dict[str, Any]]:
    return StaffService(db).notifications(employee_id)


@router.get("/{employee_id}")
def employee_detail(employee_id: str, db: DbSession) -> Dict[str, Any]:
    """Admin directory profile (declared after /me/* so 'me' is never read as an employee id)."""
    return StaffService(db).detail(employee_id)
