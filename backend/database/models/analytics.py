"""Phase 3 configuration + aggregate tables (camera-space zones, calibration, occupancy, visits, heatmaps, queue/shelf regions)."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, CheckConstraint, Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from database.base import Base, TimestampMixin, UTCDateTime, utcnow

ZONE_TYPES = ("entrance", "aisle", "category", "promotion", "checkout", "queue", "service", "other")


class CameraZone(TimestampMixin, Base):
    """A monitoring region in CAMERA space (normalised 0-1, top-left origin). Geometry lives here, never in inference code.

    `line` is an optional directed counting line {"p1":[x,y],"p2":[x,y],"inSide":"left"|"right","marginPx":..}:
    'inSide' names the side of p1->p2 (looking from p1 to p2) a customer is on AFTER entering the store.
    """

    __tablename__ = "camera_zones"
    __table_args__ = (
        CheckConstraint("zone_type IN ('entrance','aisle','category','promotion','checkout','queue','service','other')", name="zone_type"),
        Index("ix_camera_zones_camera_id", "camera_id"),
        Index("ix_camera_zones_store_id", "store_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    camera_id: Mapped[str] = mapped_column(ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False)
    store_zone_id: Mapped[Optional[str]] = mapped_column(ForeignKey("store_zones.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    zone_type: Mapped[str] = mapped_column(String(16), default="aisle", nullable=False)
    polygon: Mapped[list] = mapped_column(JSON, default=list)  # [[x,y], ...] normalised; may be empty for a pure line
    line: Mapped[Optional[dict]] = mapped_column(JSON)
    config: Mapped[dict] = mapped_column(JSON, default=dict)  # per-zone tuning (min dwell, exit grace, ...)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class CameraCalibration(TimestampMixin, Base):
    """Image->floor-plan homography from >=4 surveyed point pairs. Without a row, no floor-plan heatmap is produced."""

    __tablename__ = "camera_calibrations"

    camera_id: Mapped[str] = mapped_column(ForeignKey("cameras.id", ondelete="CASCADE"), primary_key=True)
    image_points: Mapped[list] = mapped_column(JSON, default=list)  # normalised [[x,y],...]
    floor_points: Mapped[list] = mapped_column(JSON, default=list)  # floor-plan units [[X,Y],...]
    homography: Mapped[list] = mapped_column(JSON, default=list)  # 3x3
    rmse: Mapped[Optional[float]] = mapped_column(Float)  # reprojection error, floor-plan units


class OccupancyState(Base):
    """Store-level occupancy ESTIMATE built from verified line crossings (one row per store)."""

    __tablename__ = "occupancy_state"
    __table_args__ = (CheckConstraint("status IN ('unknown','ok','uncertain','stale')", name="status"),)

    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), primary_key=True)
    estimate: Mapped[Optional[int]] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(10), default="unknown", nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(String(240))
    entries_since_reset: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    exits_since_reset: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    negative_clamps: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_event_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    last_reset_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    reset_reason: Mapped[Optional[str]] = mapped_column(String(160))
    camera_down_since: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)  # an entrance camera is offline since...
    camera_gap: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # crossings were missed since the baseline
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)


class ZoneVisit(Base):
    """One COMPLETE zone visit (entry and exit both observed). Anonymous: only a camera-local track reference."""

    __tablename__ = "zone_visits"
    __table_args__ = (
        CheckConstraint("dwell_seconds >= 0", name="dwell_nonneg"),
        Index("ix_zone_visits_zone_time", "camera_zone_id", "entered_at"),
        Index("ix_zone_visits_store_time", "store_id", "entered_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    camera_id: Mapped[str] = mapped_column(ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False)
    camera_zone_id: Mapped[str] = mapped_column(ForeignKey("camera_zones.id", ondelete="CASCADE"), nullable=False)
    store_zone_id: Mapped[Optional[str]] = mapped_column(ForeignKey("store_zones.id", ondelete="SET NULL"))
    track_ref: Mapped[int] = mapped_column(Integer, nullable=False)
    entered_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    exited_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    dwell_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    event_id: Mapped[Optional[str]] = mapped_column(String(40), unique=True)


class HeatmapCell(Base):
    """Hourly count of anonymous foot positions per camera-space grid cell."""

    __tablename__ = "heatmap_cells"
    __table_args__ = (
        UniqueConstraint("camera_id", "bucket_start", "gx", "gy", name="uq_heatmap_cell"),
        Index("ix_heatmap_cells_camera_bucket", "camera_id", "bucket_start"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    camera_id: Mapped[str] = mapped_column(ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False)
    bucket_start: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    grid_w: Mapped[int] = mapped_column(Integer, nullable=False)
    grid_h: Mapped[int] = mapped_column(Integer, nullable=False)
    gx: Mapped[int] = mapped_column(Integer, nullable=False)
    gy: Mapped[int] = mapped_column(Integer, nullable=False)
    count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class QueueRegion(TimestampMixin, Base):
    """Camera-space regions + thresholds for one checkout counter."""

    __tablename__ = "queue_regions"

    counter_id: Mapped[str] = mapped_column(ForeignKey("checkout_counters.id", ondelete="CASCADE"), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    camera_id: Mapped[str] = mapped_column(ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False)
    queue_polygon: Mapped[list] = mapped_column(JSON, default=list)
    service_polygon: Mapped[list] = mapped_column(JSON, default=list)
    priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # tie-break for overlapping queue polygons
    warning_length: Mapped[int] = mapped_column(Integer, default=4, nullable=False)
    critical_length: Mapped[int] = mapped_column(Integer, default=7, nullable=False)
    warning_wait_seconds: Mapped[float] = mapped_column(Float, default=180.0, nullable=False)
    critical_wait_seconds: Mapped[float] = mapped_column(Float, default=270.0, nullable=False)
    assumed_service_rate_per_min: Mapped[Optional[float]] = mapped_column(Float)  # explicit, labelled assumption (optional)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class QueueServiceSample(Base):
    """A measured service completion: a person left the service region after `service_seconds`."""

    __tablename__ = "queue_service_samples"
    __table_args__ = (Index("ix_queue_service_counter_time", "counter_id", "completed_at"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    counter_id: Mapped[str] = mapped_column(ForeignKey("checkout_counters.id", ondelete="CASCADE"), nullable=False)
    service_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    wait_seconds: Mapped[Optional[float]] = mapped_column(Float)  # measured queue wait of this person (ground truth for wait MAE)
    completed_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    event_id: Mapped[Optional[str]] = mapped_column(String(40), unique=True)


class ShelfRegion(TimestampMixin, Base):
    """Where a shelf is in its camera's image, which detector classes count for it, and its stock thresholds."""

    __tablename__ = "shelf_regions"

    shelf_id: Mapped[str] = mapped_column(ForeignKey("shelves.id", ondelete="CASCADE"), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    camera_id: Mapped[str] = mapped_column(ForeignKey("cameras.id", ondelete="CASCADE"), nullable=False)
    polygon: Mapped[list] = mapped_column(JSON, default=list)
    # detector class name -> product id (or category label); only these classes count toward the shelf.
    class_map: Mapped[dict] = mapped_column(JSON, default=dict)
    expected_visible_capacity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    low_stock_pct: Mapped[float] = mapped_column(Float, default=30.0, nullable=False)
    out_of_stock_pct: Mapped[float] = mapped_column(Float, default=5.0, nullable=False)
    confirm_observations: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    min_confidence: Mapped[float] = mapped_column(Float, default=0.4, nullable=False)
    interval_seconds: Mapped[float] = mapped_column(Float, default=15.0, nullable=False)
    slots: Mapped[list] = mapped_column(JSON, default=list)  # planogram slots in camera space: [{slotId, rect:[x,y,w,h], expectedClass}]
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class DomainEvent(Base):
    """Durable log of SIGNIFICANT events (crossings, alerts, camera loss...). Primary key = event id => durable dedupe."""

    __tablename__ = "domain_events"
    __table_args__ = (
        CheckConstraint("severity IN ('info','warning','critical')", name="severity"),
        Index("ix_domain_events_store_time", "store_id", "occurred_at"),
        Index("ix_domain_events_type_time", "event_type", "occurred_at"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    camera_id: Mapped[Optional[str]] = mapped_column(ForeignKey("cameras.id", ondelete="SET NULL"))
    event_type: Mapped[str] = mapped_column(String(48), nullable=False)
    severity: Mapped[str] = mapped_column(String(8), default="info", nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
