import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BadgePercent,
  CheckCircle2,
  HandHelping,
  Info,
  MapPin,
  Navigation,
  Package,
  Scale,
  Sparkles,
  Tag,
} from 'lucide-react';
import { useCustomer, useFetched } from '../../components/customer/customerContext';
import { CartControl, ProductImage } from '../../components/customer/ProductCard';
import { AvailabilityBadge, DemoNote, GetHelpButton, PriceTag, QuantityStepper, StaleNotice } from '../../components/customer/CustomerUi';
import { BackendState } from '../../components/common/BackendState';
import { Skeleton } from '../../components/common/Skeleton';
import { customerApi } from '../../services/customer/api';
import { cart, useCart } from '../../services/customer/cart';
import { formatMinor, relativeTime } from '../../services/customer/format';
import { ApiError } from '../../services/api/client';
import type { PriceComparison } from '../../services/customer/types';

export const CustomerProductDetail: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { storeId, showToast, availabilityTick } = useCustomer();
  const res = useFetched((signal) => customerApi.product(storeId, id, signal), [storeId, id, availabilityTick]);
  const [compare, setCompare] = useState<{ loading: boolean; data: PriceComparison | null; error: boolean }>({
    loading: false,
    data: null,
    error: false,
  });
  const p = res.data;
  const cartItems = useCart(storeId);
  const inCartLine = cartItems.find((i) => i.productId === id);

  const loadCompare = async (q: string) => {
    setCompare({ loading: true, data: null, error: false });
    try {
      const r = await customerApi.compare(storeId, q);
      setCompare({ loading: false, data: r.data, error: false });
    } catch {
      setCompare({ loading: false, data: null, error: true });
    }
  };

  if (res.loading && !p) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-24 rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-72 w-full rounded-2xl" />
          <div className="space-y-3">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (res.error && !p) {
    const notFound = res.error instanceof ApiError && res.error.status === 404;
    return notFound ? (
      <div className="space-y-3 rounded-2xl border border-[#E2E8F0] bg-white p-6 text-center">
        <p className="text-sm font-semibold text-[#0F172A]">This product is not currently listed in this store.</p>
        <Link to="/customer/products" className="text-xs font-semibold text-[#2563EB]">
          Browse all products
        </Link>
      </div>
    ) : (
      <BackendState error={res.error} onRetry={res.reload} what="This product" compact />
    );
  }

  if (!p) return null;

  const unit = p.price.unitPrice;
  const hasDiscount =
    p.price.listPriceMinor !== null &&
    p.price.effectivePriceMinor !== null &&
    p.price.effectivePriceMinor < p.price.listPriceMinor;
  const discountPercent = hasDiscount
    ? Math.round(((p.price.listPriceMinor! - p.price.effectivePriceMinor!) / p.price.listPriceMinor!) * 100)
    : 0;

  const primaryLoc = p.locations[0] ?? null;

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* Top Nav: Back button & Need Help */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#0F172A] shadow-sm hover:bg-slate-50 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </button>

        <GetHelpButton
          productId={p.id}
          productName={p.name}
          zone={p.location?.zoneName ?? null}
          category="product_information"
        />
      </div>

      {res.stale && <StaleNotice savedAt={res.savedAt} what="This product's details" />}

      {/* Main Product Layout (2 columns on Desktop, stacked on Mobile) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Left: Product Image & Badges */}
        <div className="md:col-span-5 space-y-3">
          <div className="relative flex h-72 sm:h-80 w-full items-center justify-center rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-sm">
            <ProductImage product={p} className="h-full w-full object-contain" />

            {hasDiscount && (
              <span className="absolute left-3 top-3 rounded-xl bg-[#EF4444] px-2.5 py-1 text-xs font-bold text-white shadow-sm">
                {discountPercent}% OFF
              </span>
            )}
          </div>

          {/* Product Location Card (Featured Box) */}
          <section
            className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 shadow-sm"
            aria-label="In-store location"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#2563EB] text-white">
                  <MapPin className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#2563EB]">Find this product</h3>
                  <p className="mt-0.5 text-sm font-bold text-[#0F172A]">
                    {primaryLoc
                      ? [primaryLoc.aisleLabel, `Shelf ${primaryLoc.shelfLabel}`].filter(Boolean).join(' · ')
                      : 'Location not mapped'}
                  </p>
                  {primaryLoc?.section && (
                    <p className="text-[11px] text-[#64748B]">{primaryLoc.section} section</p>
                  )}
                </div>
              </div>

              {primaryLoc?.onMap && (
                <Link
                  to={`/customer/map?product=${encodeURIComponent(p.id)}&shelf=${encodeURIComponent(primaryLoc.shelfId)}`}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 transition-colors"
                >
                  <Navigation className="h-3.5 w-3.5" />
                  <span>View on Map</span>
                </Link>
              )}
            </div>
          </section>
        </div>

        {/* Right: Product Details, Pricing, & Information */}
        <div className="md:col-span-7 space-y-4">
          <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm space-y-3">
            {/* Brand, Category, Pack */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#64748B]">
              {p.brand && <span className="font-bold text-[#0F172A]">{p.brand}</span>}
              {p.category && <span>· {p.category}</span>}
              {p.pack && <span>· {p.pack.label}</span>}
              <DemoNote isDemo={p.isDemo} />
            </div>

            {/* Title */}
            <h1 className="text-xl sm:text-2xl font-bold leading-snug text-[#0F172A]">{p.name}</h1>
            <p className="text-[11px] text-[#94A3B8]">SKU: {p.sku}</p>

            {/* Price section */}
            <div className="pt-1 flex flex-wrap items-baseline gap-2.5">
              <span className="text-2xl font-extrabold text-[#0F172A]">
                {formatMinor(p.price.effectivePriceMinor)}
              </span>
              {hasDiscount && (
                <span className="text-sm font-medium text-[#94A3B8] line-through">
                  {formatMinor(p.price.listPriceMinor!)}
                </span>
              )}
              {hasDiscount && (
                <span className="rounded-lg bg-green-50 px-2 py-0.5 text-xs font-bold text-[#16A34A] border border-green-200">
                  Save {formatMinor(p.price.listPriceMinor! - p.price.effectivePriceMinor!)}
                </span>
              )}
            </div>

            {unit && (
              <p className="flex items-center gap-1 text-xs text-[#64748B]">
                <Scale className="h-3.5 w-3.5" />
                <span>
                  {formatMinor(unit.perMinor)} per {unit.basis}
                </span>
              </p>
            )}

            {/* Availability */}
            <div className="pt-1">
              <AvailabilityBadge availability={p.availability} showAge />
            </div>

            {/* Offers applied */}
            {p.price.appliedOffers.map((o) => (
              <div
                key={o.id}
                className="flex items-start gap-2 rounded-xl bg-green-50 p-2.5 text-xs text-green-900 border border-green-200"
              >
                <BadgePercent className="mt-0.5 h-4 w-4 shrink-0 text-[#16A34A]" />
                <div>
                  <strong className="block">{o.title}</strong>
                  <span className="text-green-800">
                    {o.validUntil
                      ? `Valid until ${new Date(o.validUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                      : 'Active promotional discount'}
                  </span>
                </div>
              </div>
            ))}

            {/* Desktop Add to Cart & Route Action Bar */}
            <div className="hidden md:flex items-center gap-3 pt-3 border-t border-[#E2E8F0]">
              <div className="flex-1">
                <CartControl storeId={storeId} product={p} onAdded={(n) => showToast(`${n} added to cart`)} full />
              </div>
              {primaryLoc?.onMap && (
                <Link
                  to={`/customer/map?product=${encodeURIComponent(p.id)}&shelf=${encodeURIComponent(primaryLoc.shelfId)}`}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[#E2E8F0] px-4 text-xs font-semibold text-[#0F172A] hover:bg-slate-50 transition-colors"
                >
                  <Navigation className="h-4 w-4 text-[#2563EB]" />
                  <span>Route</span>
                </Link>
              )}
            </div>
          </div>

          {/* Product Description */}
          {p.description && (
            <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm space-y-1.5">
              <h2 className="text-sm font-bold text-[#0F172A]">About this product</h2>
              <p className="text-xs leading-relaxed text-[#475569]">{p.description}</p>
            </div>
          )}

          {/* In-store comparison widget */}
          {p.category && (
            <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-[#0F172A]">Compare Similar Items</h2>
                  <p className="text-xs text-[#64748B]">Best price and value in {p.category}</p>
                </div>
                {!compare.data && (
                  <button
                    type="button"
                    onClick={() => void loadCompare(p.category ?? '')}
                    disabled={compare.loading}
                    className="rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-semibold text-[#2563EB] hover:bg-blue-100 transition-colors disabled:opacity-60"
                  >
                    {compare.loading ? 'Comparing...' : 'Compare Prices'}
                  </button>
                )}
              </div>

              {compare.data && (
                <div className="space-y-2 pt-1">
                  {compare.data.explanation && (
                    <p className="text-xs text-[#475569]">{compare.data.explanation}</p>
                  )}
                  <ul className="divide-y divide-[#E2E8F0]">
                    {compare.data.items.slice(0, 5).map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                        <Link
                          to={`/customer/products/${encodeURIComponent(c.id)}`}
                          className={`min-w-0 truncate hover:text-[#2563EB] ${c.id === p.id ? 'font-bold text-[#0F172A]' : 'text-[#334155]'}`}
                        >
                          {c.name}
                          {c.id === compare.data?.cheapest?.id && (
                            <span className="ml-1.5 rounded-md bg-green-50 px-1.5 py-0.5 text-[10px] font-bold text-green-700 border border-green-200">
                              Lowest Price
                            </span>
                          )}
                          {c.id === compare.data?.bestUnitPrice?.id && (
                            <span className="ml-1.5 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200">
                              Best Value
                            </span>
                          )}
                        </Link>
                        <span className="shrink-0 text-right font-semibold">
                          {formatMinor(c.price.effectivePriceMinor)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mobile Sticky Action Bar */}
      <div className="md:hidden fixed bottom-16 left-0 right-0 z-30 border-t border-[#E2E8F0] bg-white/95 px-4 py-2.5 backdrop-blur-md shadow-lg">
        <div className="mx-auto flex max-w-md items-center gap-2.5">
          <div className="flex-1">
            <CartControl storeId={storeId} product={p} onAdded={(n) => showToast(`${n} added to cart`)} full />
          </div>
          {primaryLoc?.onMap && (
            <Link
              to={`/customer/map?product=${encodeURIComponent(p.id)}&shelf=${encodeURIComponent(primaryLoc.shelfId)}`}
              className="inline-flex h-9 items-center justify-center gap-1 rounded-xl border border-[#E2E8F0] bg-slate-50 px-3 text-xs font-semibold text-[#0F172A] hover:bg-slate-100"
            >
              <Navigation className="h-3.5 w-3.5 text-[#2563EB]" />
              <span>Route</span>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};

export default CustomerProductDetail;
