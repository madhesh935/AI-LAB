import React from 'react';
import {
  Users,
  Clock,
  RefreshCw,
  Sliders,
  Layers,
  Sparkles,
} from 'lucide-react';
import type { DateRange } from '../../types/retail';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';

interface QueueHeaderProps {
  selectedSection: string;
  onSectionChange: (section: string) => void;
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onOpenRulesConfig: () => void;
  lastUpdated: string;
}

export const QueueHeader: React.FC<QueueHeaderProps> = ({
  selectedSection,
  onSectionChange,
  dateRange,
  onDateRangeChange,
  onRefresh,
  isRefreshing,
  onOpenRulesConfig,
  lastUpdated,
}) => {
  return (
    <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200 shadow-card">
      {/* Left: Title & Section Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20">
            <Users className="w-4 h-4" />
          </div>
          <h1 className="text-base font-semibold text-slate-900 tracking-tight">Queue Intelligence</h1>
          <Badge variant="success" size="sm" dot className="font-semibold text-caption">
            Live
          </Badge>
        </div>

        <div className="h-4 w-px bg-slate-200 hidden sm:block" />

        {/* Section Filter Pills */}
        <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200 text-xs">
          <Layers className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-0.5 hidden md:block" />
          {[
            { id: 'all', label: 'All Counters' },
            { id: 'main', label: 'Main POS (2, 3)' },
            { id: 'express', label: 'Express (1)' },
            { id: 'self_checkout', label: 'Self-Checkout' },
          ].map((sec) => {
            const isActive = selectedSection === sec.id;
            return (
              <button
                key={sec.id}
                onClick={() => onSectionChange(sec.id)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  isActive
                    ? 'bg-white text-blue-700 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {sec.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Date Range, SLA Rules, Refresh */}
      <div className="flex flex-wrap items-center gap-2 2xl:justify-end">
        {/* Date / Time Horizon Selector */}
        <div className="flex items-center bg-slate-50 p-1 rounded-xl border border-slate-200 text-xs">
          {[
            { id: 'today', label: 'Live' },
            { id: 'yesterday', label: 'Yesterday' },
            { id: 'week', label: '7D' },
            { id: 'month', label: '30D' },
          ].map((range) => {
            const isSelected = dateRange === range.id;
            return (
              <button
                key={range.id}
                onClick={() => onDateRangeChange(range.id as DateRange)}
                className={`px-2 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-white text-blue-700 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {range.label}
              </button>
            );
          })}
        </div>

        {/* Queue Rules Config Drawer Trigger */}
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenRulesConfig}
          className="gap-1.5 border-slate-200 text-slate-700 hover:border-blue-400 hover:text-blue-700 h-8 text-xs font-semibold"
          title="Configure Queue SLAs & Thresholds"
        >
          <Sliders className="h-3.5 w-3.5 text-blue-600" />
          <span>SLA Rules</span>
        </Button>

        {/* Refresh Action */}
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="gap-1.5 border-slate-200 text-slate-700 hover:bg-slate-50 h-8 text-xs font-semibold"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : 'text-slate-500'}`} />
          <span>{isRefreshing ? '...' : 'Refresh'}</span>
        </Button>

        <span className="text-caption font-mono text-slate-400 hidden 2xl:inline whitespace-nowrap ml-1">
          {lastUpdated}
        </span>
      </div>
    </div>
  );
};
