import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Store, StoreOverviewData, DateRange, Alert, SystemConnection, ConnectionStatus } from '../types/retail';
import { apiService } from '../services/apiService';
import { ApiError, isAbort } from '../services/api/client';
import { IS_DEMO_MODE, IS_NOT_CONFIGURED } from '../services/api/config';
import { RealtimeStatus, useRealtime, useRealtimeEvents } from '../services/api/realtime';
import { timeAgo } from '../services/api/adapters/common';

export interface NotificationItem {
  id: string;
  title: string;
  detail: string;
  timestamp: string;
  type: 'critical' | 'warning' | 'info';
  read: boolean;
}

export type BackendPhase = 'loading' | 'ready' | 'error' | 'not_configured';

interface StoreContextType {
  stores: Store[];
  selectedStore: Store;
  selectedStoreId: string;
  setSelectedStoreId: (id: string) => void;
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  overviewData: StoreOverviewData | null;
  isLoading: boolean;
  isRefreshing: boolean;
  refreshData: () => Promise<void>;
  connection: SystemConnection;
  setConnectionStatus: (status: ConnectionStatus) => void;
  alerts: Alert[];
  acknowledgeAlert: (alertId: string) => void;
  resolveAlert: (alertId: string) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;
  notifications: NotificationItem[];
  markNotificationRead: (id: string) => void;
  clearAllNotifications: () => void;
  unreadCount: number;
  isExportModalOpen: boolean;
  setIsExportModalOpen: (open: boolean) => void;
  lastUpdated: string;
  /** REAL = values confirmed by the backend; DEMO = labelled fixtures. */
  dataMode: 'real' | 'demo';
  /** loading | ready | error (backend unreachable / failed) | not_configured */
  backendPhase: BackendPhase;
  backendError: ApiError | null;
  /** Error from the latest overview load (the stores list may still be fine). */
  overviewError: ApiError | null;
  retry: () => void;
  realtimeStatus: RealtimeStatus;
  /** Bumps whenever a realtime event says server data changed; pages can use it as a refetch trigger. */
  dataVersion: number;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

const PLACEHOLDER_STORE: Store = {
  id: '',
  name: IS_NOT_CONFIGURED ? 'Not configured' : 'Connecting…',
  code: '—',
  city: '',
  region: '',
  address: '',
  squareFootage: 0,
  maxCapacity: 0,
  openTime: '—',
  closeTime: '—',
  managerName: '—',
  edgeServerStatus: 'disconnected',
};

const DEMO_NOTIFICATIONS: NotificationItem[] = [
  { id: 'notif-1', title: 'Artisan Sourdough Out of Stock', detail: 'Shelf B2-Bakery inventory level hit 0 units', timestamp: '5m ago', type: 'critical', read: false },
  { id: 'notif-2', title: 'Counter 2 Wait Time Spike', detail: 'Wait queue crossed 5 minutes threshold', timestamp: '8m ago', type: 'warning', read: false },
];

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // The phone PWAs (/staff, /customer) use only the public/limited API; the admin store list and event feed are for the admin console.
  const { pathname } = useLocation();
  const adminActive = !/^\/(staff|customer)(\/|$)/.test(pathname);
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [backendPhase, setBackendPhase] = useState<BackendPhase>(IS_NOT_CONFIGURED ? 'not_configured' : 'loading');
  const [backendError, setBackendError] = useState<ApiError | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [overviewData, setOverviewData] = useState<StoreOverviewData | null>(null);
  const [overviewError, setOverviewError] = useState<ApiError | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [connection, setConnection] = useState<SystemConnection>(apiService.getSystemStatus());
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [dataVersion, setDataVersion] = useState<number>(0);
  const [readIds, setReadIds] = useState<Set<string>>(new Set(IS_DEMO_MODE ? [] : []));
  const [demoNotifications, setDemoNotifications] = useState<NotificationItem[]>(DEMO_NOTIFICATIONS);
  const [reloadKey, setReloadKey] = useState(0);

  /* ---------------------------------------------------------------- stores */
  useEffect(() => {
    if (IS_NOT_CONFIGURED || !adminActive) return undefined;
    const ctrl = new AbortController();
    setBackendPhase((p) => (p === 'ready' ? p : 'loading'));
    apiService
      .fetchStores(ctrl.signal)
      .then((list) => {
        setStores(list);
        setSelectedStoreId((cur) => {
          let saved = '';
          try { saved = window.localStorage.getItem('retailedge.selectedStore') ?? ''; } catch { /* storage unavailable: fall back to the first store */ }
          const want = cur || saved;
          return want && list.some((s) => s.id === want) ? want : list[0]?.id ?? '';
        });
        setBackendPhase('ready');
        setBackendError(null);
      })
      .catch((e) => {
        if (isAbort(e)) return;
        setBackendError(e instanceof ApiError ? e : new ApiError('offline', String(e)));
        setBackendPhase('error');
      });
    return () => ctrl.abort();
  }, [reloadKey, adminActive]);

  const selectedStore = stores.find((s) => s.id === selectedStoreId) ?? stores[0] ?? PLACEHOLDER_STORE;
  const dataMode: 'real' | 'demo' = IS_DEMO_MODE ? 'demo' : selectedStore.dataMode === 'demo' ? 'demo' : 'real';

  /* ---------------------------------------------------------------- overview */
  const inflight = useRef<AbortController | null>(null);
  const loadData = useCallback(
    async (isRefresh: boolean = false) => {
      if (!selectedStoreId) return;
      inflight.current?.abort();
      const ctrl = new AbortController();
      inflight.current = ctrl;
      if (isRefresh) setIsRefreshing(true);
      else setIsLoading(true);
      try {
        const data = await apiService.getStoreOverview(selectedStoreId, dateRange, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setOverviewData(data);
        setOverviewError(null);
        setAlerts(data.alerts);
        setLastUpdated(data.lastUpdated);
        setConnection(data.connection);
      } catch (err) {
        if (isAbort(err)) return;
        setOverviewError(err instanceof ApiError ? err : new ApiError('offline', String(err)));
      } finally {
        if (!ctrl.signal.aborted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [selectedStoreId, dateRange],
  );

  useEffect(() => {
    if (backendPhase === 'ready' || IS_DEMO_MODE) void loadData(false);
    return () => inflight.current?.abort();
  }, [loadData, backendPhase]);

  /* ---------------------------------------------------------------- realtime (one shared socket) */
  const rt = useRealtime(IS_DEMO_MODE || !selectedStoreId || !adminActive ? null : selectedStoreId);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtimeEvents(['alert.', 'inventory.', 'queue.', 'shelf.', 'task.', 'camera.', 'occupancy.', 'footfall.', 'customer.', 'attendance.'], () => {
    // Coalesce bursts (a vision worker can emit several events per second) into one refetch.
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      setDataVersion((v) => v + 1);
      void loadData(true);
    }, 400);
  });
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  // Demo mode keeps its simulated heartbeat; REAL mode derives the badge from the socket.
  useEffect(() => {
    if (!IS_DEMO_MODE || !selectedStoreId) return undefined;
    return apiService.subscribeToStoreEvents(selectedStoreId, (event) => {
      if (event.type === 'HEARTBEAT_TICK') {
        const payload = event.payload as { timestamp: string; fps: number };
        setConnection((prev) => ({ ...prev, lastHeartbeat: payload.timestamp, fpsAverage: Number(payload.fps.toFixed(1)) }));
      }
    });
  }, [selectedStoreId]);

  const effectiveConnection = useMemo<SystemConnection>(() => {
    if (IS_DEMO_MODE) return connection;
    if (backendPhase === 'error' || overviewError?.kind === 'offline') return { ...connection, status: 'error' };
    if (rt.status === 'stale') return { ...connection, status: 'stale' };
    return connection;
  }, [connection, backendPhase, overviewError, rt.status]);

  const refreshData = async () => {
    if (backendPhase === 'error') setReloadKey((k) => k + 1);
    await loadData(true);
  };

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const setConnectionStatus = (status: ConnectionStatus) => setConnection((prev) => ({ ...prev, status }));

  /* ---------------------------------------------------------------- alert actions: the server decides, then we refetch */
  const acknowledgeAlert = (alertId: string) => {
    setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, status: 'acknowledged', acknowledgedBy: 'Store Supervisor' } : a)));
    apiService
      .acknowledgeAlert(alertId, selectedStoreId)
      .catch(() => undefined)
      .finally(() => void loadData(true));
  };

  const resolveAlert = (alertId: string) => {
    setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, status: 'resolved' } : a)));
    apiService
      .resolveAlert(alertId, selectedStoreId)
      .catch(() => undefined)
      .finally(() => void loadData(true));
  };

  /* ---------------------------------------------------------------- notifications = the store's own open alerts */
  const notifications = useMemo<NotificationItem[]>(() => {
    if (IS_DEMO_MODE) return demoNotifications;
    return alerts
      .filter((a) => a.status !== 'resolved')
      .slice(0, 20)
      .map((a) => ({
        id: a.id,
        title: a.title,
        detail: a.description,
        timestamp: a.createdAt ? timeAgo(a.createdAt) : a.timestamp,
        type: a.severity,
        read: readIds.has(a.id) || a.status === 'acknowledged',
      }));
  }, [alerts, readIds, demoNotifications]);

  const markNotificationRead = (id: string) => {
    if (IS_DEMO_MODE) setDemoNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    else setReadIds((prev) => new Set(prev).add(id));
  };

  const clearAllNotifications = () => {
    if (IS_DEMO_MODE) setDemoNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    else setReadIds(new Set(alerts.map((a) => a.id)));
  };

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <StoreContext.Provider
      value={{
        stores,
        selectedStore,
        selectedStoreId,
        setSelectedStoreId: (id: string) => {
          try { window.localStorage.setItem('retailedge.selectedStore', id); } catch { /* per-viewer convenience only */ }
          setSelectedStoreId(id);
        },
        dateRange,
        setDateRange,
        overviewData,
        isLoading,
        isRefreshing,
        refreshData,
        connection: effectiveConnection,
        setConnectionStatus,
        alerts,
        acknowledgeAlert,
        resolveAlert,
        searchQuery,
        setSearchQuery,
        isSearchOpen,
        setIsSearchOpen,
        notifications,
        markNotificationRead,
        clearAllNotifications,
        unreadCount,
        isExportModalOpen,
        setIsExportModalOpen,
        lastUpdated,
        dataMode,
        backendPhase,
        backendError,
        overviewError,
        retry,
        realtimeStatus: rt.status,
        dataVersion,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = (): StoreContextType => {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return context;
};
