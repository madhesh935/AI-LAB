"""Customer PWA API - PUBLIC data only (see services/customers.py for what is deliberately never returned)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Header, Query, Request

from api.deps import DbSession
from schemas.customer import CustomerChatRequest, parse_ids, parse_lines
from schemas.platform import AssistanceCreate, OfferOut
from services.customer_catalog import CatalogService
from services.customers import HELP_CATEGORIES, CustomerService, PublicStoreService
from services.store_map import RouteService

public = APIRouter(prefix="/api/public/stores", tags=["customer"])
router = APIRouter(prefix="/api/customer", tags=["customer"])


@public.get("")
def stores(db: DbSession) -> List[Dict[str, Any]]:
    return PublicStoreService(db).stores()


@public.get("/{store_id}")
def store(store_id: str, db: DbSession) -> Dict[str, Any]:
    return PublicStoreService(db).store(store_id)


@public.get("/{store_id}/layout")
def layout(store_id: str, db: DbSession) -> Dict[str, Any]:
    return PublicStoreService(db).layout(store_id)


@public.get("/{store_id}/queues")
def queues(store_id: str, db: DbSession) -> Dict[str, Any]:
    return PublicStoreService(db).queues(store_id)


@public.get("/{store_id}/offers", response_model=List[OfferOut])
def offers(store_id: str, db: DbSession):
    return PublicStoreService(db).offers(store_id)


@public.get("/{store_id}/categories")
def categories(store_id: str, db: DbSession) -> List[Dict[str, Any]]:
    return PublicStoreService(db).categories(store_id)


@public.get("/{store_id}/products")
def products(store_id: str, db: DbSession, q: Optional[str] = Query(None, max_length=80), category: Optional[str] = Query(None, max_length=80),
             availability: Optional[str] = Query(None, pattern="^(all|in_stock|low_stock|out_of_stock|unknown)$")) -> List[Dict[str, Any]]:
    """Product catalogue with shelf location and a labelled SHELF availability status (never counts or stockroom quantities)."""
    return PublicStoreService(db).products(store_id, q, category, availability)


@public.get("/{store_id}/products/{product_id}")
def product(store_id: str, product_id: str, db: DbSession) -> Dict[str, Any]:
    from core.errors import NotFoundError

    for p in PublicStoreService(db).products(store_id):
        if p["id"] == product_id:
            return p
    raise NotFoundError("Product", product_id)


@router.post("/assistance", status_code=201)
def create_assistance(body: AssistanceCreate, db: DbSession, idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key", max_length=80)) -> Dict[str, Any]:
    """Creates the request AND its staff task (shared task engine). A retried submit with the same Idempotency-Key returns the first request."""
    return {"success": True, "request": CustomerService(db).create_assistance(body, idempotency_key)}


@router.get("/assistance/{status_ref}")
def get_assistance(status_ref: str, db: DbSession) -> Dict[str, Any]:
    """Read a request back with its long random reference (the short request id alone is not enough)."""
    return CustomerService(db).get_assistance(status_ref)


@router.patch("/assistance/{status_ref}/cancel")
def cancel_assistance(status_ref: str, db: DbSession) -> Dict[str, Any]:
    """The shopper withdraws a request that is not yet in progress; the linked staff task is cancelled too."""
    return CustomerService(db).cancel_assistance(status_ref)


@router.get("/help-categories")
def help_categories() -> List[Dict[str, str]]:
    return [{"id": k, "label": v} for k, v in HELP_CATEGORIES.items()]


# ---------------------------------------------------------------------------------------- Customer PWA v2 (catalogue, pricing, map, routes)
store = APIRouter(prefix="/api/customer/stores/{store_id}", tags=["customer"])


@store.get("/home")
def home(store_id: str, db: DbSession) -> Dict[str, Any]:
    return CatalogService(db).home(store_id)


@store.get("/products")
def list_products(store_id: str, db: DbSession, q: Optional[str] = Query(None, max_length=80), category: Optional[str] = Query(None, max_length=80),
                  brand: Optional[str] = Query(None, max_length=80), availability: str = Query("all", pattern="^(all|in_stock|low_stock|out_of_stock|unknown|on_shelf)$"),
                  offers_only: bool = Query(False, alias="offersOnly"), sort: str = Query("relevance", pattern="^(relevance|name_asc|name_desc|price_asc|price_desc)$"),
                  page: int = Query(1, ge=1, le=10000), page_size: int = Query(24, alias="pageSize", ge=1, le=60)) -> Dict[str, Any]:
    """Server-side paginated catalogue of ACTIVE products. Search is case-insensitive, prefix/partial and plural tolerant over name, brand,
    category, department, keywords and SKU, ranked by match quality, with a 'did you mean' correction when nothing matches."""
    return CatalogService(db).list_products(store_id, q, category, brand, availability, offers_only, sort, page, page_size)


@store.get("/products/suggestions")
def product_suggestions(store_id: str, db: DbSession, q: str = Query("", max_length=80), limit: int = Query(6, ge=1, le=10)) -> Dict[str, Any]:
    return CatalogService(db).suggestions(store_id, q, limit)


@store.get("/products/{product_id}")
def product_detail(store_id: str, product_id: str, db: DbSession) -> Dict[str, Any]:
    return CatalogService(db).product(store_id, product_id)


@store.get("/categories")
def list_categories(store_id: str, db: DbSession) -> Dict[str, Any]:
    return CatalogService(db).categories(store_id)


@store.get("/offers")
def list_offers(store_id: str, db: DbSession) -> Dict[str, Any]:
    return CatalogService(db).offers(store_id)


@store.get("/prices")
def prices(store_id: str, db: DbSession, product_ids: str = Query(..., alias="productIds", max_length=4000)) -> Dict[str, Any]:
    return CatalogService(db).prices(store_id, parse_ids(product_ids))


@store.get("/price-comparison")
def price_comparison(store_id: str, db: DbSession, q: Optional[str] = Query(None, max_length=80), product_ids: Optional[str] = Query(None, alias="productIds", max_length=2000),
                     available_only: bool = Query(False, alias="availableOnly")) -> Dict[str, Any]:
    """Cheapest valid listed price (and best price per 100 ml / 100 g / piece) among matching products of THIS store only."""
    return CatalogService(db).compare(store_id, parse_ids(product_ids, 20) or None, q, available_only)


@store.get("/cart/quote")
def cart_quote(store_id: str, db: DbSession, items: str = Query("", max_length=6000)) -> Dict[str, Any]:
    """items = 'productId:qty,productId:qty'. Subtotals in paise; offers applied per line (min-quantity offers only when the quantity qualifies)."""
    return CatalogService(db).cart_quote(store_id, parse_lines(items))


@store.get("/map")
def store_map(store_id: str, db: DbSession) -> Dict[str, Any]:
    return RouteService(db).map_out(store_id)


@store.get("/shelves/{shelf_id}/products")
def shelf_products(store_id: str, shelf_id: str, db: DbSession) -> Dict[str, Any]:
    return CatalogService(db).shelf_products(store_id, shelf_id)


@store.get("/product-locations")
def product_locations(store_id: str, db: DbSession, product_ids: str = Query(..., alias="productIds", max_length=4000)) -> Dict[str, Any]:
    return RouteService(db).product_locations(store_id, parse_ids(product_ids))


@store.get("/routes")
def product_route(store_id: str, db: DbSession, product_id: Optional[str] = Query(None, alias="productId", max_length=64),
                  shelf_id: Optional[str] = Query(None, alias="shelfId", max_length=64), start: Optional[str] = Query(None, max_length=120)) -> Dict[str, Any]:
    return RouteService(db).product_route(store_id, product_id, shelf_id, start)


@store.get("/cart-route")
def cart_route(store_id: str, db: DbSession, product_ids: str = Query("", alias="productIds", max_length=4000), start: Optional[str] = Query(None, max_length=120),
               end_at: Optional[str] = Query(None, alias="endAt", max_length=120), visited: str = Query("", max_length=4000)) -> Dict[str, Any]:
    """Shortest multi-stop walk through every mapped product (exact order up to 10 stops, labelled heuristic above). Unmapped items are listed, not routed."""
    return RouteService(db).cart_route(store_id, parse_ids(product_ids), start, end_at, parse_ids(visited, what="visited shelf ids"))


# ---------------------------------------------------------------------------------------- Shopping Copilot
@router.get("/copilot/status")
def customer_copilot_status(request: Request) -> Dict[str, Any]:
    return request.app.state.customer_copilot.status()


@router.post("/copilot/chat")
def customer_copilot_chat(body: CustomerChatRequest, request: Request) -> Dict[str, Any]:
    """Customer-safe tools only (catalogue, prices, offers, shelf status, locations, routes, checkout waits, prepare-help). Stateless."""
    return request.app.state.customer_copilot.chat(body.store_id, body.message, [t.model_dump() for t in body.history],
                                                   parse_ids(",".join(body.cart_product_ids)), body.start_node_id)


@router.post("/feedback", status_code=201)
def feedback(db: DbSession, payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    CustomerService(db).feedback(payload)
    return {"success": True, "message": "Thank you for your valuable feedback."}
