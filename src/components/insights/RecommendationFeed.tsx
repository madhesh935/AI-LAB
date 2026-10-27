import React, { useState } from 'react';
import {
  Sparkles,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Send,
  HelpCircle,
  Eye,
  ArrowRight,
  TrendingDown,
  UserCheck,
  XCircle,
  Sliders,
  Check,
  RotateCw,
  MoreHorizontal,
} from 'lucide-react';
import type { OperationalInsight } from '../../types/retail';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface RecommendationFeedProps {
  insights: OperationalInsight[];
  onViewExplanation: (insight: OperationalInsight) => void;
  onOpenTaskModal: (insight: OperationalInsight) => void;
  onExecuteAction: (insightId: string, action: 'acknowledge' | 'start' | 'complete' | 'dismiss') => void;
  onOpenDismissModal: (insight: OperationalInsight) => void;
}

export const RecommendationFeed: React.FC<RecommendationFeedProps> = ({
  insights,
  onViewExplanation,
  onOpenTaskModal,
  onExecuteAction,
  onOpenDismissModal,
}) => {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const getCategoryTheme = (cat: string) => {
    switch (cat) {
      case 'queue_intelligence':
        return { label: 'Queue Intelligence', border: 'border-l-rose-500', badge: 'bg-rose-50 text-rose-700 border-rose-200' };
      case 'inventory':
        return { label: 'Smart Inventory', border: 'border-l-indigo-500', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
      case 'shopper_analytics':
        return { label: 'Shopper Analytics', border: 'border-l-blue-500', badge: 'bg-blue-50 text-blue-700 border-blue-200' };
      case 'operational_efficiency':
        return { label: 'Operational Efficiency', border: 'border-l-amber-500', badge: 'bg-amber-50 text-amber-800 border-amber-200' };
      case 'camera_health':
        return { label: 'Camera Health', border: 'border-l-slate-500', badge: 'bg-slate-100 text-slate-700 border-slate-200' };
      default:
        return { label: 'General AI', border: 'border-l-blue-500', badge: 'bg-blue-50 text-blue-700 border-blue-200' };
    }
  };

  return (
    <Card className="flex flex-col border-slate-200 shadow-card bg-white overflow-hidden xl:absolute xl:inset-0">
      {/* Container Header */}
      <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col items-start 2xl:flex-row 2xl:items-center justify-between gap-2.5 bg-white">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-semibold text-slate-900">
                Recommendations
              </h2>
            </div>
            
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="slate" size="sm" className="text-xs font-semibold px-2 py-0.5">
            {insights.length} Advisories Active
          </Badge>
        </div>
      </div>

      {/* Scrollable Content Body */}
      <div className="p-3.5 sm:p-4 flex-1 min-h-0 space-y-2 overflow-y-auto max-h-[780px] xl:max-h-none">
        {insights.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-10 text-center text-slate-500">
            <Sparkles className="mx-auto h-10 w-10 text-slate-300 mb-2.5" />
            <h3 className="text-sm font-semibold text-slate-900 mb-1">No Matching Advisories</h3>
            <p className="text-xs text-slate-500 max-w-xs mx-auto">
              Nothing matches these filters.
            </p>
          </div>
        ) : (
          insights.map((insight) => {
            const isCritical = insight.severity === 'critical';
            const isWarning = insight.severity === 'warning';
            const isPending = insight.status === 'pending';
            const isInProgress = insight.status === 'in_progress';
            const isCompleted = insight.status === 'completed';
            const isDismissed = insight.status === 'dismissed';

            const theme = getCategoryTheme(insight.category);

            const metrics = insight.evidence.metricsTable.slice(0, 3);
            const SeverityIcon = isCritical ? AlertTriangle : isWarning ? Clock : Sparkles;
            const tone = isCritical
              ? { tile: 'bg-rose-50 text-rose-600', value: 'text-rose-600' }
              : isWarning
              ? { tile: 'bg-amber-50 text-amber-600', value: 'text-amber-600' }
              : { tile: 'bg-blue-50 text-blue-600', value: 'text-slate-900' };
            const isOpenMenu = menuOpenId === insight.id;

            return (
              <div
                key={insight.id}
                className={`rounded-lg border border-slate-200 bg-white px-3 py-2.5 transition-shadow hover:shadow-md border-l-4 ${theme.border}`}
              >
                {/* Title row */}
                <div className="flex items-center gap-2.5">
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${tone.tile}`}>
                    <SeverityIcon className="h-3.5 w-3.5" />
                  </div>
                  <h3 className="min-w-0 flex-1 text-sm font-semibold text-slate-900 leading-snug">{insight.title}</h3>
                  <div className="shrink-0">
                    {isCompleted ? (
                      <Badge variant="success" size="sm" className="gap-1 text-caption bg-emerald-50 text-emerald-700 border-emerald-200">
                        <CheckCircle2 className="h-3 w-3" />
                        Resolved
                      </Badge>
                    ) : isInProgress ? (
                      <Badge variant="warning" size="sm" className="gap-1 text-caption bg-amber-50 text-amber-800 border-amber-200">
                        <Clock className="h-3 w-3 animate-spin" />
                        In Progress
                      </Badge>
                    ) : isDismissed ? (
                      <Badge variant="slate" size="sm" className="text-caption line-through">
                        Dismissed
                      </Badge>
                    ) : (
                      <span className="text-caption text-slate-400">{insight.timestamp}</span>
                    )}
                  </div>
                </div>

                {/* Meta row */}
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-[38px] text-caption text-slate-500">
                  <Badge
                    variant={isCritical ? 'error' : isWarning ? 'warning' : 'slate'}
                    size="sm"
                    dot
                    className="text-caption uppercase font-semibold"
                  >
                    {insight.severity}
                  </Badge>
                  <span className={`rounded-full border px-2 py-px font-medium ${theme.badge}`}>{theme.label}</span>
                  <span>{insight.zone}</span>
                  <span className="font-mono text-slate-400">{insight.code}</span>
                </div>

                {/* Key numbers, inline */}
                {metrics.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 pl-[38px] text-caption text-slate-500">
                    {metrics.map((m, i) => (
                      <span key={m.metric}>
                        {m.metric}{' '}
                        <strong className={`text-xs font-semibold ${i === 0 ? tone.value : 'text-slate-900'}`}>
                          {m.measuredValue}
                        </strong>
                      </span>
                    ))}
                  </div>
                )}

                {/* Action + buttons */}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pl-[38px]">
                  <p className="min-w-0 flex-1 basis-56 text-xs text-slate-700 leading-snug">
                    <span className="text-blue-600">→</span> {insight.recommendedAction}
                  </p>

                  <div className="relative flex shrink-0 items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onViewExplanation(insight)}
                      className="text-xs h-7 px-2.5 border-slate-200 text-slate-700 hover:border-blue-400 hover:text-blue-700 gap-1.5 font-medium"
                      title="View explanation and evidence"
                    >
                      <Eye className="h-3.5 w-3.5 text-blue-600" />
                      <span>Details</span>
                    </Button>

                    {isCompleted ? (
                      <span className="text-xs font-medium text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 className="h-4 w-4" />
                        Completed
                      </span>
                    ) : isDismissed ? (
                      <span className="text-xs text-slate-400">{insight.dismissedReason || 'Dismissed'}</span>
                    ) : (
                      <>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => onOpenTaskModal(insight)}
                          className="text-xs h-7 px-3 bg-blue-600 text-white hover:bg-blue-700 gap-1.5"
                        >
                          <Send className="h-3 w-3" />
                          <span>Dispatch</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setMenuOpenId(isOpenMenu ? null : insight.id)}
                          className="text-xs h-7 w-7 px-0 border-slate-200 text-slate-500"
                          title="More actions"
                          aria-haspopup="menu"
                          aria-expanded={isOpenMenu}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                        {isOpenMenu && (
                          <div
                            role="menu"
                            className="absolute right-0 bottom-9 z-20 w-44 rounded-lg border border-slate-200 bg-white p-1 text-xs shadow-lg"
                          >
                            {isPending && (
                              <button
                                role="menuitem"
                                onClick={() => { onExecuteAction(insight.id, 'acknowledge'); setMenuOpenId(null); }}
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-slate-700 hover:bg-slate-50"
                              >
                                <UserCheck className="h-3.5 w-3.5 text-slate-400" /> Acknowledge
                              </button>
                            )}
                            <button
                              role="menuitem"
                              onClick={() => { onExecuteAction(insight.id, 'complete'); setMenuOpenId(null); }}
                              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-emerald-700 hover:bg-emerald-50"
                            >
                              <Check className="h-3.5 w-3.5" /> Mark resolved
                            </button>
                            <button
                              role="menuitem"
                              onClick={() => { onOpenDismissModal(insight); setMenuOpenId(null); }}
                              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-slate-600 hover:bg-slate-50"
                            >
                              <XCircle className="h-3.5 w-3.5 text-slate-400" /> Dismiss
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Grounding Telemetry Bar */}
      <div className="p-3 bg-slate-50/80 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-caption font-medium text-slate-600">
            Stored observations and alerts
          </span>
        </div>
        <span className="text-caption font-mono text-slate-400">
          Rule-based, no model confidence
        </span>
      </div>
    </Card>
  );
};
