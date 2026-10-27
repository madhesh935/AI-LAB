import { useEffect, useRef } from 'react';
import { ApiError } from './client';

/** Re-run `fn` when the shared realtime feed reports a change made elsewhere (e.g. a supervisor assigned a task). */
export function useServerChanged(fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = () => ref.current();
    window.addEventListener('retalledge:server-changed', h);
    return () => window.removeEventListener('retalledge:server-changed', h);
  }, []);
}

export const PENDING_SYNC_MESSAGE = 'Saved on this phone - NOT confirmed by the store server yet. It will sync automatically when you are back online.';

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.kind === 'offline' ? 'The store server cannot be reached' : e.message;
  return e instanceof Error ? e.message : 'Something went wrong';
}

/**
 * Run a task/attendance action and report the TRUE outcome: success only when the server confirmed it,
 * "pending" when it was queued offline, otherwise the server's reason.
 */
export async function runStaffAction(fn: () => Promise<unknown>, okMessage: string, toast: (m: string) => void): Promise<boolean> {
  try {
    const r = (await fn()) as { syncState?: string; isPendingSync?: boolean } | null | undefined;
    if (r && (r.syncState === 'pending' || r.isPendingSync === true)) {
      toast(PENDING_SYNC_MESSAGE);
      return false;
    }
    toast(okMessage);
    return true;
  } catch (e) {
    toast(`Not saved: ${errorText(e)}`);
    return false;
  }
}
