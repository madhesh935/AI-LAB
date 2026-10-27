import React, { useState } from 'react';
import {
  Sparkles,
  Check,
  CheckCircle2,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import type { Alert, AlertSeverity } from '../../types/retail';
import { Card, CardHeader, CardTitle, CardContent } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

export const AiActionCenterSection: React.FC = () => {
  const { alerts, acknowledgeAlert, resolveAlert, isLoading } = useStore();
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'critical' | 'warning' | 'active'>('all');

  if (isLoading) return null;

  const filteredAlerts = alerts.filter((alert) => {
    if (filterSeverity === 'active') return alert.status === 'active';
    if (filterSeverity === 'critical') return alert.severity === 'critical';
    if (filterSeverity === 'warning') return alert.severity === 'warning';
    return true;
  });

  const getSeverityBadge = (severity: AlertSeverity) => {
    switch (severity) {
      case 'critical':
        return (
          <span className="inline-flex items-center gap-1 text-caption font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            Critical
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center gap-1 text-caption font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Warning
          </span>
        );
      case 'info':
        return (
          <span className="inline-flex items-center gap-1 text-caption font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
            Advisory
          </span>
        );
    }
  };

  return (
    <Card className="flex flex-col border-slate-200 [&>:last-child]:mt-auto">
      <CardHeader className="flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-blue-600" />
            Action Center
          </CardTitle>
          <span className="text-caption font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
            {alerts.filter((a) => a.status === 'active').length} Active
          </span>
        </div>

        {/* Severity Filter Tabs */}
        <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
          {(
            [
              { label: 'All', val: 'all' },
              { label: 'Active', val: 'active' },
              { label: 'Critical', val: 'critical' },
              { label: 'Warnings', val: 'warning' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.val}
              onClick={() => setFilterSeverity(tab.val)}
              className={`px-2.5 py-1 font-semibold rounded-md transition-colors ${
                filterSeverity === tab.val
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-2.5 pt-1">
        {filteredAlerts.length === 0 ? (
          <div className="p-8 text-center text-slate-400 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
            <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500 mb-2" />
            <p className="text-xs font-semibold text-slate-700">No alerts</p>
            <p className="text-caption text-slate-400 mt-0.5">Everything is within normal limits.</p>
          </div>
        ) : (
          filteredAlerts.map((alert) => {
            const isResolved = alert.status === 'resolved';
            const isAcknowledged = alert.status === 'acknowledged';

            return (
              <div
                key={alert.id}
                className={`p-3 rounded-xl border transition-all ${
                  isResolved
                    ? 'bg-slate-50/50 border-slate-200 opacity-60'
                    : alert.severity === 'critical'
                    ? 'bg-rose-50/20 border-rose-200'
                    : alert.severity === 'warning'
                    ? 'bg-amber-50/15 border-amber-200'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {getSeverityBadge(alert.severity)}
                      <span className="text-caption font-semibold text-slate-700">{alert.zone}</span>
                      <span className="text-slate-300">&bull;</span>
                      <span className="text-caption text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {alert.timestamp}
                      </span>
                      {alert.cameraId && (
                        <span className="font-mono text-caption text-blue-700 font-semibold bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
                          {alert.cameraId}
                        </span>
                      )}
                    </div>

                    <h4 className={`text-xs font-semibold leading-tight ${isResolved ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                      {alert.title}
                    </h4>

                    <p className="text-caption text-slate-600 leading-normal">
                      <strong className="text-slate-700">Action:</strong> {alert.recommendedAction}
                    </p>
                  </div>

                  {/* Action Controls */}
                  <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                    {!isResolved && !isAcknowledged && (
                      <button
                        onClick={() => acknowledgeAlert(alert.id)}
                        className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition"
                      >
                        Acknowledge
                      </button>
                    )}

                    {!isResolved ? (
                      <button
                        onClick={() => resolveAlert(alert.id)}
                        className="px-3 py-1 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition flex items-center gap-1 shadow-2xs"
                      >
                        <Check className="w-3 h-3" />
                        Resolve
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400 font-medium">Resolved</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </CardContent>

      <div className="px-4 py-2 bg-slate-50/60 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span>Active Alerts: <strong className="text-slate-800">{alerts.filter((a) => a.status === 'active').length} unresolved</strong></span>
        <span className="text-caption text-slate-400">Live</span>
      </div>
    </Card>
  );
};
export default AiActionCenterSection;
