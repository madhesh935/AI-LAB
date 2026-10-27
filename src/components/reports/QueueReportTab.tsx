import { withUnit, signed } from '../../utils/display';
import { fmt } from '../../utils/display';
import React from 'react';
import {
  CreditCard,
  Clock,
  AlertTriangle,
  Users,
  Activity,
  Layers,
  CheckCircle2,
  Info,
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
import type { QueueReportData, ComparePeriod } from '../../types/retail';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { ReportDataTable, ColumnDef } from './ReportDataTable';

interface QueueReportTabProps {
  queues: QueueReportData;
  comparePeriod: ComparePeriod;
}

export const QueueReportTab: React.FC<QueueReportTabProps> = ({
  queues,
  comparePeriod,
}) => {
  const { historyTimeline, hourlyQueueTrends, counterComparisons, queueAlertLog, overallThroughputSummary } = queues;

  const queueAlertColumns: ColumnDef<any>[] = [
    {
      key: 'id',
      header: 'Alert ID',
      sortable: true,
      render: (row) => <span className="font-mono font-semibold text-slate-700">{row.id}</span>,
    },
    {
      key: 'timestamp',
      header: 'Trigger Timestamp',
      sortable: true,
      render: (row) => <span className="font-mono text-slate-500">{row.timestamp}</span>,
    },
    {
      key: 'counterId',
      header: 'Checkout Counter',
      sortable: true,
      render: (row) => (
        <span className="font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded text-xs">
          {row.counterId}
        </span>
      ),
    },
    {
      key: 'triggerWaitMinutes',
      header: 'Trigger Wait (min)',
      sortable: true,
      align: 'right',
      render: (row) => (
        <span className="font-semibold text-rose-600">{withUnit(row.triggerWaitMinutes, ' min')}</span>
      ),
    },
    {
      key: 'resolutionMinutes',
      header: 'Resolution Latency',
      sortable: true,
      align: 'right',
      render: (row) => <span>{withUnit(row.resolutionMinutes, ' min')}</span>,
    },
    {
      key: 'actionTaken',
      header: 'Staff Intervention Action Taken',
      sortable: false,
      render: (row) => <span className="text-slate-700 text-xs">{row.actionTaken}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (row) => (
        <Badge variant={row.status === 'resolved' ? 'success' : 'error'} size="sm" className="capitalize">
          {row.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* 1. Computer Vision Queue Estimation Disclosure */}
      <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 text-xs text-blue-900 flex items-start gap-3">
        <Info className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-semibold block">How wait times are measured</span>
          <p className="leading-relaxed text-blue-800">
            Wait = people in queue ÷ service speed, from camera counts.
          </p>
        </div>
      </div>

      {/* 2. Throughput & SLA Performance Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 border-slate-200">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Customers served
          </span>
          <div className="mt-2 text-2xl font-semibold text-slate-900">
            {fmt(overallThroughputSummary.totalServed)}
          </div>
          <div className="mt-1 text-xs text-slate-500">Completed POS transactions</div>
        </Card>

        <Card className="p-4 border-slate-200">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Checkout speed
          </span>
          <div className="mt-2 text-2xl font-semibold text-blue-600">
            {overallThroughputSummary.avgThroughputPerMin} <span className="text-xs font-normal text-slate-500">shoppers/min</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">Store-wide aggregate rate</div>
        </Card>

        <Card className="p-4 border-slate-200">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Within wait limit
          </span>
          <div className="mt-2 text-2xl font-semibold text-emerald-600">
            {withUnit(overallThroughputSummary.slaComplianceRate, '%')}
          </div>
          <div className="mt-1 text-xs text-slate-500">Waits under 4.5 min</div>
        </Card>

        <Card className="p-4 border-slate-200">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Queue alerts
          </span>
          <div className="mt-2 text-2xl font-semibold text-amber-600">
            {queueAlertLog.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">Resolved in avg 2.8 mins</div>
        </Card>
      </div>

      {/* 3. Hourly Queue Wait Time & Throughput Chart */}
      <Card className="p-5 border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Wait time and checkout speed
            </h3>
            
          </div>
          <Badge variant="error" size="sm">
            SLA Threshold: 4.5m
          </Badge>
        </div>

        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={hourlyQueueTrends} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
              <XAxis dataKey="hour" stroke="#94A3B8" fontSize={11} tickLine={false} />
              <YAxis
                yAxisId="wait"
                stroke="#94A3B8"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                label={{ value: 'Wait (min)', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#64748B' }}
              />
              <YAxis
                yAxisId="tp"
                orientation="right"
                stroke="#94A3B8"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                label={{ value: 'Shoppers/min', angle: 90, position: 'insideRight', fontSize: 10, fill: '#64748B' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: '12px',
                  border: '1px solid #E2E8F0',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />

              <ReferenceLine
                yAxisId="wait"
                y={4.5}
                stroke="#EF4444"
                strokeDasharray="4 4"
                label={{ value: 'SLA Max Wait 4.5m', fill: '#EF4444', fontSize: 10, position: 'insideTopLeft' }}
              />

              <Bar
                yAxisId="tp"
                dataKey="throughputPerMinute"
                name="Throughput Rate (shoppers/min)"
                fill="#93C5FD"
                radius={[4, 4, 0, 0]}
                barSize={20}
              />
              <Line
                yAxisId="wait"
                type="monotone"
                dataKey="avgWaitMinutes"
                name="Avg Wait Time (Current)"
                stroke="#F59E0B"
                strokeWidth={2.5}
                dot={{ r: 3, fill: '#F59E0B' }}
              />
              {comparePeriod !== 'none' && (
                <Line
                  yAxisId="wait"
                  type="monotone"
                  dataKey="prevAvgWaitMinutes"
                  name="Prev Period Wait"
                  stroke="#94A3B8"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* 4. Counter-Level Comparisons */}
      <Card className="p-5 border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Counter comparison
            </h3>
            
          </div>
          <span className="text-xs font-semibold text-slate-500">5 Registered POS Counters</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {counterComparisons.map((cnt) => (
            <div key={cnt.counterId} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-slate-900">{cnt.counterName.split(' ')[0]} {cnt.counterName.split(' ')[1]}</span>
                <Badge variant={cnt.type === 'express' ? 'primary' : cnt.type === 'self_checkout' ? 'primary' : 'slate'} size="sm" className="text-caption">
                  {cnt.type.replace('_', ' ')}
                </Badge>
              </div>

              <div className="space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Avg Wait:</span>
                  <strong className={(cnt.avgWaitMinutes ?? 0) > 4.0 ? 'text-rose-600' : 'text-slate-800'}>
                    {cnt.avgWaitMinutes === null ? '—' : `${cnt.avgWaitMinutes}m`}
                  </strong>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Volume:</span>
                  <span className="font-mono text-slate-700">{cnt.customersServed} pax</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Utilization:</span>
                  <span className="font-semibold text-blue-600">{withUnit(cnt.utilizationPct, '%')}</span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-slate-200">
                  <span className="text-slate-500">Alerts:</span>
                  <span className={cnt.congestionAlerts > 2 ? 'text-amber-600 font-semibold' : 'text-slate-600'}>
                    {cnt.congestionAlerts}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 5. Queue Alert Incident Log */}
      <ReportDataTable
        data={queueAlertLog}
        columns={queueAlertColumns}
        title="Historical Queue Congestion Alerts Log"
        csvFilename={`Queue_Alerts_Report_${comparePeriod}.csv`}
        defaultPageSize={10}
      />
    </div>
  );
};
