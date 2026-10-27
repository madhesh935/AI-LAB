import { signed } from '../../utils/display';
import React from 'react';
import {
  CreditCard,
  Users,
  Clock,
  AlertTriangle,
  TrendingUp,
  Activity,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
  Info,
} from 'lucide-react';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import type { QueueIntelligenceData } from '../../types/retail';

interface QueueKpisProps {
  kpis: QueueIntelligenceData['kpis'];
}

export const QueueKpis: React.FC<QueueKpisProps> = ({ kpis }) => {
  return (
    <section aria-label="Queue Performance Indicators" className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {/* 1. Active Checkout Counters */}
      <Card className="flex flex-col justify-between p-4 shadow-sm border-slate-200 hover:border-slate-300 transition-all">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Active Counters
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <CreditCard className="h-4 w-4" />
            </div>
          </div>

          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight text-slate-900">
              {kpis.activeCounters}
            </span>
            <span className="text-sm font-medium text-slate-400">/ {kpis.totalCounters} open</span>
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-slate-100">
          <span className="text-caption font-medium text-slate-500">{Math.max(0, kpis.totalCounters - kpis.activeCounters)} not open</span>
        </div>
      </Card>

      {/* 2. Customers Currently Waiting */}
      <Card className="flex flex-col justify-between p-4 shadow-sm border-slate-200 hover:border-slate-300 transition-all">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Customers Waiting
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <Users className="h-4 w-4" />
            </div>
          </div>

          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight text-slate-900">
              {kpis.waitingCustomers ?? '—'}
            </span>
            <span className="text-xs font-medium text-slate-500">shoppers in lane</span>
          </div>
        </div>

      </Card>

      {/* 3. Average Estimated Wait Time */}
      <Card className="flex flex-col justify-between p-4 shadow-sm border-slate-200 hover:border-slate-300 transition-all">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Avg Estimated Wait
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <Clock className="h-4 w-4" />
            </div>
          </div>

          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight text-slate-900">
              {kpis.avgWaitMinutes ?? '—'}
            </span>
            <span className="text-xs font-medium text-slate-500">mins / customer</span>
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <Badge variant="slate" size="sm" className="text-caption bg-slate-100 text-slate-700">
            Estimated
          </Badge>
          <span className="flex items-center gap-0.5 text-caption font-semibold text-emerald-600">
            <ArrowDownRight className="h-3 w-3" />
            {kpis.avgWaitMinutesTrend === null ? 'no comparison yet' : signed(kpis.avgWaitMinutesTrend, 'm')}
          </span>
        </div>
      </Card>

      {/* 4. Longest Active Queue */}
      <Card className="flex flex-col justify-between p-4 shadow-sm border-slate-200 hover:border-slate-300 transition-all">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Longest Active Queue
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>

          <div className="mt-2">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold tracking-tight text-rose-600">
                {kpis.longestQueueLength ?? '—'}
              </span>
              <span className="text-xs font-medium text-slate-500">
                people ({kpis.longestQueueWaitMinutes === null ? '—' : kpis.longestQueueWaitMinutes}m wait)
              </span>
            </div>
            <p className="mt-1 line-clamp-2 break-words text-xs font-medium text-slate-600">
              {kpis.longestQueueCounter ?? 'No queue right now'}
            </p>
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          {(kpis.longestQueueWaitMinutes ?? 0) > 4.5 ? (
            <Badge variant="error" size="sm" className="text-caption bg-rose-50 text-rose-700 border-rose-200">
              SLA Exceeded
            </Badge>
          ) : (
            <Badge variant="success" size="sm" className="text-caption bg-emerald-50 text-emerald-700 border-emerald-200">
              Within SLA
            </Badge>
          )}
          <span className="text-caption text-slate-400">Target &lt; 4.5m</span>
        </div>
      </Card>

      {/* 5. Checkout Throughput */}
      <Card className="flex flex-col justify-between p-4 shadow-sm border-slate-200 hover:border-slate-300 transition-all">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Checkout Throughput
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>

          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight text-slate-900">
              {kpis.hourlyThroughput ?? '—'}
            </span>
            <span className="text-xs font-medium text-slate-500">shoppers / hour</span>
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <Badge variant="success" size="sm" className="text-caption bg-emerald-50 text-emerald-700 border-emerald-200">
            {signed(kpis.throughputTrendPct, '%')}
          </Badge>
          <span className="text-caption font-medium text-slate-500">vs prev hour</span>
        </div>
      </Card>

      {/* 6. Congested Counters */}
      <Card className="flex flex-col justify-between p-4 shadow-sm border-slate-200 hover:border-slate-300 transition-all">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Congested Counters
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <Activity className="h-4 w-4" />
            </div>
          </div>

          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight text-amber-600">
              {kpis.congestedCountersCount}
            </span>
            <span className="text-xs font-medium text-slate-500">of {kpis.activeCounters} need action</span>
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          {kpis.congestedCountersCount > 0 ? (
            <Badge variant="warning" size="sm" className="text-caption bg-amber-50 text-amber-700 border-amber-200">
              Action ready
            </Badge>
          ) : (
            <Badge variant="success" size="sm" className="text-caption bg-emerald-50 text-emerald-700 border-emerald-200">
              All normal
            </Badge>
          )}
          <span className="text-caption font-medium text-slate-400">{kpis.congestedCountersCount > 0 ? 'Consider opening another lane' : ''}</span>
        </div>
      </Card>
    </section>
  );
};
