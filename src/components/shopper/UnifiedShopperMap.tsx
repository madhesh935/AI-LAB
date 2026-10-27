import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowRight,
  ShoppingCart,
  Clock,
  Users,
  Maximize2,
  Minimize2,
  Play,
  Pause,
  MapPin,
  TrendingUp,
  X,
  Video,
  Sparkles,
  ChevronDown,
  Layers,
  Flame,
} from 'lucide-react';
import type { CustomerPath, ZoneMetrics, ZoneTransitionNode } from '../../types/retail';
import { IS_DEMO_MODE } from '../../services/api/config';
import { CameraPreviewModal } from './CameraPreviewModal';
import { getMockOverviewData } from '../../services/mockData';
import { useStore } from '../../context/StoreContext';

interface UnifiedShopperMapProps {
  topPaths: CustomerPath[];
  zones?: ZoneMetrics[];
  transitions?: ZoneTransitionNode[];
  selectedPathId?: string;
  onSelectPathId?: (id: string) => void;
  selectedZoneId?: string | null;
  onSelectZoneId?: (id: string | null) => void;
  isExpandedFullWidth?: boolean;
  onToggleFullWidth?: () => void;
}

interface MapDepartment {
  id: string;
  num: number;
  name: string;
  category: string;
  dwell: number | null;
  visitors: number | null;
  zoneIds: string[];
  occupancy: number | null;
  badgeColor: string;
  badgeBg: string;
  cardX: number;
  cardY: number;
  cardW: number;
  cardH: number;
  floorX: number;
  floorY: number;
  floorW: number;
  floorH: number;
  waypointX: number;
  waypointY: number;
  dwellBenchmark: number;
  heatColor: string;
}

export const UnifiedShopperMap: React.FC<UnifiedShopperMapProps> = ({
  topPaths = [],
  zones = [],
  transitions = [],
  selectedPathId = 'all',
  onSelectPathId,
  selectedZoneId = null,
  onSelectZoneId,
  isExpandedFullWidth = false,
  onToggleFullWidth,
}) => {
  const [activeCircuitId, setActiveCircuitId] = useState<string>(selectedPathId || 'all');
  const [viewMode, setViewMode] = useState<'flow' | 'dwell'>('flow');
  const [isCircuitMenuOpen, setIsCircuitMenuOpen] = useState<boolean>(false);
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  const [internalSelectedZone, setInternalSelectedZone] = useState<string | null>(selectedZoneId || null);
  const [isSimulatingShoppers, setIsSimulatingShoppers] = useState<boolean>(true);
  const { selectedStoreId } = useStore();
  const [cameraModalId, setCameraModalId] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync prop changes
  useEffect(() => {
    if (selectedPathId) setActiveCircuitId(selectedPathId);
  }, [selectedPathId]);

  useEffect(() => {
    setInternalSelectedZone(selectedZoneId || null);
  }, [selectedZoneId]);
  // the page selects REAL zone ids; the floor plan selects department slots (a slot may cover several zones)

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsCircuitMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectZone = (slotId: string | null) => {
    setInternalSelectedZone(slotId);
    if (onSelectZoneId) {
      const slot = departments.find((d) => d.id === slotId);
      onSelectZoneId(slot ? slot.zoneIds[0] ?? slot.id : null);
    }
  };

  const handleSelectCircuit = (circuitId: string) => {
    setActiveCircuitId(circuitId);
    setIsCircuitMenuOpen(false);
    if (onSelectPathId) {
      onSelectPathId(circuitId);
    }
  };

  // The 8 floor-plan slots (layout, fixtures and colours of the original design). Their NUMBERS come from the store's measured zones, never from this file.
  const slots: MapDepartment[] = [
    {
      id: 'z-entrance',
      num: 1,
      name: 'Entrance Vestibule',
      category: 'Access & Turnstiles',
      dwell: 1.5,
      visitors: 3147,
      badgeColor: '#2563EB',
      badgeBg: '#EFF6FF',
      cardX: 90,
      cardY: 45,
      cardW: 240,
      cardH: 78,
      floorX: 70,
      floorY: 135,
      floorW: 280,
      floorH: 75,
      waypointX: 95,
      waypointY: 180,
      dwellBenchmark: 2.0,
      heatColor: '#93C5FD',
      zoneIds: [],
      occupancy: null,
    },
    {
      id: 'z-promo',
      num: 2,
      name: 'Promotional Offers',
      category: 'Featured End-Caps',
      dwell: 4.8,
      visitors: 1890,
      badgeColor: '#F59E0B',
      badgeBg: '#FFFBEB',
      cardX: 430,
      cardY: 45,
      cardW: 245,
      cardH: 78,
      floorX: 420,
      floorY: 135,
      floorW: 265,
      floorH: 75,
      waypointX: 468,
      waypointY: 180,
      dwellBenchmark: 5.0,
      heatColor: '#FCD34D',
      zoneIds: [],
      occupancy: null,
    },
    {
      id: 'z-personal',
      num: 3,
      name: 'Personal Care & Beauty',
      category: 'Health & Cosmetics',
      dwell: 7.2,
      visitors: 980,
      badgeColor: '#9333EA',
      badgeBg: '#FAF5FF',
      cardX: 825,
      cardY: 45,
      cardW: 255,
      cardH: 78,
      floorX: 810,
      floorY: 135,
      floorW: 275,
      floorH: 75,
      waypointX: 885,
      waypointY: 180,
      dwellBenchmark: 8.5,
      heatColor: '#C084FC',
      zoneIds: [],
      occupancy: null,
    },
    {
      id: 'z-grocery',
      num: 4,
      name: 'Fresh Produce & Grocery',
      category: 'Organic Fruits & Veg',
      dwell: 14.5,
      visitors: 2680,
      badgeColor: '#16A34A',
      badgeBg: '#F0FDF4',
      cardX: 80,
      cardY: 235,
      cardW: 250,
      cardH: 78,
      floorX: 65,
      floorY: 325,
      floorW: 345,
      floorH: 95,
      waypointX: 382,
      waypointY: 330,
      dwellBenchmark: 12.0,
      heatColor: '#4ADE80',
      zoneIds: [],
      occupancy: null,
    },
    {
      id: 'z-dairy',
      num: 5,
      name: 'Dairy & Chilled Foods',
      category: 'Milk, Eggs & Cheese',
      dwell: 8.6,
      visitors: 2150,
      badgeColor: '#0284C7',
      badgeBg: '#ECFEFF',
      cardX: 510,
      cardY: 235,
      cardW: 245,
      cardH: 78,
      floorX: 495,
      floorY: 325,
      floorW: 265,
      floorH: 95,
      waypointX: 520,
      waypointY: 268,
      dwellBenchmark: 7.5,
      heatColor: '#38BDF8',
      zoneIds: [],
      occupancy: null,
    },
    {
      id: 'z-beverages',
      num: 6,
      name: 'Beverages & Snacks',
      category: 'Packaged Drinks & Chips',
      dwell: 6.4,
      visitors: 1420,
      badgeColor: '#F43F5E',
      badgeBg: '#FFF1F2',
      cardX: 925,
      cardY: 255,
      cardW: 240,
      cardH: 78,
      floorX: 900,
      floorY: 345,
      floorW: 265,
      floorH: 95,
      waypointX: 890,
      waypointY: 350,
      dwellBenchmark: 6.0,
      heatColor: '#FB7185',
      zoneIds: [],
      occupancy: null,
    },
    {
      id: 'z-checkout',
      num: 7,
      name: 'Checkout Counters',
      category: 'POS Lanes 1 to 6',
      dwell: 3.8,
      visitors: 2840,
      badgeColor: '#C026D3',
      badgeBg: '#FDF4FF',
      cardX: 70,
      cardY: 450,
      cardW: 245,
      cardH: 78,
      floorX: 335,
      floorY: 455,
      floorW: 320,
      floorH: 78,
      waypointX: 415,
      waypointY: 505,
      dwellBenchmark: 4.0,
      heatColor: '#E879F9',
      zoneIds: [],
      occupancy: null,
    },
    {
      id: 'z-exit',
      num: 8,
      name: 'Exit Vestibule',
      category: 'Anti-Theft EAS Gates',
      dwell: 0.8,
      visitors: 2810,
      badgeColor: '#475569',
      badgeBg: '#F1F5F9',
      cardX: 715,
      cardY: 450,
      cardW: 240,
      cardH: 78,
      floorX: 690,
      floorY: 445,
      floorW: 340,
      floorH: 88,
      waypointX: 1005,
      waypointY: 505,
      dwellBenchmark: 1.0,
      heatColor: '#94A3B8',
      zoneIds: [],
      occupancy: null,
    },
  ];

  const departments: MapDepartment[] = slots.map((slot) => {
    const zs = zonesForSlot(slot.id, zones);
    if (zs.length === 0) return { ...slot, dwell: null, visitors: null, zoneIds: [], occupancy: null };
    const visitors = zs.reduce((a, z) => a + (z.totalVisitors || 0), 0);
    const timed = zs.filter((z) => z.avgDwellMinutes !== null && z.totalVisitors > 0);
    const w = timed.reduce((a, z) => a + z.totalVisitors, 0);
    const dwell = w > 0 ? Math.round((timed.reduce((a, z) => a + (z.avgDwellMinutes as number) * z.totalVisitors, 0) / w) * 10) / 10 : null;
    const occ = zs.some((z) => z.currentOccupancy !== null) ? zs.reduce((a, z) => a + (z.currentOccupancy ?? 0), 0) : null;
    return { ...slot, name: zs.map((z) => z.zoneName).join(' + '), category: zs.length === 1 ? zs[0].category : `${zs.length} zones`, dwell, visitors, zoneIds: zs.map((z) => z.zoneId), occupancy: occ };
  });
  const slotOfZone = (zoneRef: string): MapDepartment | undefined =>
    departments.find((d) => d.id === zoneRef || d.zoneIds.includes(zoneRef)) ??
    departments.find((d) => zones.some((z) => d.zoneIds.includes(z.zoneId) && (z.zoneName.toLowerCase() === zoneRef.toLowerCase() || zoneRef.toLowerCase().includes(z.zoneName.toLowerCase()))));

  // Counted zone-to-zone moves between floor-plan slots (aggregated; people are not matched across cameras)
  const moves = (() => {
    const acc = new Map<string, { from: MapDepartment; to: MapDepartment; count: number }>();
    for (const t of transitions) {
      const from = slotOfZone(t.fromZone);
      const to = slotOfZone(t.toZone);
      if (!from || !to || from.id === to.id) continue;
      const key = `${from.id}>${to.id}`;
      const cur = acc.get(key);
      if (cur) cur.count += t.transitionCount;
      else acc.set(key, { from, to, count: t.transitionCount });
    }
    return [...acc.entries()].map(([key, m]) => ({ key, ...m })).sort((a, b) => b.count - a.count);
  })();
  const totalMoves = moves.reduce((a, m) => a + m.count, 0);
  const maxMove = Math.max(1, ...moves.map((m) => m.count));
  const pct = (n: number) => (totalMoves > 0 ? `${Math.round((n / totalMoves) * 1000) / 10}%` : '—');

  // Circuit selector: "all counted moves" plus the strongest individual moves (all measured)
  const circuits = [
    { id: 'all', name: moves.length ? 'All counted moves' : 'No moves counted yet', subtitle: moves.length ? `${totalMoves} moves between zones` : 'Flow lines appear when movement is measured', percentage: moves.length ? '100%' : '—', avgTime: '' },
    ...moves.slice(0, 5).map((m) => ({ id: m.key, name: `${m.from.name} → ${m.to.name}`, subtitle: `${m.count} counted moves`, percentage: pct(m.count), avgTime: '' })),
  ];
  const currentCircuit = circuits.find((c) => c.id === activeCircuitId) || circuits[0];
  const activeZone = departments.find((d) => d.id === hoveredZoneId || (internalSelectedZone !== null && (d.id === internalSelectedZone || d.zoneIds.includes(internalSelectedZone))));

  // SVG indoor plant coordinates for architectural greenery
  const plantLocations = [
    { cx: 35, cy: 300, r: 12 },
    { cx: 350, cy: 120, r: 10 },
    { cx: 350, cy: 220, r: 11 },
    { cx: 435, cy: 300, r: 11 },
    { cx: 450, cy: 430, r: 10 },
    { cx: 625, cy: 120, r: 11 },
    { cx: 645, cy: 215, r: 10 },
    { cx: 670, cy: 430, r: 11 },
    { cx: 775, cy: 300, r: 11 },
    { cx: 940, cy: 120, r: 10 },
    { cx: 940, cy: 220, r: 10 },
    { cx: 550, cy: 560, r: 12 },
  ];

  return (
    <div
      className={`relative bg-white rounded-2xl border border-slate-200/80 shadow-xs transition-all overflow-hidden ${
        isExpandedFullWidth ? 'w-full' : 'w-full'
      }`}
    >
      <style>{`
        @keyframes strokeDashFlow {
          0% { stroke-dashoffset: 48; }
          100% { stroke-dashoffset: 0; }
        }
        .flow-animated-line {
          animation: strokeDashFlow 1.6s linear infinite;
        }
        .flow-animated-line-reverse {
          animation: strokeDashFlow 1.6s linear infinite reverse;
        }
        @keyframes pulseGlow {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(1.08); }
        }
        .pulse-halo {
          animation: pulseGlow 2.5s ease-in-out infinite;
        }
      `}</style>

      {/* =========================================================================
          TOP TOOLBAR / HEADER: EXACT MATCH TO USER'S REFERENCE IMAGE
          ========================================================================= */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100 bg-white select-none">
        {/* Left: Entrance Tag */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center text-white shadow-2xs font-semibold">
            <ArrowRight className="w-4 h-4 stroke-[2.75]" />
          </div>
          <span className="text-base font-semibold text-slate-900 tracking-tight">Shopper Analytics</span>
        </div>

        {/* Right Controls: Circuit Selector & View Switcher */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Circuit Dropdown Trigger */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setIsCircuitMenuOpen(!isCircuitMenuOpen)}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:border-blue-400 hover:bg-slate-50 transition-all shadow-2xs cursor-pointer"
            >
              <ShoppingCart className="w-3.5 h-3.5 text-blue-600" />
              <span>Showing: <strong className="text-slate-900 font-semibold">{currentCircuit.name}</strong></span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
            </button>

            {/* Dropdown Menu */}
            {isCircuitMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-72 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="px-3 py-1.5 border-b border-slate-100 text-caption font-semibold uppercase tracking-wider text-slate-400">
                  Select Shopper Journey Circuit
                </div>
                {circuits.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleSelectCircuit(c.id)}
                    className={`w-full text-left px-3.5 py-2.5 text-xs transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                      c.id === activeCircuitId ? 'bg-blue-50/80 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <div className="font-semibold text-slate-900">{c.name}</div>
                      <div className="text-caption text-slate-400 font-normal">{c.subtitle}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-caption font-mono font-semibold text-blue-600">{c.percentage}</div>
                      <div className="text-caption text-slate-400">{c.avgTime}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* View Mode Toggle: Flow vs Dwell Time */}
          <div className="flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap">
            <span className="text-slate-500 font-medium text-xs">View:</span>
            <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setViewMode('flow')}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  viewMode === 'flow'
                    ? 'bg-blue-600 text-white shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Flow
              </button>
              <button
                type="button"
                onClick={() => setViewMode('dwell')}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  viewMode === 'dwell'
                    ? 'bg-blue-600 text-white shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Dwell Time
              </button>
            </div>
          </div>

          {/* Realtime Live Shoppers Simulation Toggle */}
          <button
            type="button"
            onClick={() => setIsSimulatingShoppers(!isSimulatingShoppers)}
            title={isSimulatingShoppers ? 'Pause animation' : 'Play animation'}
            className={`p-1.5 rounded-xl border transition-all cursor-pointer hidden sm:flex items-center gap-1 text-xs font-semibold ${
              isSimulatingShoppers
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
            }`}
          >
            {isSimulatingShoppers ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span className="text-caption hidden md:inline">{isSimulatingShoppers ? 'Live' : 'Paused'}</span>
          </button>

          {/* Fullscreen Expand Toggle */}
          {onToggleFullWidth && (
            <button
              type="button"
              onClick={onToggleFullWidth}
              title={isExpandedFullWidth ? 'Standard View' : 'Expand Store Map'}
              className="p-1.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all cursor-pointer"
            >
              {isExpandedFullWidth ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* =========================================================================
          MAIN ARCHITECTURAL FLOOR PLAN CANVAS (1200 x 580 Coordinate Space)
          ========================================================================= */}
      <div className="relative w-full aspect-[1200/580] min-h-[460px] bg-[#F8FAFC] overflow-hidden select-none">
        <svg viewBox="0 0 1200 580" className="w-full h-full">
          <defs>
            {/* Filter: Floating Card Shadow */}
            <filter id="svgCardShadow" x="-10%" y="-10%" width="120%" height="130%">
              <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#0F172A" floodOpacity="0.07" />
            </filter>

            {/* Filter: Selected Active Card Glow */}
            <filter id="activeGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#2563EB" floodOpacity="0.35" />
            </filter>

            {/* Filter: Subtle Flow Path Glow */}
            <filter id="pathGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor="#60A5FA" floodOpacity="0.5" />
            </filter>

            {/* Chevron Arrow Marker */}
            <marker
              id="flowArrow"
              viewBox="0 0 10 10"
              refX="5"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 2 L 7 5 L 0 8 z" fill="#2563EB" />
            </marker>

            {/* Dwell Heatmap Radial Gradients */}
            {departments.map((d) => (
              <radialGradient id={`heat-${d.id}`} key={`heat-${d.id}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={d.heatColor} stopOpacity="0.45" />
                <stop offset="60%" stopColor={d.heatColor} stopOpacity="0.18" />
                <stop offset="100%" stopColor={d.heatColor} stopOpacity="0" />
              </radialGradient>
            ))}

            {/* Floor Tile Architectural Hatch Pattern */}
            <pattern id="floorTiles" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#E2E8F0" strokeWidth="0.5" strokeOpacity="0.5" />
            </pattern>
          </defs>

          {/* Background Grid & Outer Architecture Perimeter */}
          <rect x="0" y="0" width="1200" height="580" fill="#F8FAFC" />
          <rect x="25" y="25" width="1150" height="530" fill="url(#floorTiles)" rx="16" />
          <rect
            x="25"
            y="25"
            width="1150"
            height="530"
            fill="none"
            stroke="#CBD5E1"
            strokeWidth="1.5"
            strokeDasharray="6 6"
            rx="16"
          />

          {/* Architectural Structural Aisle Walls / Glass Partitions */}
          <g stroke="#E2E8F0" strokeWidth="1.5" opacity="0.8">
            <line x1="380" y1="35" x2="380" y2="210" />
            <line x1="780" y1="35" x2="780" y2="210" />
            <line x1="450" y1="230" x2="450" y2="430" />
            <line x1="860" y1="230" x2="860" y2="430" />
            <line x1="35" y1="225" x2="1165" y2="225" strokeDasharray="3 3" />
            <line x1="35" y1="440" x2="1165" y2="440" strokeDasharray="3 3" />
          </g>

          {/* =========================================================================
              FLOOR ZONES TINTED FOOTPRINTS & FIXTURES (Turnstiles, Crates, Shelves, Registers)
              ========================================================================= */}
          {departments.map((dept) => {
            const isSelected = internalSelectedZone !== null && (internalSelectedZone === dept.id || dept.zoneIds.includes(internalSelectedZone));
            const isHovered = hoveredZoneId === dept.id;

            return (
              <g
                key={`floor-${dept.id}`}
                onClick={() => handleSelectZone(isSelected ? null : dept.id)}
                onMouseEnter={() => setHoveredZoneId(dept.id)}
                onMouseLeave={() => setHoveredZoneId(null)}
                className="cursor-pointer transition-all duration-200"
              >
                {/* Dwell Heatmap Halo (when in dwell mode) */}
                {viewMode === 'dwell' && dept.dwell !== null && (
                  <ellipse
                    cx={dept.floorX + dept.floorW / 2}
                    cy={dept.floorY + dept.floorH / 2}
                    rx={dept.floorW * 0.7}
                    ry={dept.floorH * 0.9}
                    fill={`url(#heat-${dept.id})`}
                    className="pulse-halo"
                  />
                )}

                {/* Floor Zone Outline Footprint */}
                <rect
                  x={dept.floorX}
                  y={dept.floorY}
                  width={dept.floorW}
                  height={dept.floorH}
                  rx="14"
                  fill={dept.badgeBg}
                  fillOpacity={viewMode === 'dwell' ? '0.6' : '0.45'}
                  stroke={dept.badgeColor}
                  strokeWidth={isSelected || isHovered ? '2' : '1.2'}
                  strokeDasharray={isSelected ? 'none' : '4 4'}
                  className="transition-all"
                />

                {/* Fixture Graphics per Department */}
                {/* 1. Entrance Vestibule: 3 Security Turnstiles / Speed Gates */}
                {dept.id === 'z-entrance' && (
                  <g fill="#94A3B8" stroke="#64748B" strokeWidth="1">
                    {/* Gate 1 */}
                    <rect x={dept.floorX + 35} y={dept.floorY + 18} width="35" height="38" rx="6" fill="#CBD5E1" />
                    <line x1={dept.floorX + 52} y1={dept.floorY + 22} x2={dept.floorX + 52} y2={dept.floorY + 52} stroke="#3B82F6" strokeWidth="2" />
                    <line x1={dept.floorX + 45} y1={dept.floorY + 28} x2={dept.floorX + 60} y2={dept.floorY + 42} stroke="#93C5FD" strokeWidth="1.5" />
                    {/* Gate 2 */}
                    <rect x={dept.floorX + 115} y={dept.floorY + 18} width="35" height="38" rx="6" fill="#CBD5E1" />
                    <line x1={dept.floorX + 132} y1={dept.floorY + 22} x2={dept.floorX + 132} y2={dept.floorY + 52} stroke="#3B82F6" strokeWidth="2" />
                    <line x1={dept.floorX + 125} y1={dept.floorY + 28} x2={dept.floorX + 140} y2={dept.floorY + 42} stroke="#93C5FD" strokeWidth="1.5" />
                    {/* Gate 3 */}
                    <rect x={dept.floorX + 195} y={dept.floorY + 18} width="35" height="38" rx="6" fill="#CBD5E1" />
                    <line x1={dept.floorX + 212} y1={dept.floorY + 22} x2={dept.floorX + 212} y2={dept.floorY + 52} stroke="#3B82F6" strokeWidth="2" />
                    <line x1={dept.floorX + 205} y1={dept.floorY + 28} x2={dept.floorX + 220} y2={dept.floorY + 42} stroke="#93C5FD" strokeWidth="1.5" />
                  </g>
                )}

                {/* 2. Promotional Offers: 2 Double-sided Promotional Gondola Displays */}
                {dept.id === 'z-promo' && (
                  <g fill="#FDE68A" stroke="#D97706" strokeWidth="1">
                    {/* Island 1 */}
                    <rect x={dept.floorX + 30} y={dept.floorY + 16} width="85" height="42" rx="6" fill="#FEF3C7" />
                    <line x1={dept.floorX + 30} y1={dept.floorY + 37} x2={dept.floorX + 115} y2={dept.floorY + 37} stroke="#F59E0B" strokeWidth="1.5" />
                    <rect x={dept.floorX + 40} y={dept.floorY + 20} width="16" height="12" rx="2" fill="#FBBF24" />
                    <rect x={dept.floorX + 62} y={dept.floorY + 20} width="16" height="12" rx="2" fill="#F59E0B" />
                    <rect x={dept.floorX + 85} y={dept.floorY + 20} width="16" height="12" rx="2" fill="#FBBF24" />
                    <rect x={dept.floorX + 40} y={dept.floorY + 42} width="16" height="12" rx="2" fill="#FBBF24" />
                    <rect x={dept.floorX + 62} y={dept.floorY + 42} width="16" height="12" rx="2" fill="#F59E0B" />
                    <rect x={dept.floorX + 85} y={dept.floorY + 42} width="16" height="12" rx="2" fill="#FBBF24" />
                    {/* Island 2 */}
                    <rect x={dept.floorX + 145} y={dept.floorY + 16} width="85" height="42" rx="6" fill="#FEF3C7" />
                    <line x1={dept.floorX + 145} y1={dept.floorY + 37} x2={dept.floorX + 230} y2={dept.floorY + 37} stroke="#F59E0B" strokeWidth="1.5" />
                    <rect x={dept.floorX + 155} y={dept.floorY + 20} width="16" height="12" rx="2" fill="#FBBF24" />
                    <rect x={dept.floorX + 177} y={dept.floorY + 20} width="16" height="12" rx="2" fill="#F59E0B" />
                    <rect x={dept.floorX + 200} y={dept.floorY + 20} width="16" height="12" rx="2" fill="#FBBF24" />
                    <rect x={dept.floorX + 155} y={dept.floorY + 42} width="16" height="12" rx="2" fill="#FBBF24" />
                    <rect x={dept.floorX + 177} y={dept.floorY + 42} width="16" height="12" rx="2" fill="#F59E0B" />
                    <rect x={dept.floorX + 200} y={dept.floorY + 42} width="16" height="12" rx="2" fill="#FBBF24" />
                  </g>
                )}

                {/* 3. Personal Care: Cosmetic Shelves & Perfume Towers */}
                {dept.id === 'z-personal' && (
                  <g fill="#F3E8FF" stroke="#9333EA" strokeWidth="1">
                    {/* Gondola 1 */}
                    <rect x={dept.floorX + 30} y={dept.floorY + 16} width="95" height="42" rx="6" fill="#FAF5FF" />
                    <line x1={dept.floorX + 30} y1={dept.floorY + 37} x2={dept.floorX + 125} y2={dept.floorY + 37} stroke="#C084FC" strokeWidth="1.5" />
                    <circle cx={dept.floorX + 45} cy={dept.floorY + 26} r="5" fill="#E879F9" stroke="none" />
                    <circle cx={dept.floorX + 65} cy={dept.floorY + 26} r="5" fill="#C084FC" stroke="none" />
                    <circle cx={dept.floorX + 85} cy={dept.floorY + 26} r="5" fill="#E879F9" stroke="none" />
                    <circle cx={dept.floorX + 105} cy={dept.floorY + 26} r="5" fill="#C084FC" stroke="none" />
                    <rect x={dept.floorX + 40} y={dept.floorY + 42} width="14" height="10" rx="2" fill="#D8B4FE" />
                    <rect x={dept.floorX + 62} y={dept.floorY + 42} width="14" height="10" rx="2" fill="#A855F7" />
                    <rect x={dept.floorX + 84} y={dept.floorY + 42} width="14" height="10" rx="2" fill="#D8B4FE" />
                    <rect x={dept.floorX + 104} y={dept.floorY + 42} width="14" height="10" rx="2" fill="#A855F7" />
                    {/* Gondola 2 */}
                    <rect x={dept.floorX + 150} y={dept.floorY + 16} width="95" height="42" rx="6" fill="#FAF5FF" />
                    <line x1={dept.floorX + 150} y1={dept.floorY + 37} x2={dept.floorX + 245} y2={dept.floorY + 37} stroke="#C084FC" strokeWidth="1.5" />
                    <circle cx={dept.floorX + 165} cy={dept.floorY + 26} r="5" fill="#E879F9" stroke="none" />
                    <circle cx={dept.floorX + 185} cy={dept.floorY + 26} r="5" fill="#C084FC" stroke="none" />
                    <circle cx={dept.floorX + 205} cy={dept.floorY + 26} r="5" fill="#E879F9" stroke="none" />
                    <circle cx={dept.floorX + 225} cy={dept.floorY + 26} r="5" fill="#C084FC" stroke="none" />
                    <rect x={dept.floorX + 160} y={dept.floorY + 42} width="14" height="10" rx="2" fill="#D8B4FE" />
                    <rect x={dept.floorX + 182} y={dept.floorY + 42} width="14" height="10" rx="2" fill="#A855F7" />
                    <rect x={dept.floorX + 204} y={dept.floorY + 42} width="14" height="10" rx="2" fill="#D8B4FE" />
                    <rect x={dept.floorX + 224} y={dept.floorY + 42} width="14" height="10" rx="2" fill="#A855F7" />
                  </g>
                )}

                {/* 4. Fresh Produce & Grocery: 6 Wooden Crates Display Tables */}
                {dept.id === 'z-grocery' && (
                  <g>
                    {/* Row 1 Crates */}
                    {/* Crate 1: Carrots / Citrus */}
                    <rect x={dept.floorX + 25} y={dept.floorY + 18} width="85" height="30" rx="5" fill="#FED7AA" stroke="#EA580C" strokeWidth="1" />
                    <circle cx={dept.floorX + 42} cy={dept.floorY + 33} r="6" fill="#F97316" />
                    <circle cx={dept.floorX + 57} cy={dept.floorY + 33} r="6" fill="#EA580C" />
                    <circle cx={dept.floorX + 72} cy={dept.floorY + 33} r="6" fill="#F97316" />
                    <circle cx={dept.floorX + 87} cy={dept.floorY + 33} r="6" fill="#EA580C" />

                    {/* Crate 2: Organic Lettuce / Greens */}
                    <rect x={dept.floorX + 130} y={dept.floorY + 18} width="85" height="30" rx="5" fill="#DCFCE7" stroke="#16A34A" strokeWidth="1" />
                    <circle cx={dept.floorX + 147} cy={dept.floorY + 33} r="6" fill="#22C55E" />
                    <circle cx={dept.floorX + 162} cy={dept.floorY + 33} r="6" fill="#16A34A" />
                    <circle cx={dept.floorX + 177} cy={dept.floorY + 33} r="6" fill="#22C55E" />
                    <circle cx={dept.floorX + 192} cy={dept.floorY + 33} r="6" fill="#16A34A" />

                    {/* Crate 3: Apples / Berries */}
                    <rect x={dept.floorX + 235} y={dept.floorY + 18} width="85" height="30" rx="5" fill="#FFE4E6" stroke="#E11D48" strokeWidth="1" />
                    <circle cx={dept.floorX + 252} cy={dept.floorY + 33} r="6" fill="#EF4444" />
                    <circle cx={dept.floorX + 267} cy={dept.floorY + 33} r="6" fill="#DC2626" />
                    <circle cx={dept.floorX + 282} cy={dept.floorY + 33} r="6" fill="#EF4444" />
                    <circle cx={dept.floorX + 297} cy={dept.floorY + 33} r="6" fill="#DC2626" />

                    {/* Row 2 Crates */}
                    {/* Crate 4 */}
                    <rect x={dept.floorX + 25} y={dept.floorY + 55} width="85" height="30" rx="5" fill="#FEF08A" stroke="#CA8A04" strokeWidth="1" />
                    <circle cx={dept.floorX + 42} cy={dept.floorY + 70} r="6" fill="#EAB308" />
                    <circle cx={dept.floorX + 57} cy={dept.floorY + 70} r="6" fill="#CA8A04" />
                    <circle cx={dept.floorX + 72} cy={dept.floorY + 70} r="6" fill="#EAB308" />
                    <circle cx={dept.floorX + 87} cy={dept.floorY + 70} r="6" fill="#CA8A04" />

                    {/* Crate 5 */}
                    <rect x={dept.floorX + 130} y={dept.floorY + 55} width="85" height="30" rx="5" fill="#DCFCE7" stroke="#16A34A" strokeWidth="1" />
                    <circle cx={dept.floorX + 147} cy={dept.floorY + 70} r="6" fill="#15803D" />
                    <circle cx={dept.floorX + 162} cy={dept.floorY + 70} r="6" fill="#22C55E" />
                    <circle cx={dept.floorX + 177} cy={dept.floorY + 70} r="6" fill="#15803D" />
                    <circle cx={dept.floorX + 192} cy={dept.floorY + 70} r="6" fill="#22C55E" />

                    {/* Crate 6 */}
                    <rect x={dept.floorX + 235} y={dept.floorY + 55} width="85" height="30" rx="5" fill="#FED7AA" stroke="#EA580C" strokeWidth="1" />
                    <circle cx={dept.floorX + 252} cy={dept.floorY + 70} r="6" fill="#F97316" />
                    <circle cx={dept.floorX + 267} cy={dept.floorY + 70} r="6" fill="#EA580C" />
                    <circle cx={dept.floorX + 282} cy={dept.floorY + 70} r="6" fill="#F97316" />
                    <circle cx={dept.floorX + 297} cy={dept.floorY + 70} r="6" fill="#EA580C" />
                  </g>
                )}

                {/* 5. Dairy & Chilled Foods: 2 Glass-door Chillers with Blue Shelves */}
                {dept.id === 'z-dairy' && (
                  <g fill="#BAE6FD" stroke="#0284C7" strokeWidth="1">
                    {/* Chiller 1 */}
                    <rect x={dept.floorX + 25} y={dept.floorY + 20} width="95" height="55" rx="5" fill="#E0F2FE" />
                    <rect x={dept.floorX + 30} y={dept.floorY + 25} width="40" height="45" rx="3" fill="#FFFFFF" stroke="#0284C7" strokeWidth="1" />
                    <rect x={dept.floorX + 75} y={dept.floorY + 25} width="40" height="45" rx="3" fill="#FFFFFF" stroke="#0284C7" strokeWidth="1" />
                    <line x1={dept.floorX + 30} y1={dept.floorY + 40} x2={dept.floorX + 70} y2={dept.floorY + 40} stroke="#38BDF8" strokeWidth="1.5" />
                    <line x1={dept.floorX + 30} y1={dept.floorY + 55} x2={dept.floorX + 70} y2={dept.floorY + 55} stroke="#38BDF8" strokeWidth="1.5" />
                    <line x1={dept.floorX + 75} y1={dept.floorY + 40} x2={dept.floorX + 115} y2={dept.floorY + 40} stroke="#38BDF8" strokeWidth="1.5" />
                    <line x1={dept.floorX + 75} y1={dept.floorY + 55} x2={dept.floorX + 115} y2={dept.floorY + 55} stroke="#38BDF8" strokeWidth="1.5" />

                    {/* Chiller 2 */}
                    <rect x={dept.floorX + 145} y={dept.floorY + 20} width="95" height="55" rx="5" fill="#E0F2FE" />
                    <rect x={dept.floorX + 150} y={dept.floorY + 25} width="40" height="45" rx="3" fill="#FFFFFF" stroke="#0284C7" strokeWidth="1" />
                    <rect x={dept.floorX + 195} y={dept.floorY + 25} width="40" height="45" rx="3" fill="#FFFFFF" stroke="#0284C7" strokeWidth="1" />
                    <line x1={dept.floorX + 150} y1={dept.floorY + 40} x2={dept.floorX + 190} y2={dept.floorY + 40} stroke="#38BDF8" strokeWidth="1.5" />
                    <line x1={dept.floorX + 150} y1={dept.floorY + 55} x2={dept.floorX + 190} y2={dept.floorY + 55} stroke="#38BDF8" strokeWidth="1.5" />
                    <line x1={dept.floorX + 195} y1={dept.floorY + 40} x2={dept.floorX + 235} y2={dept.floorY + 40} stroke="#38BDF8" strokeWidth="1.5" />
                    <line x1={dept.floorX + 195} y1={dept.floorY + 55} x2={dept.floorX + 235} y2={dept.floorY + 55} stroke="#38BDF8" strokeWidth="1.5" />
                  </g>
                )}

                {/* 6. Beverages & Snacks: 2 Tall Aisle Shelf Units with Bottles */}
                {dept.id === 'z-beverages' && (
                  <g fill="#FFE4E6" stroke="#F43F5E" strokeWidth="1">
                    {/* Shelf 1 */}
                    <rect x={dept.floorX + 25} y={dept.floorY + 16} width="95" height="62" rx="5" fill="#FFF1F2" />
                    <line x1={dept.floorX + 25} y1={dept.floorY + 36} x2={dept.floorX + 120} y2={dept.floorY + 36} stroke="#FB7185" strokeWidth="1.5" />
                    <line x1={dept.floorX + 25} y1={dept.floorY + 56} x2={dept.floorX + 120} y2={dept.floorY + 56} stroke="#FB7185" strokeWidth="1.5" />
                    <rect x={dept.floorX + 35} y={dept.floorY + 22} width="8" height="10" rx="1" fill="#E11D48" />
                    <rect x={dept.floorX + 48} y={dept.floorY + 22} width="8" height="10" rx="1" fill="#2563EB" />
                    <rect x={dept.floorX + 61} y={dept.floorY + 22} width="8" height="10" rx="1" fill="#16A34A" />
                    <rect x={dept.floorX + 74} y={dept.floorY + 22} width="8" height="10" rx="1" fill="#EA580C" />
                    <rect x={dept.floorX + 87} y={dept.floorY + 22} width="8" height="10" rx="1" fill="#E11D48" />
                    <rect x={dept.floorX + 100} y={dept.floorY + 22} width="8" height="10" rx="1" fill="#2563EB" />
                    {/* Row 2 cans */}
                    <rect x={dept.floorX + 35} y={dept.floorY + 41} width="8" height="10" rx="1" fill="#F59E0B" />
                    <rect x={dept.floorX + 48} y={dept.floorY + 41} width="8" height="10" rx="1" fill="#8B5CF6" />
                    <rect x={dept.floorX + 61} y={dept.floorY + 41} width="8" height="10" rx="1" fill="#06B6D4" />
                    <rect x={dept.floorX + 74} y={dept.floorY + 41} width="8" height="10" rx="1" fill="#F43F5E" />
                    <rect x={dept.floorX + 87} y={dept.floorY + 41} width="8" height="10" rx="1" fill="#10B981" />
                    <rect x={dept.floorX + 100} y={dept.floorY + 41} width="8" height="10" rx="1" fill="#F59E0B" />

                    {/* Shelf 2 */}
                    <rect x={dept.floorX + 145} y={dept.floorY + 16} width="95" height="62" rx="5" fill="#FFF1F2" />
                    <line x1={dept.floorX + 145} y1={dept.floorY + 36} x2={dept.floorX + 240} y2={dept.floorY + 36} stroke="#FB7185" strokeWidth="1.5" />
                    <line x1={dept.floorX + 145} y1={dept.floorY + 56} x2={dept.floorX + 240} y2={dept.floorY + 56} stroke="#FB7185" strokeWidth="1.5" />
                    <rect x={dept.floorX + 155} y={dept.floorY + 22} width="8" height="10" rx="1" fill="#E11D48" />
                    <rect x={dept.floorX + 168} y={dept.floorY + 22} width="8" height="10" rx="1" fill="#2563EB" />
                    <rect x={dept.floorX + 181} y={dept.floorY + 22} width="8" height="10" rx="1" fill="#16A34A" />
                    <rect x={dept.floorX + 194} y={dept.floorY + 22} width="8" height="10" rx="1" fill="#EA580C" />
                    <rect x={dept.floorX + 207} y={dept.floorY + 22} width="8" height="10" rx="1" fill="#E11D48" />
                    <rect x={dept.floorX + 220} y={dept.floorY + 22} width="8" height="10" rx="1" fill="#2563EB" />
                    {/* Row 2 */}
                    <rect x={dept.floorX + 155} y={dept.floorY + 41} width="8" height="10" rx="1" fill="#F59E0B" />
                    <rect x={dept.floorX + 168} y={dept.floorY + 41} width="8" height="10" rx="1" fill="#8B5CF6" />
                    <rect x={dept.floorX + 181} y={dept.floorY + 41} width="8" height="10" rx="1" fill="#06B6D4" />
                    <rect x={dept.floorX + 194} y={dept.floorY + 41} width="8" height="10" rx="1" fill="#F43F5E" />
                    <rect x={dept.floorX + 207} y={dept.floorY + 41} width="8" height="10" rx="1" fill="#10B981" />
                    <rect x={dept.floorX + 220} y={dept.floorY + 41} width="8" height="10" rx="1" fill="#F59E0B" />
                  </g>
                )}

                {/* 7. Checkout Counters: 6 POS Lanes + Registers + Shopping Cart */}
                {dept.id === 'z-checkout' && (
                  <g fill="#F3E8FF" stroke="#C026D3" strokeWidth="1">
                    {[0, 1, 2, 3, 4, 5].map((lane) => {
                      const lx = dept.floorX + 15 + lane * 48;
                      return (
                        <g key={`pos-lane-${lane}`}>
                          {/* Conveyor Belt Counter */}
                          <rect x={lx} y={dept.floorY + 12} width="36" height="42" rx="4" fill="#E2E8F0" stroke="#64748B" strokeWidth="1" />
                          {/* Scanner / Belt strip */}
                          <rect x={lx + 5} y={dept.floorY + 16} width="12" height="24" rx="2" fill="#334155" stroke="none" />
                          {/* POS Monitor */}
                          <rect x={lx + 20} y={dept.floorY + 18} width="12" height="14" rx="2" fill="#38BDF8" stroke="#0284C7" strokeWidth="1" />
                          {/* Cashier Stool */}
                          <circle cx={lx + 26} cy={dept.floorY + 42} r="5" fill="#C026D3" stroke="#A21CAF" strokeWidth="1" />
                        </g>
                      );
                    })}
                    {/* Cute Shopping Cart Icon on Floor */}
                    <g transform={`translate(${dept.floorX + 115}, ${dept.floorY + 58})`}>
                      <circle cx="4" cy="12" r="2" fill="#475569" />
                      <circle cx="16" cy="12" r="2" fill="#475569" />
                      <path d="M 0 0 L 3 2 L 6 9 L 18 9 L 20 2 L 4 2" fill="none" stroke="#475569" strokeWidth="1.5" />
                    </g>
                  </g>
                )}

                {/* 8. Exit Vestibule: 2 Anti-Theft EAS Security Gate Towers & Glass Doors */}
                {dept.id === 'z-exit' && (
                  <g fill="#CBD5E1" stroke="#475569" strokeWidth="1">
                    {/* EAS Tower 1 */}
                    <rect x={dept.floorX + 160} y={dept.floorY + 18} width="16" height="52" rx="3" fill="#E2E8F0" stroke="#475569" strokeWidth="1.5" />
                    <circle cx={dept.floorX + 168} cy={dept.floorY + 28} r="3" fill="#10B981" />
                    {/* EAS Tower 2 */}
                    <rect x={dept.floorX + 245} y={dept.floorY + 18} width="16" height="52" rx="3" fill="#E2E8F0" stroke="#475569" strokeWidth="1.5" />
                    <circle cx={dept.floorX + 253} cy={dept.floorY + 28} r="3" fill="#10B981" />
                    {/* Sliding Glass Doors */}
                    <line x1={dept.floorX + 180} y1={dept.floorY + 44} x2={dept.floorX + 210} y2={dept.floorY + 44} stroke="#38BDF8" strokeWidth="3" />
                    <line x1={dept.floorX + 195} y1={dept.floorY + 44} x2={dept.floorX + 225} y2={dept.floorY + 44} stroke="#0284C7" strokeWidth="3" />
                  </g>
                )}

                {/* Waypoint Circular Number Badge on Floor */}
                <g>
                  <circle
                    cx={dept.waypointX}
                    cy={dept.waypointY}
                    r="13"
                    fill={dept.badgeColor}
                    stroke="#FFFFFF"
                    strokeWidth="2.5"
                    filter="url(#svgCardShadow)"
                  />
                  <text
                    x={dept.waypointX}
                    y={dept.waypointY + 4.5}
                    fill="#FFFFFF"
                    fontSize="11"
                    fontWeight="800"
                    textAnchor="middle"
                    fontFamily="Inter, system-ui, sans-serif"
                  >
                    {dept.num}
                  </text>
                </g>
              </g>
            );
          })}

          {/* =========================================================================
              ARCHITECTURAL DECORATIVE POTTED PLANTS (Monstera / Ficus top-down)
              ========================================================================= */}
          {plantLocations.map((plant, idx) => (
            <g key={`plant-${idx}`}>
              <circle cx={plant.cx} cy={plant.cy} r={plant.r} fill="#15803D" fillOpacity="0.85" />
              <circle cx={plant.cx} cy={plant.cy} r={plant.r * 0.65} fill="#22C55E" />
              <circle cx={plant.cx} cy={plant.cy} r={plant.r * 0.3} fill="#86EFAC" />
              {/* Leaf ribs */}
              <line x1={plant.cx} y1={plant.cy - plant.r} x2={plant.cx} y2={plant.cy + plant.r} stroke="#166534" strokeWidth="1" />
              <line x1={plant.cx - plant.r} y1={plant.cy} x2={plant.cx + plant.r} y2={plant.cy} stroke="#166534" strokeWidth="1" />
            </g>
          ))}

          {/* =========================================================================
              COUNTED ZONE-TO-ZONE MOVES (drawn only from measured transitions; none are invented)
              ========================================================================= */}
          {viewMode === 'flow' &&
            moves.map((m) => {
              const x1 = m.from.waypointX;
              const y1 = m.from.waypointY;
              const x2 = m.to.waypointX;
              const y2 = m.to.waypointY;
              const mx = (x1 + x2) / 2 - (y2 - y1) * 0.18;
              const my = (y1 + y2) / 2 + (x2 - x1) * 0.18;
              const d = `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
              const width = 2 + 5 * (m.count / maxMove);
              const hot = activeCircuitId === 'all' || activeCircuitId === m.key;
              return (
                <g key={`move-${m.key}`} opacity={hot ? 1 : 0.2}>
                  <path d={d} fill="none" stroke="#60A5FA" strokeWidth={width + 3} strokeOpacity="0.35" strokeLinecap="round" filter="url(#pathGlow)" />
                  <path
                    d={d}
                    fill="none"
                    stroke="#2563EB"
                    strokeWidth={width}
                    strokeDasharray="10 12"
                    strokeLinecap="round"
                    className={isSimulatingShoppers ? 'flow-animated-line' : ''}
                    markerEnd="url(#flowArrow)"
                  />
                  <text x={mx} y={my - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1D4ED8" fontFamily="Inter, system-ui, sans-serif">
                    {m.count}
                  </text>
                </g>
              );
            })}

          {/* =========================================================================
              FLOATING DEPARTMENT CARDS: EXACT VISUAL DESIGN MATCHING USER'S IMAGE
              ========================================================================= */}
          {departments.map((dept) => {
            const isSelected = internalSelectedZone !== null && (internalSelectedZone === dept.id || dept.zoneIds.includes(internalSelectedZone));
            const isHovered = hoveredZoneId === dept.id;

            return (
              <g
                key={`card-${dept.id}`}
                onClick={() => handleSelectZone(isSelected ? null : dept.id)}
                onMouseEnter={() => setHoveredZoneId(dept.id)}
                onMouseLeave={() => setHoveredZoneId(null)}
                className="cursor-pointer"
                filter={isSelected ? 'url(#activeGlow)' : 'url(#svgCardShadow)'}
              >
                {/* Card Background */}
                <rect
                  x={dept.cardX}
                  y={dept.cardY}
                  width={dept.cardW}
                  height={dept.cardH}
                  rx="16"
                  fill="#FFFFFF"
                  stroke={isSelected ? dept.badgeColor : isHovered ? dept.badgeColor : '#E2E8F0'}
                  strokeWidth={isSelected ? '2.5' : isHovered ? '1.8' : '1.2'}
                  className="transition-colors duration-150"
                />

                {/* Left Colored Badge with Department Number */}
                <circle
                  cx={dept.cardX + 24}
                  cy={dept.cardY + 28}
                  r="13"
                  fill={dept.badgeColor}
                />
                <text
                  x={dept.cardX + 24}
                  y={dept.cardY + 32.5}
                  fill="#FFFFFF"
                  fontSize="11"
                  fontWeight="800"
                  textAnchor="middle"
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {dept.num}
                </text>

                {/* Title: Department Name */}
                <text
                  x={dept.cardX + 46}
                  y={dept.cardY + 25}
                  fill="#0F172A"
                  fontSize="12.5"
                  fontWeight="700"
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {dept.name.length > 27 ? `${dept.name.slice(0, 26)}…` : dept.name}
                </text>

                {/* Subtitle: Category Description */}
                <text
                  x={dept.cardX + 46}
                  y={dept.cardY + 39}
                  fill="#64748B"
                  fontSize="10"
                  fontWeight="500"
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {dept.category.length > 34 ? `${dept.category.slice(0, 33)}…` : dept.category}
                </text>

                {/* Metric 1: Avg Dwell Time with Clock Icon */}
                <g transform={`translate(${dept.cardX + 16}, ${dept.cardY + 54})`}>
                  {/* Clock icon SVG path */}
                  <circle cx="6" cy="6" r="5" fill="none" stroke="#64748B" strokeWidth="1.2" />
                  <path d="M 6 3.5 L 6 6 L 8 7" fill="none" stroke="#64748B" strokeWidth="1.2" strokeLinecap="round" />
                  <text
                    x="15"
                    y="9.5"
                    fill="#334155"
                    fontSize="10"
                    fontWeight="600"
                    fontFamily="Inter, system-ui, sans-serif"
                  >
                    {dept.dwell === null ? '—' : `${dept.dwell}m`} avg dwell
                  </text>
                </g>

                {/* Metric 2: Total Visitors with People Icon */}
                <g transform={`translate(${dept.cardX + 126}, ${dept.cardY + 54})`}>
                  {/* User Icon SVG path */}
                  <path
                    d="M 6 2 C 7.5 2, 8.5 3, 8.5 4.5 C 8.5 6, 7.5 7, 6 7 C 4.5 7, 3.5 6, 3.5 4.5 C 3.5 3, 4.5 2, 6 2 Z M 2 10.5 C 2 9, 3.5 8, 6 8 C 8.5 8, 10 9, 10 10.5 Z"
                    fill={dept.badgeColor}
                  />
                  <text
                    x="14"
                    y="9.5"
                    fill="#0F172A"
                    fontSize="10"
                    fontWeight="700"
                    fontFamily="Inter, system-ui, sans-serif"
                  >
                    {dept.visitors === null ? '—' : dept.visitors.toLocaleString()} visitors
                  </text>
                </g>
              </g>
            );
          })}

          {/* =========================================================================
              BOTTOM-RIGHT EXIT MARKER: EXACT MATCH TO USER'S REFERENCE IMAGE
              ========================================================================= */}
          <g transform="translate(1085, 492)" className="select-none">
            {/* Red Circle Button with Arrow */}
            <circle cx="16" cy="13" r="13" fill="#E11D48" filter="url(#svgCardShadow)" />
            <path
              d="M 12 13 L 18 13 M 15 10 L 18 13 L 15 16"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Exit Label */}
            <text
              x="36"
              y="18"
              fill="#0F172A"
              fontSize="14"
              fontWeight="800"
              fontFamily="Inter, system-ui, sans-serif"
            >
              Exit
            </text>
          </g>
        </svg>

        {/* Selected Zone Quick Inspector Strip (Bottom Overlay) */}
        {activeZone && (
          <div className="absolute bottom-3 left-4 right-4 bg-white/95 backdrop-blur-md px-4 py-2.5 rounded-xl border border-slate-200/90 shadow-lg flex flex-wrap items-center justify-between gap-3 text-xs z-30 animate-in fade-in slide-in-from-bottom-2 duration-150">
            <div className="flex items-center gap-3">
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: activeZone.badgeColor }}
              />
              <span className="font-semibold text-slate-900 text-sm">{activeZone.name}</span>
              <span className="text-slate-300">•</span>
              <span className="text-slate-600 font-medium">{activeZone.category}</span>
              <span className="text-slate-300">•</span>
              <span className="text-slate-600">
                Avg Dwell: <strong className="text-slate-900">{activeZone.dwell === null ? '—' : `${activeZone.dwell}m`}</strong>
              </span>
              <span className="text-slate-300">•</span>
              <span className="text-slate-600">
                Visitors: <strong className="text-slate-900">{activeZone.visitors === null ? '—' : activeZone.visitors.toLocaleString()}</strong>
              </span>
              <span className="text-slate-300">•</span>
              <span className="text-slate-600">
                Now: <strong className="text-slate-900">{activeZone.occupancy === null ? '—' : activeZone.occupancy}</strong>
              </span>
            </div>

            <div className="flex items-center gap-2">
              {IS_DEMO_MODE && <button
                type="button"
                onClick={() => setCameraModalId('CAM-01')}
                className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-semibold hover:bg-blue-100 transition-colors flex items-center gap-1 cursor-pointer text-xs"
              >
                <Video className="w-3 h-3" />
                <span>Live Feed</span>
              </button>}
              <button
                type="button"
                onClick={() => handleSelectZone(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                title="Dismiss inspector"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* =========================================================================
          FOOTER STATUS / HEATMAP INTENSITY LEGEND
          ========================================================================= */}
      <div className="px-5 py-2.5 bg-slate-50/80 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" />
            <span className="font-semibold text-slate-700">{currentCircuit.name}</span>
            <span className="text-slate-400">({currentCircuit.percentage} of counted moves)</span>
          </div>
          <span className="text-slate-300 hidden sm:inline">•</span>
          <div className="flex items-center gap-1 text-slate-600 hidden sm:flex">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span>Moves counted: <strong>{totalMoves}</strong></span>
          </div>
          <span className="text-slate-300 hidden sm:inline">•</span>
          <div className="flex items-center gap-1 text-slate-600 hidden sm:flex">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
            <span>Journey time &amp; conversion: <strong className="text-slate-500 font-semibold">not measured</strong></span>
          </div>
        </div>

        {viewMode === 'dwell' ? (
          <div className="flex items-center gap-2">
            <span className="text-caption font-semibold text-slate-500 flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-amber-500" />
              Dwell Scale:
            </span>
            <div className="flex items-center gap-1 text-caption font-mono">
              <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">&lt; 2m</span>
              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold">5m</span>
              <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-semibold">8m</span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">14m+</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-caption text-slate-500">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping inline-block" />
              <span>Counted by the store cameras</span>
            </span>
            <span className="text-slate-300">•</span>
            <span>Click any zone to inspect dwell &amp; live cameras</span>
          </div>
        )}
      </div>

      {/* Live Camera Preview Modal */}
      {cameraModalId && (
        <CameraPreviewModal
          isOpen
          camera={
            getMockOverviewData(selectedStoreId).cameras.find((c) => c.id === cameraModalId) ??
            getMockOverviewData(selectedStoreId).cameras[0] ??
            null
          }
          onClose={() => setCameraModalId(null)}
        />
      )}
    </div>
  );
};

// Which measured zone(s) a floor-plan slot shows. Ids from the fixtures (z-*) match directly; real stores map by zone id/name.
function zonesForSlot(slotId: string, zones: ZoneMetrics[]): ZoneMetrics[] {
  const direct = zones.filter((z) => z.zoneId === slotId);
  if (direct.length) return direct;
  const by = (re: RegExp) => zones.filter((z) => re.test(z.zoneId) || re.test(z.zoneName));
  if (slotId === 'z-entrance') return by(/entrance/i).slice(0, 1);
  if (slotId === 'z-exit') return by(/exit/i).slice(0, 1);
  if (slotId === 'z-checkout') return by(/checkout/i).slice(0, 1);
  const aisles = zones.filter((z) => /aisle/i.test(z.zoneId) || /aisle/i.test(z.zoneName)).sort((a, b) => a.zoneId.localeCompare(b.zoneId));
  const order = ['z-grocery', 'z-dairy', 'z-promo', 'z-personal', 'z-beverages'];
  const i = order.indexOf(slotId);
  if (i < 0) return [];
  return i < 4 ? aisles.slice(i, i + 1) : aisles.slice(4); // the last slot carries any remaining aisles
}

export default UnifiedShopperMap;
