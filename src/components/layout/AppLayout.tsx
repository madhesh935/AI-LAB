import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { SearchModal } from './SearchModal';
import { ExportSummaryModal } from '../dashboard/ExportSummaryModal';
import { cn } from '../../utils/cn';
import { useStore } from '../../context/StoreContext';
import { BackendState } from '../common/BackendState';
import { ApiError } from '../../services/api/client';

export const AppLayout: React.FC = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const location = useLocation();
  const isCopilot = location.pathname === '/store-copilot';
  const { backendPhase, backendError, retry, stores } = useStore();
  const { selectedStoreId } = useStore();
  const blocked = backendPhase === 'error' || backendPhase === 'not_configured';

  return (
    <div
      className={cn(
        'min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col font-sans',
        isCopilot && 'h-screen overflow-hidden'
      )}
    >
      {/* Search Modal */}
      <SearchModal />

      {/* Export Summary Modal */}
      <ExportSummaryModal />

      {/* Sidebar (Desktop and Mobile Drawer) */}
      <Sidebar
        isCollapsed={isCollapsed}
        setIsCollapsed={setIsCollapsed}
        isMobileOpen={isMobileOpen}
        setIsMobileOpen={setIsMobileOpen}
      />

      {/* Main Content Area */}
      <div
        className={cn(
          'flex flex-col min-h-screen transition-all duration-300 ease-in-out',
          isCollapsed ? 'lg:pl-20' : 'lg:pl-64',
          isCopilot && 'h-screen min-h-0 overflow-hidden'
        )}
      >
        <Header onMenuClick={() => setIsMobileOpen(true)} />
        <main
          className={cn(
            'flex-1 w-full',
            isCopilot
              ? 'p-0 overflow-hidden flex flex-col h-[calc(100vh-4rem)] min-h-0'
              : 'p-3 sm:p-4 lg:p-6 max-w-[1680px] mx-auto'
          )}
        >
          {blocked && backendError ? (
            <BackendState error={backendError} onRetry={retry} what="The dashboard" />
          ) : blocked ? (
            <BackendState error={new ApiError('not_configured', 'not configured')} what="The dashboard" />
          ) : backendPhase === 'ready' && stores.length === 0 ? (
            <div role="status" data-testid="no-stores" className="mx-auto mt-10 max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">No stores in the database yet</h2>
              <p className="mt-2 text-xs text-slate-500">
                The server is running but its database holds no store. Load the clearly-labelled sample store with <code className="rounded bg-slate-100 px-1">python -m database.manage seed-demo</code> in the backend folder, or add a store through the API, then press Retry.
              </p>
              <button onClick={retry} className="mt-4 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">Retry</button>
            </div>
          ) : !selectedStoreId ? (
            <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-xs font-semibold text-slate-500">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              Connecting to the RetailEdge server...
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
};
