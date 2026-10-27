"""Registry of AI models and the inference results they push into the platform."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, CheckConstraint, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from database.base import Base, TimestampMixin, UTCDateTime, utcnow


MODEL_STATUSES = ("NOT_CONFIGURED", "LOADING", "READY", "ERROR", "DISABLED")


class ModelRegistry(TimestampMixin, Base):
    __tablename__ = "model_registry"
    __table_args__ = (
        CheckConstraint("status IN ('NOT_CONFIGURED','LOADING','READY','ERROR','DISABLED')", name="status"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    task: Mapped[str] = mapped_column(String(48), nullable=False)  # person_detection, shelf_gap, queue_count ...
    artifact_path: Mapped[Optional[str]] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(16), default="NOT_CONFIGURED", nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(String(400))
    runtime: Mapped[Optional[str]] = mapped_column(String(32))  # ultralytics | onnxruntime
    input_size: Mapped[Optional[int]] = mapped_column(Integer)
    labels: Mapped[list] = mapped_column(JSON, default=list)
    confidence_threshold: Mapped[Optional[float]] = mapped_column(Float)
    device: Mapped[Optional[str]] = mapped_column(String(16))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    license: Mapped[Optional[str]] = mapped_column(String(80))
    sha256: Mapped[Optional[str]] = mapped_column(String(64))
    last_error: Mapped[Optional[str]] = mapped_column(String(400))
    loaded_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)


class InferenceEvent(Base):
    """A single structured observation reported by an inference worker.

    Raw frames are never stored; only the structured result.
    """

    __tablename__ = "inference_events"
    __table_args__ = (Index("ix_inference_events_store_time", "store_id", "observed_at"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    camera_id: Mapped[Optional[str]] = mapped_column(ForeignKey("cameras.id", ondelete="SET NULL"))
    model_id: Mapped[Optional[str]] = mapped_column(ForeignKey("model_registry.id", ondelete="SET NULL"))
    event_type: Mapped[str] = mapped_column(String(48), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    confidence: Mapped[Optional[float]] = mapped_column()
    observed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    source: Mapped[str] = mapped_column(String(16), default="cv", nullable=False)


class ModelHealth(Base):
    __tablename__ = "model_health"
    __table_args__ = (Index("ix_model_health_model_time", "model_id", "checked_at"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    model_id: Mapped[str] = mapped_column(ForeignKey("model_registry.id", ondelete="CASCADE"), nullable=False)
    store_id: Mapped[Optional[str]] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(16), default="unknown", nullable=False)
    latency_ms: Mapped[Optional[float]] = mapped_column()
    fps: Mapped[Optional[float]] = mapped_column()
    checked_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
