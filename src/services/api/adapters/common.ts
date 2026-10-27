/**
 * Helpers shared by the DTO -> page-model adapters.
 *
 * The backend returns camelCase DTOs that already resemble the page models. The adapters only:
 *  - rename / reshape fields,
 *  - keep "not measured" as null (never invent a number),
 *  - turn ISO timestamps into the display strings the pages already render.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Dto = Record<string, any>;

export const obj = (v: unknown): Dto => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Dto) : {});
export const arr = <T = Dto>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
export const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
export const bool = (v: unknown): boolean => v === true;

/** `{ items: [...] }` envelopes and bare arrays both appear. */
export const items = <T = Dto>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : arr<T>(obj(v).items));

export function parseIso(iso: unknown): Date | null {
  if (typeof iso !== 'string' || !iso) return null;
  // The API stamps UTC; SQLite sometimes drops the offset, so treat an offset-less value as UTC.
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(iso);
  const d = new Date(hasZone ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function timeAgo(iso: unknown, now: number = Date.now()): string {
  const d = parseIso(iso);
  if (!d) return 'No observation yet';
  const sec = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (sec < 45) return 'Just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min${min === 1 ? '' : 's'} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr${hr === 1 ? '' : 's'} ago`;
  const days = Math.round(hr / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function clock(iso: unknown, withSeconds = false): string {
  const d = parseIso(iso);
  if (!d) return '—';
  return d.toLocaleTimeString([], withSeconds ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
}

export function dateTime(iso: unknown): string {
  const d = parseIso(iso);
  if (!d) return '—';
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${clock(iso)}`;
}

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('') || '?';

/** Minutes between now and an ISO due time, never below 0. */
export function minutesUntil(iso: unknown, now: number = Date.now()): number {
  const d = parseIso(iso);
  return d ? Math.max(0, Math.round((d.getTime() - now) / 60000)) : 0;
}
