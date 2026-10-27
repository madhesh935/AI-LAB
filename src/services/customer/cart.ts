/**
 * Guest cart + route preferences, persisted per store in localStorage and shared by every Customer PWA screen through
 * useSyncExternalStore (adding a product on the Products page immediately changes the Map route and the Copilot's cart).
 * A cart is a plan, not an order: nothing is reserved and there is no checkout.
 */
import { useSyncExternalStore } from 'react';

export interface CartItem {
  productId: string;
  name: string;
  quantity: number;
  addedAt: number;
}

export interface RoutePrefs {
  /** Start point chosen by the shopper (map node id); null = the store entrance. */
  start: string | null;
  endAt: 'checkout' | 'exit' | 'none';
  visited: string[];
  /** Access node of the last stop marked visited: the remaining route is planned from there. */
  from: string | null;
}

const CART_KEY = (storeId: string) => `retailedge_cart_v1:${storeId}`;
const ROUTE_KEY = (storeId: string) => `retailedge_route_v1:${storeId}`;
const LEGACY_LIST_KEY = 'retalledge_shopper_list';
const MAX_QTY = 99;
const MAX_LINES = 60;

const listeners = new Set<() => void>();
const cache = new Map<string, unknown>();

function emit(): void {
  listeners.forEach((l) => l());
  const count = cartCountFromCache();
  window.dispatchEvent(new CustomEvent('retalledge:shopper-list-changed', { detail: { count } }));
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key && (e.key.startsWith('retailedge_cart_v1:') || e.key.startsWith('retailedge_route_v1:'))) {
      cache.delete(e.key);
      l();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', onStorage);
  };
}

function read<T>(key: string, fallback: T): T {
  if (cache.has(key)) return cache.get(key) as T;
  let value = fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw) value = JSON.parse(raw) as T;
  } catch {
    /* corrupted entry: start clean */
  }
  cache.set(key, value);
  return value;
}

function write<T>(key: string, value: T): void {
  cache.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the in-memory cart still works for this session */
  }
  emit();
}

let lastCartKey = '';
function cartCountFromCache(): number {
  const items = (cache.get(lastCartKey) as CartItem[] | undefined) ?? [];
  return items.length;
}

/** One-time import of the first shopper app's "My List" (product ids + quantities only). */
function migrateLegacy(storeId: string): void {
  try {
    const raw = localStorage.getItem(LEGACY_LIST_KEY);
    if (!raw || localStorage.getItem(CART_KEY(storeId))) return;
    const legacy = JSON.parse(raw) as Array<{ productId?: string; productName?: string; quantity?: number }>;
    const items: CartItem[] = legacy
      .filter((l) => typeof l.productId === 'string' && l.productId)
      .slice(0, MAX_LINES)
      .map((l) => ({ productId: l.productId as string, name: l.productName ?? 'Product', quantity: Math.min(MAX_QTY, Math.max(1, Number(l.quantity) || 1)), addedAt: Date.now() }));
    localStorage.setItem(CART_KEY(storeId), JSON.stringify(items));
    localStorage.removeItem(LEGACY_LIST_KEY);
  } catch {
    /* ignore unreadable legacy data */
  }
}

const EMPTY: CartItem[] = [];

export function getCart(storeId: string): CartItem[] {
  if (!storeId) return EMPTY;
  migrateLegacy(storeId);
  lastCartKey = CART_KEY(storeId);
  return read<CartItem[]>(CART_KEY(storeId), EMPTY);
}

export const cart = {
  add(storeId: string, product: { id: string; name: string }, quantity = 1): void {
    const items = getCart(storeId);
    const existing = items.find((i) => i.productId === product.id);
    if (existing) {
      write(CART_KEY(storeId), items.map((i) => (i.productId === product.id ? { ...i, quantity: Math.min(MAX_QTY, i.quantity + quantity) } : i)));
      return;
    }
    if (items.length >= MAX_LINES) return;
    write(CART_KEY(storeId), [...items, { productId: product.id, name: product.name, quantity: Math.min(MAX_QTY, Math.max(1, quantity)), addedAt: Date.now() }]);
  },
  setQuantity(storeId: string, productId: string, quantity: number): void {
    const items = getCart(storeId);
    write(CART_KEY(storeId), quantity <= 0 ? items.filter((i) => i.productId !== productId) : items.map((i) => (i.productId === productId ? { ...i, quantity: Math.min(MAX_QTY, quantity) } : i)));
  },
  remove(storeId: string, productId: string): void {
    write(CART_KEY(storeId), getCart(storeId).filter((i) => i.productId !== productId));
  },
  clear(storeId: string): void {
    write(CART_KEY(storeId), EMPTY);
    write(ROUTE_KEY(storeId), { ...getRoutePrefs(storeId), visited: [] });
  },
  has(storeId: string, productId: string): boolean {
    return getCart(storeId).some((i) => i.productId === productId);
  },
};

const DEFAULT_PREFS: RoutePrefs = { start: null, endAt: 'checkout', visited: [], from: null };

export function getRoutePrefs(storeId: string): RoutePrefs {
  if (!storeId) return DEFAULT_PREFS;
  let p = read<RoutePrefs>(ROUTE_KEY(storeId), DEFAULT_PREFS);
  if (p.from === undefined) {
    p = { ...DEFAULT_PREFS, ...p };
    cache.set(ROUTE_KEY(storeId), p);
  }
  return p;
}

export const routePrefs = {
  setStart(storeId: string, start: string | null): void {
    write(ROUTE_KEY(storeId), { ...getRoutePrefs(storeId), start, visited: [], from: null });
  },
  setEndAt(storeId: string, endAt: RoutePrefs['endAt']): void {
    write(ROUTE_KEY(storeId), { ...getRoutePrefs(storeId), endAt });
  },
  markVisited(storeId: string, shelfId: string, accessNodeId: string): void {
    const p = getRoutePrefs(storeId);
    if (p.visited.includes(shelfId)) return;
    write(ROUTE_KEY(storeId), { ...p, visited: [...p.visited, shelfId], from: accessNodeId });
  },
  unmarkVisited(storeId: string, shelfId: string): void {
    const p = getRoutePrefs(storeId);
    const visited = p.visited.filter((s) => s !== shelfId);
    write(ROUTE_KEY(storeId), { ...p, visited, from: visited.length ? p.from : null });
  },
  resetVisited(storeId: string): void {
    write(ROUTE_KEY(storeId), { ...getRoutePrefs(storeId), visited: [], from: null });
  },
};

export function useCart(storeId: string): CartItem[] {
  return useSyncExternalStore(subscribe, () => getCart(storeId), () => EMPTY);
}

export function useRoutePrefs(storeId: string): RoutePrefs {
  return useSyncExternalStore(subscribe, () => getRoutePrefs(storeId), () => DEFAULT_PREFS);
}

export function cartCount(storeId: string): number {
  return getCart(storeId).reduce((n, i) => n + i.quantity, 0);
}
