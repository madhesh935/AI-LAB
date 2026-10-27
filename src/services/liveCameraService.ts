/**
 * Live camera data from the RetailEdge backend (Phase 2).
 *
 * Active in REAL mode whenever an API base URL is configured (services/api/config.ts); DEMO mode keeps the placeholder feeds.
 */
import { useSyncExternalStore } from 'react';
import { API_BASE, IS_DEMO_MODE } from './api/config';

const BASE = API_BASE;
export const liveCamerasEnabled = !IS_DEMO_MODE && BASE.length > 0;

export type LiveCameraState = 'live' | 'connecting' | 'reconnecting' | 'offline' | 'error' | 'buffering' | 'unknown';

export interface LiveStreamDescriptor {
  kind: 'mjpeg' | 'none';
  available: boolean;
  url: string | null;
  snapshotUrl: string | null;
  overlay: 'per-frame-header' | 'none';
  isDemo: boolean;
  reason: string | null;
}

export interface LiveCamera {
  id: string;
  storeId: string;
  cameraCode: string;
  name: string;
  type: string;
  zone: string | null;
  sourceType: string;
  sourceConfigured: boolean;
  enabled: boolean;
  isDemo: boolean;
  status: LiveCameraState;
  errorCode: string | null;
  message: string | null;
  frameWidth: number | null;
  frameHeight: number | null;
  inputFps: number | null;
  inferenceFps: number | null;
  inferenceMs: number | null;
  lastFrameAt: string | null;
  lastInferenceAt: string | null;
  peopleCount: number | null;
  workerOnline: boolean;
  stream: LiveStreamDescriptor;
}

/** Per-frame metadata carried in each MJPEG part (the overlay always belongs to this exact frame). */
export interface FrameMeta {
  cameraId: string;
  frameId: number;
  ts: string;
  w: number;
  h: number;
  isDemo: boolean;
  inferenceFps: number | null;
  inputFps: number | null;
  model: string | null;
  overlay: null | {
    frameId: number;
    lagFrames: number;
    inferenceMs: number;
    boxes: { id: number; c: number; x: number; y: number; w: number; h: number }[];
  };  /** What this camera is configured to measure (entrance line / checkout lanes / aisle zones / shelf regions) with live counts. */
  context?: CameraContext | null;
}

export interface CameraContext {
  kind: 'entrance' | 'exit' | 'queue' | 'checkout' | 'aisle' | 'shelf';
  lines?: { id: string; name: string; p1: number[]; p2: number[]; inDir: number[]; in: number; out: number; countOnly?: 'in' | 'out' | null }[];
  queues?: { id: string; name: string; poly: number[][]; n: number }[];
  zones?: { id: string; name: string; poly: number[][]; n: number }[];
  counters?: { id: string; name: string; poly: number[][]; n: number }[];
  shelves?: { id: string; name: string; poly: number[][]; n: number | null }[];
  items?: number[][];
  shelfModel?: boolean;
}

export interface ContextMetrics {
  hidePeople: boolean;
  primaryLabel: string;
  primaryValue: string;
  secondaryLabel: string;
  secondaryValue: string;
  badge: string;
}

/** The numbers a camera card shows are the ones its own context measures - never one generic person count for every camera. */
export function contextMetrics(ctx: CameraContext | null | undefined, people: number | null, inferenceFps: number | null): ContextMetrics {
  const fps = inferenceFps == null ? '--' : inferenceFps.toFixed(1);
  if (!ctx) {
    return { hidePeople: false, primaryLabel: 'People in view', primaryValue: people == null ? '--' : String(people), secondaryLabel: 'AI FPS', secondaryValue: fps, badge: people == null ? 'AI idle' : `${people} in view` };
  }
  if (ctx.kind === 'exit') {
    const o = (ctx.lines ?? []).reduce((a, l) => a + l.out, 0);
    const c = ctx.counters ?? [];
    const atCounters = c.reduce((a, x) => a + x.n, 0);
    return { hidePeople: false, primaryLabel: 'Exited', primaryValue: String(o), secondaryLabel: c.length ? 'At counters' : 'At exit', secondaryValue: c.length ? String(atCounters) : people == null ? '--' : String(people), badge: `OUT ${o}` };
  }
  if (ctx.kind === 'entrance') {
    const i = (ctx.lines ?? []).reduce((a, l) => a + l.in, 0);
    return { hidePeople: false, primaryLabel: 'Entered', primaryValue: String(i), secondaryLabel: 'At entrance', secondaryValue: people == null ? '--' : String(people), badge: `IN ${i}` };
  }
  if (ctx.kind === 'checkout') {
    const c = ctx.counters ?? [];
    const serving = c.reduce((a, x) => a + x.n, 0);
    const busy = c.filter((x) => x.n > 0);
    return { hidePeople: false, primaryLabel: 'At counters', primaryValue: String(serving), secondaryLabel: 'Counters in use', secondaryValue: `${busy.length} of ${c.length}`, badge: `${serving} at counters` };
  }
  if (ctx.kind === 'queue') {
    const q = ctx.queues ?? [];
    const total = q.reduce((a, x) => a + x.n, 0);
    const busiest = q.reduce<{ name: string; n: number } | null>((b, x) => (x.n > (b?.n ?? 0) ? { name: x.name, n: x.n } : b), null);
    return { hidePeople: false, primaryLabel: 'Waiting in lanes', primaryValue: String(total), secondaryLabel: 'Longest lane', secondaryValue: busiest ? `${busiest.name.split(' (')[0]} (${busiest.n})` : '—', badge: `${total} waiting` };
  }
  if (ctx.kind === 'aisle') {
    const z = ctx.zones ?? [];
    const total = z.reduce((a, x) => a + x.n, 0);
    const active = z.filter((x) => x.n > 0);
    return { hidePeople: false, primaryLabel: 'Shoppers in aisles', primaryValue: String(total), secondaryLabel: 'Zones occupied', secondaryValue: `${active.length} of ${z.length}`, badge: `${total} in aisles` };
  }
  const ready = ctx.shelfModel === true;
  const n = (ctx.items ?? []).length;
  if (ctx.zones && ctx.zones.length > 0 && !(ctx.shelves ?? []).length) {
    const total = ctx.zones.reduce((a, x) => a + x.n, 0);
    return { hidePeople: false, primaryLabel: 'Shoppers in aisles', primaryValue: String(total), secondaryLabel: 'Zones occupied', secondaryValue: `${ctx.zones.filter((x) => x.n > 0).length} of ${ctx.zones.length}`, badge: `${total} in aisles` };
  }
  return { hidePeople: true, primaryLabel: ready ? 'Items on shelves' : 'Shelf model', primaryValue: ready ? String(n) : 'not ready', secondaryLabel: 'Shelf regions', secondaryValue: String((ctx.shelves ?? []).length), badge: ready ? `${n} items` : 'shelf model not ready' };
}

export async function fetchLiveCameras(storeId: string, signal?: AbortSignal): Promise<LiveCamera[]> {
  const res = await fetch(`${BASE}/api/cameras?storeId=${encodeURIComponent(storeId)}`, { signal });
  if (!res.ok) throw new Error(`cameras ${res.status}`);
  return (await res.json()) as LiveCamera[];
}

/* ------------------------------------------------------------------ shared polling store */
interface Snapshot {
  cameras: LiveCamera[];
  reachable: boolean;
  loaded: boolean;
}
const EMPTY: Snapshot = { cameras: [], reachable: false, loaded: false };

class CameraStore {
  private snap: Snapshot = EMPTY;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private abort: AbortController | null = null;

  private storeId: string;

  constructor(storeId: string) {
    this.storeId = storeId;
  }

  getSnapshot = () => this.snap;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    if (this.listeners.size === 1) this.start();
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) this.stop();
    };
  };

  private start() {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), 2000);
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.abort?.abort();
    this.snap = EMPTY;
  }

  private async poll() {
    this.abort?.abort();
    const ctrl = (this.abort = new AbortController());
    try {
      const cameras = await fetchLiveCameras(this.storeId, ctrl.signal);
      this.snap = { cameras, reachable: true, loaded: true };
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      this.snap = { cameras: [], reachable: false, loaded: true };
    }
    this.listeners.forEach((fn) => fn());
  }
}

const stores = new Map<string, CameraStore>();
const NO_STORE = { subscribe: () => () => {}, getSnapshot: () => EMPTY };

/** Live cameras for one store, refreshed every 2 s while a component is subscribed. */
export function useLiveCameras(storeId: string): Snapshot {
  let store: { subscribe: (fn: () => void) => () => void; getSnapshot: () => Snapshot } = NO_STORE;
  if (liveCamerasEnabled) {
    if (!stores.has(storeId)) stores.set(storeId, new CameraStore(storeId));
    store = stores.get(storeId)!;
  }
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Backend camera that corresponds to a dashboard feed (backend camera codes match feed ids, e.g. CAM-01). */
export function matchLiveCamera(cameras: LiveCamera[], feed: { id: string; cameraCode: string }): LiveCamera | undefined {
  return cameras.find((c) => c.cameraCode === feed.id) ?? cameras.find((c) => c.cameraCode === feed.cameraCode);
}
