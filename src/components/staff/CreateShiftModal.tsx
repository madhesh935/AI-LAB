import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Calendar,
  Clock,
  User,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import type {
  StaffEmployee,
  ShiftTiming,
  ShiftAssignment,
} from '../../types/retail';
import { Button } from '../common/Button';
import { staffService } from '../../services/staffService';

interface CreateShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (shift: Omit<ShiftAssignment, 'id'>) => void;
  employees: StaffEmployee[];
  shiftTimings: ShiftTiming[];
  storeId: string;
}

export const CreateShiftModal: React.FC<CreateShiftModalProps> = ({
  isOpen,
  onClose,
  onSave,
  employees,
  shiftTimings,
  storeId,
}) => {
  const [employeeId, setEmployeeId] = useState<string>('');
  const [timingId, setTimingId] = useState<string>('sh-morning');
  const [date, setDate] = useState<string>('2026-10-24');

  useEffect(() => {
    if (employees.length > 0 && !employeeId) {
      setEmployeeId(employees[0].id);
    }
    if (shiftTimings.length > 0 && !timingId) {
      setTimingId(shiftTimings[0].id);
    }
  }, [employees, shiftTimings, isOpen]);

  const selectedEmployee = employees.find((e) => e.id === employeeId);
  const selectedTiming = shiftTimings.find((t) => t.id === timingId) || shiftTimings[0];

  // Conflict Detection using staffService method
  const conflict = useMemo(() => {
    if (!employeeId || !selectedTiming) return { hasConflict: false };
    return staffService.detectShiftConflict(
      employeeId,
      date,
      selectedTiming.startTime,
      selectedTiming.endTime
    );
  }, [employeeId, date, selectedTiming]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployee || !selectedTiming) return;

    onSave({
      storeId,
      employeeId: selectedEmployee.id,
      employeeName: selectedEmployee.name,
      roleLabel: selectedEmployee.roleLabel,
      department: selectedEmployee.department,
      date,
      shiftTimingId: selectedTiming.id,
      shiftName: selectedTiming.name,
      startTime: selectedTiming.startTime,
      endTime: selectedTiming.endTime,
      status: 'scheduled',
      hasConflict: conflict.hasConflict,
      conflictReason: conflict.reason,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-sm">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Schedule Staff Shift</h2>
              
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Employee Select */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Employee *
            </label>
            <div className="relative">
              <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} — {emp.roleLabel} ({emp.department})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Date & Shift Timing */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Shift Date *
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Shift *
              </label>
              <div className="relative">
                <Clock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <select
                  value={timingId}
                  onChange={(e) => setTimingId(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {shiftTimings.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.startTime} - {t.endTime})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Conflict Alert Banner */}
          {conflict?.hasConflict && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800">
                <span className="font-semibold">Shift Scheduling Conflict:</span>{' '}
                {conflict.reason}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={conflict?.hasConflict ? 'secondary' : 'primary'}
              className="flex items-center gap-1.5"
            >
              <CheckCircle2 className="h-4 w-4" />
              {conflict?.hasConflict ? 'Confirm Shift Anyway' : 'Schedule Shift'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
