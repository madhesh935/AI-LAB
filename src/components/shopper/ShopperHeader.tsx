import React, { useState } from 'react';
import {
  Download,
  Check,
  Calendar,
  Clock,
} from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import type { DateRange, TimeOfDayFilter, ShopperAnalyticsData } from '../../types/retail';

interface ShopperHeaderProps {
  timeOfDay: TimeOfDayFilter;
  setTimeOfDay: (filter: TimeOfDayFilter) => void;
  shopperData: ShopperAnalyticsData | null;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const ShopperHeader: React.FC<ShopperHeaderProps> = ({
  timeOfDay,
  setTimeOfDay,
  shopperData,
}) => {
  const { selectedStore, dateRange, setDateRange } = useStore();
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const dateOptions: { label: string; value: DateRange }[] = [
    { label: 'Today', value: 'today' },
    { label: '7D', value: 'week' },
    { label: '30D', value: 'month' },
  ];

  const timeOptions: { label: string; value: TimeOfDayFilter }[] = [
    { label: 'Full Day', value: 'all_day' },
    { label: 'Morning (08-12)', value: 'morning' },
    { label: 'Afternoon (12-17)', value: 'afternoon' },
    { label: 'Evening Peak (17-21)', value: 'evening' },
  ];

  const handleExportCSV = () => {
    if (!shopperData) return;

    const headers = ['Time Slot', 'Customer Entries', 'Customer Exits', 'Store Occupancy', 'Previous Period Entries'];
    const rows = shopperData.footfallTrend.map((row) => [
      row.time,
      row.entries,
      row.exits,
      row.occupancy,
      row.previousPeriodEntries,
    ]);

    const zoneHeaders = ['Zone ID', 'Zone Name', 'Department', 'Total Visitors', 'Current Occupancy', 'Avg Dwell (Mins)', 'Density Score (0-100)'];
    const zoneRows = shopperData.zones.map((z) => [
      z.zoneId,
      `"${z.zoneName}"`,
      `"${z.category}"`,
      z.totalVisitors,
      z.currentOccupancy,
      z.avgDwellMinutes,
      z.densityScore,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [
        `# RetailEdge AI - Shopper Analytics Report`,
        `# Store: ${selectedStore.name} (${selectedStore.code})`,
        `# Period: ${dateRange.toUpperCase()} | Window: ${timeOfDay.toUpperCase()}`,
        `# Generated At: ${new Date().toISOString()}`,
        ``,
        `=== HOURLY FOOTFALL TRAFFIC ===`,
        headers.join(','),
        ...rows.map((r) => r.join(',')),
        ``,
        `=== STORE ZONE PERFORMANCE ===`,
        zoneHeaders.join(','),
        ...zoneRows.map((r) => r.join(',')),
      ].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `RetailEdge_ShopperAnalytics_${selectedStore.code}_${dateRange}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 2500);
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
      {/* Time of Day & Range Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Date Filter Segmented Control */}
        <div className="inline-flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
          <Calendar className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-0.5 shrink-0" />
          {dateOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDateRange(opt.value)}
              className={`px-2.5 py-1 font-semibold rounded-md transition-all cursor-pointer ${
                dateRange === opt.value
                  ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Time of Day Window Segmented Control */}
        <div className="inline-flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
          <Clock className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-0.5 shrink-0" />
          {timeOptions.map((t) => (
            <button
              key={t.value}
              onClick={() => setTimeOfDay(t.value)}
              className={`px-2.5 py-1 font-semibold rounded-md transition-all cursor-pointer ${
                timeOfDay === t.value
                  ? 'bg-white text-blue-700 shadow-2xs font-semibold'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Export Action */}
      <div className="flex items-center gap-2 self-end sm:self-auto">
        <button
          onClick={handleExportCSV}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition flex items-center gap-1.5 shadow-2xs cursor-pointer"
          title="Export CSV report"
        >
          {downloadSuccess ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-emerald-700 font-semibold">Downloaded!</span>
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Export CSV</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default ShopperHeader;
