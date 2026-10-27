import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, CircleHelp, Clock3, EyeOff, HandHelping, History, Minus, Plus, TriangleAlert } from 'lucide-react';
import type { Availability, Price } from '../../services/customer/types';
import { formatMinor, relativeTime } from '../../services/customer/format';

const AVAILABILITY_STYLE: Record<Availability['state'], { cls: string; Icon: React.ElementType }> = {
  in_stock: { cls: 'bg-green-50 text-green-700 border-green-200', Icon: CheckCircle2 },
  low_stock: { cls: 'bg-amber-50 text-amber-700 border-amber-200', Icon: TriangleAlert },
  out_of_stock: { cls: 'bg-red-50 text-red-700 border-red-200', Icon: EyeOff },
  unknown: { cls: 'bg-slate-50 text-slate-600 border-slate-200', Icon: CircleHelp },
};

/** Shelf-camera availability exactly as the backend labelled it, plus how old the observation is. */
export const AvailabilityBadge: React.FC<{ availability: Availability; showAge?: boolean }> = ({ availability, showAge }) => {
  const s = AVAILABILITY_STYLE[availability.state] ?? AVAILABILITY_STYLE.unknown;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.cls}`} data-testid="availability-badge">
        <s.Icon className="h-3 w-3" />
        {availability.label}
      </span>
      {showAge && availability.observedAt && (
        <span className={`text-[11px] ${availability.isStale ? 'text-amber-700' : 'text-slate-500'}`}>
          {availability.isStale ? 'Last checked ' : 'Checked '}
          {relativeTime(availability.observedAt)}
        </span>
      )}
    </span>
  );
};

/** List price, effective price and savings. "Price unavailable" when the store has no price - never an invented one. */
export const PriceTag: React.FC<{ price: Price; size?: 'sm' | 'lg' }> = ({ price, size = 'sm' }) => {
  if (!price.priceAvailable || price.effectivePriceMinor === null) {
    return <span className={`font-semibold text-slate-500 ${size === 'lg' ? 'text-base' : 'text-xs'}`}>Price unavailable</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <span className={`font-bold text-slate-900 ${size === 'lg' ? 'text-2xl' : 'text-sm'}`}>{formatMinor(price.effectivePriceMinor)}</span>
      {price.hasOffer && price.listPriceMinor !== null && price.listPriceMinor > price.effectivePriceMinor && (
        <>
          <span className={`text-slate-400 line-through ${size === 'lg' ? 'text-sm' : 'text-[11px]'}`}>{formatMinor(price.listPriceMinor)}</span>
          <span className={`font-semibold text-green-700 ${size === 'lg' ? 'text-sm' : 'text-[11px]'}`}>Save {formatMinor(price.savingsMinor)}</span>
        </>
      )}
    </span>
  );
};

export const QuantityStepper: React.FC<{ value: number; onChange: (n: number) => void; label: string; min?: number }> = ({ value, onChange, label, min = 0 }) => (
  <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white" role="group" aria-label={`Quantity of ${label}`}>
    <button
      type="button"
      className="flex h-9 w-9 items-center justify-center text-slate-600 hover:text-blue-600 disabled:opacity-40"
      onClick={() => onChange(value - 1)}
      disabled={value <= min}
      aria-label={`Decrease ${label}`}
    >
      <Minus className="h-4 w-4" />
    </button>
    <span className="min-w-[2ch] text-center text-sm font-semibold tabular-nums" aria-live="polite">
      {value}
    </span>
    <button
      type="button"
      className="flex h-9 w-9 items-center justify-center text-slate-600 hover:text-blue-600 disabled:opacity-40"
      onClick={() => onChange(value + 1)}
      disabled={value >= 99}
      aria-label={`Increase ${label}`}
    >
      <Plus className="h-4 w-4" />
    </button>
  </div>
);

/** Shown whenever a screen renders a cached copy because the server could not be reached. */
export const StaleNotice: React.FC<{ savedAt: number | null; what?: string }> = ({ savedAt, what = 'This information' }) => (
  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status" data-testid="stale-notice">
    <History className="mt-0.5 h-3.5 w-3.5 shrink-0" />
    <span>
      {what} is a saved copy from {relativeTime(savedAt)} - you are offline, so prices and availability may have changed.
    </span>
  </div>
);

export const GetHelpButton: React.FC<{ productId?: string; productName?: string; zone?: string | null; category?: string; variant?: 'pill' | 'block' }> = ({
  productId,
  productName,
  zone,
  category,
  variant = 'pill',
}) => {
  const qs = new URLSearchParams();
  if (category) qs.set('category', category);
  if (productId) qs.set('productId', productId);
  if (productName) qs.set('productName', productName);
  if (zone) qs.set('zone', zone);
  const to = `/customer/help${qs.toString() ? `?${qs}` : ''}`;
  return variant === 'block' ? (
    <Link
      to={to}
      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-100"
    >
      <HandHelping className="h-4 w-4" /> Get Help from Staff
    </Link>
  ) : (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-sm hover:bg-blue-50"
    >
      <HandHelping className="h-3.5 w-3.5" /> Get Help
    </Link>
  );
};

export const SectionHeader: React.FC<{ title: string; to?: string; action?: string }> = ({ title, to, action = 'See all' }) => (
  <div className="flex items-center justify-between">
    <h2 className="text-sm font-bold text-slate-900">{title}</h2>
    {to && (
      <Link to={to} className="text-xs font-semibold text-blue-600 hover:underline">
        {action}
      </Link>
    )}
  </div>
);

export const EmptyState: React.FC<{ icon?: React.ElementType; title: string; children?: React.ReactNode }> = ({ icon: Icon = Clock3, title, children }) => (
  <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center">
    <Icon className="h-8 w-8 text-slate-300" />
    <p className="mt-2 text-sm font-semibold text-slate-700">{title}</p>
    {children && <div className="mt-1 text-xs text-slate-500">{children}</div>}
  </div>
);

export const DemoNote: React.FC<{ isDemo?: boolean }> = ({ isDemo }) =>
  isDemo ? (
    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
      Demo store data
    </span>
  ) : null;
