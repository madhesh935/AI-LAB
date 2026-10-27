import { withUnit, signed } from '../../utils/display';
import React, { useState } from 'react';
import {
  Package,
  AlertTriangle,
  Clock,
  CheckCircle2,
  TrendingDown,
  Info,
  ShieldAlert,
  Layers,
  ArrowRight,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from 'recharts';
import type { InventoryReportData, ComparePeriod } from '../../types/retail';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { ReportDataTable, ColumnDef } from './ReportDataTable';

interface InventoryReportTabProps {
  inventory: InventoryReportData;
  comparePeriod: ComparePeriod;
}

export const InventoryReportTab: React.FC<InventoryReportTabProps> = ({
  inventory,
  comparePeriod,
}) => {
  const { historyTimeline, depletedShelves, departmentShortages, replenishmentTaskStats, stockoutLog } = inventory;
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');

  const filteredStockoutLog = departmentFilter === 'all'
    ? stockoutLog
    : stockoutLog.filter((item) => item.department.toLowerCase().includes(departmentFilter.toLowerCase()));

  const stockoutColumns: ColumnDef<any>[] = [
    {
      key: 'id',
      header: 'Incident ID',
      sortable: true,
      render: (row) => <span className="font-mono font-semibold text-slate-700">{row.id}</span>,
    },
    {
      key: 'timestamp',
      header: 'Time Detected',
      sortable: true,
      render: (row) => <span className="font-mono text-slate-500">{row.timestamp}</span>,
    },
    {
      key: 'shelfId',
      header: 'Shelf ID',
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
          {row.shelfId}
        </span>
      ),
    },
    {
      key: 'product',
      header: 'Product Name',
      sortable: true,
      render: (row) => <span className="font-semibold text-slate-900">{row.product}</span>,
    },
    {
      key: 'department',
      header: 'Department',
      sortable: true,
      render: (row) => <Badge variant="slate" size="sm">{row.department}</Badge>,
    },
    {
      key: 'durationMinutes',
      header: 'Stockout Duration',
      sortable: true,
      align: 'right',
      render: (row) => (
        <span className={row.durationMinutes > 20 ? 'text-rose-600 font-semibold' : 'text-slate-700'}>
          {withUnit(row.durationMinutes, ' min')}
        </span>
      ),
    },
    {
      key: 'restockedBy',
      header: 'Resolved By Staff',
      sortable: true,
      render: (row) => <span className="text-slate-800 font-medium">{row.restockedBy}</span>,
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

  return (
    <div className="space-y-6">
      {/* 1. Important Ground Truth Disclaimer Banner */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900 flex items-start gap-3">
        <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-semibold block">Note</span>
          <p className="leading-relaxed text-amber-800">
            Shows shelf stock only, not backroom stock.
          </p>
        </div>
      </div>

      {/* 2. Top Task Performance Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 border-slate-200 shadow-card flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Restock tasks
            </span>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {replenishmentTaskStats.totalCreated}
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
            From shelf alerts
          </div>
        </Card>

        <Card className="p-4 border-slate-200 shadow-card flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Completed
            </span>
            <div className="mt-2 text-2xl font-semibold text-emerald-600">
              {replenishmentTaskStats.totalCompleted}
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
            Confirmed by camera
          </div>
        </Card>

        <Card className="p-4 border-slate-200 shadow-card flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Avg restock time
            </span>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {replenishmentTaskStats.avgResponseTimeMinutes} <span className="text-xs font-normal text-slate-500">min</span>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
            Alert to restocked
          </div>
        </Card>

        <Card className="p-4 border-slate-200 shadow-card flex flex-col justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              On-time restocks
            </span>
            <div className="mt-2 text-2xl font-semibold text-blue-600">
              {withUnit(replenishmentTaskStats.compliantWithSlaPercent, '%')}
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
            Done within 25 min
          </div>
        </Card>
      </div>

      {/* 3. Charts: Shelf Availability & Stockout Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Availability Line Chart */}
        <Card className="p-4 sm:p-5 border-slate-200 shadow-card">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Shelf availability (%)
              </h3>
              
            </div>
            <Badge variant="success" size="sm">
              Target &gt;90%
            </Badge>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={historyTimeline} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis dataKey="date" stroke="#94A3B8" fontSize={11} tickLine={false} />
                <YAxis domain={[85, 100]} stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderRadius: '12px',
                    border: '1px solid #E2E8F0',
                    fontSize: '12px',
                  }}
                  formatter={(val: any) => [`${val}%`, 'Availability']}
                />
                <ReferenceLine
                  y={90}
                  stroke="#10B981"
                  strokeDasharray="4 4"
                  label={{ value: 'Target 90%', fill: '#10B981', fontSize: 10, position: 'insideTopLeft' }}
                />
                <Line
                  type="monotone"
                  dataKey="shelfAvailabilityPercentage"
                  name="Availability %"
                  stroke="#2563EB"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#2563EB' }}
                />
                <Line
                  type="monotone"
                  dataKey="planogramCompliancePercentage"
                  name="Planogram Compliance %"
                  stroke="#8B5CF6"
                  strokeWidth={2}
                  strokeDasharray="3 3"
                  dot={false}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Low Stock & Out of Stock Incidents */}
        <Card className="p-4 sm:p-5 border-slate-200 shadow-card">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Shortages by day
              </h3>
              
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={historyTimeline} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
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
                <Bar dataKey="lowStockEventsCount" name="Low-Stock Alerts" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                <Bar dataKey="outOfStockEventsCount" name="Out-of-Stock Events" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* 4. Most Frequently Depleted Shelves */}
      <Card className="p-4 sm:p-5 border-slate-200 shadow-card">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Most-emptied shelves
            </h3>
            
          </div>
          <Badge variant="primary" size="sm">
            Top 5 Depletions
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {depletedShelves.map((shelf) => (
            <div key={shelf.shelfId} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-blue-600 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                  {shelf.shelfId}
                </span>
                <span className="text-xs font-semibold text-rose-600">
                  {shelf.depletionCount} stockouts
                </span>
              </div>
              <h4 className="text-xs font-semibold text-slate-900 line-clamp-1" title={shelf.productName}>
                {shelf.productName}
              </h4>
              <div className="text-caption text-slate-500">
                {shelf.aisle}
              </div>
              <div className="flex items-center justify-between text-caption text-slate-500 pt-1 border-t border-slate-200">
                <span>Avg Restock:</span>
                <strong className="text-slate-700">{withUnit(shelf.avgRestockMinutes, 'm')}</strong>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 5. Detailed Stockout Log Table */}
      <ReportDataTable
        data={filteredStockoutLog}
        columns={stockoutColumns}
        title="Historical Stockout & Replenishment Event Log"
        csvFilename={`Inventory_Stockout_Log_${comparePeriod}.csv`}
        defaultPageSize={10}
        toolbarExtra={
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span>Filter Dept:</span>
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 focus:outline-none"
            >
              <option value="all">All Departments</option>
              <option value="Bakery">Bakery</option>
              <option value="Dairy">Dairy</option>
              <option value="Beverages">Beverages</option>
              <option value="Snacks">Snacks</option>
            </select>
          </div>
        }
      />
    </div>
  );
};
