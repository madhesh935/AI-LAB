import React, { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { StaffTopHeader } from './StaffTopHeader';
import { StaffBottomNav } from './StaffBottomNav';
import { OfflineBanner } from './OfflineBanner';
import { useStaffAuth } from '../../context/StaffAuthContext';
import { staffApiService } from '../../services/staffApiService';
import { useRealtime, useLiveRefresh } from '../../services/api/realtime';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export const StaffLayout: React.FC = () => {
  const { currentStaff } = useStaffAuth();
  const location = useLocation();

  const [pendingTasksCount, setPendingTasksCount] = useState<number>(0);
  const [unreadAlertsCount, setUnreadAlertsCount] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadBadges = async () => {
    if (!currentStaff) return;
    try {
      const tasks = await staffApiService.getTasks(currentStaff.id, currentStaff.storeId);
      const pending = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled').length;
      setPendingTasksCount(pending);

      await staffApiService.refreshNotifications(currentStaff.id);
      const notifs = staffApiService.getNotifications(currentStaff.id);
      const unread = notifs.filter((n) => !n.read).length;
      setUnreadAlertsCount(unread);
    } catch {
      // Fallback
    }
  };

  useEffect(() => {
    loadBadges();

    const handleTaskUpdated = () => {
      loadBadges();
      showToast('Task updated and synchronized.');
    };
    const handleAttendanceUpdated = () => {
      loadBadges();
      showToast('Attendance record logged.');
    };

    window.addEventListener('retalledge:task-updated', handleTaskUpdated);
    window.addEventListener('retalledge:attendance-updated', handleAttendanceUpdated);

    return () => {
      window.removeEventListener('retalledge:task-updated', handleTaskUpdated);
      window.removeEventListener('retalledge:attendance-updated', handleAttendanceUpdated);
    };
  }, [currentStaff]);

  // One socket for this phone (audience=staff: task / shift / queue events only). A change made in the admin app shows up here.
  useRealtime(currentStaff?.storeId, 'staff');
  useLiveRefresh(['task.', 'shift.', 'attendance.', 'customer.assistance.'], () => {
    void loadBadges();
    window.dispatchEvent(new CustomEvent('retalledge:server-changed'));
  });

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await loadBadges();
    setTimeout(() => {
      setIsRefreshing(false);
      showToast('Workforce data refreshed.');
    }, 500);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col font-sans selection:bg-blue-100 selection:text-blue-900 antialiased">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-white shadow-xl text-xs font-semibold animate-in slide-in-from-top duration-200">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header */}
      <StaffTopHeader onRefresh={handleManualRefresh} isRefreshing={isRefreshing} />

      {/* Offline Status Alert Strip */}
      <OfflineBanner />

      {/* Mobile-Constrained Responsive Viewport */}
      <main className="flex-1 w-full max-w-md mx-auto px-4 py-4 pb-24">
        <Outlet context={{ showToast, refreshBadges: loadBadges }} />
      </main>

      {/* Fixed Mobile Bottom Navigation */}
      <StaffBottomNav
        pendingTaskCount={pendingTasksCount}
        unreadAlertCount={unreadAlertsCount}
      />
    </div>
  );
};
