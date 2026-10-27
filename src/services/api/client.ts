/**
 * The single place that talks HTTP to the RetailEdge API.
 * - base URL from config, typed JSON, backend error envelope -> ApiError
 * - cancellation (AbortSignal), request timeout, bounded retry for idempotent GETs
 * - publishes connectivity (online / offline / not_configured) for the header badge
 */
import { useSyncExternalStore } from 'react';
import { API_BASE, IS_NOT_CONFIGURED } from './config';

export type ApiErrorKind = 'not_configured' | 'offline' | 'http' | 'aborted' | 'invalid';

export class ApiError extends Error {
  kind: ApiErrorKind;
  status?: number;
  code?: string;
  details?: unknown;
  requestId?: string;

  constructor(kind: ApiErrorKind, message: string, extra: { status?: number; code?: string; details?: unknown; requestId?: string } = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = extra.status;
    this.code = extra.code;
    this.details = extra.details;
    this.requestId = extra.requestId;
  }

  /** Short user-facing label: Offline / Not configured / Error 404 ... */
  get label(): string {
    if (this.kind === 'not_configured') return 'Not configured';
    if (this.kind === 'offline') return 'Offline';
    if (this.kind === 'http') return this.code ? this.code.replace(/_/g, ' ') : `HTTP ${this.status}`;
    return 'Error';
  }
}

export const isAbort = (e: unknown): boolean => e instanceof ApiError && e.kind === 'aborted';

/* ------------------------------------------------------------------ connectivity */
export type Connectivity = 'unknown' | 'online' | 'offline' | 'not_configured';
interface ConnState {
  state: Connectivity;
  lastOkAt: number | null;
  lastError: string | null;
}
let conn: ConnState = { state: IS_NOT_CONFIGURED ? 'not_configured' : 'unknown', lastOkAt: null, lastError: null };
const connListeners = new Set<() => void>();
function setConn(next: ConnState) {
  if (next.state === conn.state && next.lastError === conn.lastError && next.lastOkAt === conn.lastOkAt) return;
  conn = next;
  connListeners.forEach((l) => l());
}
const markOk = () => setConn({ state: 'online', lastOkAt: Date.now(), lastError: null });
const markDown = (msg: string) => setConn({ state: 'offline', lastOkAt: conn.lastOkAt, lastError: msg });

export const getConnectivity = (): ConnState => conn;
export function useConnectivity(): ConnState {
  return useSyncExternalStore(
    (l) => {
      connListeners.add(l);
      return () => connListeners.delete(l);
    },
    () => conn,
  );
}

/* ------------------------------------------------------------------ requests */
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  /** Sent as the Idempotency-Key header so a retried POST can never create a duplicate. */
  idempotencyKey?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** GET only. Default 2 (3 attempts). */
  retries?: number;
}

export function buildUrl(path: string, query?: RequestOptions['query']): string {
  const qs = new URLSearchParams();
  Object.entries(query ?? {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  const q = qs.toString();
  return `${API_BASE}${path}${q ? `?${q}` : ''}`;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new ApiError('aborted', 'Request cancelled'));
    });
  });

async function once<T>(path: string, o: RequestOptions): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('timeout'), o.timeoutMs ?? 15000);
  const onAbort = () => ctrl.abort('cancelled');
  o.signal?.addEventListener('abort', onAbort);
  try {
    const headers: Record<string, string> = { Accept: 'application/json', ...o.headers };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (o.idempotencyKey) headers['Idempotency-Key'] = o.idempotencyKey;
    let res: Response;
    try {
      res = await fetch(buildUrl(path, o.query), {
        method: o.method ?? 'GET',
        headers,
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
        signal: ctrl.signal,
      });
    } catch (e) {
      if (o.signal?.aborted) throw new ApiError('aborted', 'Request cancelled');
      const reason = ctrl.signal.aborted ? 'The server did not answer in time' : 'The RetailEdge server cannot be reached';
      markDown(reason);
      throw new ApiError('offline', reason, { details: String(e) });
    }
    markOk();
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        if (res.ok) throw new ApiError('invalid', 'The server returned a response that is not JSON', { status: res.status });
      }
    }
    if (!res.ok) {
      const env = (json as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } | undefined)?.error;
      throw new ApiError('http', env?.message ?? `The server answered ${res.status}`, {
        status: res.status,
        code: env?.code,
        details: env?.details,
        requestId: env?.requestId,
      });
    }
    return json as T;
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', onAbort);
  }
}

export async function apiRequest<T>(path: string, o: RequestOptions = {}): Promise<T> {
  if (IS_NOT_CONFIGURED) throw new ApiError('not_configured', 'VITE_API_URL is not set, so this build does not know where the RetailEdge server is');
  const method = o.method ?? 'GET';
  const attempts = method === 'GET' ? (o.retries ?? 2) + 1 : o.idempotencyKey ? 2 : 1;
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await once<T>(path, o);
    } catch (e) {
      last = e;
      const retryable = e instanceof ApiError && (e.kind === 'offline' || (e.kind === 'http' && (e.status ?? 0) >= 502));
      if (!retryable || i === attempts - 1) break;
      await sleep(400 * 2 ** i, o.signal);
    }
  }
  throw last;
}

export const apiGet = <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) => apiRequest<T>(path, { query, signal });
export const apiPost = <T>(path: string, body?: unknown, o: Omit<RequestOptions, 'method' | 'body'> = {}) => apiRequest<T>(path, { ...o, method: 'POST', body: body ?? {} });
export const apiPatch = <T>(path: string, body?: unknown, o: Omit<RequestOptions, 'method' | 'body'> = {}) => apiRequest<T>(path, { ...o, method: 'PATCH', body: body ?? {} });
export const apiPut = <T>(path: string, body?: unknown, o: Omit<RequestOptions, 'method' | 'body'> = {}) => apiRequest<T>(path, { ...o, method: 'PUT', body: body ?? {} });
export const apiDelete = <T>(path: string, query?: RequestOptions['query']) => apiRequest<T>(path, { method: 'DELETE', query });

/** Lightweight probe used by the connectivity badge. */
export async function probeBackend(): Promise<boolean> {
  try {
    await once<unknown>('/api/health', { timeoutMs: 4000 });
    return true;
  } catch {
    return false;
  }
}

export function newIdempotencyKey(prefix = 'ui'): string {
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rnd}`;
}
