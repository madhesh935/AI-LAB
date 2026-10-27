import { fmt, signed, barPct, isNum } from '../../utils/display';
import React from 'react';
import {
  Users,
  UserCheck,
  Timer,
  AlertTriangle,
  CreditCard,
  Hourglass,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { Skeleton } from '../common/Skeleton';

export const KpiCardsSection: React.FC = () => {
  const { overviewData, isLoading } = useStore();

  if (isLoading || !overviewData) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white p-5 rounded-2xl border border-slate-200 space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
    );
  }

  const { metrics } = overviewData;

  // Sparkline generator helper
  const renderMiniSparkline = (data: number[], color: string = '#2563EB') => {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const width = 80;
    const height = 28;
    const points = data
      .map((val, idx) => {
        const x = (idx / (data.length - 1)) * width;
        const y = height - ((val - min) / range) * (height - 6) - 3;
        return `${x},${y}`;
      })
      .join(' ');

    return (
      <svg width={width} height={height} className="overflow-visible shrink-0">
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
      </svg>
    );
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
      {/* 1. Total Footfall */}
      <Card hoverEffect className="p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold text-slate-500 tracking-tight">Total Footfall</span>
            <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xl font-semibold text-slate-900 tracking-tight">
              {fmt(metrics.totalFootfallToday)}
            </span>
            {renderMiniSparkline(metrics.footfallHistoryMini, '#2563EB')}
          </div>
        </div>
        {isNum(metrics.footfallChangePercentage) && (
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-caption">
            <span className={`inline-flex items-center font-semibold gap-0.5 ${metrics.footfallChangePercentage < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              {metrics.footfallChangePercentage < 0 ? <ArrowDownRight className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />}
              {signed(metrics.footfallChangePercentage, '%')}
            </span>
            <span className="text-slate-400">vs before</span>
          </div>
        )}
      </Card>

      {/* 2. Current Occupancy */}
      <Card hoverEffect className="p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold text-slate-500 tracking-tight">Current Occupancy</span>
            <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
              <UserCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-900 tracking-tight">
              {metrics.currentOccupancy ?? '—'}
            </span>
            <span className="text-xs font-medium text-slate-400">/ {metrics.maxCapacity} cap</span>
          </div>
        </div>
        <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-1.5">
          <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                (metrics.occupancyPercentage ?? 0) > 85
                  ? 'bg-rose-500'
                  : (metrics.occupancyPercentage ?? 0) > 65
                  ? 'bg-amber-500'
                  : 'bg-blue-600'
              }`}
              style={{ width: `${barPct(metrics.occupancyPercentage)}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-caption text-slate-500 font-medium">
            <span>{isNum(metrics.occupancyPercentage) ? `${metrics.occupancyPercentage}% full` : 'No count yet'}</span>
            <span className={(metrics.occupancyPercentage ?? 0) > 80 ? 'text-amber-600' : 'text-emerald-600'}>
              {!isNum(metrics.occupancyPercentage) ? 'Unavailable' : metrics.occupancyBasis === 'people_in_view' ? 'In camera view' : metrics.occupancyStatus && metrics.occupancyStatus !== 'ok' ? 'Estimate' : metrics.occupancyPercentage > 80 ? 'Busy' : 'Normal'}
            </span>
          </div>
        </div>
      </Card>

      {/* 3. Avg Time in Store */}
      <Card hoverEffect className="p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold text-slate-500 tracking-tight">Avg Time in Store</span>
            <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
              <Timer className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold text-slate-900 tracking-tight">
              {fmt(metrics.averageDwellTimeMinutes, 1)}
            </span>
            <span className="text-xs font-semibold text-slate-500">mins / visit</span>
          </div>
        </div>
        <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-caption">
          <span className="inline-flex items-center text-blue-600 font-semibold gap-0.5">
            <ArrowUpRight className="w-3.5 h-3.5" />
            {signed(metrics.dwellTimeChangeMinutes, 'm')}
          </span>
          <span className="text-slate-400">vs 7-day avg</span>
        </div>
      </Card>

      {/* 4. Inventory Alerts */}
      <Card hoverEffect className="p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold text-slate-500 tracking-tight">Inventory Alerts</span>
            <div className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-900 tracking-tight">
              {metrics.lowStockShelvesCount + metrics.outOfStockShelvesCount}
            </span>
            <span className="text-xs font-semibold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded whitespace-nowrap">
              {metrics.outOfStockShelvesCount} empty
            </span>
          </div>
        </div>
        <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-caption">
          <span className="text-slate-600 font-medium whitespace-nowrap">
            {metrics.lowStockShelvesCount} low stock
          </span>
        </div>
      </Card>

      {/* 5. Active Checkout Queues */}
      <Card hoverEffect className="p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold text-slate-500 tracking-tight">Active Queues</span>
            <div className="p-1.5 rounded-lg bg-teal-50 text-teal-600">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-slate-900 tracking-tight">
              {metrics.activeCheckoutQueuesCount}
            </span>
            <span className="text-xs font-medium text-slate-500">
              ({metrics.totalCustomersInQueue} waiting)
            </span>
          </div>
        </div>
        <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-caption">
          <span className="text-slate-500">Status</span>
          <Badge
            variant={metrics.overallQueueStatus === 'high' ? 'warning' : 'success'}
            size="sm"
            className="text-caption whitespace-nowrap"
          >
            {metrics.overallQueueStatus === 'high' ? 'Busy' : 'Smooth'}
          </Badge>
        </div>
      </Card>

      {/* 6. Avg Wait Time */}
      <Card hoverEffect className="p-4 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold text-slate-500 tracking-tight">Avg Wait Time</span>
            <div className="p-1.5 rounded-lg bg-purple-50 text-purple-600">
              <Hourglass className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold text-slate-900 tracking-tight">
              {fmt(metrics.averageWaitTimeMinutes, 1)}
            </span>
            <span className="text-xs font-semibold text-slate-500">mins wait</span>
          </div>
        </div>
        <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-caption">
          <span className="inline-flex items-center text-emerald-600 font-semibold gap-0.5">
            <ArrowDownRight className="w-3.5 h-3.5" />
            {signed(metrics.waitTimeTrendMinutes, 'm')}
          </span>
          <span className="text-slate-400">vs 4.0m SLA</span>
        </div>
      </Card>
    </div>
  );
};
