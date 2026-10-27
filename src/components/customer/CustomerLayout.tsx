import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { CustomerTopHeader } from './CustomerTopHeader';
import { CustomerBottomNav } from './CustomerBottomNav';
import { CustomerOfflineBanner } from './CustomerOfflineBanner';
import { customerService, PUBLIC_STORES_LIST } from '../../services/customerService';
import { customerApi } from '../../services/customer/api';
import { BackendState } from '../common/BackendState';
import { useRealtime, useRealtimeEvents } from '../../services/api/realtime';
import type { CustomerStorePublic } from '../../types/retail';
import { useFetched, type CustomerCtx, type ToastTone } from './customerContext';

export const CustomerLayout: React.FC = () => {
  const location = useLocation();
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);
  const [store, setStoreState] = useState<CustomerStorePublic | null>(null);
  const [stores, setStores] = useState<CustomerStorePublic[]>([]);
  const [availabilityTick, setAvailabilityTick] = useState(0);
  const [helpTick, setHelpTick] = useState(0);
  const availTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, tone: ToastTone = 'success') => {
    setToast({ message, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const storeParam = new URLSearchParams(location.search).get('store') ?? undefined;
  const load = useCallback(async () => {
    try {
      await customerService.hydrate(storeParam);
      setStores([...PUBLIC_STORES_LIST]);
      const s = customerService.resolveStore();
      setStoreState(s.id ? s : null);
      setError(null);
      setPhase('ready');
    } catch (e) {
      setError(e);
      setPhase((p) => (p === 'ready' ? p : 'error'));
    }
  }, [storeParam]);

  useEffect(() => {
    void load();
    const onStore = () => void load();
    window.addEventListener('retalledge:customer-store-changed', onStore);
    return () => window.removeEventListener('retalledge:customer-store-changed', onStore);
  }, [load]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (availTimer.current) clearTimeout(availTimer.current);
    },
    [],
  );

  const storeId = store?.id ?? '';
  const home = useFetched(storeId ? (signal) => customerApi.home(storeId, signal) : null, [storeId, availabilityTick]);

  // One socket per store, audience=customer: queue estimates, shelf availability changes (id + time only) and help-request status.
  useRealtime(storeId || null, 'customer');
  useRealtimeEvents(['queue.updated'], () => void customerService.refreshQueues().catch(() => undefined));
  useRealtimeEvents(['customer.assistance.'], () => setHelpTick((t) => t + 1));
  useRealtimeEvents(['customer.availability.changed'], () => {
    if (availTimer.current) return;
    availTimer.current = setTimeout(() => {
      availTimer.current = null;
      setAvailabilityTick((t) => t + 1);
    }, 2500);
  });

  const ctx: CustomerCtx | null = store
    ? {
        storeId,
        store,
        stores,
        setStore: (id: string) => customerService.setStore(id),
        showToast,
        availabilityTick,
        helpTick,
        home,
      }
    : null;

  const ToastIcon = toast?.tone === 'error' ? AlertCircle : toast?.tone === 'info' ? Info : CheckCircle2;

  return (
    <div className="flex min-h-screen flex-col bg-[#F8FAFC] font-sans text-[#0F172A] antialiased selection:bg-blue-100 selection:text-blue-900">
      {toast && (
        <div
          role="status"
          className="fixed left-1/2 top-16 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-xl bg-[#0F172A] px-4 py-2.5 text-xs font-semibold text-white shadow-xl"
        >
          <ToastIcon className={`h-4 w-4 shrink-0 ${toast.tone === 'error' ? 'text-red-400' : toast.tone === 'info' ? 'text-blue-300' : 'text-green-400'}`} />
          <span>{toast.message}</span>
        </div>
      )}

      {store && <CustomerTopHeader store={store} stores={stores} openStatus={home.data?.store.openStatus ?? null} onSelectStore={(id) => customerService.setStore(id)} />}
      <CustomerOfflineBanner />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8 pb-24 md:pb-12 pt-4">
        {phase === 'loading' && (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-xs font-semibold text-[#64748B]">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
            Loading store information...
          </div>
        )}
        {phase === 'error' && <BackendState error={error} onRetry={() => void load()} what="The RetailEdge shopping assistant" compact />}
        {phase === 'ready' && !ctx && (
          <div className="rounded-2xl border border-[#E2E8F0] bg-white p-6 text-center text-sm text-[#64748B]">No store is set up on this server yet.</div>
        )}
        {phase === 'ready' && ctx && <Outlet key={storeId} context={ctx} />}
      </main>

      <CustomerBottomNav storeId={storeId} />
    </div>
  );
};
