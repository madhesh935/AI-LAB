import { fmt } from '../../utils/display';
import React, { useState } from 'react';
import {
  Users,
  Clock,
  PackageX,
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Info,
  Calendar,
  Layers,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from 'recharts';
import type { ExecutiveOverviewReport, ComparePeriod } from '../../types/retail';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { PeriodComparisonBadge } from './PeriodComparisonBadge';

interface ExecutiveOverviewTabProps {
  report: ExecutiveOverviewReport;
  comparePeriod: ComparePeriod;
}

export const ExecutiveOverviewTab: React.FC<ExecutiveOverviewTabProps> = ({
  report,
  comparePeriod,
}) => {
  const { kpis, multiMetricTrends, historicalInsights } = report;
  const [expandedInsightId, setExpandedInsightId] = useState<string | null>(null);
  const [activeMetricView, setActiveMetricView] = useState<'all' | 'footfall' | 'queues' | 'inventory'>('all');

  const toggleInsight = (id: string) => {
    setExpandedInsightId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-6">
      {/* 1. Six Executive KPI Cards */}
      <section aria-label="Executive KPI Metrics" className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {/* Footfall */}
        <Card className="p-4 flex flex-col justify-between border-slate-200 shadow-sm hover:border-slate-300 transition-all">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Total Footfall
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Users className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold tracking-tight text-slate-900">
                {fmt(kpis.totalFootfall.current)}
              </span>
              <span className="text-xs font-medium text-slate-500">{kpis.totalFootfall.unit}</span>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <PeriodComparisonBadge
              percentChange={kpis.totalFootfall.percentChange}
              delta={kpis.totalFootfall.delta}
              unit={kpis.totalFootfall.unit}
              isPositiveGood={kpis.totalFootfall.isPositiveGood}
            />
            {kpis.totalFootfall.previous !== null && (
              <span className="text-caption text-slate-400">
                Prev: {kpis.totalFootfall.previous.toLocaleString()}
              </span>
            )}
          </div>
        </Card>

        {/* Average Dwell Time */}
        <Card className="p-4 flex flex-col justify-between border-slate-200 shadow-sm hover:border-slate-300 transition-all">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Avg Dwell Time
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <Clock className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold tracking-tight text-slate-900">
                {kpis.averageDwellTimeMinutes.current ?? '—'}
              </span>
              <span className="text-xs font-medium text-slate-500">{kpis.averageDwellTimeMinutes.unit}</span>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <PeriodComparisonBadge
              percentChange={kpis.averageDwellTimeMinutes.percentChange}
              delta={kpis.averageDwellTimeMinutes.delta}
              unit={kpis.averageDwellTimeMinutes.unit}
              isPositiveGood={kpis.averageDwellTimeMinutes.isPositiveGood}
            />
            {kpis.averageDwellTimeMinutes.previous !== null && (
              <span className="text-caption text-slate-400">
                Prev: {kpis.averageDwellTimeMinutes.previous}m
              </span>
            )}
          </div>
        </Card>

        {/* Low-Stock Events */}
        <Card className="p-4 flex flex-col justify-between border-slate-200 shadow-sm hover:border-slate-300 transition-all">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Low-Stock Events
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <PackageX className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold tracking-tight text-slate-900">
                {kpis.detectedLowStockEvents.current ?? '—'}
              </span>
              <span className="text-xs font-medium text-slate-500">{kpis.detectedLowStockEvents.unit}</span>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <PeriodComparisonBadge
              percentChange={kpis.detectedLowStockEvents.percentChange}
              delta={kpis.detectedLowStockEvents.delta}
              unit={kpis.detectedLowStockEvents.unit}
              isPositiveGood={kpis.detectedLowStockEvents.isPositiveGood}
            />
            {kpis.detectedLowStockEvents.previous !== null && (
              <span className="text-caption text-slate-400">
                Prev: {kpis.detectedLowStockEvents.previous}
              </span>
            )}
          </div>
        </Card>

        {/* Average Queue Wait */}
        <Card className="p-4 flex flex-col justify-between border-slate-200 shadow-sm hover:border-slate-300 transition-all">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Avg Queue Wait
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                <CreditCard className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold tracking-tight text-slate-900">
                {kpis.averageQueueWaitMinutes.current ?? '—'}
              </span>
              <span className="text-xs font-medium text-slate-500">{kpis.averageQueueWaitMinutes.unit}</span>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <PeriodComparisonBadge
              percentChange={kpis.averageQueueWaitMinutes.percentChange}
              delta={kpis.averageQueueWaitMinutes.delta}
              unit={kpis.averageQueueWaitMinutes.unit}
              isPositiveGood={kpis.averageQueueWaitMinutes.isPositiveGood}
            />
            {kpis.averageQueueWaitMinutes.previous !== null && (
              <span className="text-caption text-slate-400">
                Prev: {kpis.averageQueueWaitMinutes.previous}m
              </span>
            )}
          </div>
        </Card>

        {/* Completed Tasks */}
        <Card className="p-4 flex flex-col justify-between border-slate-200 shadow-sm hover:border-slate-300 transition-all">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Tasks Completed
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold tracking-tight text-slate-900">
                {kpis.completedTasks.current ?? '—'}
              </span>
              <span className="text-xs font-medium text-slate-500">{kpis.completedTasks.unit}</span>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <PeriodComparisonBadge
              percentChange={kpis.completedTasks.percentChange}
              delta={kpis.completedTasks.delta}
              unit={kpis.completedTasks.unit}
              isPositiveGood={kpis.completedTasks.isPositiveGood}
            />
            {kpis.completedTasks.previous !== null && (
              <span className="text-caption text-slate-400">
                Prev: {kpis.completedTasks.previous}
              </span>
            )}
          </div>
        </Card>

        {/* Critical Incidents */}
        <Card className="p-4 flex flex-col justify-between border-slate-200 shadow-sm hover:border-slate-300 transition-all">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Critical Incidents
              </span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                <AlertTriangle className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-semibold tracking-tight text-slate-900">
                {kpis.criticalIncidents.current ?? '—'}
              </span>
              <span className="text-xs font-medium text-slate-500">{kpis.criticalIncidents.unit}</span>
            </div>
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <PeriodComparisonBadge
              percentChange={kpis.criticalIncidents.percentChange}
              delta={kpis.criticalIncidents.delta}
              unit={kpis.criticalIncidents.unit}
              isPositiveGood={kpis.criticalIncidents.isPositiveGood}
            />
            {kpis.criticalIncidents.previous !== null && (
              <span className="text-caption text-slate-400">
                Prev: {kpis.criticalIncidents.previous}
              </span>
            )}
          </div>
        </Card>
      </section>

      {/* 2. Cross-Module Multi-Metric Historical Trend Chart */}
      <Card className="p-4 sm:p-5 border-slate-200 shadow-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-3.5 border-b border-slate-100">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Footfall, Wait and Stock Trend
            </h3>
            
          </div>

          <div className="flex items-center gap-1 self-start sm:self-auto bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setActiveMetricView('all')}
              className={`rounded-lg px-2.5 py-1 transition-all cursor-pointer ${
                activeMetricView === 'all' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Metrics
            </button>
            <button
              onClick={() => setActiveMetricView('footfall')}
              className={`rounded-lg px-2.5 py-1 transition-all cursor-pointer ${
                activeMetricView === 'footfall' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Footfall
            </button>
            <button
              onClick={() => setActiveMetricView('queues')}
              className={`rounded-lg px-2.5 py-1 transition-all cursor-pointer ${
                activeMetricView === 'queues' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Queue Wait
            </button>
            <button
              onClick={() => setActiveMetricView('inventory')}
              className={`rounded-lg px-2.5 py-1 transition-all cursor-pointer ${
                activeMetricView === 'inventory' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Stock Depletions
            </button>
          </div>
        </div>

        {/* Chart View */}
        <div className="mt-4 h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={multiMetricTrends} margin={{ top: 20, right: 30, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
              <XAxis dataKey="timestamp" stroke="#94A3B8" fontSize={11} tickLine={false} />
              <YAxis
                yAxisId="left"
                stroke="#94A3B8"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                label={{ value: 'Footfall (shoppers)', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#64748B' }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#94A3B8"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                label={{ value: 'Wait (min) / Events', angle: 90, position: 'insideRight', fontSize: 10, fill: '#64748B' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: '12px',
                  border: '1px solid #E2E8F0',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />

              {/* Reference SLA line at 4.5 minutes wait */}
              {(activeMetricView === 'all' || activeMetricView === 'queues') && (
                <ReferenceLine
                  yAxisId="right"
                  y={4.5}
                  stroke="#EF4444"
                  strokeDasharray="4 4"
                  label={{ value: 'SLA Max Wait (4.5m)', position: 'insideTopRight', fill: '#EF4444', fontSize: 10 }}
                />
              )}

              {/* Footfall Bar */}
              {(activeMetricView === 'all' || activeMetricView === 'footfall') && (
                <Bar
                  yAxisId="left"
                  dataKey="footfall"
                  name="Customer Footfall"
                  fill="#3B82F6"
                  radius={[4, 4, 0, 0]}
                  barSize={24}
                />
              )}

              {/* Comparison Previous Footfall (Dashed Line) */}
              {(activeMetricView === 'all' || activeMetricView === 'footfall') && comparePeriod !== 'none' && (
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="prevFootfall"
                  name="Prev Period Footfall"
                  stroke="#94A3B8"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                />
              )}

              {/* Average Queue Wait Line */}
              {(activeMetricView === 'all' || activeMetricView === 'queues') && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="avgWaitMinutes"
                  name="Avg Queue Wait (min)"
                  stroke="#F59E0B"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#F59E0B' }}
                />
              )}

              {/* Low Stock Events Line */}
              {(activeMetricView === 'all' || activeMetricView === 'inventory') && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="lowStockEvents"
                  name="Low Stock Events"
                  stroke="#EF4444"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#EF4444' }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* 4. Historical Insights with Underlying Telemetry */}
      <section aria-label="Historical Telemetry Insights" className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Key Findings
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {historicalInsights.map((insight) => {
            const isExpanded = expandedInsightId === insight.id;
            return (
              <div
                key={insight.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card hover:border-blue-200 transition-all cursor-pointer"
                onClick={() => toggleInsight(insight.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        insight.severity === 'critical'
                          ? 'error'
                          : insight.severity === 'warning'
                          ? 'warning'
                          : 'slate'
                      }
                      size="sm"
                      className="text-caption uppercase font-semibold"
                    >
                      {insight.category}
                    </Badge>
                    <span className="text-xs font-semibold text-slate-400">{insight.period}</span>
                  </div>
                  <button className="text-slate-400 hover:text-slate-600 p-0.5">
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                </div>

                <h4 className="mt-2 text-xs font-semibold text-slate-900">{insight.headline}</h4>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">{insight.detail}</p>

                {isExpanded && (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-caption space-y-1 animate-in fade-in duration-150">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-700">
                      <Info className="h-3.5 w-3.5 text-blue-600" />
                      <span>Evidence</span>
                    </div>
                    <p className="font-mono text-slate-600">{insight.metricTelemetry}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
