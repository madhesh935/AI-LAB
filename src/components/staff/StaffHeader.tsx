import React from 'react';
import {
  Users,
  Search,
  Plus,
  Calendar,
  Clock,
  ClipboardList,
  Sparkles,
  Filter,
  CheckCircle2,
  RefreshCw,
  Building2,
  Briefcase,
  UserCheck,
} from 'lucide-react';
import type { Store, DepartmentName } from '../../types/retail';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';

export type StaffTabType = 'directory' | 'scheduling' | 'attendance' | 'tasks' | 'recommendations' | 'availability';

interface StaffHeaderProps {
  activeTab: StaffTabType;
  onTabChange: (tab: StaffTabType) => void;
  selectedStore: Store;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  departmentFilter: string;
  onDepartmentFilterChange: (dept: string) => void;
  onOpenAddEmployee: () => void;
  onOpenCreateShift: () => void;
  onOpenCreateTask: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export const StaffHeader: React.FC<StaffHeaderProps> = ({
  activeTab,
  onTabChange,
  selectedStore,
  searchQuery,
  onSearchChange,
  departmentFilter,
  onDepartmentFilterChange,
  onOpenAddEmployee,
  onOpenCreateShift,
  onOpenCreateTask,
  onRefresh,
  isRefreshing,
}) => {
  const tabs = [
    { id: 'directory', label: 'Directory', icon: Users },
    { id: 'scheduling', label: 'Schedules', icon: Calendar },
    { id: 'attendance', label: 'Attendance', icon: Clock },
    { id: 'tasks', label: 'Tasks', icon: ClipboardList },
    { id: 'recommendations', label: 'AI Staffing', icon: Sparkles },
    { id: 'availability', label: 'Live Status', icon: UserCheck },
  ];

  const departments = [
    'All Departments',
    'Checkout & Cashier',
    'Inventory & Stockroom',
    'Bakery & Fresh',
    'Produce & Dairy',
    'Customer Support',
    'Security & Loss Prevention',
    'Management',
  ];

  return (
    <header className="flex flex-col gap-3 bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200 shadow-card">
      {/* Top Title & Primary Actions */}
      <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20">
            <Briefcase className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-slate-900 tracking-tight">
                Staff Management
              </h1>
              <Badge variant="primary" size="sm" className="font-semibold text-caption">
                {selectedStore.code}
              </Badge>
              <span className="flex items-center gap-1 text-caption font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Shift Synced
              </span>
            </div>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Add Employee */}
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenAddEmployee}
            className="text-xs h-8 px-2.5 border-slate-200 text-slate-700 hover:border-blue-400 hover:text-blue-700 gap-1.5 font-semibold"
          >
            <Plus className="h-3.5 w-3.5 text-blue-600" />
            <span>Add Staff</span>
          </Button>

          {/* Schedule Shift */}
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenCreateShift}
            className="text-xs h-8 px-2.5 border-slate-200 text-slate-700 hover:border-purple-400 hover:text-purple-700 gap-1.5 font-semibold"
          >
            <Calendar className="h-3.5 w-3.5 text-purple-600" />
            <span>Schedule</span>
          </Button>

          {/* Create Task */}
          <Button
            variant="primary"
            size="sm"
            onClick={onOpenCreateTask}
            className="text-xs h-8 px-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold gap-1.5 shadow-sm shadow-blue-500/20"
          >
            <ClipboardList className="h-3.5 w-3.5" />
            <span>Assign Task</span>
          </Button>

          {/* Refresh */}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="text-xs h-8 px-2 border-slate-200 text-slate-600 hover:bg-slate-50"
            title="Refresh workforce telemetry"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Navigation Ribbon & Filter Controls */}
      <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-2.5 pt-2 border-t border-slate-100">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200 text-xs">
          {tabs.map((tab) => {
            const isSelected = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id as StaffTabType)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-white text-blue-700 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isSelected ? 'text-blue-600' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Global Search and Department Filter */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative min-w-[180px]">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search staff, role..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-3 py-1 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
            />
          </div>

          {/* Department Filter */}
          <select
            value={departmentFilter}
            onChange={(e) => onDepartmentFilterChange(e.target.value)}
            className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-800 focus:border-blue-500 focus:outline-none cursor-pointer"
          >
            {departments.map((dept, i) => (
              <option key={i} value={dept === 'All Departments' ? 'all' : dept}>
                {dept}
              </option>
            ))}
          </select>
        </div>
      </div>
    </header>
  );
};
