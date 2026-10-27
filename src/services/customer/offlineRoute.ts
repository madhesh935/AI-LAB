/**
 * OFFLINE fallback only: when the server cannot be reached and no cached route matches the cart, plan a route on the CACHED store map
 * (Dijkstra on its walkway graph + nearest-next-stop order). The result is labelled 'offline_estimate' - the server route
 * (exact ordering, server-side validation) replaces it as soon as the connection returns.
 */
import type { CartRoute, RouteLeg, RouteStop, StoreMapData } from './types';

const HINT_KEY = (storeId: string) => `retailedge_shelf_hints_v1:${storeId}`;

/** Remember which shelf the server routed each product to, so an offline estimate can still place the cart's items. */
export function rememberShelves(storeId: string, route: CartRoute): void {
  try {
    const hints = shelfHints(storeId);
    for (const s of [...route.stops, ...route.visitedStops]) for (const pid of s.productIds) hints[pid] = s.shelfId;
    localStorage.setItem(HINT_KEY(storeId), JSON.stringify(hints));
  } catch {
    /* storage unavailable */
  }
}

export function shelfHints(storeId: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(HINT_KEY(storeId)) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export interface OfflineStopInput {
  productId: string;
  name: string;
  shelfId: string;
}

function dijkstra(adj: Map<string, Array<[string, number]>>, source: string) {
  const dist = new Map<string, number>([[source, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  while (true) {
    let u: string | null = null;
    let best = Infinity;
    dist.forEach((d, n) => {
      if (!done.has(n) && d < best) {
        best = d;
        u = n;
      }
    });
    if (u === null) break;
    done.add(u);
    for (const [v, w] of adj.get(u) ?? []) {
      const nd = best + w;
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
      }
    }
  }
  return { dist, prev };
}

function pathTo(prev: Map<string, string>, source: string, target: string): string[] {
  const out = [target];
  let cur = target;
  while (cur !== source) {
    const p = prev.get(cur);
    if (!p) return [];
    out.unshift(p);
    cur = p;
  }
  return out;
}

export function offlineRoute(map: StoreMapData, items: OfflineStopInput[], startNodeId: string | null, endAt: 'checkout' | 'exit' | 'none', visited: string[]): CartRoute {
  const adj = new Map<string, Array<[string, number]>>();
  for (const e of map.edges) {
    adj.set(e.source, [...(adj.get(e.source) ?? []), [e.target, e.distance]]);
    adj.set(e.target, [...(adj.get(e.target) ?? []), [e.source, e.distance]]);
  }
  const nodes = new Map(map.nodes.map((n) => [n.id, n]));
  const shelves = new Map(map.shelves.map((s) => [s.shelfId, s]));
  const start = nodes.get(startNodeId ?? '') ?? nodes.get(map.defaultStartNodeId ?? '') ?? map.nodes[0];
  const end = endAt === 'none' ? undefined : map.nodes.find((n) => n.type === endAt);
  const m = (u: number) => Math.round(u * map.layout.metersPerUnit * 10) / 10;

  const byShelf = new Map<string, OfflineStopInput[]>();
  const unmapped: CartRoute['unmapped'] = [];
  for (const it of items) {
    if (!shelves.has(it.shelfId)) {
      unmapped.push(
        it.shelfId
          ? { productId: it.productId, name: it.name, reason: 'shelf_not_on_map', message: 'This product is not placed on the saved store map.' }
          : { productId: it.productId, name: it.name, reason: 'location_not_saved', message: 'Its shelf is not saved on this phone - reconnect to include it in the route.' },
      );
      continue;
    }
    if (visited.includes(it.shelfId)) continue;
    byShelf.set(it.shelfId, [...(byShelf.get(it.shelfId) ?? []), it]);
  }
  const pending = [...byShelf.keys()];
  const stops: RouteStop[] = [];
  const legs: RouteLeg[] = [];
  let cur = start.id;
  let curLabel = start.label ?? 'Start';
  let total = 0;
  let order = 0;
  while (pending.length) {
    const { dist, prev } = dijkstra(adj, cur);
    pending.sort((a, b) => (dist.get(shelves.get(a)!.accessNodeId) ?? Infinity) - (dist.get(shelves.get(b)!.accessNodeId) ?? Infinity));
    const sid = pending.shift() as string;
    const sh = shelves.get(sid)!;
    const d = dist.get(sh.accessNodeId);
    if (d === undefined) continue;
    order += 1;
    const path = pathTo(prev, cur, sh.accessNodeId);
    total += d;
    legs.push({ fromLabel: curLabel, toLabel: `Shelf ${sh.shelfLabel}`, nodeIds: path, points: path.map((n) => ({ x: nodes.get(n)!.x, y: nodes.get(n)!.y })), distanceM: m(d), directions: [`Walk to Shelf ${sh.shelfLabel}${sh.aisleLabel ? ` in ${sh.aisleLabel}` : ''}.`] });
    const prods = byShelf.get(sid) ?? [];
    const acc = nodes.get(sh.accessNodeId)!;
    stops.push({ shelfId: sid, shelfLabel: sh.shelfLabel, shelfCode: sh.shelfCode, section: sh.section, aisleLabel: sh.aisleLabel, order, accessNodeId: sh.accessNodeId, x: acc.x, y: acc.y,
      shelfRect: { x: sh.x, y: sh.y, width: sh.width, height: sh.height }, productIds: prods.map((p) => p.productId), products: prods.map((p) => ({ id: p.productId, name: p.name })), distanceFromPreviousM: m(d) });
    cur = sh.accessNodeId;
    curLabel = `Shelf ${sh.shelfLabel}`;
  }
  if (end) {
    const { dist, prev } = dijkstra(adj, cur);
    const d = dist.get(end.id);
    if (d !== undefined) {
      const path = pathTo(prev, cur, end.id);
      total += d;
      legs.push({ fromLabel: curLabel, toLabel: end.label ?? end.type, nodeIds: path, points: path.map((n) => ({ x: nodes.get(n)!.x, y: nodes.get(n)!.y })), distanceM: m(d), directions: [`Walk to ${end.label ?? end.type}.`], isFinal: true });
    }
  }
  const meters = m(total);
  return {
    storeId: map.storeId, layoutVersion: map.layout.version, routeAvailable: stops.length > 0 || !!end,
    start: { nodeId: start.id, label: start.label ?? 'Start', type: start.type, x: start.x, y: start.y },
    end: end ? { nodeId: end.id, label: end.label ?? end.type, type: end.type, x: end.x, y: end.y } : null,
    stops, legs, visitedStops: [], totalDistanceM: meters, estimatedWalkMinutes: Math.round((meters / 0.8 / 60) * 10) / 10,
    unmapped, unreachable: [], optimization: 'offline_estimate',
    optimizationNote: 'Offline estimate from the saved store map (nearest-next-stop order). It refreshes when you are back online.',
    positioning: 'Route from the start point you selected. The app does not track your live position in the store.', generatedAt: new Date().toISOString(),
  };
}
