import React, { useState } from 'react';
import {
  TrendingUp,
  AlertTriangle,
  Clock,
  Zap,
  Sparkles,
  Info,
  Calendar,
  Layers,
  ArrowUpRight,
  ShieldAlert,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Legend,
} from 'recharts';
import type { QueueCongestionForecast } from '../../types/retail';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';

interface QueueCongestionForecastProps {
  forecasts: QueueCongestionForecast[];
  slaThresholdMinutes: number;
}

export const QueueCongestionForecastSection: React.FC<QueueCongestionForecastProps> = ({
  forecasts,
  slaThresholdMinutes,
}) => {
  const [selectedCounterId, setSelectedCounterId] = useState<string>('ctr-2');
  const [forecastHorizon, setForecastHorizon] = useState<'5m' | '10m' | '15m' | '30m'>('15m');

  const selectedForecast = forecasts.find((f) => f.counterId === selectedCounterId) || forecasts[0];

  if (!selectedForecast) {
    return (
      <Card className="border-slate-200 bg-white p-5 shadow-card h-full">
        <h3 className="text-sm font-semibold text-slate-900">Queue congestion forecast</h3>
        <p className="mt-2 text-xs text-slate-500">No forecast yet. Forecasts are produced once the checkout camera reports queue lengths.</p>
      </Card>
    );
  }

  // Slice forecast points based on selected horizon
  const visiblePoints = selectedForecast.forecastPoints.filter((pt) => {
    if (forecastHorizon === '5m') return pt.timestamp === 'Now' || pt.timestamp === '+5m';
    if (forecastHorizon === '10m') return pt.timestamp === 'Now' || pt.timestamp === '+5m' || pt.timestamp === '+10m';
    if (forecastHorizon === '15m') return pt.timestamp !== '+30m';
    return true; // 30m shows all
  });

  const isAtRisk = (selectedForecast.congestionRiskPct ?? 0) > 50;

  return (
    <Card className="border-slate-200 bg-white p-5 shadow-card h-full flex flex-col space-y-4">
      {/* Section Header */}
      <div className="flex flex-col items-start gap-3 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <TrendingUp className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-slate-900">
                  Queue Forecast
                </h2>
              </div>
              
            </div>
          </div>
        </div>

        {/* Counter and Horizon Selectors */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Counter Switcher */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            {forecasts.map((f) => (
              <button
                key={f.counterId}
                onClick={() => setSelectedCounterId(f.counterId)}
                className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                  selectedCounterId === f.counterId
                    ? 'bg-white text-blue-700 shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {f.counterName.split(' ').slice(0, 2).join(' ')}
              </button>
            ))}
          </div>

          {/* Horizon Switcher */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            {(['5m', '10m', '15m', '30m'] as const).map((hz) => (
              <button
                key={hz}
                onClick={() => setForecastHorizon(hz)}
                className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                  forecastHorizon === hz
                    ? 'bg-blue-600 text-white shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                +{hz}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Critical SLA Warning Callout Banner */}
      {isAtRisk && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50/70 p-3.5 text-rose-900">
          <div className="flex items-start sm:items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-rose-600 text-white shadow-xs">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div className="text-xs">
              <strong className="font-semibold">Queue will exceed the limit: </strong>
              <span>
                {selectedForecast.counterName.split(' (')[0]}: {selectedForecast.arrivalRate === null || selectedForecast.serviceRate === null ? 'arrival and service rates are not measured yet.' : `${selectedForecast.arrivalRate} arrivals/min vs ${selectedForecast.serviceRate} served/min.`}{' '}
                Expect <strong className="text-rose-700">{selectedForecast.forecastPoints[2]?.predictedLength ?? '—'} people</strong> in 10 minutes.
              </span>
            </div>
          </div>

          <Badge variant="error" size="sm" className="self-start sm:self-center text-xs whitespace-nowrap bg-rose-600 text-white">
            {selectedForecast.congestionRiskPct ?? '—'}% risk
          </Badge>
        </div>
      )}

      {/* Predictive Recharts Chart */}
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={visiblePoints} margin={{ top: 20, right: 30, left: 0, bottom: 10 }}>
            <defs>
              <linearGradient id="forecastBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#818cf8" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#818cf8" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis
              dataKey="timestamp"
              tick={{ fontSize: 12, fill: '#64748b' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#64748b' }}
              axisLine={false}
              tickLine={false}
              
              domain={[0, 'dataMax + 4']}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-lg text-xs">
                      <p className="font-semibold text-slate-900 border-b pb-1 mb-1">
                        Forecast Horizon: {label} ({data.timeLabel})
                      </p>
                      <p className="text-slate-600">
                        Now: <span className="font-semibold text-slate-800">{data.currentBaseline} people</span>
                      </p>
                      <p className="text-indigo-600 font-semibold">
                        Predicted Queue: {data.predictedLength} people
                      </p>
                      <p className="text-slate-400 text-caption">
                        95% CI Range: [{data.lowerConfidence} – {data.upperConfidence}]
                      </p>
                      {data.breachesSla && (
                        <p className="mt-1 font-semibold text-rose-600">⚠️ Breaches 4.5m Wait SLA</p>
                      )}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 10 }}
              iconType="circle"
            />

            {/* SLA Max Queue Threshold Reference Line */}
            <ReferenceLine
              y={5}
              stroke="#ef4444"
              strokeDasharray="4 4"
              label={{
                value: 'SLA Max Queue (5 people / 4.5 min)',
                fill: '#ef4444',
                fontSize: 11,
                position: 'top',
              }}
            />

            {/* Confidence Interval Upper/Lower Area */}
            <Area
              type="monotone"
              dataKey="upperConfidence"
              stroke="none"
              fill="url(#forecastBand)"
              name="Range"
            />

            {/* Baseline Current Depth */}
            <Line
              type="stepAfter"
              dataKey="currentBaseline"
              stroke="#94a3b8"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              dot={false}
              name="Now"
            />

            {/* Predicted Growth Line (Dotted Predictive Line) */}
            <Line
              type="monotone"
              dataKey="predictedLength"
              stroke="#4f46e5"
              strokeWidth={2.5}
              strokeDasharray="5 5"
              dot={{ r: 5, fill: '#4f46e5', strokeWidth: 2, stroke: '#fff' }}
              name="Predicted"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Model Parameters Footer */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-slate-100 pt-3 text-xs text-slate-600">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-blue-600" />
          <span>
            Arrivals: <strong>{selectedForecast.arrivalRate === null ? '—' : `${selectedForecast.arrivalRate} shoppers/min`}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-emerald-600" />
          <span>
            Cashier speed: <strong>{selectedForecast.serviceRate === null ? '—' : `${selectedForecast.serviceRate} shoppers/min`}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-indigo-600" />
          <span>
            Queue growth: <strong>{selectedForecast.arrivalRate === null || selectedForecast.serviceRate === null ? '—' : `+${(selectedForecast.arrivalRate - selectedForecast.serviceRate).toFixed(2)} cust/min`}</strong>
          </span>
        </div>
      </div>
    </Card>
  );
};
