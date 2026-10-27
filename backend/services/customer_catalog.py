"""Customer catalogue: products, ranked search, availability, offers and pricing for the Customer PWA and the customer Copilot.

Everything here reads the SAME rows Smart Inventory uses (products, shelves, shelf_products, shelf_observations, offers).

* Money is computed with Decimal and returned in integer minor units (paise) - never float arithmetic on currency.
* Offers: only active offers inside their validity window count. Offers never stack unless every offer involved is marked
  `stackable`; otherwise the single best offer wins. A `min_quantity` offer is reported as conditional until the quantity is met.
* Availability describes what the shelf camera last saw (never stockroom quantities).
* Search: parameterised LIKE pre-filter in SQLite + ranking in Python (exact > prefix > word prefix > brand > category > keyword >
  substring). Adequate for catalogues of a few thousand SKUs; SQLite FTS5 is the upgrade path for larger catalogues.
"""

from __future__ import annotations

import difflib
import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from core.errors import InvalidStateError, NotFoundError
from database.models import Offer, Product, Shelf, ShelfObservation, ShelfPlacement, ShelfProduct, Store, StoreLayout, StoreZone
from services.common import get_store_or_404, now_utc, store_tz
from services.inventory import classify

FRESH_MINUTES = 30
CURRENCY = "INR"
AVAILABILITY_LABEL = {
    "in_stock": "Available on Shelf",
    "low_stock": "Limited Visible Stock",
    "out_of_stock": "Not Seen on Shelf",
    "unknown": "Availability Unknown",
}
AVAILABILITY_NOTE = "Based on what the store's shelf camera last saw on the shelf - not the store's total stock."
SORTS = ("relevance", "name_asc", "name_desc", "price_asc", "price_desc")
AVAILABILITY_FILTERS = ("all", "in_stock", "low_stock", "out_of_stock", "unknown", "on_shelf")

_PACK = re.compile(r"(\d+(?:\.\d+)?)\s*(ml|l|ltr|litre|liter|g|gm|gms|kg|pcs|pc|pieces|n|pack)\b", re.I)
_WORD = re.compile(r"[a-z0-9]+")


# ----------------------------------------------------------------------------- money
def to_minor(value: Optional[float]) -> Optional[int]:
    """Rupees (as stored) -> paise, rounded half-up on the decimal string so 0.1 + 0.2 style float error never leaks into prices."""
    if value is None:
        return None
    return int((Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def pct_of(minor: int, pct: Decimal) -> int:
    return int((Decimal(minor) * pct / Decimal(100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def pack_info(product: Product) -> Optional[Dict[str, Any]]:
    """Parse '300ml' / '1L' / '5 kg' / '6 pcs' from the unit (or name) into a comparable base quantity (ml, g or pcs)."""
    for text in (product.unit or "", product.name or ""):
        m = _PACK.search(text)
        if not m:
            continue
        qty, unit = Decimal(m.group(1)), m.group(2).lower()
        if unit in ("l", "ltr", "litre", "liter"):
            return {"quantity": float(qty * 1000), "unit": "ml", "label": f"{m.group(1)} L"}
        if unit == "ml":
            return {"quantity": float(qty), "unit": "ml", "label": f"{m.group(1)} ml"}
        if unit == "kg":
            return {"quantity": float(qty * 1000), "unit": "g", "label": f"{m.group(1)} kg"}
        if unit in ("g", "gm", "gms"):
            return {"quantity": float(qty), "unit": "g", "label": f"{m.group(1)} g"}
        return {"quantity": float(qty), "unit": "pcs", "label": f"{m.group(1)} pcs"}
    return None


def unit_price(price_minor: Optional[int], pack: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Price per 100 ml / 100 g / 1 piece, in paise."""
    if price_minor is None or not pack or not pack["quantity"]:
        return None
    per = Decimal(1) if pack["unit"] == "pcs" else Decimal(100)
    value = (Decimal(price_minor) * per / Decimal(str(pack["quantity"]))).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return {"perMinor": int(value), "basis": "1 pc" if pack["unit"] == "pcs" else f"100 {pack['unit']}", "unit": pack["unit"]}


# ----------------------------------------------------------------------------- offers
def offer_status(o: Offer, today: date) -> str:
    if not o.is_active:
        return "inactive"
    if o.valid_from and o.valid_from > today:
        return "scheduled"
    if o.valid_until and o.valid_until < today:
        return "expired"
    return "active"


def offer_unit_price(o: Offer, list_minor: int) -> Optional[int]:
    """Unit price under this offer alone, or None when the offer does not lower the price."""
    if o.discount_type == "percent" and o.discount_value:
        pct = Decimal(str(o.discount_value))
        if not (Decimal(0) < pct < Decimal(100)):
            return None
        price = list_minor - pct_of(list_minor, pct)
    elif o.discount_type == "amount" and o.discount_value:
        price = max(0, list_minor - to_minor(o.discount_value))
    else:  # fixed_price
        if o.offer_price is None:
            return None
        price = to_minor(o.offer_price)
    return price if price < list_minor else None


def offer_applies_to(o: Offer, p: Product) -> bool:
    if o.product_id:
        return o.product_id == p.id
    if o.category:
        c = o.category.strip().lower()
        return c in ((p.category or "").lower(), (p.department or "").lower())
    return False


@dataclass
class PriceQuote:
    list_minor: Optional[int]
    unit_minor: Optional[int]  # effective unit price for the requested quantity
    applied: List[Offer]
    conditional: List[Offer]

    def as_dict(self, pack: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        has = self.list_minor is not None
        save = (self.list_minor - self.unit_minor) if has and self.unit_minor is not None else 0
        return {
            "currency": CURRENCY,
            "priceAvailable": has,
            "listPriceMinor": self.list_minor,
            "effectivePriceMinor": self.unit_minor,
            "hasOffer": bool(self.applied),
            "savingsMinor": save,
            "discountPercent": round(save * 100 / self.list_minor) if has and self.list_minor and save else 0,
            "appliedOffers": [offer_brief(o) for o in self.applied],
            "conditionalOffers": [offer_brief(o) for o in self.conditional],
            "unitPrice": unit_price(self.unit_minor, pack),
            "stacked": len(self.applied) > 1,
        }


def offer_brief(o: Offer) -> Dict[str, Any]:
    return {"id": o.id, "title": o.title, "label": o.discount_label, "discountType": o.discount_type, "minQuantity": o.min_quantity,
            "conditions": o.conditions, "validUntil": o.valid_until.isoformat() if o.valid_until else None, "couponCode": o.coupon_code}


def quote(p: Product, offers: Sequence[Offer], quantity: int = 1) -> PriceQuote:
    list_minor = to_minor(p.price)
    if list_minor is None:
        return PriceQuote(None, None, [], [])
    usable: List[Tuple[int, Offer]] = []
    conditional: List[Offer] = []
    for o in offers:
        price = offer_unit_price(o, list_minor)
        if price is None:
            continue
        if o.min_quantity > quantity:
            conditional.append(o)
            continue
        usable.append((price, o))
    best_price, best = list_minor, []
    for price, o in usable:
        if price < best_price:
            best_price, best = price, [o]
    stackable = [o for _, o in usable if o.stackable and o.discount_type in ("percent", "amount")]
    if len(stackable) > 1 and len(stackable) == len(usable):
        price = list_minor
        for o in sorted(stackable, key=lambda x: x.discount_type != "percent"):
            price = offer_unit_price(o, price) or price
        if price < best_price:
            best_price, best = price, stackable
    return PriceQuote(list_minor, best_price, best, conditional)


# ----------------------------------------------------------------------------- search scoring
def _norm(s: Optional[str]) -> str:
    return (s or "").strip().lower()


def _words(s: Optional[str]) -> List[str]:
    return _WORD.findall(_norm(s))


def _stem(t: str) -> str:
    """Plural-tolerant query token: 'shampoos' -> 'shampoo', 'berries' -> 'berry', 'tomatoes' -> 'tomato' (prefix matching does the rest)."""
    if len(t) > 4 and t.endswith("ies"):
        return t[:-3] + "y"
    if len(t) > 4 and t.endswith("oes"):
        return t[:-2]
    if len(t) > 3 and t.endswith("s") and not t.endswith("ss"):
        return t[:-1]
    return t


def _query_tokens(q: str) -> List[str]:
    return [_stem(t) for t in _words(q)]


def score_product(p: Product, query: str) -> float:
    """Match quality of one product for a (normalised) query; 0 = no match. Every query word must match something."""
    q = _norm(query)
    if not q:
        return 1.0
    name, brand, cat, dept, kw = _norm(p.name), _norm(p.brand), _norm(p.category), _norm(p.department), _norm(p.search_keywords)
    if name == q:
        return 100.0
    tokens = _query_tokens(q)
    if not tokens:
        return 0.0
    total = 0.0
    for t in tokens:
        best = 0.0
        name_words = _words(name)
        if t in name_words or (t + "s") in name_words:
            best = 90  # whole word ("milk" in "Toned Milk") beats a prefix ("milk" in "Milky Mist")
        elif name.startswith(t):
            best = 85
        elif any(w.startswith(t) for w in name_words):
            best = 80
        elif brand and (brand.startswith(t) or any(w.startswith(t) for w in _words(brand))):
            best = 70
        elif any(w.startswith(t) for w in _words(cat) + _words(dept)):
            best = 60
        elif any(w.startswith(t) for w in _words(kw)):
            best = 55
        elif t in name:
            best = 40
        elif t in f"{brand} {cat} {dept} {kw}":
            best = 25
        if best == 0:
            return 0.0
        total += best
    bonus = 5.0 if name.startswith(q) else 0.0
    if all(any(w.startswith(t) for w in _words(cat) + _words(kw)) for t in tokens):
        bonus += 8.0  # the product IS what was asked for (category / alias agree), not merely named like it
    return total / len(tokens) + bonus


def _like_filter(q: str):
    conds = []
    for t in _query_tokens(q)[:6]:
        like = f"%{t}%"
        conds.append(or_(func.lower(Product.name).like(like), func.lower(func.coalesce(Product.brand, "")).like(like),
                         func.lower(func.coalesce(Product.category, "")).like(like), func.lower(func.coalesce(Product.department, "")).like(like),
                         func.lower(func.coalesce(Product.search_keywords, "")).like(like), func.lower(Product.sku).like(like)))
    return conds


# ----------------------------------------------------------------------------- service
class CatalogService:
    def __init__(self, db: Session):
        self.db = db
        self._ctx: Dict[str, Any] = {}

    # -- store ---------------------------------------------------------------
    def store(self, store_id: str) -> Store:
        return get_store_or_404(self.db, store_id)

    @staticmethod
    def open_status(store: Store, now: Optional[datetime] = None) -> Dict[str, Any]:
        """Open/closed from the configured hours in the store's time zone. 'unknown' when hours are not configured."""
        if not store.is_open:
            return {"status": "closed", "label": "Closed", "verified": True, "basis": "store_flag"}
        try:
            o = time.fromisoformat(store.open_time or "")
            c = time.fromisoformat(store.close_time or "")
        except ValueError:
            return {"status": "unknown", "label": store.operating_hours_label or "Hours not available", "verified": False, "basis": "none"}
        local = (now or now_utc()).astimezone(store_tz(store))
        t = local.time().replace(tzinfo=None)
        is_open = (o <= t < c) if o < c else (t >= o or t < c)
        close_label = datetime.combine(local.date(), c).strftime("%I:%M %p").lstrip("0")
        open_label = datetime.combine(local.date(), o).strftime("%I:%M %p").lstrip("0")
        return {"status": "open" if is_open else "closed", "label": f"Open · closes {close_label}" if is_open else f"Closed · opens {open_label}",
                "verified": True, "basis": "configured_hours", "opensAt": store.open_time, "closesAt": store.close_time, "localTime": local.strftime("%H:%M")}

    def store_out(self, store: Store) -> Dict[str, Any]:
        return {"id": store.id, "code": store.code, "name": store.name, "branch": store.branch, "address": store.address, "city": store.city,
                "phone": store.phone, "operatingHours": store.operating_hours_label, "openStatus": self.open_status(store), "isDemo": store.data_mode == "demo",
                "timezone": store.timezone}

    # -- shared lookups (one pass per request) -------------------------------
    def _load(self, store: Store) -> Dict[str, Any]:
        if self._ctx.get("store_id") == store.id:
            return self._ctx
        from repositories.telemetry import InventoryRepository

        repo = InventoryRepository(self.db)
        shelves = {s.id: s for s in repo.shelves(store.id)}
        zones = {z.id: z for z in self.db.scalars(select(StoreZone).where(StoreZone.store_id == store.id))}
        carriers: Dict[str, List[Tuple[ShelfProduct, Shelf]]] = {}
        for shelf_id, rows in repo.shelf_products(store.id).items():
            for sp, product in rows:
                if shelf_id in shelves:
                    carriers.setdefault(product.id, []).append((sp, shelves[shelf_id]))
        for lst in carriers.values():
            lst.sort(key=lambda r: (r[1].shelf_code, r[0].tier, r[0].position))
        layout = self.db.scalars(select(StoreLayout).where(StoreLayout.store_id == store.id).where(StoreLayout.is_active.is_(True))
                                 .order_by(StoreLayout.version.desc()).limit(1)).first()
        placed = {pl.shelf_id: pl for pl in self.db.scalars(select(ShelfPlacement).where(ShelfPlacement.layout_id == layout.id))} if layout else {}
        today = now_utc().astimezone(store_tz(store)).date()
        offers: Dict[str, List[Offer]] = {}
        all_offers = [o for o in self.db.scalars(select(Offer).where(Offer.store_id == store.id)) if offer_status(o, today) == "active"]
        self._ctx = {"store_id": store.id, "store": store, "shelves": shelves, "zones": zones, "carriers": carriers, "latest": repo.latest_observations(store.id),
                     "expected": repo.expected_units(store.id), "layout": layout, "placed": placed, "today": today, "offers": all_offers, "offers_by_product": offers}
        return self._ctx

    def _offers_for(self, ctx: Dict[str, Any], p: Product) -> List[Offer]:
        cache = ctx["offers_by_product"]
        if p.id not in cache:
            cache[p.id] = [o for o in ctx["offers"] if offer_applies_to(o, p)]
        return cache[p.id]

    def _availability(self, ctx: Dict[str, Any], p: Product) -> Dict[str, Any]:
        store: Store = ctx["store"]
        states, newest = [], None
        now = now_utc()
        stale = False
        for _, sh in ctx["carriers"].get(p.id, []):
            obs: Optional[ShelfObservation] = ctx["latest"].get(sh.id)
            if obs is None:
                continue
            old = (now - obs.observed_at) > timedelta(minutes=FRESH_MINUTES)
            if store.data_mode != "demo" and (obs.source != "cv" or old):
                continue  # real stores: only fresh camera observations
            if obs.status in ("in_stock", "low_stock", "out_of_stock"):
                st = obs.status
            elif obs.status in ("uncertain", "camera_offline"):
                st = None
            else:
                st = classify(obs.detected_units, ctx["expected"].get(sh.id, 0) or sh.capacity_units)
            if st:
                states.append(st)
                stale = stale or old
                newest = max(newest, obs.observed_at) if newest else obs.observed_at
        state = next((s for s in ("in_stock", "low_stock", "out_of_stock") if s in states), "unknown")
        return {"state": state, "label": AVAILABILITY_LABEL[state], "observedAt": newest.isoformat() if newest else None,
                "basis": "shelf_camera" if state != "unknown" else "none", "isStale": bool(stale and state != "unknown"),
                "note": AVAILABILITY_NOTE if state != "unknown" else "No recent shelf observation for this product."}

    def _locations(self, ctx: Dict[str, Any], p: Product) -> List[Dict[str, Any]]:
        out = []
        for sp, sh in ctx["carriers"].get(p.id, []):
            z = ctx["zones"].get(sh.zone_id or "")
            pl = ctx["placed"].get(sh.id)
            out.append({"shelfId": sh.id, "shelfCode": sh.shelf_code, "shelfLabel": (sh.shelf_code or "").replace("Shelf ", "", 1),
                        "zoneId": z.id if z else None, "zoneName": z.name if z else None, "section": z.category if z else sh.department,
                        "aisleNumber": z.aisle_number if z else None, "aisleLabel": f"Aisle {z.aisle_number}" if z and z.aisle_number else (z.name if z else None),
                        "tier": sp.tier, "position": sp.position, "onMap": pl is not None, "accessNodeId": pl.access_node_id if pl else None})
        return out

    def card(self, ctx: Dict[str, Any], p: Product, quantity: int = 1) -> Dict[str, Any]:
        pack = pack_info(p)
        locs = self._locations(ctx, p)
        primary = next((l for l in locs if l["onMap"]), locs[0] if locs else None)
        return {
            "id": p.id, "sku": p.sku, "name": p.name, "brand": p.brand, "category": p.category, "department": p.department, "unit": p.unit,
            "imageUrl": p.image_url, "pack": pack, "price": quote(p, self._offers_for(ctx, p), quantity).as_dict(pack),
            "availability": self._availability(ctx, p), "location": primary, "locationCount": len(locs),
            "mapped": bool(primary and primary["onMap"]),
        }

    # -- catalogue -----------------------------------------------------------
    def _active_products(self, store_id: str, q: Optional[str] = None) -> List[Product]:
        stmt = select(Product).where(Product.store_id == store_id).where(Product.is_active.is_(True))
        if q:
            for cond in _like_filter(q):
                stmt = stmt.where(cond)
        return list(self.db.scalars(stmt.order_by(Product.name, Product.id)))

    def list_products(self, store_id: str, q: Optional[str] = None, category: Optional[str] = None, brand: Optional[str] = None,
                      availability: str = "all", offers_only: bool = False, sort: str = "relevance", page: int = 1, page_size: int = 24) -> Dict[str, Any]:
        store = self.store(store_id)
        ctx = self._load(store)
        if sort not in SORTS:
            raise InvalidStateError(f"Unknown sort '{sort}'")
        if availability not in AVAILABILITY_FILTERS:
            raise InvalidStateError(f"Unknown availability filter '{availability}'")
        q = (q or "").strip()[:80]
        if not _words(q):
            q = ""  # punctuation-only input ('%', '*') is not a search
        rows = self._active_products(store_id, q or None)
        corrected = None
        if q and not rows:
            corrected = self.did_you_mean(store_id, q)
            if corrected:
                rows = self._active_products(store_id, corrected)
        scored: List[Tuple[float, Product]] = []
        for p in rows:
            s = score_product(p, corrected or q) if q else 1.0
            if s > 0:
                scored.append((s, p))
        cat = _norm(category) if category and _norm(category) not in ("all", "") else None
        br = _norm(brand) if brand and _norm(brand) not in ("all", "") else None
        items: List[Tuple[float, Dict[str, Any]]] = []
        for s, p in scored:
            if cat and cat not in (_norm(p.category), _norm(p.department)):
                continue
            if br and br != _norm(p.brand):
                continue
            c = self.card(ctx, p)
            st = c["availability"]["state"]
            if availability == "on_shelf" and st not in ("in_stock", "low_stock"):
                continue
            if availability not in ("all", "on_shelf") and st != availability:
                continue
            if offers_only and not c["price"]["hasOffer"]:
                continue
            items.append((s, c))
        if sort == "name_asc":
            items.sort(key=lambda r: (r[1]["name"].lower(), r[1]["id"]))
        elif sort == "name_desc":
            items.sort(key=lambda r: (r[1]["name"].lower(), r[1]["id"]), reverse=True)
        elif sort in ("price_asc", "price_desc"):
            priced = [r for r in items if r[1]["price"]["effectivePriceMinor"] is not None]
            unpriced = [r for r in items if r[1]["price"]["effectivePriceMinor"] is None]
            priced.sort(key=lambda r: (r[1]["price"]["effectivePriceMinor"], r[1]["id"]), reverse=sort == "price_desc")
            items = priced + sorted(unpriced, key=lambda r: r[1]["id"])  # "Price unavailable" always last
        else:
            rank = {"in_stock": 0, "low_stock": 1, "unknown": 2, "out_of_stock": 3}
            items.sort(key=lambda r: (-r[0], rank[r[1]["availability"]["state"]], r[1]["name"].lower(), r[1]["id"]))
        total = len(items)
        page_size = max(1, min(60, page_size))
        pages = max(1, -(-total // page_size))
        page = max(1, page)
        chunk = [c for _, c in items[(page - 1) * page_size: page * page_size]]
        return {"storeId": store_id, "items": chunk, "total": total, "page": page, "pageSize": page_size, "totalPages": pages, "hasMore": page < pages,
                "query": q or None, "correctedQuery": corrected, "filters": {"category": category, "brand": brand, "availability": availability, "offersOnly": offers_only, "sort": sort},
                "isDemo": store.data_mode == "demo", "generatedAt": now_utc().isoformat()}

    def product(self, store_id: str, product_id: str) -> Dict[str, Any]:
        store = self.store(store_id)
        p = self.db.get(Product, product_id)
        if p is None or p.store_id != store_id or not p.is_active:
            raise NotFoundError("Product", product_id)
        ctx = self._load(store)
        c = self.card(ctx, p)
        offers = self._offers_for(ctx, p)
        return {**c, "description": p.description, "locations": self._locations(ctx, p), "lastObservedAt": c["availability"]["observedAt"],
                "offers": [self.offer_out(ctx, o, p) for o in offers], "isDemo": store.data_mode == "demo", "generatedAt": now_utc().isoformat()}

    def shelf_products(self, store_id: str, shelf_id: str) -> Dict[str, Any]:
        """Active products mapped to one shelf (the map's tap-a-shelf sheet)."""
        store = self.store(store_id)
        ctx = self._load(store)
        shelf = ctx["shelves"].get(shelf_id)
        if shelf is None:
            raise NotFoundError("Shelf", shelf_id)
        ids = [pid for pid, rows in ctx["carriers"].items() if any(sh.id == shelf_id for _, sh in rows)]
        prods = sorted(self.products_by_ids(store_id, ids).values(), key=lambda p: (p.name, p.id))
        return {"storeId": store_id, "shelfId": shelf_id, "shelfCode": shelf.shelf_code, "items": [self.card(ctx, p) for p in prods if p.is_active],
                "generatedAt": now_utc().isoformat()}

    def products_by_ids(self, store_id: str, ids: Iterable[str]) -> Dict[str, Product]:
        ids = [i for i in dict.fromkeys(ids) if i][:200]
        if not ids:
            return {}
        rows = self.db.scalars(select(Product).where(Product.store_id == store_id).where(Product.id.in_(ids)).where(Product.is_active.is_(True)))
        return {p.id: p for p in rows}

    # -- suggestions ---------------------------------------------------------
    def vocabulary(self, store_id: str) -> List[str]:
        words = set()
        for name, brand, cat, dept, kw in self.db.execute(select(Product.name, Product.brand, Product.category, Product.department, Product.search_keywords)
                                                          .where(Product.store_id == store_id).where(Product.is_active.is_(True))):
            for w in _words(f"{name} {brand or ''} {cat or ''} {dept or ''} {kw or ''}"):
                if len(w) >= 3 and not w.isdigit():
                    words.add(w)
        return sorted(words)

    def did_you_mean(self, store_id: str, q: str) -> Optional[str]:
        vocab = self.vocabulary(store_id)
        fixed, changed = [], False
        for t in _words(q):
            if t in vocab or any(v.startswith(t) for v in vocab):
                fixed.append(t)
                continue
            m = difflib.get_close_matches(t, vocab, n=1, cutoff=0.72)
            if not m:
                return None
            fixed.append(m[0])
            changed = True
        return " ".join(fixed) if changed and fixed else None

    def suggestions(self, store_id: str, q: str, limit: int = 8) -> Dict[str, Any]:
        q = (q or "").strip()[:80]
        store = self.store(store_id)
        if not q:
            return {"query": q, "products": [], "brands": [], "categories": [], "didYouMean": None, "generatedAt": now_utc().isoformat()}
        res = self.list_products(store_id, q=q, sort="relevance", page=1, page_size=limit)
        ql = _norm(res["correctedQuery"] or q)
        brands: Dict[str, int] = {}
        cats: Dict[str, int] = {}
        for p in self._active_products(store_id):
            if p.brand and any(w.startswith(t) for t in _words(ql) for w in _words(p.brand)):
                brands[p.brand] = brands.get(p.brand, 0) + 1
            for c in {p.department, p.category}:
                if c and any(w.startswith(t) for t in _words(ql) for w in _words(c)):
                    cats[c] = cats.get(c, 0) + 1
        return {"query": q, "didYouMean": res["correctedQuery"], "products": res["items"], "totalMatches": res["total"],
                "brands": [{"name": b, "productCount": n} for b, n in sorted(brands.items(), key=lambda r: -r[1])[:3]],
                "categories": [{"name": c, "productCount": n} for c, n in sorted(cats.items(), key=lambda r: -r[1])[:3]],
                "isDemo": store.data_mode == "demo", "generatedAt": now_utc().isoformat()}

    # -- categories / brands -------------------------------------------------
    def categories(self, store_id: str) -> Dict[str, Any]:
        store = self.store(store_id)
        ctx = self._load(store)
        depts: Dict[str, Dict[str, Any]] = {}
        cats: Dict[str, int] = {}
        brands: Dict[str, int] = {}
        for p in self._active_products(store_id):
            if p.department:
                d = depts.setdefault(p.department, {"name": p.department, "productCount": 0, "imageUrl": None, "onShelf": 0})
                d["productCount"] += 1
                d["imageUrl"] = d["imageUrl"] or p.image_url
                if self._availability(ctx, p)["state"] in ("in_stock", "low_stock"):
                    d["onShelf"] += 1
            if p.category:
                cats[p.category] = cats.get(p.category, 0) + 1
            if p.brand:
                brands[p.brand] = brands.get(p.brand, 0) + 1
        return {"storeId": store_id, "departments": sorted(depts.values(), key=lambda d: d["name"]),
                "categories": [{"name": c, "productCount": n} for c, n in sorted(cats.items())],
                "brands": [{"name": b, "productCount": n} for b, n in sorted(brands.items())], "generatedAt": now_utc().isoformat()}

    # -- offers --------------------------------------------------------------
    def offer_out(self, ctx: Dict[str, Any], o: Offer, product: Optional[Product] = None) -> Dict[str, Any]:
        p = product or (self.db.get(Product, o.product_id) if o.product_id else None)
        card = self.card(ctx, p, max(1, o.min_quantity)) if p is not None and p.is_active and p.store_id == o.store_id else None
        list_minor = to_minor(p.price) if p is not None else None
        offer_minor = offer_unit_price(o, list_minor) if list_minor is not None else None
        save = (list_minor - offer_minor) if list_minor is not None and offer_minor is not None else None
        return {"id": o.id, "title": o.title, "description": o.description, "label": o.discount_label, "discountType": o.discount_type,
                "discountValue": o.discount_value, "category": o.category, "productId": o.product_id, "product": card,
                "originalPriceMinor": list_minor, "offerPriceMinor": offer_minor, "savingsMinor": save,
                "discountPercent": round(save * 100 / list_minor) if save and list_minor else None, "minQuantity": o.min_quantity,
                "conditions": o.conditions, "stackable": o.stackable, "validFrom": o.valid_from.isoformat() if o.valid_from else None,
                "validUntil": o.valid_until.isoformat() if o.valid_until else None, "couponCode": o.coupon_code, "imageUrl": o.image_url or (p.image_url if p else None),
                "status": offer_status(o, ctx["today"]), "pricingNote": None if offer_minor is not None or not o.product_id else "This offer does not lower the current listed price."}

    def offers(self, store_id: str) -> Dict[str, Any]:
        store = self.store(store_id)
        ctx = self._load(store)
        items = [self.offer_out(ctx, o) for o in sorted(ctx["offers"], key=lambda o: (o.valid_until or date.max, o.id))]
        return {"storeId": store_id, "items": items, "validatedAt": now_utc().isoformat(), "validOn": ctx["today"].isoformat(), "isDemo": store.data_mode == "demo",
                "note": "Only offers that are active today are listed. Prices are the store's listed prices; final billing happens at checkout."}

    # -- pricing -------------------------------------------------------------
    def prices(self, store_id: str, product_ids: Sequence[str]) -> Dict[str, Any]:
        store = self.store(store_id)
        ctx = self._load(store)
        prods = self.products_by_ids(store_id, product_ids)
        return {"storeId": store_id, "prices": {pid: self.card(ctx, p)["price"] for pid, p in prods.items()},
                "missing": [i for i in product_ids if i not in prods], "generatedAt": now_utc().isoformat()}

    def compare(self, store_id: str, product_ids: Optional[Sequence[str]] = None, query: Optional[str] = None, available_only: bool = False,
                limit: int = 10) -> Dict[str, Any]:
        """Cheapest valid price among matching products of THIS store's catalogue (never a market-wide claim)."""
        store = self.store(store_id)
        ctx = self._load(store)
        if product_ids:
            prods = list(self.products_by_ids(store_id, product_ids).values())
        elif query:
            res = self.list_products(store_id, q=query, page_size=60)
            prods = [self.db.get(Product, c["id"]) for c in res["items"]]
        else:
            raise InvalidStateError("Give product ids or a search query to compare")
        cards = [self.card(ctx, p) for p in prods if p is not None]
        if available_only:
            cards = [c for c in cards if c["availability"]["state"] in ("in_stock", "low_stock")]
        priced = [c for c in cards if c["price"]["effectivePriceMinor"] is not None]
        unpriced = [c for c in cards if c["price"]["effectivePriceMinor"] is None]
        priced.sort(key=lambda c: (c["price"]["effectivePriceMinor"], c["id"]))
        cheapest = priced[0] if priced else None
        units = {c["price"]["unitPrice"]["unit"] for c in priced if c["price"]["unitPrice"]}
        comparable = len(units) == 1 and all(c["price"]["unitPrice"] for c in priced)
        best_unit = min(priced, key=lambda c: (c["price"]["unitPrice"]["perMinor"], c["id"])) if comparable and priced else None
        explanation = None
        if cheapest is None:
            explanation = "None of the matching products has a listed price in this store."
        elif best_unit and best_unit["id"] != cheapest["id"]:
            explanation = (f"{cheapest['name']} has the lowest pack price, but {best_unit['name']} is cheaper per "
                           f"{best_unit['price']['unitPrice']['basis']}.")
        return {"storeId": store_id, "query": query, "items": priced[:limit] + unpriced[: max(0, limit - len(priced))], "cheapest": cheapest,
                "bestUnitPrice": best_unit, "unitPricesComparable": comparable, "unpricedCount": len(unpriced), "explanation": explanation,
                "scope": f"Listed prices in {store.name} only - not other stores or the wider market.", "availableOnly": available_only,
                "generatedAt": now_utc().isoformat()}

    def cart_quote(self, store_id: str, lines: Sequence[Tuple[str, int]]) -> Dict[str, Any]:
        store = self.store(store_id)
        ctx = self._load(store)
        prods = self.products_by_ids(store_id, [pid for pid, _ in lines])
        out, missing = [], []
        sub_list = sub_eff = 0
        unpriced = 0
        for pid, qty in lines:
            p = prods.get(pid)
            if p is None:
                missing.append(pid)
                continue
            c = self.card(ctx, p, qty)
            pr = c["price"]
            line_list = pr["listPriceMinor"] * qty if pr["listPriceMinor"] is not None else None
            line_eff = pr["effectivePriceMinor"] * qty if pr["effectivePriceMinor"] is not None else None
            if line_list is None:
                unpriced += 1
            else:
                sub_list += line_list
                sub_eff += line_eff
            out.append({"productId": pid, "quantity": qty, "product": c, "lineListMinor": line_list, "lineEffectiveMinor": line_eff})
        return {"storeId": store_id, "lines": out, "missingProductIds": missing, "subtotalListMinor": sub_list, "subtotalEffectiveMinor": sub_eff,
                "savingsMinor": sub_list - sub_eff, "unpricedLines": unpriced, "currency": CURRENCY,
                "note": "Estimate from the store's listed prices. Adding to the cart does not reserve stock; the final bill is produced at checkout.",
                "generatedAt": now_utc().isoformat()}

    # -- home ----------------------------------------------------------------
    def home(self, store_id: str) -> Dict[str, Any]:
        store = self.store(store_id)
        ctx = self._load(store)
        cats = self.categories(store_id)
        prods = self._active_products(store_id)
        cards = [self.card(ctx, p) for p in prods]
        rank = {"in_stock": 0, "low_stock": 1, "unknown": 2, "out_of_stock": 3}
        featured = sorted(cards, key=lambda c: (not c["price"]["hasOffer"], rank[c["availability"]["state"]], c["price"]["effectivePriceMinor"] is None, c["name"]))[:8]
        offers = self.offers(store_id)["items"][:6]
        updates: List[Dict[str, Any]] = []
        st = self.open_status(store)
        if st["status"] == "open" and st.get("closesAt"):
            updates.append({"kind": "hours", "title": st["label"], "detail": store.operating_hours_label})
        by_dept: Dict[str, List[str]] = {}
        for c in cards:
            if c["department"]:
                by_dept.setdefault(c["department"], []).append(c["availability"]["state"])
        for d, states in sorted(by_dept.items()):
            if states and all(s == "out_of_stock" for s in states):
                updates.append({"kind": "availability", "title": f"{d}: not seen on shelves right now", "detail": "Ask a team member - more may be in the stockroom."})
        try:
            from services.customers import PublicStoreService

            q = PublicStoreService(self.db).queues(store_id)
            if q["dataAvailable"] and q["recommendedCounterName"]:
                best = next(c for c in q["counters"] if c["isRecommended"])
                updates.append({"kind": "checkout", "title": f"Shortest checkout wait: {q['recommendedCounterName']}",
                                "detail": f"About {best['estimatedWaitMins']} min, estimated from checkout cameras."})
        except Exception:  # noqa: BLE001 - queue data is optional on the home page
            pass
        return {"store": self.store_out(store), "departments": cats["departments"], "featured": featured, "offers": offers, "updates": updates,
                "productCount": len(cards), "isDemo": store.data_mode == "demo", "generatedAt": now_utc().isoformat()}
