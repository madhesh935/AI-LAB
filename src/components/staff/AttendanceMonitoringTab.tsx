import React, { useState } from 'react';
import {
  Clock,
  CheckCircle2,
  AlertCircle,
  CalendarCheck,
  UserCheck,
  UserX,
  Edit2,
  Info,
} from 'lucide-react';
import type { AttendanceRecord } from '../../types/retail';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface AttendanceMonitoringTabProps {
  attendanceRecords: AttendanceRecord[];
  onOpenOverrideModal: (record: AttendanceRecord) => void;
}

export const AttendanceMonitoringTab: React.FC<AttendanceMonitoringTabProps> = ({
  attendanceRecords,
  onOpenOverrideModal,
}) => {
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const filteredRecords = filterStatus === 'all'
    ? attendanceRecords
    : attendanceRecords.filter((r) => r.status === filterStatus);

  const totalScheduled = attendanceRecords.length;
  const presentCount = attendanceRecords.filter((r) => r.status === 'present').length;
  const lateCount = attendanceRecords.filter((r) => r.status === 'late').length;
  const scheduledCount = attendanceRecords.filter((r) => r.status === 'scheduled').length;
  const absentCount = attendanceRecords.filter((r) => r.status === 'absent').length;

  return (
    <div className="space-y-6">
      {/* 1. Summary Ribbon Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="p-3.5 border-slate-200">
          <div className="text-caption font-semibold uppercase tracking-wider text-slate-500">
            Total Scheduled
          </div>
          <div className="mt-1 text-xl font-semibold text-slate-900">{totalScheduled} staff</div>
          <div className="text-caption text-slate-400">Rostered today</div>
        </Card>

        <Card className="p-3.5 border-slate-200">
          <div className="text-caption font-semibold uppercase tracking-wider text-emerald-700">
            Checked In On-Time
          </div>
          <div className="mt-1 text-xl font-semibold text-emerald-600">{presentCount} staff</div>
          <div className="text-caption text-emerald-700">Within grace period</div>
        </Card>

        <Card className="p-3.5 border-slate-200">
          <div className="text-caption font-semibold uppercase tracking-wider text-amber-700">
            Late Check-Ins
          </div>
          <div className="mt-1 text-xl font-semibold text-amber-600">{lateCount} staff</div>
          <div className="text-caption text-amber-700">&gt;5 min arrival delay</div>
        </Card>

        <Card className="p-3.5 border-slate-200">
          <div className="text-caption font-semibold uppercase tracking-wider text-blue-700">
            Scheduled Upcoming
          </div>
          <div className="mt-1 text-xl font-semibold text-blue-600">{scheduledCount} staff</div>
          <div className="text-caption text-blue-700">Evening shift roster</div>
        </Card>

        <Card className="p-3.5 border-slate-200">
          <div className="text-caption font-semibold uppercase tracking-wider text-slate-500">
            Absent / Unexcused
          </div>
          <div className="mt-1 text-xl font-semibold text-slate-700">{absentCount}</div>
          <div className="text-caption text-slate-400">0 unexcused today</div>
        </Card>
      </div>

      {/* 2. Privacy & Policy Disclaimer */}
      <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-3.5 text-xs text-blue-900 flex items-start gap-2.5">
        <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
        <div className="space-y-0.5 text-caption leading-relaxed">
          <span className="font-semibold">Note:</span>
          <p>
            Taken from staff check-ins.
            RetailEdge AI does <strong>not</strong> use face recognition or cameras to track attendance.
          </p>
        </div>
      </div>

      {/* 3. Attendance Table */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
        <div className="p-3.5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Today's Attendance</h3>
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span>Filter Status:</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-800 focus:outline-none"
            >
              <option value="all">All Records</option>
              <option value="present">Present (On-Time)</option>
              <option value="late">Late Check-In</option>
              <option value="scheduled">Scheduled PM</option>
              <option value="absent">Absent</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-caption font-semibold text-slate-600 uppercase tracking-wider">
                <th scope="col" className="px-4 py-3">Employee Name</th>
                <th scope="col" className="px-4 py-3">Department</th>
                <th scope="col" className="px-4 py-3">Scheduled Shift</th>
                <th scope="col" className="px-4 py-3">Actual Check-In</th>
                <th scope="col" className="px-4 py-3">Actual Check-Out</th>
                <th scope="col" className="px-4 py-3">Recorded Hours</th>
                <th scope="col" className="px-4 py-3">Attendance Status</th>
                <th scope="col" className="px-4 py-3 text-right">Manual Override</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRecords.map((rec) => (
                <tr key={rec.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{rec.employeeName}</div>
                    <span className="font-mono text-caption text-slate-400 font-semibold">{rec.employeeId}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{rec.department}</td>
                  <td className="px-4 py-3 font-mono text-slate-600">{rec.scheduledShift}</td>
                  <td className="px-4 py-3 font-mono font-semibold text-slate-800">
                    {rec.actualCheckIn || '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-600">
                    {rec.actualCheckOut || 'On Duty'}
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                    {rec.totalHoursWorked > 0 ? `${rec.totalHoursWorked}h` : '0h'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={
                        rec.status === 'present'
                          ? 'success'
                          : rec.status === 'late'
                          ? 'warning'
                          : rec.status === 'scheduled'
                          ? 'slate'
                          : 'error'
                      }
                      size="sm"
                      className="capitalize text-caption"
                    >
                      {rec.status === 'late' ? `Late (+${rec.lateMinutes}m)` : rec.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onOpenOverrideModal(rec)}
                      className="h-7 text-xs px-2.5 border-slate-200 text-slate-700 hover:bg-slate-50 gap-1"
                    >
                      <Edit2 className="h-3 w-3 text-slate-500" />
                      <span>Audit Edit</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
