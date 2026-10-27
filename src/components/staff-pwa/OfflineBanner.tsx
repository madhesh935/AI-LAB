import React, { useState, useEffect } from 'react';
import { WifiOff, RefreshCw, CheckCircle2 } from 'lucide-react';
import { offlineStorage } from '../../services/offlineStorage';
import { staffApiService } from '../../services/staffApiService';

export const OfflineBanner: React.FC = () => {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pendingCount, setPendingCount] = useState<number>(offlineStorage.getPendingCount());
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      handleSync();
    };
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

  const handleSync = async () => {
    if (!navigator.onLine || isSyncing) return;
    setIsSyncing(true);
    await staffApiService.syncPending();
    setIsSyncing(false);
    setPendingCount(offlineStorage.getPendingCount());
  };

  if (isOnline && pendingCount === 0) return null;

  return (
    <div
      role="status"
      className="bg-amber-500 text-slate-900 px-4 py-2 text-xs font-medium flex items-center justify-between border-b border-amber-600 shadow-xs animate-in slide-in-from-top duration-200"
    >
      <div className="flex items-center gap-2">
        <WifiOff className="h-4 w-4 shrink-0 text-slate-950" />
        <span>
          {!isOnline
            ? `Offline - ${pendingCount} action${pendingCount !== 1 ? 's' : ''} saved on this phone, NOT yet confirmed by the server`
            : `${pendingCount} saved action${pendingCount !== 1 ? 's' : ''} waiting to be sent to the server`}
        </span>
      </div>

      {isOnline && pendingCount > 0 && (
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="flex items-center gap-1 bg-slate-950 text-white font-bold px-2.5 py-1 rounded-lg text-[11px] hover:bg-slate-800 transition-colors"
        >
          <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Syncing...' : 'Sync Now'}
        </button>
      )}
    </div>
  );
};
