import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar,
  Clock,
  Coffee,
  CheckCircle2,
  AlertCircle,
  MapPin,
  ChevronRight,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { useStaffAuth } from '../../context/StaffAuthContext';
import { staffApiService } from '../../services/staffApiService';
import type { ShiftAssignment } from '../../types/retail';

export const StaffSchedule: React.FC = () => {
  const navigate = useNavigate();
  const { currentStaff, storeName } = useStaffAuth();
  const [viewMode, setViewMode] = useState<'today' | 'week'>('today');
  const [shifts, setShifts] = useState<ShiftAssignment[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const loadSchedule = async () => {
      if (!currentStaff) return;
      setIsLoading(true);
      try {
        const myShifts = await staffApiService.getSchedule(currentStaff.id, currentStaff.storeId);
        setShifts(myShifts);
      } finally {
        setIsLoading(false);
      }
    };
    loadSchedule();
  }, [currentStaff]);

  const todayStr = '2026-10-24';
  const todayShift = shifts.find((s) => s.date === todayStr) || shifts[0];

  const weekShifts = [
    {
      day: 'Monday',
      date: 'Oct 20',
      shiftName: 'Morning Shift',
      hours: '08:00 – 16:00',
      status: 'completed',
      zone: 'Bakery Aisle 3',
    },
    {
      day: 'Tuesday',
      date: 'Oct 21',
      shiftName: 'Morning Shift',
      hours: '08:00 – 16:00',
      status: 'completed',
      zone: 'Stockroom Dock',
    },
    {
      day: 'Wednesday',
      date: 'Oct 22',
      shiftName: 'Morning Shift',
      hours: '08:00 – 16:00',
      status: 'completed',
      zone: 'Aisle 2 (Dairy)',
    },
    {
      day: 'Thursday',
      date: 'Oct 23',
      shiftName: 'Rest Day (Off)',
      hours: '—',
      status: 'off',
      zone: 'Off Duty',
    },
    {
      day: 'Friday',
      date: 'Oct 24',
      shiftName: 'Morning Shift',
      hours: '08:00 – 16:00',
      status: 'active',
      zone: currentStaff?.assignedZone || 'Aisle 3 (Bakery)',
      isToday: true,
    },
    {
      day: 'Saturday',
      date: 'Oct 25',
      shiftName: 'Morning Shift',
      hours: '08:00 – 16:00',
      status: 'upcoming',
      zone: 'Backroom Dock',
    },
    {
      day: 'Sunday',
      date: 'Oct 26',
      shiftName: 'Afternoon Shift',
      hours: '12:00 – 20:00',
      status: 'upcoming',
      zone: 'Floor Runner',
    },
  ];

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* 1. Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-tight text-slate-900">Shift Schedule</h1>
          <p className="text-xs text-slate-500">
            {storeName} • Roster for {currentStaff?.name.split(' ')[0]}
          </p>
        </div>

        {/* View Switcher: Today / Week */}
        <div className="flex items-center bg-slate-200/70 p-1 rounded-xl text-xs font-bold">
          <button
            onClick={() => setViewMode('today')}
            className={`px-3 py-1 rounded-lg transition-all ${
              viewMode === 'today' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setViewMode('week')}
            className={`px-3 py-1 rounded-lg transition-all ${
              viewMode === 'week' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600'
            }`}
          >
            This Week
          </button>
        </div>
      </div>

      {/* 2. Today's Highlighted Active Shift Card */}
      <div className="bg-white rounded-3xl border-2 border-blue-600/80 p-5 shadow-sm space-y-3 relative overflow-hidden">
        <div className="absolute top-0 right-0 bg-blue-600 text-white text-[11px] font-bold uppercase px-3 py-1 rounded-bl-xl tracking-wider">
          Active Shift
        </div>

        <div className="space-y-1">
          <span className="text-xs uppercase font-bold text-blue-600 tracking-wider">
            Today • Friday, Oct 24, 2026
          </span>
          <h2 className="text-lg font-black text-slate-900">
            {todayShift?.shiftName || 'Morning Shift'}
          </h2>
          <div className="text-2xl font-black text-slate-900 tracking-tight flex items-baseline gap-2">
            <span>{todayShift?.startTime || '08:00'} – {todayShift?.endTime || '16:00'}</span>
            <span className="text-xs font-semibold text-slate-500">8.0 hrs</span>
          </div>
        </div>

        {/* Location & Break details */}
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 text-xs">
          <div className="space-y-1">
            <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">
              Assigned Zone
            </span>
            <div className="flex items-center gap-1.5 font-bold text-slate-800">
              <MapPin className="h-4 w-4 text-blue-600 shrink-0" />
              <span className="line-clamp-1">{currentStaff?.assignedZone || 'Aisle 3 (Bakery)'}</span>
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">
              Meal Break
            </span>
            <div className="flex items-center gap-1.5 font-bold text-slate-800">
              <Coffee className="h-4 w-4 text-amber-500 shrink-0" />
              <span>12:00 – 12:45 (45m)</span>
            </div>
          </div>
        </div>

        {/* Direct Link to Attendance Check-In */}
        <div className="pt-2">
          <button
            onClick={() => navigate('/staff/attendance')}
            className="w-full py-2.5 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors border border-blue-200"
          >
            <UserCheck className="h-4 w-4" />
            <span>Open Attendance & Check In</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 3. Week View or Upcoming Schedule List */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          {viewMode === 'today' ? 'Upcoming Roster' : 'Weekly Schedule Overview'}
        </h3>

        <div className="space-y-2">
          {weekShifts.map((shift, idx) => (
            <div
              key={idx}
              className={`p-3.5 rounded-2xl border transition-colors flex items-center justify-between ${
                shift.isToday
                  ? 'bg-blue-50/60 border-blue-300'
                  : shift.status === 'off'
                  ? 'bg-slate-50 border-slate-200 text-slate-400'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center font-bold shrink-0 ${
                    shift.isToday
                      ? 'bg-blue-600 text-white shadow-xs'
                      : shift.status === 'off'
                      ? 'bg-slate-200 text-slate-500'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  <span className="text-[11px] uppercase font-mono">{shift.day.slice(0, 3)}</span>
                  <span className="text-xs leading-none">{shift.date.slice(-2)}</span>
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">{shift.shiftName}</span>
                    {shift.isToday && (
                      <span className="text-[11px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded-full">
                        Today
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                    <Clock className="h-3 w-3" />
                    <span>{shift.hours}</span>
                    <span>•</span>
                    <span>{shift.zone}</span>
                  </div>
                </div>
              </div>

              <div>
                <span
                  className={`text-[11px] font-bold uppercase px-2 py-0.5 rounded-full ${
                    shift.status === 'active'
                      ? 'bg-emerald-100 text-emerald-800'
                      : shift.status === 'completed'
                      ? 'bg-slate-100 text-slate-600'
                      : shift.status === 'off'
                      ? 'bg-slate-100 text-slate-400'
                      : 'bg-blue-50 text-blue-700 border border-blue-200'
                  }`}
                >
                  {shift.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Policy Notice */}
      <div className="p-3.5 rounded-2xl bg-slate-100 border border-slate-200 text-[11px] text-slate-500 leading-relaxed space-y-1">
        <span className="font-bold text-slate-700">Roster Scheduling Rules:</span>
        <p>
          Request swaps or leave 24 hours ahead.
          Contact store supervisor for emergency shift changes.
        </p>
      </div>
    </div>
  );
};
