"""Customer PWA v2: catalogue, search, pricing, cart, store map + routing, Shopping Copilot, staff help loop."""

from __future__ import annotations

import itertools
import math
import random

import pytest
from fastapi.testclient import TestClient

from core.errors import InvalidStateError
from database.connection import Database
from main import create_app

S = "store-blr-104"
API = f"/api/customer/stores/{S}"


@pytest.fixture()
def shop(settings):
    """Demo seed + demo catalogue + prototype store map, all through the real opt-in commands."""
    from database.seed import seed_demo
    from database.seed_customer import seed_demo_catalog, seed_store_map

    seed_demo(settings)
    seed_demo_catalog(settings)
    seed_store_map(settings)
    with TestClient(create_app(settings)) as c:
        c.settings = settings
        yield c


def get(c, path, **params):
    r = c.get(path, params=params)
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------ catalogue + search
def test_pagination_reaches_every_active_product_exactly_once(shop):
    first = get(shop, f"{API}/products", pageSize=7, sort="name_asc")
    seen = []
    for page in range(1, first["totalPages"] + 1):
        seen += [p["id"] for p in get(shop, f"{API}/products", pageSize=7, page=page, sort="name_asc")["items"]]
    assert len(seen) == first["total"] == len(set(seen)) == 49
    assert first["hasMore"] and not get(shop, f"{API}/products", pageSize=7, page=first["totalPages"])["hasMore"]


def test_inactive_products_are_hidden(shop):
    from database.models import Product

    db = Database(shop.settings.database_url)
    with db.transaction() as s:
        s.get(Product, "prod-c42").is_active = False
    db.dispose()
    assert get(shop, f"{API}/products", q="bisleri")["total"] == 0
    assert shop.get(f"{API}/products/prod-c42").status_code == 404


@pytest.mark.parametrize("q,expect", [
    ("milk", "Milk"), ("MILK", "Milk"), ("mil", "Mil"), ("shampoos", "Shampoo"), ("amul", "Amul"), ("doodh", "Milk"),
    ("dove", "Dove"), ("hair care", "Shampoo"),
])
def test_search_is_case_insensitive_partial_plural_brand_and_alias_aware(shop, q, expect):
    res = get(shop, f"{API}/products", q=q)
    assert res["total"] >= 1
    assert expect.lower() in res["items"][0]["name"].lower()


def test_search_ranks_exact_category_matches_first(shop):
    names = [p["name"] for p in get(shop, f"{API}/products", q="milk")["items"]]
    assert "Paneer" not in names[0] and "Silk" not in names[0], names  # real milk before 'Milky Mist' / 'Dairy Milk'


def test_did_you_mean_and_no_result(shop):
    res = get(shop, f"{API}/products", q="shampo0")
    assert res["total"] == 0 or res["correctedQuery"]
    fixed = get(shop, f"{API}/products", q="rce")
    assert fixed["correctedQuery"] == "rice" and fixed["total"] == 2
    none = get(shop, f"{API}/products", q="xylophone")
    assert none["total"] == 0 and none["items"] == []
    sug = get(shop, f"{API}/products/suggestions", q="sham")
    assert [p["name"] for p in sug["products"]] and all("Shampoo" in p["name"] for p in sug["products"])
    assert get(shop, f"{API}/products/suggestions", q="")["products"] == []


def test_like_wildcards_in_queries_are_inert(shop):
    assert get(shop, f"{API}/products", q="%")["total"] == 49  # '%' is not a word: no filter, not a wildcard injection
    hostile = get(shop, f"{API}/products", q="'; DROP TABLE products; --")
    assert hostile["total"] == 0  # bound parameters: the words are searched for, never executed
    assert get(shop, f"{API}/products")["total"] == 49


def test_filters_and_sorting(shop):
    dairy = get(shop, f"{API}/products", category="Dairy & Refrigerated", pageSize=60)
    assert dairy["total"] >= 7 and all(p["department"] == "Dairy & Refrigerated" or p["category"] == "Dairy & Refrigerated" for p in dairy["items"])
    amul = get(shop, f"{API}/products", brand="Amul", pageSize=60)
    assert amul["total"] == 3 and {p["brand"] for p in amul["items"]} == {"Amul"}
    on_shelf = get(shop, f"{API}/products", availability="on_shelf", pageSize=60)["items"]
    assert on_shelf and all(p["availability"]["state"] in ("in_stock", "low_stock") for p in on_shelf)
    out = get(shop, f"{API}/products", availability="out_of_stock", pageSize=60)["items"]
    assert {p["id"] for p in out} >= {"prod-c30", "prod-c31", "prod-c32"}  # the household shelf observation is 0 units
    offers = get(shop, f"{API}/products", offersOnly=True, pageSize=60)["items"]
    assert offers and all(p["price"]["hasOffer"] for p in offers)
    asc = get(shop, f"{API}/products", sort="price_asc", pageSize=60)["items"]
    prices = [p["price"]["effectivePriceMinor"] for p in asc]
    priced = [x for x in prices if x is not None]
    assert priced == sorted(priced) and prices[-1] is None  # "Price unavailable" sorts last
    desc = [p["price"]["effectivePriceMinor"] for p in get(shop, f"{API}/products", sort="price_desc", pageSize=60)["items"] if p["price"]["effectivePriceMinor"] is not None]
    assert desc == sorted(desc, reverse=True)
    names = [p["name"] for p in get(shop, f"{API}/products", sort="name_asc", pageSize=60)["items"]]
    assert names == sorted(names, key=str.lower)
    assert shop.get(f"{API}/products", params={"sort": "drop table"}).status_code == 422


def test_availability_labels_and_basis(shop):
    p = get(shop, f"{API}/products/prod-01")
    assert p["availability"]["label"] in ("Available on Shelf", "Limited Visible Stock", "Not Seen on Shelf", "Availability Unknown")
    assert p["availability"]["basis"] == "shelf_camera" and p["availability"]["observedAt"]
    unmapped = get(shop, f"{API}/products/prod-c43")
    assert unmapped["availability"]["state"] == "unknown" and unmapped["availability"]["label"] == "Availability Unknown"
    assert unmapped["location"] is None and not unmapped["mapped"]


def test_real_store_gets_no_demo_catalogue_and_unknown_availability(client):
    from database.seed_customer import seed_catalog_into

    db = Database(client.settings.database_url)
    with db.transaction() as s, pytest.raises(InvalidStateError):
        seed_catalog_into(s, "store-a")
    db.dispose()
    assert get(client, "/api/customer/stores/store-a/products")["total"] == 0


# ------------------------------------------------------------------ pricing + offers
def test_missing_price_is_never_invented(shop):
    mango = get(shop, f"{API}/products/prod-c03")
    assert mango["price"]["priceAvailable"] is False and mango["price"]["effectivePriceMinor"] is None and mango["price"]["listPriceMinor"] is None


def test_offer_validity_window(shop):
    ids = {o["id"] for o in get(shop, f"{API}/offers")["items"]}
    assert {"off-c01", "off-c02", "off-c03", "off-c04", "off-c05"} <= ids
    assert "off-c06" not in ids and "off-c07" not in ids  # expired / scheduled
    public = {o["id"] for o in get(shop, f"/api/public/stores/{S}/offers")}
    assert "off-c06" not in public and "off-c07" not in public


def test_offer_stacking_rules_and_min_quantity(shop):
    lays = get(shop, f"{API}/products/prod-c33")["price"]
    # 10% (stackable) then Rs 5 off (stackable): 2000 -> 1800 -> 1300 paise
    assert lays["listPriceMinor"] == 2000 and lays["effectivePriceMinor"] == 1300 and lays["stacked"] is True
    dove = get(shop, f"{API}/products/prod-c26")["price"]
    assert dove["effectivePriceMinor"] == 17900 and not dove["stacked"]
    maggi = get(shop, f"{API}/products/prod-c36")["price"]
    assert maggi["effectivePriceMinor"] == 5040  # only the category 10% applies to one pack
    assert [o["id"] for o in maggi["conditionalOffers"]] == ["off-c04"]
    q = get(shop, f"{API}/cart/quote", items="prod-c36:3")
    assert q["lines"][0]["lineEffectiveMinor"] == 3 * 4760  # 15% beats 10% at quantity 3 (non-stackable: best single offer)
    almond = get(shop, f"{API}/cart/quote", items="prod-01:1,prod-01:5")
    assert almond["lines"][0]["quantity"] == 1 and almond["lines"][0]["lineEffectiveMinor"] == 24000  # BUY 2 offer needs 2


def test_cart_quote_totals_in_minor_units(shop):
    q = get(shop, f"{API}/cart/quote", items="prod-c07:2,prod-c03:1,prod-c33:3,nope-123:1")
    assert q["currency"] == "INR" and q["missingProductIds"] == ["nope-123"] and q["unpricedLines"] == 1
    assert q["subtotalListMinor"] == 2 * 5600 + 3 * 2000
    assert q["subtotalEffectiveMinor"] == 2 * 5200 + 3 * 1300
    assert q["savingsMinor"] == q["subtotalListMinor"] - q["subtotalEffectiveMinor"]
    assert "reserve" in q["note"].lower()
    assert shop.get(f"{API}/cart/quote", params={"items": "prod-c07:0"}).status_code == 400
    assert shop.get(f"{API}/cart/quote", params={"items": "prod-c07:abc"}).status_code == 400


def test_price_comparison_is_store_scoped_and_unit_aware(shop):
    cmp_ = get(shop, f"{API}/price-comparison", q="shampoo")
    assert cmp_["cheapest"]["id"] == "prod-c26" and cmp_["bestUnitPrice"]["id"] == "prod-c27"
    assert cmp_["unitPricesComparable"] and "per 100 ml" in cmp_["explanation"]
    assert "only" in cmp_["scope"] and "market" in cmp_["scope"]


# ------------------------------------------------------------------ map + routing
def test_map_is_persisted_valid_and_not_regenerated(shop):
    a = get(shop, f"{API}/map")
    b = get(shop, f"{API}/map")
    assert a["validation"] == {"ok": True, "problems": []}
    assert a["layout"]["id"] == b["layout"]["id"] and a["layout"]["isPrototype"] is True
    assert a["unplacedShelves"] == 0 and len(a["shelves"]) == 20
    node_ids = {n["id"] for n in a["nodes"]}
    assert all(s["accessNodeId"] in node_ids for s in a["shelves"])
    assert a["defaultStartNodeId"] and any(sp["type"] == "entrance" for sp in a["startPoints"])


def test_product_locations_and_unmapped_reason(shop):
    loc = get(shop, f"{API}/product-locations", productIds="prod-c07,prod-c43,ghost-1")
    assert loc["items"]["prod-c07"]["mapped"] and loc["items"]["prod-c07"]["locations"][0]["shelfLabel"] == "D1-Milk"
    assert loc["items"]["prod-c43"] == {**loc["items"]["prod-c43"], "mapped": False, "reason": "no_shelf_mapping"}
    assert loc["items"]["ghost-1"]["reason"] == "not_in_catalog"


def test_tapping_a_shelf_lists_its_active_products(shop):
    milk_shelf = get(shop, f"{API}/product-locations", productIds="prod-c07")["items"]["prod-c07"]["locations"][0]["shelfId"]
    res = get(shop, f"{API}/shelves/{milk_shelf}/products")
    ids = [p["id"] for p in res["items"]]
    assert "prod-c07" in ids and len(ids) == len(set(ids))
    assert all(p["mapped"] for p in res["items"])
    assert shop.get(f"{API}/shelves/no-such-shelf/products").status_code == 404


def _edge_set(m):
    return {frozenset((e["source"], e["target"])) for e in m["edges"]}


def test_route_follows_walkable_edges_and_never_crosses_shelves(shop):
    from services.store_map import _segment_hits_rect

    m = get(shop, f"{API}/map")
    edges = _edge_set(m)
    nodes = {n["id"]: n for n in m["nodes"]}
    r = get(shop, f"{API}/cart-route", productIds="prod-c07,prod-c26,prod-c33,prod-c43,prod-01,prod-c14,prod-c38", endAt="checkout")
    assert r["routeAvailable"] and r["unmapped"][0]["productId"] == "prod-c43"
    for leg in r["legs"]:
        for a, b in zip(leg["nodeIds"], leg["nodeIds"][1:]):
            assert frozenset((a, b)) in edges
            na, nb = nodes[a], nodes[b]
            for s in m["shelves"]:
                assert not _segment_hits_rect(na["x"], na["y"], nb["x"], nb["y"], s["x"], s["y"], s["width"], s["height"])
        assert leg["directions"][0].startswith("1. Start at")
    assert r["legs"][-1]["isFinal"] and r["end"]["type"] == "checkout"
    assert sum(l["distanceM"] for l in r["legs"]) == pytest.approx(r["totalDistanceM"], abs=0.05 * len(r["legs"]) + 0.05)  # per-leg rounding
    assert r["optimization"] == "exact_held_karp" and "live position" in r["positioning"]


def test_multi_stop_dedupes_shared_shelves_and_numbers_stops(shop):
    r = get(shop, f"{API}/cart-route", productIds="prod-c07,prod-c08,prod-c09,prod-c26")  # three milks share Shelf D1
    d1 = [s for s in r["stops"] if s["shelfLabel"] == "D1-Milk"]
    assert len(d1) == 1 and set(d1[0]["productIds"]) == {"prod-c07", "prod-c08", "prod-c09"}
    orders = sorted({s["order"] for s in r["stops"]})
    assert orders == list(range(1, len(orders) + 1))


def test_start_point_changes_and_visited_stops(shop):
    m = get(shop, f"{API}/map")
    exit_node = next(sp["nodeId"] for sp in m["startPoints"] if sp["type"] == "exit")
    a = get(shop, f"{API}/cart-route", productIds="prod-c07,prod-c38")
    b = get(shop, f"{API}/cart-route", productIds="prod-c07,prod-c38", start=exit_node)
    assert a["start"]["type"] == "entrance" and b["start"]["nodeId"] == exit_node and a["totalDistanceM"] != b["totalDistanceM"]
    first = a["stops"][0]["shelfId"]
    c = get(shop, f"{API}/cart-route", productIds="prod-c07,prod-c38", visited=first)
    assert [v["shelfId"] for v in c["visitedStops"]] == [first] and all(s["shelfId"] != first for s in c["stops"])
    assert shop.get(f"{API}/cart-route", params={"productIds": "prod-c07", "start": "nowhere"}).status_code == 409


def test_no_path_is_reported_not_faked(shop):
    from database.models import MapEdge, ShelfPlacement
    from sqlalchemy import delete, or_, select

    db = Database(shop.settings.database_url)
    with db.transaction() as s:
        pl = s.scalars(select(ShelfPlacement).where(ShelfPlacement.shelf_id == "shf-f3")).first()
        s.execute(delete(MapEdge).where(or_(MapEdge.source_node_id == pl.access_node_id, MapEdge.target_node_id == pl.access_node_id)))
    db.dispose()
    r = get(shop, f"{API}/cart-route", productIds="prod-c38,prod-c07")
    assert [u["productId"] for u in r["unreachable"]] == ["prod-c38"] and r["unreachable"][0]["reason"] == "no_walkable_path"
    assert all(s["shelfId"] != "shf-f3" for s in r["stops"])
    assert shop.get(f"{API}/routes", params={"shelfId": "shf-f3"}).status_code == 409
    assert get(shop, f"{API}/map")["validation"]["ok"] is False


def test_empty_cart_and_store_without_map(shop, client):
    r = get(shop, f"{API}/cart-route", productIds="")
    assert r["routeAvailable"] is False and r["message"]
    assert client.get("/api/customer/stores/store-a/map").status_code == 404


def test_stop_ordering_exact_for_small_and_labelled_heuristic_for_large():
    from services.store_map import order_stops

    rnd = random.Random(7)
    pts = {f"n{i}": (rnd.uniform(0, 100), rnd.uniform(0, 100)) for i in range(7)}
    dm = {(a, b): math.dist(pts[a], pts[b]) for a in pts for b in pts}
    stops = [f"n{i}" for i in range(1, 7)]
    order, method = order_stops(dm, "n0", stops, None)
    best = min(itertools.permutations(stops), key=lambda p: sum(dm[(x, y)] for x, y in zip(("n0",) + p, p)))
    cost = lambda seq: sum(dm[(x, y)] for x, y in zip(["n0"] + seq, seq))  # noqa: E731
    assert method == "exact_held_karp" and cost(order) == pytest.approx(cost(list(best)))
    big = {f"m{i}": (rnd.uniform(0, 100), rnd.uniform(0, 100)) for i in range(14)}
    dm2 = {(a, b): math.dist(big[a], big[b]) for a in big for b in big}
    order2, method2 = order_stops(dm2, "m0", [f"m{i}" for i in range(1, 14)], None)
    assert method2 == "nearest_neighbor_2opt" and sorted(order2) == sorted(f"m{i}" for i in range(1, 14))


# ------------------------------------------------------------------ Shopping Copilot
def chat(c, message, cart=()):
    r = c.post("/api/customer/copilot/chat", json={"storeId": S, "message": message, "cartProductIds": list(cart)})
    assert r.status_code == 200, r.text
    return r.json()


def test_customer_copilot_has_only_customer_safe_tools(shop):
    from copilot.customer_tools import REGISTRY
    from copilot.tools import REGISTRY as STORE_REGISTRY

    expected = {"search_products", "get_product_details", "get_product_availability", "get_product_price", "get_active_offers", "compare_product_prices",
                "get_product_location", "get_product_route", "get_cart_route", "get_checkout_wait_times", "create_customer_help_request"}
    assert set(REGISTRY) == expected
    management = {n for n in STORE_REGISTRY if n not in expected}
    assert management and not (management & set(REGISTRY))
    st = get(shop, "/api/customer/copilot/status")
    assert set(st["tools"]) == expected and st["name"] == "RetailEdge Shopping Copilot"


def test_customer_copilot_rejects_unknown_tools_and_bad_arguments(shop):
    from copilot.customer_tools import CustomerToolContext, run_tool

    db = Database(shop.settings.database_url)
    with db.transaction() as s:
        ctx = CustomerToolContext(s, S, [])
        assert run_tool(ctx, "assign_staff_task", {"shelf": "B2", "employee": "x"})["error"] == "unknown_tool"
        assert run_tool(ctx, "get_store_overview", {})["error"] == "unknown_tool"
        assert run_tool(ctx, "search_products", {"query": "milk", "sql": "DROP TABLE products"})["error"] == "invalid_arguments"
        assert run_tool(ctx, "get_product_details", {"product_id": "x'; DROP TABLE products;--"})["error"] == "invalid_arguments"
        assert run_tool(ctx, "get_product_details", {"product_id": "prod-c07"})["data"]["name"].startswith("Amul Taaza")
    db.dispose()


def test_customer_copilot_answers_are_grounded_in_store_data(shop):
    where = chat(shop, "Where can I find milk?")
    assert "Milk" in where["answer"] and "Aisle 2" in where["answer"] and where["cards"]["products"]
    cheap = chat(shop, "Which shampoo is cheapest?")
    assert "Dove" in cheap["answer"] and "₹179" in cheap["answer"] and "market" not in cheap["answer"].lower()
    offers = chat(shop, "Show me today's offers")
    assert "offer" in offers["answer"].lower() and offers["cards"]["offers"]
    assert "Weekend Juice Fest" not in offers["answer"]
    route = chat(shop, "Find the shortest route for my cart", cart=["prod-c07", "prod-c26", "prod-c43"])
    assert route["cards"]["route"]["stops"] and "Truffle" in route["answer"]
    mapped_route = get(shop, f"{API}/cart-route", productIds="prod-c07,prod-c26,prod-c43", endAt="checkout")
    assert route["cards"]["route"]["totalDistanceM"] == mapped_route["totalDistanceM"]  # the SAME routing service as the Map page
    unknown = chat(shop, "Where can I find unicorn steaks?")
    assert "couldn't find" in unknown["answer"] and not unknown["cards"]["products"]
    helpme = chat(shop, "I need help finding a product")
    assert helpme["cards"]["help"]["category"] == "cannot_find_product" and "Request Staff Assistance" in helpme["answer"]
    from database.models import CustomerAssistanceRequest
    from sqlalchemy import func, select

    db = Database(shop.settings.database_url)
    with db.transaction() as s:
        assert s.scalar(select(func.count()).select_from(CustomerAssistanceRequest)) == 1  # only the seed row: prepare != submit
    db.dispose()


def test_customer_copilot_validates_input(shop):
    assert shop.post("/api/customer/copilot/chat", json={"storeId": S, "message": ""}).status_code == 422
    assert shop.post("/api/customer/copilot/chat", json={"storeId": S, "message": "x" * 501}).status_code == 422
    assert shop.post("/api/customer/copilot/chat", json={"storeId": "nope", "message": "milk"}).status_code == 404
    assert shop.post("/api/customer/copilot/chat", json={"storeId": S, "message": "milk", "cartProductIds": ["a b"]}).status_code == 400


# ------------------------------------------------------------------ help request <-> staff task loop
def _task_for(c, request_id):
    items = get(c, f"/api/stores/{S}/tasks", category="customer_assistance")["items"]
    return next(t for t in items if t["customerRequestId"] == request_id)


def test_help_request_creates_shared_task_and_syncs_every_staff_step(shop):
    body = {"storeId": S, "category": "cannot_find_product", "description": "Cannot find paneer", "aisleOrZone": "Aisle 2", "productId": "prod-c12"}
    r = shop.post("/api/customer/assistance", json=body, headers={"Idempotency-Key": "help-abc-123"})
    assert r.status_code == 201
    req = r.json()["request"]
    ref = req["statusRef"]
    assert len(ref) >= 24 and req["status"] in ("submitted", "assigned") and "on the way" not in req["statusLabel"].lower()
    again = shop.post("/api/customer/assistance", json=body, headers={"Idempotency-Key": "help-abc-123"}).json()["request"]
    assert again["requestId"] == req["requestId"] and again["replayed"]

    task = _task_for(shop, req["requestId"])
    assert task["category"] == "customer_assistance" and task["customerRequestStatus"] == req["status"] and "Paneer" in task["title"]
    emp = task["assignedEmployeeId"] or "STF-07"
    assert shop.post(f"/api/tasks/{task['id']}/accept", json={"employeeId": emp}).status_code == 200
    st = get(shop, f"/api/customer/assistance/{ref}")
    assert st["status"] == "assigned" and st["statusLabel"] == "Assigned to a team member"  # never 'on the way' without the staff action

    other = "STF-06" if emp != "STF-06" else "STF-07"
    assert shop.post(f"/api/tasks/{task['id']}/on-the-way", json={"employeeId": other}).status_code == 409
    otw = shop.post(f"/api/tasks/{task['id']}/on-the-way", json={"employeeId": emp})
    assert otw.status_code == 200 and otw.json()["task"]["customerRequestStatus"] == "on_the_way"
    st = get(shop, f"/api/customer/assistance/{ref}")
    assert st["status"] == "on_the_way" and st["statusLabel"] == "Staff on the way" and st["canCancel"]

    assert shop.post(f"/api/tasks/{task['id']}/start", json={"employeeId": emp}).status_code == 200
    st = get(shop, f"/api/customer/assistance/{ref}")
    assert st["status"] == "in_progress" and not st["canCancel"]
    assert shop.patch(f"/api/customer/assistance/{ref}/cancel").status_code == 409
    assert shop.post(f"/api/tasks/{task['id']}/complete", json={"employeeId": emp, "completionNotes": "Shown to shelf D2"}).status_code == 200
    st = get(shop, f"/api/customer/assistance/{ref}")
    assert st["status"] == "resolved" and [h["status"] for h in st["history"]][-1] == "resolved"
    assert "on_the_way" in [h["status"] for h in st["history"]]


def test_customer_can_cancel_and_the_staff_task_is_cancelled(shop):
    req = shop.post("/api/customer/assistance", json={"storeId": S, "category": "checkout_help", "description": "Card machine issue"}).json()["request"]
    out = shop.patch(f"/api/customer/assistance/{req['statusRef']}/cancel")
    assert out.status_code == 200 and out.json()["status"] == "cancelled"
    task = next(t for t in get(shop, f"/api/stores/{S}/tasks", category="customer_assistance", status="cancelled")["items"] if t["customerRequestId"] == req["requestId"])
    assert task["status"] == "cancelled"


def test_help_reference_and_category_validation(shop):
    assert shop.get("/api/customer/assistance/not-a-real-reference-123").status_code == 404
    assert shop.get("/api/customer/assistance/short").status_code == 404
    assert shop.patch("/api/customer/assistance/not-a-real-reference-123/cancel").status_code == 404
    bad = shop.post("/api/customer/assistance", json={"storeId": S, "category": "free_money", "description": "hi there"})
    assert bad.status_code == 409
    legacy = shop.post("/api/customer/assistance", json={"storeId": S, "category": "general_help", "description": "legacy client"})
    assert legacy.status_code == 201
    assert {c["id"] for c in get(shop, "/api/customer/help-categories")} == {
        "cannot_find_product", "product_information", "product_not_available", "checkout_help", "navigation_help", "other"}


def test_on_the_way_only_for_customer_assistance(shop):
    assert shop.post("/api/tasks/TSK-DEMO-02/on-the-way", json={"employeeId": "STF-02"}).status_code == 409


def test_reassignment_clears_on_the_way(shop):
    req = shop.post("/api/customer/assistance", json={"storeId": S, "category": "navigation_help", "description": "Where is the help desk"}).json()["request"]
    task = _task_for(shop, req["requestId"])
    emp = task["assignedEmployeeId"] or "STF-07"
    shop.post(f"/api/tasks/{task['id']}/accept", json={"employeeId": emp})
    shop.post(f"/api/tasks/{task['id']}/on-the-way", json={"employeeId": emp})
    other = "STF-06" if emp != "STF-06" else "STF-07"
    assert shop.post(f"/api/tasks/{task['id']}/assign", json={"employeeId": other, "force": True}).status_code == 200
    assert get(shop, f"/api/customer/assistance/{req['statusRef']}")["status"] == "assigned"


# ------------------------------------------------------------------ realtime + network
def test_customer_event_view_is_sanitised():
    from api.events import _view

    shelf = {"type": "shelf.updated", "eventId": "e1", "payload": {"shelfId": "shf-d1", "count": 3, "cameraId": "cam-x", "occurredAt": "t"}}
    v = _view(shelf, "customer")
    assert v["type"] == "customer.availability.changed" and v["payload"] == {"shelfId": "shf-d1", "occurredAt": "t"}
    a = _view({"type": "customer.assistance.updated", "eventId": "e2", "payload": {"requestId": "REQ-1", "status": "on_the_way", "taskId": "TSK-9"}}, "customer")
    assert a["payload"] == {"requestId": "REQ-1", "status": "on_the_way"}
    assert _view({"type": "task.created", "eventId": "e3", "payload": {}}, "customer") is None
    assert _view(shelf, None) is shelf


def test_lan_guard_allows_customer_api_and_staff_on_the_way():
    from core.network import remote_allowed

    assert remote_allowed("GET", f"{API}/products")
    assert remote_allowed("POST", "/api/customer/copilot/chat")
    assert remote_allowed("PATCH", "/api/customer/assistance/abc/cancel")
    assert remote_allowed("POST", "/api/tasks/TSK-1/on-the-way")
    assert not remote_allowed("POST", "/api/copilot/chat")


def test_home_payload_uses_real_rows_only(shop):
    h = get(shop, f"{API}/home")
    assert h["store"]["name"] and h["store"]["openStatus"]["status"] in ("open", "closed", "unknown")
    assert h["productCount"] == 49 and len(h["featured"]) == 8
    valid = {o["id"] for o in get(shop, f"{API}/offers")["items"]}
    assert {o["id"] for o in h["offers"]} <= valid
    assert {d["name"] for d in h["departments"]} >= {"Fresh Produce", "Dairy & Refrigerated", "Personal Care"}
