import { withUnit, signed } from '../../utils/display';
import { fmt } from '../../utils/display';
import React from 'react';
import {
  Users,
  Clock,
  TrendingUp,
  MapPin,
  Calendar,
  Layers,
  ArrowRight,
  Flame,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import type { ShopperReportData, ComparePeriod } from '../../types/retail';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { ReportDataTable, ColumnDef } from './ReportDataTable';

interface ShopperReportTabProps {
  shoppers: ShopperReportData;
  comparePeriod: ComparePeriod;
}

export const ShopperReportTab: React.FC<ShopperReportTabProps> = ({
  shoppers,
  comparePeriod,
}) => {
  const { hourlyTrends, dailyFootfall, zoneDistribution, peakShoppingPeriods, footfallComparisonSummary } = shoppers;

  const footfallColumns: ColumnDef<any>[] = [
    {
      key: 'date',
      header: 'Reporting Date',
      sortable: true,
      render: (row) => <span className="font-semibold text-slate-900">{row.date}</span>,
    },
    {
      key: 'entries',
      header: 'Total Entries',
      sortable: true,
      align: 'right',
      render: (row) => <span className="font-semibold text-blue-600">{row.entries.toLocaleString()}</span>,
    },
    {
      key: 'exits',
      header: 'Total Exits',
      sortable: true,
      align: 'right',
      render: (row) => <span>{row.exits.toLocaleString()}</span>,
    },
    {
      key: 'netOccupancyChange',
      header: 'Net Change',
      sortable: true,
      align: 'right',
      render: (row) => (
        <span className={row.netOccupancyChange >= 0 ? 'text-emerald-600 font-semibold' : 'text-slate-600'}>
          {row.netOccupancyChange >= 0 ? `+${row.netOccupancyChange}` : row.netOccupancyChange}
        </span>
      ),
    },
    {
      key: 'peakHour',
      header: 'Peak Window',
      sortable: true,
      render: (row) => (
        <Badge variant="slate" size="sm" className="font-mono text-caption">
          {row.peakHour} ({row.peakVolume} pax)
        </Badge>
      ),
    },
    {
      key: 'avgDwellTimeMinutes',
      header: 'Avg Dwell',
      sortable: true,
      align: 'right',
      render: (row) => <span>{withUnit(row.avgDwellTimeMinutes, ' min')}</span>,
    },
    {
      key: 'bounceRateEstimatedPct',
      header: 'Bounce Rate',
      sortable: true,
      align: 'right',
      render: (row) => (
        <span className="text-slate-500 font-mono text-xs">{withUnit(row.bounceRateEstimatedPct, '%')}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* 1. Comparison Summary Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 border-slate-200 shadow-card flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Visitors
            </span>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {footfallComparisonSummary.currentTotal.toLocaleString()}
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
            {comparePeriod !== 'none' ? (
              <span className="text-emerald-600 font-semibold">
                {signed(footfallComparisonSummary.netGrowthPct, '%')} vs comparison
              </span>
            ) : (
              'Recorded across all tripwire cameras'
            )}
          </div>
        </Card>

        <Card className="p-4 border-slate-200 shadow-card flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Previous period
            </span>
            <div className="mt-2 text-2xl font-semibold text-slate-700">
              {comparePeriod !== 'none' ? fmt(footfallComparisonSummary.previousTotal) : '—'}
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
            {comparePeriod !== 'none' ? 'Baseline comparison window' : 'No comparison active'}
          </div>
        </Card>

        <Card className="p-4 border-slate-200 shadow-card flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Busiest day
            </span>
            <div className="mt-2 text-xl font-semibold text-slate-900">
              {footfallComparisonSummary.busiestDay}
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
            Most visitors
          </div>
        </Card>

        <Card className="p-4 border-slate-200 shadow-card flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Privacy
            </span>
            <div className="mt-2 text-base font-semibold text-emerald-600 flex items-center gap-1.5">
              <Badge variant="success" size="sm" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                100% PII Free
              </Badge>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
            No faces stored
          </div>
        </Card>
      </div>

      {/* 2. Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Hourly Entries & Exits Trend */}
        <Card className="p-4 sm:p-5 border-slate-200 shadow-card">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Visitors per hour
              </h3>
              
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourlyTrends} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="entryGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="exitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis dataKey="hour" stroke="#94A3B8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderRadius: '12px',
                    border: '1px solid #E2E8F0',
                    fontSize: '12px',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                <Area
                  type="monotone"
                  dataKey="entries"
                  name="Entries (Current)"
                  stroke="#2563EB"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#entryGrad)"
                />
                <Area
                  type="monotone"
                  dataKey="exits"
                  name="Exits"
                  stroke="#10B981"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#exitGrad)"
                />
                {comparePeriod !== 'none' && (
                  <Line
                    type="monotone"
                    dataKey="prevEntries"
                    name="Prev Period Entries"
                    stroke="#94A3B8"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    dot={false}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Zone Visit Distribution */}
        <Card className="p-4 sm:p-5 border-slate-200 shadow-card">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Department traffic
              </h3>
              
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={zoneDistribution}
                layout="vertical"
                margin={{ top: 10, right: 30, left: 40, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
                <XAxis type="number" stroke="#94A3B8" fontSize={11} tickLine={false} />
                <YAxis
                  dataKey="zone"
                  type="category"
                  stroke="#64748B"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  width={110}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderRadius: '12px',
                    border: '1px solid #E2E8F0',
                    fontSize: '12px',
                  }}
                  formatter={(val: any, name: any) => [
                    name === 'Visits' ? `${val?.toLocaleString?.() ?? val} shoppers` : `${val}m`,
                    name || '',
                  ]}
                />
                <Bar dataKey="visits" name="Visits" fill="#3B82F6" radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* 3. Peak Shopping Windows Breakdown */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Peak Shopping Intervals</h3>
            
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {peakShoppingPeriods.map((slot, idx) => (
            <div key={idx} className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800">{slot.period}</span>
                <Badge
                  variant={
                    slot.congestionLevel === 'peak'
                      ? 'error'
                      : slot.congestionLevel === 'high'
                      ? 'warning'
                      : 'slate'
                  }
                  size="sm"
                  className="text-caption uppercase font-semibold"
                >
                  {slot.congestionLevel}
                </Badge>
              </div>
              <div className="mt-1 text-caption font-mono text-slate-500">{slot.hours}</div>
              <div className="mt-2 text-sm font-semibold text-blue-600">
                {slot.avgShoppersPerHour} <span className="text-caption font-normal text-slate-500">shoppers/hr</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Professional Daily Footfall Table */}
      <ReportDataTable
        data={dailyFootfall}
        columns={footfallColumns}
        title="Historical Customer Footfall Log"
        csvFilename={`Shopper_Footfall_Report_${comparePeriod}.csv`}
        defaultPageSize={10}
      />
    </div>
  );
};
