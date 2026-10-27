import { runStaffAction, useServerChanged } from '../../services/api/useStaffPage';
import React, { useState, useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  Clock,
  ClipboardList,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  UserCheck,
  Calendar,
  Bell,
  Sparkles,
  MapPin,
  ChevronRight,
  TrendingUp,
} from 'lucide-react';
import { useStaffAuth } from '../../context/StaffAuthContext';
import { staffApiService, type StaffNotificationItem } from '../../services/staffApiService';
import type { StaffTaskExtended, AttendanceRecord } from '../../types/retail';
import { TaskCardMobile } from '../../components/staff-pwa/TaskCardMobile';

export const StaffHome: React.FC = () => {
  const navigate = useNavigate();
  const { currentStaff } = useStaffAuth();
  const { showToast, refreshBadges } = useOutletContext<{
    showToast: (msg: string) => void;
    refreshBadges: () => void;
  }>();

  const [tasks, setTasks] = useState<StaffTaskExtended[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [notifications, setNotifications] = useState<StaffNotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadHomeData = async () => {
    if (!currentStaff) return;
    setIsLoading(true);
    try {
      const taskList = await staffApiService.getTasks(currentStaff.id, currentStaff.storeId);
      setTasks(taskList);

      const attList = await staffApiService.getAttendance(currentStaff.id, currentStaff.storeId);
      setAttendance(attList);

      await staffApiService.refreshNotifications(currentStaff.id);
      setNotifications(staffApiService.getNotifications(currentStaff.id));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHomeData();
  }, [currentStaff]);
  useServerChanged(() => void loadHomeData());

  // Calculations
  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  const todayTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress').length;
  const pendingTasks = tasks.filter((t) => t.status === 'new' || t.status === 'assigned').length;

  const priorityTasks = tasks.filter(
    (t) => (t.priority === 'critical' || t.priority === 'high') && t.status !== 'completed'
  );

  const latestAtt = attendance[0];
  const isCheckedIn = latestAtt ? !!latestAtt.actualCheckIn && !latestAtt.actualCheckOut : currentStaff?.attendance === 'present' || currentStaff?.attendance === 'late';
  const urgentNotifications = notifications.filter((n) => !n.read && n.priority === 'critical');

  // Quick Action Handlers
  const handleAcceptTask = async (taskId: string) => {
    if (!currentStaff) return;
    await runStaffAction(() => staffApiService.acceptTask(taskId, currentStaff.id), 'Task accepted.', showToast);
    await loadHomeData();
    refreshBadges();
  };

  const handleStartTask = async (taskId: string) => {
    if (!currentStaff) return;
    await runStaffAction(() => staffApiService.startTask(taskId, currentStaff.id), 'Work started.', showToast);
    await loadHomeData();
    refreshBadges();
  };

  const handleCompleteTask = async (taskId: string) => {
    if (!currentStaff) return;
    await runStaffAction(() => staffApiService.completeTask(taskId, currentStaff.id), 'Task completed and confirmed by the store server.', showToast);
    await loadHomeData();
    refreshBadges();
  };

  const handleQuickAttendance = async () => {
    if (!currentStaff) return;
    if (isCheckedIn) {
      navigate('/staff/attendance');
    } else {
      await runStaffAction(() => staffApiService.checkIn(currentStaff), 'Checked in. The server recorded the time.', showToast);
      await loadHomeData();
      refreshBadges();
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* 1. Header Greeting & Associate Scope Card */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-3xl p-5 shadow-md shadow-blue-500/20 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider font-bold text-blue-200">
            {currentStaff?.storeId?.toUpperCase()} • {greeting()}
          </span>
          <span
            className={`flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full backdrop-blur-xs ${
              isCheckedIn
                ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-400/30'
                : 'bg-white/20 text-white border border-white/20'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isCheckedIn ? 'bg-emerald-400 animate-pulse' : 'bg-slate-300'
              }`}
            />
            {isCheckedIn ? 'On Duty' : 'Shift Not Started'}
          </span>
        </div>

        <div>
          <h1 className="text-xl font-black tracking-tight">
            {currentStaff?.name || 'Retail Associate'}
          </h1>
          <p className="text-xs text-blue-100 mt-0.5 flex items-center gap-1.5">
            <span>{currentStaff?.roleLabel}</span>
            <span>•</span>
            <span>{currentStaff?.department}</span>
          </p>
        </div>

        {/* Current Shift Strip */}
        <div className="pt-2 border-t border-blue-500/40 flex items-center justify-between text-xs text-blue-100">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-blue-300" />
            <span>Shift: {currentStaff?.currentShiftLabel || '08:00 – 16:00'}</span>
          </div>
          <button
            onClick={handleQuickAttendance}
            className="text-[11px] font-bold underline hover:text-white"
          >
            {isCheckedIn ? 'Attendance Record →' : 'Tap to Check In →'}
          </button>
        </div>
      </div>

      {/* 2. Critical Alert Banner (if any) */}
      {urgentNotifications.length > 0 && (
        <div
          onClick={() => navigate('/staff/notifications')}
          className="bg-rose-50 border border-rose-200 rounded-2xl p-3.5 flex items-start gap-3 cursor-pointer hover:bg-rose-100/60 transition-colors shadow-2xs"
        >
          <div className="p-1.5 rounded-xl bg-rose-600 text-white shrink-0 mt-0.5">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-rose-900 line-clamp-1">
                {urgentNotifications[0].title}
              </span>
              <span className="text-[11px] text-rose-500 font-mono">
                {urgentNotifications[0].timestamp}
              </span>
            </div>
            <p className="text-[11px] text-rose-700 line-clamp-2 mt-0.5">
              {urgentNotifications[0].message}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-rose-400 self-center shrink-0" />
        </div>
      )}

      {/* 3. Large KPI Cards Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Today's Tasks */}
        <div
          onClick={() => navigate('/staff/tasks')}
          className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs hover:border-slate-300 transition-colors cursor-pointer space-y-1"
        >
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Today's Tasks</span>
            <ClipboardList className="h-4 w-4 text-blue-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 tracking-tight">{todayTasks}</div>
          <div className="text-[11px] text-slate-400">{inProgressTasks} in progress</div>
        </div>

        {/* Completed Tasks */}
        <div
          onClick={() => navigate('/staff/tasks')}
          className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs hover:border-slate-300 transition-colors cursor-pointer space-y-1"
        >
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Completed</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-600 tracking-tight">{completedTasks}</div>
          <div className="text-[11px] text-slate-400">Restocked & Assisted</div>
        </div>

        {/* Pending Tasks */}
        <div
          onClick={() => navigate('/staff/tasks')}
          className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs hover:border-slate-300 transition-colors cursor-pointer space-y-1"
        >
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Pending Action</span>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-600 tracking-tight">{pendingTasks}</div>
          <div className="text-[11px] text-slate-400">Awaiting your response</div>
        </div>

        {/* Shift Timing */}
        <div
          onClick={() => navigate('/staff/schedule')}
          className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs hover:border-slate-300 transition-colors cursor-pointer space-y-1"
        >
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Shift Time</span>
            <Clock className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="text-base font-bold text-slate-900 tracking-tight pt-1">08:00 – 16:00</div>
          <div className="text-[11px] text-indigo-600 font-semibold">Morning Slot</div>
        </div>
      </div>

      {/* 4. Priority Operational Tasks Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900">Priority Assignments</h2>
          </div>
          <button
            onClick={() => navigate('/staff/tasks')}
            className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-0.5"
          >
            <span>View All ({tasks.length})</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {priorityTasks.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-6 text-center space-y-2">
            <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto" />
            <p className="text-xs font-bold text-slate-800">No urgent tasks pending</p>
            <p className="text-[11px] text-slate-400">
              Nothing urgent right now.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {priorityTasks.map((task) => (
              <TaskCardMobile
                key={task.id}
                task={task}
                onAccept={handleAcceptTask}
                onStart={handleStartTask}
                onComplete={handleCompleteTask}
              />
            ))}
          </div>
        )}
      </div>

      {/* 5. Quick Actions Grid */}
      <div className="space-y-2">
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Quick Workstation Actions
        </h2>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={() => navigate('/staff/tasks')}
            className="p-3.5 rounded-2xl bg-white border border-slate-200 hover:border-blue-400 transition-colors text-left flex items-center gap-3 shadow-2xs"
          >
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-800">My Tasks</div>
              <div className="text-[11px] text-slate-400">All assignments</div>
            </div>
          </button>

          <button
            onClick={() => navigate('/staff/attendance')}
            className="p-3.5 rounded-2xl bg-white border border-slate-200 hover:border-blue-400 transition-colors text-left flex items-center gap-3 shadow-2xs"
          >
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-800">Attendance</div>
              <div className="text-[11px] text-slate-400">Check in / out</div>
            </div>
          </button>

          <button
            onClick={() => navigate('/staff/schedule')}
            className="p-3.5 rounded-2xl bg-white border border-slate-200 hover:border-blue-400 transition-colors text-left flex items-center gap-3 shadow-2xs"
          >
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
              <Calendar className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-800">Shift Schedule</div>
              <div className="text-[11px] text-slate-400">Weekly roster</div>
            </div>
          </button>

          <button
            onClick={() => navigate('/staff/notifications')}
            className="p-3.5 rounded-2xl bg-white border border-slate-200 hover:border-blue-400 transition-colors text-left flex items-center gap-3 shadow-2xs"
          >
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-slate-800">Alerts & Comms</div>
              <div className="text-[11px] text-slate-400">{notifications.length} notices</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
