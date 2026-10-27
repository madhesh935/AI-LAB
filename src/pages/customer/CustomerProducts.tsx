import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Filter, Loader2, SearchX, SlidersHorizontal, Tag, X } from 'lucide-react';
import { useCustomer, useFetched } from '../../components/customer/customerContext';
import { SearchBox } from '../../components/customer/SearchBox';
import { ProductCard } from '../../components/customer/ProductCard';
import { EmptyState, StaleNotice } from '../../components/customer/CustomerUi';
import { BackendState } from '../../components/common/BackendState';
import { Skeleton } from '../../components/common/Skeleton';
import { customerApi } from '../../services/customer/api';
import type { ProductCard as Card, ProductPage } from '../../services/customer/types';
import { isAbort } from '../../services/api/client';

const PAGE_SIZE = 24;

const AVAILABILITY = [
  { id: 'all', label: 'All Availability' },
  { id: 'on_shelf', label: 'Seen on shelf' },
  { id: 'in_stock', label: 'Available on Shelf' },
  { id: 'low_stock', label: 'Limited Stock' },
  { id: 'out_of_stock', label: 'Not Seen on Shelf' },
];

const SORTS = [
  { id: 'relevance', label: 'Featured / Relevance' },
  { id: 'price_asc', label: 'Price: Low to High' },
  { id: 'price_desc', label: 'Price: High to Low' },
  { id: 'name_asc', label: 'Name: A–Z' },
  { id: 'name_desc', label: 'Name: Z–A' },
];

export const CustomerProducts: React.FC = () => {
  const { storeId, showToast, availabilityTick } = useCustomer();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const brand = params.get('brand') ?? '';
  const availability = params.get('availability') ?? 'all';
  const offersOnly = params.get('offers') === '1';
  const sort = params.get('sort') ?? 'relevance';
  const [showFilters, setShowFilters] = useState(false);

  const [items, setItems] = useState<Card[]>([]);
  const [meta, setMeta] = useState<ProductPage | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [stale, setStale] = useState<{ savedAt: number } | null>(null);
  const [retry, setRetry] = useState(0);
  const filterKey = `${storeId}|${q}|${category}|${brand}|${availability}|${offersOnly}|${sort}|${availabilityTick}`;
  const lastKey = useRef('');

  const cats = useFetched((signal) => customerApi.categories(storeId, signal), [storeId]);

  useEffect(() => {
    const fresh = lastKey.current !== filterKey;
    const wanted = fresh ? 1 : page;
    if (fresh && page !== 1) {
      setPage(1);
      return undefined;
    }
    lastKey.current = filterKey;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    customerApi
      .products(
        storeId,
        {
          q: q || undefined,
          category: category || undefined,
          brand: brand || undefined,
          availability,
          offersOnly,
          sort,
          page: wanted,
          pageSize: PAGE_SIZE,
        },
        ctrl.signal
      )
      .then((r) => {
        setMeta(r.data);
        setItems((prev) =>
          wanted === 1 ? r.data.items : [...prev, ...r.data.items.filter((p) => !prev.some((x) => x.id === p.id))]
        );
        setStale(r.stale ? { savedAt: r.savedAt } : null);
        setLoading(false);
      })
      .catch((e) => {
        if (ctrl.signal.aborted || isAbort(e)) return;
        setError(e);
        setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, page, retry]);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };

  const categoryOptions = useMemo(() => {
    const d = cats.data;
    if (!d) return [] as string[];
    return Array.from(new Set([...d.departments.map((x) => x.name), ...d.categories.map((x) => x.name)])).sort();
  }, [cats.data]);

  const activeFilters = [
    category && `Category: ${category}`,
    brand && `Brand: ${brand}`,
    availability !== 'all' && AVAILABILITY.find((a) => a.id === availability)?.label,
    offersOnly && 'Offers Only',
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-5">
      {/* 1. Header */}
      <header className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0F172A]">Explore Products</h1>
        <p className="text-xs sm:text-sm text-[#64748B]">Find everything you need in-store.</p>
      </header>

      {/* 2. Smart Search Box */}
      <SearchBox storeId={storeId} initial={q} onSubmit={(term) => update({ q: term || null })} />

      {/* 3. Category Filter Chips (Horizontal Scroll) */}
      <div className="no-scrollbar -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <button
          type="button"
          onClick={() => update({ category: null })}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            !category
              ? 'bg-[#2563EB] text-white shadow-sm'
              : 'border border-[#E2E8F0] bg-white text-[#64748B] hover:border-slate-300 hover:text-[#0F172A]'
          }`}
        >
          All Items
        </button>
        {categoryOptions.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => update({ category: category === c ? null : c })}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              category === c
                ? 'bg-[#2563EB] text-white shadow-sm'
                : 'border border-[#E2E8F0] bg-white text-[#64748B] hover:border-slate-300 hover:text-[#0F172A]'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* 4. Controls: Filter Button, Offers Toggle, and Sort Dropdown */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors ${
              showFilters || activeFilters.length
                ? 'border-blue-300 bg-blue-50 text-[#2563EB]'
                : 'border-[#E2E8F0] bg-white text-[#0F172A] hover:bg-slate-50'
            }`}
            aria-expanded={showFilters}
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span>Filters</span>
            {activeFilters.length > 0 && (
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#2563EB] px-1 text-[10px] font-bold text-white">
                {activeFilters.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => update({ offers: offersOnly ? null : '1' })}
            className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors ${
              offersOnly
                ? 'border-green-300 bg-green-50 text-green-700'
                : 'border-[#E2E8F0] bg-white text-[#64748B] hover:border-slate-300'
            }`}
          >
            <Tag className="h-3.5 w-3.5 text-green-600" />
            <span>Offers Only</span>
          </button>
        </div>

        {/* Sort Dropdown */}
        <div className="flex items-center gap-1.5">
          <span className="hidden sm:inline text-xs text-[#64748B]">Sort:</span>
          <select
            value={sort}
            onChange={(e) => update({ sort: e.target.value === 'relevance' ? null : e.target.value })}
            className="h-9 rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-semibold text-[#0F172A] shadow-sm hover:border-slate-300 focus:outline-none"
            aria-label="Sort products"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 5. Expanded Filters Drawer / Panel */}
      {showFilters && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => update({ category: e.target.value || null })}
              className="mt-1 h-9 w-full rounded-xl border border-[#E2E8F0] bg-white px-2.5 text-xs text-[#0F172A]"
            >
              <option value="">All Categories</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
              Brand
            </label>
            <select
              value={brand}
              onChange={(e) => update({ brand: e.target.value || null })}
              className="mt-1 h-9 w-full rounded-xl border border-[#E2E8F0] bg-white px-2.5 text-xs text-[#0F172A]"
            >
              <option value="">All Brands</option>
              {(cats.data?.brands ?? []).map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name} ({b.productCount})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
              Availability
            </label>
            <select
              value={availability}
              onChange={(e) => update({ availability: e.target.value === 'all' ? null : e.target.value })}
              className="mt-1 h-9 w-full rounded-xl border border-[#E2E8F0] bg-white px-2.5 text-xs text-[#0F172A]"
            >
              {AVAILABILITY.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Active Filter Chips */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeFilters.map((f) => (
            <span
              key={f}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-[#2563EB]"
            >
              {f}
            </span>
          ))}
          <button
            type="button"
            onClick={() => update({ category: null, brand: null, availability: null, offers: null })}
            className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-[#64748B] hover:text-[#0F172A]"
          >
            <X className="h-3 w-3" />
            <span>Clear all</span>
          </button>
        </div>
      )}

      {stale && <StaleNotice savedAt={stale.savedAt} what="This product list" />}

      {/* Result Count / Correction Notice */}
      {meta && !error && (
        <div className="flex items-center justify-between text-xs text-[#64748B]" aria-live="polite">
          <p>
            {meta.correctedQuery ? (
              <>
                No match for "{meta.query}". Showing results for{' '}
                <strong className="text-[#0F172A]">{meta.correctedQuery}</strong>.{' '}
              </>
            ) : null}
            Showing <strong className="text-[#0F172A]">{items.length}</strong> of{' '}
            <strong className="text-[#0F172A]">{meta.total}</strong> products
            {q && !meta.correctedQuery ? ` for "${q}"` : ''}
          </p>
        </div>
      )}

      {/* Error state */}
      {!!error && items.length === 0 && (
        <BackendState error={error} onRetry={() => setRetry((r) => r + 1)} what="The product list" compact />
      )}

      {/* Loading Skeletons */}
      {loading && items.length === 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
          {[...Array(10)].map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && meta && items.length === 0 && (
        <EmptyState
          icon={SearchX}
          title={q ? `No products found for "${q}"` : 'No products match these filters'}
        >
          Try checking the spelling, selecting another category, or ask our in-store team.
        </EmptyState>
      )}

      {/* 6. Product Grid (Mobile: 2 cols, Tablet: 3 cols, Desktop: 4-5 cols) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
        {items.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            storeId={storeId}
            onAdded={(n) => showToast(`${n} added to cart`)}
          />
        ))}
      </div>

      {/* Load More Button */}
      {meta?.hasMore && (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={loading}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[#E2E8F0] bg-white text-sm font-semibold text-[#2563EB] shadow-sm hover:bg-blue-50 transition-colors disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>Load more products ({items.length} of {meta.total})</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default CustomerProducts;
