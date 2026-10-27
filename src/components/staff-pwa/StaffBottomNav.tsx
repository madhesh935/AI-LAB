import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Home,
  ClipboardList,
  Calendar,
  Bell,
  User,
} from 'lucide-react';
import { useStaffAuth } from '../../context/StaffAuthContext';
import { staffApiService } from '../../services/staffApiService';

interface StaffBottomNavProps {
  pendingTaskCount?: number;
  unreadAlertCount?: number;
}

export const StaffBottomNav: React.FC<StaffBottomNavProps> = ({
  pendingTaskCount = 0,
  unreadAlertCount = 0,
}) => {
  const location = useLocation();

  const navItems = [
    {
      to: '/staff',
      label: 'Home',
      icon: Home,
      exact: true,
      badge: 0,
    },
    {
      to: '/staff/tasks',
      label: 'Tasks',
      icon: ClipboardList,
      exact: false,
      badge: pendingTaskCount,
    },
    {
      to: '/staff/schedule',
      label: 'Schedule',
      icon: Calendar,
      exact: false,
      badge: 0,
    },
    {
      to: '/staff/notifications',
      label: 'Alerts',
      icon: Bell,
      exact: false,
      badge: unreadAlertCount,
    },
    {
      to: '/staff/profile',
      label: 'Profile',
      icon: User,
      exact: false,
      badge: 0,
    },
  ];

  const isActive = (item: typeof navItems[0]) => {
    if (item.exact) {
      return location.pathname === item.to;
    }
    return location.pathname.startsWith(item.to);
  };

  return (
    <nav
      aria-label="Staff Bottom Navigation"
      className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-lg px-2 pb-[env(safe-area-inset-bottom,0px)]"
    >
      <div className="max-w-md mx-auto flex items-center justify-around h-16">
        {navItems.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={`relative flex flex-col items-center justify-center flex-1 h-full py-1 text-[11px] font-semibold transition-colors ${
                active ? 'text-blue-600' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <div className="relative">
                <div
                  className={`p-1 rounded-xl transition-all ${
                    active ? 'bg-blue-50 text-blue-600' : 'text-slate-500'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </div>

                {/* Badge Counter */}
                {item.badge > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-rose-500 text-[11px] font-bold text-white shadow-xs animate-pulse">
                    {item.badge > 9 ? '9+' : item.badge}
                  </span>
                )}
              </div>

              <span className={`mt-0.5 tracking-tight ${active ? 'font-bold' : 'font-medium'}`}>
                {item.label}
              </span>

              {/* Active Indicator Bar */}
              {active && (
                <span className="absolute bottom-1 w-6 h-0.5 rounded-full bg-blue-600" />
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
};
