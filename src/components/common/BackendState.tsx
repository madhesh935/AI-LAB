import React from 'react';
import { AlertTriangle, CloudOff, RefreshCw, Settings } from 'lucide-react';
import { ApiError } from '../../services/api/client';

interface Props {
  error: unknown;
  onRetry?: () => void;
  /** e.g. "Shopper Analytics" */
  what?: string;
  compact?: boolean;
}

/** The honest replacement for silently showing sample data: says what failed and offers Retry. */
export const BackendState: React.FC<Props> = ({ error, onRetry, what = 'This page', compact }) => {
  const e = error instanceof ApiError ? error : new ApiError('offline', error instanceof Error ? error.message : String(error));
  const notConfigured = e.kind === 'not_configured';
  const offline = e.kind === 'offline';
  const Icon = notConfigured ? Settings : offline ? CloudOff : AlertTriangle;
  const title = notConfigured ? 'Backend not configured' : offline ? 'Backend offline' : 'The server could not provide this data';
  const hint = notConfigured
    ? 'Set VITE_API_URL to the address of the RetailEdge API and rebuild, or run with VITE_DATA_MODE=demo to browse labelled sample data.'
    : offline
    ? 'Start the API (python run.py in backend/) - the dashboard never substitutes sample numbers for real ones.'
    : e.message;
  return (
    <div
      role="alert"
      data-testid="backend-state"
      className={`mx-auto flex max-w-xl flex-col items-center rounded-2xl border border-slate-200 bg-white text-center shadow-sm ${compact ? 'p-5' : 'p-8 mt-10'}`}
    >
      <div className={`rounded-full p-3 ${offline ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`}>
        <Icon className="h-6 w-6" />
      </div>
      <h2 className="mt-3 text-sm font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">
        {what} needs data from the RetailEdge server. {hint}
      </p>
      {e.kind === 'http' && e.requestId && <p className="mt-1 font-mono text-caption text-slate-400">request {e.requestId}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </button>
      )}
    </div>
  );
};

/** Small inline notice for pages that loaded but whose data is empty / not measured. */
export const DataNotice: React.FC<{ state?: string; note?: string; children?: React.ReactNode }> = ({ state, note, children }) => {
  if (state === 'available') return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600" data-testid="data-notice">
      <span className="font-semibold text-slate-700">{state === 'empty' ? 'No data yet. ' : 'Not measured. '}</span>
      {note ?? 'No observations have been recorded for this view.'}
      {children}
    </div>
  );
};
