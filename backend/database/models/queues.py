from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, CheckConstraint, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from database.base import Base, TimestampMixin, UTCDateTime, utcnow


class CheckoutCounter(TimestampMixin, Base):
    __tablename__ = "checkout_counters"
    __table_args__ = (
        CheckConstraint("counter_type IN ('express','standard','self_checkout')", name="counter_type"),
        CheckConstraint("status IN ('open','closed','standby','paused')", name="status"),
        Index("ix_checkout_counters_store_id", "store_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    counter_type: Mapped[str] = mapped_column(String(16), default="standard", nullable=False)
    status: Mapped[str] = mapped_column(String(10), default="closed", nullable=False)
    cashier_employee_id: Mapped[Optional[str]] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"))
    camera_id: Mapped[Optional[str]] = mapped_column(ForeignKey("cameras.id", ondelete="SET NULL"))
    service_rate_per_min: Mapped[Optional[float]] = mapped_column(Float)


class QueueObservation(Base):
    __tablename__ = "queue_observations"
    __table_args__ = (
        CheckConstraint("queue_length >= 0", name="length_nonneg"),
        Index("ix_queue_observations_counter_time", "counter_id", "observed_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    counter_id: Mapped[str] = mapped_column(ForeignKey("checkout_counters.id", ondelete="CASCADE"), nullable=False)
    queue_length: Mapped[int] = mapped_column(Integer, nullable=False)
    estimated_wait_seconds: Mapped[Optional[float]] = mapped_column(Float)
    avg_items_per_customer: Mapped[Optional[float]] = mapped_column(Float)
    # Phase 3 (all measured or explicitly labelled):
    camera_id: Mapped[Optional[str]] = mapped_column(String(64))
    arrival_rate_per_min: Mapped[Optional[float]] = mapped_column(Float)
    service_rate_per_min: Mapped[Optional[float]] = mapped_column(Float)
    wait_basis: Mapped[Optional[str]] = mapped_column(String(16))  # measured | assumption | unavailable
    congestion: Mapped[Optional[str]] = mapped_column(String(10))
    in_service: Mapped[Optional[int]] = mapped_column(Integer)
    observed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    source: Mapped[str] = mapped_column(String(16), default="cv", nullable=False)


class QueueForecast(Base):
    __tablename__ = "queue_forecasts"
    __table_args__ = (Index("ix_queue_forecasts_counter_time", "counter_id", "generated_at"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    counter_id: Mapped[str] = mapped_column(ForeignKey("checkout_counters.id", ondelete="CASCADE"), nullable=False)
    horizon_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    predicted_length: Mapped[float] = mapped_column(Float, nullable=False)
    confidence: Mapped[Optional[float]] = mapped_column(Float)
    forecast_for: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    predicted_wait_seconds: Mapped[Optional[float]] = mapped_column(Float)
    congestion_risk: Mapped[Optional[str]] = mapped_column(String(10))
    model_version: Mapped[Optional[str]] = mapped_column(String(32))
    inputs: Mapped[Optional[dict]] = mapped_column(JSON)
    generated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    source: Mapped[str] = mapped_column(String(16), default="cv", nullable=False)


class QueueRules(TimestampMixin, Base):
    """Per-store SLA / congestion thresholds (PUT /queue/rules)."""

    __tablename__ = "queue_rules"

    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), primary_key=True)
    config: Mapped[dict] = mapped_column(JSON, default=dict)
