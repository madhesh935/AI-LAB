import React from 'react';
import {
  X,
  CreditCard,
  User,
  Clock,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Zap,
  TrendingUp,
  BarChart3,
  Power,
  RotateCcw,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Line,
} from 'recharts';
import type { CheckoutCounter } from '../../types/retail';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';

interface CounterDetailModalProps {
  counter: CheckoutCounter | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateStatus: (counterId: string, status: CheckoutCounter['status']) => void;
}

export const CounterDetailModal: React.FC<CounterDetailModalProps> = ({
  counter,
  isOpen,
  onClose,
  onUpdateStatus,
}) => {
  if (!isOpen || !counter) return null;

  const isCritical = counter.congestionLevel === 'critical';
  const isHigh = counter.congestionLevel === 'high';
  const isModerate = counter.congestionLevel === 'moderate';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50/60">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-500/20">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-900">{counter.counterName}</h2>
                <Badge variant="primary" size="sm" className="font-mono text-xs">
                  {counter.counterCode}
                </Badge>
              </div>
              <p className="text-xs text-slate-500">
                Section: <span className="font-medium text-slate-700">{counter.section}</span> • Monitored via {counter.monitoredByCamId}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="overflow-y-auto p-6 space-y-6">
          {/* Key Metrics Row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <span className="text-caption font-medium text-slate-500 block">Queue Length</span>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-xl font-semibold text-slate-900">{counter.customersWaiting}</span>
                <span className="text-xs text-slate-500">waiting</span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <span className="text-caption font-medium text-slate-500 block">Estimated Wait</span>
              <div className="mt-1 flex items-baseline gap-1">
                <span className={`text-xl font-semibold ${isCritical ? 'text-rose-600' : 'text-slate-900'}`}>
                  {counter.estimatedWaitMinutes}
                </span>
                <span className="text-xs text-slate-500">mins</span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <span className="text-caption font-medium text-slate-500 block">Scan Velocity</span>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-xl font-semibold text-emerald-600">
                  {counter.scanningSpeedItemsPerMin}
                </span>
                <span className="text-xs text-slate-500">items/min</span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <span className="text-caption font-medium text-slate-500 block">Hourly Throughput</span>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-xl font-semibold text-blue-600">{counter.hourlyThroughput}</span>
                <span className="text-xs text-slate-500">shoppers/hr</span>
              </div>
            </div>
          </div>

          {/* Cashier Performance Details */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
              Cashier
            </h3>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white shadow-sm">
                  {counter.cashierAvatar || 'CS'}
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">{counter.cashierName}</h4>
                  <p className="text-xs text-slate-500">{counter.cashierRole || 'Cashier'}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge
                  variant={isCritical ? 'error' : isHigh ? 'warning' : 'success'}
                  size="md"
                  dot
                >
                  {counter.status.toUpperCase()} • {counter.congestionLevel.toUpperCase()}
                </Badge>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-slate-100 pt-3 text-xs">
              <div>
                <span className="text-slate-400 block">Arrival Rate (λ)</span>
                <span className="font-semibold text-slate-800">{counter.arrivalRatePerMin} cust/min</span>
              </div>
              <div>
                <span className="text-slate-400 block">Service Rate (μ)</span>
                <span className="font-semibold text-slate-800">{counter.serviceRatePerMin} cust/min</span>
              </div>
              <div>
                <span className="text-slate-400 block">Idle Time Ratio</span>
                <span className="font-semibold text-slate-800">{counter.idleTimePercentage}%</span>
              </div>
            </div>
          </div>

          {/* Historical Wait Time Chart Today */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5 text-blue-600" />
                Wait time today
              </h3>
              <span className="text-caption text-slate-400">Target SLA &lt; {counter.slaThresholdMinutes}m</span>
            </div>

            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={counter.historicalWaitToday} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="waitGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} unit="m" />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, fontSize: 12, border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: any) => [`${value} mins`, 'Wait Time']}
                  />
                  <Area type="monotone" dataKey="waitMinutes" stroke="#2563eb" strokeWidth={2} fillOpacity={1} fill="url(#waitGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-slate-500">
            Last observation: <span className="font-semibold text-slate-700">{counter.lastUpdated}</span>
          </div>

          <div className="flex items-center gap-2">
            {counter.status === 'open' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onUpdateStatus(counter.id, 'paused')}
                className="border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                Pause Lane
              </Button>
            ) : counter.status === 'paused' ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onUpdateStatus(counter.id, 'open')}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                Resume Lane
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onUpdateStatus(counter.id, 'open')}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                Open Terminal
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="border-slate-300 text-slate-700 hover:bg-slate-100"
            >
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
