import { runStaffAction, useServerChanged } from '../../services/api/useStaffPage';
import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Clock,
  UserCheck,
  UserX,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Calendar,
  Info,
  Building2,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import { useStaffAuth } from '../../context/StaffAuthContext';
import { staffApiService } from '../../services/staffApiService';
import type { AttendanceRecord } from '../../types/retail';

export const StaffAttendance: React.FC = () => {
  const { currentStaff, storeName } = useStaffAuth();
  const { showToast, refreshBadges } = useOutletContext<{
    showToast: (msg: string) => void;
    refreshBadges: () => void;
  }>();

  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const loadAttendance = async () => {
    if (!currentStaff) return;
    setIsLoading(true);
    try {
      const data = await staffApiService.getAttendance(currentStaff.id, currentStaff.storeId);
      setRecords(data);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAttendance();
  }, [currentStaff]);
  useServerChanged(() => void loadAttendance());

  const latestRecord = records[0];
  const isCheckedIn =
    latestRecord && latestRecord.actualCheckIn && !latestRecord.actualCheckOut;

  const handleCheckIn = async () => {
    if (!currentStaff || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await runStaffAction(() => staffApiService.checkIn(currentStaff), 'Checked in. The server recorded the time.', showToast);
      await loadAttendance();
      refreshBadges();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCheckOut = async () => {
    if (!currentStaff || isSubmitting) return;
    if (!confirm('Are you sure you want to clock out for today?')) return;

    setIsSubmitting(true);
    try {
      await runStaffAction(() => staffApiService.checkOut(currentStaff), 'Checked out. The server recorded the time.', showToast);
      await loadAttendance();
      refreshBadges();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* 1. Page Title */}
      <div>
        <h1 className="text-xl font-black tracking-tight text-slate-900">Attendance Register</h1>
        <p className="text-xs text-slate-500">
          {storeName} • Attendance for {currentStaff?.name.split(' ')[0]}
        </p>
      </div>

      {/* 2. Today's Shift & Live Clock State Card */}
      <div className="bg-white rounded-3xl border border-slate-200 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Current Shift
          </span>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
              isCheckedIn
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isCheckedIn ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
              }`}
            />
            {isCheckedIn ? 'Checked In' : 'Not Clocked In'}
          </span>
        </div>

        <div className="text-center py-2 space-y-1">
          <div className="text-3xl font-black text-slate-900 tracking-tight font-mono">
            {isCheckedIn ? latestRecord.actualCheckIn : '08:00 AM'}
          </div>
          <p className="text-xs text-slate-500">
            {isCheckedIn
              ? `Shift active • Scheduled End: ${latestRecord.scheduledEnd || '04:00 PM'}`
              : `Scheduled Slot: ${currentStaff?.currentShiftLabel || '08:00 – 16:00'}`}
          </p>
        </div>

        {/* Offline Disclaimer Banner if offline */}
        {!isOnline && (
          <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
            <WifiOff className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
            <p className="text-[11px] leading-relaxed">
              <strong>Offline Mode:</strong> Attendance requests logged while offline will be
              explicitly marked <em>"Pending Sync"</em> and will not be verified by the store server
              until network connection is restored.
            </p>
          </div>
        )}

        {/* Action Check-In / Check-Out Buttons */}
        <div className="pt-2">
          {!isCheckedIn ? (
            <button
              onClick={handleCheckIn}
              disabled={isSubmitting}
              className="w-full h-13 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold text-sm shadow-md shadow-emerald-500/20 transition-all flex items-center justify-center gap-2"
            >
              <UserCheck className="h-5 w-5" />
              <span>{isSubmitting ? 'Recording Check-In...' : 'Clock In for Today'}</span>
            </button>
          ) : (
            <button
              onClick={handleCheckOut}
              disabled={isSubmitting}
              className="w-full h-13 rounded-2xl bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white font-bold text-sm shadow-md shadow-slate-900/20 transition-all flex items-center justify-center gap-2"
            >
              <UserX className="h-5 w-5 text-rose-400" />
              <span>{isSubmitting ? 'Processing Clock-Out...' : 'Clock Out (End Shift)'}</span>
            </button>
          )}
        </div>
      </div>

      {/* 3. Authoritative Policy Standard Notice */}
      <div className="p-3.5 rounded-2xl bg-blue-50/70 border border-blue-200/80 text-xs text-blue-900 flex items-start gap-2.5">
        <ShieldCheck className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
        <div className="text-[11px] leading-relaxed space-y-0.5">
          <span className="font-bold">Privacy & Compliance Standard:</span>
          <p>
            Attendance is confirmed by staff, never by cameras.
          </p>
        </div>
      </div>

      {/* 4. Attendance History Register */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Recent Shift Logs
        </h3>

        <div className="space-y-2">
          {records.length === 0 ? (
            <div className="p-6 text-center bg-white rounded-3xl border border-dashed border-slate-200 text-xs text-slate-400">
              No recent attendance records found.
            </div>
          ) : (
            records.map((rec) => (
              <div
                key={rec.id}
                className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-2xs flex items-center justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">{rec.date}</span>
                    <span
                      className={`text-[11px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                        rec.status === 'present'
                          ? 'bg-emerald-100 text-emerald-800'
                          : rec.status === 'late'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {rec.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono flex items-center gap-2">
                    <span>In: {rec.actualCheckIn || '—'}</span>
                    <span>•</span>
                    <span>Out: {rec.actualCheckOut || 'On Duty'}</span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs font-black text-slate-900 font-mono">
                    {rec.totalHoursWorked > 0 ? `${rec.totalHoursWorked} hrs` : 'Active'}
                  </div>
                  <span className="text-[11px] text-slate-400">{rec.scheduledShift.split(' ')[0]}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
