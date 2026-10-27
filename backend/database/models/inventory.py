from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, CheckConstraint, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, true
from sqlalchemy.orm import Mapped, mapped_column

from database.base import Base, TimestampMixin, UTCDateTime, utcnow


class Product(TimestampMixin, Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("store_id", "sku", name="uq_products_store_sku"),
        Index("ix_products_store_id", "store_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    sku: Mapped[str] = mapped_column(String(48), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String(80))
    department: Mapped[Optional[str]] = mapped_column(String(80))
    unit: Mapped[Optional[str]] = mapped_column(String(32))
    price: Mapped[Optional[float]] = mapped_column(Float)
    image_url: Mapped[Optional[str]] = mapped_column(String(300))
    # Back-of-store (ERP / POS) quantity. Distinct from the camera-visible shelf count.
    stockroom_qty: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Customer catalogue fields (Phase 5).
    brand: Mapped[Optional[str]] = mapped_column(String(80))
    description: Mapped[Optional[str]] = mapped_column(Text)
    # Space/comma separated aliases shoppers type ("doodh, milk, dairy").
    search_keywords: Mapped[Optional[str]] = mapped_column(Text)
    # False hides the product from the Customer PWA without deleting inventory history.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true(), nullable=False)


class Shelf(TimestampMixin, Base):
    __tablename__ = "shelves"
    __table_args__ = (
        UniqueConstraint("store_id", "shelf_code", name="uq_shelves_store_code"),
        Index("ix_shelves_store_id", "store_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    shelf_code: Mapped[str] = mapped_column(String(64), nullable=False)
    department: Mapped[Optional[str]] = mapped_column(String(80))
    category: Mapped[Optional[str]] = mapped_column(String(120))
    aisle_location: Mapped[Optional[str]] = mapped_column(String(160))
    tier_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    capacity_units: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    zone_id: Mapped[Optional[str]] = mapped_column(ForeignKey("store_zones.id", ondelete="SET NULL"))
    camera_id: Mapped[Optional[str]] = mapped_column(ForeignKey("cameras.id", ondelete="SET NULL"))


class ShelfProduct(Base):
    """Which product(s) are planned on a shelf and how many facings are expected."""

    __tablename__ = "shelf_products"
    __table_args__ = (
        UniqueConstraint("shelf_id", "product_id", name="uq_shelf_products_pair"),
        CheckConstraint("expected_units >= 0", name="expected_nonneg"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    shelf_id: Mapped[str] = mapped_column(ForeignKey("shelves.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    expected_units: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tier: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class ShelfObservation(Base):
    """Camera-observed visible stock. Written by inference (or the demo seed)."""

    __tablename__ = "shelf_observations"
    __table_args__ = (
        CheckConstraint("detected_units >= 0", name="detected_nonneg"),
        Index("ix_shelf_observations_shelf_time", "shelf_id", "observed_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    shelf_id: Mapped[str] = mapped_column(ForeignKey("shelves.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[Optional[str]] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"))
    detected_units: Mapped[int] = mapped_column(Integer, nullable=False)
    confidence: Mapped[Optional[float]] = mapped_column(Float)
    planogram_compliance_pct: Mapped[Optional[float]] = mapped_column(Float)
    # Phase 3: model-backed observation details.
    camera_id: Mapped[Optional[str]] = mapped_column(String(64))
    status: Mapped[Optional[str]] = mapped_column(String(16))  # in_stock|low_stock|out_of_stock|uncertain|camera_offline
    availability_pct: Mapped[Optional[float]] = mapped_column(Float)
    expected_units: Mapped[Optional[int]] = mapped_column(Integer)
    model_id: Mapped[Optional[str]] = mapped_column(String(64))
    evidence: Mapped[Optional[dict]] = mapped_column(JSON)
    observed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    source: Mapped[str] = mapped_column(String(16), default="cv", nullable=False)


class Planogram(TimestampMixin, Base):
    __tablename__ = "planograms"
    __table_args__ = (UniqueConstraint("shelf_id", "version", name="uq_planograms_shelf_version"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    shelf_id: Mapped[str] = mapped_column(ForeignKey("shelves.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    # [{slotId, tier, position, expectedProductId, ...}] - the planned layout.
    slots: Mapped[list] = mapped_column(JSON, default=list)
    last_verified_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
