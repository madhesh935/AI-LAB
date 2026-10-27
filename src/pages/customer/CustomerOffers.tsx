import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  ChevronRight,
  Info,
  Layers,
  Sparkles,
  Tag,
  TicketPercent,
} from 'lucide-react';
import { useCustomer, useFetched } from '../../components/customer/customerContext';
import { CartControl, ProductImage } from '../../components/customer/ProductCard';
import { DemoNote, EmptyState, StaleNotice } from '../../components/customer/CustomerUi';
import { BackendState } from '../../components/common/BackendState';
import { Skeleton } from '../../components/common/Skeleton';
import { customerApi } from '../../services/customer/api';
import { formatMinor, relativeTime } from '../../services/customer/format';

const dateLabel = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

export const CustomerOffers: React.FC = () => {
  const { storeId, showToast, availabilityTick } = useCustomer();
  const res = useFetched((signal) => customerApi.offers(storeId, signal), [storeId, availabilityTick]);
  const d = res.data;
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const categories = useMemo(() => {
    if (!d?.items) return [];
    const set = new Set<string>();
    d.items.forEach((item) => {
      if (item.category) set.add(item.category);
      if (item.product?.category) set.add(item.product.category);
    });
    return Array.from(set).sort();
  }, [d]);

  const filteredOffers = useMemo(() => {
    if (!d?.items) return [];
    if (selectedCategory === 'all') return d.items;
    return d.items.filter(
      (item) => item.category === selectedCategory || item.product?.category === selectedCategory
    );
  }, [d, selectedCategory]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0F172A]">Today's Offers</h1>
          <DemoNote isDemo={d?.isDemo} />
        </div>
        <p className="text-xs sm:text-sm text-[#64748B]">
          Exclusive promotional discounts verified active in this store today.
        </p>
      </header>

      {/* Category Filter Pills */}
      {categories.length > 0 && (
        <div className="no-scrollbar -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              selectedCategory === 'all'
                ? 'bg-[#2563EB] text-white shadow-sm'
                : 'border border-[#E2E8F0] bg-white text-[#64748B] hover:border-slate-300'
            }`}
          >
            All Offers
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                selectedCategory === cat
                  ? 'bg-[#2563EB] text-white shadow-sm'
                  : 'border border-[#E2E8F0] bg-white text-[#64748B] hover:border-slate-300'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {res.stale && <StaleNotice savedAt={res.savedAt} what="This offer list" />}
      {!!res.error && !d && <BackendState error={res.error} onRetry={res.reload} what="Offers" compact />}

      {res.loading && !d && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {d && filteredOffers.length === 0 && (
        <EmptyState icon={TicketPercent} title="No offers found">
          There are currently no active offers in this section. Browse all categories or check back soon.
        </EmptyState>
      )}

      {/* Offers Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredOffers.map((o) => {
          const hasDiscount =
            o.offerPriceMinor !== null &&
            o.originalPriceMinor !== null &&
            o.originalPriceMinor > o.offerPriceMinor;
          const discountPercent = hasDiscount
            ? Math.round(((o.originalPriceMinor! - o.offerPriceMinor!) / o.originalPriceMinor!) * 100)
            : 0;

          return (
            <div
              key={o.id}
              className="flex flex-col justify-between rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm transition-all hover:border-blue-200 hover:shadow-md"
              data-testid="offer-card"
            >
              <div>
                <div className="flex items-start gap-3">
                  {o.product ? (
                    <div className="relative h-18 w-18 shrink-0 overflow-hidden rounded-xl bg-slate-50 p-1 flex items-center justify-center">
                      <ProductImage product={o.product} className="h-16 w-16" />
                      {hasDiscount && (
                        <span className="absolute left-1 top-1 rounded bg-[#EF4444] px-1 py-0.5 text-[9px] font-bold text-white">
                          {discountPercent}% OFF
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-green-50 text-[#16A34A]">
                      <TicketPercent className="h-6 w-6" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    {o.label && (
                      <span className="inline-block rounded-md bg-green-50 px-2 py-0.5 text-[10px] font-bold text-[#16A34A] border border-green-200">
                        {o.label}
                      </span>
                    )}
                    <h2 className="mt-1 line-clamp-1 text-sm font-bold text-[#0F172A]">{o.title}</h2>
                    {o.description && <p className="line-clamp-2 text-xs text-[#64748B]">{o.description}</p>}
                    {o.product && (
                      <Link
                        to={`/customer/products/${encodeURIComponent(o.product.id)}`}
                        className="mt-1 inline-block text-xs font-semibold text-[#2563EB] hover:underline truncate max-w-full"
                      >
                        {o.product.name}
                      </Link>
                    )}
                  </div>
                </div>

                {/* Price Display */}
                {o.offerPriceMinor !== null && (
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-lg font-extrabold text-[#0F172A]">
                      {formatMinor(o.offerPriceMinor)}
                    </span>
                    {o.originalPriceMinor !== null && o.originalPriceMinor > o.offerPriceMinor && (
                      <span className="text-xs text-[#94A3B8] line-through">
                        {formatMinor(o.originalPriceMinor)}
                      </span>
                    )}
                    {o.savingsMinor ? (
                      <span className="rounded-md bg-green-50 px-1.5 py-0.5 text-[11px] font-bold text-[#16A34A]">
                        Save {formatMinor(o.savingsMinor)}
                      </span>
                    ) : null}
                  </div>
                )}

                {/* Conditions / Dates */}
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#64748B]">
                  {o.validUntil && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="h-3 w-3" /> Valid until {dateLabel(o.validUntil)}
                    </span>
                  )}
                  {o.minQuantity > 1 && <span>Buy {o.minQuantity}+ to qualify</span>}
                </div>
              </div>

              {/* Bottom Add to Cart Button */}
              {o.product && (
                <div className="mt-4 pt-2 border-t border-slate-100">
                  <CartControl storeId={storeId} product={o.product} onAdded={(n) => showToast(`${n} added to cart`)} full />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {d && (
        <p className="flex items-center gap-1 text-[11px] text-[#94A3B8] pt-2">
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span>{d.note} · verified {relativeTime(d.validatedAt)}</span>
        </p>
      )}
    </div>
  );
};

export default CustomerOffers;
