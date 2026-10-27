import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  Sparkles,
  HelpCircle,
  Eye,
  Database,
  Clock,
  Layers,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Send,
  Sliders,
} from 'lucide-react';
import type { OperationalInsight } from '../../types/retail';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';

interface ExplainableAiDrawerProps {
  insight: OperationalInsight | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenTaskModal: (insight: OperationalInsight) => void;
  onExecuteAction: (insightId: string, action: 'acknowledge' | 'start' | 'complete' | 'dismiss') => void;
}

export const ExplainableAiDrawer: React.FC<ExplainableAiDrawerProps> = ({
  insight,
  isOpen,
  onClose,
  onOpenTaskModal,
  onExecuteAction,
}) => {
  const navigate = useNavigate();

  if (!isOpen || !insight) return null;

  const isCritical = insight.severity === 'critical';
  const isWarning = insight.severity === 'warning';
  const isCompleted = insight.status === 'completed';

  const evidence = insight.evidence;

  const handleNavigateToModule = () => {
    onClose();
    navigate(evidence.relatedModuleUrl);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200">
      <div className="absolute inset-y-0 right-0 flex max-w-full pl-10">
        <div className="w-screen max-w-xl bg-white shadow-2xl border-l border-slate-200 flex flex-col justify-between">
          {/* Drawer Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50/70">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-500/20">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-slate-500">{insight.code}</span>
                  <Badge
                    variant={isCritical ? 'error' : isWarning ? 'warning' : 'slate'}
                    size="sm"
                    className="text-caption uppercase font-semibold"
                  >
                    {insight.severity}
                  </Badge>
                </div>
                <h2 className="text-sm font-semibold text-slate-900 leading-snug">{insight.title}</h2>
              </div>
            </div>

            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs text-slate-700">
            {/* Transparent Explainability Banner */}
            <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 text-blue-900 flex items-start gap-2.5">
              <ShieldCheck className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <strong className="font-semibold text-xs">How this was decided</strong>
                <p className="mt-0.5 text-caption text-blue-800 leading-relaxed">
                  Every recommendation is based on camera detections, queue data and stock counts.
                </p>
              </div>
            </div>

            {/* What we saw */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Eye className="h-4 w-4 text-emerald-600" />
                What we saw
              </h3>
              <p className="text-slate-800 font-medium leading-relaxed bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                "{evidence.observedStatement}"
              </p>
              <div className="grid grid-cols-2 gap-2 text-caption text-slate-500 pt-1">
                <div>
                  <span className="text-slate-400 block">Data Ingestion Source:</span>
                  <strong className="text-slate-700">{evidence.dataSource}</strong>
                </div>
                <div>
                  <span className="text-slate-400 block">Observation Window:</span>
                  <strong className="text-slate-700">{evidence.timeWindow}</strong>
                </div>
              </div>
            </div>

            {/* 2. Measured Metrics vs Configured SLA Thresholds */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Database className="h-4 w-4 text-blue-600" />
                Measured vs target
              </h3>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-caption">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
                    <tr>
                      <th className="py-1.5 px-2">Metric</th>
                      <th className="py-1.5 px-2">Measured</th>
                      <th className="py-1.5 px-2">Target Limit</th>
                      <th className="py-1.5 px-2 text-right">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {evidence.metricsTable.map((m, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="py-2 px-2 font-semibold text-slate-800">{m.metric}</td>
                        <td className="py-2 px-2 font-mono font-semibold text-slate-900">{m.measuredValue}</td>
                        <td className="py-2 px-2 text-slate-500">{m.targetThreshold}</td>
                        <td className="py-2 px-2 text-right font-semibold text-rose-600">{m.variance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 3. Triggering Rule & Scientific Justification */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Sliders className="h-4 w-4 text-indigo-600" />
                Why it triggered
              </h3>
              <div className="rounded-lg bg-slate-50 p-2.5 font-mono text-caption text-slate-800 border border-slate-200">
                {evidence.triggerRule}
              </div>
              <p className="text-caption text-slate-600 leading-relaxed pt-1">
                <strong>Operational Risk Explanation:</strong> {evidence.riskAnalysis}
              </p>
            </div>

            {/* 4. Model Confidence & Method */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 flex items-center justify-between text-xs">
              <div>
                <span className="text-caption text-slate-400 block font-medium">Validation Methodology</span>
                <span className="font-semibold text-slate-800">{evidence.confidenceReliability}</span>
              </div>
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
            </div>

            {/* 5. Recommended Step-by-Step Action */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-xs space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                What to do
              </h3>
              <p className="text-xs font-semibold text-slate-900 leading-relaxed">
                {insight.recommendedAction}
              </p>
            </div>
          </div>

          {/* Drawer Footer Actions */}
          <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleNavigateToModule}
              className="text-xs border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 gap-1.5 font-semibold"
            >
              <span>Open in {evidence.relatedModuleName}</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>

            <div className="flex items-center gap-2">
              {!isCompleted && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onExecuteAction(insight.id, 'acknowledge')}
                    className="text-xs border-slate-300 text-slate-700 hover:bg-slate-100"
                  >
                    Acknowledge
                  </Button>

                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      onClose();
                      onOpenTaskModal(insight);
                    }}
                    className="text-xs bg-blue-600 text-white hover:bg-blue-700 gap-1.5"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>Assign Staff Task</span>
                  </Button>
                </>
              )}

              {isCompleted && (
                <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4" />
                  Resolved
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
