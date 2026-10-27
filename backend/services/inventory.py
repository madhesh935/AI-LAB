from __future__ import annotations

from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from database.models import Camera, Product
from repositories.operations import TaskRepository
from repositories.telemetry import InventoryRepository
from schemas.common import Meta
from schemas.monitoring import (
    InventoryKpisOut,
    InventoryOut,
    PlanogramOut,
    ProductOut,
    ShelfDetailOut,
)
from services.alerts import AlertService
from services.common import get_store_or_404, humanize, now_utc, resolve_window
from services.cameras import feed_status
from repositories.telemetry import CameraRepository

LOW_STOCK_PCT = 30.0


def classify(detected: Optional[int], expected: int) -> str:
    """Condition from a camera-observed count. No observation means 'uncertain', never 'in stock'."""
    if detected is None:
        return "uncertain"
    if detected <= 0:
        return "out_of_stock"
    if expected <= 0:
        return "in_stock"
    pct = detected / expected * 100
    return "low_stock" if pct < LOW_STOCK_PCT else "in_stock"


class InventoryService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = InventoryRepository(db)

    def shelves(self, store_id: str, department: Optional[str] = None) -> List[ShelfDetailOut]:
        get_store_or_404(self.db, store_id)
        now = now_utc()
        observations = self.repo.latest_observations(store_id)
        expected = self.repo.expected_units(store_id)
        shelf_products = self.repo.shelf_products(store_id)
        cameras = {c.id: (c, s) for c, s, _ in CameraRepository(self.db).list_with_status(store_id)}

        out: List[ShelfDetailOut] = []
        for shelf in self.repo.shelves(store_id, department):
            obs = observations.get(shelf.id)
            exp = expected.get(shelf.id, 0) or shelf.capacity_units
            detected = obs.detected_units if obs else None
            cam_row = cameras.get(shelf.camera_id or "")
            offline = cam_row is not None and feed_status(cam_row[1]) in ("offline", "error")
            if obs is not None and obs.status in ("in_stock", "low_stock", "out_of_stock", "uncertain"):
                condition = obs.status  # Phase 3: the CONFIRMED status from the model-backed pipeline (repeated-observation confirmation)
                if offline and (now - obs.observed_at).total_seconds() > 120:
                    condition = "camera_offline"  # an old reading from a camera that is now down must not look current
            else:
                condition = "camera_offline" if (offline and obs is None) else classify(detected, exp)
            out.append(
                ShelfDetailOut(
                    id=shelf.id,
                    shelf_code=shelf.shelf_code,
                    department=shelf.department,
                    category=shelf.category,
                    tier_count=shelf.tier_count,
                    capacity_units=shelf.capacity_units,
                    expected_visible_units=exp,
                    detected_visible_units=detected,
                    availability_percentage=round(detected / exp * 100, 1) if detected is not None and exp else None,
                    condition=condition,
                    last_observation=humanize(obs.observed_at, now) if obs else None,
                    last_observation_at=obs.observed_at if obs else None,
                    associated_camera_id=shelf.camera_id,
                    associated_camera_name=cam_row[0].name if cam_row else None,
                    aisle_location=shelf.aisle_location,
                    planogram_compliance_pct=obs.planogram_compliance_pct if obs else None,
                    product_ids=[p.id for _, p in shelf_products.get(shelf.id, [])],
                )
            )
        return out

    def products(self, store_id: str, query: Optional[str] = None) -> List[ProductOut]:
        get_store_or_404(self.db, store_id)
        now = now_utc()
        observations = self.repo.latest_observations(store_id)
        shelf_products = self.repo.shelf_products(store_id)
        shelves = {s.id: s for s in self.repo.shelves(store_id)}

        placement: Dict[str, tuple] = {}
        for shelf_id, rows in shelf_products.items():
            for sp, product in rows:
                placement.setdefault(product.id, (shelf_id, sp.expected_units, len(rows)))

        out: List[ProductOut] = []
        for product in self.repo.products(store_id, query):
            shelf_id, expected, siblings = placement.get(product.id, (None, 0, 0))
            obs = observations.get(shelf_id) if shelf_id else None
            detected: Optional[int] = None
            if obs is not None and (obs.product_id == product.id or (obs.product_id is None and siblings == 1)):
                detected = obs.detected_units
            shelf = shelves.get(shelf_id) if shelf_id else None
            out.append(
                ProductOut(
                    id=product.id,
                    name=product.name,
                    sku=product.sku,
                    category=product.category,
                    department=product.department,
                    shelf_id=shelf_id,
                    shelf_code=shelf.shelf_code if shelf else None,
                    expected_visible_qty=expected,
                    detected_visible_qty=detected,
                    stockroom_qty=product.stockroom_qty,
                    availability_pct=round(detected / expected * 100, 1) if detected is not None and expected else None,
                    confidence_score=obs.confidence if obs and detected is not None else None,
                    status=classify(detected, expected),
                    last_observation=humanize(obs.observed_at, now) if obs and detected is not None else None,
                    price=product.price,
                    unit=product.unit,
                    image_url=product.image_url,
                )
            )
        return out

    def planograms(self, store_id: str) -> List[PlanogramOut]:
        get_store_or_404(self.db, store_id)
        observations = self.repo.latest_observations(store_id)
        shelves = {s.id: s for s in self.repo.shelves(store_id)}
        now = now_utc()
        out: List[PlanogramOut] = []
        for plan in self.repo.planograms(store_id):
            shelf = shelves.get(plan.shelf_id)
            obs = observations.get(plan.shelf_id)
            out.append(
                PlanogramOut(
                    id=plan.id,
                    shelf_id=plan.shelf_id,
                    shelf_code=shelf.shelf_code if shelf else plan.shelf_id,
                    department=shelf.department if shelf else None,
                    version=plan.version,
                    compliance_percentage=obs.planogram_compliance_pct if obs else None,
                    total_slots=len(plan.slots or []),
                    last_verified=humanize(plan.last_verified_at, now) if plan.last_verified_at else None,
                    slots=list(plan.slots or []),
                )
            )
        return out

    def kpis(self, store_id: str, shelves: List[ShelfDetailOut]) -> InventoryKpisOut:
        scores = [s.planogram_compliance_pct for s in shelves if s.planogram_compliance_pct is not None]
        return InventoryKpisOut(
            tracked_shelves=len(shelves),
            optimal=sum(1 for s in shelves if s.condition == "in_stock"),
            low_stock=sum(1 for s in shelves if s.condition == "low_stock"),
            out_of_stock=sum(1 for s in shelves if s.condition == "out_of_stock"),
            uncertain=sum(1 for s in shelves if s.condition in ("uncertain", "camera_offline")),
            average_planogram_score=round(sum(scores) / len(scores), 1) if scores else None,
            active_tasks=TaskRepository(self.db).open_count(store_id),
        )

    def meta(self, store_id: str, shelves: List[ShelfDetailOut]) -> Meta:
        latest = self.repo.latest_observed_at(store_id)
        if not shelves:
            return Meta(data_state="empty", note="No shelves are configured for this store.")
        if latest is None:
            from services.analytics_read import AnalyticsReadService

            m = AnalyticsReadService(self.db).shelf_model_status()
            note = ("MODEL_NOT_CONFIGURED: no validated shelf product model is loaded, so shelf counts are not produced."
                    if not m["ready"] else "Shelves are configured but no camera has reported stock levels yet.")
            return Meta(data_state="unavailable", note=note)
        return Meta(data_state="available", last_observation_at=latest, sources=["shelf_observations"])

    def overview(self, store_id: str, range_key: str = "today", department: Optional[str] = None) -> InventoryOut:
        store = get_store_or_404(self.db, store_id)
        window = resolve_window(store, range_key)
        shelves = self.shelves(store_id, department)
        return InventoryOut(
            store_id=store_id,
            range=window.label,
            kpis=self.kpis(store_id, shelves),
            shelves=shelves,
            products=self.products(store_id),
            planograms=self.planograms(store_id),
            alerts=AlertService(self.db).list(store_id, module="inventory", limit=100).items,
            meta=self.meta(store_id, shelves),
        )
