import { BackendState } from '../components/common/BackendState';
import { isAbort } from '../services/api/client';
import { useLiveRefresh } from '../services/api/realtime';
import React, { useState, useEffect, useCallback } from 'react';
import { useStore } from '../context/StoreContext';
import { apiService } from '../services/apiService';
import type { ShopperAnalyticsData, TimeOfDayFilter } from '../types/retail';
import { ShopperHeader } from '../components/shopper/ShopperHeader';
import { ShopperKpis } from '../components/shopper/ShopperKpis';
import { UnifiedShopperMap } from '../components/shopper/UnifiedShopperMap';
import { IS_DEMO_MODE } from '../services/api/config';
import { DataNotice } from '../components/common/BackendState';
import { ShopperAiInsightsPanel } from '../components/shopper/ShopperAiInsightsPanel';
import { FootfallChart } from '../components/shopper/FootfallChart';
import { DepartmentDwellChart } from '../components/shopper/DepartmentDwellChart';

export const ShopperAnalytics: React.FC = () => {
  const { selectedStoreId, dateRange, setDateRange } = useStore();
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDayFilter>('all_day');
  const [shopperData, setShopperData] = useState<ShopperAnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [selectedPathId, setSelectedPathId] = useState<string>('all');
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

  const loadShopperData = useCallback(async (isRefresh: boolean = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const data = await apiService.getShopperAnalytics(selectedStoreId, dateRange, timeOfDay);
      setShopperData(data);
      setLoadError(null);
    } catch (err) {
      if (!isAbort(err)) setLoadError(err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedStoreId, dateRange, timeOfDay]);

  useEffect(() => {
    loadShopperData(false);
  }, [loadShopperData]);

  useLiveRefresh(['footfall.', 'occupancy.'], () => void loadShopperData(true));

  const handleRefresh = async () => {
    await loadShopperData(true);
  };

  const [isFullWidthMap, setIsFullWidthMap] = useState<boolean>(false);

  if (loadError && !shopperData) {
    return <BackendState error={loadError} onRetry={() => void loadShopperData(true)} what="Shopper Analytics" />;
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* 1. Sleek Action Bar */}
      <ShopperHeader
        timeOfDay={timeOfDay}
        setTimeOfDay={setTimeOfDay}
        shopperData={shopperData}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />

      {shopperData && !IS_DEMO_MODE && <DataNotice state={shopperData.dataState} note={shopperData.dataNote} />}

      {/* 2. Key Shopper Metrics (Single Row of 6 Cards) */}
      <ShopperKpis data={shopperData} isLoading={isLoading} />

      {/* 3. Core Store Floor Plan Workspace (Panoramic Full-Width or Split with AI Insights) */}
      {shopperData && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            {/* Store Movement Floor Plan Canvas */}
            <div className={`${isFullWidthMap ? 'xl:col-span-12' : 'xl:col-span-7'} [&>*]:h-full`}>
              <UnifiedShopperMap
                topPaths={shopperData.movementPatterns.topPaths}
                zones={shopperData.zones}
                transitions={shopperData.movementPatterns.transitions}
                selectedPathId={selectedPathId}
                onSelectPathId={setSelectedPathId}
                selectedZoneId={selectedZoneId}
                onSelectZoneId={setSelectedZoneId}
                isExpandedFullWidth={isFullWidthMap}
                onToggleFullWidth={() => setIsFullWidthMap(!isFullWidthMap)}
              />
            </div>

            {/* AI Insights Panel (Available in split view or below in full width view) */}
            {!isFullWidthMap && (
              <div className="xl:col-span-5 [&>*]:h-full">
                <ShopperAiInsightsPanel
                  insights={shopperData.insights}
                  onSelectZone={(zoneId) => setSelectedZoneId(zoneId)}
                />
              </div>
            )}
          </div>

          {/* When in Full Width Map mode, show AI insights in a sleek horizontal card banner */}
          {isFullWidthMap && (
            <div className="grid grid-cols-1">
              <ShopperAiInsightsPanel
                insights={shopperData.insights}
                onSelectZone={(zoneId) => setSelectedZoneId(zoneId)}
              />
            </div>
          )}
        </div>
      )}

      {/* 4. Analytics Graphs (Below the Store Map & AI Insights) */}
      {shopperData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <FootfallChart
            data={shopperData}
            dateRange={dateRange}
            setDateRange={setDateRange}
          />
          <DepartmentDwellChart
            dwellData={shopperData.dwellAnalytics}
            selectedZoneId={selectedZoneId}
            onSelectZone={(zoneId) => setSelectedZoneId(zoneId)}
          />
        </div>
      )}
    </div>
  );
};

export default ShopperAnalytics;
