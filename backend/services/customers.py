"""Customer PWA backend (no authentication => only PUBLIC, non-operational data leaves this module).

Never returned: raw/camera data, camera credentials or ids, model/inference identifiers, employee names or contact details, stockroom
(ERP) quantities, supplier data, internal alert/task ids. Shelf availability is a short status with its basis spelled out - it describes
what the shelf camera saw, NOT how much the store holds in total.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from core.errors import NotFoundError
from core.events import event_bus
from database.models import (
    Camera, CheckoutCounter, CustomerAssistanceRequest, CustomerFeedback, CustomerRequestHistory, Employee, Product, Shelf, ShelfObservation, Store, Task,
)
from repositories.platform import CustomerRepository
from schemas.operations import TaskCreate
from schemas.platform import AssistanceCreate, OfferOut
from services.common import get_store_or_404, now_utc
from services.inventory import classify
from services.queues import QueueService
from services.tasks import ELIGIBLE_ROLES, TaskService

# Observations older than this are not shown to shoppers (a stale "in stock" is worse than "unknown").
FRESH_MINUTES = 30
STATUS_LABEL = {"in_stock": "On the shelf", "low_stock": "Running low on the shelf", "out_of_stock": "Not on the shelf right now", "unknown": "Availability not available"}
AVAILABILITY_NOTE = "Shelf display only (as last seen by the store's shelf camera). This is not the store's total stock - ask staff if you can't find it."
# "On the way" is shown ONLY after the assigned employee pressed "On my way" in the Staff PWA.
REQUEST_LABEL = {"submitted": "Submitted - waiting for a free team member", "assigned": "Assigned to a team member", "on_the_way": "Staff on the way",
                 "in_progress": "In progress", "resolved": "Resolved", "cancelled": "Cancelled"}
CANCELLABLE = ("submitted", "assigned", "on_the_way")
# Customer-facing help categories (+ the older values the first shopper app sent, mapped onto them).
HELP_CATEGORIES = {
    "cannot_find_product": "Cannot Find Product", "product_information": "Need Product Information", "product_not_available": "Product Not Available",
    "checkout_help": "Help at Checkout", "navigation_help": "Need Navigation Assistance", "other": "Other Assistance",
}
_LEGACY_HELP = {"product_location": "cannot_find_product", "restock_request": "product_not_available", "heavy_lifting": "other", "sampling": "product_information",
                "general_help": "other", "general": "other"}


def normalize_help_category(value: Optional[str]) -> str:
    v = (value or "other").strip().lower()
    v = _LEGACY_HELP.get(v, v)
    if v not in HELP_CATEGORIES:
        from core.errors import InvalidStateError

        raise InvalidStateError(f"Unknown help category '{value}'. Use one of: {', '.join(HELP_CATEGORIES)}")
    return v


def public_status(req: CustomerAssistanceRequest) -> Dict[str, Any]:
    return {"requestId": req.id, "status": req.status, "statusLabel": REQUEST_LABEL.get(req.status, req.status), "teamMemberAssigned": bool(req.assigned_employee_id),
            "canCancel": req.status in CANCELLABLE}


class PublicStoreService:
    """Read-only data for the Customer PWA."""

    def __init__(self, db: Session):
        self.db = db

    # ------------------------------------------------------------------ store
    @staticmethod
    def _store(s: Store) -> Dict[str, Any]:
        return {
            "id": s.id, "code": s.code, "name": s.name, "branch": s.branch, "address": s.address, "city": s.city,
            "operatingHours": s.operating_hours_label, "isOpen": s.is_open, "phone": s.phone,
            "mapDimensions": {"width": s.map_width, "height": s.map_height},
            "isDemo": s.data_mode == "demo",  # seeded fixtures are always labelled
        }

    def stores(self) -> List[Dict[str, Any]]:
        # stores that have cameras (i.e. real data) come first, so the phone apps open on the working store and not on an empty shell
        has_camera = exists().where(Camera.store_id == Store.id)
        return [self._store(s) for s in self.db.scalars(select(Store).order_by(has_camera.desc(), Store.name)).all()]

    def store(self, store_id: str) -> Dict[str, Any]:
        return self._store(get_store_or_404(self.db, store_id))

    def layout(self, store_id: str) -> Dict[str, Any]:
        store = get_store_or_404(self.db, store_id)
        from repositories.telemetry import ShopperRepository

        zones = [{"id": z.id, "name": z.name, "type": z.zone_type, "aisleNumber": z.aisle_number, "category": z.category, "x": z.x, "y": z.y,
                  "width": z.width, "height": z.height, "color": z.color, "description": z.description}
                 for z in ShopperRepository(self.db).zones(store_id)]
        return {"storeId": store.id, "name": f"{store.name} Layout", "width": store.map_width, "height": store.map_height, "zones": zones,
                "calibrated": False, "note": "Floor plan only; live customer positions are never shown."}

    # ---------------------------------------------------------------- queues
    def queues(self, store_id: str) -> Dict[str, Any]:
        store = get_store_or_404(self.db, store_id)
        from services.analytics_read import AnalyticsReadService

        status = AnalyticsReadService(self.db).queue_status(store_id)
        counters = []
        for c in status["counters"]:
            w = c["wait"]
            usable = c["status"] != "closed" and not c["stale"] and w["seconds"] is not None
            counters.append({
                "id": c["counterId"], "name": c["name"], "status": c["status"],
                "queueLength": c["length"] if not c["stale"] else None,
                "estimatedWaitMins": round(w["seconds"] / 60, 1) if usable else None,
                "waitBasis": w["basis"] if usable else "unavailable",  # measured | assumption | unavailable
            })
        usable_c = [c for c in counters if c["estimatedWaitMins"] is not None]
        best = min(usable_c, key=lambda c: c["estimatedWaitMins"], default=None)
        for c in counters:
            c["isRecommended"] = bool(best and c["id"] == best["id"])
        return {"storeId": store_id, "lastUpdated": now_utc().isoformat(), "dataAvailable": bool(usable_c), "isDemo": store.data_mode == "demo",
                "recommendedCounterId": best["id"] if best else None, "recommendedCounterName": best["name"] if best else None, "counters": counters,
                "note": "Wait times are estimates from the checkout cameras and may be unavailable."}

    # ---------------------------------------------------------------- offers
    def offers(self, store_id: str) -> List[OfferOut]:
        from services.common import store_tz
        from services.customer_catalog import offer_status

        store = get_store_or_404(self.db, store_id)
        today = now_utc().astimezone(store_tz(store)).date()
        return [OfferOut(id=o.id, title=o.title, description=o.description, discount_label=o.discount_label, category=o.category, product_id=o.product_id,
                         product_name=p.name if p else None, original_price=o.original_price, offer_price=o.offer_price, valid_until=o.valid_until,
                         coupon_code=o.coupon_code, banner_color=o.banner_color, image_url=o.image_url)
                for o, p in CustomerRepository(self.db).offers(store_id) if offer_status(o, today) == "active"]

    # -------------------------------------------------------------- catalogue
    def _shelf_state(self, store: Store, shelves: List[Shelf], expected: Dict[str, int], latest: Dict[str, ShelfObservation]) -> tuple:
        """(state, observed_at) for one product across the shelves that carry it."""
        states, newest = [], None
        for sh in shelves:
            obs = latest.get(sh.id)
            if obs is None:
                continue
            if store.data_mode != "demo" and obs.source != "cv":
                continue  # real stores only show camera-derived observations
            if (now_utc() - obs.observed_at) > timedelta(minutes=FRESH_MINUTES) and store.data_mode != "demo":
                continue
            st = obs.status if obs.status in ("in_stock", "low_stock", "out_of_stock") else (classify(obs.detected_units, expected.get(sh.id, 0) or sh.capacity_units)
                                                                                           if obs.status != "uncertain" else None)
            if st:
                states.append(st)
                newest = max(newest, obs.observed_at) if newest else obs.observed_at
        if not states:
            return "unknown", None
        for pick in ("in_stock", "low_stock", "out_of_stock"):
            if pick in states:
                return pick, newest
        return "unknown", None

    def products(self, store_id: str, q: Optional[str] = None, category: Optional[str] = None, availability: Optional[str] = None) -> List[Dict[str, Any]]:
        store = get_store_or_404(self.db, store_id)
        from repositories.telemetry import InventoryRepository

        repo = InventoryRepository(self.db)
        shelves = {s.id: s for s in repo.shelves(store_id)}
        shelf_products = repo.shelf_products(store_id)
        latest = repo.latest_observations(store_id)
        expected = repo.expected_units(store_id)
        from database.models import StoreZone

        zones = {z.id: z for z in self.db.scalars(select(StoreZone).where(StoreZone.store_id == store_id))}
        carriers: Dict[str, List[Shelf]] = {}
        for shelf_id, rows in shelf_products.items():
            for _, product in rows:
                carriers.setdefault(product.id, []).append(shelves[shelf_id]) if shelf_id in shelves else None
        out = []
        for p in repo.products(store_id, q):
            if category and category.lower() not in ("all", (p.category or "").lower(), (p.department or "").lower()):
                continue
            sh_list = carriers.get(p.id, [])
            state, seen = self._shelf_state(store, sh_list, expected, latest)
            if availability and availability != "all" and state != availability:
                continue
            first = sh_list[0] if sh_list else None
            zone = zones.get(first.zone_id) if first and first.zone_id else None
            out.append({
                "id": p.id, "name": p.name, "category": p.category, "department": p.department, "price": p.price, "unit": p.unit, "imageUrl": p.image_url,
                "location": {"zoneId": zone.id if zone else None, "zoneName": zone.name if zone else None, "aisleNumber": zone.aisle_number if zone else None,
                             "aisle": first.aisle_location if first else None} if first else None,
                "availability": {"state": state, "label": STATUS_LABEL[state], "observedAt": seen.isoformat() if seen else None,
                                 "basis": "shelf_camera" if state != "unknown" else "none", "note": AVAILABILITY_NOTE if state != "unknown" else "No recent shelf observation."},
            })
        return out

    def categories(self, store_id: str) -> List[Dict[str, Any]]:
        get_store_or_404(self.db, store_id)
        rows = self.db.execute(select(Product.category, func.count()).where(Product.store_id == store_id).where(Product.category.is_not(None))
                               .group_by(Product.category).order_by(Product.category)).all()
        return [{"name": c, "productCount": int(n)} for c, n in rows]


class CustomerService:
    def __init__(self, db: Session):
        self.db = db

    def _pick_employee(self, store_id: str) -> Optional[Employee]:
        """Least-loaded CHECKED-IN employee eligible for customer help (a rostered-but-absent employee is not picked)."""
        from services.workforce import AvailabilityService

        cands = AvailabilityService(self.db).candidates(store_id, "customer_assistance")
        return self.db.get(Employee, cands[0].employee_id) if cands else None

    def create_assistance(self, body: AssistanceCreate, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        from database.models import IdempotencyRecord

        store = get_store_or_404(self.db, body.store_id)
        if idempotency_key:
            prior = self.db.get(IdempotencyRecord, (idempotency_key, "customer.assistance"))
            if prior is not None and prior.ref:
                req = self.db.get(CustomerAssistanceRequest, prior.ref)
                if req is not None:
                    return {**public_status(req), "statusRef": req.status_ref, "submittedAt": req.created_at.isoformat(), "replayed": True}
        category = normalize_help_category(body.category)
        product = self.db.get(Product, body.product_id) if body.product_id else None
        if body.product_id and (product is None or product.store_id != body.store_id):
            raise NotFoundError("Product", body.product_id)
        employee = self._pick_employee(body.store_id)
        req = CustomerAssistanceRequest(
            id=f"REQ-{uuid.uuid4().hex[:6].upper()}", store_id=body.store_id, category=category, description=body.description[:1000],
            aisle_or_zone=body.aisle_or_zone, product_id=body.product_id, product_name=body.product_name or (product.name if product else None),
            customer_contact=(body.customer_contact or None), status="assigned" if employee else "submitted",
            assigned_employee_id=employee.id if employee else None,
            status_ref=secrets.token_urlsafe(24),  # ~190 bits: the only way to read a request back
        )
        self.db.add(req)
        self.db.flush()
        self.db.add(CustomerRequestHistory(request_id=req.id, status=req.status, note="Request received"))
        # The request becomes a real staff task through the shared task engine (same record in Staff Management and the Staff PWA).
        what = HELP_CATEGORIES[category]
        product_txt = f" ({req.product_name})" if req.product_name else ""
        task, _ = TaskService(self.db).create_ex(
            body.store_id,
            TaskCreate(title=f"Customer help - {what}{product_txt} near {body.aisle_or_zone or 'store floor'}"[:200],
                       description=f"{what}: {body.description}", category="customer_assistance", priority="high", zone=body.aisle_or_zone,
                       assigned_employee_id=employee.id if employee else None, product_id=body.product_id, due_in_minutes=10),
            source="customer_request", customer_request_id=req.id,
        )
        req.task_id = task.id
        if idempotency_key:
            self.db.add(IdempotencyRecord(key=idempotency_key, scope="customer.assistance", ref=req.id))
        self.db.flush()
        event_bus.publish(body.store_id, "customer.assistance.created", {"requestId": req.id, "taskId": task.id, "category": req.category, "zone": req.aisle_or_zone,
                                                                         "status": req.status, "isDemo": store.data_mode == "demo"})
        return {**public_status(req), "statusRef": req.status_ref, "submittedAt": req.created_at.isoformat(),
                "note": "Keep this reference to check your request. This demo has no sign-in, so anyone with the reference can see its status."}

    def _by_ref(self, status_ref: str) -> CustomerAssistanceRequest:
        req = self.db.scalars(select(CustomerAssistanceRequest).where(CustomerAssistanceRequest.status_ref == status_ref)).first() if len(status_ref or "") >= 16 else None
        if req is None:
            raise NotFoundError("Assistance request", "unknown reference")
        return req

    def get_assistance(self, status_ref: str) -> Dict[str, Any]:
        req = self._by_ref(status_ref)
        hist = self.db.scalars(select(CustomerRequestHistory).where(CustomerRequestHistory.request_id == req.id).order_by(CustomerRequestHistory.id)).all()
        return {**public_status(req), "category": req.category, "categoryLabel": HELP_CATEGORIES.get(req.category, req.category), "description": req.description,
                "zone": req.aisle_or_zone, "productName": req.product_name, "storeId": req.store_id,
                "submittedAt": req.created_at.isoformat(), "updatedAt": req.updated_at.isoformat(),
                "history": [{"status": h.status, "label": REQUEST_LABEL.get(h.status, h.status), "at": h.created_at.isoformat()} for h in hist]}

    def cancel_assistance(self, status_ref: str) -> Dict[str, Any]:
        """The customer withdraws a request that nobody has started on. The linked staff task is cancelled through the shared task engine."""
        from core.errors import InvalidStateError

        req = self._by_ref(status_ref)
        if req.status not in CANCELLABLE:
            raise InvalidStateError(f"A request that is '{REQUEST_LABEL.get(req.status, req.status)}' can no longer be cancelled")
        task = self.db.get(Task, req.task_id) if req.task_id else None
        if task is not None and task.status in ("new", "assigned", "in_progress"):
            TaskService(self.db).cancel(task.id, reason="Cancelled by the customer")  # syncs the request to 'cancelled'
        if req.status != "cancelled":
            req.status = "cancelled"
            self.db.add(CustomerRequestHistory(request_id=req.id, status="cancelled", note="Cancelled by the customer"))
            event_bus.publish(req.store_id, "customer.assistance.updated", {"requestId": req.id, "status": "cancelled"})
        self.db.flush()
        return self.get_assistance(status_ref)

    def feedback(self, payload: Dict[str, Any]) -> None:
        store_id = payload.get("storeId")
        if store_id and self.db.get(Store, store_id) is None:
            store_id = None
        rating = payload.get("experienceRating") or payload.get("rating")
        self.db.add(CustomerFeedback(store_id=store_id, rating=int(rating) if isinstance(rating, (int, float)) and 1 <= int(rating) <= 5 else None,
                                     comment=(payload.get("comments") or payload.get("comment") or "")[:2000] or None, contact=(payload.get("contact") or None),
                                     payload={k: v for k, v in payload.items() if isinstance(k, str)}))
        self.db.flush()
