import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Users, Clock, Package, Store, ArrowRight, Camera, ClipboardList } from 'lucide-react';
import type { Store as StoreType, Alert, StoreOverviewData } from '../../types/retail';
import { fmt, isNum, signed } from '../../utils/display';
import { timeAgo } from '../../services/api/adapters/common';

interface CopilotRightPanelProps {
  isOpen?: boolean;
  selectedStore: StoreType;
  /** The SAME overview payload the dashboards render - no Copilot-only numbers. */
  overview: StoreOverviewData | null;
  alerts: Alert[];
  /** 'Live' | 'Stale' | 'Offline' | 'Fixtures' ... */
  feedLabel: string;
  isDemo: boolean;
  onAcknowledgeAlert?: (alertId: string) => void;
  onSendQuery?: (q: string) => void;
}

export const CopilotRightPanel: React.FC<CopilotRightPanelProps> = ({ isOpen = true, selectedStore, overview, alerts, feedLabel, isDemo, onAcknowledgeAlert, onSendQuery }) => {
  const navigate = useNavigate();
  if (!isOpen) return null;

  const m = overview?.metrics;
  const occupancy = m?.currentOccupancy ?? null;
  const maxCapacity = m?.maxCapacity ?? selectedStore.maxCapacity;
  const occupancyPct = isNum(occupancy) && maxCapacity > 0 ? Math.min(100, Math.round((occupancy / maxCapacity) * 100)) : 0;
  const open = alerts.filter((a) => a.status === 'active');
  const shown = [...open].sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1)).slice(0, 4);
  const criticalCount = open.filter((a) => a.severity === 'critical').length;
  const live = feedLabel === 'Live';

  return (
    <aside
      className="w-full xl:w-80 shrink-0 rounded-2xl border border-slate-200 bg-white shadow-sm flex flex-col justify-between xl:h-full select-none xl:overflow-y-auto"
      aria-label="Live Store Telemetry"
    >
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-900 tracking-tight">Live Store Telemetry</h2>
          </div>
          <span className={`flex items-center gap-1.5 text-xs font-semibold ${live ? 'text-emerald-600' : 'text-amber-600'}`} data-testid="telemetry-feed">
            <span className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
            {isDemo ? 'Demo data' : feedLabel}
          </span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-7 w-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                <Store className="h-4 w-4" />
              </div>
              <span className="font-semibold text-xs text-slate-900 line-clamp-2 break-words">{selectedStore.name || '—'}</span>
            </div>
            <span className="text-caption font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full shrink-0">{selectedStore.code || '—'}</span>
          </div>
          <div className="text-caption text-slate-500 pl-9.5 line-clamp-2 break-words">{selectedStore.address || ''}</div>
        </div>

        <div className="grid grid-cols-2 gap-2.5" data-testid="telemetry-grid">
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
            <div className="flex items-center justify-between text-caption text-slate-500 font-medium">
              <span>Inside Store{m?.occupancyStatus && m.occupancyStatus !== 'ok' ? ' (estimate)' : ''}</span>
              <Users className="h-3.5 w-3.5 text-blue-600" />
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-xl font-semibold text-slate-900" data-testid="tel-occupancy">{fmt(occupancy)}</span>
              <span className="text-xs text-slate-400 font-normal">/ {maxCapacity || '—'}</span>
            </div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-blue-600" style={{ width: `${occupancyPct}%` }} />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
            <div className="flex items-center justify-between text-caption text-slate-500 font-medium">
              <span>Footfall Today</span>
              <Activity className="h-3.5 w-3.5 text-blue-600" />
            </div>
            <div className="mt-1 text-xl font-semibold text-slate-900" data-testid="tel-footfall">{fmt(m?.totalFootfallToday)}</div>
            <div className="mt-1 text-caption text-slate-500 font-semibold">{isNum(m?.footfallChangePercentage) ? `${signed(m?.footfallChangePercentage, '%')} vs before` : 'no comparison yet'}</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
            <div className="flex items-center justify-between text-caption text-slate-500 font-medium">
              <span>Low-Stock</span>
              <Package className="h-3.5 w-3.5 text-amber-500" />
            </div>
            <div className="mt-1 text-xl font-semibold text-amber-500" data-testid="tel-lowstock">
              {m ? m.lowStockShelvesCount + m.outOfStockShelvesCount : '—'} shelves
            </div>
            <button
              onClick={() => (onSendQuery ? onSendQuery('Which shelves require restocking?') : navigate('/smart-inventory'))}
              className="mt-1 text-caption text-blue-600 font-semibold hover:underline flex items-center gap-0.5 cursor-pointer"
            >
              <span>Inspect</span>
              <ArrowRight className="h-2.5 w-2.5" />
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
            <div className="flex items-center justify-between text-caption text-slate-500 font-medium">
              <span>Avg Wait Time</span>
              <Clock className="h-3.5 w-3.5 text-rose-500" />
            </div>
            <div className="mt-1 text-xl font-semibold text-slate-900" data-testid="tel-wait">
              {fmt(m?.averageWaitTimeMinutes, 1)} <span className="text-xs font-normal text-slate-500">min</span>
            </div>
            <div className="mt-1 text-caption text-slate-500 font-semibold">{m ? `${m.activeCheckoutQueuesCount} queues, ${m.totalCustomersInQueue} waiting` : ''}</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
            <div className="flex items-center justify-between text-caption text-slate-500 font-medium">
              <span>Pending Tasks</span>
              <ClipboardList className="h-3.5 w-3.5 text-indigo-500" />
            </div>
            <div className="mt-1 text-xl font-semibold text-slate-900" data-testid="tel-tasks">{fmt(m?.openTasks)}</div>
            <button onClick={() => navigate('/staff-management')} className="mt-1 text-caption text-blue-600 font-semibold hover:underline cursor-pointer">Open tasks →</button>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs">
            <div className="flex items-center justify-between text-caption text-slate-500 font-medium">
              <span>Cameras</span>
              <Camera className="h-3.5 w-3.5 text-slate-500" />
            </div>
            <div className="mt-1 text-xl font-semibold text-slate-900" data-testid="tel-cameras">
              {m ? `${m.camerasOnline ?? 0}/${m.camerasTotal ?? 0}` : '—'} <span className="text-xs font-normal text-slate-500">live</span>
            </div>
            <div className="mt-1 text-caption text-slate-500 font-semibold">{overview?.lastUpdatedAt ? `updated ${timeAgo(overview.lastUpdatedAt)}` : ''}</div>
          </div>
        </div>

        <div className="space-y-2.5 pt-1">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-900" data-testid="tel-alert-count">Critical Alerts ({criticalCount})</h3>
            <button onClick={() => navigate('/ai-insights')} className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-0.5 cursor-pointer">
              <span>View All</span>
              <span>→</span>
            </button>
          </div>

          <div className="space-y-2">
            {shown.length === 0 && <p className="text-caption text-slate-500">No active alerts.</p>}
            {shown.map((alr) => (
              <div key={alr.id} className={`rounded-lg border px-3 py-2 space-y-1 bg-white ${alr.severity === 'critical' ? 'border-rose-200' : 'border-amber-200'}`}>
                <div className="flex items-start justify-between gap-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`h-2 w-2 rounded-full shrink-0 ${alr.severity === 'critical' ? 'bg-rose-500' : 'bg-amber-500'}`} />
                    <span className="text-xs font-semibold text-slate-900 leading-tight line-clamp-2 break-words">{alr.title}</span>
                  </div>
                  <span className="text-caption text-slate-400 shrink-0 font-normal">{alr.createdAt ? timeAgo(alr.createdAt) : alr.timestamp}</span>
                </div>
                {alr.description && <p className="text-caption text-slate-600 leading-relaxed line-clamp-2">{alr.description}</p>}
                <div className="flex items-center justify-between">
                  <span className="bg-blue-50 text-blue-700 text-caption font-medium px-2 py-px rounded-md border border-blue-100">{alr.category.replace(/_/g, ' ')}</span>
                  <button
                    onClick={() => onAcknowledgeAlert && onAcknowledgeAlert(alr.id)}
                    className="border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 text-caption font-medium px-2 py-px rounded-md transition-colors cursor-pointer"
                  >
                    Acknowledge
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
};
