import React, { useEffect, useState } from 'react';
import { CloudOff, WifiOff } from 'lucide-react';
import { useConnectivity } from '../../services/api/client';
import { relativeTime } from '../../services/customer/format';

/** Device offline, or the device is online but the RetailEdge server cannot be reached. */
export const CustomerOfflineBanner: React.FC = () => {
  const [deviceOnline, setDeviceOnline] = useState<boolean>(navigator.onLine);
  const conn = useConnectivity();

  useEffect(() => {
    const on = () => setDeviceOnline(true);
    const off = () => setDeviceOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (deviceOnline && conn.state !== 'offline') return null;
  const Icon = deviceOnline ? CloudOff : WifiOff;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-slate-800 bg-slate-900 px-4 py-2 text-xs font-medium text-white" data-testid="offline-banner">
      <Icon className="h-4 w-4 shrink-0 text-amber-400" />
      <span>
        {deviceOnline ? 'Cannot reach the store server.' : 'You are offline.'} Saved products, map and cart still work; prices and availability may be out of date
        {conn.lastOkAt ? ` (last updated ${relativeTime(conn.lastOkAt)})` : ''}. Help requests need a connection.
      </span>
    </div>
  );
};
