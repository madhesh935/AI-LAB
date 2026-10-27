import React, { useState } from 'react';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  Check,
  Plus,
  Video,
  Clock,
  Sparkles,
  Layers,
} from 'lucide-react';
import type { InventoryAlert, AlertSeverity } from '../../types/retail';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface InventoryAlertsSectionProps {
  alerts: InventoryAlert[];
  onAcknowledgeAlert: (alertId: string) => void;
  onResolveAlert: (alertId: string) => void;
  onCreateTaskFromAlert: (alert: InventoryAlert) => void;
  embedded?: boolean;
}

export const InventoryAlertsSection: React.FC<InventoryAlertsSectionProps> = ({
  alerts,
  onAcknowledgeAlert,
  onResolveAlert,
  onCreateTaskFromAlert,
  embedded = false,
}) => {
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'critical' | 'warning' | 'active'>('active');

  const filteredAlerts = alerts.filter((alert) => {
    if (filterSeverity === 'active') return alert.status === 'active';
    if (filterSeverity === 'critical') return alert.severity === 'critical';
    if (filterSeverity === 'warning') return alert.severity === 'warning';
    return true;
  });

  const getSeverityBadge = (severity: AlertSeverity) => {
    switch (severity) {
      case 'critical':
        return <Badge variant="error" size="sm" dot>Critical</Badge>;
      case 'warning':
        return <Badge variant="warning" size="sm" dot>Warning</Badge>;
      default:
        return <Badge variant="primary" size="sm" dot>Advisory</Badge>;
    }
  };

  return (
    <Card className={embedded ? 'flex flex-col rounded-none border-0 border-t border-slate-100 shadow-none' : 'flex flex-col border-slate-200'}>
      <CardContent className="space-y-2 p-3 flex-1">
        {filteredAlerts.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="font-semibold text-slate-700">No alerts</p>
            <p className="text-caption text-slate-400 mt-0.5">All aisles look fine.</p>
          </div>
        ) : (
          filteredAlerts.map((alert) => {
            const isCritical = alert.severity === 'critical';
            const isResolved = alert.status === 'resolved';
            const isAcknowledged = alert.status === 'acknowledged';

            return (
              <div
                key={alert.id}
                className={`px-3 py-2.5 rounded-lg border transition-all flex flex-wrap items-center justify-between gap-x-3 gap-y-2 ${
                  isResolved
                    ? 'bg-slate-50/50 border-slate-200/60 opacity-60'
                    : isCritical
                    ? 'bg-rose-50/25 border-rose-200 hover:border-rose-300'
                    : alert.severity === 'warning'
                    ? 'bg-amber-50/20 border-amber-200 hover:border-amber-300'
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Left Description */}
                <div className="space-y-1 flex-1 min-w-0 basis-56">
                  <h4 className={`text-sm font-semibold tracking-tight ${isResolved ? 'line-through text-slate-500' : 'text-slate-900'}`}>
                    {alert.title}
                  </h4>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {getSeverityBadge(alert.severity)}
                    <span className="font-mono text-caption font-semibold text-blue-600">{alert.shelfCode}</span>
                    <span className="text-caption text-slate-400">{alert.detectionTime}</span>
                    {alert.taskId && <span className="text-caption font-medium text-blue-600">Restock task sent</span>}
                  </div>
                  <p className="text-caption text-slate-600 leading-snug">{alert.description}</p>

                </div>

                {/* Right Action Buttons */}
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  {!isResolved && !alert.taskId && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => onCreateTaskFromAlert(alert)}
                      className="text-xs h-7 px-2.5 bg-blue-600 hover:bg-blue-700"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Create Task
                    </Button>
                  )}

                  {!isResolved && !isAcknowledged && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onAcknowledgeAlert(alert.id)}
                      className="text-xs h-7 px-2.5 hover:bg-slate-50"
                    >
                      Acknowledge
                    </Button>
                  )}

                  {!isResolved ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onResolveAlert(alert.id)}
                      className="text-xs h-7 px-2.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                    >
                      <Check className="w-3.5 h-3.5 mr-1" />
                      Resolve
                    </Button>
                  ) : (
                    <Badge variant="outline" size="md" className="text-slate-400">
                      Resolved
                    </Badge>
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>

      <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-2">
        <span>Active Alerts: <strong>{alerts.filter((a) => a.status === 'active').length} unresolved</strong></span>
        <span className="text-caption text-blue-600 font-semibold">{alerts.filter((a) => a.status === 'acknowledged').length} acknowledged</span>
      </div>
    </Card>
  );
};
