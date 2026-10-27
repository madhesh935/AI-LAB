/**
 * RetailEdge AI — Customer PWA store selection and checkout queue estimate.
 * Catalogue, search, offers, cart, map, routes, copilot and help requests live in services/customer/*. Everything here comes from
 * the backend's public endpoints; nothing is invented when the server has no data.
 */

import type { CustomerStorePublic } from '../types/retail';
import { ApiError, apiGet } from './api/client';
import { Dto, arr, num, obj, str, strOrNull, timeAgo } from './api/adapters/common';

const STORAGE_KEYS = {
  SELECTED_STORE_ID: 'retalledge_shopper_store_id',
  STORES_CACHE: 'retailedge_cpwa_stores',
};

const EMPTY_STORE: CustomerStorePublic = { id: '', code: '', name: 'Loading…', branch: '', address: '', city: '', operatingHours: '', isOpen: true, phone: '', mapDimensions: { width: 800, height: 600 } };

/** Filled from GET /api/public/stores by customerService.hydrate(). */
export const PUBLIC_STORES_LIST: CustomerStorePublic[] = [];

/** What the queue screen renders: the public queue estimate (null = not measured). */
export interface CustomerQueues {
  lastUpdated: string;
  congestionLevel: 'low' | 'moderate' | 'high' | 'unknown';
  recommendedCounter: string | null;
  dataAvailable: boolean;
  note?: string;
  counters: Array<{
    id: string;
    name: string;
    type: string;
    status: 'open' | 'standby' | 'closed';
    estimatedWaitMins: number | null;
    queueLength: number | null;
    isRecommended: boolean;
  }>;
}

let queueCache: CustomerQueues = { lastUpdated: 'Not available', congestionLevel: 'unknown', recommendedCounter: null, dataAvailable: false, counters: [] };
let hydrated = false;

class CustomerService {
  /**
   * Fill the store list and the checkout queue estimate. Offline, the last store list is reused; with none saved this throws ApiError.
   */
  async hydrate(storeIdParam?: string, signal?: AbortSignal): Promise<void> {
    let raw: Dto[];
    try {
      raw = await apiGet<Dto[]>('/api/public/stores', undefined, signal);
      try {
        localStorage.setItem(STORAGE_KEYS.STORES_CACHE, JSON.stringify(raw));
      } catch {
        /* storage unavailable */
      }
    } catch (e) {
      const saved = e instanceof ApiError && e.kind === 'offline' ? localStorage.getItem(STORAGE_KEYS.STORES_CACHE) : null;
      if (!saved) throw e;
      raw = JSON.parse(saved) as Dto[];
    }
    const stores = arr<Dto>(raw).map(
      (s): CustomerStorePublic => ({
        id: str(s.id), code: str(s.code), name: str(s.name), branch: str(s.branch), address: str(s.address), city: str(s.city),
        operatingHours: str(s.operatingHours), isOpen: s.isOpen !== false, phone: str(s.phone),
        mapDimensions: { width: num(obj(s.mapDimensions).width) ?? 800, height: num(obj(s.mapDimensions).height) ?? 600 }, isDemo: s.isDemo === true,
      }),
    );
    PUBLIC_STORES_LIST.splice(0, PUBLIC_STORES_LIST.length, ...stores);
    const store = this.resolveStore(storeIdParam);
    if (store.id) {
      try {
        this.applyQueues(await apiGet<Dto>(`/api/public/stores/${encodeURIComponent(store.id)}/queues`, undefined, signal));
      } catch (e) {
        if (signal?.aborted) throw e;
        /* no estimate: the queue screen says "Not available" instead of guessing */
      }
    }
    hydrated = true;
  }

  get isHydrated(): boolean {
    return hydrated;
  }

  private applyQueues(q: Dto): void {
    const counters = arr<Dto>(q.counters).map((c) => ({
      id: str(c.id),
      name: str(c.name),
      type: str(c.type, ''),
      status: (c.status === 'open' ? 'open' : c.status === 'standby' ? 'standby' : 'closed') as 'open' | 'standby' | 'closed',
      estimatedWaitMins: num(c.estimatedWaitMins),
      queueLength: num(c.queueLength),
      isRecommended: c.isRecommended === true,
    }));
    const waits = counters.filter((c) => c.status === 'open' && c.estimatedWaitMins !== null).map((c) => c.estimatedWaitMins as number);
    const worst = waits.length ? Math.max(...waits) : null;
    queueCache = {
      lastUpdated: q.lastUpdated ? timeAgo(q.lastUpdated) : 'Not available',
      congestionLevel: worst === null ? 'unknown' : worst >= 6 ? 'high' : worst >= 3 ? 'moderate' : 'low',
      recommendedCounter: strOrNull(q.recommendedCounterName),
      dataAvailable: q.dataAvailable === true,
      note: strOrNull(q.note) ?? undefined,
      counters,
    };
  }

  /** Cheap refresh used by the queue screen / realtime events (no page remount). */
  async refreshQueues(signal?: AbortSignal): Promise<void> {
    const id = this.resolveStore().id;
    if (!id) return;
    this.applyQueues(await apiGet<Dto>(`/api/public/stores/${encodeURIComponent(id)}/queues`, undefined, signal));
    window.dispatchEvent(new CustomEvent('retalledge:customer-queues-updated'));
  }

  /** Store resolution: ?store=<id or code> (QR link) > last chosen store > first store. */
  resolveStore(storeParam?: string | null): CustomerStorePublic {
    if (storeParam) {
      const clean = storeParam.trim().toLowerCase();
      const match = PUBLIC_STORES_LIST.find((s) => s.id.toLowerCase() === clean || s.code.toLowerCase() === clean);
      if (match) {
        localStorage.setItem(STORAGE_KEYS.SELECTED_STORE_ID, match.id);
        return match;
      }
    }
    const savedId = localStorage.getItem(STORAGE_KEYS.SELECTED_STORE_ID);
    return PUBLIC_STORES_LIST.find((s) => s.id === savedId) || PUBLIC_STORES_LIST[0] || EMPTY_STORE;
  }

  setStore(storeId: string): CustomerStorePublic {
    const match = PUBLIC_STORES_LIST.find((s) => s.id === storeId) || PUBLIC_STORES_LIST[0] || EMPTY_STORE;
    localStorage.setItem(STORAGE_KEYS.SELECTED_STORE_ID, match.id);
    window.dispatchEvent(new CustomEvent('retalledge:customer-store-changed', { detail: { storeId: match.id } }));
    return match;
  }

  getCheckoutQueues(): CustomerQueues {
    return queueCache;
  }
}

export const customerService = new CustomerService();
