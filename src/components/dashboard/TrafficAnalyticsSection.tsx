import { fmt, signed } from '../../utils/display';
import React, { useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Users,
  TrendingUp,
  MapPin,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Sparkles,
} from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';

export const TrafficAnalyticsSection: React.FC = () => {
  const { overviewData, isLoading } = useStore();
  const [metricView, setMetricView] = useState<'entries' | 'occupancy'>('entries');
  const [showBaseline, setShowBaseline] = useState<boolean>(true);

  if (isLoading || !overviewData) return null;

  const { hourlyTraffic, peakHour, peakHourEntries, zones, averageVisitDurationMinutes } =
    overviewData.analytics;

  const busiestZone = zones
    .filter((z) => z.currentOccupancy !== null && z.capacityLimit > 0)
    .map((z) => ({ name: z.name, pct: Math.round(((z.currentOccupancy ?? 0) / z.capacityLimit) * 100) }))
    .sort((a, b) => b.pct - a.pct)[0];

  // Calculate cumulative daily footfall
  const totalEntriesToday = hourlyTraffic.reduce((acc, curr) => acc + curr.entries, 0);

  // Format 24h string (e.g. '08:00', '13:00') into friendly executive format ('8 AM', '1 PM')
  const formatHourLabel = (timeStr: string) => {
    if (!timeStr) return '';
    const hour = parseInt(timeStr.split(':')[0], 10);
    if (isNaN(hour)) return timeStr;
    if (hour === 0) return '12 AM';
    if (hour === 12) return '12 PM';
    return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
  };

  // High-contrast, clean executive tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const entry = payload[0]?.payload;
      const primaryVal = metricView === 'entries' ? entry?.entries : entry?.occupancy;
      const prevVal = entry?.previousPeriodEntries || 0;
      const diff = primaryVal - prevVal;
      const diffPct = prevVal > 0 ? Math.round((diff / prevVal) * 100) : 0;
      const isPeak = entry?.entries >= 400;

      return (
        <div className="bg-white px-3.5 py-2.5 rounded-xl shadow-xl border border-slate-200 text-xs min-w-[170px]">
          <div className="flex items-center justify-between border-b border-slate-100 pb-1.5 mb-2">
            <span className="font-semibold text-slate-800">{formatHourLabel(label)}</span>
            {isPeak && (
              <span className="text-caption font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                Peak Hour
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-blue-600 font-medium">
                <span className="w-2 h-2 rounded-full bg-blue-600" />
                {metricView === 'entries' ? 'Shopper Inflow:' : 'In-Store Shoppers:'}
              </span>
              <span className="font-mono font-semibold text-slate-900">{primaryVal}</span>
            </div>

            {showBaseline && metricView === 'entries' && (
              <div className="flex items-center justify-between gap-3 text-slate-400 text-caption pt-1 border-t border-slate-100">
                <span>Yesterday:</span>
                <span className="font-mono text-slate-600">
                  {prevVal} (
                  <span className={diff >= 0 ? 'text-emerald-600 font-semibold' : 'text-rose-500 font-semibold'}>
                    {diff >= 0 ? `+${diffPct}%` : `${diffPct}%`}
                  </span>
                  )
                </span>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  const getTrendIcon = (trend: string) => {
    if (trend === 'up') return <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />;
    if (trend === 'down') return <ArrowDownRight className="w-3.5 h-3.5 text-blue-600" />;
    return <Minus className="w-3.5 h-3.5 text-slate-400" />;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* 2/3 Width: Enhanced Executive Footfall Curve */}
      <Card className="lg:col-span-3 flex flex-col border-slate-200 [&>:last-child]:mt-auto">
        <CardHeader className="flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-100">
          {/* Title & Key Highlights */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold text-slate-900">
                  Customer Traffic Trend
                </CardTitle>
                
              </div>
            </div>

            <div className="flex items-center gap-2 ml-1">
              <span className="inline-flex items-center gap-1 text-caption font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
                <Sparkles className="w-3 h-3 text-blue-600" />
                Peak: {peakHour ? `${peakHour} (${peakHourEntries ?? 0}/hr)` : '—'}
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 text-caption font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                <TrendingUp className="w-3 h-3 text-emerald-600" />
                {signed(overviewData.metrics.footfallChangePercentage, '%')} vs before
              </span>
            </div>
          </div>

          {/* View Mode Segmented Controls */}
          <div className="flex items-center gap-1.5 self-end sm:self-auto">
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
              <button
                type="button"
                onClick={() => setMetricView('entries')}
                className={`px-2.5 py-1 font-semibold rounded-md transition-all cursor-pointer ${
                  metricView === 'entries'
                    ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Hourly
              </button>
              <button
                type="button"
                onClick={() => setMetricView('occupancy')}
                className={`px-2.5 py-1 font-semibold rounded-md transition-all cursor-pointer ${
                  metricView === 'occupancy'
                    ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Density
              </button>
            </div>

            {metricView === 'entries' && (
              <button
                type="button"
                onClick={() => setShowBaseline(!showBaseline)}
                title="Toggle yesterday comparison baseline"
                className={`text-caption font-medium px-2 py-1 rounded-lg border transition-all cursor-pointer ${
                  showBaseline
                    ? 'bg-blue-50 text-blue-700 border-blue-200 font-semibold'
                    : 'bg-white text-slate-400 border-slate-200 hover:text-slate-600'
                }`}
              >
                Baseline
              </button>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-3 pb-2 px-2 sm:px-4">
          <div className="w-full h-[220px] min-h-[220px]" style={{ height: 220, minHeight: 220 }}>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart
                data={hourlyTraffic}
                margin={{ top: 12, right: 15, left: 0, bottom: 0 }}
              >
                <defs>
                  {/* Subtle Glowing Blue Gradient */}
                  <linearGradient id="cleanFootfallGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity={0.22} />
                    <stop offset="70%" stopColor="#2563EB" stopOpacity={0.03} />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity={0.0} />
                  </linearGradient>

                  {/* Violet Gradient for Occupancy */}
                  <linearGradient id="cleanOccupancyGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4F46E5" stopOpacity={0.24} />
                    <stop offset="70%" stopColor="#4F46E5" stopOpacity={0.04} />
                    <stop offset="100%" stopColor="#4F46E5" stopOpacity={0.0} />
                  </linearGradient>
                </defs>

                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />

                <XAxis
                  dataKey="time"
                  stroke="#94A3B8"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#E2E8F0' }}
                  tickFormatter={formatHourLabel}
                  interval={1}
                />

                <YAxis
                  stroke="#94A3B8"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={38}
                  domain={[0, 500]}
                  ticks={[0, 150, 300, 450]}
                />

                <Tooltip content={<CustomTooltip />} />

                {/* Subtle Baseline for Yesterday Comparison */}
                {showBaseline && metricView === 'entries' && (
                  <Area
                    type="monotone"
                    dataKey="previousPeriodEntries"
                    name="Yesterday Baseline"
                    stroke="#CBD5E1"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    fill="none"
                    dot={false}
                    activeDot={false}
                  />
                )}

                {/* Primary Smooth Curve */}
                <Area
                  type="monotone"
                  dataKey={metricView === 'entries' ? 'plotEntries' : 'occupancy'}
                  name={metricView === 'entries' ? 'Shopper Entries' : 'Store Occupancy'}
                  stroke={metricView === 'entries' ? '#2563EB' : '#4F46E5'}
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill={
                    metricView === 'entries'
                      ? 'url(#cleanFootfallGradient)'
                      : 'url(#cleanOccupancyGradient)'
                  }
                  activeDot={{
                    r: 5,
                    stroke: '#FFFFFF',
                    strokeWidth: 2.5,
                    fill: metricView === 'entries' ? '#2563EB' : '#4F46E5',
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>

        {/* Clean, Non-Messy Chart Footer */}
        <div className="px-4 py-2.5 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-3">
            <span>
              Cumulative Today:{' '}
              <strong className="text-slate-900 font-semibold">{totalEntriesToday.toLocaleString()}</strong>
            </span>
            <span className="hidden sm:inline text-slate-300">•</span>
            <span className="hidden sm:inline">
              Avg Dwell: <strong className="text-slate-800">{averageVisitDurationMinutes === null ? '—' : `${averageVisitDurationMinutes} mins`}</strong>
            </span>
          </div>
          <span className="font-semibold text-blue-600">Peak Period: {peakHour ? formatHourLabel(peakHour) : '—'}</span>
        </div>
      </Card>

    </div>
  );
};

export default TrafficAnalyticsSection;
