import { fmt, signed } from '../../utils/display';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CreditCard,
  ArrowRight,
  Clock,
  Users,
} from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';

export const QueueSnapshotSection: React.FC = () => {
  const navigate = useNavigate();
  const { overviewData, isLoading } = useStore();

  if (isLoading || !overviewData) return null;

  const queues = overviewData.queues;

  const getCongestionBadge = (congestion: string) => {
    switch (congestion) {
      case 'high':
      case 'critical':
        return (
          <span className="text-caption font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
            Congested
          </span>
        );
      case 'moderate':
        return (
          <span className="text-caption font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            Moderate
          </span>
        );
      default:
        return (
          <span className="text-caption font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            Optimal
          </span>
        );
    }
  };

  const fastest = [...queues].filter((q) => q.status === 'open' && q.estimatedWaitMinutes !== null).sort((a, b) => (a.estimatedWaitMinutes ?? 0) - (b.estimatedWaitMinutes ?? 0))[0];

  return (
    <Card className="flex flex-col border-slate-200 [&>:last-child]:mt-auto">
      <CardHeader className="pb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            <CreditCard className="w-4 h-4 text-blue-600" />
            Checkout Queues
          </CardTitle>
          <span className="text-caption font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
            {queues.filter((q) => q.status === 'open').length} Lanes Active
          </span>
        </div>

        <button
          onClick={() => navigate('/queue-intelligence')}
          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
        >
          <span>All Queues</span>
          <ArrowRight className="w-3 h-3" />
        </button>
      </CardHeader>

      <CardContent className="p-3 pt-0">
        {/* Balanced 2x2 Grid — Eliminates gaps and squished columns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {queues.map((counter) => {
            const isHigh = counter.congestion === 'high' || counter.congestion === 'critical';
            const isModerate = counter.congestion === 'moderate';
            const slaPct = Math.min(100, Math.round(((counter.estimatedWaitMinutes ?? 0) / 4.0) * 100));

            return (
              <div
                key={counter.counterId}
                className={`p-3 rounded-xl border transition-all ${
                  isHigh
                    ? 'bg-rose-50/25 border-rose-200 ring-1 ring-rose-200/50'
                    : isModerate
                    ? 'bg-amber-50/20 border-amber-200'
                    : 'bg-slate-50/50 border-slate-200 hover:bg-white hover:shadow-2xs'
                }`}
              >
                {/* Header: ID, Name & Status */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-caption font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 shrink-0">
                      {counter.counterId}
                    </span>
                    <span className="text-xs font-semibold text-slate-900 line-clamp-2 break-words">
                      {counter.counterName.split(' (')[0]}
                    </span>
                  </div>
                  {getCongestionBadge(counter.congestion)}
                </div>

                {/* Metrics Row */}
                <div className="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-white border border-slate-100 shadow-2xs mb-2">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-caption text-slate-500 font-medium">Wait:</span>
                    <span className={`font-semibold ${isHigh ? 'text-rose-600' : isModerate ? 'text-amber-600' : 'text-emerald-700'}`}>
                      {counter.estimatedWaitMinutes === null ? '—' : `~${counter.estimatedWaitMinutes}m`}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 border-l border-slate-100 pl-2">
                    <Users className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-caption text-slate-500 font-medium">Queue:</span>
                    <span className="font-semibold text-slate-900">{counter.waitingCustomers ?? '—'}</span>
                  </div>
                </div>

                {/* Mini SLA Progress Bar */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-caption text-slate-400">
                    <span>SLA: {slaPct}%</span>
                    <span className="line-clamp-2 break-words max-w-[120px]">{counter.cashierName}</span>
                  </div>
                  <div className="w-full bg-slate-200/80 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isHigh ? 'bg-rose-500' : isModerate ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${slaPct}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

      <div className="px-4 py-2 bg-slate-50/60 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span>Target: <strong className="text-slate-800">4.0m</strong> • Avg: <strong className="text-blue-700">{fmt(overviewData.metrics.averageWaitTimeMinutes, 1)}{overviewData.metrics.averageWaitTimeMinutes === null ? '' : 'm'}</strong></span>
        <span className="text-caption font-medium text-emerald-700">{fastest ? `Fastest: ${fastest.counterName.split(' (')[0]}` : 'Fastest: —'}</span>
      </div>
    </Card>
  );
};
export default QueueSnapshotSection;
