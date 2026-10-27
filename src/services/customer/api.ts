/**
 * Customer PWA data access. Every call goes to the RetailEdge backend; read-only GETs are mirrored in a small localStorage cache so a
 * shopper who loses signal mid-store still sees the last catalogue page, map and route - always flagged `stale` with its age.
 * Writes (help requests, cancel, copilot) are never cached and never reported as successful while offline.
 */
import { ApiError, apiGet, apiPatch, apiPost, newIdempotencyKey } from '../api/client';
import type {
  AssistanceView,
  CartQuote,
  CartRoute,
  Categories,
  CopilotReply,
  CopilotStatus,
  Fetched,
  HomeData,
  OffersResponse,
  PriceComparison,
  ProductCard,
  ProductDetail,
  ProductPage,
  StoreMapData,
  Suggestions,
} from './types';

const CACHE_PREFIX = 'retailedge_cpwa_cache:';
const CACHE_MAX_ENTRIES = 80;

type Query = Record<string, string | number | boolean | null | undefined>;

function cacheKey(path: string, query?: Query): string {
  const q = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');
  return `${CACHE_PREFIX}${path}?${q}`;
}

function writeCache(key: string, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX));
    if (keys.length > CACHE_MAX_ENTRIES) {
      const aged = keys
        .map((k) => {
          try {
            return [k, (JSON.parse(localStorage.getItem(k) ?? '{}') as { savedAt?: number }).savedAt ?? 0] as const;
          } catch {
            return [k, 0] as const;
          }
        })
        .sort((a, b) => a[1] - b[1]);
      aged.slice(0, keys.length - CACHE_MAX_ENTRIES).forEach(([k]) => localStorage.removeItem(k));
    }
  } catch {
    /* storage full or unavailable: the live response is still returned */
  }
}

function readCache<T>(key: string): Fetched<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; data: T };
    return { data: parsed.data, savedAt: parsed.savedAt, stale: true };
  } catch {
    return null;
  }
}

/** GET with offline fallback: a network failure returns the last cached copy (stale=true); with no copy the error is rethrown. */
async function cachedGet<T>(path: string, query?: Query, signal?: AbortSignal): Promise<Fetched<T>> {
  const key = cacheKey(path, query);
  try {
    const data = await apiGet<T>(path, query, signal);
    writeCache(key, data);
    return { data, stale: false, savedAt: Date.now() };
  } catch (e) {
    if (e instanceof ApiError && e.kind === 'offline') {
      const hit = readCache<T>(key);
      if (hit) return hit;
    }
    throw e;
  }
}

const base = (storeId: string) => `/api/customer/stores/${encodeURIComponent(storeId)}`;

export interface ProductQuery {
  q?: string;
  category?: string;
  brand?: string;
  availability?: string;
  offersOnly?: boolean;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export const customerApi = {
  home: (storeId: string, signal?: AbortSignal) => cachedGet<HomeData>(`${base(storeId)}/home`, undefined, signal),
  products: (storeId: string, q: ProductQuery, signal?: AbortSignal) =>
    cachedGet<ProductPage>(`${base(storeId)}/products`, { ...q, offersOnly: q.offersOnly ? true : undefined } as Query, signal),
  /** Suggestions are typing-time only: no cache, no retries (an outdated request is aborted by the caller). */
  suggestions: (storeId: string, q: string, signal?: AbortSignal) =>
    apiGet<Suggestions>(`${base(storeId)}/products/suggestions`, { q, limit: 6 }, signal),
  product: (storeId: string, id: string, signal?: AbortSignal) => cachedGet<ProductDetail>(`${base(storeId)}/products/${encodeURIComponent(id)}`, undefined, signal),
  categories: (storeId: string, signal?: AbortSignal) => cachedGet<Categories>(`${base(storeId)}/categories`, undefined, signal),
  offers: (storeId: string, signal?: AbortSignal) => cachedGet<OffersResponse>(`${base(storeId)}/offers`, undefined, signal),
  compare: (storeId: string, q: string, signal?: AbortSignal) => cachedGet<PriceComparison>(`${base(storeId)}/price-comparison`, { q }, signal),
  cartQuote: (storeId: string, lines: Array<{ productId: string; quantity: number }>, signal?: AbortSignal) =>
    cachedGet<CartQuote>(`${base(storeId)}/cart/quote`, { items: lines.map((l) => `${l.productId}:${l.quantity}`).join(',') }, signal),
  map: (storeId: string, signal?: AbortSignal) => cachedGet<StoreMapData>(`${base(storeId)}/map`, undefined, signal),
  shelfProducts: (storeId: string, shelfId: string, signal?: AbortSignal) =>
    cachedGet<{ shelfId: string; shelfCode: string; items: ProductCard[] }>(`${base(storeId)}/shelves/${encodeURIComponent(shelfId)}/products`, undefined, signal),
  route: (storeId: string, target: { productId?: string; shelfId?: string }, start?: string | null, signal?: AbortSignal) =>
    cachedGet<CartRoute>(`${base(storeId)}/routes`, { productId: target.productId, shelfId: target.shelfId, start: start ?? undefined }, signal),
  cartRoute: (storeId: string, productIds: string[], opts: { start?: string | null; endAt?: string | null; visited?: string[] }, signal?: AbortSignal) =>
    cachedGet<CartRoute>(
      `${base(storeId)}/cart-route`,
      { productIds: productIds.join(','), start: opts.start ?? undefined, endAt: opts.endAt ?? undefined, visited: (opts.visited ?? []).join(',') || undefined },
      signal,
    ),

  copilotStatus: (signal?: AbortSignal) => apiGet<CopilotStatus>('/api/customer/copilot/status', undefined, signal),
  copilotChat: (body: { storeId: string; message: string; history: Array<{ role: 'user' | 'assistant'; content: string }>; cartProductIds: string[]; startNodeId?: string | null }, signal?: AbortSignal) =>
    apiPost<CopilotReply>('/api/customer/copilot/chat', body, { signal }),

  helpCategories: () => cachedGet<Array<{ id: string; label: string }>>('/api/customer/help-categories'),
  createHelp: (body: { storeId: string; category: string; description: string; aisleOrZone?: string; productId?: string; productName?: string; customerContact?: string }, idempotencyKey = newIdempotencyKey('help')) =>
    apiPost<{ success: boolean; request: AssistanceView & { statusRef: string; submittedAt: string; replayed?: boolean } }>('/api/customer/assistance', body, { idempotencyKey }),
  getHelp: (ref: string, signal?: AbortSignal) => apiGet<AssistanceView>(`/api/customer/assistance/${encodeURIComponent(ref)}`, undefined, signal),
  cancelHelp: (ref: string) => apiPatch<AssistanceView>(`/api/customer/assistance/${encodeURIComponent(ref)}/cancel`),
};
