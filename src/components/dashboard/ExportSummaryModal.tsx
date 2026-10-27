import { fmt, signed, barPct, isNum } from '../../utils/display';
import React, { useState } from 'react';
import { Download, Printer, Copy, Check } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';

export const ExportSummaryModal: React.FC = () => {
  const { isExportModalOpen, setIsExportModalOpen, overviewData, selectedStore, dateRange } = useStore();
  const [copied, setCopied] = useState(false);

  if (!isExportModalOpen || !overviewData) return null;

  const { metrics, alerts } = overviewData;

  const exportPayload = {
    reportTitle: `RetailEdge AI Store Performance Brief - ${selectedStore.name}`,
    generatedAt: new Date().toISOString(),
    store: {
      name: selectedStore.name,
      code: selectedStore.code,
      city: selectedStore.city,
      squareFootage: selectedStore.squareFootage,
    },
    reportingRange: dateRange,
    kpis: {
      footfallToday: metrics.totalFootfallToday,
      currentOccupancy: `${metrics.currentOccupancy} / ${metrics.maxCapacity} (${metrics.occupancyPercentage}%)`,
      averageDwellTimeMinutes: metrics.averageDwellTimeMinutes,
      activeLowStockShelves: metrics.lowStockShelvesCount,
      outOfStockShelves: metrics.outOfStockShelvesCount,
      activeQueues: metrics.activeCheckoutQueuesCount,
      averageWaitTimeMinutes: metrics.averageWaitTimeMinutes,
    },
    activeCriticalAlerts: alerts.filter((a) => a.status === 'active').map((a) => ({
      title: a.title,
      severity: a.severity,
      zone: a.zone,
      action: a.recommendedAction,
    })),
  };

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(exportPayload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportPayload, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `RetailEdge_Summary_${selectedStore.code}_${dateRange}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <Modal
      isOpen={isExportModalOpen}
      onClose={() => setIsExportModalOpen(false)}
      title="Store Intelligence Summary Export"
      description="Download or print real-time executive analytics for store operations"
      size="lg"
    >
      <div className="p-6 space-y-5">
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h4 className="text-sm font-semibold text-slate-900">{selectedStore.name}</h4>
              <p className="text-xs text-slate-500">Period: {dateRange.toUpperCase()} &bull; Code: {selectedStore.code}</p>
            </div>
            <Badge variant="primary" size="sm">
              Live snapshot
            </Badge>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-200/80">
            <div>
              <p className="text-caption text-slate-400">Total Footfall</p>
              <p className="text-base font-semibold text-slate-900">{fmt(metrics.totalFootfallToday)}</p>
            </div>
            <div>
              <p className="text-caption text-slate-400">Current Occupancy</p>
              <p className="text-base font-semibold text-slate-900">{metrics.currentOccupancy} ({metrics.occupancyPercentage}%)</p>
            </div>
            <div>
              <p className="text-caption text-slate-400">Avg Dwell Time</p>
              <p className="text-base font-semibold text-slate-900">{metrics.averageDwellTimeMinutes} mins</p>
            </div>
            <div>
              <p className="text-caption text-slate-400">Inventory Alerts</p>
              <p className="text-base font-semibold text-amber-600">
                {metrics.lowStockShelvesCount + metrics.outOfStockShelvesCount} Shelves
              </p>
            </div>
            <div>
              <p className="text-caption text-slate-400">Active Queues</p>
              <p className="text-base font-semibold text-slate-900">{metrics.activeCheckoutQueuesCount} counters</p>
            </div>
            <div>
              <p className="text-caption text-slate-400">Avg Checkout Wait</p>
              <p className="text-base font-semibold text-slate-900">{metrics.averageWaitTimeMinutes} mins</p>
            </div>
          </div>
        </div>

        <div>
          <h5 className="text-xs font-semibold text-slate-900 uppercase tracking-wider mb-2">
            Highlights & open alerts
          </h5>
          <div className="space-y-2">
            {alerts.slice(0, 3).map((a) => (
              <div key={a.id} className="p-3 bg-white rounded-lg border border-slate-200 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900">{a.title}</span>
                  <Badge variant={a.severity === 'critical' ? 'error' : 'warning'} size="sm">
                    {a.severity}
                  </Badge>
                </div>
                <p className="text-slate-500 text-caption mt-1">{a.recommendedAction}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
          <Button variant="outline" size="sm" onClick={handleCopyJson}>
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied to Clipboard' : 'Copy JSON'}
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="w-3.5 h-3.5" />
              Print Report
            </Button>
            <Button variant="primary" size="sm" onClick={handleDownloadJson}>
              <Download className="w-3.5 h-3.5" />
              Download JSON Brief
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
