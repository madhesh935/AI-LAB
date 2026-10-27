import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Menu,
  Search,
  MapPin,
  Bell,
  ChevronDown,
  RotateCw,
} from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { NotificationsPopover } from './NotificationsPopover';
import { ModeBadge } from '../common/ModeBadge';

interface HeaderProps {
  onMenuClick: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onMenuClick }) => {
  const location = useLocation();
  const {
    stores,
    selectedStore,
    setSelectedStoreId,
    unreadCount,
    setIsSearchOpen,
    isRefreshing,
    refreshData,
  } = useStore();

  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      );
      setCurrentDate(
        now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const getPageTitle = () => {
    switch (location.pathname) {
      case '/':
        return 'Store Overview';
      case '/shopper-analytics':
        return 'Shopper Analytics';
      case '/smart-inventory':
        return 'Smart Inventory';
      case '/queue-intelligence':
        return 'Queue Intelligence';
      case '/ai-insights':
        return 'AI Insights';
      case '/reports':
        return 'Reports & Analytics';
      case '/staff-management':
        return 'Staff Management';
      case '/store-copilot':
        return 'Store Copilot AI';
      default:
        return 'Store Overview';
    }
  };

  return (
    <header className="sticky top-0 z-20 h-16 bg-white/95 backdrop-blur-md border-b border-slate-200/90 px-4 sm:px-6 flex items-center justify-between gap-3">
      {/* Left: Mobile hamburger & Page Title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="min-w-0">
          <h1 className="text-base sm:text-xl font-semibold text-slate-900 tracking-tight leading-tight truncate">
            {getPageTitle()}
          </h1>
          <div className="hidden sm:flex items-center gap-2 text-caption text-slate-500">
            <span>{currentDate}</span>
            <span>&bull;</span>
            <span className="font-mono text-slate-600">{currentTime}</span>
          </div>
        </div>
      </div>

      {/* Middle: Quick Search Input */}
      <div className="hidden md:flex flex-1 min-w-0 max-w-md mx-2">
        <button
          onClick={() => setIsSearchOpen(true)}
          className="w-full flex items-center justify-between px-3.5 py-1.5 bg-slate-50 hover:bg-slate-100/80 border border-slate-200 text-slate-500 rounded-xl text-xs transition-colors cursor-pointer group"
        >
          <span className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600" />
            <span className="truncate">Search cameras, inventory shelves, alerts...</span>
          </span>
          <kbd className="hidden lg:inline-block px-1.5 py-0.5 text-caption font-mono bg-white border border-slate-200 rounded shadow-2xs text-slate-400">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right: Store Selector, Connection Badge, Notifications, User */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Mobile search icon */}
        <button
          onClick={() => setIsSearchOpen(true)}
          className="md:hidden p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl"
          aria-label="Search"
        >
          <Search className="w-4 h-4" />
        </button>

        <ModeBadge />

        {/* Store Location Selector */}
        <div className="relative">
          <div className="relative flex items-center bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-2.5 py-1.5 transition-colors">
            <MapPin className="w-3.5 h-3.5 text-blue-600 sm:mr-1.5 shrink-0" />
            <select
              value={selectedStore.id}
              onChange={(e) => setSelectedStoreId(e.target.value)}
              className="bg-transparent text-xs font-semibold text-slate-800 pr-4 focus:outline-none cursor-pointer appearance-none truncate absolute inset-0 w-full opacity-0 sm:static sm:w-auto sm:opacity-100 sm:max-w-[11rem] xl:max-w-[20rem]"
              title="Switch Retail Store"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.city && !s.name.toLowerCase().includes(s.city.toLowerCase()) ? `${s.name} (${s.city})` : s.name}
                </option>
              ))}
            </select>
            <ChevronDown className="hidden sm:block w-3.5 h-3.5 text-slate-400 -ml-3 pointer-events-none" />
          </div>
        </div>

        {/* Global Live Refresh */}
        <button
          onClick={refreshData}
          disabled={isRefreshing}
          className="hidden sm:inline-flex p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
          title="Refresh store telemetry"
        >
          <RotateCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
        </button>

        {/* Notification Bell with Popover */}
        <div className="relative">
          <button
            onClick={() => setIsNotifOpen(!isNotifOpen)}
            className="relative p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            aria-label="Open notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-600 rounded-full ring-2 ring-white animate-pulse" />
            )}
          </button>
          <NotificationsPopover isOpen={isNotifOpen} onClose={() => setIsNotifOpen(false)} />
        </div>

        {/* User Avatar */}
        <div className="flex items-center gap-2 pl-1 border-l border-slate-200">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-semibold text-xs flex items-center justify-center ring-2 ring-slate-100">
            SC
          </div>
          <div className="hidden 2xl:block text-left">
            <p className="text-xs font-semibold text-slate-900 leading-tight">Store Console</p>
            <p className="text-caption text-slate-400 leading-none">{selectedStore.name}</p>
          </div>
        </div>
      </div>
    </header>
  );
};
