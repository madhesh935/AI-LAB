from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from database.base import Base, UTCDateTime, utcnow


class FootfallEvent(Base):
    __tablename__ = "footfall_events"
    __table_args__ = (
        CheckConstraint("direction IN ('in','out')", name="direction"),
        CheckConstraint("count >= 0", name="count_nonneg"),
        Index("ix_footfall_events_store_time", "store_id", "observed_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    camera_id: Mapped[Optional[str]] = mapped_column(ForeignKey("cameras.id", ondelete="SET NULL"))
    direction: Mapped[str] = mapped_column(String(3), nullable=False)
    count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    observed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    source: Mapped[str] = mapped_column(String(16), default="cv", nullable=False)
    # Phase 3: which counting line produced the crossing, and the worker event id (durable dedupe).
    line_id: Mapped[Optional[str]] = mapped_column(String(64))
    event_id: Mapped[Optional[str]] = mapped_column(String(40), unique=True)


class FootfallAggregate(Base):
    __tablename__ = "footfall_aggregates"
    __table_args__ = (
        UniqueConstraint("store_id", "bucket_start", "bucket_minutes", name="uq_footfall_agg_bucket"),
        Index("ix_footfall_aggregates_store_bucket", "store_id", "bucket_start"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    bucket_start: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    bucket_minutes: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    entries: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    exits: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    peak_occupancy: Mapped[Optional[int]] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(16), default="cv", nullable=False)


class ZoneOccupancy(Base):
    __tablename__ = "zone_occupancy"
    __table_args__ = (Index("ix_zone_occupancy_store_zone_time", "store_id", "zone_id", "observed_at"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    zone_id: Mapped[str] = mapped_column(ForeignKey("store_zones.id", ondelete="CASCADE"), nullable=False)
    count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    observed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    source: Mapped[str] = mapped_column(String(16), default="cv", nullable=False)


class DwellTimeAggregate(Base):
    __tablename__ = "dwell_time_aggregates"
    __table_args__ = (
        UniqueConstraint("store_id", "zone_id", "bucket_start", name="uq_dwell_bucket"),
        Index("ix_dwell_time_aggregates_store_bucket", "store_id", "bucket_start"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    zone_id: Mapped[str] = mapped_column(ForeignKey("store_zones.id", ondelete="CASCADE"), nullable=False)
    bucket_start: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    visitors: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    avg_dwell_seconds: Mapped[float] = mapped_column(default=0.0, nullable=False)
    source: Mapped[str] = mapped_column(String(16), default="cv", nullable=False)


class MovementAggregate(Base):
    __tablename__ = "movement_aggregates"
    __table_args__ = (
        UniqueConstraint("store_id", "from_zone_id", "to_zone_id", "bucket_start", name="uq_movement_bucket"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    from_zone_id: Mapped[str] = mapped_column(ForeignKey("store_zones.id", ondelete="CASCADE"), nullable=False)
    to_zone_id: Mapped[str] = mapped_column(ForeignKey("store_zones.id", ondelete="CASCADE"), nullable=False)
    bucket_start: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    transitions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    source: Mapped[str] = mapped_column(String(16), default="cv", nullable=False)
