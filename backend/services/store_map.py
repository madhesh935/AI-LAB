"""Indoor navigation on the store's configured floor plan.

* The graph is read from SQLite (store_layouts / map_nodes / map_edges / shelf_placements) on every request, so the Customer PWA map,
  product routes and the customer Copilot all route on exactly the same geometry.
* Shortest paths: Dijkstra over walkable edges (edges are drawn along walkways only; `validate` proves no edge crosses a shelf block).
* Multi-stop order: exact Held-Karp dynamic programming for up to EXACT_LIMIT stops (provably shortest visiting order on the graph);
  above that a nearest-neighbour tour improved by 2-opt, which is a heuristic and is reported as such.
* Positions: the route starts from a location the shopper picks (default: the entrance). No live indoor positioning is used.
"""

from __future__ import annotations

import heapq
import itertools
import math
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from core.errors import InvalidStateError, NotFoundError
from database.models import MapEdge, MapNode, Product, Shelf, ShelfPlacement, ShelfProduct, StoreLayout, StoreZone
from services.common import get_store_or_404, now_utc

EXACT_LIMIT = 10
WALK_SPEED_MPS = 0.8  # unhurried shopping pace
START_TYPES = ("entrance", "exit", "checkout", "help_desk", "aisle")


@dataclass
class Graph:
    layout: StoreLayout
    nodes: Dict[str, MapNode]
    adj: Dict[str, List[Tuple[str, float, Optional[str]]]] = field(default_factory=dict)
    placements: Dict[str, ShelfPlacement] = field(default_factory=dict)
    shelves: Dict[str, Shelf] = field(default_factory=dict)
    zones: Dict[str, StoreZone] = field(default_factory=dict)
    edges: List[MapEdge] = field(default_factory=list)

    def label(self, a: str, b: str) -> Optional[str]:
        return next((lbl for n, _, lbl in self.adj.get(a, []) if n == b), None)

    def m(self, units: float) -> float:
        return round(units * self.layout.meters_per_unit, 1)


# ----------------------------------------------------------------------------- loading
def active_layout(db: Session, store_id: str) -> Optional[StoreLayout]:
    return db.scalars(select(StoreLayout).where(StoreLayout.store_id == store_id).where(StoreLayout.is_active.is_(True))
                      .order_by(StoreLayout.version.desc()).limit(1)).first()


def load_graph(db: Session, store_id: str) -> Graph:
    get_store_or_404(db, store_id)
    layout = active_layout(db, store_id)
    if layout is None:
        raise NotFoundError("Store map", store_id)
    nodes = {n.id: n for n in db.scalars(select(MapNode).where(MapNode.layout_id == layout.id))}
    g = Graph(layout=layout, nodes=nodes, adj={nid: [] for nid in nodes})
    for e in db.scalars(select(MapEdge).where(MapEdge.layout_id == layout.id).order_by(MapEdge.id)):
        if not e.walkable or e.source_node_id not in nodes or e.target_node_id not in nodes:
            continue
        g.edges.append(e)
        g.adj[e.source_node_id].append((e.target_node_id, e.distance, e.label))
        g.adj[e.target_node_id].append((e.source_node_id, e.distance, e.label))
    g.placements = {p.shelf_id: p for p in db.scalars(select(ShelfPlacement).where(ShelfPlacement.layout_id == layout.id))}
    g.shelves = {s.id: s for s in db.scalars(select(Shelf).where(Shelf.store_id == store_id))}
    g.zones = {z.id: z for z in db.scalars(select(StoreZone).where(StoreZone.store_id == store_id))}
    return g


# ----------------------------------------------------------------------------- shortest paths
def dijkstra(g: Graph, source: str) -> Tuple[Dict[str, float], Dict[str, Optional[str]]]:
    dist: Dict[str, float] = {source: 0.0}
    prev: Dict[str, Optional[str]] = {source: None}
    heap: List[Tuple[float, str]] = [(0.0, source)]
    done = set()
    while heap:
        d, u = heapq.heappop(heap)
        if u in done:
            continue
        done.add(u)
        for v, w, _ in g.adj.get(u, []):
            nd = d + w
            if nd < dist.get(v, math.inf) - 1e-9:
                dist[v], prev[v] = nd, u
                heapq.heappush(heap, (nd, v))
    return dist, prev


def path_from(prev: Dict[str, Optional[str]], target: str) -> List[str]:
    if target not in prev:
        return []
    out = [target]
    while prev[out[-1]] is not None:
        out.append(prev[out[-1]])  # type: ignore[arg-type]
    return out[::-1]


def shortest_path(g: Graph, a: str, b: str) -> Tuple[Optional[float], List[str]]:
    dist, prev = dijkstra(g, a)
    if b not in dist:
        return None, []
    return dist[b], path_from(prev, b)


def nearest_node(g: Graph, x: float, y: float) -> Optional[str]:
    return min(g.nodes, key=lambda nid: (g.nodes[nid].x - x) ** 2 + (g.nodes[nid].y - y) ** 2, default=None)


# ----------------------------------------------------------------------------- stop ordering
def order_stops(dm: Dict[Tuple[str, str], float], start: str, stops: Sequence[str], end: Optional[str]) -> Tuple[List[str], str]:
    """Visiting order minimising walked distance. Returns (order, method)."""
    n = len(stops)
    if n <= 1:
        return list(stops), "single_stop"
    if n <= EXACT_LIMIT:
        # Held-Karp: best[(mask, j)] = shortest walk from start visiting `mask` and ending at stop j.
        best: Dict[Tuple[int, int], Tuple[float, int]] = {}
        for j in range(n):
            best[(1 << j, j)] = (dm[(start, stops[j])], -1)
        for size in range(2, n + 1):
            for combo in itertools.combinations(range(n), size):
                mask = sum(1 << c for c in combo)
                for j in combo:
                    pm = mask & ~(1 << j)
                    cands = [(best[(pm, k)][0] + dm[(stops[k], stops[j])], k) for k in combo if k != j and (pm, k) in best]
                    best[(mask, j)] = min(cands)
        full = (1 << n) - 1
        tail = (lambda j: dm[(stops[j], end)]) if end else (lambda j: 0.0)
        last = min(range(n), key=lambda j: (best[(full, j)][0] + tail(j), j))
        order, mask, j = [], full, last
        while j != -1:
            order.append(stops[j])
            _, k = best[(mask, j)]
            mask &= ~(1 << j)
            j = k
        return order[::-1], "exact_held_karp"
    # nearest neighbour + 2-opt (heuristic, not guaranteed optimal)
    left, cur, order = set(stops), start, []
    while left:
        nxt = min(left, key=lambda s: (dm[(cur, s)], s))
        order.append(nxt)
        left.discard(nxt)
        cur = nxt

    def cost(seq: List[str]) -> float:
        c = dm[(start, seq[0])] + sum(dm[(seq[i], seq[i + 1])] for i in range(len(seq) - 1))
        return c + (dm[(seq[-1], end)] if end else 0.0)

    improved = True
    while improved:
        improved = False
        for i in range(len(order) - 1):
            for k in range(i + 1, len(order)):
                cand = order[:i] + order[i:k + 1][::-1] + order[k + 1:]
                if cost(cand) < cost(order) - 1e-9:
                    order, improved = cand, True
    return order, "nearest_neighbor_2opt"


# ----------------------------------------------------------------------------- directions
def _heading(a: MapNode, b: MapNode) -> Tuple[float, float]:
    dx, dy = b.x - a.x, b.y - a.y
    d = math.hypot(dx, dy) or 1.0
    return dx / d, dy / d


def _turn(h1: Tuple[float, float], h2: Tuple[float, float]) -> str:
    cross = h1[0] * h2[1] - h1[1] * h2[0]  # screen coordinates (y grows downward): positive = clockwise = right turn
    dot = h1[0] * h2[0] + h1[1] * h2[1]
    if dot > 0.94:
        return "straight"
    if dot < -0.94:
        return "back"
    return "right" if cross > 0 else "left"


def _toward(h: Tuple[float, float]) -> str:
    if abs(h[1]) >= abs(h[0]):
        return "toward the back of the store" if h[1] < 0 else "toward the front of the store"
    return "toward the right side of the store" if h[0] > 0 else "toward the left side of the store"


def directions(g: Graph, path: List[str], start_label: str, target: Optional[ShelfPlacement] = None, target_label: Optional[str] = None) -> List[str]:
    """Turn-by-turn text generated from the path's edge labels and geometry (nothing is hard-coded per product)."""
    steps = [f"Start at {start_label}."]
    if len(path) >= 2:
        groups: List[Tuple[str, float, Tuple[float, float], Tuple[float, float]]] = []  # (label, distance, first heading, last heading)
        for a, b in zip(path, path[1:]):
            lbl = g.label(a, b) or "the walkway"
            h = _heading(g.nodes[a], g.nodes[b])
            d = math.hypot(g.nodes[b].x - g.nodes[a].x, g.nodes[b].y - g.nodes[a].y)
            if groups and groups[-1][0] == lbl and _turn(groups[-1][3], h) == "straight":
                l0, d0, h0, _ = groups[-1]
                groups[-1] = (l0, d0 + d, h0, h)
            else:
                groups.append((lbl, d, h, h))
        for i, (lbl, d, h0, _) in enumerate(groups):
            meters = max(1, round(g.m(d)))
            if i == 0:
                if lbl == start_label:  # the short connector out of an entrance / counter / help desk
                    steps.append(f"Walk {_toward(h0)} for about {meters} m.")
                else:
                    steps.append(f"Head {_toward(h0)} along {lbl} for about {meters} m.")
                continue
            turn = _turn(groups[i - 1][3], h0)
            if turn == "straight":
                steps.append(f"Continue straight onto {lbl} for about {meters} m.")
            elif turn == "back":
                steps.append(f"Turn around and follow {lbl} for about {meters} m.")
            else:
                steps.append(f"Turn {turn} into {lbl} and walk about {meters} m.")
    if target is not None and target_label:
        node = g.nodes[path[-1]] if path else g.nodes[target.access_node_id]
        cx, cy = target.x + target.width / 2, target.y + target.height / 2
        side = "right beside you"
        if len(path) >= 2:
            h = _heading(g.nodes[path[-2]], node)
            cross = h[0] * (cy - node.y) - h[1] * (cx - node.x)
            side = "on your right" if cross > 0 else "on your left"
        steps.append(f"{target_label} is {side}.")
    elif target_label:
        steps.append(f"You have arrived at {target_label}.")
    return [f"{i}. {s}" for i, s in enumerate(steps, 1)]


# ----------------------------------------------------------------------------- shelves for products
def _shelf_label(g: Graph, shelf_id: str) -> Dict[str, Any]:
    sh = g.shelves.get(shelf_id)
    z = g.zones.get(sh.zone_id or "") if sh else None
    code = (sh.shelf_code if sh else shelf_id) or shelf_id
    short = code.replace("Shelf ", "", 1)
    aisle = f"Aisle {z.aisle_number}" if z and z.aisle_number else (z.name if z else None)
    return {"shelfId": shelf_id, "shelfCode": code, "shelfLabel": short, "section": z.category if z else (sh.department if sh else None),
            "aisleLabel": aisle, "zoneId": z.id if z else None, "display": f"{aisle}, Shelf {short}" if aisle else f"Shelf {short}"}


def resolve_products(db: Session, g: Graph, store_id: str, product_ids: Sequence[str]) -> Tuple[Dict[str, List[str]], List[Dict[str, Any]], Dict[str, Product]]:
    """product -> placed shelf ids (planogram order); and the products that cannot be routed (with the reason)."""
    ids = [p for p in dict.fromkeys(product_ids) if p][:60]
    prods = {p.id: p for p in db.scalars(select(Product).where(Product.store_id == store_id).where(Product.id.in_(ids)))} if ids else {}
    rows = db.execute(select(ShelfProduct.product_id, ShelfProduct.shelf_id).join(Shelf, Shelf.id == ShelfProduct.shelf_id)
                      .where(Shelf.store_id == store_id).where(ShelfProduct.product_id.in_(ids))
                      .order_by(ShelfProduct.product_id, ShelfProduct.tier, ShelfProduct.position, ShelfProduct.shelf_id)).all() if ids else []
    mapping: Dict[str, List[str]] = {}
    for pid, sid in rows:
        mapping.setdefault(pid, []).append(sid)
    placed: Dict[str, List[str]] = {}
    unmapped: List[Dict[str, Any]] = []
    for pid in ids:
        p = prods.get(pid)
        if p is None or not p.is_active:
            unmapped.append({"productId": pid, "name": p.name if p else None, "reason": "not_in_catalog", "message": "This product is not in this store's catalogue."})
            continue
        shelves = mapping.get(pid, [])
        on_map = [s for s in shelves if s in g.placements]
        if on_map:
            placed[pid] = on_map
        elif shelves:
            unmapped.append({"productId": pid, "name": p.name, "reason": "shelf_not_on_map", "message": "Its shelf is not drawn on the store map yet - ask a team member."})
        else:
            unmapped.append({"productId": pid, "name": p.name, "reason": "no_shelf_mapping", "message": "No shelf location is recorded for this product."})
    return placed, unmapped, prods


# ----------------------------------------------------------------------------- routing service
class RouteService:
    def __init__(self, db: Session):
        self.db = db

    def _start(self, g: Graph, start_node_id: Optional[str]) -> MapNode:
        if start_node_id:
            node = g.nodes.get(start_node_id)
            if node is None:
                raise InvalidStateError(f"Unknown start location '{start_node_id}' for this store map")
            return node
        ent = sorted((n for n in g.nodes.values() if n.node_type == "entrance"), key=lambda n: n.id)
        if not ent:
            raise InvalidStateError("This store map has no entrance configured")
        return ent[0]

    def _end(self, g: Graph, end_at: Optional[str]) -> Optional[MapNode]:
        if not end_at or end_at == "none":
            return None
        if end_at in g.nodes:
            return g.nodes[end_at]
        cands = sorted((n for n in g.nodes.values() if n.node_type == end_at), key=lambda n: n.id)
        if not cands:
            raise InvalidStateError(f"This store map has no '{end_at}' location")
        return cands[0]

    def node_out(self, n: MapNode) -> Dict[str, Any]:
        return {"nodeId": n.id, "label": n.label or n.id, "type": n.node_type, "x": n.x, "y": n.y}

    def cart_route(self, store_id: str, product_ids: Sequence[str], start_node_id: Optional[str] = None, end_at: Optional[str] = None,
                   visited_shelf_ids: Iterable[str] = ()) -> Dict[str, Any]:
        g = load_graph(self.db, store_id)
        start = self._start(g, start_node_id)
        end = self._end(g, end_at)
        placed, unmapped, prods = resolve_products(self.db, g, store_id, product_ids)
        visited = set(visited_shelf_ids or ())
        dist0, _ = dijkstra(g, start.id)
        # one shelf per product: the reachable placed shelf closest to the start; products sharing a shelf become one stop
        stop_products: Dict[str, List[str]] = {}
        unreachable: List[Dict[str, Any]] = []
        for pid, shelf_ids in placed.items():
            reach = [s for s in shelf_ids if g.placements[s].access_node_id in dist0]
            if not reach:
                unreachable.append({"productId": pid, "name": prods[pid].name, "reason": "no_walkable_path", "message": "No walkable path reaches this shelf on the store map."})
                continue
            sid = min(reach, key=lambda s: (dist0[g.placements[s].access_node_id], s))
            stop_products.setdefault(sid, []).append(pid)
        done_stops = {s: v for s, v in stop_products.items() if s in visited}
        pending = [s for s in stop_products if s not in visited]
        access = {s: g.placements[s].access_node_id for s in pending}
        pts = [start.id] + sorted(set(access.values())) + ([end.id] if end else [])
        dm: Dict[Tuple[str, str], float] = {}
        prevs: Dict[str, Dict[str, Optional[str]]] = {}
        for a in dict.fromkeys(pts):
            d, p = dijkstra(g, a)
            prevs[a] = p
            for b in pts:
                dm[(a, b)] = d.get(b, math.inf)
        if end and dm.get((start.id, end.id), math.inf) == math.inf:
            raise InvalidStateError(f"No walkable path from {start.label} to {end.label} on this store map")
        # order shelves by their access nodes (shelves sharing an access node are visited together)
        by_node: Dict[str, List[str]] = {}
        for s in pending:
            by_node.setdefault(access[s], []).append(s)
        node_order, method = order_stops(dm, start.id, sorted(by_node), end.id if end else None)
        stops, legs = [], []
        cur = start
        cur_label = start.label or "your start point"
        total = 0.0
        for order_i, node_id in enumerate(node_order, 1):
            path = path_from(prevs[cur.id], node_id)
            shelf_ids = sorted(by_node[node_id], key=lambda s: g.shelves[s].shelf_code if s in g.shelves else s)
            labels = [_shelf_label(g, s) for s in shelf_ids]
            target_label = " & ".join(f"Shelf {lb['shelfLabel']} ({lb['section']})" if lb["section"] else f"Shelf {lb['shelfLabel']}" for lb in labels)
            d = dm[(cur.id, node_id)]
            total += d
            legs.append({"fromLabel": cur_label, "toLabel": target_label, "nodeIds": path, "points": [{"x": g.nodes[n].x, "y": g.nodes[n].y} for n in path],
                         "distanceM": g.m(d), "directions": directions(g, path, cur_label, g.placements[shelf_ids[0]], target_label)})
            for lb, s in zip(labels, shelf_ids):
                pl = g.placements[s]
                stops.append({**lb, "order": order_i, "accessNodeId": node_id, "x": g.nodes[node_id].x, "y": g.nodes[node_id].y,
                              "shelfRect": {"x": pl.x, "y": pl.y, "width": pl.width, "height": pl.height},
                              "productIds": stop_products[s], "products": [{"id": pid, "name": prods[pid].name} for pid in stop_products[s]],
                              "distanceFromPreviousM": g.m(d) if s == shelf_ids[0] else 0.0})
            cur, cur_label = g.nodes[node_id], target_label
        end_out = None
        if end:
            path = path_from(prevs[cur.id], end.id)
            d = dm[(cur.id, end.id)]
            total += d
            legs.append({"fromLabel": cur_label, "toLabel": end.label, "nodeIds": path, "points": [{"x": g.nodes[n].x, "y": g.nodes[n].y} for n in path],
                         "distanceM": g.m(d), "directions": directions(g, path, cur_label, None, end.label), "isFinal": True})
            end_out = self.node_out(end)
        meters = g.m(total)
        available = bool(stops) or bool(end)
        return {
            "storeId": store_id, "layoutId": g.layout.id, "layoutVersion": g.layout.version, "isPrototypeLayout": g.layout.is_prototype,
            "routeAvailable": available, "start": self.node_out(start), "end": end_out, "stops": stops, "legs": legs,
            "visitedStops": [{**_shelf_label(g, s), "productIds": v} for s, v in done_stops.items()],
            "totalDistanceM": meters, "estimatedWalkMinutes": round(meters / WALK_SPEED_MPS / 60, 1) if meters else 0.0,
            "unmapped": unmapped, "unreachable": unreachable, "optimization": method,
            "optimizationNote": {"exact_held_karp": "Shortest visiting order on the store's walkway graph (exact).",
                                 "nearest_neighbor_2opt": "Practical order from a nearest-next-stop heuristic improved by 2-opt; not guaranteed to be the shortest.",
                                 "single_stop": "One destination."}[method],
            "message": None if available else ("None of these products can be shown on the store map." if product_ids else "Add products to plan a route."),
            "positioning": "Route from the start point you selected. The app does not track your live position in the store.",
            "generatedAt": now_utc().isoformat(),
        }

    def product_route(self, store_id: str, product_id: Optional[str] = None, shelf_id: Optional[str] = None, start_node_id: Optional[str] = None) -> Dict[str, Any]:
        if product_id:
            return self.cart_route(store_id, [product_id], start_node_id)
        if not shelf_id:
            raise InvalidStateError("Give a productId or a shelfId")
        g = load_graph(self.db, store_id)
        pl = g.placements.get(shelf_id)
        if pl is None:
            raise NotFoundError("Shelf on the store map", shelf_id)
        start = self._start(g, start_node_id)
        d, path = shortest_path(g, start.id, pl.access_node_id)
        if d is None:
            raise InvalidStateError("No walkable path reaches this shelf on the store map")
        lb = _shelf_label(g, shelf_id)
        label = f"Shelf {lb['shelfLabel']}"
        return {"storeId": store_id, "layoutId": g.layout.id, "layoutVersion": g.layout.version, "routeAvailable": True, "start": self.node_out(start), "end": None,
                "stops": [{**lb, "order": 1, "accessNodeId": pl.access_node_id, "x": g.nodes[pl.access_node_id].x, "y": g.nodes[pl.access_node_id].y,
                           "shelfRect": {"x": pl.x, "y": pl.y, "width": pl.width, "height": pl.height}, "productIds": [], "products": [], "distanceFromPreviousM": g.m(d)}],
                "legs": [{"fromLabel": start.label, "toLabel": label, "nodeIds": path, "points": [{"x": g.nodes[n].x, "y": g.nodes[n].y} for n in path],
                          "distanceM": g.m(d), "directions": directions(g, path, start.label or "start", pl, label)}],
                "visitedStops": [], "totalDistanceM": g.m(d), "estimatedWalkMinutes": round(g.m(d) / WALK_SPEED_MPS / 60, 1), "unmapped": [], "unreachable": [],
                "optimization": "single_stop", "positioning": "Route from the start point you selected. The app does not track your live position in the store.",
                "generatedAt": now_utc().isoformat()}

    def product_locations(self, store_id: str, product_ids: Sequence[str]) -> Dict[str, Any]:
        g = load_graph(self.db, store_id)
        placed, unmapped, prods = resolve_products(self.db, g, store_id, product_ids)
        items = {}
        for pid, shelves in placed.items():
            items[pid] = {"mapped": True, "name": prods[pid].name, "locations": [{**_shelf_label(g, s), "accessNodeId": g.placements[s].access_node_id} for s in shelves]}
        for u in unmapped:
            items[u["productId"]] = {"mapped": False, "name": u["name"], "reason": u["reason"], "message": u["message"], "locations": []}
        return {"storeId": store_id, "layoutVersion": g.layout.version, "items": items, "generatedAt": now_utc().isoformat()}

    # -- map payload -----------------------------------------------------------
    def map_out(self, store_id: str) -> Dict[str, Any]:
        g = load_graph(self.db, store_id)
        counts: Dict[str, int] = {}
        for sid, in self.db.execute(select(ShelfProduct.shelf_id).join(Product, Product.id == ShelfProduct.product_id).where(Product.is_active.is_(True))
                                    .where(Product.store_id == store_id)).all():
            counts[sid] = counts.get(sid, 0) + 1
        sections = [{"id": z.id, "name": z.name, "type": z.zone_type, "category": z.category, "aisleNumber": z.aisle_number, "x": z.x, "y": z.y,
                     "width": z.width, "height": z.height, "color": z.color} for z in sorted(g.zones.values(), key=lambda z: z.id)]
        shelves = []
        for sid, pl in sorted(g.placements.items()):
            shelves.append({**_shelf_label(g, sid), "x": pl.x, "y": pl.y, "width": pl.width, "height": pl.height, "accessNodeId": pl.access_node_id,
                            "face": pl.face, "productCount": counts.get(sid, 0)})
        starts = sorted((n for n in g.nodes.values() if n.is_start_point), key=lambda n: (START_TYPES.index(n.node_type) if n.node_type in START_TYPES else 9, n.label or ""))
        default = next((n.id for n in starts if n.node_type == "entrance"), starts[0].id if starts else None)
        return {"storeId": store_id,
                "layout": {"id": g.layout.id, "version": g.layout.version, "name": g.layout.name, "width": g.layout.width, "height": g.layout.height,
                           "metersPerUnit": g.layout.meters_per_unit, "isPrototype": g.layout.is_prototype, "notes": g.layout.notes,
                           "updatedAt": g.layout.updated_at.isoformat() if g.layout.updated_at else None},
                "sections": sections, "shelves": shelves,
                "nodes": [{"id": n.id, "x": n.x, "y": n.y, "type": n.node_type, "label": n.label, "isStartPoint": n.is_start_point, "zoneId": n.zone_id} for n in g.nodes.values()],
                "edges": [{"source": e.source_node_id, "target": e.target_node_id, "distance": e.distance, "label": e.label} for e in g.edges],
                "startPoints": [{"nodeId": n.id, "label": n.label, "type": n.node_type} for n in starts], "defaultStartNodeId": default,
                "unplacedShelves": sum(1 for s in g.shelves if s not in g.placements), "validation": validate(g), "generatedAt": now_utc().isoformat()}


# ----------------------------------------------------------------------------- validation
def _segment_hits_rect(x1: float, y1: float, x2: float, y2: float, rx: float, ry: float, rw: float, rh: float, eps: float = 0.5) -> bool:
    """Liang-Barsky: does the segment pass through the rectangle's interior (shrunk by eps)?"""
    xmin, xmax, ymin, ymax = rx + eps, rx + rw - eps, ry + eps, ry + rh - eps
    if xmin >= xmax or ymin >= ymax:
        return False
    dx, dy = x2 - x1, y2 - y1
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x1 - xmin), (dx, xmax - x1), (-dy, y1 - ymin), (dy, ymax - y1)):
        if p == 0:
            if q < 0:
                return False
            continue
        t = q / p
        if p < 0:
            t0 = max(t0, t)
        else:
            t1 = min(t1, t)
        if t0 > t1:
            return False
    return True


def validate(g: Graph) -> Dict[str, Any]:
    problems: List[str] = []
    W, H = g.layout.width, g.layout.height
    for n in g.nodes.values():
        if not (0 <= n.x <= W and 0 <= n.y <= H):
            problems.append(f"node {n.id} lies outside the floor plan")
    for e in g.edges:
        a, b = g.nodes[e.source_node_id], g.nodes[e.target_node_id]
        if abs(math.hypot(a.x - b.x, a.y - b.y) - e.distance) > 0.5:
            problems.append(f"edge {a.id}-{b.id} distance does not match its geometry")
        for sid, pl in g.placements.items():
            if _segment_hits_rect(a.x, a.y, b.x, b.y, pl.x, pl.y, pl.width, pl.height):
                problems.append(f"edge {a.id}-{b.id} crosses shelf {sid}")
    for sid, pl in g.placements.items():
        if pl.access_node_id not in g.nodes:
            problems.append(f"shelf {sid} has no access node")
            continue
        if not (0 <= pl.x and pl.x + pl.width <= W and 0 <= pl.y and pl.y + pl.height <= H):
            problems.append(f"shelf {sid} lies outside the floor plan")
        n = g.nodes[pl.access_node_id]
        gap = max(pl.x - n.x, 0, n.x - (pl.x + pl.width)) + max(pl.y - n.y, 0, n.y - (pl.y + pl.height))
        if gap > 80:
            problems.append(f"shelf {sid} access node is {gap:.0f} units away")
    start = next((n.id for n in g.nodes.values() if n.node_type == "entrance"), None)
    if start:
        dist, _ = dijkstra(g, start)
        cut = [n for n in g.nodes if n not in dist]
        if cut:
            problems.append(f"{len(cut)} node(s) cannot be reached from the entrance")
    return {"ok": not problems, "problems": problems[:20]}


# ----------------------------------------------------------------------------- prototype floor plan builder
FRONT_TYPES = {"entrance": "entrance", "exit": "exit", "checkout": "checkout", "help_desk": "help_desk"}


def build_prototype_layout(db: Session, store_id: str, meters_per_unit: float = 0.05, replace: bool = False) -> Dict[str, Any]:
    """Derive a walkway graph from the store's configured zones and persist it as a versioned PROTOTYPE layout.

    Pattern: each aisle zone holds one gondola (two shelf faces); walkways run between gondolas, along the back and along the front
    (Main Aisle); entrance / help desk / checkouts / exit hang off the Main Aisle. Shelves are placed on the gondola of their zone.
    The result is stored once and re-used for every route - nothing is regenerated per request.
    """
    store = get_store_or_404(db, store_id)
    existing = active_layout(db, store_id)
    if existing is not None and not replace:
        return {"layoutId": existing.id, "version": existing.version, "created": False}
    zones = list(db.scalars(select(StoreZone).where(StoreZone.store_id == store_id)))
    aisles = sorted([z for z in zones if z.zone_type == "aisle" and z.width > 0 and z.height > 0], key=lambda z: (z.x, z.id))
    fronts = sorted([z for z in zones if z.zone_type in FRONT_TYPES and z.width > 0], key=lambda z: (z.x, z.id))
    if not aisles:
        raise InvalidStateError("The store has no aisle zones with geometry; configure the floor plan zones first")
    version = (existing.version + 1) if existing else 1
    if existing is not None:
        existing.is_active = False
    lid = f"layout-{store_id}-v{version}"
    W, H = float(store.map_width), float(store.map_height)
    layout = StoreLayout(id=lid, store_id=store_id, version=version, name=f"{store.name} floor plan", width=W, height=H, meters_per_unit=meters_per_unit,
                         is_active=True, is_prototype=True, notes="Configured prototype floor plan derived from the store's zones - not a surveyed drawing.")
    db.add(layout)
    db.flush()

    gw = min(30.0, min(z.width for z in aisles) / 3)
    gond = []
    for z in aisles:
        x0 = z.x + z.width / 2 - gw / 2
        gond.append((z, x0, x0 + gw, z.y + 35, z.y + z.height - 30))
    lanes: List[float] = []
    for i in range(len(gond) + 1):
        if i == 0:
            lanes.append(max(10.0, gond[0][1] - 30))
        elif i == len(gond):
            lanes.append(min(W - 10, gond[-1][2] + 30))
        else:
            lanes.append((gond[i - 1][2] + gond[i][1]) / 2)
    yb = max(5.0, min(z.y for z in aisles) + 15)
    bottom = max(z.y + z.height for z in aisles)
    yf = (bottom + min(z.y for z in fronts)) / 2 if fronts and min(z.y for z in fronts) > bottom else min(H - 5, bottom + 25)

    shelves = list(db.scalars(select(Shelf).where(Shelf.store_id == store_id).order_by(Shelf.shelf_code)))
    by_zone: Dict[str, List[Shelf]] = {}
    for s in shelves:
        if s.zone_id:
            by_zone.setdefault(s.zone_id, []).append(s)
    segs_per = {z.id: max(3, math.ceil(len(by_zone.get(z.id, [])) / 2)) for z, *_ in gond}

    nodes: Dict[str, MapNode] = {}

    def node(nid: str, x: float, y: float, ntype: str, label: Optional[str] = None, zone_id: Optional[str] = None, start: bool = False) -> str:
        if nid not in nodes:
            nodes[nid] = MapNode(id=f"{lid}:{nid}", layout_id=lid, x=round(x, 1), y=round(y, 1), node_type=ntype, label=label, zone_id=zone_id, is_start_point=start)
        return nodes[nid].id

    def lk(i: int, y: float) -> str:
        return f"L{i}-{round(y, 1)}"

    def nodes_x(node_id: str, fallback: float) -> float:
        return next((n.x for n in nodes.values() if n.id == node_id), fallback)

    def lane_name(i: int) -> str:
        if i == 0:
            return f"the {gond[0][0].category or gond[0][0].name} walkway (left wall)"
        if i == len(gond):
            return f"the {gond[-1][0].category or gond[-1][0].name} walkway (right wall)"
        return f"the {gond[i - 1][0].category or 'Aisle'} / {gond[i][0].category or 'Aisle'} walkway"

    lane_ys: Dict[int, set] = {i: {yb, yf} for i in range(len(lanes))}
    seg_y: Dict[str, List[Tuple[float, float]]] = {}
    for gi, (z, x0, x1, y0, y1) in enumerate(gond):
        n = segs_per[z.id]
        h = (y1 - y0) / n
        seg_y[z.id] = [(y0 + h * k, h) for k in range(n)]
        for top, hh in seg_y[z.id]:
            lane_ys[gi].add(round(top + hh / 2, 1))
            lane_ys[gi + 1].add(round(top + hh / 2, 1))
    edges: List[Tuple[str, str, str]] = []
    for i, x in enumerate(lanes):
        ys = sorted(lane_ys[i])
        ids = []
        for y in ys:
            kind = "junction" if y in (yb, yf) else "shelf_access"
            name = lane_name(i)[4:]
            ids.append(node(lk(i, y), x, y, kind, label=name[:1].upper() + name[1:] if kind == "junction" else None))
        for a, b in zip(ids, ids[1:]):
            edges.append((a, b, lane_name(i)))
    back = [nodes[lk(i, yb)].id for i in range(len(lanes))]
    for a, b in zip(back, back[1:]):
        edges.append((a, b, "the Back Aisle"))
    front_pts: List[Tuple[float, str]] = [(lanes[i], nodes[lk(i, yf)].id) for i in range(len(lanes))]
    for z, x0, x1, *_ in gond:
        front_pts.append(((x0 + x1) / 2, node(f"A-{z.id}", (x0 + x1) / 2, yf, "aisle", label=z.name, zone_id=z.id, start=True)))
    for z in fronts:
        cx = z.x + z.width / 2
        j = next((nid for fx, nid in front_pts if abs(fx - cx) < 1.0), None)
        if j is None:
            j = node(f"J-{z.id}", cx, yf, "junction")
            front_pts.append((cx, j))
        f = node(f"F-{z.id}", nodes_x(j, cx), z.y, FRONT_TYPES[z.zone_type], label=z.name, zone_id=z.id, start=True)
        edges.append((j, f, z.name))
    front_pts.sort()
    for (_, a), (_, b) in zip(front_pts, front_pts[1:]):
        edges.append((a, b, "the Main Aisle"))
    for n in nodes.values():
        db.add(n)
    db.flush()
    seen = set()
    for a, b, lbl in edges:
        key = tuple(sorted((a, b)))
        if a == b or key in seen:
            continue
        seen.add(key)
        na, nb = next(n for n in nodes.values() if n.id == a), next(n for n in nodes.values() if n.id == b)
        db.add(MapEdge(layout_id=lid, source_node_id=a, target_node_id=b, distance=round(math.hypot(na.x - nb.x, na.y - nb.y), 3), walkable=True, label=lbl))
    placed = 0
    for gi, (z, x0, x1, *_r) in enumerate(gond):
        slots = [(face, k) for k in range(segs_per[z.id]) for face in ("left", "right")]
        for s, (face, k) in zip(by_zone.get(z.id, []), slots):
            top, hh = seg_y[z.id][k]
            lane = gi if face == "left" else gi + 1
            acc = nodes[lk(lane, top + hh / 2)].id
            db.add(ShelfPlacement(layout_id=lid, shelf_id=s.id, x=round(x0 if face == "left" else x0 + gw / 2, 1), y=round(top + 3, 1), width=round(gw / 2, 1),
                                  height=round(hh - 6, 1), access_node_id=acc, face=face))
            placed += 1
    db.flush()
    return {"layoutId": lid, "version": version, "created": True, "nodes": len(nodes), "edges": len(seen), "shelvesPlaced": placed,
            "shelvesNotPlaced": [s.shelf_code for s in shelves if s.zone_id not in segs_per]}


def delete_layouts(db: Session, store_id: str) -> None:
    """Tests / re-seeding only."""
    for lay in db.scalars(select(StoreLayout).where(StoreLayout.store_id == store_id)):
        db.execute(delete(ShelfPlacement).where(ShelfPlacement.layout_id == lay.id))
        db.execute(delete(MapEdge).where(MapEdge.layout_id == lay.id))
        db.execute(delete(MapNode).where(MapNode.layout_id == lay.id))
        db.delete(lay)
    db.flush()
