import { withUnit, signed } from '../../utils/display';
import React from 'react';
import {
  Cpu,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Camera,
  Users,
  ShieldCheck,
  Activity,
  Layers,
  ArrowRight,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import type { OperationsReportData, ComparePeriod } from '../../types/retail';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { ReportDataTable, ColumnDef } from './ReportDataTable';

interface OperationsReportTabProps {
  operations: OperationsReportData;
  comparePeriod: ComparePeriod;
}

export const OperationsReportTab: React.FC<OperationsReportTabProps> = ({
  operations,
  comparePeriod,
}) => {
  const { historyTimeline, cameraUptimeList, incidentCategoryBreakdown, staffEfficiencySummary, operationsEventLog, overallOperationsSummary } = operations;

  const eventColumns: ColumnDef<any>[] = [
    {
      key: 'id',
      header: 'Event ID',
      sortable: true,
      render: (row) => <span className="font-mono font-semibold text-slate-700">{row.id}</span>,
    },
    {
      key: 'timestamp',
      header: 'Timestamp',
      sortable: true,
      render: (row) => <span className="font-mono text-slate-500">{row.timestamp}</span>,
    },
    {
      key: 'eventType',
      header: 'Event Category',
      sortable: true,
      render: (row) => <Badge variant="slate" size="sm" className="font-medium">{row.eventType}</Badge>,
    },
    {
      key: 'zone',
      header: 'Store Zone',
      sortable: true,
      render: (row) => <span className="text-slate-800 font-semibold">{row.zone}</span>,
    },
    {
      key: 'detail',
      header: 'Operational Telemetry Detail',
      sortable: false,
      render: (row) => <span className="text-slate-600 text-xs">{row.detail}</span>,
    },
    {
      key: 'responseTimeMinutes',
      header: 'Response Time',
      sortable: true,
      align: 'right',
      render: (row) => (
        <span className="font-semibold text-slate-700">{withUnit(row.responseTimeMinutes, 'm')}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (row) => (
        <Badge variant={row.status === 'resolved' ? 'success' : 'warning'} size="sm" className="capitalize">
          {row.status}
        </Badge>
      ),
    },
  ];

  const staffColumns: ColumnDef<any>[] = [
    {
      key: 'staffId',
      header: 'Staff ID',
      sortable: true,
      render: (row) => <span className="font-mono font-semibold text-slate-600">{row.staffId}</span>,
    },
    {
      key: 'name',
      header: 'Associate Name',
      sortable: true,
      render: (row) => <span className="font-semibold text-slate-900">{row.name}</span>,
    },
    {
      key: 'role',
      header: 'Primary Role',
      sortable: true,
      render: (row) => <span className="text-slate-500 text-xs">{row.role}</span>,
    },
    {
      key: 'tasksCompleted',
      header: 'Tasks Resolved',
      sortable: true,
      align: 'right',
      render: (row) => <span className="font-semibold text-blue-600">{row.tasksCompleted}</span>,
    },
    {
      key: 'avgResponseMinutes',
      header: 'Avg Response Time',
      sortable: true,
      align: 'right',
      render: (row) => <span>{withUnit(row.avgResponseMinutes, ' min')}</span>,
    },
    {
      key: 'slaCompliancePct',
      header: 'SLA Fulfillment',
      sortable: true,
      align: 'right',
      render: (row) => (
        <Badge
          variant={row.slaCompliancePct >= 95 ? 'success' : 'warning'}
          size="sm"
          className="font-semibold font-mono"
        >
          {withUnit(row.slaCompliancePct, '%')}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* 1. Operational SLA Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 border-slate-200">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Incidents
          </span>
          <div className="mt-2 text-2xl font-semibold text-slate-900">
            {overallOperationsSummary.totalIncidents}
          </div>
          <div className="mt-1 text-xs text-slate-500">Detected by cameras</div>
        </Card>

        <Card className="p-4 border-slate-200">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Alerts acknowledged
          </span>
          <div className="mt-2 text-2xl font-semibold text-blue-600">
            {withUnit(overallOperationsSummary.acknowledgmentRatePct, '%')}
          </div>
          <div className="mt-1 text-xs text-slate-500">Acknowledged by staff</div>
        </Card>

        <Card className="p-4 border-slate-200">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Resolved
          </span>
          <div className="mt-2 text-2xl font-semibold text-emerald-600">
            {withUnit(overallOperationsSummary.resolutionRatePct, '%')}
          </div>
          <div className="mt-1 text-xs text-slate-500">Closed in the same shift</div>
        </Card>

        <Card className="p-4 border-slate-200">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Avg response time
          </span>
          <div className="mt-2 text-2xl font-semibold text-slate-900">
            {overallOperationsSummary.avgResponseMinutes} <span className="text-xs font-normal text-slate-500">min</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">Alert to action</div>
        </Card>
      </div>

      {/* 2. Charts: Alert Funnel and Category Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Alerts Generated vs Resolved Trend */}
        <Card className="p-5 border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Alerts and resolutions
              </h3>
              
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={historyTimeline} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis dataKey="date" stroke="#94A3B8" fontSize={11} tickLine={false} />
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
                <Bar dataKey="alertsGenerated" name="Generated" fill="#94A3B8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="alertsAcknowledged" name="Acknowledged" fill="#60A5FA" radius={[4, 4, 0, 0]} />
                <Bar dataKey="alertsResolved" name="Resolved" fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Incident Category Breakdown */}
        <Card className="p-5 border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Incidents by type
              </h3>
              
            </div>
            <span className="text-xs font-semibold text-slate-400">Total: 115 Events</span>
          </div>

          <div className="space-y-3 pt-2">
            {incidentCategoryBreakdown.map((item, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800">{item.category}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-500">Avg {withUnit(item.avgResolutionMinutes, 'm')}</span>
                    <strong className="text-slate-900">{item.count} ({item.percentage}%)</strong>
                  </div>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-600"
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* 3. Camera Fleet Availability Grid */}
      <Card className="p-5 border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Camera Health
            </h3>
            
          </div>
          <Badge variant="success" size="sm">
            Fleet Avg: 99.3%
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {cameraUptimeList.map((cam) => {
            const isHigh = (cam.uptimePct ?? 0) >= 99.0;
            return (
              <div
                key={cam.cameraId}
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-2 hover:border-slate-300 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-slate-700 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                    {cam.cameraId}
                  </span>
                  <Badge
                    variant={isHigh ? 'success' : 'warning'}
                    size="sm"
                    className="font-mono text-caption"
                  >
                    {cam.uptimePct === null ? 'Uptime n/a' : `${cam.uptimePct}% Uptime`}
                  </Badge>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-900">{cam.name}</h4>
                  <p className="text-caption text-slate-500">{cam.zone}</p>
                </div>
                <div className="flex items-center justify-between text-caption text-slate-500 pt-1 border-t border-slate-200">
                  <span className="font-mono">{cam.streamProtocol}</span>
                  <span className={cam.offlineIncidentsCount > 0 ? 'text-amber-600 font-semibold' : 'text-slate-400'}>
                    {cam.offlineIncidentsCount} drops
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* 4. Staff Task Fulfillment & Efficiency Table */}
      <ReportDataTable
        data={staffEfficiencySummary}
        columns={staffColumns}
        title="Associate Operational Task Fulfillment & Response Times"
        csvFilename={`Staff_Fulfillment_Report_${comparePeriod}.csv`}
        defaultPageSize={5}
      />

      {/* 5. Operations Event Log Table */}
      <ReportDataTable
        data={operationsEventLog}
        columns={eventColumns}
        title="Historical Operations Event & Incident Log"
        csvFilename={`Operations_Event_Log_${comparePeriod}.csv`}
        defaultPageSize={10}
      />
    </div>
  );
};
