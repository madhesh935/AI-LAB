/**
 * Runtime configuration for the API layer.
 *
 *  VITE_DATA_MODE   real (default) | demo
 *      real  - every value comes from the RetailEdge backend; if it is unreachable the UI says so (Offline / Not configured).
 *      demo  - the built-in fixtures in mockData.ts, clearly labelled DEMO. Never used as a silent fallback for real mode.
 *  VITE_API_URL     base URL of the FastAPI server, e.g. http://127.0.0.1:8000 (VITE_CAMERA_API_URL is accepted as an alias).
 *                   In `npm run dev` it defaults to http://127.0.0.1:8000, the backend's default bind address.
 */
export type DataMode = 'real' | 'demo';

const env = import.meta.env as Record<string, string | undefined>;

export const DATA_MODE: DataMode = (env.VITE_DATA_MODE ?? '').toLowerCase() === 'demo' ? 'demo' : 'real';

function resolveBase(): string {
  const explicit = (env.VITE_API_URL ?? env.VITE_CAMERA_API_URL ?? '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  // Dev convenience only: the documented default bind of the local API. A production build must configure VITE_API_URL.
  return import.meta.env.DEV ? 'http://127.0.0.1:8000' : '';
}

export const API_BASE = resolveBase();
export const IS_DEMO_MODE = DATA_MODE === 'demo';
/** Real mode with no API URL (production build without VITE_API_URL). */
export const IS_NOT_CONFIGURED = DATA_MODE === 'real' && API_BASE === '';

export function wsUrlFor(path: string): string {
  const base = API_BASE || (typeof window !== 'undefined' ? window.location.origin : '');
  return base.replace(/^http/i, 'ws') + path;
}

export function absoluteUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
}
