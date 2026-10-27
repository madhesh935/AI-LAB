import React, { useState } from 'react';
import {
  Calendar,
  Clock,
  AlertTriangle,
  Users,
  CheckCircle2,
  Plus,
  Trash2,
  Layers,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import type { ShiftAssignment, ShiftTiming, StaffWorkloadAnalytics } from '../../types/retail';
import { Card } from '../common/Card';
import { Badge } from '../common/Badge';
import { Button } from '../common/Button';

interface ShiftSchedulingTabProps {
  shifts: ShiftAssignment[];
  shiftTimings: ShiftTiming[];
  analytics: StaffWorkloadAnalytics;
  onOpenCreateShift: () => void;
  onDeleteShift: (id: string) => void;
}

export const ShiftSchedulingTab: React.FC<ShiftSchedulingTabProps> = ({
  shifts,
  shiftTimings,
  analytics,
  onOpenCreateShift,
  onDeleteShift,
}) => {
  const [selectedTimingFilter, setSelectedTimingFilter] = useState<string>('all');
  const [activeViewMode, setActiveViewMode] = useState<'timeline' | 'grid'>('timeline');

  const filteredShifts = selectedTimingFilter === 'all'
    ? shifts
    : shifts.filter((s) => s.shiftTimingId === selectedTimingFilter);

  const conflicts = shifts.filter((s) => s.hasConflict);

  return (
    <div className="space-y-6">
      {/* 1. Shift Conflict Alert Banner (if any) */}
      {conflicts.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1 text-xs">
            <span className="font-semibold text-amber-950 block">
              Shift Scheduling Conflict Detected ({conflicts.length} Overlapping Assignments)
            </span>
            <ul className="space-y-0.5 text-amber-900">
              {conflicts.map((c) => (
                <li key={c.id}>
                  • <strong>{c.employeeName}</strong>: {c.conflictReason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* 2. Visual Daily Workforce Coverage vs Demand Chart */}
      <Card className="p-5 border-slate-200 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4 pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Staff Coverage vs Demand
            </h3>
            
          </div>
          <Badge variant="primary" size="sm">
            Peak target: 8 staff
          </Badge>
        </div>

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={analytics.hourlyCoverage} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
              <XAxis dataKey="hour" stroke="#94A3B8" fontSize={11} tickLine={false} />
              <YAxis domain={[0, 10]} stroke="#94A3B8" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: '12px',
                  border: '1px solid #E2E8F0',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
              <Area
                type="monotone"
                dataKey="scheduledStaff"
                name="Scheduled On Roster"
                fill="#3B82F6"
                fillOpacity={0.15}
                stroke="#3B82F6"
                strokeWidth={2}
              />
              <Bar
                dataKey="availableStaff"
                name="Available Active Staff"
                fill="#10B981"
                radius={[4, 4, 0, 0]}
                barSize={18}
              />
              <Line
                type="monotone"
                dataKey="requiredStaff"
                name="Demand (Footfall Inferred)"
                stroke="#EF4444"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={{ r: 3, fill: '#EF4444' }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* 3. Shift Timings Reference & Filter Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSelectedTimingFilter('all')}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
              selectedTimingFilter === 'all'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            All Shifts ({shifts.length})
          </button>

          {shiftTimings.map((st) => (
            <button
              key={st.id}
              onClick={() => setSelectedTimingFilter(st.id)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
                selectedTimingFilter === st.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {st.name} ({st.startTime} – {st.endTime})
            </button>
          ))}
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={onOpenCreateShift}
          className="text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white gap-1.5 h-8 self-start sm:self-auto"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Assign New Shift</span>
        </Button>
      </div>

      {/* 4. Shift Assignments Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredShifts.map((sh) => (
          <div
            key={sh.id}
            className={`rounded-2xl border p-4 bg-white shadow-2xs space-y-3 transition-all hover:border-slate-300 ${
              sh.hasConflict ? 'border-amber-300 bg-amber-50/20' : 'border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-xs text-blue-900 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-200">
                {sh.shiftName}
              </span>
              <div className="flex items-center gap-1.5">
                <Badge
                  variant={sh.status === 'confirmed' ? 'success' : 'slate'}
                  size="sm"
                  className="capitalize text-caption"
                >
                  {sh.status}
                </Badge>
                <button
                  onClick={() => onDeleteShift(sh.id)}
                  className="p-1 text-slate-400 hover:text-rose-600 rounded"
                  title="Remove shift assignment"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-700 font-semibold text-xs">
                {sh.employeeName.charAt(0)}
              </div>
              <div>
                <h4 className="text-xs font-semibold text-slate-900">{sh.employeeName}</h4>
                <p className="text-caption text-slate-500">{sh.roleLabel}</p>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 text-xs space-y-1">
              <div className="flex items-center justify-between text-slate-600">
                <span>Working Hours:</span>
                <strong className="text-slate-900 font-mono">
                  {sh.startTime} – {sh.endTime}
                </strong>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span>Department:</span>
                <span className="text-slate-700">{sh.department}</span>
              </div>
            </div>

            {sh.hasConflict && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 text-caption text-amber-800 font-medium">
                ⚠️ {sh.conflictReason}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
