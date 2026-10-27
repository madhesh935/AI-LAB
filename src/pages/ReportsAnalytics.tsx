import { BackendState } from '../components/common/BackendState';
import { isAbort } from '../services/api/client';
import { useLiveRefresh } from '../services/api/realtime';
import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  Calendar,
  Layers,
  ArrowRightLeft,
  Download,
  Printer,
  Bookmark,
  RefreshCw,
  Clock,
  Sparkles,
  ShoppingBag,
  Package,
  CreditCard,
  Cpu,
  Check,
  X,
  Building2,
} from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { apiService } from '../services/apiService';
import type {
  ReportSummaryData,
  ReportCategory,
  ComparePeriod,
  ReportConfiguration,
  DateRange,
} from '../types/retail';
import { ReportsHeader } from '../components/reports/ReportsHeader';
import { ExecutiveOverviewTab } from '../components/reports/ExecutiveOverviewTab';
import { ShopperReportTab } from '../components/reports/ShopperReportTab';
import { InventoryReportTab } from '../components/reports/InventoryReportTab';
import { QueueReportTab } from '../components/reports/QueueReportTab';
import { OperationsReportTab } from '../components/reports/OperationsReportTab';
import { SavedReportsModal } from '../components/reports/SavedReportsModal';
import { ExportReportModal } from '../components/reports/ExportReportModal';

export const ReportsAnalytics: React.FC = () => {
  const { selectedStore, selectedStoreId, dateRange, setDateRange } = useStore();

  const [activeCategory, setActiveCategory] = useState<ReportCategory>('overview');
  const [comparePeriod, setComparePeriod] = useState<ComparePeriod>('previous_period');
  const [reportData, setReportData] = useState<ReportSummaryData | null>(null);
  const [savedConfigs, setSavedConfigs] = useState<ReportConfiguration[]>([]);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Modals
  const [isSavedModalOpen, setIsSavedModalOpen] = useState<boolean>(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);

  // Toast
  const [toastMessage, setToastMessage] = useState<{ title: string; detail: string } | null>(null);

  const showToast = (title: string, detail: string) => {
    setToastMessage({ title, detail });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Fetch report data
  const loadReports = useCallback(async () => {
    try {
      const data = await apiService.getStoreReportsData(
        selectedStoreId,
        activeCategory,
        dateRange,
        comparePeriod
      );
      setReportData(data);
      setLoadError(null);
    } catch (err) {
      if (!isAbort(err)) setLoadError(err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedStoreId, activeCategory, dateRange, comparePeriod]);

  // Load saved configurations
  const loadSavedConfigs = useCallback(async () => {
    try {
      const configs = await apiService.getSavedReportConfigurations();
      setSavedConfigs(configs);
    } catch (err) {
      console.error('Failed to load saved report configs:', err);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    loadReports();
  }, [loadReports]);

  useEffect(() => {
    loadSavedConfigs();
  }, [loadSavedConfigs]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadReports();
    showToast('Report Data Refreshed', 'Telemetry figures updated against comparison baseline.');
  };

  const handleApplyConfig = (config: ReportConfiguration) => {
    setActiveCategory(config.category);
    setDateRange(config.dateRange);
    setComparePeriod(config.comparePeriod);
    setActiveConfigId(config.id);
    showToast('Configuration Loaded', `Applied preset: "${config.name}".`);
  };

  const handleSaveNewConfig = async (name: string) => {
    const newConfig: ReportConfiguration = {
      id: `cfg-${Date.now()}`,
      name,
      category: activeCategory,
      dateRange,
      comparePeriod,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await apiService.saveReportConfiguration(newConfig);
    await loadSavedConfigs();
    setActiveConfigId(newConfig.id);
    showToast('Report Saved', `Preset "${name}" saved to your report workspace.`);
  };

  const handleRenameConfig = async (configId: string, newName: string) => {
    const existing = savedConfigs.find((c) => c.id === configId);
    if (!existing) return;
    const updated: ReportConfiguration = {
      ...existing,
      name: newName,
      updatedAt: new Date().toISOString(),
    };
    await apiService.saveReportConfiguration(updated);
    await loadSavedConfigs();
    showToast('Preset Renamed', `Updated preset title to "${newName}".`);
  };

  const handleDeleteConfig = async (configId: string) => {
    await apiService.deleteSavedReportConfiguration(configId);
    await loadSavedConfigs();
    if (activeConfigId === configId) setActiveConfigId(null);
    showToast('Preset Removed', 'The report configuration was deleted.');
  };

  if (loadError && !reportData) {
    return <BackendState error={loadError} onRetry={() => void loadReports()} what="Reports" />;
  }

  if (isLoading || !reportData) {
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
          <div className="h-10 w-52 rounded-xl bg-slate-200" />
        </div>

        <div className="h-12 w-full rounded-2xl bg-slate-200" />

        <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-slate-200 border border-slate-200" />
          ))}
        </div>

        <div className="h-80 rounded-2xl bg-slate-200" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Toast Notification Pill */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-2xl bg-slate-900 text-white px-4 py-3 shadow-2xl border border-slate-800 animate-in slide-in-from-bottom-4 duration-200 print:hidden">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400">
            <Check className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-semibold text-white">{toastMessage.title}</div>
            <div className="text-caption text-slate-300">{toastMessage.detail}</div>
          </div>
          <button
            onClick={() => setToastMessage(null)}
            className="ml-2 text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Print-Only Header Sheet */}
      <div className="hidden print:block mb-6 p-4 border-b border-slate-300">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              Store Report
            </h1>
            <p className="text-xs text-slate-600 mt-1">
              Store: {selectedStore.name} ({selectedStore.code}) • {selectedStore.city}
            </p>
          </div>
          <div className="text-right text-xs text-slate-600 font-mono">
            <div>Report Module: {activeCategory.toUpperCase()}</div>
            <div>Interval: {dateRange} ({comparePeriod.replace('_', ' ')})</div>
            <div>Generated: {new Date(reportData.generatedAt).toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* 1. Header with Controls & Category Switcher */}
      <ReportsHeader
        selectedCategory={activeCategory}
        onSelectCategory={(cat) => {
          setActiveCategory(cat);
          setActiveConfigId(null);
        }}
        dateRange={dateRange}
        onDateRangeChange={(range) => {
          setDateRange(range);
          setActiveConfigId(null);
        }}
        comparePeriod={comparePeriod}
        onComparePeriodChange={(cmp) => {
          setComparePeriod(cmp);
          setActiveConfigId(null);
        }}
        savedConfigsCount={savedConfigs.length}
        onOpenSavedModal={() => setIsSavedModalOpen(true)}
        onOpenExportModal={() => setIsExportModalOpen(true)}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        selectedStore={selectedStore}
      />

      {/* 2. Active Tab Content View */}
      <main>
        {activeCategory === 'overview' && (
          <ExecutiveOverviewTab report={reportData.overview} comparePeriod={comparePeriod} />
        )}

        {activeCategory === 'shoppers' && (
          <ShopperReportTab shoppers={reportData.shoppers} comparePeriod={comparePeriod} />
        )}

        {activeCategory === 'inventory' && (
          <InventoryReportTab inventory={reportData.inventory} comparePeriod={comparePeriod} />
        )}

        {activeCategory === 'queues' && (
          <QueueReportTab queues={reportData.queues} comparePeriod={comparePeriod} />
        )}

        {activeCategory === 'operations' && (
          <OperationsReportTab operations={reportData.operations} comparePeriod={comparePeriod} />
        )}
      </main>

      {/* Saved Reports Manager Modal */}
      <SavedReportsModal
        isOpen={isSavedModalOpen}
        onClose={() => setIsSavedModalOpen(false)}
        savedConfigs={savedConfigs}
        activeConfigId={activeConfigId}
        onApplyConfig={handleApplyConfig}
        onSaveNewConfig={handleSaveNewConfig}
        onRenameConfig={handleRenameConfig}
        onDeleteConfig={handleDeleteConfig}
        currentCategory={activeCategory}
        currentDateRange={dateRange}
        currentComparePeriod={comparePeriod}
      />

      {/* Export Report Dialog Modal */}
      <ExportReportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        reportData={reportData}
        activeCategory={activeCategory}
        selectedStore={selectedStore}
      />
    </div>
  );
};

export default ReportsAnalytics;
