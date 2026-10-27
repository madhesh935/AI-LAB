from __future__ import annotations

from typing import List, Optional

from sqlalchemy import JSON, Boolean, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database.base import Base, TimestampMixin


class Store(TimestampMixin, Base):
    __tablename__ = "stores"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    branch: Mapped[Optional[str]] = mapped_column(String(160))
    address: Mapped[Optional[str]] = mapped_column(Text)
    city: Mapped[Optional[str]] = mapped_column(String(80))
    region: Mapped[Optional[str]] = mapped_column(String(80))
    phone: Mapped[Optional[str]] = mapped_column(String(32))
    manager_name: Mapped[Optional[str]] = mapped_column(String(120))
    square_footage: Mapped[Optional[int]] = mapped_column(Integer)
    max_capacity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    open_time: Mapped[Optional[str]] = mapped_column(String(8))
    close_time: Mapped[Optional[str]] = mapped_column(String(8))
    operating_hours_label: Mapped[Optional[str]] = mapped_column(String(80))
    timezone: Mapped[str] = mapped_column(String(48), default="Asia/Kolkata", nullable=False)
    map_width: Mapped[int] = mapped_column(Integer, default=800, nullable=False)
    map_height: Mapped[int] = mapped_column(Integer, default=600, nullable=False)
    is_open: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Edge server / AI pipeline link state. 'disconnected' until inference reports in.
    edge_server_status: Mapped[str] = mapped_column(String(16), default="disconnected", nullable=False)
    # Phase 4: 'demo' stores hold seeded fixtures (every child row is tagged source='demo'); 'real' stores only ever hold measured/manual data.
    data_mode: Mapped[str] = mapped_column(String(8), default="real", nullable=False)

    zones: Mapped[List["StoreZone"]] = relationship(back_populates="store", cascade="all, delete-orphan")


class StoreZone(Base):
    __tablename__ = "store_zones"
    __table_args__ = (Index("ix_store_zones_store_id", "store_id"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    zone_type: Mapped[str] = mapped_column(String(32), default="aisle", nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String(80))
    aisle_number: Mapped[Optional[int]] = mapped_column(Integer)
    x: Mapped[float] = mapped_column(default=0.0)
    y: Mapped[float] = mapped_column(default=0.0)
    width: Mapped[float] = mapped_column(default=0.0)
    height: Mapped[float] = mapped_column(default=0.0)
    color: Mapped[Optional[str]] = mapped_column(String(16))
    capacity_limit: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    shelf_codes: Mapped[list] = mapped_column(JSON, default=list)
    description: Mapped[Optional[str]] = mapped_column(Text)

    store: Mapped[Store] = relationship(back_populates="zones")
