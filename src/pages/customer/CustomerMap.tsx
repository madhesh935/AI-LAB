import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Footprints,
  HandHelping,
  Info,
  MapPin,
  MapPinOff,
  Navigation,
  RotateCcw,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import { useCustomer, useFetched } from '../../components/customer/customerContext';
import { MapLegend, StoreMapView } from '../../components/customer/StoreMapView';
import { EmptyState, GetHelpButton, StaleNotice } from '../../components/customer/CustomerUi';
import { CartControl } from '../../components/customer/ProductCard';
import { BackendState } from '../../components/common/BackendState';
import { Skeleton } from '../../components/common/Skeleton';
import { customerApi } from '../../services/customer/api';
import { routePrefs, useCart, useRoutePrefs } from '../../services/customer/cart';
import { offlineRoute, rememberShelves, shelfHints } from '../../services/customer/offlineRoute';
import { ApiError, isAbort } from '../../services/api/client';
import { formatMinor, plural, relativeTime } from '../../services/customer/format';
import type { CartRoute, MapShelf, RouteStop } from '../../services/customer/types';

function stopTitle(s: RouteStop): string {
  const names = s.products.map((p) => p.name).join(', ');
  const where = [s.aisleLabel, `Shelf ${s.shelfLabel}`].filter(Boolean).join(' · ');
  return names ? `${names} (${where})` : where;
}

interface RouteState {
  data: CartRoute | null;
  stale: boolean;
  savedAt: number | null;
  error: unknown;
  loading: boolean;
}

export const CustomerMap: React.FC = () => {
  const { storeId, showToast } = useCustomer();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const productParam = params.get('product');
  const shelfParam = params.get('shelf');
  const single = !!(productParam || shelfParam);

  const mapRes = useFetched((signal) => customerApi.map(storeId, signal), [storeId]);
  const map = mapRes.data;
  const prefs = useRoutePrefs(storeId);
  const items = useCart(storeId);
  const ids = items.map((i) => i.productId);
  const idKey = ids.join(',');
  const startNode = prefs.from ?? prefs.start;
  const product = useFetched(productParam ? (signal) => customerApi.product(storeId, productParam, signal) : null, [
    storeId,
    productParam,
  ]);

  const [route, setRoute] = useState<RouteState>({
    data: null,
    stale: false,
    savedAt: null,
    error: null,
    loading: false,
  });
  const [nonce, setNonce] = useState(0);
  const [showDirections, setShowDirections] = useState(false);
  const [shelf, setShelf] = useState<MapShelf | null>(null);
  const [navigating, setNavigating] = useState(false);

  useEffect(() => {
    if (!map) return undefined;
    if (!single && ids.length === 0) {
      setRoute({ data: null, stale: false, savedAt: null, error: null, loading: false });
      return undefined;
    }
    const ctrl = new AbortController();
    setRoute((r) => ({ ...r, loading: true, error: null }));
    const req = single
      ? customerApi.route(
          storeId,
          shelfParam ? { shelfId: shelfParam } : { productId: productParam ?? undefined },
          prefs.start,
          ctrl.signal
        )
      : customerApi.cartRoute(storeId, ids, { start: startNode, endAt: prefs.endAt, visited: prefs.visited }, ctrl.signal);

    req
      .then((r) => {
        if (!r.stale) rememberShelves(storeId, r.data);
        setRoute({ data: r.data, stale: r.stale, savedAt: r.savedAt, error: null, loading: false });
      })
      .catch((e) => {
        if (ctrl.signal.aborted || isAbort(e)) return;
        if (!single && e instanceof ApiError && e.kind === 'offline') {
          const hints = shelfHints(storeId);
          const est = offlineRoute(
            map,
            items.map((i) => ({ productId: i.productId, name: i.name, shelfId: hints[i.productId] ?? '' })),
            startNode,
            prefs.endAt,
            prefs.visited
          );
          setRoute({ data: est, stale: true, savedAt: mapRes.savedAt, error: null, loading: false });
          return;
        }
        setRoute({ data: null, stale: false, savedAt: null, error: e, loading: false });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, single, productParam, shelfParam, idKey, startNode, prefs.start, prefs.endAt, prefs.visited.join(','), nonce]);

  const shelfItems = useFetched(shelf ? (signal) => customerApi.shelfProducts(storeId, shelf.shelfId, signal) : null, [
    storeId,
    shelf?.shelfId,
  ]);

  const r = route.data;
  const next = r?.stops[0] ?? null;
  const nextLeg = r?.legs[0] ?? null;
  const startValue = prefs.start ?? map?.defaultStartNodeId ?? '';
  const visitedNames = useMemo(() => new Map((r?.visitedStops ?? []).map((v) => [v.shelfId, v])), [r]);

  // Calculate current stop index (e.g. Stop 1 of 4)
  const totalStopsCount = (r?.stops.length ?? 0) + (r?.visitedStops.length ?? 0);
  const currentStopIndex = (r?.visitedStops.length ?? 0) + 1;

  if (mapRes.loading && !map) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-44 rounded-lg" />
        <Skeleton className="h-[55vh] w-full rounded-2xl" />
      </div>
    );
  }

  if (mapRes.error && !map) {
    const noMap = mapRes.error instanceof ApiError && (mapRes.error.status === 404 || mapRes.error.status === 409);
    return (
      <div className="space-y-4">
        <h1 className="text-xl sm:text-2xl font-bold text-[#0F172A]">Store Map</h1>
        {noMap ? (
          <EmptyState icon={MapPinOff} title="No indoor floor plan available">
            {mapRes.error instanceof Error ? mapRes.error.message : ''} Feel free to ask any store team member for aisle directions.
            <div className="mt-4">
              <GetHelpButton category="navigation_help" />
            </div>
          </EmptyState>
        ) : (
          <BackendState error={mapRes.error} onRetry={mapRes.reload} what="The store map" compact />
        )}
      </div>
    );
  }

  if (!map) return null;

  return (
    <div className="space-y-5">
      {/* 1. Header & Location Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0F172A]">Store Map</h1>
          <p className="text-xs text-[#64748B]">
            Interactive 2D supermarket indoor navigation · {map.layout.name}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <GetHelpButton category="navigation_help" zone={next?.section ?? null} />
        </div>
      </div>

      {/* Start From & Destination Selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-2xl border border-[#E2E8F0] bg-white p-3.5 shadow-sm">
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
            Start From
          </label>
          <select
            value={startValue}
            onChange={(e) => routePrefs.setStart(storeId, e.target.value === map.defaultStartNodeId ? null : e.target.value)}
            className="mt-1 h-9 w-full rounded-xl border border-[#E2E8F0] bg-slate-50 px-3 text-xs font-semibold text-[#0F172A] focus:outline-none"
            data-testid="route-start"
          >
            {map.startPoints.map((s) => (
              <option key={s.nodeId} value={s.nodeId}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {!single && (
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
              Finish Destination
            </label>
            <select
              value={prefs.endAt}
              onChange={(e) => routePrefs.setEndAt(storeId, e.target.value as 'checkout' | 'exit' | 'none')}
              className="mt-1 h-9 w-full rounded-xl border border-[#E2E8F0] bg-slate-50 px-3 text-xs font-semibold text-[#0F172A] focus:outline-none"
            >
              <option value="checkout">Checkout Counters</option>
              <option value="exit">Store Exit</option>
              <option value="none">Last Item Shelf</option>
            </select>
          </div>
        )}
      </div>

      {/* Single product banner if targeting a specific item */}
      {single && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 p-3.5 shadow-sm">
          <div className="flex items-center gap-2 min-w-0">
            <MapPin className="h-5 w-5 shrink-0 text-[#2563EB]" />
            <p className="min-w-0 text-xs text-[#0F172A] truncate">
              Guiding to: <strong>{product.data?.name ?? next?.shelfLabel ?? 'Selected item'}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/customer/map')}
            className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-[#2563EB] hover:underline"
          >
            <X className="h-4 w-4" />
            <span>Show Cart Route</span>
          </button>
        </div>
      )}

      {/* Main Side-by-Side Desktop Layout (7 cols map, 5 cols navigation guidance) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Interactive Map & Legend (7 cols on Desktop) */}
        <div className="lg:col-span-7 space-y-3">
          <StoreMapView
            map={map}
            route={r}
            nextShelfId={next?.shelfId ?? null}
            selectedShelfId={shelf?.shelfId ?? null}
            startNodeId={single ? prefs.start : startNode}
            onShelfTap={setShelf}
            selectedProduct={product.data ?? null}
          />
          <MapLegend />

          {/* Shelf Details Popup/Drawer if a shelf was tapped */}
          {shelf && (
            <section
              className="rounded-2xl border border-blue-200 bg-white p-4 shadow-md space-y-3"
              aria-label={`Products on shelf ${shelf.shelfLabel}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-[#0F172A]">
                    Shelf {shelf.shelfLabel}
                    {shelf.aisleLabel ? ` · ${shelf.aisleLabel}` : ''}
                  </h3>
                  {shelf.section && <p className="text-xs text-[#64748B]">{shelf.section} section</p>}
                </div>
                <button
                  type="button"
                  onClick={() => setShelf(null)}
                  className="rounded-lg p-1 text-[#64748B] hover:bg-slate-100"
                  aria-label="Close shelf info"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {shelfItems.loading && <Skeleton className="h-16 w-full rounded-xl" />}
              {shelfItems.data && shelfItems.data.items.length === 0 && (
                <p className="text-xs text-[#64748B]">No items currently mapped to this shelf.</p>
              )}

              <ul className="divide-y divide-[#E2E8F0]">
                {shelfItems.data?.items.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                    <Link to={`/customer/products/${encodeURIComponent(p.id)}`} className="min-w-0">
                      <span className="block truncate text-xs font-bold text-[#0F172A] hover:text-[#2563EB]">
                        {p.name}
                      </span>
                      <span className="block text-[11px] text-[#64748B]">
                        {formatMinor(p.price.effectivePriceMinor)} · {p.availability.label}
                      </span>
                    </Link>
                    <CartControl storeId={storeId} product={p} onAdded={(n) => showToast(`${n} added to cart`)} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Right Column: Step-by-Step Guidance & Stop Details (5 cols on Desktop) */}
        <div className="lg:col-span-5 space-y-4">
          {!single && items.length === 0 && (
            <EmptyState icon={Navigation} title="No route active">
              Add products to your cart and RetailEdge will compute the fastest walk through the store aisles.
              <div className="mt-4">
                <Link
                  to="/customer/products"
                  className="inline-flex rounded-xl bg-[#2563EB] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 transition-colors"
                >
                  Browse Products
                </Link>
              </div>
            </EmptyState>
          )}

          {route.loading && (
            <div className="flex items-center gap-2 rounded-2xl border border-[#E2E8F0] bg-white p-4 text-xs font-semibold text-[#64748B]">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
              <span>Optimizing shortest walking route...</span>
            </div>
          )}

          {/* Route Stats & Guidance Card */}
          {r && (
            <div className="space-y-4">
              {/* Trip Overview Badge */}
              <div className="flex items-center justify-between rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-[#2563EB]">
                    <Footprints className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="block text-sm font-extrabold text-[#0F172A]">
                      {r.totalDistanceM} m · ~{Math.max(1, Math.round(r.estimatedWalkMinutes))} min walk
                    </span>
                    <span className="block text-xs text-[#64748B]">
                      {r.stops.length > 0
                        ? `Stop ${currentStopIndex} of ${totalStopsCount}`
                        : 'All items picked up!'}
                    </span>
                  </div>
                </div>

                {r.stops.length > 0 && (
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-[#2563EB] border border-blue-100">
                    {r.stops.length} {r.stops.length === 1 ? 'stop' : 'stops'} left
                  </span>
                )}
              </div>

              {/* Next Stop Card (High Priority) */}
              {next && nextLeg && (
                <section
                  className="rounded-2xl border-2 border-[#2563EB] bg-white p-4 shadow-md space-y-3"
                  data-testid="next-stop"
                >
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#2563EB] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
                      <span>Stop {next.order}</span>
                    </span>
                    <span className="text-xs font-medium text-[#64748B]">
                      +{next.distanceFromPreviousM} m from {nextLeg.fromLabel}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-[#0F172A]">
                      {stopTitle(next)}
                    </h3>
                    <p className="text-xs text-[#64748B] mt-0.5">
                      {next.section ? `${next.section} section · ` : ''}Aisle {next.aisleLabel ?? ''}
                    </p>
                  </div>

                  {/* Turn-by-Turn Directions Toggle */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowDirections((v) => !v)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:underline"
                    >
                      <span>Walking Directions</span>
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${showDirections ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {showDirections && (
                      <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-[#334155] border-l-2 border-blue-100 ml-1">
                        {nextLeg.directions.map((d, i) => (
                          <li key={i}>{d}</li>
                        ))}
                      </ol>
                    )}
                  </div>

                  {/* Action Buttons: Mark Visited (Next Stop) & Start Navigation */}
                  <div className="pt-1 flex flex-col sm:flex-row gap-2">
                    {!single && (
                      <button
                        type="button"
                        onClick={() => routePrefs.markVisited(storeId, next.shelfId, next.accessNodeId)}
                        className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#16A34A] text-xs font-bold text-white shadow-sm hover:bg-green-700 active:scale-95 transition-all"
                      >
                        <Check className="h-4 w-4" />
                        <span>Mark Visited / Next Stop</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setNavigating((v) => !v);
                        setShowDirections(true);
                        showToast(`Guiding you to Shelf ${next.shelfLabel}`, 'info');
                      }}
                      className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-slate-50 px-4 text-xs font-bold text-[#0F172A] hover:bg-slate-100 transition-colors"
                    >
                      <Navigation className="h-4 w-4 text-[#2563EB]" />
                      <span>{navigating ? 'Re-center' : 'Start Navigation'}</span>
                    </button>
                  </div>
                </section>
              )}

              {/* Upcoming Remaining Stops */}
              {r.stops.length > 1 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#64748B]">Upcoming Stops</h4>
                  <ul className="space-y-1.5">
                    {r.stops.slice(1).map((s) => (
                      <li
                        key={s.shelfId}
                        className="flex items-center justify-between gap-2 rounded-xl border border-[#E2E8F0] bg-white p-3 text-xs shadow-sm"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[11px] font-bold text-[#2563EB]">
                            {s.order}
                          </span>
                          <span className="truncate font-semibold text-[#0F172A]">
                            {stopTitle(s)}
                          </span>
                        </div>
                        <span className="shrink-0 text-[11px] text-[#64748B]">+{s.distanceFromPreviousM} m</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Visited Stops Section */}
              {r.visitedStops.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#64748B]">
                      Picked Up ({r.visitedStops.length})
                    </h4>
                    <button
                      type="button"
                      onClick={() => routePrefs.resetVisited(storeId)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB] hover:underline"
                    >
                      <RotateCcw className="h-3 w-3" />
                      <span>Reset</span>
                    </button>
                  </div>

                  <ul className="space-y-1">
                    {[...visitedNames.values()].map((v) => (
                      <li
                        key={v.shelfId}
                        className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs text-[#64748B]"
                      >
                        <span className="line-through truncate">Shelf {v.shelfLabel}</span>
                        <button
                          type="button"
                          onClick={() => routePrefs.unmarkVisited(storeId, v.shelfId)}
                          className="inline-flex items-center gap-1 font-semibold text-[#2563EB] hover:underline"
                        >
                          <Undo2 className="h-3 w-3" />
                          <span>Undo</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Finish Destination Notice */}
              {r.legs.some((l) => l.isFinal) && (
                <div className="rounded-xl border border-purple-200 bg-purple-50/70 p-3 text-xs text-purple-900">
                  <span>Then proceed to <strong>{r.end?.label}</strong> ({r.legs.find((l) => l.isFinal)?.distanceM} m) to finish your trip.</span>
                </div>
              )}

              {/* Staff assistance card if stuck */}
              <div className="rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm space-y-2">
                <div className="flex items-center gap-2">
                  <HandHelping className="h-4 w-4 text-[#2563EB]" />
                  <span className="text-xs font-bold text-[#0F172A]">Can't find a product?</span>
                </div>
                <p className="text-xs text-[#64748B]">
                  Our store staff can help you locate any item or check backroom stock directly.
                </p>
                <Link
                  to="/customer/help"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB] hover:underline"
                >
                  <span>Request Staff Help</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CustomerMap;
