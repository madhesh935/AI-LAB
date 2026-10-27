/**
 * This device's own help requests, remembered only by their high-entropy status reference (no account exists).
 * The reference is what lets the phone read the status back; it is not a replacement for authentication.
 */
import { useSyncExternalStore } from 'react';

export interface MyHelpRequest {
  ref: string;
  requestId: string;
  storeId: string;
  categoryLabel: string;
  createdAt: string;
}

const KEY = 'retailedge_help_v1';
const LEGACY_KEY = 'retalledge_shopper_assistance';
const listeners = new Set<() => void>();
let snapshot: MyHelpRequest[] | null = null;

function load(): MyHelpRequest[] {
  if (snapshot) return snapshot;
  let list: MyHelpRequest[] = [];
  try {
    list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as MyHelpRequest[];
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '[]') as Array<{ statusRef?: string; id?: string; storeId?: string; category?: string; submittedAt?: string }>;
    for (const l of legacy) {
      if (l.statusRef && !list.some((x) => x.ref === l.statusRef)) {
        list.push({ ref: l.statusRef, requestId: l.id ?? '', storeId: l.storeId ?? '', categoryLabel: (l.category ?? 'Help request').replace(/_/g, ' '), createdAt: new Date().toISOString() });
      }
    }
    if (legacy.length) localStorage.removeItem(LEGACY_KEY);
  } catch {
    list = [];
  }
  snapshot = list;
  return list;
}

function save(list: MyHelpRequest[]): void {
  snapshot = list.slice(0, 10);
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

export const myHelp = {
  list: load,
  add(r: MyHelpRequest): void {
    save([r, ...load().filter((x) => x.ref !== r.ref)]);
  },
  remove(ref: string): void {
    save(load().filter((x) => x.ref !== ref));
  },
};

export function useMyHelpRequests(storeId: string): MyHelpRequest[] {
  const all = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    load,
    load,
  );
  return all.filter((r) => !storeId || !r.storeId || r.storeId === storeId);
}
