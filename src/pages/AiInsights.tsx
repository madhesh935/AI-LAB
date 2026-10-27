import { BackendState } from '../components/common/BackendState';
import { isAbort } from '../services/api/client';
import { useLiveRefresh } from '../services/api/realtime';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  ArrowRight,
  TrendingUp,
  Search,
  Filter,
  Check,
  X,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { apiService } from '../services/apiService';
import type {
  AiInsightsData,
  OperationalInsight,
  InsightCategory,
  InsightSeverity,
  InsightActionStatus,
  PriorityLevel,
  DateRange,
} from '../types/retail';
import { InsightsHeader } from '../components/insights/InsightsHeader';
import { InsightsKpis } from '../components/insights/InsightsKpis';
import { RecommendationFeed } from '../components/insights/RecommendationFeed';
import { RetailOpportunityCards } from '../components/insights/RetailOpportunityCards';
import { ExplainableAiDrawer } from '../components/insights/ExplainableAiDrawer';
import { AssignStaffTaskModal } from '../components/insights/AssignStaffTaskModal';
import { DismissInsightModal } from '../components/insights/DismissInsightModal';
import { Card } from '../components/common/Card';

export const AiInsights: React.FC = () => {
  const { selectedStoreId, dateRange, setDateRange } = useStore();

  const [aiData, setAiData] = useState<AiInsightsData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Filter States
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals & Drawer States
  const [activeExplanation, setActiveExplanation] = useState<OperationalInsight | null>(null);
  const [taskModalInsight, setTaskModalInsight] = useState<OperationalInsight | null>(null);
  const [dismissModalInsight, setDismissModalInsight] = useState<OperationalInsight | null>(null);

  // Notification Toast State
  const [toastMessage, setToastMessage] = useState<{
    type: 'success' | 'info';
    title: string;
    description: string;
  } | null>(null);

  const showToast = (title: string, description: string, type: 'success' | 'info' = 'success') => {
    setToastMessage({ title, description, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  };

  // Fetch operational insights data
  const loadData = useCallback(async () => {
    try {
      const data = await apiService.getOperationalInsightsData(
        selectedStoreId,
        dateRange,
        categoryFilter as InsightCategory | 'all',
        severityFilter as InsightSeverity | 'all',
        statusFilter as InsightActionStatus | 'all'
      );
      setAiData(data);
      setLoadError(null);
    } catch (err) {
      if (!isAbort(err)) setLoadError(err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedStoreId, dateRange, categoryFilter, severityFilter, statusFilter]);

  useEffect(() => {
    setIsLoading(true);
    loadData();
  }, [loadData]);

  useLiveRefresh(['alert.', 'task.', 'inventory.', 'queue.'], () => void loadData());

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
    showToast('Telemetry Refreshed', 'AI recommendations recomputed across all store zones.', 'info');
  };

  // Execute an action on an insight (acknowledge, complete, start, dismiss)
  const handleExecuteAction = async (
    insightId: string,
    action: 'acknowledge' | 'start' | 'complete' | 'dismiss'
  ) => {
    if (!aiData) return;

    try {
      const res = await apiService.executeInsightAction(selectedStoreId, insightId, action);
      if (res.success) {
        // Optimistically update insights state
        setAiData((prev) => {
          if (!prev) return prev;
          const updatedInsights = prev.insights.map((ins) => {
            if (ins.id === insightId) {
              return {
                ...ins,
                status: res.status,
                completedAt: action === 'complete' ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ins.completedAt,
              };
            }
            return ins;
          });

          // Recompute KPIs
          const active = updatedInsights.filter((i) => i.status !== 'completed' && i.status !== 'dismissed').length;
          const critical = updatedInsights.filter((i) => i.severity === 'critical' && i.status !== 'completed' && i.status !== 'dismissed').length;
          const pending = updatedInsights.filter((i) => i.status === 'pending').length;
          const completed = updatedInsights.filter((i) => i.status === 'completed').length;

          return {
            ...prev,
            insights: updatedInsights,
            kpis: {
              ...prev.kpis,
              activeInsights: active,
              criticalIssues: critical,
              pendingActions: pending,
              completedRecommendations: completed,
            },
          };
        });

        // Also update open drawer insight if active
        if (activeExplanation && activeExplanation.id === insightId) {
          setActiveExplanation((prev) => (prev ? { ...prev, status: res.status } : null));
        }

        const actionText =
          action === 'acknowledge'
            ? 'acknowledged and queued'
            : action === 'complete'
            ? 'marked as resolved'
            : action === 'start'
            ? 'put in progress'
            : 'dismissed';

        showToast(
          'Action Executed',
          `Recommendation ${insightId} successfully ${actionText}.`,
          'success'
        );
      }
    } catch (err) {
      console.error('Error executing insight action:', err);
    }
  };

  // Dispatch staff task handler
  const handleDispatchTask = async (taskData: {
    insightId: string;
    staffId: string;
    staffName: string;
    taskTitle: string;
    priority: PriorityLevel;
    dueMinutes: number;
    notes: string;
  }) => {
    try {
      const res = await apiService.createTaskFromInsight(
        selectedStoreId,
        taskData.insightId,
        taskData.staffId,
        taskData.taskTitle,
        taskData.dueMinutes
      );

      if (res.success) {
        // Update insight with task reference and in_progress status
        setAiData((prev) => {
          if (!prev) return prev;
          const updated = prev.insights.map((ins) => {
            if (ins.id === taskData.insightId) {
              return {
                ...ins,
                status: 'in_progress' as InsightActionStatus,
                taskId: res.taskId,
                assignedStaffId: taskData.staffId,
                assignedStaffName: taskData.staffName,
              };
            }
            return ins;
          });

          return {
            ...prev,
            insights: updated,
            kpis: {
              ...prev.kpis,
              pendingActions: Math.max(0, prev.kpis.pendingActions - 1),
            },
          };
        });

        // Update active drawer if open
        if (activeExplanation && activeExplanation.id === taskData.insightId) {
          setActiveExplanation((prev) =>
            prev
              ? {
                  ...prev,
                  status: 'in_progress',
                  taskId: res.taskId,
                  assignedStaffId: taskData.staffId,
                  assignedStaffName: taskData.staffName,
                }
              : null
          );
        }

        showToast(
          'Task Dispatched',
          `Task #${res.taskId} assigned to ${taskData.staffName} (Due in ${taskData.dueMinutes}m).`,
          'success'
        );
      }
    } catch (err) {
      console.error('Error creating task:', err);
    }
  };

  // Confirm dismissal handler
  const handleConfirmDismiss = async (insightId: string, reason: string) => {
    try {
      await apiService.executeInsightAction(selectedStoreId, insightId, 'dismiss', { reason });

      setAiData((prev) => {
        if (!prev) return prev;
        const updated = prev.insights.map((ins) => {
          if (ins.id === insightId) {
            return {
              ...ins,
              status: 'dismissed' as InsightActionStatus,
              dismissedReason: reason,
            };
          }
          return ins;
        });

        return {
          ...prev,
          insights: updated,
          kpis: {
            ...prev.kpis,
            activeInsights: Math.max(0, prev.kpis.activeInsights - 1),
            pendingActions: Math.max(0, prev.kpis.pendingActions - 1),
          },
        };
      });

      if (activeExplanation && activeExplanation.id === insightId) {
        setActiveExplanation((prev) =>
          prev ? { ...prev, status: 'dismissed', dismissedReason: reason } : null
        );
      }

      showToast(
        'Recommendation Dismissed',
        `Insight recorded as dismissed in telemetry audit log.`,
        'info'
      );
    } catch (err) {
      console.error('Error dismissing insight:', err);
    }
  };

  // Filter insights with client-side search query
  const filteredInsights = useMemo(() => {
    if (!aiData) return [];
    let list = aiData.insights;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (ins) =>
          ins.title.toLowerCase().includes(q) ||
          ins.summary.toLowerCase().includes(q) ||
          ins.zone.toLowerCase().includes(q) ||
          ins.code.toLowerCase().includes(q) ||
          ins.recommendedAction.toLowerCase().includes(q)
      );
    }

    return list;
  }, [aiData, searchQuery]);

  // Loading skeleton screen
  if (loadError && !aiData) {
    return <BackendState error={loadError} onRetry={() => void loadData()} what="AI Insights" />;
  }

  if (isLoading || !aiData) {
    return (
      <div className="space-y-6 animate-pulse p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-slate-200" />
            <div className="space-y-2">
              <div className="h-6 w-64 rounded bg-slate-200" />
              <div className="h-4 w-96 rounded bg-slate-200" />
            </div>
          </div>
          <div className="h-10 w-48 rounded-xl bg-slate-200" />
        </div>

        {/* KPI Skeletons */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-slate-200 border border-slate-200" />
          ))}
        </div>

        {/* Content Skeletons */}
        <div className="h-80 rounded-2xl bg-slate-200" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="h-64 rounded-2xl bg-slate-200" />
          <div className="h-64 rounded-2xl bg-slate-200" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Toast Notification Pill */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl bg-slate-900 text-white px-4 py-3 shadow-2xl border border-slate-800 animate-in slide-in-from-bottom-4 duration-200">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
            <Check className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-semibold text-white">{toastMessage.title}</div>
            <div className="text-caption text-slate-300">{toastMessage.description}</div>
          </div>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 1. Page Header with Controls */}
      <InsightsHeader
        selectedCategory={categoryFilter}
        onCategoryChange={setCategoryFilter}
        selectedSeverity={severityFilter}
        onSeverityChange={setSeverityFilter}
        selectedStatus={statusFilter}
        onStatusChange={setStatusFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        lastUpdated={aiData.lastUpdated}
      />

      {/* 2. AI Insights KPI Cards */}
      <InsightsKpis kpis={aiData.kpis} />

      {/* 3. Core Decision Intelligence: Operational Recommendations (Left) + Alerts (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
        <div className="relative xl:min-h-[520px]">
        <RecommendationFeed
          insights={filteredInsights}
          onViewExplanation={(insight) => setActiveExplanation(insight)}
          onOpenTaskModal={(insight) => setTaskModalInsight(insight)}
          onExecuteAction={handleExecuteAction}
          onOpenDismissModal={(insight) => setDismissModalInsight(insight)}
        />
        </div>

        <div className="flex flex-col gap-4">
          <RetailOpportunityCards opportunities={aiData.opportunities} />
        </div>
      </div>

      {/* Explainable AI Telemetry Drawer */}
      <ExplainableAiDrawer
        insight={activeExplanation}
        isOpen={Boolean(activeExplanation)}
        onClose={() => setActiveExplanation(null)}
        onOpenTaskModal={(insight) => {
          setActiveExplanation(null);
          setTaskModalInsight(insight);
        }}
        onExecuteAction={handleExecuteAction}
      />

      {/* Dispatch Staff Task Modal */}
      <AssignStaffTaskModal
        insight={taskModalInsight}
        isOpen={Boolean(taskModalInsight)}
        onClose={() => setTaskModalInsight(null)}
        onSubmit={handleDispatchTask}
      />

      {/* Dismiss Insight Audit Modal */}
      <DismissInsightModal
        insight={dismissModalInsight}
        isOpen={Boolean(dismissModalInsight)}
        onClose={() => setDismissModalInsight(null)}
        onConfirm={handleConfirmDismiss}
      />
    </div>
  );
};
export default AiInsights;
