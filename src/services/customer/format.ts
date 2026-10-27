/** Display helpers for the Customer PWA. Prices arrive as integer paise and are only formatted here, never recalculated. */

const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMinor(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return 'Price unavailable';
  return minor % 100 === 0 ? inr0.format(minor / 100) : inr2.format(minor / 100);
}

export function relativeTime(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return 'never';
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return 'unknown time';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function locationText(loc: { aisleLabel: string | null; shelfLabel: string; section: string | null } | null | undefined): string | null {
  if (!loc) return null;
  const parts = [loc.aisleLabel, `Shelf ${loc.shelfLabel}`].filter(Boolean);
  return parts.join(', ') + (loc.section ? ` · ${loc.section}` : '');
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
