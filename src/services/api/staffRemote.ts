/**
 * REAL-mode Staff Management data source (replaces the localStorage-backed demo service).
 *
 * Reads are synchronous from a cache that `hydrate()` fills from the backend (and refreshes whenever the server publishes
 * task / shift / attendance / staff events). Writes go to the API first and only appear in the UI after the server confirmed them.
 * There is no authentication: the supervisor-context fields sent with writes are a demo selection, not a verified identity.
 */
import type {
  AttendanceRecord,
  AttendanceStatus,
  ShiftAssignment,
  StaffAvailabilityStatus,
  StaffEmployee,
  StaffManagementKpis,
  StaffTaskExtended,
  StaffTaskStatus,
  StaffWorkloadAnalytics,
  StaffingAiRecommendation,
} from '../../types/retail';
import { apiDelete, apiGet, apiPatch, apiPost, newIdempotencyKey } from './client';
import { adaptAttendance, adaptEmployee, adaptKpis, adaptRecommendation, adaptShift, adaptTask, adaptWorkload } from './adapters/workforce';
import { Dto, items, obj, str } from './adapters/common';

const sid = (id: string) => `/api/stores/${encodeURIComponent(id)}`;

const EMPTY_WORKLOAD: StaffWorkloadAnalytics = { departmentLoads: [], hourlyCoverage: [], statusDistribution: [], dailyCompletions: [], employeeWorkloads: [] };
const EMPTY_KPIS: StaffManagementKpis = {
  totalEmployees: 0, onDuty: 0, availableStaff: 0, busyStaff: 0, pendingTasks: 0, attendanceRatePct: null, checkedInCount: 0, absentCount: 0, onLeaveCount: 0,
};

class StaffRemote {
  private storeId = '';
  private employees: StaffEmployee[] = [];
  private shifts: ShiftAssignment[] = [];
  private attendance: AttendanceRecord[] = [];
  private tasks: StaffTaskExtended[] = [];
  private recs: StaffingAiRecommendation[] = [];
  private workload: StaffWorkloadAnalytics = EMPTY_WORKLOAD;
  private kpis: StaffManagementKpis = EMPTY_KPIS;
  private listeners = new Set<() => void>();
  private version = 0;

  /** True once a hydrate() has succeeded for the current store. */
  hydrated = false;

  getVersion = () => this.version;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.version += 1;
    this.listeners.forEach((l) => l());
  }

  /** Fetch everything the Staff Management page and the Staff PWA need for one store. */
  async hydrate(storeId: string, signal?: AbortSignal): Promise<void> {
    if (!storeId) return;
    const today = new Date();
    const from = new Date(today.getTime() - 3 * 86400000).toISOString().slice(0, 10);
    const to = new Date(today.getTime() + 14 * 86400000).toISOString().slice(0, 10);
    const [staff, shifts, attendance, tasks, recs, workload, availability] = await Promise.all([
      apiGet<Dto>(`${sid(storeId)}/staff`, undefined, signal),
      apiGet<Dto>(`${sid(storeId)}/shifts`, { from, to }, signal),
      apiGet<Dto>(`${sid(storeId)}/attendance`, undefined, signal),
      apiGet<Dto>(`${sid(storeId)}/tasks`, { limit: 300 }, signal),
      apiGet<Dto>(`${sid(storeId)}/staff/recommendations`, undefined, signal),
      apiGet<Dto>(`${sid(storeId)}/staff/workload`, undefined, signal),
      apiGet<Dto>(`${sid(storeId)}/staff/availability`, undefined, signal),
    ]);
    const attRows = items(attendance);
    const todayShifts = items(shifts);
    const attByEmp = new Map<string, Dto>(attRows.map((a) => [str(a.employeeId), a]));
    const nowIso = new Date().toISOString().slice(0, 10);
    const shiftByEmp = new Map<string, Dto>(todayShifts.filter((s) => s.shiftDate === nowIso).map((s) => [str(s.employeeId), s]));
    this.storeId = storeId;
    this.employees = items(staff).map((e) => adaptEmployee(e, attByEmp.get(str(e.id)), shiftByEmp.get(str(e.id))));
    const byId = new Map(this.employees.map((e) => [e.id, e]));
    this.shifts = todayShifts.map((s) => adaptShift(s, byId.get(str(s.employeeId))));
    this.attendance = attRows.map((a) => adaptAttendance(a, byId.get(str(a.employeeId))));
    this.tasks = items(tasks).map(adaptTask);
    this.recs = items(recs).map(adaptRecommendation);
    this.workload = adaptWorkload(workload, this.shifts, this.employees);
    this.kpis = adaptKpis(staff, availability, attendance, this.employees);
    this.hydrated = true;
    this.emit();
  }

  private async after<T>(p: Promise<T>): Promise<T> {
    const r = await p;
    await this.hydrate(this.storeId);
    return r;
  }

  /* ------------------------------------------------------------------ reads */
  getEmployees = (_storeId?: string): StaffEmployee[] => this.employees;
  getShifts = (_storeId?: string, date?: string): ShiftAssignment[] => (date ? this.shifts.filter((s) => s.date === date) : this.shifts);
  getAttendance = (_storeId?: string, date?: string): AttendanceRecord[] => (date ? this.attendance.filter((a) => a.date === date) : this.attendance);
  getTasks = (_storeId?: string): StaffTaskExtended[] => this.tasks;
  getRecommendations = (): StaffingAiRecommendation[] => this.recs;
  getKpis = (_storeId?: string): StaffManagementKpis => this.kpis;
  getWorkloadAnalytics = (): StaffWorkloadAnalytics => this.workload;

  /** Client-side preview only; the server is the authority and rejects overlaps (incl. overnight) with a 409. */
  detectShiftConflict(employeeId: string, date: string, startTime: string, endTime: string, ignoreShiftId?: string): { hasConflict: boolean; reason?: string } {
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const span = (s: string, e: string): [number, number] => {
      const a = toMin(s);
      let b = toMin(e);
      if (b <= a) b += 1440;
      return [a, b];
    };
    const [a1, b1] = span(startTime, endTime);
    for (const sh of this.shifts) {
      if (sh.employeeId !== employeeId || sh.id === ignoreShiftId || sh.status === 'swapped') continue;
      const dayDiff = (Date.parse(sh.date) - Date.parse(date)) / 86400000;
      if (Math.abs(dayDiff) > 1) continue;
      const [a2, b2] = span(sh.startTime, sh.endTime);
      const off = dayDiff * 1440;
      if (a1 < b2 + off && a2 + off < b1) {
        return { hasConflict: true, reason: `Overlaps with existing ${sh.shiftName} (${sh.startTime} – ${sh.endTime}) on ${sh.date}.` };
      }
    }
    return { hasConflict: false };
  }

  /* ------------------------------------------------------------------ writes (server first) */
  async addEmployee(e: Omit<StaffEmployee, 'id' | 'joinedDate' | 'activeTasksCount' | 'completedTasksCount' | 'isActive'>): Promise<StaffEmployee> {
    const created = await this.after(
      apiPost<Dto>(`${sid(this.storeId)}/staff`, {
        name: e.name,
        role: e.role,
        roleLabel: e.roleLabel,
        department: e.department,
        email: e.email || undefined,
        phone: e.phone || undefined,
        assignedZone: e.assignedZone,
        skills: e.skills,
      }),
    );
    return this.employees.find((x) => x.id === str(created.id)) ?? adaptEmployee(created);
  }

  async updateEmployee(id: string, u: Partial<StaffEmployee>): Promise<StaffEmployee | null> {
    const body: Dto = {};
    (['name', 'role', 'email', 'roleLabel', 'department', 'phone', 'assignedZone', 'skills'] as const).forEach((k) => {
      if (u[k] !== undefined) body[k] = u[k];
    });
    if (u.availability && ['available', 'busy', 'on_break', 'off_duty', 'on_leave'].includes(u.availability)) body.availability = u.availability as StaffAvailabilityStatus;
    await this.after(apiPatch(`/api/staff/${encodeURIComponent(id)}`, body));
    return this.employees.find((e) => e.id === id) ?? null;
  }

  async deactivateEmployee(id: string): Promise<boolean> {
    await this.after(apiPost(`/api/staff/${encodeURIComponent(id)}/deactivate`, {}));
    return true;
  }

  async createShift(shift: Omit<ShiftAssignment, 'id'>): Promise<ShiftAssignment> {
    const created = await this.after(
      apiPost<Dto>(`${sid(this.storeId)}/shifts`, {
        employeeId: shift.employeeId,
        shiftDate: shift.date,
        shiftName: shift.shiftName,
        startTime: shift.startTime,
        endTime: shift.endTime,
        zone: undefined,
        status: shift.status === 'confirmed' ? 'confirmed' : 'scheduled',
      }),
    );
    return this.shifts.find((s) => s.id === String(created.id)) ?? adaptShift(created);
  }

  async deleteShift(id: string): Promise<boolean> {
    await this.after(apiDelete(`/api/shifts/${encodeURIComponent(id)}`, { confirm: true }));
    return true;
  }

  async updateAttendance(
    id: string,
    u: { actualCheckIn?: string; actualCheckOut?: string; status: AttendanceStatus; overrideNote: string; overriddenBy: string },
  ): Promise<AttendanceRecord | null> {
    const rec = this.attendance.find((r) => r.id === id);
    const at = (t?: string): string | undefined => {
      if (!t || !rec) return undefined;
      const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
      if (!m) return undefined;
      const d = new Date(`${rec.date}T${m[1].padStart(2, '0')}:${m[2]}:00`);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    };
    const status = u.status === 'checked_out' ? 'completed' : u.status === 'scheduled' ? undefined : u.status;
    await this.after(
      apiPatch(`/api/attendance/${encodeURIComponent(id)}`, {
        status,
        actualIn: at(u.actualCheckIn),
        actualOut: at(u.actualCheckOut),
        overrideReason: u.overrideNote || 'Supervisor correction',
        actorEmployeeId: undefined,
      }),
    );
    return this.attendance.find((r) => r.employeeId === rec?.employeeId && r.date === rec?.date) ?? null;
  }

  async createTask(t: Omit<StaffTaskExtended, 'id' | 'createdTime'>, idempotencyKey?: string): Promise<StaffTaskExtended> {
    const mins = parseInt(t.dueTime, 10);
    const created = await this.after(
      apiPost<Dto>(
        `${sid(this.storeId)}/tasks`,
        {
          title: t.title,
          description: t.description || undefined,
          category: t.category,
          priority: t.priority,
          zone: t.zone || undefined,
          assignedEmployeeId: t.assignedEmployeeId || undefined,
          shelfId: t.relatedEntity?.type === 'shelf' ? t.relatedEntity.id : undefined,
          counterId: t.relatedEntity?.type === 'counter' ? t.relatedEntity.id : undefined,
          cameraId: t.relatedEntity?.type === 'camera' ? t.relatedEntity.id : undefined,
          alertId: t.sourceAlertId || undefined,
          dueInMinutes: Number.isFinite(mins) && mins > 0 ? mins : undefined,
          notes: t.notes || undefined,
          force: true, // created from the supervisor console: eligibility override is recorded in the task history
        },
        { idempotencyKey: idempotencyKey ?? newIdempotencyKey('task') },
      ),
    );
    return this.tasks.find((x) => x.id === str(created.id)) ?? adaptTask(created);
  }

  async updateTaskStatus(taskId: string, status: StaffTaskStatus): Promise<StaffTaskExtended | null> {
    if (status === 'cancelled') await this.after(apiPost(`/api/tasks/${encodeURIComponent(taskId)}/cancel`, {}));
    else await this.after(apiPatch(`/api/tasks/${encodeURIComponent(taskId)}`, { status, force: true }));
    return this.tasks.find((t) => t.id === taskId) ?? null;
  }

  async assignTask(taskId: string, employeeId: string): Promise<StaffTaskExtended | null> {
    await this.after(apiPost(`/api/tasks/${encodeURIComponent(taskId)}/assign`, { employeeId, force: true }));
    return this.tasks.find((t) => t.id === taskId) ?? null;
  }

  async acceptRecommendation(recId: string): Promise<{ success: boolean; createdTask?: StaffTaskExtended }> {
    const r = await this.after(apiPost<Dto>(`${sid(this.storeId)}/staff/recommendations/${encodeURIComponent(recId)}/accept`, {}));
    const t = obj(r.task);
    return { success: r.success === true, createdTask: t.id ? this.tasks.find((x) => x.id === str(t.id)) ?? adaptTask(t) : undefined };
  }

  async rejectRecommendation(recId: string): Promise<boolean> {
    await this.after(apiPost(`${sid(this.storeId)}/staff/recommendations/${encodeURIComponent(recId)}/reject`, {}));
    return true;
  }
}

export const staffRemote = new StaffRemote();
