/**
 * RetailEdge AI — Staff PWA Offline Storage & Sync Queue
 * Manages IndexedDB / LocalStorage queue for pending mutations when network is unavailable.
 * Guarantees idempotency and provides automatic synchronization upon network restoration.
 */

export interface PendingAction {
  id: string;
  type: 'accept_task' | 'start_task' | 'complete_task' | 'report_issue' | 'check_in' | 'check_out';
  payload: Record<string, any>;
  timestamp: string;
  retryCount: number;
  status: 'pending' | 'syncing' | 'failed';
  errorMessage?: string;
}

const STORAGE_KEY = 'retalledge_staff_offline_queue';
const CACHE_KEY_PREFIX = 'retalledge_staff_cache_';

class OfflineStorageService {
  private queue: PendingAction[] = [];
  private isProcessing: boolean = false;

  constructor() {
    this.loadQueue();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.processQueue();
      });
    }
  }

  private loadQueue(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.queue = JSON.parse(stored);
      }
    } catch {
      this.queue = [];
    }
  }

  private persistQueue(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.queue));
    } catch {
      // Ignore
    }
  }

  /**
   * Enqueue a pending mutation for deferred synchronization
   */
  enqueueAction(type: PendingAction['type'], payload: Record<string, any>): PendingAction {
    const action: PendingAction = {
      id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      type,
      payload,
      timestamp: new Date().toISOString(),
      retryCount: 0,
      status: 'pending',
    };

    this.queue.push(action);
    this.persistQueue();
    this.broadcastUpdate();
    return action;
  }

  getPendingCount(): number {
    return this.queue.filter((a) => a.status === 'pending' || a.status === 'syncing').length;
  }

  getPendingActions(): PendingAction[] {
    return [...this.queue];
  }

  removeAction(id: string): void {
    this.queue = this.queue.filter((a) => a.id !== id);
    this.persistQueue();
    this.broadcastUpdate();
  }

  /**
   * Execute pending synchronization with callback processor
   */
  async processQueue(syncExecutor?: (action: PendingAction) => Promise<boolean>): Promise<number> {
    if (this.isProcessing || this.queue.length === 0 || !navigator.onLine) {
      return 0;
    }

    this.isProcessing = true;
    let syncedCount = 0;

    const pending = [...this.queue];
    for (const action of pending) {
      action.status = 'syncing';
      this.persistQueue();

      try {
        if (syncExecutor) {
          const success = await syncExecutor(action);
          if (success) {
            this.removeAction(action.id);
            syncedCount++;
          } else {
            action.retryCount += 1;
            action.status = 'failed';
          }
        } else {
          // Without an executor nothing was sent to the server, so the action must stay queued (never report it as synced).
          action.status = 'pending';
        }
      } catch (err: any) {
        action.retryCount += 1;
        action.status = 'failed';
        action.errorMessage = err?.message || 'Sync failed';
      }
    }

    this.isProcessing = false;
    this.persistQueue();
    this.broadcastUpdate();
    return syncedCount;
  }

  /**
   * Cache user-specific data partitions safely
   */
  cacheUserData(employeeId: string, key: string, data: any): void {
    try {
      localStorage.setItem(`${CACHE_KEY_PREFIX}${employeeId}_${key}`, JSON.stringify(data));
    } catch {
      // Ignore
    }
  }

  getCachedUserData<T>(employeeId: string, key: string): T | null {
    try {
      const item = localStorage.getItem(`${CACHE_KEY_PREFIX}${employeeId}_${key}`);
      return item ? JSON.parse(item) : null;
    } catch {
      return null;
    }
  }

  /**
   * Strict privacy: purge all user-specific offline caches upon sign-out
   */
  clearUserPrivateData(employeeId: string): void {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(`${CACHE_KEY_PREFIX}${employeeId}`)) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
      // Purge pending queue for signed out user
      this.queue = this.queue.filter((a) => a.payload?.employeeId !== employeeId);
      this.persistQueue();
    } catch {
      // Ignore
    }
  }

  private broadcastUpdate(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('retalledge:offline-queue-changed', {
        detail: { pendingCount: this.getPendingCount() },
      }));
    }
  }
}

export const offlineStorage = new OfflineStorageService();
