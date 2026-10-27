"""Shifts, attendance, availability, staffing recommendations and workload (SQLite-backed, server timestamps).

Principles
* SCHEDULED is not PRESENT: a shift on the roster does not make anyone on duty; only a recorded check-in does.
* Attendance is only ever recorded by an explicit check-in/out action (self-service or a supervisor action). Surveillance footage is never used.
* The employee context in this unauthenticated demo is chosen by the client; ids are recorded as context, not as verified identity.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.errors import ConflictError, InvalidStateError, NotFoundError
from core.events import event_bus
from database.models import Alert, Attendance, Camera, CheckoutCounter, Employee, RecommendationDecision, Shelf, Shift, Store, Task
from schemas.common import Meta
from schemas.operations import TaskCreate
from schemas.workforce import (
    AttendanceEventBody, AttendanceList, AttendanceOverride, AttendanceRow, AvailabilityOut, AvailabilityRow, RecommendationOut,
    RecommendationsOut, ShiftCreate, ShiftDetailOut, ShiftList, ShiftPatch, WorkloadOut,
)
from services.common import get_store_or_404, now_utc, store_tz
from services.tasks import ELIGIBLE_ROLES, OPEN_STATUSES, TaskService, is_eligible

LATE_GRACE_MINUTES = 10
EARLY_CHECKIN_MINUTES = 60
MIN_SHIFT_MINUTES = 30
MAX_SHIFT_MINUTES = 16 * 60


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def shift_span(shift_date: date, start: str, end: str) -> Tuple[datetime, datetime, bool]:
    """Naive local datetimes [start, end). An end at/before the start belongs to the NEXT day (overnight shift)."""
    s = datetime.combine(shift_date, time(*divmod(_minutes(start), 60)))
    e = datetime.combine(shift_date, time(*divmod(_minutes(end), 60)))
    overnight = _minutes(end) <= _minutes(start)
    if overnight:
        e += timedelta(days=1)
    return s, e, overnight


def _local(dt: datetime, tz) -> datetime:
    return dt.astimezone(tz).replace(tzinfo=None)


class ShiftService:
    def __init__(self, db: Session):
        self.db = db

    def _out(self, s: Shift, emp: Optional[Employee]) -> ShiftDetailOut:
        overnight, duration = False, None
        if s.start_time and s.end_time:
            a, b, overnight = shift_span(s.shift_date, s.start_time, s.end_time)
            duration = int((b - a).total_seconds() // 60)
        return ShiftDetailOut(id=s.id, store_id=s.store_id, employee_id=s.employee_id, employee_name=emp.name if emp else None,
                              department=emp.department if emp else None, shift_date=s.shift_date, shift_name=s.shift_name, start_time=s.start_time,
                              end_time=s.end_time, overnight=overnight, duration_minutes=duration, break_time=s.break_time, zone=s.zone, status=s.status)

    def _employee(self, store_id: str, employee_id: str) -> Employee:
        emp = self.db.get(Employee, employee_id)
        if emp is None or emp.store_id != store_id or not emp.is_active:
            raise NotFoundError("Employee", employee_id)
        return emp

    def _check(self, store_id: str, employee_id: str, d: date, start: str, end: str, ignore_id: Optional[int] = None) -> None:
        a, b, _ = shift_span(d, start, end)
        minutes = int((b - a).total_seconds() // 60)
        if minutes < MIN_SHIFT_MINUTES or minutes > MAX_SHIFT_MINUTES:
            raise InvalidStateError(f"A shift must last between {MIN_SHIFT_MINUTES} minutes and {MAX_SHIFT_MINUTES // 60} hours (got {minutes} min)")
        others = self.db.scalars(select(Shift).where(Shift.employee_id == employee_id)
                                 .where(Shift.shift_date >= d - timedelta(days=1)).where(Shift.shift_date <= d + timedelta(days=1))).all()
        for o in others:
            if o.id == ignore_id or not o.start_time or not o.end_time or o.status in ("absent", "swapped"):
                continue
            oa, ob, _ = shift_span(o.shift_date, o.start_time, o.end_time)
            if a < ob and oa < b:
                raise ConflictError(f"Overlaps the employee's '{o.shift_name}' shift on {o.shift_date} ({o.start_time}-{o.end_time})")

    def list(self, store_id: str, start: Optional[date] = None, end: Optional[date] = None, employee_id: Optional[str] = None) -> ShiftList:
        store = get_store_or_404(self.db, store_id)
        today = now_utc().astimezone(store_tz(store)).date()
        start = start or today
        end = end or start + timedelta(days=6)
        stmt = select(Shift).where(Shift.store_id == store_id).where(Shift.shift_date >= start).where(Shift.shift_date <= end)
        if employee_id:
            stmt = stmt.where(Shift.employee_id == employee_id)
        rows = self.db.scalars(stmt.order_by(Shift.shift_date, Shift.start_time)).all()
        emps = {e.id: e for e in self.db.scalars(select(Employee).where(Employee.store_id == store_id))}
        items = [self._out(s, emps.get(s.employee_id)) for s in rows]
        return ShiftList(items=items, total=len(items), meta=Meta(data_state="available" if items else "empty", sources=["shifts"]))

    def create(self, store_id: str, body: ShiftCreate) -> ShiftDetailOut:
        get_store_or_404(self.db, store_id)
        emp = self._employee(store_id, body.employee_id)
        if self.db.scalars(select(Shift).where(Shift.employee_id == emp.id).where(Shift.shift_date == body.shift_date).where(Shift.shift_name == body.shift_name)).first():
            raise ConflictError(f"{emp.name} already has a '{body.shift_name}' shift on {body.shift_date}")
        self._check(store_id, emp.id, body.shift_date, body.start_time, body.end_time)
        shift = Shift(store_id=store_id, employee_id=emp.id, shift_date=body.shift_date, shift_name=body.shift_name, start_time=body.start_time,
                      end_time=body.end_time, break_time=body.break_time, zone=body.zone, status=body.status)
        self.db.add(shift)
        self.db.flush()
        event_bus.publish(store_id, "SHIFT_CREATED", {"shiftId": shift.id, "employeeId": emp.id, "date": shift.shift_date.isoformat()})
        return self._out(shift, emp)

    def update(self, shift_id: int, body: ShiftPatch) -> ShiftDetailOut:
        shift = self.db.get(Shift, shift_id)
        if shift is None:
            raise NotFoundError("Shift", shift_id)
        data = body.model_dump(exclude_unset=True)
        d = data.get("shift_date", shift.shift_date)
        start, end = data.get("start_time", shift.start_time), data.get("end_time", shift.end_time)
        if start and end:
            self._check(shift.store_id, shift.employee_id, d, start, end, ignore_id=shift.id)
        for k, v in data.items():
            setattr(shift, k, v)
        self.db.flush()
        event_bus.publish(shift.store_id, "SHIFT_UPDATED", {"shiftId": shift.id, "employeeId": shift.employee_id})
        return self._out(shift, self.db.get(Employee, shift.employee_id))

    def delete(self, shift_id: int) -> None:
        shift = self.db.get(Shift, shift_id)
        if shift is None:
            raise NotFoundError("Shift", shift_id)
        store_id, emp = shift.store_id, shift.employee_id
        self.db.delete(shift)
        self.db.flush()
        event_bus.publish(store_id, "SHIFT_DELETED", {"shiftId": shift_id, "employeeId": emp})

    # ---- helpers shared with attendance / availability
    def shifts_around(self, employee_id: str, d: date) -> List[Shift]:
        return list(self.db.scalars(select(Shift).where(Shift.employee_id == employee_id).where(Shift.shift_date >= d - timedelta(days=1))
                                    .where(Shift.shift_date <= d + timedelta(days=1)).where(Shift.status != "absent")))

    def current_shift(self, employee_id: str, now_local: datetime, early_minutes: int = 0) -> Optional[Shift]:
        for s in self.shifts_around(employee_id, now_local.date()):
            if not s.start_time or not s.end_time:
                continue
            a, b, _ = shift_span(s.shift_date, s.start_time, s.end_time)
            if a - timedelta(minutes=early_minutes) <= now_local < b:
                return s
        return None


class AttendanceService:
    def __init__(self, db: Session):
        self.db = db
        self.shifts = ShiftService(db)

    def _emp(self, employee_id: str) -> Employee:
        emp = self.db.get(Employee, employee_id)
        if emp is None:
            raise NotFoundError("Employee", employee_id)
        return emp

    def open_record(self, employee_id: str) -> Optional[Attendance]:
        return self.db.scalars(select(Attendance).where(Attendance.employee_id == employee_id).where(Attendance.actual_in.is_not(None))
                               .where(Attendance.actual_out.is_(None)).order_by(Attendance.actual_in.desc()).limit(1)).first()

    def check_in(self, employee_id: str, source: str = "self", recorded_by: Optional[str] = None, note: Optional[str] = None) -> Attendance:
        emp = self._emp(employee_id)
        if not emp.is_active:
            raise InvalidStateError("This employee is deactivated")
        if self.open_record(emp.id) is not None:
            raise ConflictError("Already checked in; check out first")
        store = self.db.get(Store, emp.store_id)
        tz = store_tz(store)
        now = now_utc()
        local = _local(now, tz)
        shift = self.shifts.current_shift(emp.id, local, EARLY_CHECKIN_MINUTES)
        status, work_date = "present", local.date()
        sched_in = sched_out = shift_name = None
        if shift:
            work_date, shift_name, sched_in, sched_out = shift.shift_date, shift.shift_name, shift.start_time, shift.end_time
            a, _, _ = shift_span(shift.shift_date, shift.start_time, shift.end_time)  # type: ignore[arg-type]
            if local > a + timedelta(minutes=LATE_GRACE_MINUTES):
                status = "late"
        rec = Attendance(id=f"att-{uuid.uuid4().hex[:8]}", store_id=emp.store_id, employee_id=emp.id, work_date=work_date, shift_name=shift_name,
                         scheduled_in=sched_in, scheduled_out=sched_out, actual_in=now, status=status, source=source, recorded_by=recorded_by,
                         override_reason=note)
        emp.availability = "available"
        self.db.add(rec)
        self.db.flush()
        event_bus.publish(emp.store_id, "ATTENDANCE_CHANGED", {"employeeId": emp.id, "status": "checked_in", "attendanceId": rec.id, "late": status == "late"})
        return rec

    def check_out(self, employee_id: str, source: str = "self", recorded_by: Optional[str] = None, note: Optional[str] = None) -> Attendance:
        emp = self._emp(employee_id)
        rec = self.open_record(emp.id)
        if rec is None:
            raise InvalidStateError("No active check-in found to check out from")
        now = now_utc()
        rec.actual_out = now
        rec.status = "completed"
        rec.hours_worked = round(max(0.0, (now - rec.actual_in).total_seconds() / 3600), 2)  # type: ignore[operator]
        if source == "supervisor":
            rec.source, rec.recorded_by = source, recorded_by
        if note:
            rec.override_reason = note
        emp.availability = "off_duty"
        self.db.flush()
        event_bus.publish(emp.store_id, "ATTENDANCE_CHANGED", {"employeeId": emp.id, "status": "checked_out", "attendanceId": rec.id})
        return rec

    def event(self, store_id: str, body: AttendanceEventBody) -> Attendance:
        get_store_or_404(self.db, store_id)
        emp = self._emp(body.employee_id)
        if emp.store_id != store_id:
            raise NotFoundError("Employee", body.employee_id)
        fn = self.check_in if body.type == "check_in" else self.check_out
        return fn(emp.id, source="supervisor", recorded_by=body.actor_employee_id, note=body.note)

    def override(self, attendance_id: str, body: AttendanceOverride) -> Attendance:
        if attendance_id.startswith("derived-"):
            # A roster-only row (nobody checked in): the supervisor's correction creates the record, flagged source=supervisor.
            try:
                shift = self.db.get(Shift, int(attendance_id[len("derived-"):]))
            except ValueError:
                shift = None
            if shift is None:
                raise NotFoundError("Attendance record", attendance_id)
            rec = self.db.scalars(select(Attendance).where(Attendance.employee_id == shift.employee_id).where(Attendance.work_date == shift.shift_date)
                                  .where(Attendance.shift_name == shift.shift_name)).first()
            if rec is None:
                rec = Attendance(id=f"att-{uuid.uuid4().hex[:8]}", store_id=shift.store_id, employee_id=shift.employee_id, work_date=shift.shift_date,
                                 shift_name=shift.shift_name, scheduled_in=shift.start_time, scheduled_out=shift.end_time, status="scheduled", source="supervisor")
                self.db.add(rec)
                self.db.flush()
        else:
            rec = self.db.get(Attendance, attendance_id)
        if rec is None:
            raise NotFoundError("Attendance record", attendance_id)
        if body.actual_in is not None:
            rec.actual_in = body.actual_in
        if body.actual_out is not None:
            rec.actual_out = body.actual_out
        if body.status:
            rec.status = body.status
        if rec.actual_in and rec.actual_out:
            rec.hours_worked = round(max(0.0, (rec.actual_out - rec.actual_in).total_seconds() / 3600), 2)
        rec.override_reason, rec.source, rec.recorded_by = body.override_reason, "supervisor", body.actor_employee_id
        self.db.flush()
        event_bus.publish(rec.store_id, "ATTENDANCE_CHANGED", {"employeeId": rec.employee_id, "status": "overridden", "attendanceId": rec.id})
        return rec

    def _late_minutes(self, rec: Attendance, tz) -> Optional[int]:
        if not rec.actual_in or not rec.scheduled_in:
            return None
        a = datetime.combine(rec.work_date, time(*divmod(_minutes(rec.scheduled_in), 60)))
        mins = int((_local(rec.actual_in, tz) - a).total_seconds() // 60)
        return mins if mins > LATE_GRACE_MINUTES else 0

    def list(self, store_id: str, d: Optional[date] = None) -> AttendanceList:
        store = get_store_or_404(self.db, store_id)
        tz = store_tz(store)
        now = now_utc()
        local_now = _local(now, tz)
        d = d or local_now.date()
        emps = {e.id: e for e in self.db.scalars(select(Employee).where(Employee.store_id == store_id))}
        recs = self.db.scalars(select(Attendance).where(Attendance.store_id == store_id).where(Attendance.work_date == d)).all()
        rows: List[AttendanceRow] = []
        have = set()
        for r in recs:
            e = emps.get(r.employee_id)
            have.add((r.employee_id, r.shift_name))
            rows.append(AttendanceRow(id=r.id, employee_id=r.employee_id, employee_name=e.name if e else None, department=e.department if e else None,
                                      work_date=r.work_date, shift_name=r.shift_name, scheduled_in=r.scheduled_in, scheduled_out=r.scheduled_out,
                                      actual_in=r.actual_in, actual_out=r.actual_out, status=r.status, hours_worked=r.hours_worked,
                                      late_minutes=self._late_minutes(r, tz), override_reason=r.override_reason, source=r.source, recorded_by=r.recorded_by))
        # roster entries without a record: SCHEDULED until the late grace has passed, then ABSENT (derived, never stored)
        for s in self.db.scalars(select(Shift).where(Shift.store_id == store_id).where(Shift.shift_date == d).where(Shift.status != "swapped")):
            if (s.employee_id, s.shift_name) in have or not s.start_time:
                continue
            e = emps.get(s.employee_id)
            a, _, _ = shift_span(s.shift_date, s.start_time, s.end_time or s.start_time)
            status = "on_leave" if (e and e.availability == "on_leave") else ("absent" if local_now > a + timedelta(minutes=LATE_GRACE_MINUTES * 3) else "scheduled")
            rows.append(AttendanceRow(id=f"derived-{s.id}", derived=True, employee_id=s.employee_id, employee_name=e.name if e else None,
                                      department=e.department if e else None, work_date=d, shift_name=s.shift_name, scheduled_in=s.start_time,
                                      scheduled_out=s.end_time, status=status))
        rows.sort(key=lambda r: (r.scheduled_in or "99:99", r.employee_name or ""))
        summary: Dict[str, int] = {}
        for r in rows:
            summary[r.status] = summary.get(r.status, 0) + 1
        return AttendanceList(date=d, items=rows, summary=summary, meta=Meta(data_state="available" if rows else "empty", sources=["attendance", "shifts"],
                                                                              note="Rows marked derived come from the roster only: nobody checked in."))


class AvailabilityService:
    def __init__(self, db: Session):
        self.db = db

    def availability(self, store_id: str, category: Optional[str] = None) -> AvailabilityOut:
        store = get_store_or_404(self.db, store_id)
        tz = store_tz(store)
        now = now_utc()
        local = _local(now, tz)
        shifts = ShiftService(self.db)
        att = AttendanceService(self.db)
        loads = dict(self.db.execute(select(Task.assigned_employee_id, func.count()).where(Task.store_id == store_id)
                                     .where(Task.status.in_(("assigned", "in_progress"))).where(Task.assigned_employee_id.is_not(None)).group_by(Task.assigned_employee_id)).all())
        rows: List[AvailabilityRow] = []
        sched = checked = sched_not = avail = 0
        for e in self.db.scalars(select(Employee).where(Employee.store_id == store_id).where(Employee.is_active.is_(True)).order_by(Employee.name)):
            shift = shifts.current_shift(e.id, local)
            open_rec = att.open_record(e.id)
            scheduled_now, checked_in = shift is not None, open_rec is not None
            if e.availability == "on_leave":
                status = "on_leave"
            elif checked_in:
                status = e.availability if e.availability in ("available", "busy", "on_break") else "available"
                if status == "available" and loads.get(e.id, 0) > 0 and self.db.scalar(select(func.count()).select_from(Task).where(Task.assigned_employee_id == e.id).where(Task.status == "in_progress")):
                    status = "busy"
            elif scheduled_now:
                status = "scheduled_not_checked_in"
            else:
                status = "off_duty"
            sched += scheduled_now
            checked += checked_in
            sched_not += scheduled_now and not checked_in
            avail += status == "available"
            rows.append(AvailabilityRow(
                employee_id=e.id, name=e.name, role=e.role, role_label=e.role_label, department=e.department, skills=list(e.skills or []),
                scheduled_now=scheduled_now, checked_in=checked_in, on_duty=checked_in, status=status, active_tasks=int(loads.get(e.id, 0)),
                eligible_for_category=is_eligible(e, category) if category else None, shift=f"{shift.shift_name} ({shift.start_time}-{shift.end_time})" if shift else None))
        return AvailabilityOut(store_id=store_id, at=now, scheduled_now=sched, checked_in=checked, scheduled_not_checked_in=sched_not,
                               on_duty_estimate=checked, available_now=avail, items=rows,
                               basis="on duty = recorded check-in without check-out; scheduled = roster only; no camera data is used",
                               meta=Meta(data_state="available" if rows else "empty", sources=["employees", "shifts", "attendance"]))

    def candidates(self, store_id: str, category: str) -> List[AvailabilityRow]:
        """Eligible, checked-in employees ranked by free capacity (fewest open tasks first)."""
        rows = [r for r in self.availability(store_id, category).items if r.eligible_for_category and r.on_duty and r.status in ("available", "busy")]
        return sorted(rows, key=lambda r: (r.status != "available", r.active_tasks, r.name))


class RecommendationService:
    """Staffing recommendations DERIVED from live alerts that have no open task yet; only the manager's decision is stored."""

    KINDS = {"queue": ("checkout_assistance", "Checkout"), "inventory": ("shelf_replenishment", "Inventory"), "camera": ("camera_maintenance", "Camera")}

    def __init__(self, db: Session):
        self.db = db

    def list(self, store_id: str) -> RecommendationsOut:
        get_store_or_404(self.db, store_id)
        decided = {d.key: d for d in self.db.scalars(select(RecommendationDecision).where(RecommendationDecision.store_id == store_id))}
        avail = AvailabilityService(self.db)
        out: List[RecommendationOut] = []
        for a in self.db.scalars(select(Alert).where(Alert.store_id == store_id).where(Alert.status.in_(("active", "acknowledged")))
                                 .where(Alert.module.in_(tuple(self.KINDS))).order_by(Alert.created_at.desc()).limit(50)):
            category, label = self.KINDS[a.module]
            key = f"alert:{a.id}"
            dec = decided.get(key)
            open_task = self.db.scalars(select(Task).where(Task.alert_id == a.id).where(Task.status.in_(OPEN_STATUSES)).limit(1)).first()
            if dec is None and open_task is not None:
                continue  # already being handled
            cands = avail.candidates(store_id, category)
            best = cands[0] if cands else None
            out.append(RecommendationOut(
                id=key, kind=category, title=a.title, reason=a.description, zone=a.zone, priority="critical" if a.severity == "critical" else "high" if a.severity == "warning" else "medium",
                recommended_action=a.recommended_action or f"Assign {label.lower()} support", suggested_employee_id=best.employee_id if best else None,
                suggested_employee_name=best.name if best else None, source_alert_id=a.id, source_metrics=(a.evidence or "")[:300],
                status=dec.status if dec else "pending", task_id=dec.task_id if dec else None))
        out.sort(key=lambda r: (r.status != "pending", {"critical": 0, "high": 1, "medium": 2}.get(r.priority, 3)))
        return RecommendationsOut(store_id=store_id, items=out, basis="derived from open alerts without a task and the on-duty, role-eligible employee with the fewest open tasks",
                                  meta=Meta(data_state="available" if out else "empty", sources=["alerts", "attendance", "tasks"]))

    def accept(self, store_id: str, rec_id: str, employee_id: Optional[str]) -> Dict[str, Any]:
        if not rec_id.startswith("alert:"):
            raise NotFoundError("Recommendation", rec_id)
        alert = self.db.get(Alert, rec_id[6:])
        if alert is None or alert.store_id != store_id:
            raise NotFoundError("Recommendation", rec_id)
        category, label = self.KINDS.get(alert.module, ("general_operations", "Operations"))
        suggested = None
        if not employee_id:
            c = AvailabilityService(self.db).candidates(store_id, category)
            suggested = c[0].employee_id if c else None
        body = TaskCreate(title=alert.title[:200], description=alert.description, category=category, priority="critical" if alert.severity == "critical" else "high",
                          zone=alert.zone, assigned_employee_id=employee_id or suggested, alert_id=alert.id, shelf_id=alert.shelf_id, counter_id=alert.counter_id,
                          camera_id=alert.camera_id, due_in_minutes=15)
        task, created = TaskService(self.db).create_ex(store_id, body, source="recommendation", force_assign=bool(employee_id))
        self._decide(store_id, rec_id, "accepted", task.id)
        return {"success": True, "created": created, "task": task.model_dump(by_alias=True)}

    def reject(self, store_id: str, rec_id: str) -> Dict[str, Any]:
        self._decide(store_id, rec_id, "rejected", None)
        return {"success": True}

    def _decide(self, store_id: str, key: str, status: str, task_id: Optional[str]) -> None:
        row = self.db.get(RecommendationDecision, (store_id, key)) or RecommendationDecision(store_id=store_id, key=key, status=status)
        row.status, row.task_id, row.decided_at = status, task_id, now_utc()
        self.db.add(row)
        self.db.flush()
        event_bus.publish(store_id, "RECOMMENDATION_DECIDED", {"id": key, "status": status, "taskId": task_id})


class WorkloadService:
    def workload(self, db: Session, store_id: str) -> WorkloadOut:
        get_store_or_404(db, store_id)
        emps = list(db.scalars(select(Employee).where(Employee.store_id == store_id).where(Employee.is_active.is_(True))))
        counts: Dict[str, Dict[str, int]] = {}
        for emp_id, status, n in db.execute(select(Task.assigned_employee_id, Task.status, func.count()).where(Task.store_id == store_id)
                                            .where(Task.assigned_employee_id.is_not(None)).group_by(Task.assigned_employee_id, Task.status)).all():
            counts.setdefault(emp_id, {})[status] = int(n)
        employees = [{"employeeId": e.id, "name": e.name, "department": e.department, "assigned": counts.get(e.id, {}).get("assigned", 0),
                      "inProgress": counts.get(e.id, {}).get("in_progress", 0), "completed": counts.get(e.id, {}).get("completed", 0)} for e in emps]
        depts: Dict[str, Dict[str, Any]] = {}
        for r in employees:
            d = depts.setdefault(r["department"] or "Unassigned", {"department": r["department"] or "Unassigned", "employees": 0, "assignedTasks": 0, "completedTasks": 0})
            d["employees"] += 1
            d["assignedTasks"] += r["assigned"] + r["inProgress"]
            d["completedTasks"] += r["completed"]
        return WorkloadOut(store_id=store_id, departments=sorted(depts.values(), key=lambda d: d["department"]), employees=employees,
                           basis="counted from task records", meta=Meta(data_state="available" if emps else "empty", sources=["employees", "tasks"]))
