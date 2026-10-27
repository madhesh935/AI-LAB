import React, { useState, useEffect } from 'react';
import {
  X,
  Clock,
  ShieldCheck,
  User,
  AlertCircle,
  CheckCircle2,
  FileText,
} from 'lucide-react';
import type { AttendanceRecord, AttendanceStatus } from '../../types/retail';
import { Button } from '../common/Button';

interface AttendanceOverrideModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: AttendanceRecord | null;
  onSaveOverride: (
    recordId: string,
    updates: {
      status: AttendanceStatus;
      actualCheckIn?: string;
      actualCheckOut?: string;
      overrideNote: string;
      overriddenBy: string;
    }
  ) => void;
}

export const AttendanceOverrideModal: React.FC<AttendanceOverrideModalProps> = ({
  isOpen,
  onClose,
  record,
  onSaveOverride,
}) => {
  const [status, setStatus] = useState<AttendanceStatus>('present');
  const [actualCheckIn, setActualCheckIn] = useState('');
  const [actualCheckOut, setActualCheckOut] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (record) {
      setStatus(record.status);
      setActualCheckIn(record.actualCheckIn || record.scheduledStart);
      setActualCheckOut(record.actualCheckOut || '');
      setReason(record.manualOverrideNote || '');
    }
    setError('');
  }, [record, isOpen]);

  if (!isOpen || !record) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('A mandatory reason is required for compliance audit logging.');
      return;
    }

    onSaveOverride(record.id, {
      status,
      actualCheckIn: actualCheckIn.trim() || undefined,
      actualCheckOut: actualCheckOut.trim() || undefined,
      overrideNote: reason.trim(),
      overriddenBy: 'Arvind Mehta (Store Manager)',
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
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Attendance Audit Override</h2>
              <p className="text-xs text-slate-500">
                Adjust check-in/out record for {record.employeeName}
              </p>
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
          {/* Employee Summary Card */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
            <div>
              <div className="font-semibold text-slate-800">{record.employeeName}</div>
              <div className="text-caption text-slate-400">{record.department}</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-slate-700">{record.scheduledShift}</div>
              <div className="text-caption text-slate-400">
                {record.scheduledStart} - {record.scheduledEnd}
              </div>
            </div>
          </div>

          {/* Status Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Status *
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="present">Present (On Time)</option>
              <option value="late">Late Arrival</option>
              <option value="absent">Absent</option>
              <option value="on_leave">On Approved Leave</option>
              <option value="checked_out">Checked Out</option>
              <option value="scheduled">Scheduled (Pending Check-in)</option>
            </select>
          </div>

          {/* Actual Check-In / Check-Out */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Check-in
              </label>
              <div className="relative">
                <Clock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={actualCheckIn}
                  onChange={(e) => setActualCheckIn(e.target.value)}
                  placeholder="08:00 AM"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Check-out
              </label>
              <div className="relative">
                <Clock className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={actualCheckOut}
                  onChange={(e) => setActualCheckOut(e.target.value)}
                  placeholder="04:00 PM"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Mandatory Override Reason */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Reason *
            </label>
            <div className="relative">
              <FileText className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <textarea
                rows={3}
                required
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (error) setError('');
                }}
                placeholder="e.g. Employee badge terminal scan issue verified by Store Manager Arvind; physically present from 07:55 AM."
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
            <p className="text-caption text-slate-400 mt-1">
              Changes are logged under your name.
            </p>
          </div>

          {/* Footer */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" />
              Save
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
