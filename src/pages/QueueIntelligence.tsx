import { BackendState } from '../components/common/BackendState';
import { isAbort } from '../services/api/client';
import { useLiveRefresh } from '../services/api/realtime';
import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../context/StoreContext';
import { apiService } from '../services/apiService';
import type {
  QueueIntelligenceData,
  CheckoutCounter,
  CheckoutCounterStatus,
  StaffingRecommendation,
  QueueAlert,
  QueueRulesConfig,
  CameraFeed,
} from '../types/retail';
import { DEFAULT_QUEUE_RULES_CONFIG } from '../services/mockData';

// Queue Intelligence Subcomponents
import { QueueHeader } from '../components/queue/QueueHeader';
import { QueueKpis } from '../components/queue/QueueKpis';
import { LiveCheckoutCamera } from '../components/queue/LiveCheckoutCamera';
import { CheckoutCounterGrid } from '../components/queue/CheckoutCounterGrid';
import { CounterDetailModal } from '../components/queue/CounterDetailModal';
import { QueueCongestionForecastSection } from '../components/queue/QueueCongestionForecast';
import { QueueHistoryPanel } from '../components/queue/QueueHistoryPanel';
import { StaffingRecommendationPanel } from '../components/queue/StaffingRecommendationPanel';
import { LiveCheckoutCameraReal } from '../components/queue/LiveCheckoutCameraReal';
import { IS_DEMO_MODE } from '../services/api/config';
import { StaffDispatchModal } from '../components/queue/StaffDispatchModal';
import { QueueAlertsSection } from '../components/queue/QueueAlertsSection';
import { QueueRulesConfigDrawer } from '../components/queue/QueueRulesConfigDrawer';
import { Card } from '../components/common/Card';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export const QueueIntelligence: React.FC = () => {
  const { selectedStoreId, dateRange, setDateRange } = useStore();
  const [checkoutSection, setCheckoutSection] = useState<string>('all');
  const [rulesConfig, setRulesConfig] = useState<QueueRulesConfig>(DEFAULT_QUEUE_RULES_CONFIG);

  const [queueData, setQueueData] = useState<QueueIntelligenceData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [selectedFeedId, setSelectedFeedId] = useState<string>('CAM-03');

  // Modals & Drawers state
  const [selectedCounter, setSelectedCounter] = useState<CheckoutCounter | null>(null);
  const [isCounterModalOpen, setIsCounterModalOpen] = useState<boolean>(false);

  const [dispatchRecommendation, setDispatchRecommendation] = useState<StaffingRecommendation | null>(null);
  const [isDispatchModalOpen, setIsDispatchModalOpen] = useState<boolean>(false);

  const [isRulesDrawerOpen, setIsRulesDrawerOpen] = useState<boolean>(false);

  // Success Toast state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const loadData = useCallback(
    async (isRefresh: boolean = false) => {
      if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      try {
        const data = await apiService.getQueueIntelligenceData(
          selectedStoreId,
          dateRange,
          checkoutSection,
          rulesConfig
        );
        setQueueData(data);
      setLoadError(null);
      } catch (err) {
        if (!isAbort(err)) setLoadError(err);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [selectedStoreId, dateRange, checkoutSection, rulesConfig]
  );

  useEffect(() => {
    loadData(false);
  }, [loadData]);

  useLiveRefresh(['queue.', 'task.', 'alert.'], () => void loadData(true));

  // REAL mode: the saved SLA rules live on the server; adopt them (once per change) instead of the built-in defaults.
  const serverRules = queueData?.rulesConfig;
  useEffect(() => {
    if (IS_DEMO_MODE || !serverRules) return;
    setRulesConfig((cur) => (JSON.stringify(cur) === JSON.stringify(serverRules) ? cur : serverRules));
  }, [serverRules]);

  const handleRefresh = async () => {
    await loadData(true);
  };

  // Toggle or Update Counter Status (e.g. Open Backup Counter, Pause, Resume)
  const handleToggleCounterStatus = async (
    counterId: string,
    currentStatus: CheckoutCounter['status']
  ) => {
    const nextStatus: CheckoutCounterStatus =
      currentStatus === 'standby' ? 'open' : currentStatus === 'open' ? 'paused' : 'open';

    try {
      await apiService.updateCounterStatus(selectedStoreId, counterId, nextStatus);

      setQueueData((prev) => {
        if (!prev) return null;
        const updatedCounters = prev.counters.map((c) => {
          if (c.id === counterId) {
            return {
              ...c,
              status: nextStatus,
              lastUpdated: 'Just now (Status changed)',
            };
          }
          return c;
        });

        const activeCount = updatedCounters.filter((c) => c.status === 'open').length;

        return {
          ...prev,
          counters: updatedCounters,
          kpis: {
            ...prev.kpis,
            activeCounters: activeCount,
          },
        };
      });

      showToast(`Counter ${counterId.toUpperCase()} status updated to ${nextStatus.toUpperCase()}`);
    } catch (err) {
      console.error(err);
    }
  };

  // Inspect counter modal trigger
  const handleSelectCounter = (counter: CheckoutCounter) => {
    setSelectedCounter(counter);
    setIsCounterModalOpen(true);
  };

  // Dispatch staff recommendation
  const handleOpenDispatchModal = (rec: StaffingRecommendation) => {
    setDispatchRecommendation(rec);
    setIsDispatchModalOpen(true);
  };

  const handleDispatchStaff = async (staffId: string, counterId: string, notes: string) => {
    if (!dispatchRecommendation) return;

    try {
      await apiService.deployStaffingRecommendation(
        selectedStoreId,
        dispatchRecommendation.id,
        staffId,
        counterId
      );

      // Update state: mark recommendation deployed, activate counter 5, assign staff
      setQueueData((prev) => {
        if (!prev) return null;

        const updatedRecs = prev.staffingRecommendations.map((r) =>
          r.id === dispatchRecommendation.id ? { ...r, status: 'deployed' as const } : r
        );

        const assignedStaff = prev.availableStaff.find((s) => s.id === staffId);

        const updatedCounters = prev.counters.map((c) => {
          if (c.id === counterId) {
            return {
              ...c,
              status: 'open' as const,
              cashierName: assignedStaff ? assignedStaff.name : 'Pooja Nair',
              cashierRole: assignedStaff ? `${assignedStaff.role} (Relief)` : 'Relief Cashier',
              cashierAvatar: assignedStaff ? assignedStaff.avatar : 'PN',
              lastUpdated: 'Just now (Cashier Deployed)',
            };
          }
          return c;
        });

        return {
          ...prev,
          staffingRecommendations: updatedRecs,
          counters: updatedCounters,
          kpis: {
            ...prev.kpis,
            activeCounters: updatedCounters.filter((c) => c.status === 'open').length,
            congestedCountersCount: Math.max(0, prev.kpis.congestedCountersCount - 1),
          },
        };
      });

      showToast(
        `Staff associate successfully deployed to ${dispatchRecommendation.targetCounterName}. Counter terminal activated!`
      );
    } catch (err) {
      console.error(err);
    }
  };

  const handleAcknowledgeRecommendation = (recId: string) => {
    setQueueData((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        staffingRecommendations: prev.staffingRecommendations.map((r) =>
          r.id === recId ? { ...r, status: 'acknowledged' as const } : r
        ),
      };
    });
    showToast('Recommendation acknowledged.');
  };

  // Alert management
  const handleAcknowledgeAlert = async (alertId: string) => {
    try {
      await apiService.resolveQueueAlert(selectedStoreId, alertId, 'acknowledge');
      setQueueData((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          queueAlerts: prev.queueAlerts.map((a) =>
            a.id === alertId ? { ...a, status: 'acknowledged' as const } : a
          ),
        };
      });
      showToast('Queue alert acknowledged.');
    } catch (err) {
      console.error(err);
    }
  };

  const handleResolveAlert = async (alertId: string) => {
    try {
      await apiService.resolveQueueAlert(selectedStoreId, alertId, 'resolve');
      setQueueData((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          queueAlerts: prev.queueAlerts.map((a) =>
            a.id === alertId ? { ...a, status: 'resolved' as const } : a
          ),
        };
      });
      showToast('Queue alert marked resolved.');
    } catch (err) {
      console.error(err);
    }
  };

  // Save in-page queue rules config
  const handleSaveRulesConfig = async (newConfig: QueueRulesConfig) => {
    try {
      await apiService.saveQueueRulesConfig(selectedStoreId, newConfig);
      setRulesConfig(newConfig);
      showToast('Queue SLA thresholds and rules configuration saved.');
    } catch (err) {
      console.error(err);
    }
  };

  const handleResetRulesDefaults = () => {
    setRulesConfig(DEFAULT_QUEUE_RULES_CONFIG);
    showToast('Queue SLA rules restored to default factory values.');
  };

  if (loadError && !queueData) {
    return <BackendState error={loadError} onRetry={() => void loadData(true)} what="Queue Intelligence" />;
  }

  if (isLoading || !queueData) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-20 rounded-xl bg-slate-200" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 rounded-xl bg-slate-200" />
          ))}
        </div>
        <div className="h-80 rounded-xl bg-slate-200" />
        <div className="h-64 rounded-xl bg-slate-200" />
      </div>
    );
  }

  const currentCameraFeed =
    queueData.cameraFeedsList.find((f) => f.id === selectedFeedId) || queueData.cameraFeed;

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-3 text-white shadow-xl animate-in slide-in-from-bottom duration-300">
          <CheckCircle2 className="h-5 w-5 text-white" />
          <span className="text-xs font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* 1. Page Header Toolbar */}
      <QueueHeader
        selectedSection={checkoutSection}
        onSectionChange={setCheckoutSection}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        onOpenRulesConfig={() => setIsRulesDrawerOpen(true)}
        lastUpdated={queueData.lastUpdated}
      />

      {/* 2. Key Performance Indicators (Single Row of 6 Cards) */}
      <QueueKpis kpis={queueData.kpis} />

      {/* 3. Checkout Counter Stations (Four checkouts displayed in a row) */}
      <CheckoutCounterGrid
        counters={queueData.counters}
        selectedCounterId={selectedCounter?.id || null}
        onSelectCounter={handleSelectCounter}
        onToggleStatus={handleToggleCounterStatus}
      />

      {/* 4. Camera Feed (Left) & Queue Forecast (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
        {currentCameraFeed ? (
          IS_DEMO_MODE ? (
          <LiveCheckoutCamera
            currentFeed={currentCameraFeed}
            allFeeds={queueData.cameraFeedsList}
            onSelectFeed={setSelectedFeedId}
            waitingCount={queueData.kpis.waitingCustomers}
            maxWaitMinutes={queueData.kpis.longestQueueWaitMinutes}
          />
          ) : (
          <LiveCheckoutCameraReal
            currentFeed={currentCameraFeed}
            allFeeds={queueData.cameraFeedsList}
            onSelectFeed={setSelectedFeedId}
            waitingCount={queueData.kpis.waitingCustomers}
            maxWaitMinutes={queueData.kpis.longestQueueWaitMinutes}
          />
          )
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
            <div className="font-semibold text-slate-700">No checkout camera</div>
            <p className="mt-1">No camera is registered for the checkout area of this store.</p>
          </div>
        )}

        {IS_DEMO_MODE ? (
          <QueueCongestionForecastSection
            forecasts={queueData.forecast}
            slaThresholdMinutes={rulesConfig.slaCriticalWaitMinutes}
          />
        ) : (
          <QueueHistoryPanel history={queueData.historicalAnalytics} />
        )}
      </div>

      {/* 5. Queue Alerts (Left) & AI Staffing & Lane Dispatch (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <QueueAlertsSection
          alerts={queueData.queueAlerts}
          onAcknowledgeAlert={handleAcknowledgeAlert}
          onResolveAlert={handleResolveAlert}
        />

        <StaffingRecommendationPanel
          recommendations={queueData.staffingRecommendations}
          onOpenDispatchModal={handleOpenDispatchModal}
          onAcknowledge={handleAcknowledgeRecommendation}
          reliefStaffCount={queueData.availableStaff.filter((s) => s.status === 'available').length}
        />
      </div>

      {/* Modals and Drawers */}
      {/* Counter Detail Inspection Modal */}
      <CounterDetailModal
        counter={selectedCounter}
        isOpen={isCounterModalOpen}
        onClose={() => setIsCounterModalOpen(false)}
        onUpdateStatus={(id, status) => {
          handleToggleCounterStatus(id, status === 'open' ? 'paused' : 'open');
          setIsCounterModalOpen(false);
        }}
      />

      {/* Staff Associate Dispatch Modal */}
      <StaffDispatchModal
        isOpen={isDispatchModalOpen}
        onClose={() => setIsDispatchModalOpen(false)}
        recommendation={dispatchRecommendation}
        availableStaff={queueData.availableStaff}
        onDispatch={handleDispatchStaff}
      />

      {/* In-Page Queue Rules Configuration Drawer */}
      <QueueRulesConfigDrawer
        isOpen={isRulesDrawerOpen}
        onClose={() => setIsRulesDrawerOpen(false)}
        config={rulesConfig}
        onSaveConfig={handleSaveRulesConfig}
        onResetDefaults={handleResetRulesDefaults}
      />
    </div>
  );
};
