import React from 'react';
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
} from 'lucide-react';
import type { DateRange, ReportCategory, ComparePeriod, Store } from '../../types/retail';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';

interface ReportsHeaderProps {
  selectedCategory: ReportCategory;
  onSelectCategory: (cat: ReportCategory) => void;
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  comparePeriod: ComparePeriod;
  onComparePeriodChange: (compare: ComparePeriod) => void;
  savedConfigsCount: number;
  onOpenSavedModal: () => void;
  onOpenExportModal: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  selectedStore: Store;
}

export const ReportsHeader: React.FC<ReportsHeaderProps> = ({
  selectedCategory,
  onSelectCategory,
  dateRange,
  onDateRangeChange,
  comparePeriod,
  onComparePeriodChange,
  savedConfigsCount,
  onOpenSavedModal,
  onOpenExportModal,
  onRefresh,
  isRefreshing,
  selectedStore,
}) => {
  const categories: Array<{ id: ReportCategory; label: string; icon: React.FC<{ className?: string }> }> = [
    { id: 'overview', label: 'Executive Overview', icon: BarChart3 },
    { id: 'shoppers', label: 'Shoppers', icon: ShoppingBag },
    { id: 'inventory', label: 'Inventory', icon: Package },
    { id: 'queues', label: 'Queue Performance', icon: CreditCard },
    { id: 'operations', label: 'Operations', icon: Cpu },
  ];

  return (
    <header className="flex flex-col gap-3 bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-card print:hidden">
      {/* Row 1: Title, Store, and Quick Actions */}
      <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20">
            <BarChart3 className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-slate-900 tracking-tight">
                Reports
              </h1>
              <Badge variant="primary" size="sm" className="font-semibold text-caption">
                {selectedStore.code}
              </Badge>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Saved Reports Manager */}
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenSavedModal}
            className="text-xs h-8 px-2.5 border-slate-200 text-slate-700 hover:border-blue-400 hover:text-blue-700 gap-1.5 font-semibold"
          >
            <Bookmark className="h-3.5 w-3.5 text-blue-600" />
            <span>Saved Presets</span>
            {savedConfigsCount > 0 && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-caption font-semibold">
                {savedConfigsCount}
              </span>
            )}
          </Button>

          {/* Quick Print Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="text-xs h-8 px-2.5 border-slate-200 text-slate-700 hover:bg-slate-50 gap-1.5"
            title="Print clean report layout"
          >
            <Printer className="h-3.5 w-3.5 text-slate-600" />
            <span>Print</span>
          </Button>

          {/* Export Report Dialog Button */}
          <Button
            variant="primary"
            size="sm"
            onClick={onOpenExportModal}
            className="text-xs h-8 px-3 bg-blue-600 text-white hover:bg-blue-700 gap-1.5 font-semibold shadow-sm shadow-blue-500/20"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export Report</span>
          </Button>

          {/* Refresh Action */}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="text-xs h-8 px-2 border-slate-200 text-slate-600 hover:bg-slate-50"
            title="Refresh analytics data"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Row 2: Category Navigation & Filters Toolbar */}
      <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-2.5 pt-2 border-t border-slate-100">
        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200 text-xs">
          {categories.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            const Icon = cat.icon;
            return (
              <button
                key={cat.id}
                onClick={() => onSelectCategory(cat.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-white text-blue-700 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isSelected ? 'text-blue-600' : 'text-slate-400'}`} />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Date Range & Comparison Selectors */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Reporting Range */}
          <div className="flex items-center gap-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl px-2 py-1">
            <Calendar className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={dateRange}
              onChange={(e) => onDateRangeChange(e.target.value as DateRange)}
              aria-label="Reporting Range"
              className="bg-transparent text-xs font-semibold text-slate-800 focus:outline-none cursor-pointer"
            >
              <option value="today">Today (Live)</option>
              <option value="yesterday">Yesterday</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
          </div>

          {/* Comparison Baseline */}
          <div className="flex items-center gap-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl px-2 py-1">
            <ArrowRightLeft className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={comparePeriod}
              onChange={(e) => onComparePeriodChange(e.target.value as ComparePeriod)}
              aria-label="Comparison Baseline"
              className="bg-transparent text-xs font-semibold text-slate-800 focus:outline-none cursor-pointer"
            >
              <option value="previous_period">vs Previous Period</option>
              <option value="previous_year">vs Previous Year</option>
              <option value="none">No Comparison</option>
            </select>
          </div>
        </div>
      </div>
    </header>
  );
};
