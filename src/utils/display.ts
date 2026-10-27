/** Formatting helpers for values the backend may not have measured (null). "Not measured" renders as an em dash, never as 0. */
export const DASH = '—';

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function fmt(v: number | null | undefined, digits?: number): string {
  if (!isNum(v)) return DASH;
  return digits === undefined ? v.toLocaleString() : v.toFixed(digits);
}

/** "+4.2%" / "-3.1m" / "—" */
export function signed(v: number | null | undefined, suffix = '', digits?: number): string {
  if (!isNum(v)) return DASH;
  const n = digits === undefined ? v : Number(v.toFixed(digits));
  return `${n > 0 ? '+' : ''}${n}${suffix}`;
}

export function pct(v: number | null | undefined, digits = 0): string {
  return isNum(v) ? `${v.toFixed(digits)}%` : DASH;
}

/** 0-100 clamp for progress bars; null renders an empty bar. */
export const barPct = (v: number | null | undefined): number => (isNum(v) ? Math.max(0, Math.min(100, v)) : 0);

export const ratio = (num: number | null | undefined, den: number | null | undefined): number | null =>
  isNum(num) && isNum(den) && den > 0 ? Math.round((num / den) * 100) : null;

/** "12 min" / "45%" or an em dash when the value was not measured. */
export const withUnit = (v: number | null | undefined, unit: string): string => (isNum(v) ? `${v}${unit}` : DASH);
