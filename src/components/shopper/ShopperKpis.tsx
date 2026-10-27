import { fmt, signed } from '../../utils/display';
import React from 'react';
import {
  LogIn,
  LogOut,
  UserCheck,
  Timer,
  Clock,
  MapPin,
  TrendingUp,
  ArrowUpRight,
} from 'lucide-react';
import type { ShopperAnalyticsData } from '../../types/retail';
import { Card } from '../common/Card';

interface ShopperKpisProps {
  data: ShopperAnalyticsData | null;
  isLoading: boolean;
}

export const ShopperKpis: React.FC<ShopperKpisProps> = ({ data, isLoading }) => {
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white p-3.5 rounded-xl border border-slate-200 animate-pulse space-y-2">
            <div className="h-3.5 bg-slate-200 rounded w-20" />
            <div className="h-7 bg-slate-200 rounded w-16" />
          </div>
        ))}
      </div>
    );
  }

  const { kpis } = data;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3.5">
      {/* 1. Visitors */}
      <Card hoverEffect className="p-3.5 flex flex-col justify-between border-slate-200">
        <div>
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold text-slate-600">Total Entries</span>
            <div className="p-1 rounded-md bg-blue-50 text-blue-600">
              <LogIn className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight font-sans">
            {fmt(kpis.totalEntries)}
          </div>
        </div>
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-caption">
          <span className="inline-flex items-center text-emerald-600 font-semibold gap-0.5">
            <TrendingUp className="w-3 h-3" />
            {signed(kpis.entriesChangePct, '%')}
          </span>
          <span className="text-slate-400">vs prev</span>
        </div>
      </Card>

      {/* 2. Total Customer Exits */}
      <Card hoverEffect className="p-3.5 flex flex-col justify-between border-slate-200">
        <div>
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold text-slate-600">Total Exits</span>
            <div className="p-1 rounded-md bg-teal-50 text-teal-600">
              <LogOut className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight font-sans">
            {fmt(kpis.totalExits)}
          </div>
        </div>
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-caption">
          <span className="inline-flex items-center text-emerald-600 font-semibold gap-0.5">
            <TrendingUp className="w-3 h-3" />
            {signed(kpis.exitsChangePct, '%')}
          </span>
          <span className="text-slate-400">vs prev</span>
        </div>
      </Card>

      {/* 3. Current Store Occupancy */}
      <Card hoverEffect className="p-3.5 flex flex-col justify-between border-slate-200">
        <div>
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold text-slate-600">In-Store Shoppers</span>
            <div className="p-1 rounded-md bg-indigo-50 text-indigo-600">
              <UserCheck className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight font-sans">
            {kpis.currentOccupancy ?? '—'}
          </div>
        </div>
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-caption">
          <span className="inline-flex items-center text-blue-600 font-semibold gap-0.5">
            <ArrowUpRight className="w-3 h-3" />
            {signed(kpis.occupancyChangePct, '%')}
          </span>
          <span className="text-slate-400">vs 7D avg</span>
        </div>
      </Card>

      {/* 4. Average Dwell Time */}
      <Card hoverEffect className="p-3.5 flex flex-col justify-between border-slate-200">
        <div>
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold text-slate-600">Avg Dwell Time</span>
            <div className="p-1 rounded-md bg-purple-50 text-purple-600">
              <Timer className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight font-sans">
              {fmt(kpis.avgDwellTimeMinutes, 1)}
            </span>
            <span className="text-xs font-semibold text-slate-500">mins</span>
          </div>
        </div>
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-caption">
          <span className="inline-flex items-center text-blue-600 font-semibold gap-0.5">
            <ArrowUpRight className="w-3 h-3" />
            {signed(kpis.dwellChangePct, '%')}
          </span>
          <span className="text-slate-400">benchmark</span>
        </div>
      </Card>

      {/* 5. Peak Hour */}
      <Card hoverEffect className="p-3.5 flex flex-col justify-between border-slate-200">
        <div>
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold text-slate-600">Peak Window</span>
            <div className="p-1 rounded-md bg-amber-50 text-amber-600">
              <Clock className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-sm sm:text-base font-semibold text-slate-900 tracking-tight font-sans line-clamp-2 break-words">
            {kpis.busiestHour ?? '—'}
          </div>
        </div>
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-caption">
          <span className="font-semibold text-amber-700">{fmt(kpis.busiestHourVolume)}/hr</span>
        </div>
      </Card>

      {/* 6. Top Visited Store Zone */}
      <Card hoverEffect className="p-3.5 flex flex-col justify-between border-slate-200">
        <div>
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold text-slate-600">Busiest Zone</span>
            <div className="p-1 rounded-md bg-emerald-50 text-emerald-600">
              <MapPin className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-sm sm:text-base font-semibold text-slate-900 tracking-tight font-sans line-clamp-2 break-words" title={kpis.mostVisitedZone ?? undefined}>
            {kpis.mostVisitedZone ? kpis.mostVisitedZone.split('&')[0].trim() : '—'}
          </div>
        </div>
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-caption">
          <span className="font-semibold text-emerald-700">{kpis.mostVisitedZoneSharePct === null ? '—' : `${kpis.mostVisitedZoneSharePct}% trips`}</span>
        </div>
      </Card>
    </div>
  );
};

export default ShopperKpis;
