"""
Demo seed - EXPLICIT OPT-IN ONLY.

    python -m database.manage seed-demo

* Never runs automatically (not on startup, not on migration).
* Never overwrites: every row is inserted only if its primary key is absent.
* Every observation/alert/task it writes is tagged source='demo', so demo
  figures can always be told apart from real inference output
  (GET /api/system/status -> demoDataPresent).
* The numbers are fixtures for a demonstration, not measurements.
"""

from __future__ import annotations

import logging
import math
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Type

from sqlalchemy import select
from sqlalchemy.orm import Session
from zoneinfo import ZoneInfo

from core.config import Settings, get_settings
from database import manage
from database.base import SOURCE_DEMO
from database.connection import Database
from database.models import (
    Alert, Attendance, Camera, CameraStatus, CameraZoneMapping, CheckoutCounter, CustomerAssistanceRequest,
    DwellTimeAggregate, Employee, FootfallAggregate, Insight, Offer, Planogram, Product, QueueForecast,
    QueueObservation, QueueRules, Shelf, ShelfObservation, ShelfProduct, Shift, Store, StoreZone, Task,
    TaskHistory, ZoneOccupancy,
)

log = logging.getLogger("retailedge.seed")

STORE_ID = "store-blr-104"
SECOND_STORE_ID = "store-kor-102"

ZONES = [
    ("zone-entrance", "Store Entrance & Foyer", "entrance", None, 50, 480, 120, 45, "#10B981", 40, [], "Main entrance"),
    ("zone-exit", "Store Exit", "exit", None, 630, 480, 120, 45, "#64748B", 40, [], "Exit & security gate"),
    ("zone-help", "Customer Service", "help_desk", None, 200, 480, 100, 45, "#3B82F6", 20, [], "Help desk"),
    ("zone-aisle-1", "Aisle 1 - Fresh Produce", "aisle", 1, 60, 100, 90, 320, "#10B981", 45, ["Shelf G1-Fresh"], "Fruits and vegetables"),
    ("zone-aisle-2", "Aisle 2 - Dairy", "aisle", 2, 180, 100, 90, 320, "#0EA5E9", 40, ["Shelf D3-Dairy"], "Milk, yogurt, cheese"),
    ("zone-aisle-3", "Aisle 3 - Bakery", "aisle", 3, 300, 100, 90, 320, "#F59E0B", 40, ["Shelf B2-Bakery", "Shelf A4-FMCG"], "Bread and bakery"),
    ("zone-aisle-4", "Aisle 4 - Staples", "aisle", 4, 420, 100, 90, 320, "#8B5CF6", 40, ["Shelf H4-Care"], "Staples"),
    ("zone-aisle-5", "Aisle 5 - Snacks", "aisle", 5, 540, 100, 90, 320, "#EC4899", 40, ["Shelf C1-Snacks"], "Snacks and nuts"),
    ("zone-aisle-6", "Aisle 6 - Beverages", "aisle", 6, 660, 100, 90, 320, "#06B6D4", 40, ["Shelf E1-Coffee", "Shelf F2-Beverages"], "Drinks and coffee"),
    ("zone-checkouts", "Checkout Counters 1-4", "checkout", None, 330, 480, 270, 45, "#2563EB", 40, [], "Checkout lanes"),
]

CAMERAS = [  # code, name, type, zone, shelf/ counter linkage handled below
    ("CAM-01", "Camera 01 - Main Entrance", "entrance", "zone-entrance"),
    ("CAM-02", "Camera 02 - Smart Shelves", "shelf", "zone-aisle-3"),
    ("CAM-03", "Camera 03 - Queue", "checkout", "zone-checkouts"),
    ("CAM-04", "Camera 04 - Checkout Exit", "checkout", "zone-checkouts"),
]

EMPLOYEES = [
    ("STF-01", "Ramesh Kumar", "inventory_associate", "Senior Inventory Associate", "Inventory & Stockroom", "available", ["Stock Management", "Forklift"]),
    ("STF-02", "Pooja Nair", "floor_runner", "Floor Runner (Dairy & Fresh)", "Floor Operations", "available", ["Restocking", "POS"]),
    ("STF-03", "Vikram Patel", "stockroom_clerk", "Stockroom Clerk", "Inventory & Stockroom", "busy", ["Receiving"]),
    ("STF-04", "Anita Desai", "supervisor", "Merchandising Floor Supervisor", "Management", "available", ["Planograms", "Team Lead"]),
    ("STF-05", "Siddharth Rao", "restock_specialist", "FMCG Restock Specialist", "Inventory & Stockroom", "available", ["FMCG"]),
    ("STF-06", "Sunita Patil", "cashier", "Senior Billing Cashier", "Checkout & Cashier", "busy", ["POS", "Cash Handling"]),
    ("STF-07", "Arjun Verma", "cashier", "Cashier & Customer Assistant", "Checkout & Cashier", "available", ["POS"]),
    ("STF-08", "Deepa Menon", "associate", "Fresh Produce Quality Associate", "Floor Operations", "available", ["Fresh Produce"]),
    ("STF-09", "Rajesh Pillai", "security", "Loss Prevention & CCTV Officer", "Security", "busy", ["CCTV"]),
    ("STF-10", "Meera Joshi", "customer_support", "Customer Service Representative", "Customer Support", "off_duty", ["Customer Support"]),
]

PRODUCTS = [  # id, sku, name, category, department, unit, price, stockroom
    ("prod-01", "SKU-PLM-8421", "Organic Unsweetened Almond Milk 1L", "Plant Milk", "Dairy & Beverages", "1L", 240, 60),
    ("prod-02", "SKU-BAK-2104", "Artisan Country Sourdough Loaf", "Bread", "Bakery & Bread", "500g", 180, 20),
    ("prod-03", "SKU-SNK-9912", "Roasted Peri-Peri Makhana 150g", "Healthy Snacks", "Healthy Snacks", "150g", 160, 45),
    ("prod-04", "SKU-DY-4109", "Greek Style Natural Yogurt 400g", "Yogurt", "Dairy & Refrigerated", "400g", 120, 36),
    ("prod-05", "SKU-COF-3321", "Cold Brew Blend Roasted Beans 250g", "Coffee", "Hot Beverages", "250g", 450, 80),
    ("prod-06", "SKU-PC-5502", "Botanical Fortifying Herbal Shampoo 300ml", "Hair Care", "Personal Care", "300ml", 380, 24),
]

# shelf id, code, department, category, aisle, tiers, capacity, zone, camera code, [(product, expected)], detected
SHELVES = [
    ("shf-a4", "Shelf A4-FMCG", "Dairy & Beverages", "Plant Milk & Dairy Alt", "Aisle 3 (Cold Wall Bay 4)", 3, 25, "zone-aisle-3", "CAM-02", [("prod-01", 25)], 4, 83.3),
    ("shf-b2", "Shelf B2-Bakery", "Bakery & Bread", "Artisan Country Breads", "Aisle 1 (Bakery & Bread Rack)", 2, 20, "zone-aisle-3", "CAM-02", [("prod-02", 20)], 0, 66.7),
    ("shf-c1", "Shelf C1-Snacks", "Healthy Snacks", "Roasted Makhanas & Nuts", "Aisle 4 (Healthy Snack End-Cap)", 4, 30, "zone-aisle-5", "CAM-02", [("prod-03", 30)], 3, 91.2),
    ("shf-d3", "Shelf D3-Dairy", "Dairy & Refrigerated", "Greek Yogurt & Fermented", "Aisle 2 (Dairy Wall Cooler 3)", 3, 24, "zone-aisle-2", "CAM-02", [("prod-04", 24)], 5, 87.5),
    ("shf-e1", "Shelf E1-Coffee", "Hot Beverages", "Specialty Coffee & Beans", "Aisle 5 (Coffee & Tea Bar)", 3, 32, "zone-aisle-6", "CAM-02", [("prod-05", 32)], 28, 96.8),
    ("shf-h4", "Shelf H4-Care", "Personal Care", "Botanical Hair Care", "Aisle 6 (Personal Care Wall)", 3, 18, "zone-aisle-4", "CAM-02", [("prod-06", 18)], 7, 92.5),
]

COUNTERS = [  # id, name, type, status, cashier, service rate, queue, wait seconds
    ("cnt-01", "Counter 1 (Express POS)", "express", "open", "STF-07", 1.35, 2, 90),
    ("cnt-02", "Counter 2 (Standard Billing)", "standard", "open", "STF-06", 1.05, 6, 348),
    ("cnt-03", "Counter 3 (Standard Billing)", "standard", "open", "STF-02", 1.10, 3, 168),
    ("cnt-04", "Counter 4 (Self-Checkout)", "self_checkout", "open", None, 1.80, 1, 48),
]


def _add(db: Session, model: Type, ident: Any, counters: Dict[str, int], **values) -> bool:
    """Insert only if the primary key is absent."""
    if db.get(model, ident) is not None:
        counters["skipped"] += 1
        return False
    db.add(model(**values))
    counters["inserted"] += 1
    return True


def _curve(hour: int) -> int:
    """Shape of a retail day: lunch bump + evening peak (a fixture, not a measurement)."""
    return int(40 + 170 * math.exp(-((hour - 12.5) ** 2) / 6) + 260 * math.exp(-((hour - 18.5) ** 2) / 4))


def seed_demo(settings: Settings | None = None) -> Dict[str, Any]:
    settings = settings or get_settings()
    manage.upgrade(settings)  # make sure the schema exists (backs up first if needed)
    database = Database(settings.database_url, settings.sqlite_busy_timeout_ms)
    stats = {"inserted": 0, "skipped": 0}
    try:
        with database.transaction() as db:
            _seed_store(db, stats, STORE_ID, "CHN-TNG-104", "RetailEdge Superstore - T. Nagar", "T. Nagar Usman Road",
                        "1084, South Usman Road, T. Nagar, Chennai, Tamil Nadu 600017", "+91 44 2434 8900", 250, 800, 600, True)
            _seed_store(db, stats, SECOND_STORE_ID, "CHN-ANN-102", "RetailEdge Hypermarket - Anna Nagar", "Anna Nagar 2nd Avenue",
                        "42, 2nd Avenue, Anna Nagar, Chennai, Tamil Nadu 600040", "+91 44 2621 7700", 300, 900, 650, False)
    finally:
        database.dispose()
    log.info("demo seed finished", extra=stats)
    return stats


def _seed_store(db: Session, st: Dict[str, int], sid: str, code: str, name: str, branch: str, address: str, phone: str,
                capacity: int, map_w: int, map_h: int, full: bool) -> None:
    now = datetime.now(timezone.utc)
    _add(db, Store, sid, st, id=sid, code=code, name=name, branch=branch, address=address, city="Chennai", region="Tamil Nadu",
         phone=phone, manager_name="Arjun Mehta", square_footage=18500, max_capacity=capacity, open_time="07:00", close_time="23:00",
         operating_hours_label="07:00 AM - 11:00 PM (Daily)", timezone="Asia/Kolkata", map_width=map_w, map_height=map_h,
         is_open=True, edge_server_status="disconnected", data_mode="demo")
    db.flush()
    if not full:
        return  # the second store is a bare shell: lets store-filtering be demonstrated

    suffix = sid
    tz = ZoneInfo("Asia/Kolkata")

    for z in ZONES:
        _add(db, StoreZone, z[0], st, id=z[0], store_id=sid, name=z[1], zone_type=z[2], aisle_number=z[3], x=z[4], y=z[5], width=z[6],
             height=z[7], color=z[8], capacity_limit=z[9], shelf_codes=z[10], description=z[11], category=z[1].split(" - ")[-1])
    db.flush()

    cam_ids: Dict[str, str] = {}
    for code, cname, ctype, zone in CAMERAS:
        cid = f"cam-{sid}-{code}".lower()
        cam_ids[code] = cid
        _add(db, Camera, cid, st, id=cid, store_id=sid, camera_code=code, name=cname, camera_type=ctype, zone_id=zone, resolution="1920x1080",
             target_fps=25, stream_type="placeholder", ai_module=None, purpose=None)
        db.flush()
        if db.get(CameraStatus, cid) is None:
            # Demo cameras report 'unknown': no vision pipeline is attached, and we do not pretend otherwise.
            db.add(CameraStatus(camera_id=cid, state="unknown", message="Demo camera - no stream attached"))
        if db.get(CameraZoneMapping, (cid, zone)) is None:
            db.add(CameraZoneMapping(camera_id=cid, zone_id=zone))

    emp_ids: Dict[str, str] = {}
    for i, (eid, ename, role, label, dept, avail, skills) in enumerate(EMPLOYEES):
        emp_ids[eid] = eid
        _add(db, Employee, eid, st, id=eid, store_id=sid, name=ename, role=role, role_label=label, department=dept,
             email=f"{ename.lower().replace(' ', '.')}@retailedge.store", phone=f"+91 98450 {11200 + i}", assigned_zone="Main Sales Floor",
             availability=avail, skills=skills, joined_date=date(2025, 1, 6) + timedelta(days=i * 30), is_active=True)
    db.flush()

    for pid, sku, pname, cat, dept, unit, price, room in PRODUCTS:
        _add(db, Product, pid, st, id=pid, store_id=sid, sku=sku, name=pname, category=cat, department=dept, unit=unit, price=price, stockroom_qty=room)
    db.flush()

    for sh_id, scode, dept, cat, aisle, tiers, cap, zone, cam, prods, detected, compliance in SHELVES:
        _add(db, Shelf, sh_id, st, id=sh_id, store_id=sid, shelf_code=scode, department=dept, category=cat, aisle_location=aisle,
             tier_count=tiers, capacity_units=cap, zone_id=zone, camera_id=cam_ids[cam])
        db.flush()
        for pid, expected in prods:
            if db.scalars(select(ShelfProduct).where(ShelfProduct.shelf_id == sh_id).where(ShelfProduct.product_id == pid)).first() is None:
                db.add(ShelfProduct(shelf_id=sh_id, product_id=pid, expected_units=expected, tier=1, position=1))
        _add(db, Planogram, f"plano-{sh_id}", st, id=f"plano-{sh_id}", store_id=sid, shelf_id=sh_id, version=1, last_verified_at=now - timedelta(minutes=3),
             slots=[{"slotId": f"{sh_id}-t1-s1", "tier": 1, "position": 1, "expectedProductId": prods[0][0], "expectedSku": next(p[1] for p in PRODUCTS if p[0] == prods[0][0])}])
        db.add(ShelfObservation(store_id=sid, shelf_id=sh_id, product_id=prods[0][0], detected_units=detected, confidence=0.94,
                                planogram_compliance_pct=compliance, observed_at=now - timedelta(minutes=2), source=SOURCE_DEMO))

    for cid, cname, ctype, status, cashier, rate, qlen, wait in COUNTERS:
        _add(db, CheckoutCounter, cid, st, id=cid, store_id=sid, name=cname, counter_type=ctype, status=status, cashier_employee_id=cashier,
             camera_id=cam_ids["CAM-03"], service_rate_per_min=rate)
        db.flush()
        for back in (20, 15, 10, 5, 1):
            db.add(QueueObservation(store_id=sid, counter_id=cid, queue_length=max(0, qlen + (back % 3) - 1), estimated_wait_seconds=max(0, wait + back * 2 - 10),
                                    avg_items_per_customer=6.5, observed_at=now - timedelta(minutes=back), source=SOURCE_DEMO))
        for horizon in (5, 10, 15, 30):
            db.add(QueueForecast(store_id=sid, counter_id=cid, horizon_minutes=horizon, predicted_length=float(qlen) + horizon / 10, confidence=0.8, generated_at=now, source=SOURCE_DEMO))
    if db.get(QueueRules, sid) is None:
        db.add(QueueRules(store_id=sid, config={"sla_warning_wait_minutes": 3.0, "sla_critical_wait_minutes": 4.5, "max_queue_length": 5}))

    # Today's footfall, hourly, in store-local time up to the current hour.
    local_now = now.astimezone(tz)
    day_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    for hour in range(8, local_now.hour):
        bucket = (day_start + timedelta(hours=hour)).astimezone(timezone.utc)
        exists = db.scalars(select(FootfallAggregate).where(FootfallAggregate.store_id == sid).where(FootfallAggregate.bucket_start == bucket).where(FootfallAggregate.bucket_minutes == 60)).first()
        if exists is None:
            entries = _curve(hour)
            db.add(FootfallAggregate(store_id=sid, bucket_start=bucket, bucket_minutes=60, entries=entries, exits=int(entries * 0.93), source=SOURCE_DEMO))
            for zi, z in enumerate(ZONES[3:9]):
                db.add(DwellTimeAggregate(store_id=sid, zone_id=z[0], bucket_start=bucket, visitors=int(entries * (0.5 - zi * 0.05)), avg_dwell_seconds=300 + zi * 90, source=SOURCE_DEMO))
    for zi, z in enumerate(ZONES[3:9]):
        db.add(ZoneOccupancy(store_id=sid, zone_id=z[0], count=8 + zi * 3, observed_at=now - timedelta(minutes=1), source=SOURCE_DEMO))

    # Alerts / tasks / insights / offers / attendance
    alerts = [
        ("ALT-DEMO-01", "inventory", "stock_shortage", "critical", "Sourdough shelf is empty", "Shelf B2 has been empty for 4+ minutes.", "Bakery", "shf-b2", None, "Send a runner to restock 20 loaves."),
        ("ALT-DEMO-02", "queue", "queue_congestion", "warning", "Counter 2 wait is over the limit", "6 waiting; wait is 5.8 min (limit 4.5).", "Checkout", None, "cnt-02", "Send a cashier to Counter 2 or redirect shoppers to the express counter."),
        ("ALT-DEMO-03", "inventory", "stock_shortage", "warning", "Almond Milk 1L running low", "4 of 25 units left.", "Dairy", "shf-a4", None, "Restock 2 cases before the evening rush."),
    ]
    for aid, module, cat, sev, title, desc, zone, shelf, counter, action in alerts:
        _add(db, Alert, aid, st, id=aid, store_id=sid, module=module, category=cat, severity=sev, title=title, description=desc, zone=zone,
             shelf_id=shelf, counter_id=counter, recommended_action=action, status="active", created_at=now - timedelta(minutes=5 + len(aid)), source=SOURCE_DEMO)
    db.flush()

    tasks = [
        ("TSK-DEMO-01", "Restock Sourdough Loaf", "shelf_replenishment", "critical", "in_progress", "STF-01", "shf-b2", "prod-02", 20, "ALT-DEMO-01"),
        ("TSK-DEMO-02", "Replenish Almond Milk 1L", "shelf_replenishment", "high", "assigned", "STF-02", "shf-a4", "prod-01", 21, "ALT-DEMO-03"),
        ("TSK-DEMO-03", "Restock Peri-Peri Makhana", "shelf_replenishment", "medium", "new", None, "shf-c1", "prod-03", 25, None),
    ]
    for tid, title, cat, prio, status, emp, shelf, prod, qty, alert in tasks:
        if _add(db, Task, tid, st, id=tid, store_id=sid, title=title, category=cat, priority=prio, status=status, assigned_employee_id=emp, shelf_id=shelf,
                product_id=prod, quantity=qty, alert_id=alert, due_at=now + timedelta(minutes=30), source=SOURCE_DEMO):
            db.flush()
            db.add(TaskHistory(task_id=tid, from_status=None, to_status=status, note="Demo seed"))

    today = local_now.date()
    for eid, ename, *_rest in EMPLOYEES[:9]:
        sid_shift = db.scalars(select(Shift).where(Shift.employee_id == eid).where(Shift.shift_date == today)).first()
        if sid_shift is None:
            db.add(Shift(store_id=sid, employee_id=eid, shift_date=today, shift_name="Morning Shift", start_time="08:00", end_time="16:00", break_time="12:00 - 12:45", zone="Main Sales Floor", status="confirmed"))
        att_id = f"att-demo-{eid}"
        _add(db, Attendance, att_id, st, id=att_id, store_id=sid, employee_id=eid, work_date=today, shift_name="Morning Shift", scheduled_in="08:00", scheduled_out="16:00",
             actual_in=now - timedelta(hours=3), status="present", hours_worked=3.0)

    _add(db, Insight, "INS-DEMO-01", st, id="INS-DEMO-01", store_id=sid, code="INS-QCK-101", category="queue_intelligence", severity="critical", status="pending",
         title="Counter 2 queue is over the limit", zone="Billing Hall", summary="Wait is 5.8 min (limit 4.5).",
         recommended_action="Send a POS-certified associate to Counter 2.",
         evidence={"metricsTable": [{"metric": "Queue length", "measuredValue": "6 shoppers", "targetThreshold": "<= 4"}]}, source=SOURCE_DEMO)
    for oid, title, label, pid, orig, price, until, coupon in (
        ("off-01", "Fresh Morning Bakery Delight", "20% OFF COMBO", "prod-02", 180, 144, date.today() + timedelta(days=6), "BAKE20"),
        ("off-02", "Plant-Based Dairy Saver", "BUY 2 SAVE 15%", "prod-01", 240, 204, date.today() + timedelta(days=11), "ALMOND15"),
    ):
        buy_n = int(label.split()[1]) if label.upper().startswith("BUY ") and label.split()[1].isdigit() else 1
        _add(db, Offer, oid, st, id=oid, store_id=sid, title=title, discount_label=label, product_id=pid, original_price=orig, offer_price=price, valid_until=until, coupon_code=coupon,
             is_active=True, min_quantity=buy_n, conditions=f"Applies when you buy {buy_n} or more." if buy_n > 1 else None)
    _add(db, CustomerAssistanceRequest, "REQ-DEMO-01", st, id="REQ-DEMO-01", store_id=sid, category="cannot_find_product", description="Looking for Sourdough in the bakery aisle",
         aisle_or_zone="Aisle 3 (Bakery)", product_id="prod-02", product_name="Artisan Country Sourdough Loaf", status="assigned", assigned_employee_id="STF-01")


def seed_footfall_history(settings: Settings | None = None, days: int = 7) -> Dict[str, Any]:
    """DEMO fixture: hourly footfall for the PREVIOUS `days` days of the full demo store (never today, so today's totals stay camera-only).

    It gives the charts a baseline and the forecast something to work from. Rows are tagged source 'demo'; existing buckets are skipped (idempotent).
    Weekday factors and the small deterministic noise are invented - this is not a measurement."""
    import random

    settings = settings or get_settings()
    manage.upgrade(settings)
    database = Database(settings.database_url, settings.sqlite_busy_timeout_ms)
    inserted = 0
    try:
        with database.transaction() as db:
            store = db.get(Store, STORE_ID)
            if store is None:
                return {"inserted": 0, "note": "demo store not found; run seed-demo first"}
            tz = ZoneInfo(store.timezone or "Asia/Kolkata")
            today = datetime.now(timezone.utc).astimezone(tz).date()
            weekday_factor = [0.92, 0.95, 0.97, 1.0, 1.12, 1.3, 1.22]  # Mon..Sun
            for back in range(1, days + 1):
                day = today - timedelta(days=back)
                rnd = random.Random(f"{STORE_ID}-{day.isoformat()}")
                for hour in range(8, 23):
                    bucket = datetime(day.year, day.month, day.day, hour, tzinfo=tz).astimezone(timezone.utc)
                    exists = db.scalars(select(FootfallAggregate).where(FootfallAggregate.store_id == STORE_ID).where(FootfallAggregate.bucket_start == bucket)
                                        .where(FootfallAggregate.bucket_minutes == 60)).first()
                    if exists is not None:
                        continue
                    entries = max(0, int(_curve(hour) * weekday_factor[day.weekday()] * rnd.uniform(0.9, 1.1)))
                    db.add(FootfallAggregate(store_id=STORE_ID, bucket_start=bucket, bucket_minutes=60, entries=entries, exits=int(entries * 0.93), source=SOURCE_DEMO))
                    inserted += 1
    finally:
        database.dispose()
    return {"inserted": inserted, "days": days}
