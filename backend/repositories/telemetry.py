"""Read-side queries over observation / configuration tables (cameras, shoppers,
inventory, queues). No business rules live here, only data access."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database.models import (
    Camera,
    CameraStatus,
    CheckoutCounter,
    DwellTimeAggregate,
    Employee,
    FootfallAggregate,
    FootfallEvent,
    InferenceEvent,
    MovementAggregate,
    Planogram,
    Product,
    QueueForecast,
    QueueObservation,
    QueueRules,
    Shelf,
    ShelfObservation,
    ShelfProduct,
    StoreZone,
    ZoneOccupancy,
)


# ----------------------------------------------------------------- cameras
class CameraRepository:
    def __init__(self, db: Session):
        self.db = db

    def list_with_status(self, store_id: str) -> List[Tuple[Camera, Optional[CameraStatus], Optional[StoreZone]]]:
        stmt = (
            select(Camera, CameraStatus, StoreZone)
            .outerjoin(CameraStatus, CameraStatus.camera_id == Camera.id)
            .outerjoin(StoreZone, StoreZone.id == Camera.zone_id)
            .where(Camera.store_id == store_id)
            .order_by(Camera.camera_code)
        )
        return [tuple(r) for r in self.db.execute(stmt).all()]

    def last_inference_at(self, store_id: str) -> Optional[datetime]:
        return self.db.scalar(select(func.max(InferenceEvent.observed_at)).where(InferenceEvent.store_id == store_id))


# ---------------------------------------------------------------- shoppers
class ShopperRepository:
    def __init__(self, db: Session):
        self.db = db

    def zones(self, store_id: str) -> Sequence[StoreZone]:
        return self.db.scalars(select(StoreZone).where(StoreZone.store_id == store_id).order_by(StoreZone.id)).all()

    def hourly(self, store_id: str, start: datetime, end: datetime) -> Dict[datetime, Tuple[int, int]]:
        """{bucket_start_utc: (entries, exits)} from aggregates, else from raw events."""
        rows = self.db.execute(
            select(FootfallAggregate.bucket_start, FootfallAggregate.entries, FootfallAggregate.exits)
            .where(FootfallAggregate.store_id == store_id)
            .where(FootfallAggregate.bucket_minutes == 60)
            .where(FootfallAggregate.bucket_start >= start)
            .where(FootfallAggregate.bucket_start < end)
        ).all()
        result: Dict[datetime, Tuple[int, int]] = {r[0]: (r[1], r[2]) for r in rows}
        if result:
            return result

        events = self.db.execute(
            select(FootfallEvent.observed_at, FootfallEvent.direction, FootfallEvent.count)
            .where(FootfallEvent.store_id == store_id)
            .where(FootfallEvent.observed_at >= start)
            .where(FootfallEvent.observed_at < end)
        ).all()
        buckets: Dict[datetime, List[int]] = defaultdict(lambda: [0, 0])
        for ts, direction, count in events:
            bucket = ts.replace(minute=0, second=0, microsecond=0)
            buckets[bucket][0 if direction == "in" else 1] += count
        return {k: (v[0], v[1]) for k, v in buckets.items()}

    def latest_footfall_at(self, store_id: str) -> Optional[datetime]:
        a = self.db.scalar(select(func.max(FootfallAggregate.bucket_start)).where(FootfallAggregate.store_id == store_id))
        e = self.db.scalar(select(func.max(FootfallEvent.observed_at)).where(FootfallEvent.store_id == store_id))
        values = [v for v in (a, e) if v is not None]
        return max(values) if values else None

    def latest_zone_occupancy(self, store_id: str) -> Dict[str, Tuple[int, datetime]]:
        ranked = (
            select(
                ZoneOccupancy.zone_id,
                ZoneOccupancy.count,
                ZoneOccupancy.observed_at,
                func.row_number()
                .over(partition_by=ZoneOccupancy.zone_id, order_by=(ZoneOccupancy.observed_at.desc(), ZoneOccupancy.id.desc()))
                .label("rn"),
            )
            .where(ZoneOccupancy.store_id == store_id)
            .subquery()
        )
        rows = self.db.execute(select(ranked.c.zone_id, ranked.c.count, ranked.c.observed_at).where(ranked.c.rn == 1)).all()
        return {r[0]: (r[1], r[2]) for r in rows}

    def dwell(self, store_id: str, start: datetime, end: datetime) -> Dict[str, Tuple[int, float]]:
        """{zone_id: (visitors, visitor-weighted avg dwell seconds)}"""
        rows = self.db.execute(
            select(
                DwellTimeAggregate.zone_id,
                func.sum(DwellTimeAggregate.visitors),
                func.sum(DwellTimeAggregate.visitors * DwellTimeAggregate.avg_dwell_seconds),
            )
            .where(DwellTimeAggregate.store_id == store_id)
            .where(DwellTimeAggregate.bucket_start >= start)
            .where(DwellTimeAggregate.bucket_start < end)
            .group_by(DwellTimeAggregate.zone_id)
        ).all()
        out: Dict[str, Tuple[int, float]] = {}
        for zone_id, visitors, weighted in rows:
            visitors = int(visitors or 0)
            out[zone_id] = (visitors, float(weighted or 0) / visitors if visitors else 0.0)
        return out

    def movements(self, store_id: str, start: datetime, end: datetime) -> List[Tuple[str, str, int]]:
        rows = self.db.execute(
            select(MovementAggregate.from_zone_id, MovementAggregate.to_zone_id, func.sum(MovementAggregate.transitions))
            .where(MovementAggregate.store_id == store_id)
            .where(MovementAggregate.bucket_start >= start)
            .where(MovementAggregate.bucket_start < end)
            .group_by(MovementAggregate.from_zone_id, MovementAggregate.to_zone_id)
            .order_by(func.sum(MovementAggregate.transitions).desc())
        ).all()
        return [(r[0], r[1], int(r[2])) for r in rows]


# --------------------------------------------------------------- inventory
class InventoryRepository:
    def __init__(self, db: Session):
        self.db = db

    def shelves(self, store_id: str, department: Optional[str] = None) -> Sequence[Shelf]:
        stmt = select(Shelf).where(Shelf.store_id == store_id).order_by(Shelf.shelf_code)
        if department and department.lower() not in ("all", "all departments"):
            stmt = stmt.where(Shelf.department == department)
        return self.db.scalars(stmt).all()

    def latest_observations(self, store_id: str) -> Dict[str, ShelfObservation]:
        ranked = (
            select(
                ShelfObservation.id.label("oid"),
                func.row_number()
                .over(partition_by=ShelfObservation.shelf_id, order_by=(ShelfObservation.observed_at.desc(), ShelfObservation.id.desc()))
                .label("rn"),
            )
            .where(ShelfObservation.store_id == store_id)
            .subquery()
        )
        rows = self.db.scalars(select(ShelfObservation).join(ranked, ranked.c.oid == ShelfObservation.id).where(ranked.c.rn == 1)).all()
        return {r.shelf_id: r for r in rows}

    def expected_units(self, store_id: str) -> Dict[str, int]:
        rows = self.db.execute(
            select(ShelfProduct.shelf_id, func.sum(ShelfProduct.expected_units))
            .join(Shelf, Shelf.id == ShelfProduct.shelf_id)
            .where(Shelf.store_id == store_id)
            .group_by(ShelfProduct.shelf_id)
        ).all()
        return {r[0]: int(r[1] or 0) for r in rows}

    def shelf_products(self, store_id: str) -> Dict[str, List[Tuple[ShelfProduct, Product]]]:
        rows = self.db.execute(
            select(ShelfProduct, Product)
            .join(Product, Product.id == ShelfProduct.product_id)
            .join(Shelf, Shelf.id == ShelfProduct.shelf_id)
            .where(Shelf.store_id == store_id)
        ).all()
        grouped: Dict[str, List[Tuple[ShelfProduct, Product]]] = defaultdict(list)
        for sp, product in rows:
            grouped[sp.shelf_id].append((sp, product))
        return grouped

    def products(self, store_id: str, query: Optional[str] = None) -> Sequence[Product]:
        stmt = select(Product).where(Product.store_id == store_id).order_by(Product.name)
        if query:
            like = f"%{query.strip().lower()}%"
            stmt = stmt.where(func.lower(Product.name).like(like) | func.lower(Product.sku).like(like))
        return self.db.scalars(stmt).all()

    def planograms(self, store_id: str) -> Sequence[Planogram]:
        return self.db.scalars(select(Planogram).where(Planogram.store_id == store_id).order_by(Planogram.shelf_id)).all()

    def latest_observed_at(self, store_id: str) -> Optional[datetime]:
        return self.db.scalar(select(func.max(ShelfObservation.observed_at)).where(ShelfObservation.store_id == store_id))


# ------------------------------------------------------------------ queues
class QueueRepository:
    def __init__(self, db: Session):
        self.db = db

    def counters(self, store_id: str) -> Sequence[CheckoutCounter]:
        return self.db.scalars(select(CheckoutCounter).where(CheckoutCounter.store_id == store_id).order_by(CheckoutCounter.name)).all()

    def latest_observations(self, store_id: str) -> Dict[str, QueueObservation]:
        ranked = (
            select(
                QueueObservation.id.label("oid"),
                func.row_number()
                .over(partition_by=QueueObservation.counter_id, order_by=(QueueObservation.observed_at.desc(), QueueObservation.id.desc()))
                .label("rn"),
            )
            .where(QueueObservation.store_id == store_id)
            .subquery()
        )
        rows = self.db.scalars(select(QueueObservation).join(ranked, ranked.c.oid == QueueObservation.id).where(ranked.c.rn == 1)).all()
        return {r.counter_id: r for r in rows}

    def latest_forecasts(self, store_id: str) -> Sequence[QueueForecast]:
        ranked = (
            select(
                QueueForecast.id.label("fid"),
                func.row_number()
                .over(
                    partition_by=(QueueForecast.counter_id, QueueForecast.horizon_minutes),
                    order_by=(QueueForecast.generated_at.desc(), QueueForecast.id.desc()),
                )
                .label("rn"),
            )
            .where(QueueForecast.store_id == store_id)
            .subquery()
        )
        return self.db.scalars(
            select(QueueForecast).join(ranked, ranked.c.fid == QueueForecast.id).where(ranked.c.rn == 1).order_by(QueueForecast.counter_id, QueueForecast.horizon_minutes)
        ).all()

    def rules(self, store_id: str) -> Optional[QueueRules]:
        return self.db.get(QueueRules, store_id)

    def employee_names(self, ids: Sequence[str]) -> Dict[str, str]:
        if not ids:
            return {}
        rows = self.db.execute(select(Employee.id, Employee.name).where(Employee.id.in_(list(ids)))).all()
        return {r[0]: r[1] for r in rows}
