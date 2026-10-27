import { apiService } from '../../services/apiService';
import { IS_DEMO_MODE } from '../../services/api/config';
import React, { useState } from 'react';
import {
  Download,
  Printer,
  Copy,
  Check,
  FileSpreadsheet,
  FileText,
  X,
  Sparkles,
} from 'lucide-react';
import type { ReportSummaryData, ReportCategory, Store } from '../../types/retail';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';

interface ExportReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportData: ReportSummaryData;
  activeCategory: ReportCategory;
  selectedStore: Store;
}

export const ExportReportModal: React.FC<ExportReportModalProps> = ({
  isOpen,
  onClose,
  reportData,
  activeCategory,
  selectedStore,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleDownloadCsv = () => {
    if (!IS_DEMO_MODE) {
      // REAL mode: the server builds the CSV from stored records (same numbers as the page, formula-injection safe).
      const a = document.createElement('a');
      a.href = apiService.reportCsvUrl(selectedStore.id, activeCategory, reportData.dateRange, reportData.comparePeriod);
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }
    let csvContent = '';
    let filename = `RetailEdge_${activeCategory.toUpperCase()}_${selectedStore.code}_${reportData.dateRange}.csv`;

    if (activeCategory === 'overview') {
      const headers = ['Metric', 'Current Period', 'Previous Period', 'Delta', 'Percent Change', 'Unit'];
      const k = reportData.overview.kpis;
      const rows = [
        ['Total Customer Footfall', k.totalFootfall.current, k.totalFootfall.previous ?? '', k.totalFootfall.delta ?? '', `${k.totalFootfall.percentChange ?? ''}%`, k.totalFootfall.unit],
        ['Average Dwell Time', k.averageDwellTimeMinutes.current, k.averageDwellTimeMinutes.previous ?? '', k.averageDwellTimeMinutes.delta ?? '', `${k.averageDwellTimeMinutes.percentChange ?? ''}%`, k.averageDwellTimeMinutes.unit],
        ['Detected Low-Stock Events', k.detectedLowStockEvents.current, k.detectedLowStockEvents.previous ?? '', k.detectedLowStockEvents.delta ?? '', `${k.detectedLowStockEvents.percentChange ?? ''}%`, k.detectedLowStockEvents.unit],
        ['Average Queue Wait', k.averageQueueWaitMinutes.current, k.averageQueueWaitMinutes.previous ?? '', k.averageQueueWaitMinutes.delta ?? '', `${k.averageQueueWaitMinutes.percentChange ?? ''}%`, k.averageQueueWaitMinutes.unit],
        ['Completed Tasks', k.completedTasks.current, k.completedTasks.previous ?? '', k.completedTasks.delta ?? '', `${k.completedTasks.percentChange ?? ''}%`, k.completedTasks.unit],
        ['Critical Incidents', k.criticalIncidents.current, k.criticalIncidents.previous ?? '', k.criticalIncidents.delta ?? '', `${k.criticalIncidents.percentChange ?? ''}%`, k.criticalIncidents.unit],
      ];
      csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\r\n');
    } else if (activeCategory === 'shoppers') {
      const headers = ['Date', 'Entries', 'Exits', 'Net Change', 'Peak Hour', 'Peak Volume', 'Avg Dwell Minutes', 'Bounce Rate Pct'];
      const rows = reportData.shoppers.dailyFootfall.map((d) => [
        d.date, d.entries, d.exits, d.netOccupancyChange, d.peakHour, d.peakVolume, d.avgDwellTimeMinutes, `${d.bounceRateEstimatedPct}%`
      ]);
      csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\r\n');
    } else if (activeCategory === 'inventory') {
      const headers = ['Incident ID', 'Timestamp', 'Shelf ID', 'Product', 'Department', 'Duration Minutes', 'Restocked By', 'Status'];
      const rows = reportData.inventory.stockoutLog.map((s) => [
        s.id, s.timestamp, s.shelfId, s.product, s.department, s.durationMinutes, s.restockedBy, s.status
      ]);
      csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\r\n');
    } else if (activeCategory === 'queues') {
      const headers = ['Alert ID', 'Timestamp', 'Counter ID', 'Trigger Wait (min)', 'Resolution (min)', 'Action Taken', 'Status'];
      const rows = reportData.queues.queueAlertLog.map((q) => [
        q.id, q.timestamp, q.counterId, q.triggerWaitMinutes, q.resolutionMinutes, q.actionTaken, q.status
      ]);
      csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\r\n');
    } else {
      const headers = ['Event ID', 'Timestamp', 'Event Type', 'Zone', 'Detail', 'Response Time (min)', 'Status'];
      const rows = reportData.operations.operationsEventLog.map((o) => [
        o.id, o.timestamp, o.eventType, o.zone, o.detail, o.responseTimeMinutes, o.status
      ]);
      csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\r\n');
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(reportData, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    onClose();
    setTimeout(() => {
      window.print();
    }, 200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 border border-blue-200">
              <Download className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Export Performance Report</h2>
              
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Metadata Callout */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2 text-xs">
            <div className="flex items-center justify-between font-semibold text-slate-900">
              <span>{selectedStore.name}</span>
              <Badge variant="primary" size="sm">
                {selectedStore.code}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-caption text-slate-600 pt-1 border-t border-slate-200">
              <div>Module: <strong className="capitalize text-slate-800">{activeCategory}</strong></div>
              <div>Interval: <strong className="text-slate-800">{reportData.dateRange}</strong></div>
              <div>Comparison: <strong className="text-slate-800">{reportData.comparePeriod.replace('_', ' ')}</strong></div>
              <div>Generated: <strong className="text-slate-800">{new Date(reportData.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></div>
            </div>
          </div>

          {/* Export Options Grid */}
          <div className="space-y-2.5">
            {/* 1. CSV Download */}
            <button
              onClick={handleDownloadCsv}
              className="w-full flex items-center justify-between rounded-xl border border-slate-200 p-3.5 hover:border-emerald-500 hover:bg-emerald-50/20 text-left transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-900 group-hover:text-emerald-700">
                    Download CSV
                  </div>
                  <div className="text-caption text-slate-500">
                    Spreadsheet-friendly
                  </div>
                </div>
              </div>
              <Download className="h-4 w-4 text-slate-400 group-hover:text-emerald-600" />
            </button>

            {/* 2. PDF / Print Export */}
            <button
              onClick={handlePrint}
              className="w-full flex items-center justify-between rounded-xl border border-slate-200 p-3.5 hover:border-blue-500 hover:bg-blue-50/20 text-left transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 border border-blue-200">
                  <Printer className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-900 group-hover:text-blue-700">
                    Print or save PDF
                  </div>
                  <div className="text-caption text-slate-500">
                    Clean layout for printing
                  </div>
                </div>
              </div>
              <Printer className="h-4 w-4 text-slate-400 group-hover:text-blue-600" />
            </button>

            {/* 3. Copy JSON */}
            <button
              onClick={handleCopyJson}
              className="w-full flex items-center justify-between rounded-xl border border-slate-200 p-3.5 hover:border-indigo-500 hover:bg-indigo-50/20 text-left transition-all group"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-200">
                  <Copy className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-900 group-hover:text-indigo-700">
                    {copied ? 'Copied JSON to Clipboard!' : 'Copy Telemetry JSON Payload'}
                  </div>
                  <div className="text-caption text-slate-500">
                    Raw data
                  </div>
                </div>
              </div>
              {copied ? (
                <Check className="h-4 w-4 text-emerald-600 font-semibold" />
              ) : (
                <Copy className="h-4 w-4 text-slate-400 group-hover:text-indigo-600" />
              )}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3 border-t border-slate-200">
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs font-semibold">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
