import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  MapPin,
  Navigation,
  Package,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { useCustomer, useFetched } from '../../components/customer/customerContext';
import { ProductImage } from '../../components/customer/ProductCard';
import { AvailabilityBadge, EmptyState, QuantityStepper, StaleNotice } from '../../components/customer/CustomerUi';
import { cart, useCart } from '../../services/customer/cart';
import { customerApi } from '../../services/customer/api';
import { formatMinor, locationText, plural } from '../../services/customer/format';

export const CustomerCart: React.FC = () => {
  const navigate = useNavigate();
  const { storeId, showToast, availabilityTick } = useCustomer();
  const items = useCart(storeId);
  const lines = useMemo(() => items.map((i) => ({ productId: i.productId, quantity: i.quantity })), [items]);
  const key = lines.map((l) => `${l.productId}:${l.quantity}`).join(',');
  const quote = useFetched(lines.length ? (signal) => customerApi.cartQuote(storeId, lines, signal) : null, [
    storeId,
    key,
    availabilityTick,
  ]);
  const q = quote.data && lines.length ? quote.data : null;
  const byId = useMemo(() => new Map((q?.lines ?? []).map((l) => [l.productId, l])), [q]);
  const missing = new Set(q?.missingProductIds ?? []);
  const unmapped = items.filter((i) => {
    const l = byId.get(i.productId);
    return l && !l.product.mapped;
  });
  const routable = items.filter((i) => byId.get(i.productId)?.product.mapped).length;

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0F172A]">My Cart</h1>
        <EmptyState icon={ShoppingCart} title="Your cart is empty">
          Add products from our catalog to plan your store trip. We will calculate prices, offers, and generate the fastest walking route through store aisles.
          <div className="mt-4">
            <Link
              to="/customer/products"
              className="inline-flex items-center gap-2 rounded-xl bg-[#2563EB] px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 transition-colors"
            >
              <span>Browse Products</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0F172A]">My Cart</h1>
          <p className="text-xs text-[#64748B]">
            {plural(items.length, 'product')} · In-store shopping list & navigation plan
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            cart.clear(storeId);
            showToast('Cart cleared', 'info');
          }}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:border-red-200 hover:text-[#EF4444] transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Clear All</span>
        </button>
      </div>

      {quote.stale && <StaleNotice savedAt={quote.savedAt} what="These prices" />}
      {!!quote.error && !q && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Live prices could not be loaded - your items are saved safely on this device.{' '}
          <button type="button" onClick={quote.reload} className="font-semibold underline">
            Retry
          </button>
        </p>
      )}

      {/* 2-column layout on Desktop, 1-column on Mobile */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Product List (8 cols on Desktop) */}
        <div className="lg:col-span-7 space-y-3">
          <ul className="space-y-2.5">
            {items.map((i) => {
              const l = byId.get(i.productId);
              const gone = missing.has(i.productId);
              const where = l ? locationText(l.product.location) : null;

              return (
                <li
                  key={i.productId}
                  className="flex gap-3 rounded-2xl border border-[#E2E8F0] bg-white p-3 shadow-sm transition-all hover:border-slate-300"
                  data-testid="cart-line"
                >
                  {/* Thumbnail */}
                  <div className="h-18 w-18 shrink-0 overflow-hidden rounded-xl bg-slate-50 p-1 flex items-center justify-center">
                    {l ? (
                      <ProductImage product={l.product} className="h-16 w-16" />
                    ) : (
                      <Package className="h-8 w-8 text-slate-300" />
                    )}
                  </div>

                  {/* Details */}
                  <div className="min-w-0 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          to={`/customer/products/${encodeURIComponent(i.productId)}`}
                          className="line-clamp-2 text-xs sm:text-sm font-semibold text-[#0F172A] hover:text-[#2563EB]"
                        >
                          {l?.product.name ?? i.name}
                        </Link>
                        <button
                          type="button"
                          onClick={() => cart.remove(storeId, i.productId)}
                          className="shrink-0 rounded-lg p-1 text-[#94A3B8] hover:text-[#EF4444] transition-colors"
                          aria-label={`Remove ${i.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      {/* Location Chip */}
                      <div className="mt-0.5">
                        <p
                          className={`flex items-center gap-1 text-[11px] ${
                            where ? 'text-[#64748B]' : 'text-amber-700 font-medium'
                          }`}
                        >
                          <MapPin className="h-3 w-3 shrink-0 text-[#2563EB]" />
                          <span className="truncate">{where ?? 'Location unmapped'}</span>
                        </p>
                      </div>
                    </div>

                    {/* Stepper & Price */}
                    <div className="mt-2 flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                      <QuantityStepper
                        value={i.quantity}
                        label={i.name}
                        min={1}
                        onChange={(n) => cart.setQuantity(storeId, i.productId, n)}
                      />

                      <div className="text-right">
                        {l && l.lineEffectiveMinor !== null ? (
                          <>
                            <span className="block text-sm font-bold text-[#0F172A]">
                              {formatMinor(l.lineEffectiveMinor)}
                            </span>
                            {l.lineListMinor !== null && l.lineListMinor > l.lineEffectiveMinor && (
                              <span className="block text-[11px] text-[#94A3B8] line-through">
                                {formatMinor(l.lineListMinor)}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-[#64748B]">{quote.loading ? '...' : ''}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {unmapped.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {unmapped.map((u) => u.name).join(', ')} {unmapped.length === 1 ? 'is' : 'are'} not mapped to a shelf, so navigation will guide you to all other items.
              </span>
            </p>
          )}
        </div>

        {/* Right: Cart Summary & Route CTA (5 cols on Desktop, sticky) */}
        <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-20">
          <section
            className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm space-y-3.5"
            aria-label="Order summary"
          >
            <h2 className="text-sm font-bold uppercase tracking-wider text-[#0F172A]">Cart Summary</h2>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-[#64748B]">
                <span>Total Items</span>
                <span className="font-semibold text-[#0F172A]">{items.reduce((s, i) => s + i.quantity, 0)} items</span>
              </div>

              {q && (
                <>
                  <div className="flex justify-between text-[#64748B]">
                    <span>Subtotal</span>
                    <span className="font-semibold text-[#0F172A]">{formatMinor(q.subtotalListMinor)}</span>
                  </div>

                  {q.savingsMinor > 0 && (
                    <div className="flex justify-between text-[#16A34A] font-semibold">
                      <span>Promotional Savings</span>
                      <span>-{formatMinor(q.savingsMinor)}</span>
                    </div>
                  )}

                  <div className="flex justify-between border-t border-[#E2E8F0] pt-2.5 text-base font-extrabold text-[#0F172A]">
                    <span>Estimated Total</span>
                    <span data-testid="cart-total" className="text-[#2563EB]">
                      {formatMinor(q.subtotalEffectiveMinor)}
                    </span>
                  </div>

                  {q.note && <p className="text-[11px] text-[#64748B] pt-1">{q.note}</p>}
                </>
              )}
            </div>

            {/* Prominent Blue Action Button: Show Route to All Items */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => navigate('/customer/map?cart=1')}
                disabled={!routable}
                className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold shadow-md transition-all ${
                  routable
                    ? 'bg-[#2563EB] text-white hover:bg-blue-700 active:scale-95'
                    : 'cursor-not-allowed bg-slate-200 text-slate-500'
                }`}
              >
                <Navigation className="h-4 w-4" />
                <span>Show Route to All Items{routable ? ` (${routable} stops)` : ''}</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default CustomerCart;
