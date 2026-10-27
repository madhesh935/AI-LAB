import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Minus, Plus } from 'lucide-react';
import type { CartRoute, MapShelf, MapNode, ProductDetail, StoreMapData } from '../../services/customer/types';

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Point {
  x: number;
  y: number;
}

interface Stop {
  id: string;
  order: number;
  name: string;
  locationLabel: string;
  x: number;
  y: number;
  isNext: boolean;
  shelfId: string;
}

interface Props {
  map: StoreMapData;
  /** The route computed for the CURRENT cart / product / shelf (server route, or the offline estimate). Nothing is drawn without one. */
  route?: CartRoute | null;
  /** Shelf of the stop the shopper should walk to next (highlighted). */
  nextShelfId?: string | null;
  selectedShelfId?: string | null;
  startNodeId?: string | null;
  onShelfTap?: (shelf: MapShelf) => void;
  selectedProduct?: ProductDetail | null;
}

const PAD = 30;
const MIN_ZOOM_FRACTION = 0.25;

const NODE_STYLE: Record<string, { color: string; label: string }> = {
  entrance: { color: '#16A34A', label: 'Entrance' },
  exit: { color: '#DC2626', label: 'Exit' },
  checkout: { color: '#7C3AED', label: 'Checkout' },
  help_desk: { color: '#2563EB', label: 'Help desk' },
};

/** Join the legs of a route into one polyline (consecutive legs share their end/start point). */
function routePoints(route: CartRoute | null | undefined): Point[] {
  const out: Point[] = [];
  for (const leg of route?.legs ?? []) {
    for (const p of leg.points) {
      const last = out[out.length - 1];
      if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 0.5) out.push({ x: p.x, y: p.y });
    }
  }
  return out;
}

export const StoreMapView: React.FC<Props> = ({ map, route, nextShelfId, selectedShelfId, startNodeId, onShelfTap, selectedProduct }) => {
  const W = map.layout.width;
  const H = map.layout.height;
  const full = useMemo<ViewBox>(() => ({ x: -PAD, y: -PAD, w: W + PAD * 2, h: H + PAD * 2 }), [W, H]);
  const [vb, setVb] = useState<ViewBox>(full);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: number; pinch: number | null }>({ moved: 0, pinch: null });
  const [legendOpen, setLegendOpen] = useState(true);
  const k = 1.9; // pins and labels are sized so they stay readable when the whole plan is shrunk to a phone screen

  useEffect(() => setVb(full), [full]);

  const nodes = useMemo(() => new Map<string, MapNode>(map.nodes.map((n) => [n.id, n])), [map.nodes]);
  const shelvesById = useMemo(() => new Map(map.shelves.map((s) => [s.shelfId, s])), [map.shelves]);

  // Where the walk starts: the server route's start; else the chosen / default start node. Both come from the stored map, nothing is hard-coded.
  const startPoint = useMemo<(Point & { label: string }) | null>(() => {
    if (route?.start) return { x: route.start.x, y: route.start.y, label: route.start.label };
    const n = nodes.get(startNodeId ?? '') ?? nodes.get(map.defaultStartNodeId ?? '');
    return n ? { x: n.x, y: n.y, label: n.label ?? 'Start' } : null;
  }, [route, nodes, startNodeId, map.defaultStartNodeId]);

  // One stop per shelf the shopper has to visit for THEIR items (cart, selected product or tapped shelf), in the order the route walks them.
  const stops = useMemo<Stop[]>(() => {
    return (route?.stops ?? []).map((s, idx) => ({
      id: `stop-${s.shelfId}`,
      order: s.order || idx + 1,
      name: s.products.length ? s.products.map((p) => p.name).join(', ') : `Shelf ${s.shelfLabel}`,
      locationLabel: [s.aisleLabel, s.shelfLabel].filter(Boolean).join(' · ') || `Shelf ${s.shelfLabel}`,
      x: s.x,
      y: s.y,
      isNext: s.shelfId === nextShelfId || (!nextShelfId && idx === 0),
      shelfId: s.shelfId,
    }));
  }, [route, nextShelfId]);

  const points = useMemo(() => routePoints(route), [route]);
  const polyline = useMemo(() => points.map((p) => `${p.x},${p.y}`).join(' '), [points]);
  const arrows = useMemo(() => {
    const list: Array<{ x: number; y: number; a: number }> = [];
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1];
      const q = points[i];
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len < 28 * k) continue;
      list.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, a: (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI });
    }
    return list;
  }, [points, k]);
  const routeShelfIds = useMemo(() => new Set(stops.map((s) => s.shelfId)), [stops]);
  const end = route?.end ?? null;

  const clamp = useCallback(
    (v: ViewBox): ViewBox => {
      const w = Math.min(full.w * 1.3, Math.max(full.w * MIN_ZOOM_FRACTION, v.w));
      const h = (w / v.w) * v.h;
      return {
        w,
        h,
        x: Math.min(full.x + full.w - w * 0.1, Math.max(full.x - w * 0.9, v.x)),
        y: Math.min(full.y + full.h - h * 0.1, Math.max(full.y - h * 0.9, v.y)),
      };
    },
    [full]
  );

  const zoom = useCallback(
    (factor: number, cx?: number, cy?: number) =>
      setVb((v) => {
        const px = cx ?? v.x + v.w / 2;
        const py = cy ?? v.y + v.h / 2;
        return clamp({ x: px - (px - v.x) * factor, y: py - (py - v.y) * factor, w: v.w * factor, h: v.h * factor });
      }),
    [clamp]
  );

  const toSvg = useCallback(
    (clientX: number, clientY: number) => {
      const el = svgRef.current;
      if (!el) return { x: 0, y: 0, k: 1 };
      const r = el.getBoundingClientRect();
      const s = Math.max(vb.w / r.width, vb.h / r.height);
      const offX = (r.width * s - vb.w) / 2;
      const offY = (r.height * s - vb.h) / 2;
      return { x: vb.x + (clientX - r.left) * s - offX, y: vb.y + (clientY - r.top) * s - offY, k: s };
    },
    [vb]
  );

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [toSvg, zoom]);

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) gesture.current = { moved: 0, pinch: null };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);
    if (pointers.current.size === 2 && gesture.current.pinch) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = toSvg((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (d > 0) zoom(gesture.current.pinch / d, mid.x, mid.y);
      gesture.current.pinch = d;
      gesture.current.moved += 10;
      return;
    }
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    gesture.current.moved += Math.abs(dx) + Math.abs(dy);
    const { k: s } = toSvg(next.x, next.y);
    setVb((v) => clamp({ ...v, x: v.x - dx * s, y: v.y - dy * s }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current.pinch = null;
  };

  const centerOnTarget = useCallback(() => {
    const target = stops.find((s) => s.isNext) ?? stops[0];
    if (!target) {
      setVb(full);
      return;
    }
    const w = full.w * 0.55;
    const h = (w / vb.w) * vb.h;
    setVb(clamp({ x: target.x - w / 2, y: target.y - h / 2, w, h }));
  }, [stops, full, vb.w, vb.h, clamp]);

  const target = selectedProduct?.name ?? (stops.length === 1 ? stops[0].name : null);
  const badge = stops.length === 0 ? 'No route yet' : stops.length === 1 ? `Guiding to: ${target}` : `${stops.length} stops · ${route?.totalDistanceM ?? 0} m`;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-md" data-testid="store-map">
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-[56vh] max-h-[620px] min-h-[360px] w-full touch-none select-none bg-[#F8FAFC]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
        role="img"
        aria-label="Store floor plan with your walking route"
      >
        <defs>
          <filter id="routeGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" floodColor="#2563EB" floodOpacity="0.5" />
          </filter>
          <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="130%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#0F172A" floodOpacity="0.18" />
          </filter>
        </defs>

        {/* Floor */}
        <rect x={0} y={0} width={W} height={H} rx={14} fill="#FFFDF8" stroke="#CBD5E1" strokeWidth={3} />

        {/* Sections / aisles (from the stored layout) */}
        {map.sections.map((s) => (
          <rect key={s.id} x={s.x} y={s.y} width={s.width} height={s.height} rx={8} fill={s.color || '#E2E8F0'} fillOpacity={0.28} stroke={s.color || '#CBD5E1'} strokeOpacity={0.6} strokeWidth={1.2} />
        ))}

        {/* Walkways (the graph the route is computed on) */}
        {map.edges.map((e, i) => {
          const a = nodes.get(e.source);
          const b = nodes.get(e.target);
          if (!a || !b) return null;
          return <line key={`edge-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#EADFCB" strokeWidth={11 * k} strokeLinecap="round" />;
        })}

        {/* Shelves: tap for the products on it; shelves that hold the shopper's items are highlighted */}
        {map.shelves.map((s) => {
          const onRoute = routeShelfIds.has(s.shelfId);
          const selected = s.shelfId === selectedShelfId;
          return (
            <rect
              key={s.shelfId}
              x={s.x}
              y={s.y}
              width={s.width}
              height={s.height}
              rx={3}
              fill={onRoute ? '#EF4444' : selected ? '#2563EB' : '#94A3B8'}
              fillOpacity={onRoute || selected ? 0.9 : 0.75}
              stroke="#FFFFFF"
              strokeWidth={1}
              className="cursor-pointer"
              onClick={() => {
                if (gesture.current.moved < 8 && onShelfTap) onShelfTap(s);
              }}
            >
              <title>{`${s.aisleLabel ?? ''} Shelf ${s.shelfLabel} - ${s.productCount} products`}</title>
            </rect>
          );
        })}

        {/* Section names are drawn above walkways and shelves so nothing covers them */}
        {map.sections.map((s) => (
          <g key={`label-${s.id}`} className="pointer-events-none">
            <text x={s.x + s.width / 2} y={s.y + 8.5 * k} textAnchor="middle" fontSize={7 * k} fontWeight={700} fill="#1E293B" stroke="#FFFFFF" strokeWidth={2.5} paintOrder="stroke">
              {s.aisleNumber ? `Aisle ${s.aisleNumber}` : s.name}
            </text>
            {s.aisleNumber ? (
              <text x={s.x + s.width / 2} y={s.y + 16.5 * k} textAnchor="middle" fontSize={5.6 * k} fill="#475569" stroke="#FFFFFF" strokeWidth={2} paintOrder="stroke">
                {s.name.replace(/^Aisle \d+\s*-\s*/, '')}
              </text>
            ) : null}
          </g>
        ))}

        {/* Entrance, exit, checkout and help desk markers from the layout */}
        {map.nodes
          .filter((n) => NODE_STYLE[n.type])
          .map((n) => (
            <circle key={n.id} cx={n.x} cy={n.y} r={5.5 * k} fill={NODE_STYLE[n.type].color} stroke="#FFFFFF" strokeWidth={2}>
              <title>{n.label ?? NODE_STYLE[n.type].label}</title>
            </circle>
          ))}

        {/* The route: computed for the shopper's own items, so it changes with every product / cart */}
        {points.length > 1 && (
          <>
            <polyline points={polyline} fill="none" stroke="#2563EB" strokeWidth={5 * k} strokeLinecap="round" strokeLinejoin="round" filter="url(#routeGlow)" />
            <polyline points={polyline} fill="none" stroke="#93C5FD" strokeWidth={2 * k} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={`${6 * k} ${10 * k}`}>
              <animate attributeName="stroke-dashoffset" from={16 * k} to="0" dur="0.9s" repeatCount="indefinite" />
            </polyline>
            {arrows.map((arr, i) => (
              <g key={`arrow-${i}`} transform={`translate(${arr.x}, ${arr.y}) rotate(${arr.a}) scale(${k})`}>
                <polygon points="-4,-3.5 4,0 -4,3.5" fill="#FFFFFF" />
              </g>
            ))}
          </>
        )}

        {/* Start */}
        {startPoint && (
          <g transform={`translate(${startPoint.x}, ${startPoint.y})`}>
            <circle r={13 * k} fill="#16A34A" fillOpacity={0.3}>
              <animate attributeName="r" values={`${8 * k};${17 * k};${8 * k}`} dur="1.8s" repeatCount="indefinite" />
            </circle>
            <circle r={6.5 * k} fill="#16A34A" stroke="#FFFFFF" strokeWidth={2} />
            <g transform={`translate(0, ${-26 * k}) scale(${k})`} filter="url(#cardShadow)">
              <rect x={-52} y={-14} width={104} height={28} rx={8} fill="#FFFFFF" stroke="#E2E8F0" />
              <text x={0} y={-1} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="#0F172A">Start</text>
              <text x={0} y={10} textAnchor="middle" fontSize={8} fill="#64748B">{startPoint.label.length > 22 ? `${startPoint.label.slice(0, 20)}…` : startPoint.label}</text>
            </g>
          </g>
        )}

        {/* Finish (checkout / exit) */}
        {end && (
          <g transform={`translate(${end.x}, ${end.y})`}>
            <circle r={7 * k} fill="#7C3AED" stroke="#FFFFFF" strokeWidth={2} />
            <text y={-12 * k} textAnchor="middle" fontSize={9.5 * k} fontWeight={700} fill="#5B21B6">Finish · {end.label}</text>
          </g>
        )}

        {/* One pin per stop, labelled with the product(s) to pick up there */}
        {stops.map((stop) => (
          <g
            key={stop.id}
            transform={`translate(${stop.x}, ${stop.y})`}
            className="cursor-pointer"
            onClick={() => {
              const s = shelvesById.get(stop.shelfId);
              if (s && onShelfTap) onShelfTap(s);
            }}
          >
            {stop.isNext && (
              <circle r={12 * k} fill="#2563EB" fillOpacity={0.25}>
                <animate attributeName="r" values={`${7 * k};${16 * k};${7 * k}`} dur="1.8s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;0.1;0.7" dur="1.8s" repeatCount="indefinite" />
              </circle>
            )}
            <g transform={`translate(0, ${-4 * k}) scale(${k * 0.8})`}>
              <path d="M 0,0 C -7,-7 -12,-12 -12,-18 C -12,-25 -6,-30 0,-30 C 6,-30 12,-25 12,-18 C 12,-12 7,-7 0,0 Z" fill="#EF4444" stroke="#FFFFFF" strokeWidth={1.5} />
              <circle cx={0} cy={-18} r={7} fill="#FFFFFF" />
              <text x={0} y={-15} textAnchor="middle" fontSize={9} fontWeight={800} fill="#EF4444">{stop.order}</text>
            </g>
            <g transform={`translate(0, ${-48 * k}) scale(${k * 0.85})`} filter="url(#cardShadow)">
              <rect x={-62} y={-16} width={124} height={32} rx={9} fill="#FFFFFF" stroke={stop.isNext ? '#2563EB' : '#E2E8F0'} strokeWidth={stop.isNext ? 1.5 : 1} />
              <text x={0} y={-2} textAnchor="middle" fontSize={11} fontWeight={700} fill="#0F172A">{stop.name.length > 18 ? `${stop.name.slice(0, 16)}…` : stop.name}</text>
              <text x={0} y={10} textAnchor="middle" fontSize={9} fill="#64748B">{stop.locationLabel.length > 24 ? `${stop.locationLabel.slice(0, 22)}…` : stop.locationLabel}</text>
            </g>
          </g>
        ))}
      </svg>

      {stops.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-14 mx-auto w-fit max-w-[80%] rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-center text-xs text-[#475569] shadow-sm">
          Add items to your list or open a product to see the walking route to it.
        </div>
      )}

      {/* Floating controls */}
      <div className="absolute left-3 top-3 flex flex-col gap-1.5 rounded-2xl border border-[#E2E8F0] bg-white/95 p-1.5 shadow-lg backdrop-blur-md">
        <button type="button" onClick={() => zoom(1 / 1.3)} className="flex h-9 w-9 items-center justify-center rounded-xl text-[#0F172A] hover:bg-blue-50 hover:text-[#2563EB] transition-colors" title="Zoom in" aria-label="Zoom In">
          <Plus className="h-5 w-5" />
        </button>
        <button type="button" onClick={() => zoom(1.3)} className="flex h-9 w-9 items-center justify-center rounded-xl text-[#0F172A] hover:bg-blue-50 hover:text-[#2563EB] transition-colors" title="Zoom out" aria-label="Zoom Out">
          <Minus className="h-5 w-5" />
        </button>
        <button type="button" onClick={centerOnTarget} className="flex h-9 w-9 items-center justify-center rounded-xl text-[#0F172A] hover:bg-blue-50 hover:text-[#2563EB] transition-colors" title="Center on the next stop" aria-label="Center on Target">
          <Crosshair className="h-4 w-4" />
        </button>
      </div>

      <div className="absolute right-3 top-3 flex items-center gap-2">
        <span className="rounded-full border border-blue-200 bg-white/90 px-3 py-1 text-[11px] font-bold text-[#2563EB] shadow-sm backdrop-blur-md">{badge}</span>
      </div>

      <div className="absolute bottom-3 left-3 max-w-[240px] sm:max-w-xs">
        {legendOpen ? (
          <div className="rounded-2xl border border-[#E2E8F0] bg-white/95 p-3 text-xs shadow-lg backdrop-blur-md space-y-2">
            <div className="flex items-center justify-between pb-1 border-b border-slate-100">
              <span className="font-bold text-[#0F172A] text-[11px] uppercase tracking-wider">Legend</span>
              <button type="button" onClick={() => setLegendOpen(false)} className="text-[10px] font-semibold text-[#64748B] hover:text-[#0F172A]">Hide</button>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-[#475569]">
              <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#16A34A]" /><span>Start</span></div>
              <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#EF4444]" /><span>Item shelf</span></div>
              <div className="flex items-center gap-1.5"><span className="h-1 w-4 rounded bg-[#2563EB]" /><span>Your route</span></div>
              <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#7C3AED]" /><span>Checkout</span></div>
            </div>
            {map.layout.isPrototype && <p className="text-[10px] leading-snug text-[#94A3B8]">Prototype floor plan, not a surveyed drawing.</p>}
          </div>
        ) : (
          <button type="button" onClick={() => setLegendOpen(true)} className="rounded-xl border border-[#E2E8F0] bg-white/95 px-3 py-1.5 text-xs font-semibold text-[#64748B] shadow-sm backdrop-blur-md hover:text-[#0F172A]">
            Show Legend
          </button>
        )}
      </div>

      <button type="button" onClick={() => setVb(full)} className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-3.5 py-2 text-xs font-bold text-white shadow-lg transition-all hover:bg-blue-700 active:scale-95">
        <Crosshair className="h-3.5 w-3.5" />
        <span>Fit Whole Store</span>
      </button>
    </div>
  );
};

export const MapLegend: React.FC = () => null;
