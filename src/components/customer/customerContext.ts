import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { isAbort } from '../../services/api/client';
import type { CustomerStorePublic } from '../../types/retail';
import type { Fetched, HomeData } from '../../services/customer/types';

export type ToastTone = 'success' | 'info' | 'error';

/** What CustomerLayout hands to every Customer PWA page through the router outlet. */
export interface CustomerCtx {
  storeId: string;
  store: CustomerStorePublic;
  stores: CustomerStorePublic[];
  setStore: (storeId: string) => void;
  showToast: (message: string, tone?: ToastTone) => void;
  /** Bumped when the backend reports a shelf availability change for this store (pages refetch on it). */
  availabilityTick: number;
  /** Bumped when one of this device's help requests changed status. */
  helpTick: number;
  /** Store header + home feed (open status, departments, featured products, offers, updates). */
  home: Loaded<HomeData>;
}

export const useCustomer = (): CustomerCtx => useOutletContext<CustomerCtx>();

export interface Loaded<T> {
  data: T | null;
  stale: boolean;
  savedAt: number | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads one backend resource with cancellation: a newer request (changed deps / reload) aborts the previous one, so a slow
 * response can never overwrite a fresher one. Data from the offline cache comes back with stale=true.
 */
export function useFetched<T>(load: ((signal: AbortSignal) => Promise<Fetched<T>>) | null, deps: unknown[]): Loaded<T> {
  const [state, setState] = useState<Omit<Loaded<T>, 'reload'>>({ data: null, stale: false, savedAt: null, error: null, loading: !!load });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const fn = loadRef.current;
    if (!fn) {
      setState((s) => ({ ...s, loading: false }));
      return undefined;
    }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fn(ctrl.signal)
      .then((r) => {
        if (!ctrl.signal.aborted) setState({ data: r.data, stale: r.stale, savedAt: r.savedAt, error: null, loading: false });
      })
      .catch((e) => {
        if (ctrl.signal.aborted || isAbort(e)) return;
        setState((s) => ({ ...s, error: e, loading: false }));
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
