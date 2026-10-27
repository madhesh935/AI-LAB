import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Wifi,
  WifiOff,
  RefreshCw,
  User,
  ChevronDown,
  Building2,
  Sparkles,
} from 'lucide-react';
import { useStaffAuth } from '../../context/StaffAuthContext';
import { offlineStorage } from '../../services/offlineStorage';

interface StaffTopHeaderProps {
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export const StaffTopHeader: React.FC<StaffTopHeaderProps> = ({
  onRefresh,
  isRefreshing = false,
}) => {
  const { currentStaff, quickSwitchUser, availableStaffList } = useStaffAuth();
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pendingCount, setPendingCount] = useState<number>(offlineStorage.getPendingCount());
  const [isSwitchMenuOpen, setIsSwitchMenuOpen] = useState<boolean>(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleQueueChange = (e: any) => {
      setPendingCount(e.detail?.pendingCount ?? offlineStorage.getPendingCount());
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('retalledge:offline-queue-changed', handleQueueChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('retalledge:offline-queue-changed', handleQueueChange);
    };
  }, []);

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 py-2.5 shadow-2xs">
      <div className="max-w-md mx-auto flex items-center justify-between">
        {/* Brand & Store */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-xs shadow-blue-500/20">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 leading-none">
              <span className="font-bold text-slate-900 text-sm tracking-tight">
                RetailEdge<span className="text-blue-600 font-extrabold">.Staff</span>
              </span>
              <span className="text-[11px] font-mono font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
                CHN-104
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium mt-0.5">T. Nagar Superstore (Chennai)</p>
          </div>
        </div>

        {/* Right Status & Active Profile */}
        <div className="flex items-center gap-2">
          {/* Online / Offline Status Badge */}
          {isOnline ? (
            <span
              title="Connected to RetailEdge Store Gateway"
              className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Online
            </span>
          ) : (
            <span
              title={`${pendingCount} mutations queued in local cache`}
              className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full"
            >
              <WifiOff className="h-3 w-3 text-amber-600" />
              {pendingCount > 0 ? `${pendingCount} Offline` : 'Offline'}
            </span>
          )}

          {/* Quick Refresh */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
              aria-label="Refresh live data"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
            </button>
          )}

          {/* User Profile Avatar / Quick Switcher */}
          <div className="relative">
            <button
              onClick={() => setIsSwitchMenuOpen(!isSwitchMenuOpen)}
              className="flex items-center gap-1 p-0.5 rounded-full border border-slate-200 bg-slate-50 hover:border-slate-300"
            >
              <img
                src={
                  currentStaff?.avatar ||
                  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&crop=face'
                }
                alt={currentStaff?.name || 'Staff User'}
                className="w-7 h-7 rounded-full object-cover"
              />
              <ChevronDown className="h-3 w-3 text-slate-400 mr-1" />
            </button>

            {/* Switch Menu Dropdown */}
            {isSwitchMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-transparent"
                  onClick={() => setIsSwitchMenuOpen(false)}
                />
                <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-white border border-slate-200 shadow-xl z-50 p-2 animate-in fade-in duration-150">
                  <div className="px-2 py-1.5 border-b border-slate-100 mb-1">
                    <p className="text-[11px] uppercase font-bold text-slate-400 tracking-wider">
                      Switch Active Employee
                    </p>
                    <p className="text-xs font-semibold text-slate-800">{currentStaff?.name}</p>
                    <p className="text-[11px] text-blue-600">{currentStaff?.roleLabel}</p>
                  </div>

                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {availableStaffList.slice(0, 5).map((staff) => (
                      <button
                        key={staff.id}
                        onClick={() => {
                          quickSwitchUser(staff.id);
                          setIsSwitchMenuOpen(false);
                        }}
                        className={`w-full text-left px-2 py-1.5 rounded-lg text-xs flex items-center justify-between transition-colors ${
                          staff.id === currentStaff?.id
                            ? 'bg-blue-50 text-blue-700 font-bold'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <div>
                          <div className="line-clamp-1">{staff.name}</div>
                          <div className="text-[11px] opacity-75 font-normal">{staff.roleLabel}</div>
                        </div>
                        <span className="text-[11px] font-mono text-slate-400">{staff.id}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
