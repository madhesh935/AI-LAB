import React, { useState } from 'react';
import {
  Download,
  Search,
  Plus,
  Check,
  Calendar,
  Filter,
} from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import type { DateRange, SmartInventoryData } from '../../types/retail';

interface InventoryHeaderProps {
  departmentFilter: string;
  setDepartmentFilter: (dept: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  inventoryData: SmartInventoryData | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  onOpenCreateTask: () => void;
}

export const InventoryHeader: React.FC<InventoryHeaderProps> = ({
  departmentFilter,
  setDepartmentFilter,
  searchQuery,
  setSearchQuery,
  inventoryData,
  onOpenCreateTask,
}) => {
  const { selectedStore, dateRange, setDateRange } = useStore();
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const departments = [
    { label: 'All Departments', value: 'all' },
    { label: 'Dairy & Milk', value: 'dairy' },
    { label: 'Bakery & Bread', value: 'bakery' },
    { label: 'Healthy Snacks', value: 'snack' },
    { label: 'Hot Beverages', value: 'coffee' },
    { label: 'Packaged Drinks', value: 'packaged' },
    { label: 'Produce & Fresh', value: 'fresh' },
    { label: 'Personal Care', value: 'personal' },
  ];

  const dateOptions: { label: string; value: DateRange }[] = [
    { label: 'Today', value: 'today' },
    { label: '7D', value: 'week' },
    { label: '30D', value: 'month' },
  ];

  const handleExportData = () => {
    if (!inventoryData) return;

    const headers = ['SKU', 'Product Name', 'Department', 'Shelf Code', 'Expected Visible', 'Detected Visible', 'Availability %', 'POS Stockroom Qty', 'Status', 'Last Observed'];
    const rows = inventoryData.products.map((p) => [
      p.sku,
      `"${p.name}"`,
      `"${p.department}"`,
      p.shelfCode,
      p.expectedVisibleQty,
      p.detectedVisibleQty,
      `${p.availabilityPct}%`,
      p.stockroomQty,
      p.status,
      `"${p.lastObservation}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [
        `# RetailEdge AI - Smart Inventory & Shelf Availability Report`,
        `# Store: ${selectedStore.name} (${selectedStore.code})`,
        `# Period: ${dateRange.toUpperCase()} | Department Filter: ${departmentFilter.toUpperCase()}`,
        `# Generated At: ${new Date().toISOString()}`,
        ``,
        headers.join(','),
        ...rows.map((r) => r.join(',')),
      ].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `RetailEdge_Inventory_${selectedStore.code}_${dateRange}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 2500);
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-1">
      {/* Left: Department Filter & Search Input */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Department Dropdown */}
        <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
          <Filter className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-0.5 shrink-0" />
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="bg-transparent text-xs font-semibold text-slate-800 pr-3 py-1 focus:outline-none cursor-pointer"
          >
            {departments.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search shelf code or SKU..."
            className="pl-8 pr-3 py-1 bg-white border border-slate-200 rounded-lg text-xs placeholder:text-slate-400 focus:outline-none focus:border-blue-500 w-44 sm:w-56"
          />
        </div>

        {/* Date Segmented Control */}
        <div className="inline-flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
          <Calendar className="w-3 h-3 text-slate-400 ml-1.5 mr-0.5 shrink-0" />
          {dateOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDateRange(opt.value)}
              className={`px-2 py-0.5 font-semibold rounded-md transition-all cursor-pointer ${
                dateRange === opt.value
                  ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2 self-end sm:self-auto">
        <button
          onClick={onOpenCreateTask}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition flex items-center gap-1.5 shadow-2xs cursor-pointer"
          title="Create Restock Task"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Task</span>
        </button>

        <button
          onClick={handleExportData}
          className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition flex items-center gap-1 shadow-2xs cursor-pointer"
          title="Export Inventory CSV"
        >
          {downloadSuccess ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-emerald-700 font-semibold">Exported</span>
            </>
          ) : (
            <>
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Export</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default InventoryHeader;
