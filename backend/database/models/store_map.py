"""Indoor store map: a versioned floor plan, its walkable graph and where each shelf sits on it.

Routing only ever reads these rows, so every route (Customer PWA map, Copilot) is computed on the same geometry.
Product -> shelf comes from `shelf_products` (the planogram mapping Smart Inventory already uses); a shelf is placed on the
map by a `ShelfPlacement`, whose `access_node_id` is the walkable node a shopper stands on to reach it.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy import Boolean, CheckConstraint, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, false, true
from sqlalchemy.orm import Mapped, mapped_column

from database.base import Base, TimestampMixin


class StoreLayout(TimestampMixin, Base):
    __tablename__ = "store_layouts"
    __table_args__ = (UniqueConstraint("store_id", "version", name="uq_store_layouts_store_version"), Index("ix_store_layouts_store", "store_id"))

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    width: Mapped[float] = mapped_column(Float, nullable=False)
    height: Mapped[float] = mapped_column(Float, nullable=False)
    # Real-world scale used for walking distances shown to shoppers.
    meters_per_unit: Mapped[float] = mapped_column(Float, default=0.05, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true(), nullable=False)
    # True for the configured prototype floor plan (not a surveyed store drawing) - always labelled in the UI.
    is_prototype: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true(), nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text)


class MapNode(Base):
    __tablename__ = "map_nodes"
    __table_args__ = (
        CheckConstraint("node_type IN ('entrance','exit','checkout','help_desk','aisle','junction','shelf_access')", name="node_type"),
        Index("ix_map_nodes_layout", "layout_id"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    layout_id: Mapped[str] = mapped_column(ForeignKey("store_layouts.id", ondelete="CASCADE"), nullable=False)
    x: Mapped[float] = mapped_column(Float, nullable=False)
    y: Mapped[float] = mapped_column(Float, nullable=False)
    node_type: Mapped[str] = mapped_column(String(16), nullable=False)
    label: Mapped[Optional[str]] = mapped_column(String(160))
    zone_id: Mapped[Optional[str]] = mapped_column(ForeignKey("store_zones.id", ondelete="SET NULL"))
    # Offered to shoppers as a "start from here" location.
    is_start_point: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)


class MapEdge(Base):
    """Undirected walkable segment. `label` names the walkway ("Main Aisle") and drives the turn-by-turn text."""

    __tablename__ = "map_edges"
    __table_args__ = (
        CheckConstraint("distance > 0", name="distance_positive"),
        UniqueConstraint("layout_id", "source_node_id", "target_node_id", name="uq_map_edges_pair"),
        Index("ix_map_edges_layout", "layout_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    layout_id: Mapped[str] = mapped_column(ForeignKey("store_layouts.id", ondelete="CASCADE"), nullable=False)
    source_node_id: Mapped[str] = mapped_column(ForeignKey("map_nodes.id", ondelete="CASCADE"), nullable=False)
    target_node_id: Mapped[str] = mapped_column(ForeignKey("map_nodes.id", ondelete="CASCADE"), nullable=False)
    distance: Mapped[float] = mapped_column(Float, nullable=False)
    walkable: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true(), nullable=False)
    label: Mapped[Optional[str]] = mapped_column(String(160))


class ShelfPlacement(Base):
    """Where a shelf block is drawn on a layout and which walkable node gives access to it."""

    __tablename__ = "shelf_placements"
    __table_args__ = (UniqueConstraint("layout_id", "shelf_id", name="uq_shelf_placements_layout_shelf"), Index("ix_shelf_placements_layout", "layout_id"))

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    layout_id: Mapped[str] = mapped_column(ForeignKey("store_layouts.id", ondelete="CASCADE"), nullable=False)
    shelf_id: Mapped[str] = mapped_column(ForeignKey("shelves.id", ondelete="CASCADE"), nullable=False)
    x: Mapped[float] = mapped_column(Float, nullable=False)
    y: Mapped[float] = mapped_column(Float, nullable=False)
    width: Mapped[float] = mapped_column(Float, nullable=False)
    height: Mapped[float] = mapped_column(Float, nullable=False)
    access_node_id: Mapped[str] = mapped_column(ForeignKey("map_nodes.id", ondelete="RESTRICT"), nullable=False)
    # Which side of the walkway the shelf faces from the access node ('left'/'right' of the walkway's west->east or north->south run).
    face: Mapped[Optional[str]] = mapped_column(String(8))
