import React from 'react';
import {
  Users,
  UserCheck,
  Clock,
  ClipboardList,
  AlertCircle,
  Activity,
  CheckCircle2,
  CalendarCheck,
} from 'lucide-react';
import type { StaffManagementKpis } from '../../types/retail';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';

interface StaffKpisProps {
  kpis: StaffManagementKpis;
  onFilterStatus?: (status: string) => void;
}

export const StaffKpis: React.FC<StaffKpisProps> = ({ kpis, onFilterStatus }) => {
  return (
    <section aria-label="Staff Workforce KPIs" className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {/* 1. Total Employees */}
      <Card className="p-4 flex flex-col justify-between border-slate-200 shadow-card hover:border-slate-300 transition-all">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Staff
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight text-slate-900">
              {kpis.totalEmployees}
            </span>
            <span className="text-xs font-medium text-slate-500">rostered</span>
          </div>
        </div>
      </Card>

      {/* 2. On Duty */}
      <Card className="p-4 flex flex-col justify-between border-slate-200 shadow-card hover:border-slate-300 transition-all">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              On Duty Now
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Activity className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight text-emerald-600">
              {kpis.onDuty}
            </span>
            <span className="text-xs font-medium text-slate-500">/ {kpis.totalEmployees}</span>
          </div>
        </div>
      </Card>

      {/* 3. Available Staff */}
      <Card className="p-4 flex flex-col justify-between border-slate-200 shadow-card hover:border-slate-300 transition-all">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Available Staff
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <UserCheck className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight text-blue-600">
              {kpis.availableStaff}
            </span>
            <span className="text-xs font-medium text-slate-500">ready</span>
          </div>
        </div>
      </Card>

      {/* 4. Busy Staff */}
      <Card className="p-4 flex flex-col justify-between border-slate-200 shadow-card hover:border-slate-300 transition-all">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Busy on Tasks
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight text-amber-600">
              {kpis.busyStaff}
            </span>
            <span className="text-xs font-medium text-slate-500">employees</span>
          </div>
        </div>
      </Card>

      {/* 5. Pending Tasks */}
      <Card className="p-4 flex flex-col justify-between border-slate-200 shadow-card hover:border-slate-300 transition-all">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Workforce Tasks
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
              <ClipboardList className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight text-slate-900">
              {kpis.pendingTasks}
            </span>
            <span className="text-xs font-medium text-slate-500">open tasks</span>
          </div>
        </div>
      </Card>

      {/* 6. Today's Attendance Rate */}
      <Card className="p-4 flex flex-col justify-between border-slate-200 shadow-card hover:border-slate-300 transition-all">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Today's Attendance
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <CalendarCheck className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tracking-tight text-slate-900">
              {kpis.attendanceRatePct}%
            </span>
            <span className="text-xs font-medium text-slate-500">
              ({kpis.checkedInCount}/{kpis.totalEmployees})
            </span>
          </div>
        </div>
      </Card>
    </section>
  );
};
