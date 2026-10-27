import React from 'react';
import {
  Sparkles,
  ArrowRight,
  UserCheck,
  CheckCircle2,
  Clock,
  TrendingDown,
  AlertTriangle,
  Send,
  Zap,
} from 'lucide-react';
import type { StaffingRecommendation } from '../../types/retail';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface StaffingRecommendationPanelProps {
  recommendations: StaffingRecommendation[];
  onOpenDispatchModal: (rec: StaffingRecommendation) => void;
  onAcknowledge: (recId: string) => void;
  reliefStaffCount?: number | null;
}

export const StaffingRecommendationPanel: React.FC<StaffingRecommendationPanelProps> = ({
  recommendations,
  onOpenDispatchModal,
  onAcknowledge,
  reliefStaffCount,
}) => {
  return (
    <Card className="flex flex-col border-slate-200 shadow-card h-full">
      <CardHeader className="flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-600" />
              Staffing Suggestions
            </CardTitle>
            <Badge variant="primary" size="sm" className="font-semibold text-caption">
              {recommendations.length}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-3 flex-1 grid grid-cols-1 gap-2 items-start content-start">
        {recommendations.map((rec) => {
          const isCritical = rec.priority === 'critical';
          const isHigh = rec.priority === 'high';
          const isDeployed = rec.status === 'deployed';
          const isAcknowledged = rec.status === 'acknowledged';

          return (
            <div
              key={rec.id}
              className={`px-3 py-2.5 rounded-lg border transition-all duration-200 ${
                isCritical && !isDeployed
                  ? 'border-l-4 border-l-rose-500 bg-rose-50/15 border-rose-200'
                  : isHigh && !isDeployed
                  ? 'border-l-4 border-l-amber-500 bg-amber-50/10 border-amber-200'
                  : 'border-l-4 border-l-blue-500 bg-white border-slate-200'
              }`}
            >
              {/* Title row */}
              <div className="flex items-center gap-2">
                <h4 className="min-w-0 flex-1 text-xs font-semibold text-slate-900 leading-snug">{rec.title}</h4>
                {isDeployed ? (
                  <Badge variant="success" size="sm" className="gap-1 text-caption bg-emerald-50 text-emerald-700 border-emerald-200 shrink-0">
                    <CheckCircle2 className="h-3 w-3" />
                    Deployed
                  </Badge>
                ) : isAcknowledged ? (
                  <Badge variant="slate" size="sm" className="text-caption shrink-0">
                    Acknowledged
                  </Badge>
                ) : (
                  <span className="text-caption text-slate-400 shrink-0">{rec.timestamp}</span>
                )}
              </div>

              {/* Meta row */}
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-slate-500">
                <Badge
                  variant={isCritical ? 'error' : isHigh ? 'warning' : 'primary'}
                  size="sm"
                  className="text-caption uppercase font-semibold"
                >
                  {rec.priority}
                </Badge>
                <span>
                  Wait <strong className="text-rose-600">{rec.sourceMetrics.currentWait === null ? '—' : `${rec.sourceMetrics.currentWait}m`}</strong>
                </span>
                {rec.sourceMetrics.projectedWait !== null && (
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                    <TrendingDown className="h-3 w-3" />
                    {rec.sourceMetrics.projectedWait}m after
                  </span>
                )}
                <span>
                  Assign <strong className="text-slate-800">{rec.suggestedStaffName}</strong>
                </span>
              </div>

              {/* Description + actions */}
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <p className="min-w-0 flex-1 basis-40 text-caption text-slate-600 leading-snug">
                  {rec.recommendationText}
                </p>

                <div className="flex shrink-0 items-center gap-1.5">
                  {!isDeployed ? (
                    <>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => onOpenDispatchModal(rec)}
                        className="text-caption h-7 px-3 bg-blue-600 text-white hover:bg-blue-700 gap-1.5 cursor-pointer"
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        <span>Assign</span>
                      </Button>

                      {!isAcknowledged && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onAcknowledge(rec.id)}
                          className="text-caption h-7 px-2.5 border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
                          title="Mark Acknowledged"
                        >
                          Ack
                        </Button>
                      )}
                    </>
                  ) : (
                    <span className="flex items-center gap-1.5 text-caption font-medium text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Sent to {rec.targetCounterName}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>

      <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <UserCheck className="w-3.5 h-3.5 text-blue-600" />
          <span><strong>{reliefStaffCount ?? '—'}</strong> relief staff available</span>
        </span>
              </div>
    </Card>
  );
};
