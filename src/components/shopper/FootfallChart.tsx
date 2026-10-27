import { fmt } from '../../utils/display';
import React, { useState } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp,
  Download,
  Users,
  Sparkles,
} from 'lucide-react';
import type { ShopperAnalyticsData, DateRange } from '../../types/retail';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';

interface FootfallChartProps {
  data: ShopperAnalyticsData | null;
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
}

export const FootfallChart: React.FC<FootfallChartProps> = ({ data, dateRange }) => {
  const [viewMode, setViewMode] = useState<'hourly' | 'daily' | 'weekly'>('hourly');

  if (!data) return null;

  // Format 24h string into friendly 12h format
  const formatHourLabel = (timeStr: string) => {
    if (!timeStr) return '';
    const hour = parseInt(timeStr.split(':')[0], 10);
    if (isNaN(hour)) return timeStr;
    if (hour === 0) return '12 AM';
    if (hour === 12) return '12 PM';
    return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
  };

  // Custom high-contrast white executive tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const displayLabel = viewMode === 'hourly' ? formatHourLabel(label) : label;
      return (
        <div className="bg-white p-3 rounded-xl shadow-xl border border-slate-200 text-xs font-sans min-w-[160px]">
          <p className="font-semibold text-slate-800 border-b border-slate-100 pb-1 mb-2">
            {displayLabel}
          </p>
          <div className="space-y-1.5">
            {payload.map((item: any, idx: number) => (
              <div key={idx} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 font-medium" style={{ color: item.color }}>
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                  {item.name}:
                </span>
                <span className="font-mono font-semibold text-slate-900">{item.value?.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  const exportCurrentChartCSV = () => {
    let csvData: string;
    if (viewMode === 'hourly') {
      csvData =
        'Time,Entries,Exits,PreviousPeriodEntries,Occupancy\n' +
        data.footfallTrend.map((r) => `${r.time},${r.entries},${r.exits},${r.previousPeriodEntries},${r.occupancy}`).join('\n');
    } else if (viewMode === 'daily') {
      csvData =
        'Day,Entries,Exits,PreviousWeekEntries\n' +
        data.dailyAggregation.map((r) => `${r.day},${r.entries},${r.exits},${r.prevWeekEntries}`).join('\n');
    } else {
      csvData =
        'Week,Entries,Exits\n' +
        data.weeklyAggregation.map((r) => `${r.week},${r.entries},${r.exits}`).join('\n');
    }

    const encoded = encodeURI('data:text/csv;charset=utf-8,' + csvData);
    const link = document.createElement('a');
    link.setAttribute('href', encoded);
    link.setAttribute('download', `Footfall_${viewMode}_${dateRange}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalEntries = data.footfallTrend.reduce((acc, curr) => acc + curr.entries, 0);

  return (
    <Card className="flex flex-col border-slate-200">
      <CardHeader className="flex-col items-start 2xl:flex-row 2xl:items-center justify-between gap-3 pb-2 border-b border-slate-100">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold text-slate-900">
                Footfall
              </CardTitle>
              
            </div>
          </div>

          <span className="inline-flex items-center gap-1 text-caption font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
            <Sparkles className="w-3 h-3 text-blue-600" />
            {data.kpis.busiestHour ? `Peak ${data.kpis.busiestHour} (${fmt(data.kpis.busiestHourVolume)}/hr)` : 'Peak —'}
          </span>
        </div>

        {/* Aggregation Switches & Export */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <div className="inline-flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
            {(
              [
                { label: 'Hourly Flow', val: 'hourly' },
                { label: 'Daily', val: 'daily' },
                { label: 'Weekly', val: 'weekly' },
              ] as const
            ).map((vm) => (
              <button
                key={vm.val}
                onClick={() => setViewMode(vm.val)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  viewMode === vm.val
                    ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {vm.label}
              </button>
            ))}
          </div>

          <button
            onClick={exportCurrentChartCSV}
            className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition shadow-2xs cursor-pointer"
            title="Download CSV"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </CardHeader>

      <CardContent className="pt-3 pb-2 px-2 sm:px-4">
        <div className="h-[230px] w-full" style={{ height: 230, minHeight: 230 }}>
          <ResponsiveContainer width="100%" height={230}>
            {viewMode === 'hourly' ? (
              <AreaChart data={data.footfallTrend} margin={{ top: 12, right: 15, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="shopperEntriesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563EB" stopOpacity={0.22} />
                    <stop offset="70%" stopColor="#2563EB" stopOpacity={0.03} />
                    <stop offset="100%" stopColor="#2563EB" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="shopperExitsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#64748B" stopOpacity={0.15} />
                    <stop offset="70%" stopColor="#64748B" stopOpacity={0.02} />
                    <stop offset="100%" stopColor="#64748B" stopOpacity={0.0} />
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
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="exits"
                  name="Departures"
                  stroke="#94A3B8"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#shopperExitsGrad)"
                  activeDot={{ r: 4, fill: '#94A3B8' }}
                />
                <Area
                  type="monotone"
                  dataKey="plotEntries"
                  name="Arrivals"
                  stroke="#2563EB"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#shopperEntriesGrad)"
                  activeDot={{ r: 5, stroke: '#FFFFFF', strokeWidth: 2.5, fill: '#2563EB' }}
                />
              </AreaChart>
            ) : viewMode === 'daily' ? (
              <BarChart data={data.dailyAggregation} margin={{ top: 12, right: 15, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                <XAxis dataKey="day" stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={{ stroke: '#E2E8F0' }} />
                <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} width={42} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="entries" name="Daily Entries" fill="#2563EB" radius={[4, 4, 0, 0]} />
                <Bar dataKey="prevWeekEntries" name="Last Week" fill="#E2E8F0" radius={[4, 4, 0, 0]} />
              </BarChart>
            ) : (
              <BarChart data={data.weeklyAggregation} margin={{ top: 12, right: 15, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                <XAxis dataKey="week" stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={{ stroke: '#E2E8F0' }} />
                <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} width={42} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="entries" name="Weekly Footfall" fill="#2563EB" radius={[4, 4, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </CardContent>

      <div className="px-4 py-2.5 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-3">
          <span>
            Cumulative Entries:{' '}
            <strong className="text-slate-900 font-semibold">{totalEntries.toLocaleString()}</strong>
          </span>
          <span className="text-slate-300">•</span>
          <span>
            Active In-Store: <strong className="text-slate-900 font-semibold">{data.kpis.currentOccupancy ?? '—'}</strong>
          </span>
        </div>
        <span className="font-semibold text-blue-600">Exits: {fmt(data.kpis.totalExits)}</span>
      </div>
    </Card>
  );
};

export default FootfallChart;
