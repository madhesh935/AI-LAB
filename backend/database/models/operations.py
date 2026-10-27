from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, CheckConstraint, Date, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from database.base import Base, TimestampMixin, UTCDateTime, utcnow

TASK_STATUSES = ("new", "assigned", "in_progress", "completed", "cancelled")
TASK_PRIORITIES = ("critical", "high", "medium", "low")
ALERT_STATUSES = ("active", "acknowledged", "resolved")
ALERT_SEVERITIES = ("critical", "warning", "info")


class Employee(TimestampMixin, Base):
    """Interface context only. There is no authentication; this is not verified identity."""

    __tablename__ = "employees"
    __table_args__ = (Index("ix_employees_store_id", "store_id"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    role: Mapped[str] = mapped_column(String(48), nullable=False)
    role_label: Mapped[Optional[str]] = mapped_column(String(120))
    department: Mapped[Optional[str]] = mapped_column(String(80))
    email: Mapped[Optional[str]] = mapped_column(String(160))
    phone: Mapped[Optional[str]] = mapped_column(String(32))
    assigned_zone: Mapped[Optional[str]] = mapped_column(String(160))
    availability: Mapped[str] = mapped_column(String(16), default="available", nullable=False)
    skills: Mapped[list] = mapped_column(JSON, default=list)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(300))
    joined_date: Mapped[Optional[date]] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Shift(Base):
    __tablename__ = "shifts"
    __table_args__ = (
        UniqueConstraint("employee_id", "shift_date", "shift_name", name="uq_shifts_employee_day_name"),
        Index("ix_shifts_store_date", "store_id", "shift_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), nullable=False)
    shift_date: Mapped[date] = mapped_column(Date, nullable=False)
    shift_name: Mapped[str] = mapped_column(String(48), nullable=False)
    start_time: Mapped[Optional[str]] = mapped_column(String(8))
    end_time: Mapped[Optional[str]] = mapped_column(String(8))
    break_time: Mapped[Optional[str]] = mapped_column(String(48))
    zone: Mapped[Optional[str]] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(16), default="confirmed", nullable=False)


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (
        Index("ix_attendance_employee_date", "employee_id", "work_date"),
        CheckConstraint("status IN ('scheduled','present','late','absent','completed','on_leave')", name="status"),
    )

    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    employee_id: Mapped[str] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), nullable=False)
    work_date: Mapped[date] = mapped_column(Date, nullable=False)
    shift_name: Mapped[Optional[str]] = mapped_column(String(80))
    scheduled_in: Mapped[Optional[str]] = mapped_column(String(16))
    scheduled_out: Mapped[Optional[str]] = mapped_column(String(16))
    actual_in: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    actual_out: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    status: Mapped[str] = mapped_column(String(12), default="scheduled", nullable=False)
    hours_worked: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    override_reason: Mapped[Optional[str]] = mapped_column(String(300))
    source: Mapped[str] = mapped_column(String(12), default="self", nullable=False)  # self | supervisor (a demo context, not verified identity)
    recorded_by: Mapped[Optional[str]] = mapped_column(String(32))


class Alert(Base):
    __tablename__ = "alerts"
    __table_args__ = (
        CheckConstraint("severity IN ('critical','warning','info')", name="severity"),
        CheckConstraint("status IN ('active','acknowledged','resolved')", name="status"),
        Index("ix_alerts_store_status", "store_id", "status"),
        Index("ix_alerts_store_created", "store_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    module: Mapped[str] = mapped_column(String(32), default="overview", nullable=False)  # inventory|queue|camera|shopper
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    severity: Mapped[str] = mapped_column(String(8), default="info", nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    zone: Mapped[Optional[str]] = mapped_column(String(160))
    camera_id: Mapped[Optional[str]] = mapped_column(ForeignKey("cameras.id", ondelete="SET NULL"))
    shelf_id: Mapped[Optional[str]] = mapped_column(ForeignKey("shelves.id", ondelete="SET NULL"))
    counter_id: Mapped[Optional[str]] = mapped_column(ForeignKey("checkout_counters.id", ondelete="SET NULL"))
    task_id: Mapped[Optional[str]] = mapped_column(String(48))
    recommended_action: Mapped[Optional[str]] = mapped_column(Text)
    evidence: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(14), default="active", nullable=False)
    acknowledged_by: Mapped[Optional[str]] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    source: Mapped[str] = mapped_column(String(16), default="system", nullable=False)
    # Phase 3 lifecycle: one open alert per dedupe key; repeats bump occurrences instead of creating rows.
    dedupe_key: Mapped[Optional[str]] = mapped_column(String(160), index=True)
    occurrences: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)


class Task(TimestampMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("status IN ('new','assigned','in_progress','completed','cancelled')", name="status"),
        CheckConstraint("priority IN ('critical','high','medium','low')", name="priority"),
        Index("ix_tasks_store_status", "store_id", "status"),
        Index("ix_tasks_assignee", "assigned_employee_id"),
    )

    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(40), default="general", nullable=False)
    priority: Mapped[str] = mapped_column(String(8), default="medium", nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="new", nullable=False)
    zone: Mapped[Optional[str]] = mapped_column(String(160))
    assigned_employee_id: Mapped[Optional[str]] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"))
    shelf_id: Mapped[Optional[str]] = mapped_column(ForeignKey("shelves.id", ondelete="SET NULL"))
    product_id: Mapped[Optional[str]] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"))
    alert_id: Mapped[Optional[str]] = mapped_column(ForeignKey("alerts.id", ondelete="SET NULL"))
    quantity: Mapped[Optional[int]] = mapped_column(Integer)
    due_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    completed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    completion_notes: Mapped[Optional[str]] = mapped_column(Text)
    has_photo_evidence: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    camera_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    camera_verified_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    # Phase 4: the single task engine links every module's work to the thing it is about.
    counter_id: Mapped[Optional[str]] = mapped_column(ForeignKey("checkout_counters.id", ondelete="SET NULL"))
    camera_id: Mapped[Optional[str]] = mapped_column(ForeignKey("cameras.id", ondelete="SET NULL"))
    customer_request_id: Mapped[Optional[str]] = mapped_column(String(32), index=True)
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(80), unique=True)
    issue_reported: Mapped[Optional[str]] = mapped_column(Text)
    notes: Mapped[Optional[str]] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(16), default="manual", nullable=False)


class TaskHistory(Base):
    __tablename__ = "task_history"
    __table_args__ = (Index("ix_task_history_task", "task_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    from_status: Mapped[Optional[str]] = mapped_column(String(12))
    to_status: Mapped[str] = mapped_column(String(12), nullable=False)
    actor_employee_id: Mapped[Optional[str]] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"))
    note: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
