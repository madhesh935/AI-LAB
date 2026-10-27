import React, { useState, useMemo } from 'react';
import {
  UserCheck,
  Clock,
  Briefcase,
  Coffee,
  UserX,
  AlertCircle,
  Plus,
  Send,
  Filter,
  CheckCircle2,
  ChevronRight,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type { StaffEmployee, StaffAvailabilityStatus, DepartmentName } from '../../types/retail';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface LiveAvailabilityPanelProps {
  employees: StaffEmployee[];
  onAssignTask: (emp: StaffEmployee) => void;
  onSelectEmployee: (emp: StaffEmployee) => void;
  onUpdateStatus: (empId: string, status: StaffAvailabilityStatus) => void;
}

export const LiveAvailabilityPanel: React.FC<LiveAvailabilityPanelProps> = ({
  employees,
  onAssignTask,
  onSelectEmployee,
  onUpdateStatus,
}) => {
  const [selectedDept, setSelectedDept] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  const departments: DepartmentName[] = [
    'Checkout & Cashier',
    'Inventory & Stockroom',
    'Bakery & Fresh',
    'Produce & Dairy',
    'Customer Support',
    'Security & Loss Prevention',
    'Management',
  ];

  // Grouped counts
  const availableEmployees = employees.filter((e) => e.availability === 'available');
  const busyEmployees = employees.filter((e) => e.availability === 'busy');
  const breakEmployees = employees.filter((e) => e.availability === 'on_break');
  const offDutyEmployees = employees.filter((e) => e.availability === 'off_duty');
  const leaveEmployees = employees.filter((e) => e.availability === 'on_leave');

  const filtered = useMemo(() => {
    return employees.filter((e) => {
      const matchDept = selectedDept === 'all' || e.department === selectedDept;
      const matchStatus = selectedStatus === 'all' || e.availability === selectedStatus;
      return matchDept && matchStatus;
    });
  }, [employees, selectedDept, selectedStatus]);

  const getStatusBadge = (status: StaffAvailabilityStatus) => {
    switch (status) {
      case 'available':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Available Now
          </span>
        );
      case 'busy':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Busy on Task
          </span>
        );
      case 'on_break':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-sky-50 text-sky-700 border border-sky-200">
            <Coffee className="h-3 w-3" />
            On Break
          </span>
        );
      case 'off_duty':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
            Off Duty
          </span>
        );
      case 'on_leave':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            On Leave
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Status Overview Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <button
          onClick={() => setSelectedStatus(selectedStatus === 'available' ? 'all' : 'available')}
          className={`text-left p-3.5 rounded-xl border transition-all ${
            selectedStatus === 'available'
              ? 'border-emerald-500 bg-emerald-50/50 shadow-sm ring-2 ring-emerald-500/20'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Available</span>
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <div className="mt-1 text-2xl font-semibold text-emerald-700">{availableEmployees.length}</div>
          <div className="text-caption text-slate-400">Ready for instant dispatch</div>
        </button>

        <button
          onClick={() => setSelectedStatus(selectedStatus === 'busy' ? 'all' : 'busy')}
          className={`text-left p-3.5 rounded-xl border transition-all ${
            selectedStatus === 'busy'
              ? 'border-amber-500 bg-amber-50/50 shadow-sm ring-2 ring-amber-500/20'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Busy on Task</span>
            <span className="h-2 w-2 rounded-full bg-amber-500" />
          </div>
          <div className="mt-1 text-2xl font-semibold text-amber-700">{busyEmployees.length}</div>
          <div className="text-caption text-slate-400">Active assignments</div>
        </button>

        <button
          onClick={() => setSelectedStatus(selectedStatus === 'on_break' ? 'all' : 'on_break')}
          className={`text-left p-3.5 rounded-xl border transition-all ${
            selectedStatus === 'on_break'
              ? 'border-sky-500 bg-sky-50/50 shadow-sm ring-2 ring-sky-500/20'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>On Break</span>
            <Coffee className="h-3 w-3 text-sky-500" />
          </div>
          <div className="mt-1 text-2xl font-semibold text-sky-700">{breakEmployees.length}</div>
          <div className="text-caption text-slate-400">Rest / lunch interval</div>
        </button>

        <button
          onClick={() => setSelectedStatus(selectedStatus === 'off_duty' ? 'all' : 'off_duty')}
          className={`text-left p-3.5 rounded-xl border transition-all ${
            selectedStatus === 'off_duty'
              ? 'border-slate-400 bg-slate-100/50 shadow-sm ring-2 ring-slate-400/20'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Off Duty</span>
            <Clock className="h-3 w-3 text-slate-400" />
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-700">{offDutyEmployees.length}</div>
          <div className="text-caption text-slate-400">Not scheduled now</div>
        </button>

        <button
          onClick={() => setSelectedStatus(selectedStatus === 'on_leave' ? 'all' : 'on_leave')}
          className={`text-left p-3.5 rounded-xl border transition-all ${
            selectedStatus === 'on_leave'
              ? 'border-purple-500 bg-purple-50/50 shadow-sm ring-2 ring-purple-500/20'
              : 'border-slate-200 bg-white hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>On Leave</span>
            <UserX className="h-3 w-3 text-purple-400" />
          </div>
          <div className="mt-1 text-2xl font-semibold text-purple-700">{leaveEmployees.length}</div>
          <div className="text-caption text-slate-400">Approved time off</div>
        </button>
      </div>

      {/* 2. Department Breakdown Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {departments.slice(0, 4).map((dept) => {
          const deptStaff = employees.filter((e) => e.department === dept);
          const deptAvailable = deptStaff.filter((e) => e.availability === 'available');
          const deptBusy = deptStaff.filter((e) => e.availability === 'busy');

          return (
            <Card key={dept} className="p-4 border-slate-200 bg-white">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {dept}
                </span>
                <span className="text-xs font-semibold text-slate-700">
                  {deptStaff.length} Total
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold text-emerald-600">{deptAvailable.length}</div>
                  <div className="text-caption text-slate-400">Available</div>
                </div>
                <div className="h-6 w-px bg-slate-200" />
                <div>
                  <div className="text-lg font-semibold text-amber-600">{deptBusy.length}</div>
                  <div className="text-caption text-slate-400">Busy</div>
                </div>
                <div className="h-6 w-px bg-slate-200" />
                <div>
                  <div className="text-lg font-semibold text-slate-500">
                    {deptStaff.length - deptAvailable.length - deptBusy.length}
                  </div>
                  <div className="text-caption text-slate-400">Off/Break</div>
                </div>
              </div>

              {/* Progress mini bar */}
              <div className="mt-3 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden flex">
                <div
                  className="bg-emerald-500 h-full"
                  style={{
                    width: `${deptStaff.length ? (deptAvailable.length / deptStaff.length) * 100 : 0}%`,
                  }}
                />
                <div
                  className="bg-amber-500 h-full"
                  style={{
                    width: `${deptStaff.length ? (deptBusy.length / deptStaff.length) * 100 : 0}%`,
                  }}
                />
              </div>
            </Card>
          );
        })}
      </div>

      {/* 3. Filter Bar & Quick Status Roster */}
      <Card className="border-slate-200 bg-white overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-slate-900">
              Team Status
            </h3>
            <span className="text-xs text-slate-500">
              ({filtered.length})
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="all">All Statuses</option>
              <option value="available">Available Now</option>
              <option value="busy">Busy on Task</option>
              <option value="on_break">On Break</option>
              <option value="off_duty">Off Duty</option>
              <option value="on_leave">On Leave</option>
            </select>
          </div>
        </div>

        {/* Live List */}
        <div className="divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <div className="p-8 text-center">
              <UserCheck className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-600">No staff found</p>
              <p className="text-xs text-slate-400 mt-1">Try clearing the filters</p>
            </div>
          ) : (
            filtered.map((emp) => {
              const isAvailable = emp.availability === 'available';

              return (
                <div
                  key={emp.id}
                  className="p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4 hover:bg-slate-50/60 transition-colors"
                >
                  {/* Left: Avatar + Details */}
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-semibold text-slate-700 text-xs shrink-0">
                      {emp.name
                        .split(' ')
                        .map((p) => p[0])
                        .join('')
                        .slice(0, 2)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          onClick={() => onSelectEmployee(emp)}
                          className="font-semibold text-sm text-slate-900 hover:text-blue-600 cursor-pointer"
                        >
                          {emp.name}
                        </span>
                        <span className="text-caption font-mono text-slate-400">({emp.id})</span>
                        {getStatusBadge(emp.availability)}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-2">
                        <span>{emp.roleLabel}</span>
                        <span>•</span>
                        <span>{emp.department}</span>
                        <span>•</span>
                        <span className="text-slate-400 font-mono">
                          Shift: {emp.currentShiftLabel || 'Standard Daytime'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Middle: Current Activity & Workload */}
                  <div className="flex items-center gap-6">
                    <div className="text-left md:text-right">
                      <div className="text-xs font-medium text-slate-700">
                        {emp.assignedZone || 'Main Retail Floor'}
                      </div>
                      <div className="text-caption text-slate-400 flex items-center md:justify-end gap-1 mt-0.5">
                        <Clock className="h-3 w-3" />
                        Active Tasks: <span className="font-semibold text-slate-600">{emp.activeTasksCount}</span>
                        <span className="mx-1">•</span>
                        Done: <span className="font-semibold text-slate-600">{emp.completedTasksCount}</span>
                      </div>
                    </div>

                    {/* Quick Status Setter Dropdown */}
                    <select
                      value={emp.availability}
                      onChange={(e) => onUpdateStatus(emp.id, e.target.value as StaffAvailabilityStatus)}
                      className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="available">Set Available</option>
                      <option value="busy">Set Busy</option>
                      <option value="on_break">Set Break</option>
                      <option value="off_duty">Set Off Duty</option>
                      <option value="on_leave">Set Leave</option>
                    </select>

                    {/* Action button */}
                    <Button
                      size="sm"
                      variant={isAvailable ? 'primary' : 'outline'}
                      onClick={() => onAssignTask(emp)}
                      className="text-xs flex items-center gap-1.5 shrink-0"
                    >
                      <Send className="h-3 w-3" />
                      Assign Task
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
};
