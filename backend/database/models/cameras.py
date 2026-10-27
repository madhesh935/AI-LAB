from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from database.base import Base, TimestampMixin, UTCDateTime

CAMERA_TYPES = ("entrance", "shelf", "checkout", "aisle")
CAMERA_STATES = ("live", "offline", "connecting", "buffering", "reconnecting", "error", "unknown")


class Camera(TimestampMixin, Base):
    __tablename__ = "cameras"
    __table_args__ = (
        UniqueConstraint("store_id", "camera_code", name="uq_cameras_store_code"),
        CheckConstraint("camera_type IN ('entrance','shelf','checkout','aisle')", name="camera_type"),
        CheckConstraint("source_type IN ('unconfigured','usb','rtsp','http','file')", name="source_type"),
        Index("ix_cameras_store_id", "store_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    camera_code: Mapped[str] = mapped_column(String(48), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    camera_type: Mapped[str] = mapped_column(String(16), nullable=False)
    zone_id: Mapped[Optional[str]] = mapped_column(ForeignKey("store_zones.id", ondelete="SET NULL"))
    resolution: Mapped[Optional[str]] = mapped_column(String(32))
    target_fps: Mapped[int] = mapped_column(Integer, default=25)
    # Stream endpoint & credentials stay server-side and are never serialised to clients.
    stream_type: Mapped[str] = mapped_column(String(16), default="placeholder", nullable=False)
    stream_url: Mapped[Optional[str]] = mapped_column(Text)
    # Phase 2: how frames are obtained. source_ref (device index / RTSP URL with credentials /
    # file path) is backend-managed and NEVER serialised to clients.
    source_type: Mapped[str] = mapped_column(String(12), default="unconfigured", nullable=False)
    source_ref: Mapped[Optional[str]] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # prerecorded footage
    ai_module: Mapped[Optional[str]] = mapped_column(String(48))
    purpose: Mapped[Optional[str]] = mapped_column(String(48))
    config: Mapped[dict] = mapped_column(JSON, default=dict)  # counting lines / ROI polygons


class CameraStatus(Base):
    """Latest known connectivity state; one row per camera."""

    __tablename__ = "camera_status"

    camera_id: Mapped[str] = mapped_column(ForeignKey("cameras.id", ondelete="CASCADE"), primary_key=True)
    state: Mapped[str] = mapped_column(String(16), default="unknown", nullable=False)
    fps: Mapped[Optional[float]] = mapped_column()
    latency_ms: Mapped[Optional[float]] = mapped_column()
    packet_loss_pct: Mapped[Optional[float]] = mapped_column()
    # Measured by the vision worker (never invented):
    input_fps: Mapped[Optional[float]] = mapped_column()
    inference_fps: Mapped[Optional[float]] = mapped_column()
    inference_ms: Mapped[Optional[float]] = mapped_column()
    frame_width: Mapped[Optional[int]] = mapped_column(Integer)
    frame_height: Mapped[Optional[int]] = mapped_column(Integer)
    error_code: Mapped[Optional[str]] = mapped_column(String(40))
    last_inference_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    last_frame_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    last_checked_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    message: Mapped[Optional[str]] = mapped_column(String(240))


class CameraZoneMapping(Base):
    __tablename__ = "camera_zone_mapping"

    camera_id: Mapped[str] = mapped_column(ForeignKey("cameras.id", ondelete="CASCADE"), primary_key=True)
    zone_id: Mapped[str] = mapped_column(ForeignKey("store_zones.id", ondelete="CASCADE"), primary_key=True)


class CameraStatusEvent(Base):
    """One row per connection-state *transition* (not per frame)."""

    __tablename__ = "camera_status_events"
    __table_args__ = (Index("ix_camera_status_events_camera_time", "camera_id", "occurred_at"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    camera_id: Mapped[str] = mapped_column(ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False)
    from_state: Mapped[Optional[str]] = mapped_column(String(16))
    to_state: Mapped[str] = mapped_column(String(16), nullable=False)
    message: Mapped[Optional[str]] = mapped_column(String(240))
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
