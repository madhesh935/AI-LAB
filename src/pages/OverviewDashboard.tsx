import React from 'react';
import { KpiCardsSection } from '../components/dashboard/KpiCardsSection';
import { CameraSection } from '../components/dashboard/CameraSection';
import { TrafficAnalyticsSection } from '../components/dashboard/TrafficAnalyticsSection';
import { InventorySnapshotSection } from '../components/dashboard/InventorySnapshotSection';
import { QueueSnapshotSection } from '../components/dashboard/QueueSnapshotSection';
import { AiActionCenterSection } from '../components/dashboard/AiActionCenterSection';
import { BackendState } from '../components/common/BackendState';
import { useStore } from '../context/StoreContext';

export const OverviewDashboard: React.FC = () => {
  const { overviewData, overviewError, refreshData } = useStore();
  if (overviewError && !overviewData) {
    return <BackendState error={overviewError} onRetry={() => void refreshData()} what="The store overview" />;
  }
  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* 1. Key Store Metrics (Single Row) */}
      <KpiCardsSection />

      {/* 2. Live AI Cameras (Single Row of 4 Feeds) */}
      <CameraSection />

      {/* 3. Inventory Status & Checkout Queues */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <InventorySnapshotSection />
        <QueueSnapshotSection />
      </div>

      {/* 4. Customer Traffic Trend (left) and AI Action Center (right), one row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch [&>*]:h-full">
        <TrafficAnalyticsSection />
        <AiActionCenterSection />
      </div>
    </div>
  );
};

export default OverviewDashboard;
