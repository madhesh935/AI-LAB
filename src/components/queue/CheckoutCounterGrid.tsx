import React from 'react';
import {
  CreditCard,
  User,
  Clock,
  TrendingUp,
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Zap,
  Power,
  RotateCw,
  Info,
} from 'lucide-react';
import type { CheckoutCounter } from '../../types/retail';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface CheckoutCounterGridProps {
  counters: CheckoutCounter[];
  selectedCounterId: string | null;
  onSelectCounter: (counter: CheckoutCounter) => void;
  onToggleStatus: (counterId: string, currentStatus: CheckoutCounter['status']) => void;
}

export const CheckoutCounterGrid: React.FC<CheckoutCounterGridProps> = ({
  counters,
  selectedCounterId,
  onSelectCounter,
  onToggleStatus,
}) => {
  const openCounters = counters.filter((c) => c.status === 'open');

  return (
    <Card className="flex flex-col border-slate-200 shadow-card h-full">
      <CardHeader className="flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-blue-600" />
              Checkout Counter Stations
            </CardTitle>
            <Badge variant="primary" size="sm" className="font-semibold text-caption">
              {counters.length} Lanes
            </Badge>
          </div>
          <CardDescription>
            Queue length and wait per counter
          </CardDescription>
        </div>

        <div className="flex items-center gap-2.5 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> &lt;3m
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-500" /> 3-4.5m
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-rose-500" /> &gt;4.5m
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-3.5 flex-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-4 gap-3">
          {counters.map((counter) => {
            const isSelected = selectedCounterId === counter.id;
            const isOpen = counter.status === 'open';
            const isStandby = counter.status === 'standby';
            const isPaused = counter.status === 'paused';
            const isCritical = counter.congestionLevel === 'critical';
            const isHigh = counter.congestionLevel === 'high';
            const isModerate = counter.congestionLevel === 'moderate';

            const slaPercent = Math.min(
              100,
              Math.round(((counter.estimatedWaitMinutes ?? 0) / Math.max(1, counter.slaThresholdMinutes)) * 100)
            );

            return (
              <div
                key={counter.id}
                onClick={() => onSelectCounter(counter)}
                className={`cursor-pointer transition-all duration-200 p-3 rounded-xl border relative flex flex-col justify-between ${
                  isSelected
                    ? 'ring-2 ring-blue-500/20 border-blue-500 bg-blue-50/40 shadow-xs'
                    : isCritical
                    ? 'bg-rose-50/15 border-rose-200 hover:border-rose-300'
                    : 'bg-white border-slate-200 hover:border-slate-300 shadow-2xs hover:shadow-xs'
                }`}
              >
                <div>
                  {/* Counter Top Row */}
                  <div className="flex items-start justify-between gap-1 mb-1.5">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-semibold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">
                          {counter.counterCode}
                        </span>
                        {counter.type === 'express' && (
                          <Badge variant="primary" size="sm" className="text-caption px-1 py-0 bg-blue-100 text-blue-800">
                            Express &lt;10
                          </Badge>
                        )}
                        {counter.type === 'self_checkout' && (
                          <Badge variant="slate" size="sm" className="text-caption px-1 py-0 bg-purple-100 text-purple-800 border-purple-200">
                            Self-Checkout
                          </Badge>
                        )}
                      </div>
                      <h4 className="mt-0.5 text-xs font-semibold text-slate-900 line-clamp-2 break-words">
                        {counter.counterName.split(' (')[0]}
                      </h4>
                    </div>

                    {/* Status Badge */}
                    <div>
                      {isOpen && (
                        <Badge
                          variant={isCritical ? 'error' : isHigh ? 'warning' : 'success'}
                          size="sm"
                          dot
                          className="text-caption"
                        >
                          {isCritical ? 'SLA Breach' : isHigh ? 'High Load' : isModerate ? 'Moderate' : 'Nominal'}
                        </Badge>
                      )}
                      {isStandby && (
                        <Badge variant="slate" size="sm" className="text-caption bg-slate-100 text-slate-600">
                          Standby
                        </Badge>
                      )}
                      {isPaused && (
                        <Badge variant="warning" size="sm" className="text-caption">
                          Paused
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Cashier Station / Attendant info */}
                  <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-1.5 border border-slate-100 mb-2">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-caption font-semibold text-white shadow-2xs">
                      {counter.cashierAvatar || 'CS'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 break-words text-xs font-semibold text-slate-800 leading-tight">
                        {counter.cashierName}
                      </p>
                      <p className="line-clamp-2 break-words text-caption text-slate-400">
                        {counter.cashierRole || 'Cashier'}
                      </p>
                    </div>
                  </div>

                  {/* Waiting Queue & Progress Meter */}
                  <div className="space-y-1 mb-2">
                    <div className="flex items-center justify-between text-caption">
                      <span className="text-slate-500 font-medium">
                        Queue: <strong className="text-slate-900">{counter.customersWaiting}</strong> in line
                      </span>
                      <span className={`font-semibold ${isCritical ? 'text-rose-600' : isModerate ? 'text-amber-600' : 'text-slate-900'}`}>
                        {counter.estimatedWaitMinutes === null || counter.estimatedWaitMinutes === undefined ? '—' : `${counter.estimatedWaitMinutes}m`} wait
                      </span>
                    </div>

                    {/* SLA Progress Bar */}
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full transition-all duration-300 ${
                          isCritical
                            ? 'bg-rose-500'
                            : isModerate
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                        style={{ width: `${slaPercent}%` }}
                      />
                    </div>

                    <div className="flex justify-between items-center text-caption text-slate-400 pt-0.5">
                      <span>Service: {counter.serviceRatePerMin}/m</span>
                      <span>SLA: {counter.slaThresholdMinutes}m</span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectCounter(counter);
                    }}
                    className="flex-1 text-caption h-6 border-slate-200 text-slate-700 hover:border-blue-300 hover:text-blue-700 cursor-pointer"
                  >
                    <span>Inspect</span>
                    <ChevronRight className="h-3 w-3 ml-0.5" />
                  </Button>

                  <Button
                    variant={isStandby ? 'primary' : 'outline'}
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleStatus(counter.id, counter.status);
                    }}
                    className={`text-caption h-6 px-2 cursor-pointer ${
                      isStandby
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : isPaused
                        ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {isStandby ? (
                      <span className="flex items-center gap-1">
                        <Power className="h-3 w-3" />
                        <span>Open</span>
                      </span>
                    ) : isPaused ? (
                      <span>Resume</span>
                    ) : (
                      <span>Pause</span>
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

      <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Active Lanes: <strong>{openCounters.length} of {counters.length}</strong></span>
        </span>
        <span className="text-caption font-semibold text-slate-700">
          SLA Limit: 4.5 mins
        </span>
      </div>
    </Card>
  );
};
