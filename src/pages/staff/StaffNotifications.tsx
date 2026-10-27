import { useServerChanged } from '../../services/api/useStaffPage';
import React, { useState, useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  Bell,
  AlertTriangle,
  Boxes,
  Users,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Sparkles,
  CheckCheck,
} from 'lucide-react';
import { useStaffAuth } from '../../context/StaffAuthContext';
import { staffApiService, type StaffNotificationItem } from '../../services/staffApiService';

export const StaffNotifications: React.FC = () => {
  const navigate = useNavigate();
  const { currentStaff } = useStaffAuth();
  const { showToast, refreshBadges } = useOutletContext<{
    showToast: (msg: string) => void;
    refreshBadges: () => void;
  }>();

  const [notifications, setNotifications] = useState<StaffNotificationItem[]>([]);
  const [filterType, setFilterType] = useState<string>('all');
  const [pushStatus, setPushStatus] = useState<string>('default');

  const loadNotifs = async () => {
    if (!currentStaff) return;
    try {
      await staffApiService.refreshNotifications(currentStaff.id);
    } catch {
      /* keep what we have */
    }
    setNotifications(staffApiService.getNotifications(currentStaff.id));
  };

  useServerChanged(() => void loadNotifs());

  useEffect(() => {
    void loadNotifs();
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPushStatus(Notification.permission);
    }
  }, [currentStaff]);

  const handleNotificationClick = (item: StaffNotificationItem) => {
    staffApiService.markNotificationAsRead(item.id);
    loadNotifs();
    refreshBadges();

    if (item.taskId) {
      navigate(`/staff/tasks/${item.taskId}`);
    }
  };

  const handleMarkAllRead = () => {
    notifications.forEach((n) => staffApiService.markNotificationAsRead(n.id));
    loadNotifs();
    refreshBadges();
    showToast('All notifications marked as read.');
  };

  const handleEnablePush = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const permission = await Notification.requestPermission();
        setPushStatus(permission);
        if (permission === 'granted') {
          showToast('Web push notifications enabled for urgent retail alerts.');
          new Notification('RetailEdge Staff', {
            body: 'Push notifications connected.',
            icon: '/icons/staff-icon-192.svg',
          });
        }
      } catch {
        showToast('Push notifications not available on this browser.');
      }
    } else {
      showToast('Push notifications not supported on this browser.');
    }
  };

  const filteredNotifs = filterType === 'all'
    ? notifications
    : notifications.filter((n) => n.type === filterType);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const getTypeIcon = (type: StaffNotificationItem['type']) => {
    switch (type) {
      case 'urgent_inventory':
        return <Boxes className="h-4 w-4 text-indigo-600" />;
      case 'queue_assistance':
        return <Users className="h-4 w-4 text-rose-600" />;
      case 'shift_change':
        return <Calendar className="h-4 w-4 text-blue-600" />;
      default:
        return <Bell className="h-4 w-4 text-amber-500" />;
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* 1. Header & Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black tracking-tight text-slate-900">Alerts & Comms</h1>
          <p className="text-xs text-slate-500">
            {unreadCount > 0 ? `${unreadCount} unread notices` : 'All caught up'}
          </p>
        </div>

        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 bg-white border border-slate-200 px-3 py-1.5 rounded-xl shadow-2xs"
          >
            <CheckCheck className="h-4 w-4" />
            <span>Mark All Read</span>
          </button>
        )}
      </div>

      {/* 2. Web Push Permission Banner if not enabled */}
      {pushStatus !== 'granted' && (
        <div className="bg-blue-50 border border-blue-200 rounded-3xl p-4 flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-600 text-white shrink-0">
              <Bell className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-blue-900">Enable Urgent Push Alerts</p>
              <p className="text-[11px] text-blue-700">
                Get alerts when shelves run low or a cashier is needed.
              </p>
            </div>
          </div>
          <button
            onClick={handleEnablePush}
            className="text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-xl whitespace-nowrap shadow-xs"
          >
            Allow Push
          </button>
        </div>
      )}

      {/* 3. Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
        {[
          { label: 'All Alerts', value: 'all' },
          { label: 'Shelf Restock', value: 'urgent_inventory' },
          { label: 'Queue Surges', value: 'queue_assistance' },
          { label: 'Shift Updates', value: 'shift_change' },
        ].map((f) => (
          <button
            key={f.value}
            onClick={() => setFilterType(f.value)}
            className={`px-3 py-1.5 rounded-xl font-semibold whitespace-nowrap transition-colors ${
              filterType === f.value
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 4. Notifications List */}
      <div className="space-y-2.5">
        {filteredNotifs.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-3xl border border-dashed border-slate-200 space-y-2">
            <Bell className="h-8 w-8 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-800">No Notifications</h3>
            <p className="text-xs text-slate-400">You have no active alerts in this category.</p>
          </div>
        ) : (
          filteredNotifs.map((item) => (
            <div
              key={item.id}
              onClick={() => handleNotificationClick(item)}
              className={`p-4 rounded-3xl border transition-all cursor-pointer shadow-2xs space-y-2 ${
                !item.read
                  ? 'bg-white border-blue-300 shadow-sm ring-1 ring-blue-500/10'
                  : 'bg-white/80 border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-slate-100 shrink-0">
                    {getTypeIcon(item.type)}
                  </div>
                  <span className="text-xs font-bold text-slate-900 line-clamp-1">
                    {item.title}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {!item.read && (
                    <span className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
                  )}
                  <span className="text-[11px] font-mono text-slate-400">{item.timestamp}</span>
                </div>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed pl-7">{item.message}</p>

              {item.taskId && (
                <div className="pl-7 pt-1 flex items-center justify-between text-xs">
                  <span className="text-[11px] font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                    Task #{item.taskId}
                  </span>
                  <span className="text-[11px] font-bold text-blue-600 flex items-center gap-0.5">
                    <span>View Task</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
