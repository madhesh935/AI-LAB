/**
 * RetailEdge AI — Staff PWA data service.
 *
 * REAL mode: talks to /api/staff/me/* and /api/tasks/* . A write is reported as done ONLY after the server confirmed it.
 * When the phone is offline the action goes into a durable pending-sync queue (offlineStorage) with an idempotency key, the UI shows it as
 * "pending sync", and it is replayed - exactly once, thanks to the key - when the connection returns.
 * No authentication: the employee id is the selected demo context, not a verified identity.
 *
 * DEMO mode: the localStorage fixtures of staffService.
 */
import { QueryClient } from '@tanstack/react-query';
import type { StaffEmployee, StaffTaskExtended, ShiftAssignment, AttendanceRecord, StaffTaskStatus } from '../types/retail';
import { staffService } from './staffService';
import { offlineStorage, type PendingAction } from './offlineStorage';
import { IS_DEMO_MODE } from './api/config';
import { ApiError, apiGet, apiPost, newIdempotencyKey } from './api/client';
import { adaptAttendance, adaptShift, adaptTask } from './api/adapters/workforce';
import { arr, Dto, items, obj, str, timeAgo } from './api/adapters/common';

export const staffQueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 30, refetchOnWindowFocus: true, retry: 1 } },
});

export interface StaffNotificationItem {
  id: string;
  employeeId: string;
  title: string;
  message: string;
  type: 'urgent_inventory' | 'queue_assistance' | 'shift_change' | 'announcement';
  priority: 'critical' | 'high' | 'normal';
  taskId?: string;
  timestamp: string;
  read: boolean;
}

const DEMO_NOTIFICATIONS: StaffNotificationItem[] = [
  { id: 'notif-101', employeeId: 'STF-01', title: 'Shelf B2 Out of Stock Alert', message: 'Sourdough is out of stock. Restock now.', type: 'urgent_inventory', priority: 'critical', taskId: 'TSK-101', timestamp: '8m ago', read: false },
  { id: 'notif-102', employeeId: 'STF-02', title: 'Checkout Queue Surge Alert', message: 'Counter 2 wait is 5.8 min. Help at the till.', type: 'queue_assistance', priority: 'high', taskId: 'TSK-102', timestamp: '15m ago', read: false },
];

const READ_KEY = 'retalledge_staff_notification_read';
const NOTIF_STORAGE_KEY = 'retalledge_staff_notifications';
const sid = (id: string) => encodeURIComponent(id);

export type TaskActionKind = 'accept_task' | 'start_task' | 'complete_task' | 'report_issue';
const OVERLAY_STATUS: Record<TaskActionKind, StaffTaskStatus> = { accept_task: 'assigned', start_task: 'in_progress', complete_task: 'completed', report_issue: 'new' };

function readSet(): Set<string> {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(READ_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

const NOTIF_TYPE: Record<string, StaffNotificationItem['type']> = {
  shelf_replenishment: 'urgent_inventory',
  inventory_inspection: 'urgent_inventory',
  checkout_assistance: 'queue_assistance',
  customer_assistance: 'queue_assistance',
};

class StaffApiService {
  private notifCache = new Map<string, StaffNotificationItem[]>();
  private syncing = false;

  constructor() {
    if (typeof window !== 'undefined' && !IS_DEMO_MODE) {
      window.addEventListener('online', () => void this.syncPending());
      setInterval(() => {
        if (offlineStorage.getPendingCount() > 0) void this.syncPending();
      }, 20000);
    }
  }

  get pendingCount(): number {
    return offlineStorage.getPendingCount();
  }

  /* ------------------------------------------------------------------ tasks */
  private overlay(employeeId: string, tasks: StaffTaskExtended[]): StaffTaskExtended[] {
    // Pending (not yet server-confirmed) actions are shown on top of the last known server state, clearly marked.
    const pending = offlineStorage.getPendingActions().filter((a) => a.status !== 'failed' && a.payload?.employeeId === employeeId && a.payload?.taskId);
    if (!pending.length) return tasks;
    return tasks.map((t) => {
      const mine = pending.filter((a) => a.payload.taskId === t.id);
      if (!mine.length) return t;
      const last = mine[mine.length - 1];
      return { ...t, status: OVERLAY_STATUS[last.type as TaskActionKind] ?? t.status, assignedEmployeeId: employeeId, syncState: 'pending' as const };
    });
  }

  async getTasks(employeeId: string, storeId: string = ''): Promise<StaffTaskExtended[]> {
    if (IS_DEMO_MODE) {
      const mine = staffService.getTasks(storeId || 'store-blr-104').filter((t) => t.assignedEmployeeId === employeeId || (!t.assignedEmployeeId && t.status === 'new'));
      offlineStorage.cacheUserData(employeeId, 'tasks', mine);
      return mine;
    }
    try {
      const rows = arr(await apiGet<Dto[]>('/api/staff/me/tasks', { employee_id: employeeId })).map(adaptTask);
      offlineStorage.cacheUserData(employeeId, 'tasks', rows);
      return this.overlay(employeeId, rows);
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'offline') {
        const cached = offlineStorage.getCachedUserData<StaffTaskExtended[]>(employeeId, 'tasks');
        if (cached) return this.overlay(employeeId, cached.map((t) => ({ ...t, fromCache: true })));
      }
      throw e;
    }
  }

  async getTaskById(taskId: string, storeId: string = ''): Promise<StaffTaskExtended | null> {
    if (IS_DEMO_MODE) return staffService.getTasks(storeId || 'store-blr-104').find((t) => t.id === taskId) ?? null;
    try {
      const t = adaptTask(await apiGet<Dto>(`/api/tasks/${sid(taskId)}`));
      return t.assignedEmployeeId ? this.overlay(t.assignedEmployeeId, [t])[0] : t;
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'http' && e.status === 404) return null;
      if (e instanceof ApiError && e.kind === 'offline') {
        for (const key of Object.keys(localStorage)) {
          if (!key.startsWith('retalledge_staff_cache_') || !key.endsWith('_tasks')) continue;
          try {
            const hit = (JSON.parse(localStorage.getItem(key) ?? '[]') as StaffTaskExtended[]).find((x) => x.id === taskId);
            if (hit) return { ...hit, fromCache: true };
          } catch {
            /* ignore */
          }
        }
      }
      throw e;
    }
  }

  private async act(kind: TaskActionKind, taskId: string, employeeId: string, extra: Dto = {}): Promise<StaffTaskExtended | null> {
    if (IS_DEMO_MODE) return this.demoAct(kind, taskId, employeeId, extra);
    const key = newIdempotencyKey(kind);
    const queue = (): StaffTaskExtended | null => {
      offlineStorage.enqueueAction(kind, { taskId, employeeId, idempotencyKey: key, ...extra });
      const cached = offlineStorage.getCachedUserData<StaffTaskExtended[]>(employeeId, 'tasks')?.find((t) => t.id === taskId);
      return cached ? this.overlay(employeeId, [cached])[0] : null;
    };
    if (typeof navigator !== 'undefined' && !navigator.onLine) return queue();
    try {
      const res = await this.execute(kind, taskId, employeeId, extra, key);
      return res;
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'offline') return queue();
      throw e;
    }
  }

  private async execute(kind: TaskActionKind, taskId: string, employeeId: string, extra: Dto, key: string): Promise<StaffTaskExtended> {
    const path = `/api/tasks/${sid(taskId)}/${kind === 'accept_task' ? 'accept' : kind === 'start_task' ? 'start' : kind === 'complete_task' ? 'complete' : 'report-issue'}`;
    const body: Dto = { employeeId };
    if (kind === 'complete_task') {
      body.completionNotes = extra.notes ?? '';
      body.hasPhotoEvidence = !!extra.hasPhotoEvidence;
    }
    if (kind === 'report_issue') body.issueReason = extra.reason || 'Unable to complete task';
    const res = await apiPost<Dto>(path, body, { idempotencyKey: key });
    return adaptTask(obj(res.task));
  }

  private demoAct(kind: TaskActionKind, taskId: string, employeeId: string, extra: Dto): StaffTaskExtended | null {
    let updated: StaffTaskExtended | null = null;
    if (kind === 'accept_task') updated = staffService.assignTask(taskId, employeeId) as StaffTaskExtended | null;
    else updated = staffService.updateTaskStatus(taskId, OVERLAY_STATUS[kind]) as StaffTaskExtended | null;
    if (updated && (extra.notes || extra.reason)) updated.notes = extra.notes ?? `Issue reported by employee: ${extra.reason}`;
    this.broadcastTaskChange(taskId, OVERLAY_STATUS[kind]);
    return updated;
  }

  acceptTask = (taskId: string, employeeId: string) => this.act('accept_task', taskId, employeeId);
  startTask = (taskId: string, employeeId: string) => this.act('start_task', taskId, employeeId);
  completeTask = (taskId: string, employeeId: string, notes?: string, hasPhotoEvidence?: boolean) => this.act('complete_task', taskId, employeeId, { notes, hasPhotoEvidence });
  reportIssue = (taskId: string, employeeId: string, reason: string) => this.act('report_issue', taskId, employeeId, { reason });

  /** Customer help tasks only. Online only: the shopper sees "Staff on the way" as soon as this succeeds, so it is never queued. */
  async markOnTheWay(taskId: string, employeeId: string): Promise<StaffTaskExtended> {
    if (IS_DEMO_MODE) throw new ApiError('not_configured', '"On my way" needs the RetailEdge server (not available in demo mode)');
    const res = await apiPost<Dto>(`/api/tasks/${sid(taskId)}/on-the-way`, { employeeId }, { idempotencyKey: newIdempotencyKey('on_the_way') });
    return adaptTask(obj(res.task));
  }

  /* ------------------------------------------------------------------ schedule / attendance */
  async getSchedule(employeeId: string, storeId: string = ''): Promise<ShiftAssignment[]> {
    if (IS_DEMO_MODE) return staffService.getShifts(storeId || 'store-blr-104').filter((s) => s.employeeId === employeeId);
    try {
      const r = await apiGet<Dto>('/api/staff/me/schedule', { employee_id: employeeId });
      const rows = [obj(r.currentShift), ...arr(r.upcomingShifts)].filter((s) => s.id !== undefined).map((s) => adaptShift(s));
      offlineStorage.cacheUserData(employeeId, 'schedule', rows);
      return rows;
    } catch (e) {
      const cached = offlineStorage.getCachedUserData<ShiftAssignment[]>(employeeId, 'schedule');
      if (e instanceof ApiError && e.kind === 'offline' && cached) return cached;
      throw e;
    }
  }

  async getAttendance(employeeId: string, storeId: string = ''): Promise<AttendanceRecord[]> {
    if (IS_DEMO_MODE) return staffService.getAttendance(storeId || 'store-blr-104').filter((a) => a.employeeId === employeeId);
    try {
      const r = await apiGet<Dto>('/api/staff/me/attendance', { employee_id: employeeId });
      const rows = arr(r.history).map((a) => adaptAttendance(a));
      offlineStorage.cacheUserData(employeeId, 'attendance', rows);
      return rows;
    } catch (e) {
      const cached = offlineStorage.getCachedUserData<AttendanceRecord[]>(employeeId, 'attendance');
      if (e instanceof ApiError && e.kind === 'offline' && cached) return cached;
      throw e;
    }
  }

  async checkIn(employee: StaffEmployee): Promise<{ success: boolean; record?: AttendanceRecord; isPendingSync?: boolean }> {
    if (IS_DEMO_MODE) return this.demoCheck(employee, true);
    const key = newIdempotencyKey('checkin');
    const queue = () => {
      offlineStorage.enqueueAction('check_in', { employeeId: employee.id, idempotencyKey: key });
      return { success: false, isPendingSync: true };
    };
    if (typeof navigator !== 'undefined' && !navigator.onLine) return queue();
    try {
      const r = await apiPost<Dto>('/api/staff/me/check-in', { employeeId: employee.id }, { idempotencyKey: key });
      window.dispatchEvent(new CustomEvent('retalledge:attendance-updated', { detail: {} }));
      return { success: r.success === true, record: adaptAttendance(obj(r.record), employee), isPendingSync: false };
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'offline') return queue();
      throw e;
    }
  }

  async checkOut(employee: StaffEmployee): Promise<{ success: boolean; record?: AttendanceRecord; isPendingSync?: boolean }> {
    if (IS_DEMO_MODE) return this.demoCheck(employee, false);
    const key = newIdempotencyKey('checkout');
    const queue = () => {
      offlineStorage.enqueueAction('check_out', { employeeId: employee.id, idempotencyKey: key });
      return { success: false, isPendingSync: true };
    };
    if (typeof navigator !== 'undefined' && !navigator.onLine) return queue();
    try {
      const r = await apiPost<Dto>('/api/staff/me/check-out', { employeeId: employee.id }, { idempotencyKey: key });
      window.dispatchEvent(new CustomEvent('retalledge:attendance-updated', { detail: {} }));
      return { success: r.success === true, record: adaptAttendance(obj(r.record), employee), isPendingSync: false };
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'offline') return queue();
      throw e;
    }
  }

  private demoCheck(employee: StaffEmployee, checkIn: boolean): { success: boolean; record?: AttendanceRecord; isPendingSync?: boolean } {
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const todayStr = new Date().toISOString().split('T')[0];
    const list = staffService.getAttendance();
    if (checkIn) {
      const rec: AttendanceRecord = {
        id: `att-${Date.now().toString().slice(-6)}`, employeeId: employee.id, employeeName: employee.name, department: employee.department, date: todayStr,
        scheduledShift: employee.currentShiftLabel || 'Morning Shift (08:00 – 16:00)', scheduledStart: '08:00', scheduledEnd: '16:00', actualCheckIn: nowTime, status: 'present',
        totalHoursWorked: 0, isLateCheckIn: false,
      };
      (staffService as unknown as { saveAttendance: (r: AttendanceRecord[]) => void }).saveAttendance([rec, ...list]);
      return { success: true, record: rec, isPendingSync: false };
    }
    const idx = list.findIndex((a) => a.employeeId === employee.id && !a.actualCheckOut);
    if (idx === -1) return { success: false };
    list[idx].actualCheckOut = nowTime;
    list[idx].status = 'checked_out';
    (staffService as unknown as { saveAttendance: (r: AttendanceRecord[]) => void }).saveAttendance(list);
    return { success: true, record: list[idx], isPendingSync: false };
  }

  /* ------------------------------------------------------------------ pending-sync queue */
  /** Replay queued actions. Each carries its original idempotency key, so a retry can never double-apply. */
  async syncPending(): Promise<number> {
    if (IS_DEMO_MODE || this.syncing || offlineStorage.getPendingCount() === 0) return 0;
    this.syncing = true;
    try {
      const n = await offlineStorage.processQueue(async (a: PendingAction) => {
        const p = a.payload;
        try {
          if (a.type === 'check_in') await apiPost('/api/staff/me/check-in', { employeeId: p.employeeId }, { idempotencyKey: p.idempotencyKey });
          else if (a.type === 'check_out') await apiPost('/api/staff/me/check-out', { employeeId: p.employeeId }, { idempotencyKey: p.idempotencyKey });
          else await this.execute(a.type as TaskActionKind, p.taskId, p.employeeId, p, p.idempotencyKey ?? a.id);
          return true;
        } catch (e) {
          if (e instanceof ApiError && e.kind === 'http' && (e.status ?? 0) >= 400 && (e.status ?? 0) < 500) {
            a.errorMessage = e.message; // the server refused it (e.g. the task moved on): keep it visible as failed, do not retry forever
            return false;
          }
          throw e;
        }
      });
      if (n > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('retalledge:task-updated', { detail: {} }));
        window.dispatchEvent(new CustomEvent('retalledge:attendance-updated', { detail: {} }));
      }
      return n;
    } finally {
      this.syncing = false;
    }
  }

  /* ------------------------------------------------------------------ notifications */
  /** REAL: re-fetch the employee's notifications (derived by the server from their tasks). Call before getNotifications(). */
  async refreshNotifications(employeeId: string): Promise<void> {
    if (IS_DEMO_MODE) return;
    try {
      const read = readSet();
      const rows = items<Dto>(await apiGet<Dto[]>('/api/staff/me/notifications', { employee_id: employeeId })).map(
        (n): StaffNotificationItem => ({
          id: str(n.id),
          employeeId,
          title: str(n.title),
          message: str(n.message),
          type: NOTIF_TYPE[str(n.type)] ?? 'announcement',
          priority: n.priority === 'critical' || n.priority === 'high' ? n.priority : 'normal',
          taskId: n.taskId ? str(n.taskId) : undefined,
          timestamp: n.updatedAt ? timeAgo(n.updatedAt) : str(n.timestamp),
          read: n.read === true || read.has(str(n.id)),
        }),
      );
      this.notifCache.set(employeeId, rows);
    } catch (e) {
      if (!(e instanceof ApiError && e.kind === 'offline')) throw e;
    }
  }

  getNotifications(employeeId: string): StaffNotificationItem[] {
    if (!IS_DEMO_MODE) return this.notifCache.get(employeeId) ?? [];
    try {
      const stored = localStorage.getItem(NOTIF_STORAGE_KEY);
      if (stored) return (JSON.parse(stored) as StaffNotificationItem[]).filter((n) => n.employeeId === employeeId || n.employeeId === 'all');
    } catch {
      /* fallback */
    }
    return DEMO_NOTIFICATIONS.filter((n) => n.employeeId === employeeId || n.employeeId === 'all');
  }

  markNotificationAsRead(id: string): void {
    if (!IS_DEMO_MODE) {
      const read = readSet().add(id);
      try {
        localStorage.setItem(READ_KEY, JSON.stringify([...read]));
      } catch {
        /* storage unavailable */
      }
      this.notifCache.forEach((rows) => rows.forEach((n) => n.id === id && (n.read = true)));
      return;
    }
    const stored = this.getNotifications('all');
    try {
      localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(stored.map((n) => (n.id === id ? { ...n, read: true } : n))));
    } catch {
      /* ignore */
    }
  }

  private broadcastTaskChange(taskId: string, status: StaffTaskStatus): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('retalledge:task-updated', { detail: { taskId, status } }));
  }
}

export const staffApiService = new StaffApiService();
