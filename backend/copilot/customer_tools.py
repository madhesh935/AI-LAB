"""Customer Shopping Copilot tools - a SEPARATE, read-only allowlist.

Nothing here can reach the Store Copilot registry (staff, alerts, tasks, cameras, reports, write actions), run SQL text or a shell.
Every tool validates its arguments with a strict Pydantic model and calls the same services the Customer PWA pages use, so the
Copilot can never disagree with the catalogue, offers, map or checkout pages.

Each result is {"tool", "data", "cards"?, "error"?, "ms"}. "data" is what the language model sees (compact; prices in rupees so the
grounding check can match the numbers it quotes); "cards" are the full product/route/offer payloads the app renders.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Literal, Optional, Type

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.orm import Session

from core.errors import AppError
from services.customer_catalog import CatalogService
from services.customers import HELP_CATEGORIES, PublicStoreService
from services.store_map import RouteService

ProductId = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._:\-]+$")


class Args(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class SearchArgs(Args):
    query: str = Field(min_length=1, max_length=80, description="Product, brand or category words, e.g. 'milk' or 'dove shampoo'")
    category: Optional[str] = Field(default=None, max_length=80)
    on_shelf_only: bool = False
    offers_only: bool = False
    limit: int = Field(default=5, ge=1, le=8)


class ProductArgs(Args):
    product_id: str = ProductId


class PriceArgs(Args):
    product_id: str = ProductId
    quantity: int = Field(default=1, ge=1, le=99)


class OffersArgs(Args):
    category: Optional[str] = Field(default=None, max_length=80)
    query: Optional[str] = Field(default=None, max_length=80)


class CompareArgs(Args):
    query: Optional[str] = Field(default=None, max_length=80, description="What to compare, e.g. 'shampoo'")
    product_ids: Optional[List[str]] = Field(default=None, max_length=10)
    on_shelf_only: bool = False


class RouteArgs(Args):
    product_id: str = ProductId
    start_node_id: Optional[str] = Field(default=None, max_length=120)


class CartRouteArgs(Args):
    product_ids: Optional[List[str]] = Field(default=None, max_length=60, description="Omit to use the shopper's current cart")
    start_node_id: Optional[str] = Field(default=None, max_length=120)
    end_at: Optional[Literal["checkout", "exit", "none"]] = "checkout"


class NoArgs(Args):
    pass


class HelpArgs(Args):
    category: Literal["cannot_find_product", "product_information", "product_not_available", "checkout_help", "navigation_help", "other"] = "other"
    product_id: Optional[str] = Field(default=None, max_length=64)
    zone: Optional[str] = Field(default=None, max_length=120)
    message: Optional[str] = Field(default=None, max_length=500)


@dataclass
class CustomerToolContext:
    db: Session
    store_id: str
    cart_product_ids: List[str]
    start_node_id: Optional[str] = None


@dataclass
class CustomerTool:
    name: str
    description: str
    args: Type[Args]
    fn: Callable[[CustomerToolContext, Any], Dict[str, Any]]


def rupees(minor: Optional[int]) -> Optional[float]:
    return None if minor is None else round(minor / 100, 2)


def brief(card: Dict[str, Any]) -> Dict[str, Any]:
    """What the model may quote about a product (no internal ids beyond the product id it needs for follow-up calls)."""
    pr, av, loc = card["price"], card["availability"], card.get("location")
    where = None
    if loc:
        parts = [loc.get("aisleLabel"), f"Shelf {loc['shelfLabel']}" if loc.get("shelfLabel") else None]
        where = ", ".join(p for p in parts if p) + (f" ({loc['section']})" if loc.get("section") else "")
    return {
        "product_id": card["id"], "name": card["name"], "brand": card.get("brand"), "pack": (card.get("pack") or {}).get("label") or card.get("unit"),
        "price_rupees": rupees(pr["effectivePriceMinor"]), "list_price_rupees": rupees(pr["listPriceMinor"]) if pr["hasOffer"] else None,
        "price_available": pr["priceAvailable"], "offer": pr["appliedOffers"][0]["title"] if pr["appliedOffers"] else None,
        "conditional_offer": pr["conditionalOffers"][0]["title"] if pr["conditionalOffers"] else None,
        "unit_price": (f"{rupees(pr['unitPrice']['perMinor'])} per {pr['unitPrice']['basis']}" if pr.get("unitPrice") else None),
        "shelf_status": av["label"], "shelf_status_seen_at": av.get("observedAt"), "location": where, "on_store_map": card.get("mapped", False),
    }


# ----------------------------------------------------------------------------- tool functions
def _search(ctx: CustomerToolContext, a: SearchArgs) -> Dict[str, Any]:
    res = CatalogService(ctx.db).list_products(ctx.store_id, q=a.query, category=a.category, availability="on_shelf" if a.on_shelf_only else "all",
                                               offers_only=a.offers_only, sort="relevance", page=1, page_size=a.limit)
    items = res["items"]
    data = {"query": a.query, "corrected_query": res["correctedQuery"], "total_matches": res["total"], "products": [brief(c) for c in items]}
    if not items:
        data["message"] = f"No product matching '{a.query}' is listed in this store."
    return {"data": data, "cards": {"products": items}}


def _details(ctx: CustomerToolContext, a: ProductArgs) -> Dict[str, Any]:
    p = CatalogService(ctx.db).product(ctx.store_id, a.product_id)
    d = brief(p)
    d.update({"description": p.get("description"), "all_locations": [f"{l.get('aisleLabel') or ''} Shelf {l['shelfLabel']}".strip() for l in p["locations"]],
              "offers": [{"title": o["title"], "conditions": o["conditions"], "valid_until": o["validUntil"]} for o in p["offers"]]})
    return {"data": d, "cards": {"products": [p]}}


def _availability(ctx: CustomerToolContext, a: ProductArgs) -> Dict[str, Any]:
    p = CatalogService(ctx.db).product(ctx.store_id, a.product_id)
    av = p["availability"]
    return {"data": {"product_id": p["id"], "name": p["name"], "shelf_status": av["label"], "seen_at": av["observedAt"], "is_stale": av["isStale"],
                     "basis": av["note"]}, "cards": {"products": [p]}}


def _price(ctx: CustomerToolContext, a: PriceArgs) -> Dict[str, Any]:
    svc = CatalogService(ctx.db)
    store = svc.store(ctx.store_id)
    c = svc.product(ctx.store_id, a.product_id)
    from database.models import Product

    p = ctx.db.get(Product, a.product_id)
    card = svc.card(svc._load(store), p, a.quantity)  # type: ignore[arg-type]
    pr = card["price"]
    return {"data": {"product_id": c["id"], "name": c["name"], "quantity": a.quantity, "price_available": pr["priceAvailable"],
                     "unit_price_rupees": rupees(pr["effectivePriceMinor"]), "list_price_rupees": rupees(pr["listPriceMinor"]),
                     "total_rupees": rupees(pr["effectivePriceMinor"] * a.quantity) if pr["effectivePriceMinor"] is not None else None,
                     "applied_offers": [o["title"] for o in pr["appliedOffers"]], "offers_needing_more_quantity": [o["title"] for o in pr["conditionalOffers"]]},
            "cards": {"products": [card]}}


def _offers(ctx: CustomerToolContext, a: OffersArgs) -> Dict[str, Any]:
    res = CatalogService(ctx.db).offers(ctx.store_id)
    items = res["items"]
    if a.category:
        c = a.category.strip().lower()
        items = [o for o in items if c in ((o.get("category") or "").lower(), ((o.get("product") or {}).get("department") or "").lower(),
                                            ((o.get("product") or {}).get("category") or "").lower())]
    if a.query:
        q = a.query.strip().lower()
        items = [o for o in items if q in f"{o['title']} {(o.get('product') or {}).get('name', '')} {o.get('category') or ''}".lower()]
    data = {"valid_on": res["validOn"], "count": len(items), "offers": [
        {"title": o["title"], "product": (o.get("product") or {}).get("name"), "offer_price_rupees": rupees(o["offerPriceMinor"]),
         "original_price_rupees": rupees(o["originalPriceMinor"]), "conditions": o["conditions"], "valid_until": o["validUntil"]} for o in items[:8]]}
    if not items:
        data["message"] = "No active offers match right now."
    return {"data": data, "cards": {"offers": items[:8], "products": [o["product"] for o in items[:8] if o.get("product")]}}


def _compare(ctx: CustomerToolContext, a: CompareArgs) -> Dict[str, Any]:
    res = CatalogService(ctx.db).compare(ctx.store_id, product_ids=a.product_ids, query=a.query, available_only=a.on_shelf_only, limit=6)
    data = {"scope": res["scope"], "compared": [brief(c) for c in res["items"]], "cheapest": brief(res["cheapest"]) if res["cheapest"] else None,
            "best_value_per_unit": brief(res["bestUnitPrice"]) if res["bestUnitPrice"] else None, "explanation": res["explanation"],
            "products_without_price": res["unpricedCount"]}
    if not res["items"]:
        data["message"] = "No matching products to compare in this store."
    return {"data": data, "cards": {"products": res["items"]}}


def _location(ctx: CustomerToolContext, a: ProductArgs) -> Dict[str, Any]:
    p = CatalogService(ctx.db).product(ctx.store_id, a.product_id)
    locs = [{"aisle": l.get("aisleLabel"), "shelf": l["shelfLabel"], "section": l.get("section"), "on_store_map": l["onMap"]} for l in p["locations"]]
    data = {"product_id": p["id"], "name": p["name"], "locations": locs}
    if not locs:
        data["message"] = "This product has no shelf location recorded. A team member can help find it."
    return {"data": data, "cards": {"products": [p]}}


def _route_brief(r: Dict[str, Any]) -> Dict[str, Any]:
    return {"route_available": r["routeAvailable"], "start": r["start"]["label"], "end": (r.get("end") or {}).get("label"),
            "stops": [{"order": s["order"], "shelf": s["shelfLabel"], "aisle": s.get("aisleLabel"), "section": s.get("section"),
                       "products": [p["name"] for p in s["products"]]} for s in r["stops"]],
            "total_distance_m": r["totalDistanceM"], "walk_minutes": r["estimatedWalkMinutes"], "ordering": r["optimization"],
            "first_directions": r["legs"][0]["directions"][:4] if r["legs"] else [],
            "not_on_map": [u["name"] for u in r["unmapped"] + r["unreachable"]], "note": r["positioning"]}


def _product_route(ctx: CustomerToolContext, a: RouteArgs) -> Dict[str, Any]:
    r = RouteService(ctx.db).product_route(ctx.store_id, product_id=a.product_id, start_node_id=a.start_node_id or ctx.start_node_id)
    return {"data": _route_brief(r), "cards": {"route": r, "routeProductIds": [a.product_id]}}


def _cart_route(ctx: CustomerToolContext, a: CartRouteArgs) -> Dict[str, Any]:
    ids = a.product_ids if a.product_ids is not None else ctx.cart_product_ids
    if not ids:
        return {"data": {"route_available": False, "message": "The cart is empty. Add products to plan a route."}}
    r = RouteService(ctx.db).cart_route(ctx.store_id, ids, a.start_node_id or ctx.start_node_id, a.end_at)
    return {"data": _route_brief(r), "cards": {"route": r, "routeProductIds": list(ids)}}


def _waits(ctx: CustomerToolContext, _a: NoArgs) -> Dict[str, Any]:
    q = PublicStoreService(ctx.db).queues(ctx.store_id)
    data = {"data_available": q["dataAvailable"], "recommended_counter": q.get("recommendedCounterName"), "note": q.get("note"),
            "counters": [{"name": c["name"], "status": c["status"], "people_waiting": c.get("queueLength"), "wait_minutes": c.get("estimatedWaitMins"),
                          "basis": c.get("waitBasis")} for c in q["counters"]]}
    if not q["dataAvailable"]:
        data["message"] = "Live checkout wait times are not available right now."
    return {"data": data, "cards": {"checkout": q}}


def _help(ctx: CustomerToolContext, a: HelpArgs) -> Dict[str, Any]:
    """PREPARES a prefilled help request. The shopper reviews it and presses 'Request Staff Assistance'; nothing is sent from here."""
    product = None
    if a.product_id:
        try:
            product = CatalogService(ctx.db).product(ctx.store_id, a.product_id)
        except AppError:
            product = None
    zone = a.zone or ((product or {}).get("location") or {}).get("zoneName")
    card = {"category": a.category, "categoryLabel": HELP_CATEGORIES[a.category], "productId": product["id"] if product else None,
            "productName": product["name"] if product else None, "zone": zone, "message": a.message or ""}
    return {"data": {"prepared": True, "submitted": False, "category": HELP_CATEGORIES[a.category], "product": card["productName"], "zone": zone,
                     "note": "A prefilled help request is ready. The shopper must press 'Request Staff Assistance' to send it."},
            "cards": {"help": card}}


REGISTRY: Dict[str, CustomerTool] = {t.name: t for t in [
    CustomerTool("search_products", "Search this store's product catalogue by product, brand or category words.", SearchArgs, _search),
    CustomerTool("get_product_details", "Full details of one product (price, offers, shelf status, location).", ProductArgs, _details),
    CustomerTool("get_product_availability", "Latest shelf-camera status of one product (not total stock).", ProductArgs, _availability),
    CustomerTool("get_product_price", "Listed price and the valid offer price of one product for a quantity.", PriceArgs, _price),
    CustomerTool("get_active_offers", "Offers valid today, optionally filtered by category or words.", OffersArgs, _offers),
    CustomerTool("compare_product_prices", "Compare prices (and price per 100 ml / 100 g / piece) of matching products in THIS store.", CompareArgs, _compare),
    CustomerTool("get_product_location", "Aisle and shelf of one product.", ProductArgs, _location),
    CustomerTool("get_product_route", "Walking route on the store map from the start point to one product's shelf.", RouteArgs, _product_route),
    CustomerTool("get_cart_route", "Multi-stop walking route through every product in the shopper's cart.", CartRouteArgs, _cart_route),
    CustomerTool("get_checkout_wait_times", "Checkout counters with estimated waits (only when checkout cameras report them).", NoArgs, _waits),
    CustomerTool("create_customer_help_request", "Prepare a staff help request for the shopper to review and send.", HelpArgs, _help),
]}


def tool_schemas() -> List[Dict[str, Any]]:
    out = []
    for t in REGISTRY.values():
        schema = t.args.model_json_schema()
        schema.pop("title", None)
        for p in schema.get("properties", {}).values():
            p.pop("title", None)
        out.append({"type": "function", "function": {"name": t.name, "description": t.description, "parameters": schema}})
    return out


def run_tool(ctx: CustomerToolContext, name: str, args: Any) -> Dict[str, Any]:
    t0 = time.perf_counter()
    tool = REGISTRY.get(name)
    if tool is None:
        return {"tool": name, "error": "unknown_tool", "message": f"'{name}' is not available to the shopping assistant", "ms": 0.0}
    try:
        parsed = tool.args.model_validate(args or {})
    except ValidationError as exc:
        return {"tool": name, "error": "invalid_arguments", "message": "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()[:4]),
                "ms": round((time.perf_counter() - t0) * 1000, 1)}
    try:
        out = tool.fn(ctx, parsed)
    except AppError as exc:
        return {"tool": name, "error": getattr(exc, "code", "error"), "message": str(getattr(exc, "message", exc)), "ms": round((time.perf_counter() - t0) * 1000, 1)}
    return {"tool": name, "arguments": parsed.model_dump(exclude_none=True), **out, "ms": round((time.perf_counter() - t0) * 1000, 1)}
