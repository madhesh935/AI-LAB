import React, { useRef, useEffect } from 'react';
import { Bell, CheckCheck, AlertTriangle, AlertCircle, Info, Sparkles } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { cn } from '../../utils/cn';

interface NotificationsPopoverProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationsPopover: React.FC<NotificationsPopoverProps> = ({ isOpen, onClose }) => {
  const { notifications, markNotificationRead, clearAllNotifications, unreadCount } = useStore();
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const getIcon = (type: string) => {
    switch (type) {
      case 'critical':
        return <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />;
      default:
        return <Info className="w-4 h-4 text-blue-500 shrink-0" />;
    }
  };

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-12 w-80 sm:w-96 bg-white rounded-2xl shadow-xl border border-slate-200 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
    >
      <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-slate-700" />
          <h4 className="text-xs font-semibold text-slate-900">Notifications</h4>
          {unreadCount > 0 && (
            <span className="bg-blue-600 text-white text-caption font-semibold px-1.5 py-0.5 rounded-full">
              {unreadCount} new
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={clearAllNotifications}
            className="text-caption font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1 cursor-pointer"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark all read
          </button>
        )}
      </div>

      <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
        {notifications.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">No notifications</div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => markNotificationRead(n.id)}
              className={cn(
                'p-3.5 flex items-start gap-3 transition-colors cursor-pointer hover:bg-slate-50',
                !n.read && 'bg-blue-50/30'
              )}
            >
              <div className="mt-0.5">{getIcon(n.type)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <p className={cn('text-xs font-medium text-slate-900 truncate', !n.read && 'font-semibold')}>
                    {n.title}
                  </p>
                  <span className="text-caption text-slate-400 shrink-0">{n.timestamp}</span>
                </div>
                <p className="text-caption text-slate-500 leading-snug line-clamp-2">{n.detail}</p>
              </div>
              {!n.read && <span className="w-2 h-2 rounded-full bg-blue-600 mt-1 shrink-0" />}
            </div>
          ))
        )}
      </div>

      <div className="p-2.5 bg-slate-50 border-t border-slate-100 text-center">
        <span className="text-caption text-slate-500 inline-flex items-center gap-1.5">
          <Sparkles className="w-3 h-3 text-blue-600" />
          Live updates on
        </span>
      </div>
    </div>
  );
};
