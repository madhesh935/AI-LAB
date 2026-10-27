import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Boxes,
  Clock,
  Sparkles,
  BarChart3,
  Bot,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Building2,
  X,
} from 'lucide-react';
import { cn } from '../../utils/cn';

interface SidebarProps {
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  isMobileOpen: boolean;
  setIsMobileOpen: (open: boolean) => void;
}

export const navigationItems = [
  { name: 'Overview Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Shopper Analytics', path: '/shopper-analytics', icon: Users },
  { name: 'Smart Inventory', path: '/smart-inventory', icon: Boxes },
  { name: 'Queue Intelligence', path: '/queue-intelligence', icon: Clock },
  { name: 'AI Insights', path: '/ai-insights', icon: Sparkles },
  { name: 'Reports & Analytics', path: '/reports', icon: BarChart3 },
  { name: 'Staff Management', path: '/staff-management', icon: Briefcase },
  { name: 'Store Copilot', path: '/store-copilot', icon: Bot },
];

export const Sidebar: React.FC<SidebarProps> = ({
  isCollapsed,
  setIsCollapsed,
  isMobileOpen,
  setIsMobileOpen,
}) => {
  const location = useLocation();

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white border-r border-slate-200 select-none">
      {/* Brand Header */}
      <div
        className={cn(
          'h-16 flex items-center border-b border-slate-100 transition-all',
          isCollapsed ? 'justify-center px-0' : 'px-4 justify-between'
        )}
      >
        <div
          onClick={() => isCollapsed && setIsCollapsed(false)}
          className={cn(
            'flex items-center gap-3',
            isCollapsed && 'cursor-pointer hover:opacity-90'
          )}
          title={isCollapsed ? 'Click to expand sidebar' : undefined}
        >
          <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shrink-0 shadow-sm shadow-blue-500/20">
            <ShieldCheck className="w-5 h-5" />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col min-w-0 transition-opacity duration-200">
              <span className="font-semibold text-slate-900 tracking-tight text-base leading-tight">
                RetailEdge<span className="text-blue-600 font-semibold">.AI</span>
              </span>
              <span className="text-caption uppercase font-semibold tracking-wider text-slate-400">
                Retail Analytics
              </span>
            </div>
          )}
        </div>

        {/* Mobile close button */}
        <button
          onClick={() => setIsMobileOpen(false)}
          className="lg:hidden p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
          aria-label="Close sidebar"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation - EXACTLY 8 ITEMS */}
      <div className="flex-1 py-4 px-2.5 space-y-1 overflow-y-auto">
        <div className={cn('px-2.5 pb-2 text-caption font-semibold uppercase tracking-wider text-slate-400', isCollapsed && 'sr-only')}>
          Store Intelligence
        </div>
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;

          return (
            <NavLink
              key={item.name}
              to={item.path}
              onClick={() => setIsMobileOpen(false)}
              className={cn(
                'group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all duration-150',
                isActive
                  ? 'bg-blue-50 text-blue-700 font-semibold shadow-xs'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                isCollapsed && 'justify-center px-0'
              )}
              title={isCollapsed ? item.name : undefined}
            >
              {isActive && (
                <span className="absolute left-0 top-2 bottom-2 w-1 bg-blue-600 rounded-r-full" />
              )}
              <Icon
                className={cn(
                  'w-4 h-4 shrink-0 transition-colors',
                  isActive ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'
                )}
              />
              {!isCollapsed && <span className="truncate">{item.name}</span>}
            </NavLink>
          );
        })}
      </div>

      {/* User Profile Area near bottom */}
      <div className="p-3 border-t border-slate-100 bg-white">
        <div
          className={cn(
            'flex items-center gap-3 p-1.5 rounded-xl hover:bg-slate-50 transition-colors',
            isCollapsed && 'justify-center p-0'
          )}
        >
          <div className="relative shrink-0">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-semibold text-xs flex items-center justify-center ring-2 ring-white">
              SC
            </div>
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full" />
          </div>
          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-900 truncate">Store Console</p>
              <div className="flex items-center gap-1 text-caption text-slate-500">
                <Building2 className="w-3 h-3 text-slate-400 shrink-0" />
                <span className="truncate">Local access, no sign-in</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside
        className={cn(
          'hidden lg:block fixed left-0 top-0 bottom-0 z-30 transition-all duration-300 ease-in-out',
          isCollapsed ? 'w-20' : 'w-64'
        )}
      >
        {/* Desktop collapse toggle on dividing border */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="hidden lg:flex absolute -right-3 top-5 w-6 h-6 rounded-full bg-white border border-slate-200 shadow-sm items-center justify-center text-slate-500 hover:text-blue-600 hover:border-blue-300 hover:shadow transition-all z-40 cursor-pointer"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>

        {sidebarContent}
      </aside>

      {/* Mobile Drawer Backdrop */}
      {isMobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Mobile Drawer */}
      <div
        className={cn(
          'lg:hidden fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-2xl transform transition-transform duration-300 ease-in-out',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {sidebarContent}
      </div>
    </>
  );
};
