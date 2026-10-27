from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from core.errors import ConflictError, InvalidStateError, NotFoundError
from core.events import event_bus
from database.models import Attendance, Employee, Store
from repositories.base import get_or_404
from repositories.operations import EmployeeRepository, TaskRepository
from schemas.common import Meta
from schemas.operations import (
    AttendanceOut,
    EmployeeCreate,
    EmployeeOut,
    EmployeePatch,
    ShiftOut,
    StaffKpisOut,
    StaffList,
)
from services.common import get_store_or_404, humanize, now_utc, store_tz
from services.tasks import TaskService

ON_DUTY = {"available", "busy", "on_break"}


class StaffService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = EmployeeRepository(db)

    def _out(self, emp: Employee, counts: Optional[Dict[str, tuple]] = None) -> EmployeeOut:
        active, done = (counts or {}).get(emp.id, (0, 0))
        out = EmployeeOut.model_validate(emp)
        out.active_tasks_count = active
        out.completed_tasks_count = done
        return out

    def get(self, employee_id: str) -> Employee:
        return get_or_404(self.db, Employee, employee_id, "Employee")

    # ------------------------------------------------------------ directory
    def list(self, store_id: str, include_inactive: bool = False) -> StaffList:
        store = get_store_or_404(self.db, store_id)
        employees = self.repo.list(store_id, include_inactive)
        counts = self.repo.task_counts(store_id)
        items = [self._out(e, counts) for e in employees]

        today = now_utc().astimezone(store_tz(store)).date()
        attendance = self.repo.attendance_today(store_id, today)
        present = sum(1 for a in attendance if a.status in ("present", "late", "completed"))
        expected = sum(1 for a in attendance if a.status != "on_leave") or 0
        kpis = StaffKpisOut(
            total_staff=len(items),
            on_duty=sum(1 for e in items if e.availability in ON_DUTY),
            available=sum(1 for e in items if e.availability == "available"),
            busy=sum(1 for e in items if e.availability == "busy"),
            open_tasks=TaskRepository(self.db).open_count(store_id),
            attendance_rate_pct=round(present / expected * 100, 1) if expected else 0.0,
        )
        return StaffList(items=items, total=len(items), kpis=kpis, meta=Meta(data_state="available" if items else "empty", sources=["employees"]))

    def create(self, store_id: str, body: EmployeeCreate) -> EmployeeOut:
        get_store_or_404(self.db, store_id)
        emp = Employee(
            id=self.repo.next_id(store_id),
            store_id=store_id,
            name=body.name,
            role=body.role,
            role_label=body.role_label,
            department=body.department,
            email=body.email,
            phone=body.phone,
            assigned_zone=body.assigned_zone,
            skills=body.skills,
            joined_date=now_utc().date(),
        )
        self.db.add(emp)
        self.db.flush()
        event_bus.publish(store_id, "STAFF_CHANGED", {"employeeId": emp.id})
        return self._out(emp)

    def update(self, employee_id: str, body: EmployeePatch) -> EmployeeOut:
        emp = self.get(employee_id)
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(emp, field, value)
        self.db.flush()
        event_bus.publish(emp.store_id, "STAFF_CHANGED", {"employeeId": emp.id})
        return self._out(emp, self.repo.task_counts(emp.store_id))

    def deactivate(self, employee_id: str) -> EmployeeOut:
        """Employees are never hard-deleted: tasks and attendance keep referring to them."""
        emp = self.get(employee_id)
        emp.is_active = False
        emp.availability = "off_duty"
        self.db.flush()
        return self._out(emp)

    # ----------------------------------------------------------- PWA: "me"
    def profile(self, employee_id: str) -> Dict[str, Any]:
        emp = self.get(employee_id)
        store = self.db.get(Store, emp.store_id)
        today = now_utc().astimezone(store_tz(store)).date()
        shifts = [s for s in self.repo.shifts(emp.id, today) if s.shift_date == today]
        shift = shifts[0] if shifts else None
        return {
            "id": emp.id,
            "name": emp.name,
            "role": emp.role_label or emp.role,
            "roleKey": emp.role,
            "department": emp.department,
            "storeId": emp.store_id,
            "storeName": store.name if store else None,
            "email": emp.email,
            "phone": emp.phone,
            "currentShift": f"{shift.shift_name} ({shift.start_time} – {shift.end_time})" if shift else None,
            "assignedZone": emp.assigned_zone,
            "avatar": emp.avatar_url,
            "status": emp.availability,
        }

    def schedule(self, employee_id: str) -> Dict[str, Any]:
        emp = self.get(employee_id)
        store = self.db.get(Store, emp.store_id)
        today = now_utc().astimezone(store_tz(store)).date()
        shifts = [ShiftOut.model_validate(s) for s in self.repo.shifts(emp.id, today)]
        current = next((s for s in shifts if s.shift_date == today), None)
        return {
            "employeeId": emp.id,
            "currentShift": current.model_dump(by_alias=True) if current else None,
            "upcomingShifts": [s.model_dump(by_alias=True) for s in shifts if s.shift_date > today],
        }

    def attendance(self, employee_id: str) -> Dict[str, Any]:
        emp = self.get(employee_id)
        records = [AttendanceOut.model_validate(a) for a in self.repo.attendance(emp.id)]
        latest = records[0] if records else None
        return {
            "employeeId": emp.id,
            "isCheckedIn": bool(latest and latest.actual_in and not latest.actual_out),
            "latestRecord": latest.model_dump(by_alias=True) if latest else None,
            "history": [r.model_dump(by_alias=True) for r in records],
        }

    def check_in(self, employee_id: str) -> Dict[str, Any]:
        """Self-service check-in with a SERVER timestamp (the client's clock and claimed identity are context, not proof)."""
        from services.workforce import AttendanceService

        rec = AttendanceService(self.db).check_in(self.get(employee_id).id)
        return {"success": True, "record": AttendanceOut.model_validate(rec).model_dump(by_alias=True), "timestamp": rec.actual_in.isoformat()}

    def check_out(self, employee_id: str) -> Dict[str, Any]:
        from services.workforce import AttendanceService

        rec = AttendanceService(self.db).check_out(self.get(employee_id).id)
        return {"success": True, "record": AttendanceOut.model_validate(rec).model_dump(by_alias=True), "timestamp": rec.actual_out.isoformat()}

    def detail(self, employee_id: str) -> Dict[str, Any]:
        """Directory profile for the admin app: no authentication, so this is operational context only."""
        from services.workforce import AttendanceService, AvailabilityService, ShiftService

        emp = self.get(employee_id)
        store = self.db.get(Store, emp.store_id)
        counts = self.repo.task_counts(emp.store_id)
        out = self._out(emp, counts).model_dump(by_alias=True)
        local = now_utc().astimezone(store_tz(store)).replace(tzinfo=None)
        shift = ShiftService(self.db).current_shift(emp.id, local)
        open_rec = AttendanceService(self.db).open_record(emp.id)
        avail = next((r for r in AvailabilityService(self.db).availability(emp.store_id).items if r.employee_id == emp.id), None)
        tasks = TaskService(self.db)
        recent = tasks._out(TaskRepository(self.db).for_employee(emp.id, emp.store_id, include_unassigned=False)[:10])
        return {**out, "currentShift": f"{shift.shift_name} ({shift.start_time}-{shift.end_time})" if shift else None,
                "checkedIn": open_rec is not None, "checkInTime": open_rec.actual_in.isoformat() if open_rec else None,
                "availabilityStatus": avail.status if avail else None, "recentTasks": [t.model_dump(by_alias=True) for t in recent]}

    def notifications(self, employee_id: str) -> List[Dict[str, Any]]:
        """Derived from this employee's tasks - there is no separate notification store yet."""
        emp = self.get(employee_id)
        tasks = TaskService(self.db)
        rows = TaskRepository(self.db).for_employee(emp.id, emp.store_id, include_unassigned=False)
        now = now_utc()
        out = []
        for t in rows[:30]:
            out.append(
                {
                    "id": f"notif-{t.id}",
                    "employeeId": emp.id,
                    "title": "Task completed" if t.status == "completed" else f"Task assigned: {t.title}",
                    "message": t.description or t.title,
                    "type": t.category,
                    "priority": t.priority if t.priority in ("critical", "high") else "normal",
                    "taskId": t.id,
                    "timestamp": humanize(t.updated_at, now),
                    "read": t.status in ("completed", "cancelled"),
                }
            )
        return out
