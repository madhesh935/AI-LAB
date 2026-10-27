import React from 'react';
import {
  Boxes,
  CheckCircle2,
  AlertTriangle,
  PackageX,
  Layers,
  ClipboardList,
} from 'lucide-react';
import type { SmartInventoryData } from '../../types/retail';
import { Card } from '../common/Card';

interface InventoryKpisProps {
  data: SmartInventoryData | null;
  isLoading: boolean;
}

export const InventoryKpis: React.FC<InventoryKpisProps> = ({ data, isLoading }) => {
  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white p-3.5 rounded-xl border border-slate-200 animate-pulse space-y-2">
            <div className="h-3.5 bg-slate-200 rounded w-20" />
            <div className="h-7 bg-slate-200 rounded w-16" />
          </div>
        ))}
      </div>
    );
  }

  const { kpis } = data;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3.5">
      {/* 1. Monitored Shelves */}
      <Card hoverEffect className="p-3.5 flex flex-col justify-between border-slate-200">
        <div>
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold text-slate-600">Tracked Shelves</span>
            <div className="p-1 rounded-md bg-blue-50 text-blue-600">
              <Boxes className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight font-sans">
            {kpis.monitoredShelvesCount}
          </div>
        </div>
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-caption">
          <span className="text-blue-600 font-semibold">{data.shelves.reduce((a, s) => a + s.tierCount, 0)} tiers</span>
        </div>
      </Card>

      {/* 2. Healthy Shelves */}
      <Card hoverEffect className="p-3.5 flex flex-col justify-between border-slate-200">
        <div>
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold text-slate-600">Optimal Fill</span>
            <div className="p-1 rounded-md bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-semibold text-emerald-600 tracking-tight font-sans">
            {kpis.healthyShelvesCount}
          </div>
        </div>
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-caption">
          <span className="text-emerald-700 font-semibold">Over 70% full</span>
        </div>
      </Card>

      {/* 3. Low-Stock Shelves */}
      <Card hoverEffect className="p-3.5 flex flex-col justify-between border-slate-200">
        <div>
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold text-slate-600">Low Stock</span>
            <div className="p-1 rounded-md bg-amber-50 text-amber-600">
              <AlertTriangle className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-semibold text-amber-600 tracking-tight font-sans">
            {kpis.lowStockShelvesCount}
          </div>
        </div>
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-caption">
          <span className="text-amber-700 font-semibold">Under 25% full</span>
        </div>
      </Card>

      {/* 4. Out-of-Stock Shelves */}
      <Card hoverEffect className="p-3.5 flex flex-col justify-between border-slate-200">
        <div>
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold text-slate-600">Out of Stock</span>
            <div className="p-1 rounded-md bg-rose-50 text-rose-600">
              <PackageX className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-semibold text-rose-600 tracking-tight font-sans">
            {kpis.outOfStockShelvesCount}
          </div>
        </div>
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-caption">
          <span className="text-rose-700 font-semibold">{kpis.outOfStockShelvesCount} empty {kpis.outOfStockShelvesCount === 1 ? 'rack' : 'racks'}</span>
        </div>
      </Card>

      {/* 5. Planogram Compliance */}
      <Card hoverEffect className="p-3.5 flex flex-col justify-between border-slate-200">
        <div>
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold text-slate-600">Planogram Score</span>
            <div className="p-1 rounded-md bg-indigo-50 text-indigo-600">
              <Layers className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight font-sans">
            {kpis.planogramCompliancePct === null ? '—' : `${kpis.planogramCompliancePct}%`}
          </div>
        </div>
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-caption">
          <span className="text-indigo-700 font-semibold">{kpis.planogramCompliancePct === null ? 'Not measured' : kpis.planogramCompliancePct >= 90 ? 'Good match' : kpis.planogramCompliancePct >= 75 ? 'Fair match' : 'Needs review'}</span>

        </div>
      </Card>

      {/* 6. Pending Replenishment Tasks */}
      <Card hoverEffect className="p-3.5 flex flex-col justify-between border-slate-200">
        <div>
          <div className="flex items-center justify-between text-slate-500 mb-1.5">
            <span className="text-xs font-semibold text-slate-600">Active Tasks</span>
            <div className="p-1 rounded-md bg-teal-50 text-teal-600">
              <ClipboardList className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight font-sans">
            {kpis.pendingTasksCount}
          </div>
        </div>
        <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-caption">
          <span className="text-teal-700 font-semibold">{data.tasks.filter((t) => t.status === 'in_progress').length} In Progress</span>
          <span className="text-slate-400">{data.tasks.filter((t) => t.status === 'new' || t.status === 'assigned').length} Queued</span>
        </div>
      </Card>
    </div>
  );
};

export default InventoryKpis;
