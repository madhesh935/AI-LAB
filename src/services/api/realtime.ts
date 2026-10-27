/**
 * ONE WebSocket per browser tab to /ws/stores/{id}/events (never one per card).
 *
 * Contract (see backend/api/events.py): hello -> snapshot -> [replayed events | resync] -> live events + heartbeat.
 * Every message uses the same envelope { eventId, seq, storeId, type, timestamp, source, payload }.
 * The client dedupes by eventId, remembers the last seq/epoch to recover missed events after a reconnect,
 * marks the feed `stale` when heartbeats stop, and tells listeners to refetch (`resync`) when recovery is impossible.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { IS_DEMO_MODE, IS_NOT_CONFIGURED, wsUrlFor } from './config';

export interface RealtimeEvent<P = Record<string, unknown>> {
  eventId: string;
  seq: number;
  storeId: string;
  type: string;
  timestamp: string;
  source: string;
  payload: P;
}

export type RealtimeAudience = 'staff' | 'customer' | undefined;
export type RealtimeStatus = 'idle' | 'connecting' | 'live' | 'stale' | 'reconnecting' | 'offline';

export interface RealtimeSnapshot {
  dataMode?: string;
  epoch?: string;
  seq?: number;
  occupancy?: { estimate: number | null; status: string | null };
  activeAlerts?: number;
  criticalAlerts?: number;
  openTasks?: number;
  pendingAssistanceRequests?: number;
  camerasOnline?: number;
  camerasTotal?: number;
}

export interface RealtimeState {
  status: RealtimeStatus;
  storeId: string | null;
  lastMessageAt: number | null;
  lastEventAt: number | null;
  snapshot: RealtimeSnapshot | null;
  reconnects: number;
}

type Handler = (event: RealtimeEvent) => void;

const DEDUPE_LIMIT = 600;
const BACKOFF = [1000, 2000, 4000, 8000, 15000];

class RealtimeClient {
  private ws: WebSocket | null = null;
  private storeId: string | null = null;
  private audience: RealtimeAudience;
  private refs = 0;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private attempt = 0;
  private heartbeatMs = 15000;
  private lastSeq: number | null = null;
  private epoch: string | null = null;
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  private handlers = new Set<Handler>();
  private listeners = new Set<() => void>();
  private state: RealtimeState = { status: 'idle', storeId: null, lastMessageAt: null, lastEventAt: null, snapshot: null, reconnects: 0 };

  getState = (): RealtimeState => this.state;

  subscribeState = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  onEvent(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  /** Reference-counted: many components share the one socket. Returns the release function. */
  acquire(storeId: string, audience?: RealtimeAudience): () => void {
    if (IS_DEMO_MODE || IS_NOT_CONFIGURED || typeof WebSocket === 'undefined') return () => undefined;
    this.refs += 1;
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    if (this.storeId !== storeId || this.audience !== audience || !this.ws) {
      this.switchTo(storeId, audience);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.refs = Math.max(0, this.refs - 1);
      if (this.refs === 0) {
        // Keep the socket briefly so route changes / StrictMode re-mounts do not churn the connection.
        this.closeTimer = setTimeout(() => this.shutdown(), 1500);
      }
    };
  }

  private set(partial: Partial<RealtimeState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((l) => l());
  }

  private switchTo(storeId: string, audience: RealtimeAudience) {
    this.shutdown(false);
    this.storeId = storeId;
    this.audience = audience;
    this.lastSeq = null;
    this.epoch = null;
    this.attempt = 0;
    this.seen.clear();
    this.seenOrder = [];
    this.set({ status: 'connecting', storeId, snapshot: null, lastMessageAt: null, lastEventAt: null });
    this.open();
    if (!this.staleTimer) this.staleTimer = setInterval(() => this.checkStale(), 5000);
  }

  private shutdown(resetState = true) {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.retryTimer = null;
    this.staleTimer = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
    if (resetState) {
      this.storeId = null;
      this.set({ status: 'idle', storeId: null, snapshot: null });
    }
  }

  private open() {
    if (!this.storeId) return;
    const q = new URLSearchParams();
    if (this.lastSeq !== null && this.epoch) {
      q.set('since', String(this.lastSeq));
      q.set('epoch', this.epoch);
    }
    if (this.audience) q.set('audience', this.audience);
    const url = wsUrlFor(`/ws/stores/${encodeURIComponent(this.storeId)}/events`) + (q.toString() ? `?${q}` : '');
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
    };
    ws.onmessage = (msg) => this.onMessage(msg.data);
    ws.onerror = () => undefined; // onclose follows and drives the retry
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (!this.storeId || this.refs === 0) return;
    const delay = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)];
    this.attempt += 1;
    this.set({ status: this.attempt > 3 ? 'offline' : 'reconnecting', reconnects: this.state.reconnects + 1 });
    this.retryTimer = setTimeout(() => this.open(), delay);
  }

  private checkStale() {
    const s = this.state;
    if (s.status === 'live' && s.lastMessageAt && Date.now() - s.lastMessageAt > this.heartbeatMs * 2.2) {
      this.set({ status: 'stale' });
    }
  }

  private remember(id: string): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > DEDUPE_LIMIT) {
      const old = this.seenOrder.shift();
      if (old) this.seen.delete(old);
    }
    return true;
  }

  private onMessage(raw: unknown) {
    let ev: RealtimeEvent;
    try {
      ev = JSON.parse(String(raw)) as RealtimeEvent;
    } catch {
      return;
    }
    if (!ev || typeof ev.type !== 'string') return;
    const now = Date.now();
    if (ev.type === 'hello') {
      const p = ev.payload as { epoch?: string; heartbeatSeconds?: number; replay?: string };
      if (p.heartbeatSeconds) this.heartbeatMs = p.heartbeatSeconds * 1000;
      if (p.epoch && this.epoch && p.epoch !== this.epoch) this.emit({ ...ev, type: 'resync', payload: { reason: 'server restarted' } });
      if (p.epoch) this.epoch = p.epoch;
      this.set({ status: 'live', lastMessageAt: now });
      return;
    }
    if (ev.type === 'snapshot') {
      const snap = ev.payload as RealtimeSnapshot;
      this.lastSeq = typeof snap.seq === 'number' ? snap.seq : this.lastSeq;
      if (snap.epoch) this.epoch = snap.epoch;
      const reconnect = this.state.snapshot !== null;
      this.set({ snapshot: snap, status: 'live', lastMessageAt: now });
      if (reconnect) this.emit(ev); // the first snapshot only seeds state; a later one means we reconnected, so listeners refetch
      return;
    }
    if (ev.type === 'heartbeat') {
      this.set({ status: 'live', lastMessageAt: now });
      return;
    }
    if (ev.type === 'resync') {
      this.set({ status: 'live', lastMessageAt: now });
      this.emit(ev);
      return;
    }
    if (!this.remember(ev.eventId)) return;
    if (typeof ev.seq === 'number' && (this.lastSeq === null || ev.seq > this.lastSeq)) this.lastSeq = ev.seq;
    this.set({ status: 'live', lastMessageAt: now, lastEventAt: now });
    this.emit(ev);
  }

  private emit(ev: RealtimeEvent) {
    this.handlers.forEach((h) => {
      try {
        h(ev);
      } catch (e) {
        console.error('realtime handler failed', e);
      }
    });
  }
}

export const realtime = new RealtimeClient();

/** Keep the shared socket open for the lifetime of the calling component and expose its state. */
export function useRealtime(storeId: string | null | undefined, audience?: RealtimeAudience): RealtimeState {
  useEffect(() => {
    if (!storeId) return undefined;
    return realtime.acquire(storeId, audience);
  }, [storeId, audience]);
  return useSyncExternalStore(realtime.subscribeState, realtime.getState);
}

/**
 * Run `handler` for matching events. `types` entries match exactly or, when they end with ".", by prefix
 * ("task." matches task.created, task.assigned ...). `resync` and `snapshot` are always delivered.
 */
export function useRealtimeEvents(types: string[], handler: (e: RealtimeEvent) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  const key = types.join('|');
  useEffect(() => {
    const wanted = key ? key.split('|') : [];
    return realtime.onEvent((e) => {
      if (e.type === 'resync' || e.type === 'snapshot' || wanted.some((t) => e.type === t || (t.endsWith('.') && e.type.startsWith(t)))) ref.current(e);
    });
  }, [key]);
}

/**
 * Call `reload` (debounced) when matching events arrive, and when the feed had to resync after a gap/restart.
 * Pages use this so a camera/task change shows up without a manual refresh.
 */
export function useLiveRefresh(types: string[], reload: () => void, delayMs = 1200): void {
  const ref = useRef(reload);
  ref.current = reload;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtimeEvents(types, () => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      ref.current();
    }, delayMs);
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
}
