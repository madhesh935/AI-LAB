"""
Customer PWA seeds - EXPLICIT OPT-IN ONLY.

    python -m database.manage seed-demo-catalog [--store store-blr-104]   # demo stores only
    python -m database.manage seed-store-map --store <id> [--replace]     # prototype floor plan graph from the store's zones

* seed-demo-catalog refuses any store whose data_mode is not 'demo' - real stores never receive fixture products, prices or offers.
  It only inserts rows whose primary key is absent and only fills product fields that are still empty.
* Every shelf observation it writes is tagged source='demo'.
* seed-store-map persists ONE versioned layout (labelled "prototype"); routes re-use it, nothing is regenerated per request.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.config import Settings, get_settings
from core.errors import InvalidStateError
from database import manage
from database.base import SOURCE_DEMO
from database.connection import Database
from database.models import Offer, Product, Shelf, ShelfObservation, ShelfProduct, Store
from services.common import store_tz

log = logging.getLogger("retailedge.seed")

DEFAULT_STORE = "store-blr-104"

# existing six demo products: brand / description / aliases (only filled where empty)
ENRICH = {
    "prod-01": ("Urban Platter", "Unsweetened almond drink made from organic almonds. Dairy free.", "almond milk plant milk vegan dairy free"),
    "prod-02": ("The Baker's Dozen", "Slow-fermented sourdough loaf baked fresh.", "bread sourdough loaf"),
    "prod-03": ("Farmley", "Roasted fox nuts with peri-peri seasoning.", "makhana fox nuts snack healthy"),
    "prod-04": ("Epigamia", "Thick strained natural yogurt.", "yogurt curd dahi greek"),
    "prod-05": ("Blue Tokai", "Whole roasted coffee beans for cold brew.", "coffee beans cold brew"),
    "prod-06": ("Biotique", "Herbal shampoo with botanical extracts.", "shampoo hair care herbal"),
}

# shelf id, code, department, category, zone, capacity, detected (fixture count -> status)
SHELVES = [
    ("shf-p1", "Shelf P1-Fruits", "Fresh Produce", "Fruits", "zone-aisle-1", 40, 31),
    ("shf-p2", "Shelf P2-Vegetables", "Fresh Produce", "Vegetables", "zone-aisle-1", 40, 26),
    ("shf-d1", "Shelf D1-Milk", "Dairy & Refrigerated", "Milk", "zone-aisle-2", 48, 36),
    ("shf-d2", "Shelf D2-Paneer", "Dairy & Refrigerated", "Butter, Paneer & Cheese", "zone-aisle-2", 30, 22),
    ("shf-b1", "Shelf B1-Bread", "Bakery & Bread", "Bread", "zone-aisle-3", 30, 18),
    ("shf-b3", "Shelf B3-Breakfast", "Breakfast & Spreads", "Breakfast", "zone-aisle-3", 30, 24),
    ("shf-s1", "Shelf S1-Rice", "Staples & Grains", "Rice, Atta & Dal", "zone-aisle-4", 30, 21),
    ("shf-s2", "Shelf S2-Oil", "Staples & Grains", "Oil, Salt & Sugar", "zone-aisle-4", 30, 25),
    ("shf-h1", "Shelf H1-Hair", "Personal Care", "Hair & Oral Care", "zone-aisle-4", 30, 20),
    ("shf-h2", "Shelf H2-Household", "Household", "Cleaning", "zone-aisle-4", 30, 0),
    ("shf-c2", "Shelf C2-Chips", "Snacks & Namkeen", "Chips & Namkeen", "zone-aisle-5", 40, 30),
    ("shf-c3", "Shelf C3-Biscuits", "Snacks & Namkeen", "Biscuits, Noodles & Chocolates", "zone-aisle-5", 40, 5),
    ("shf-f1", "Shelf F1-Juices", "Beverages", "Juices, Soft Drinks & Water", "zone-aisle-6", 40, 33),
    ("shf-f3", "Shelf F3-Tea", "Hot Beverages", "Tea & Coffee", "zone-aisle-6", 30, 24),
]

# id, sku, name, brand, category, department, unit, price (None = not set by the store yet), aliases, shelf (None = not mapped)
PRODUCTS = [
    ("prod-c01", "SKU-FRU-1001", "Robusta Banana 1kg", "FreshFarm", "Fruits", "Fresh Produce", "1kg", 60, "banana kela fruit", "shf-p1"),
    ("prod-c02", "SKU-FRU-1002", "Shimla Apple 1kg", "FreshFarm", "Fruits", "Fresh Produce", "1kg", 180, "apple seb fruit", "shf-p1"),
    ("prod-c03", "SKU-FRU-1003", "Alphonso Mango 1kg", "FreshFarm", "Fruits", "Fresh Produce", "1kg", None, "mango aam fruit seasonal", "shf-p1"),
    ("prod-c04", "SKU-VEG-1004", "Hybrid Tomato 1kg", "FreshFarm", "Vegetables", "Fresh Produce", "1kg", 40, "tomato tamatar vegetable", "shf-p2"),
    ("prod-c05", "SKU-VEG-1005", "Onion 1kg", "FreshFarm", "Vegetables", "Fresh Produce", "1kg", 45, "onion pyaz vegetable", "shf-p2"),
    ("prod-c06", "SKU-VEG-1006", "Fresh Spinach Bunch 250g", "FreshFarm", "Vegetables", "Fresh Produce", "250g", 30, "spinach palak greens leafy", "shf-p2"),
    ("prod-c07", "SKU-MLK-2001", "Amul Taaza Toned Milk 1L", "Amul", "Milk", "Dairy & Refrigerated", "1L", 56, "milk doodh toned", "shf-d1"),
    ("prod-c08", "SKU-MLK-2002", "Aavin Toned Milk 500ml", "Aavin", "Milk", "Dairy & Refrigerated", "500ml", 25, "milk doodh toned", "shf-d1"),
    ("prod-c09", "SKU-MLK-2003", "Amul Gold Full Cream Milk 500ml", "Amul", "Milk", "Dairy & Refrigerated", "500ml", 34, "milk doodh full cream", "shf-d1"),
    ("prod-c10", "SKU-DAI-2004", "Heritage Fresh Curd 400g", "Heritage", "Curd & Yogurt", "Dairy & Refrigerated", "400g", 45, "curd dahi yogurt", "shf-d2"),
    ("prod-c11", "SKU-DAI-2005", "Amul Butter 100g", "Amul", "Butter, Paneer & Cheese", "Dairy & Refrigerated", "100g", 58, "butter makhan", "shf-d2"),
    ("prod-c12", "SKU-DAI-2006", "Milky Mist Paneer 200g", "Milky Mist", "Butter, Paneer & Cheese", "Dairy & Refrigerated", "200g", 95, "paneer cottage cheese", "shf-d2"),
    ("prod-c13", "SKU-DAI-2007", "Britannia Cheese Slices 200g", "Britannia", "Butter, Paneer & Cheese", "Dairy & Refrigerated", "200g", 140, "cheese slices", "shf-d2"),
    ("prod-c14", "SKU-BRD-3001", "Britannia White Bread 400g", "Britannia", "Bread", "Bakery & Bread", "400g", 45, "bread white sandwich", "shf-b1"),
    ("prod-c15", "SKU-BRD-3002", "Modern Whole Wheat Brown Bread 400g", "Modern", "Bread", "Bakery & Bread", "400g", 55, "bread brown wheat atta", "shf-b1"),
    ("prod-c16", "SKU-BRK-3003", "Suguna Farm Fresh Eggs 6 pcs", "Suguna", "Eggs", "Breakfast & Spreads", "6 pcs", 54, "eggs anda", "shf-b3"),
    ("prod-c17", "SKU-BRK-3004", "Kellogg's Corn Flakes 475g", "Kellogg's", "Cereals", "Breakfast & Spreads", "475g", 199, "cornflakes cereal breakfast", "shf-b3"),
    ("prod-c18", "SKU-BRK-3005", "Kissan Mixed Fruit Jam 500g", "Kissan", "Spreads", "Breakfast & Spreads", "500g", 165, "jam spread", "shf-b3"),
    ("prod-c19", "SKU-STP-4001", "India Gate Basmati Rice 5kg", "India Gate", "Rice", "Staples & Grains", "5kg", 699, "rice basmati chawal", "shf-s1"),
    ("prod-c20", "SKU-STP-4002", "Ponni Boiled Rice 5kg", "Ponni Gold", "Rice", "Staples & Grains", "5kg", 420, "rice ponni chawal", "shf-s1"),
    ("prod-c21", "SKU-STP-4003", "Aashirvaad Whole Wheat Atta 5kg", "Aashirvaad", "Atta & Flour", "Staples & Grains", "5kg", 290, "atta wheat flour", "shf-s1"),
    ("prod-c22", "SKU-STP-4004", "Tata Sampann Toor Dal 1kg", "Tata Sampann", "Dal & Pulses", "Staples & Grains", "1kg", 175, "dal toor arhar lentils pulses", "shf-s1"),
    ("prod-c23", "SKU-STP-4005", "Fortune Sunflower Oil 1L", "Fortune", "Cooking Oil", "Staples & Grains", "1L", 155, "oil cooking sunflower", "shf-s2"),
    ("prod-c24", "SKU-STP-4006", "Tata Salt 1kg", "Tata", "Salt & Sugar", "Staples & Grains", "1kg", 28, "salt namak", "shf-s2"),
    ("prod-c25", "SKU-STP-4007", "Madhur Pure Sugar 1kg", "Madhur", "Salt & Sugar", "Staples & Grains", "1kg", 52, "sugar chini", "shf-s2"),
    ("prod-c26", "SKU-PC-5001", "Dove Intense Repair Shampoo 180ml", "Dove", "Hair Care", "Personal Care", "180ml", 199, "shampoo hair care", "shf-h1"),
    ("prod-c27", "SKU-PC-5002", "Head & Shoulders Anti-Dandruff Shampoo 650ml", "Head & Shoulders", "Hair Care", "Personal Care", "650ml", 549, "shampoo dandruff hair care", "shf-h1"),
    ("prod-c28", "SKU-PC-5003", "Colgate Strong Teeth Toothpaste 200g", "Colgate", "Oral Care", "Personal Care", "200g", 110, "toothpaste oral care", "shf-h1"),
    ("prod-c29", "SKU-PC-5004", "Dettol Original Soap 4 x 75g", "Dettol", "Bath & Body", "Personal Care", "300g", 180, "soap bath", "shf-h1"),
    ("prod-c30", "SKU-HH-6001", "Surf Excel Easy Wash Detergent 1kg", "Surf Excel", "Laundry", "Household", "1kg", 140, "detergent washing powder laundry", "shf-h2"),
    ("prod-c31", "SKU-HH-6002", "Vim Dishwash Bar 300g", "Vim", "Dishwash", "Household", "300g", 30, "dishwash bar utensil", "shf-h2"),
    ("prod-c32", "SKU-HH-6003", "Lizol Floor Cleaner 975ml", "Lizol", "Cleaners", "Household", "975ml", 219, "floor cleaner disinfectant", "shf-h2"),
    ("prod-c33", "SKU-SNK-7001", "Lay's Classic Salted Chips 52g", "Lay's", "Chips", "Snacks & Namkeen", "52g", 20, "chips crisps wafers", "shf-c2"),
    ("prod-c34", "SKU-SNK-7002", "Haldiram's Aloo Bhujia 400g", "Haldiram's", "Namkeen", "Snacks & Namkeen", "400g", 110, "namkeen bhujia", "shf-c2"),
    ("prod-c35", "SKU-SNK-7003", "Parle-G Gold Biscuits 800g", "Parle", "Biscuits", "Snacks & Namkeen", "800g", 90, "biscuits cookies", "shf-c3"),
    ("prod-c36", "SKU-SNK-7004", "Maggi 2-Minute Masala Noodles 280g", "Maggi", "Instant Noodles", "Snacks & Namkeen", "280g", 56, "noodles instant maggi", "shf-c3"),
    ("prod-c37", "SKU-SNK-7005", "Cadbury Dairy Milk Silk 60g", "Cadbury", "Chocolates", "Snacks & Namkeen", "60g", 80, "chocolate", "shf-c3"),
    ("prod-c38", "SKU-BEV-8001", "Tata Tea Gold 500g", "Tata Tea", "Tea", "Hot Beverages", "500g", 285, "tea chai", "shf-f3"),
    ("prod-c39", "SKU-BEV-8002", "Nescafe Classic Instant Coffee 100g", "Nescafe", "Coffee", "Hot Beverages", "100g", 330, "coffee instant", "shf-f3"),
    ("prod-c40", "SKU-BEV-8003", "Real Fruit Power Mixed Fruit Juice 1L", "Real", "Juices", "Beverages", "1L", 125, "juice fruit", "shf-f1"),
    ("prod-c41", "SKU-BEV-8004", "Coca-Cola 750ml", "Coca-Cola", "Soft Drinks", "Beverages", "750ml", 40, "cola soft drink coke", "shf-f1"),
    ("prod-c42", "SKU-BEV-8005", "Bisleri Mineral Water 1L", "Bisleri", "Water", "Beverages", "1L", 20, "water mineral", "shf-f1"),
    ("prod-c43", "SKU-GRM-9001", "Imported Black Truffle Oil 250ml", "Urbani", "Gourmet", "Gourmet & Imported", "250ml", 1450, "truffle oil gourmet", None),
]

# id, title, label, type, value, product, category, offer_price, original, days_from, days_until, min_qty, stackable, conditions, coupon
OFFERS = [
    ("off-c01", "Dairy Week: Amul Taaza", "NOW ₹52", "fixed_price", None, "prod-c07", None, 52, 56, 0, 7, 1, False, None, None),
    ("off-c02", "10% off Snacks & Namkeen", "10% OFF", "percent", 10, None, "Snacks & Namkeen", None, None, 0, 5, 1, True, "Applies to every product in Snacks & Namkeen.", None),
    ("off-c03", "₹5 off Lay's Classic", "₹5 OFF", "amount", 5, "prod-c33", None, None, 20, 0, 5, 1, True, "Can be combined with the Snacks & Namkeen discount.", None),
    ("off-c04", "Buy 3 Maggi, save 15%", "BUY 3 SAVE 15%", "percent", 15, "prod-c36", None, None, 56, 0, 10, 3, False, "Applies when you buy 3 or more packs.", "MAGGI3"),
    ("off-c05", "Dove Repair Shampoo offer", "NOW ₹179", "fixed_price", None, "prod-c26", None, 179, 199, 0, 14, 1, False, None, None),
    ("off-c06", "Weekend Juice Fest", "20% OFF", "percent", 20, "prod-c40", None, None, 125, -9, -1, 1, False, None, None),   # expired - never shown
    ("off-c07", "Rice Festival", "₹50 OFF", "amount", 50, "prod-c19", None, None, 699, 3, 10, 1, False, None, None),          # scheduled - not active yet
]


def _store(db: Session, store_id: str) -> Store:
    store = db.get(Store, store_id)
    if store is None:
        raise InvalidStateError(f"Store '{store_id}' does not exist (run seed-demo first for the demo stores)")
    return store


def seed_catalog_into(db: Session, store_id: str = DEFAULT_STORE) -> Dict[str, Any]:
    store = _store(db, store_id)
    if store.data_mode != "demo":
        raise InvalidStateError(f"Store '{store_id}' is in REAL mode - demo products, prices and offers are never added to a real store")
    stats = {"productsInserted": 0, "productsEnriched": 0, "shelvesInserted": 0, "mappingsInserted": 0, "offersInserted": 0, "observations": 0}
    now = datetime.now(timezone.utc)
    today = now.astimezone(store_tz(store)).date()

    for pid, (brand, desc, kw) in ENRICH.items():
        p = db.get(Product, pid)
        if p is not None and p.store_id == store_id:
            changed = False
            for attr, val in (("brand", brand), ("description", desc), ("search_keywords", kw)):
                if not getattr(p, attr):
                    setattr(p, attr, val)
                    changed = True
            stats["productsEnriched"] += int(changed)

    zone_ids = {sh[4] for sh in SHELVES}
    from database.models import StoreZone

    zones = {z.id: z for z in db.scalars(select(StoreZone).where(StoreZone.store_id == store_id).where(StoreZone.id.in_(zone_ids)))}
    for sid, code, dept, cat, zone, cap, detected in SHELVES:
        if zone not in zones:
            continue
        if db.get(Shelf, sid) is None:
            z = zones[zone]
            db.add(Shelf(id=sid, store_id=store_id, shelf_code=code, department=dept, category=cat, aisle_location=f"Aisle {z.aisle_number}" if z.aisle_number else z.name,
                         tier_count=3, capacity_units=cap, zone_id=zone))
            db.flush()
            db.add(ShelfObservation(store_id=store_id, shelf_id=sid, detected_units=detected, expected_units=cap, confidence=0.9, observed_at=now - timedelta(minutes=2),
                                    source=SOURCE_DEMO))
            stats["shelvesInserted"] += 1
            stats["observations"] += 1
    db.flush()

    for i, (pid, sku, name, brand, cat, dept, unit, price, kw, shelf) in enumerate(PRODUCTS):
        if db.get(Product, pid) is None:
            db.add(Product(id=pid, store_id=store_id, sku=sku, name=name, brand=brand, category=cat, department=dept, unit=unit, price=price,
                           image_url=f"/products/{pid}.jpg", search_keywords=kw, stockroom_qty=20 + (i * 7) % 60, is_active=True))
            stats["productsInserted"] += 1
        db.flush()
        if shelf and db.get(Shelf, shelf) is not None:
            exists = db.scalars(select(ShelfProduct).where(ShelfProduct.shelf_id == shelf).where(ShelfProduct.product_id == pid)).first()
            if exists is None:
                pos = 1 + sum(1 for p in PRODUCTS[:i] if p[9] == shelf)
                db.add(ShelfProduct(shelf_id=shelf, product_id=pid, expected_units=8, tier=1 + (pos - 1) // 3, position=1 + (pos - 1) % 3))
                stats["mappingsInserted"] += 1

    for (oid, title, label, dtype, value, pid, cat, offer_price, orig, d_from, d_until, min_q, stack, cond, coupon) in OFFERS:
        if db.get(Offer, oid) is None:
            db.add(Offer(id=oid, store_id=store_id, title=title, discount_label=label, discount_type=dtype, discount_value=value, product_id=pid, category=cat,
                         offer_price=offer_price, original_price=orig, valid_from=today + timedelta(days=d_from), valid_until=today + timedelta(days=d_until),
                         min_quantity=min_q, stackable=stack, conditions=cond, coupon_code=coupon, is_active=True))
            stats["offersInserted"] += 1
    # Photos live in the shopper app at /products/<id>.jpg. Only fill an empty image so a store photo is never overwritten.
    stats["imagesSet"] = 0
    for pid in ("prod-01", "prod-02", "prod-03", "prod-04", "prod-05", "prod-06", *(row[0] for row in PRODUCTS)):
        product = db.get(Product, pid)
        if product is not None and product.store_id == store_id and not product.image_url:
            product.image_url = f"/products/{pid}.jpg"
            stats["imagesSet"] += 1
    db.flush()
    return stats


def seed_demo_catalog(settings: Optional[Settings] = None, store_id: str = DEFAULT_STORE) -> Dict[str, Any]:
    settings = settings or get_settings()
    manage.upgrade(settings)
    database = Database(settings.database_url, settings.sqlite_busy_timeout_ms)
    try:
        with database.transaction() as db:
            stats = seed_catalog_into(db, store_id)
    finally:
        database.dispose()
    log.info("demo catalogue seed finished", extra=stats)
    return stats


def seed_store_map(settings: Optional[Settings] = None, store_id: str = DEFAULT_STORE, replace: bool = False) -> Dict[str, Any]:
    from services.store_map import build_prototype_layout, load_graph, validate

    settings = settings or get_settings()
    manage.upgrade(settings)
    database = Database(settings.database_url, settings.sqlite_busy_timeout_ms)
    try:
        with database.transaction() as db:
            _store(db, store_id)
            stats = build_prototype_layout(db, store_id, replace=replace)
            stats["validation"] = validate(load_graph(db, store_id))
    finally:
        database.dispose()
    log.info("store map seed finished", extra={k: v for k, v in stats.items() if k != "validation"})
    return stats
