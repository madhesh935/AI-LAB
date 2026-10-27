import React from 'react';
import { useStore } from '../../context/StoreContext';

/**
 * Header chips: where the numbers come from (DEMO fixtures vs backend-confirmed) and whether the live feed is healthy.
 * Nothing here is decorative - REAL mode never shows "Live" unless the shared WebSocket is actually delivering.
 */
export const ModeBadge: React.FC = () => {
  const { dataMode, backendPhase, overviewError, realtimeStatus } = useStore();

  let feed: { label: string; cls: string; title: string };
  if (backendPhase === 'not_configured') feed = { label: 'Not configured', cls: 'bg-slate-100 text-slate-600 border-slate-200', title: 'VITE_API_URL is not set for this build' };
  else if (backendPhase === 'error' || overviewError?.kind === 'offline') feed = { label: 'Offline', cls: 'bg-rose-50 text-rose-700 border-rose-200', title: 'The RetailEdge server cannot be reached' };
  else if (backendPhase === 'loading') feed = { label: 'Connecting', cls: 'bg-slate-100 text-slate-600 border-slate-200', title: 'Contacting the RetailEdge server' };
  else if (realtimeStatus === 'live') feed = { label: 'Live', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', title: 'Real-time event feed connected' };
  else if (realtimeStatus === 'stale') feed = { label: 'Stale', cls: 'bg-amber-50 text-amber-700 border-amber-200', title: 'No heartbeat from the server recently - data may be out of date' };
  else if (realtimeStatus === 'idle' && dataMode === 'demo') feed = { label: 'Fixtures', cls: 'bg-amber-50 text-amber-700 border-amber-200', title: 'Built-in demo fixtures, no live feed' };
  else if (realtimeStatus === 'idle') feed = { label: 'No store', cls: 'bg-slate-100 text-slate-600 border-slate-200', title: 'No store is selected, so there is no live feed' };
  else feed = { label: 'Reconnecting', cls: 'bg-amber-50 text-amber-700 border-amber-200', title: 'Real-time feed is reconnecting' };

  return (
    <div className="hidden md:flex items-center gap-1.5" data-testid="mode-badge">
      <span className={`px-2 py-0.5 rounded-md border text-caption font-semibold ${feed.cls}`} title={feed.title}>
        {feed.label}
      </span>
    </div>
  );
};
