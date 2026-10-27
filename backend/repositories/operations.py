from __future__ import annotations

from datetime import date
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from database.models import Alert, Attendance, Employee, Product, Shelf, Shift, Task, TaskHistory


class AlertRepository:
    def __init__(self, db: Session):
        self.db = db

    def list(
        self,
        store_id: str,
        status: Optional[str] = None,
        severity: Optional[str] = None,
        module: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> Tuple[Sequence[Alert], int]:
        stmt = select(Alert).where(Alert.store_id == store_id)
        if status:
            stmt = stmt.where(Alert.status == status)
        if severity:
            stmt = stmt.where(Alert.severity == severity)
        if module:
            stmt = stmt.where(Alert.module == module)
        total = self.db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        severity_rank = case((Alert.severity == "critical", 0), (Alert.severity == "warning", 1), else_=2)
        rows = self.db.scalars(stmt.order_by(Alert.status == "resolved", severity_rank, Alert.created_at.desc()).limit(limit).offset(offset)).all()
        return rows, total

    def counts(self, store_id: str) -> Dict[str, int]:
        rows = self.db.execute(select(Alert.status, func.count()).where(Alert.store_id == store_id).group_by(Alert.status)).all()
        return {r[0]: r[1] for r in rows}


class TaskRepository:
    def __init__(self, db: Session):
        self.db = db

    def list(
        self,
        store_id: str,
        status: Optional[str] = None,
        priority: Optional[str] = None,
        employee_id: Optional[str] = None,
        category: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> Tuple[Sequence[Task], int]:
        stmt = select(Task).where(Task.store_id == store_id)
        if status:
            stmt = stmt.where(Task.status == status)
        if priority:
            stmt = stmt.where(Task.priority == priority)
        if employee_id:
            stmt = stmt.where(Task.assigned_employee_id == employee_id)
        if category:
            stmt = stmt.where(Task.category == category)
        total = self.db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        prio_rank = case((Task.priority == "critical", 0), (Task.priority == "high", 1), (Task.priority == "medium", 2), else_=3)
        rows = self.db.scalars(stmt.order_by(Task.status == "completed", prio_rank, Task.created_at.desc()).limit(limit).offset(offset)).all()
        return rows, total

    def for_employee(self, employee_id: str, store_id: Optional[str] = None, include_unassigned: bool = True) -> Sequence[Task]:
        cond = Task.assigned_employee_id == employee_id
        if include_unassigned:
            cond = cond | (Task.assigned_employee_id.is_(None) & Task.status.in_(("new", "assigned")))
        stmt = select(Task).where(cond)
        if store_id:
            stmt = stmt.where(Task.store_id == store_id)
        return self.db.scalars(stmt.order_by(Task.created_at.desc())).all()

    def history(self, task_id: str) -> Sequence[TaskHistory]:
        return self.db.scalars(select(TaskHistory).where(TaskHistory.task_id == task_id).order_by(TaskHistory.id)).all()

    def lookups(self, tasks: Sequence[Task]) -> Tuple[Dict[str, Employee], Dict[str, Shelf], Dict[str, Product]]:
        emp_ids = {t.assigned_employee_id for t in tasks if t.assigned_employee_id}
        shelf_ids = {t.shelf_id for t in tasks if t.shelf_id}
        product_ids = {t.product_id for t in tasks if t.product_id}
        emps = {e.id: e for e in self.db.scalars(select(Employee).where(Employee.id.in_(emp_ids))).all()} if emp_ids else {}
        shelves = {s.id: s for s in self.db.scalars(select(Shelf).where(Shelf.id.in_(shelf_ids))).all()} if shelf_ids else {}
        products = {p.id: p for p in self.db.scalars(select(Product).where(Product.id.in_(product_ids))).all()} if product_ids else {}
        return emps, shelves, products

    def open_count(self, store_id: str) -> int:
        return self.db.scalar(
            select(func.count()).select_from(Task).where(Task.store_id == store_id).where(Task.status.in_(("new", "assigned", "in_progress")))
        ) or 0


class EmployeeRepository:
    def __init__(self, db: Session):
        self.db = db

    def list(self, store_id: str, include_inactive: bool = False) -> Sequence[Employee]:
        stmt = select(Employee).where(Employee.store_id == store_id).order_by(Employee.name)
        if not include_inactive:
            stmt = stmt.where(Employee.is_active.is_(True))
        return self.db.scalars(stmt).all()

    def task_counts(self, store_id: str) -> Dict[str, Tuple[int, int]]:
        rows = self.db.execute(
            select(
                Task.assigned_employee_id,
                func.sum(case((Task.status.in_(("assigned", "in_progress")), 1), else_=0)),
                func.sum(case((Task.status == "completed", 1), else_=0)),
            )
            .where(Task.store_id == store_id)
            .where(Task.assigned_employee_id.is_not(None))
            .group_by(Task.assigned_employee_id)
        ).all()
        return {r[0]: (int(r[1] or 0), int(r[2] or 0)) for r in rows}

    def next_id(self, store_id: str) -> str:
        count = self.db.scalar(select(func.count()).select_from(Employee).where(Employee.store_id == store_id)) or 0
        candidate = count + 1
        while self.db.get(Employee, f"STF-{candidate:02d}") is not None:
            candidate += 1
        return f"STF-{candidate:02d}"

    def shifts(self, employee_id: str, from_date: date) -> Sequence[Shift]:
        return self.db.scalars(
            select(Shift).where(Shift.employee_id == employee_id).where(Shift.shift_date >= from_date).order_by(Shift.shift_date)
        ).all()

    def attendance(self, employee_id: str, limit: int = 30) -> Sequence[Attendance]:
        return self.db.scalars(
            select(Attendance).where(Attendance.employee_id == employee_id).order_by(Attendance.work_date.desc(), Attendance.actual_in.desc()).limit(limit)
        ).all()

    def attendance_today(self, store_id: str, today: date) -> Sequence[Attendance]:
        return self.db.scalars(select(Attendance).where(Attendance.store_id == store_id).where(Attendance.work_date == today)).all()
