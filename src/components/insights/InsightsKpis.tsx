import React from 'react';
import {
  Sparkles,
  AlertTriangle,
  Clock,
  CheckCircle2,
  PackageX,
  CreditCard,
  ShieldAlert,
  ArrowRight,
} from 'lucide-react';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import type { AiInsightsKpis } from '../../types/retail';

interface InsightsKpisProps {
  kpis: AiInsightsKpis;
}

export const InsightsKpis: React.FC<InsightsKpisProps> = ({ kpis }) => {
  return (
    <section aria-label="AI Insights Key Metrics" className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {/* 1. Active Insights */}
      <Card className="flex flex-col justify-between p-4 shadow-sm border-slate-200 hover:border-slate-300 transition-all">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Active Insights
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Sparkles className="h-4 w-4" />
            </div>
          </div>

          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight text-slate-900">
              {kpis.activeInsights}
            </span>
            <span className="text-xs font-medium text-slate-500">live advisories</span>
          </div>
        </div>

      </Card>

      {/* 2. Critical Issues */}
      <Card className="flex flex-col justify-between p-4 shadow-sm border-slate-200 hover:border-slate-300 transition-all">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Critical Issues
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>

          <div className="mt-2 flex items-baseline gap-1.5">
            <span className={`text-2xl font-semibold tracking-tight ${kpis.criticalIssues > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
              {kpis.criticalIssues}
            </span>
            <span className="text-xs font-medium text-slate-500">immediate risks</span>
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-slate-100">
          <span className="text-caption font-medium text-slate-500">High priority</span>
        </div>
      </Card>

      {/* 3. Pending Actions */}
      <Card className="flex flex-col justify-between p-4 shadow-sm border-slate-200 hover:border-slate-300 transition-all">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Pending Actions
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <Clock className="h-4 w-4" />
            </div>
          </div>

          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight text-amber-600">
              {kpis.pendingActions}
            </span>
            <span className="text-xs font-medium text-slate-500">unassigned tasks</span>
          </div>
        </div>

      </Card>

      {/* 4. Completed Recommendations */}
      <Card className="flex flex-col justify-between p-4 shadow-sm border-slate-200 hover:border-slate-300 transition-all">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Completed Actions
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>

          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight text-emerald-600">
              {kpis.completedRecommendations}
            </span>
            <span className="text-xs font-medium text-slate-500">resolved today</span>
          </div>
        </div>

      </Card>

      {/* 5. Inventory Risk Alerts */}
      <Card className="flex flex-col justify-between p-4 shadow-sm border-slate-200 hover:border-slate-300 transition-all">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Inventory Depletions
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <PackageX className="h-4 w-4" />
            </div>
          </div>

          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight text-slate-900">
              {kpis.inventoryRiskAlerts}
            </span>
            <span className="text-xs font-medium text-slate-500">critical gaps</span>
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-slate-100">
          <span className="text-caption font-medium text-slate-500">From shelf observations</span>
        </div>
      </Card>

      {/* 6. Queue Congestion Risk */}
      <Card className="flex flex-col justify-between p-4 shadow-sm border-slate-200 hover:border-slate-300 transition-all">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Queue Congestion
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
              <CreditCard className="h-4 w-4" />
            </div>
          </div>

          <div className="mt-2 flex items-baseline gap-1.5">
            <span className={`text-2xl font-semibold tracking-tight ${kpis.queueCongestionRisk > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
              {kpis.queueCongestionRisk}
            </span>
            <span className="text-xs font-medium text-slate-500">lane exceeding SLA</span>
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-slate-100">
          <span className="text-caption font-medium text-slate-500">From queue observations</span>
        </div>
      </Card>
    </section>
  );
};
