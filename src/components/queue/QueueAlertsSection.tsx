import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  ArrowRight,
  Filter,
  Check,
  RotateCcw,
} from 'lucide-react';
import type { QueueAlert } from '../../types/retail';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface QueueAlertsSectionProps {
  alerts: QueueAlert[];
  onAcknowledgeAlert: (alertId: string) => void;
  onResolveAlert: (alertId: string) => void;
}

export const QueueAlertsSection: React.FC<QueueAlertsSectionProps> = ({
  alerts,
  onAcknowledgeAlert,
  onResolveAlert,
}) => {
  const [filter, setFilter] = useState<'all' | 'active' | 'acknowledged' | 'resolved'>('all');

  const filteredAlerts = alerts.filter((a) => {
    if (filter === 'all') return true;
    return a.status === filter;
  });

  return (
    <Card className="border-slate-200 bg-white p-5 shadow-card h-full flex flex-col space-y-4">
      {/* Header & Filter Tabs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Queue Alerts
              </h2>
              
            </div>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs">
          {[
            { id: 'all', label: 'All Alerts' },
            { id: 'active', label: 'Active' },
            { id: 'acknowledged', label: 'Acknowledged' },
            { id: 'resolved', label: 'Resolved' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id as any)}
              className={`rounded-md px-2.5 py-1 font-medium transition-all ${
                filter === tab.id
                  ? 'bg-white text-blue-700 shadow-sm font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Alerts Table / List */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-600">
          <thead className="border-b border-slate-200 bg-slate-50 text-caption font-semibold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="py-2.5 px-3 hidden">Alert Code</th>
              <th className="py-2.5 px-3">Condition & Description</th>
              <th className="py-2.5 px-3">Counter / Zone</th>
              <th className="py-2.5 px-3 hidden">Trigger Metric</th>
              <th className="py-2.5 px-3">Severity</th>
              <th className="py-2.5 px-3">Timestamp</th>
              <th className="py-2.5 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredAlerts.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-xs text-slate-400 italic">
                  No alerts.
                </td>
              </tr>
            ) : (
              filteredAlerts.map((alert) => {
                const isCritical = alert.severity === 'critical';
                const isWarning = alert.severity === 'warning';
                const isActive = alert.status === 'active';
                const isAcknowledged = alert.status === 'acknowledged';
                const isResolved = alert.status === 'resolved';

                return (
                  <tr key={alert.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-3 font-mono font-semibold whitespace-nowrap text-slate-700 hidden">
                      {alert.alertCode}
                    </td>

                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-900">{alert.title}</div>
                      <div className="text-caption text-slate-500 mt-0.5">{alert.suggestedAction}</div>
                    </td>

                    <td className="py-3 px-3 font-medium text-slate-800">
                      {alert.counterName}
                    </td>

                    <td className="py-3 px-3 hidden">
                      <div className="font-semibold text-slate-800">{alert.metricTriggered}</div>
                      <div className="text-caption text-slate-400">{alert.threshold}</div>
                    </td>

                    <td className="py-3 px-3">
                      <Badge
                        variant={isCritical ? 'error' : isWarning ? 'warning' : 'slate'}
                        size="sm"
                        dot
                        className="text-caption uppercase font-semibold"
                      >
                        {alert.severity}
                      </Badge>
                    </td>

                    <td className="py-3 px-3 text-slate-500 whitespace-nowrap">
                      {alert.timestamp}
                    </td>

                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {isActive && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onAcknowledgeAlert(alert.id)}
                            className="h-6 px-2 text-caption border-slate-200 text-slate-700 hover:bg-slate-100"
                          >
                            Ack
                          </Button>
                        )}

                        {!isResolved && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onResolveAlert(alert.id)}
                            className="h-6 px-2 text-caption border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                          >
                            Resolve
                          </Button>
                        )}

                        {isResolved && (
                          <span className="flex items-center gap-1 text-caption font-semibold text-emerald-600">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Resolved
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
};
