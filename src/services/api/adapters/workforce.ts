import type {
  AttendanceRecord,
  AttendanceStatus,
  EmployeeRole,
  PriorityLevel,
  ShiftAssignment,
  StaffAvailabilityStatus,
  StaffEmployee,
  StaffManagementKpis,
  StaffTaskCategory,
  StaffTaskExtended,
  StaffTaskStatus,
  StaffWorkloadAnalytics,
  StaffingAiRecommendation,
} from '../../../types/retail';
import { arr, clock, Dto, initials, num, obj, parseIso, str, strOrNull, timeAgo } from './common';

/** Roles the roster may hold -> the keys the Staff Management UI knows (mirrors backend/services/tasks.py ROLE_ALIASES). */
const ROLE_ALIASES: Record<string, EmployeeRole> = {
  supervisor: 'floor_supervisor',
  manager: 'store_manager',
  restock_specialist: 'shelf_replenishment',
  stockroom_clerk: 'inventory_associate',
  floor_runner: 'shelf_replenishment',
  associate: 'customer_support',
  customer_service: 'customer_support',
  loss_prevention: 'security',
};
const ROLES: EmployeeRole[] = ['store_manager', 'floor_supervisor', 'cashier', 'inventory_associate', 'shelf_replenishment', 'customer_support', 'security'];

export function canonicalRole(role: unknown): EmployeeRole {
  const r = str(role).trim().toLowerCase().replace(/[\s-]+/g, '_');
  const mapped = ROLE_ALIASES[r] ?? r;
  return (ROLES as string[]).includes(mapped) ? (mapped as EmployeeRole) : 'customer_support';
}

const PALETTE = ['#2563EB', '#7C3AED', '#0D9488', '#D97706', '#DB2777', '#4F46E5', '#059669'];

/** Initials avatar as a data URI, so components that render <img src={avatar}> need no change and no photo is invented. */
export function initialsAvatar(name: string): string {
  const color = PALETTE[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="${color}"/><text x="50%" y="54%" font-family="Arial,sans-serif" font-size="44" font-weight="600" fill="#fff" text-anchor="middle" dominant-baseline="middle">${initials(name)}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const AVAILABILITY: StaffAvailabilityStatus[] = ['available', 'busy', 'on_break', 'off_duty', 'on_leave', 'unknown'];

function attendanceStatus(a: Dto | undefined): AttendanceStatus {
  if (!a) return 'scheduled';
  const s = str(a.status) === 'completed' ? 'checked_out' : str(a.status);
  return (['present', 'late', 'checked_out', 'absent', 'on_leave', 'scheduled'] as string[]).includes(s) ? (s as AttendanceStatus) : 'scheduled';
}

export function adaptEmployee(e: Dto, att?: Dto, shift?: Dto): StaffEmployee {
  const name = str(e.name);
  return {
    id: str(e.id),
    name,
    email: str(e.email, ''),
    phone: str(e.phone, ''),
    role: canonicalRole(e.role),
    roleLabel: str(e.roleLabel, str(e.role)),
    department: str(e.department, 'Unassigned'),
    storeId: str(e.storeId),
    avatar: strOrNull(e.avatarUrl) ?? initialsAvatar(name),
    availability: AVAILABILITY.includes(e.availability) ? e.availability : 'unknown',
    attendance: attendanceStatus(att),
    currentShiftId: shift ? str(shift.id) : undefined,
    currentShiftLabel: shift ? `${str(shift.shiftName)} (${str(shift.startTime)} – ${str(shift.endTime)})` : undefined,
    checkInTime: att?.actualIn ? clock(att.actualIn) : undefined,
    checkOutTime: att?.actualOut ? clock(att.actualOut) : undefined,
    activeTasksCount: num(e.activeTasksCount) ?? 0,
    completedTasksCount: num(e.completedTasksCount) ?? 0,
    skills: arr<string>(e.skills),
    isActive: e.isActive !== false,
    joinedDate: str(e.joinedDate, ''),
    assignedZone: str(e.assignedZone, '—'),
  };
}

export function adaptShift(s: Dto, emp?: StaffEmployee): ShiftAssignment {
  const status = (['scheduled', 'confirmed', 'completed', 'swapped', 'absent'] as string[]).includes(str(s.status)) ? str(s.status) : 'scheduled';
  return {
    id: String(s.id),
    employeeId: str(s.employeeId),
    employeeName: str(s.employeeName, emp?.name ?? ''),
    roleLabel: emp?.roleLabel ?? '',
    department: str(s.department, emp?.department ?? ''),
    storeId: str(s.storeId),
    date: str(s.shiftDate),
    shiftTimingId: str(s.shiftName).toLowerCase().replace(/\s+/g, '-'),
    shiftName: str(s.shiftName),
    startTime: str(s.startTime),
    endTime: str(s.endTime),
    status: status as ShiftAssignment['status'],
    overnight: s.overnight === true,
  };
}

export function adaptAttendance(a: Dto, emp?: StaffEmployee): AttendanceRecord {
  return {
    id: str(a.id),
    employeeId: str(a.employeeId),
    employeeName: str(a.employeeName, emp?.name ?? ''),
    department: str(a.department, emp?.department ?? ''),
    date: str(a.workDate),
    scheduledShift: str(a.shiftName, 'Not scheduled'),
    scheduledStart: str(a.scheduledIn, '—'),
    scheduledEnd: str(a.scheduledOut, '—'),
    actualCheckIn: a.actualIn ? clock(a.actualIn) : undefined,
    actualCheckOut: a.actualOut ? clock(a.actualOut) : undefined,
    status: attendanceStatus(a),
    totalHoursWorked: num(a.hoursWorked) ?? 0,
    isLateCheckIn: (num(a.lateMinutes) ?? 0) > 0,
    lateMinutes: num(a.lateMinutes) ?? undefined,
    manualOverrideNote: strOrNull(a.overrideReason) ?? undefined,
    overriddenBy: strOrNull(a.recordedBy) ?? undefined,
    derived: a.derived === true,
    source: strOrNull(a.source) ?? undefined,
  };
}

const CATEGORIES: StaffTaskCategory[] = ['shelf_replenishment', 'checkout_assistance', 'inventory_inspection', 'customer_assistance', 'camera_maintenance', 'general_operations'];
const STATUSES: StaffTaskStatus[] = ['new', 'assigned', 'in_progress', 'completed', 'cancelled'];

export function adaptTask(t: Dto): StaffTaskExtended {
  const rel = obj(t.relatedEntity);
  return {
    id: str(t.id),
    title: str(t.title),
    description: str(t.description, ''),
    category: CATEGORIES.includes(t.category) ? t.category : 'general_operations',
    priority: (['critical', 'high', 'medium', 'low'] as string[]).includes(str(t.priority)) ? (t.priority as PriorityLevel) : 'medium',
    status: STATUSES.includes(t.status) ? t.status : 'new',
    assignedEmployeeId: strOrNull(t.assignedEmployeeId) ?? undefined,
    assignedEmployeeName: strOrNull(t.assignedEmployeeName) ?? undefined,
    assignedEmployeeRole: strOrNull(t.assignedRole) ?? undefined,
    storeId: str(t.storeId),
    zone: str(t.zone, '—'),
    relatedEntity: rel.id ? { type: (['shelf', 'counter', 'camera', 'zone'].includes(rel.type) ? rel.type : 'zone') as 'shelf', id: str(rel.id), label: str(rel.label) } : undefined,
    createdTime: t.createdAt ? timeAgo(t.createdAt) : str(t.timeCreated),
    dueTime: t.dueAt ? clock(t.dueAt) : '—',
    completedTime: t.completedAt ? clock(t.completedAt) : undefined,
    sourceAlertId: strOrNull(t.alertId) ?? undefined,
    notes: strOrNull(t.notes) ?? undefined,
    createdAt: strOrNull(t.createdAt) ?? undefined,
    dueAt: strOrNull(t.dueAt) ?? undefined,
    source: strOrNull(t.source) ?? undefined,
    customerRequestId: strOrNull(t.customerRequestId) ?? undefined,
    customerRequestStatus: strOrNull(t.customerRequestStatus) ?? undefined,
  };
}

export function adaptRecommendation(r: Dto): StaffingAiRecommendation {
  const status = r.status === 'accepted' ? 'accepted' : r.status === 'rejected' ? 'rejected' : 'pending';
  return {
    id: str(r.id),
    title: str(r.title),
    reason: str(r.reason),
    zone: str(r.zone, '—'),
    priority: (['critical', 'high', 'medium', 'low'] as string[]).includes(str(r.priority)) ? (r.priority as PriorityLevel) : 'medium',
    recommendedAction: str(r.recommendedAction),
    suggestedEmployeeId: strOrNull(r.suggestedEmployeeId) ?? undefined,
    suggestedEmployeeName: strOrNull(r.suggestedEmployeeName) ?? undefined,
    sourceMetrics: str(r.sourceMetrics, ''),
    status,
  };
}

export function adaptWorkload(workload: Dto, shifts: ShiftAssignment[], employees: StaffEmployee[]): StaffWorkloadAnalytics {
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const today = new Date().toISOString().slice(0, 10);
  const startH = (s: ShiftAssignment) => Number(s.startTime.slice(0, 2));
  const endH = (s: ShiftAssignment) => Number(s.endTime.slice(0, 2));
  const covered = (s: ShiftAssignment, h: number) => (startH(s) <= endH(s) ? h >= startH(s) && h < endH(s) : h >= startH(s) || h < endH(s));
  const todays = shifts.filter((s) => s.date === today);
  const dist = ['available', 'busy', 'on_break', 'off_duty', 'on_leave'].map((status) => ({
    status,
    count: employees.filter((e) => e.availability === status).length,
    color: status === 'available' ? '#10B981' : status === 'busy' ? '#F59E0B' : status === 'on_break' ? '#6366F1' : status === 'on_leave' ? '#8B5CF6' : '#94A3B8',
  }));
  return {
    departmentLoads: arr(workload.departments).map((d) => ({
      department: str(d.department),
      assignedTasks: num(d.assignedTasks) ?? 0,
      completedTasks: num(d.completedTasks) ?? 0,
      staffCount: num(d.employees) ?? 0,
    })),
    hourlyCoverage: hours
      .map((h) => ({ hour: `${String(h).padStart(2, '0')}:00`, scheduledStaff: todays.filter((s) => covered(s, h)).length, availableStaff: null, requiredStaff: null }))
      .filter((r) => r.scheduledStaff > 0),
    statusDistribution: dist.filter((d) => d.count > 0),
    dailyCompletions: [],
    employeeWorkloads: arr(workload.employees).map((e) => ({
      name: str(e.name),
      activeTasks: (num(e.assigned) ?? 0) + (num(e.inProgress) ?? 0),
      completedToday: num(e.completed) ?? 0,
      avgCompletionMins: null,
    })),
  };
}

export function adaptKpis(staff: Dto, availability: Dto, attendance: Dto, employees: StaffEmployee[]): StaffManagementKpis {
  const k = obj(staff.kpis);
  const summary = obj(attendance.summary);
  return {
    totalEmployees: num(k.totalStaff) ?? employees.length,
    onDuty: num(k.onDuty) ?? 0,
    availableStaff: num(k.available) ?? 0,
    busyStaff: num(k.busy) ?? 0,
    pendingTasks: num(k.openTasks) ?? 0,
    attendanceRatePct: num(k.attendanceRatePct),
    checkedInCount: num(availability.checkedIn) ?? (num(summary.present) ?? 0) + (num(summary.late) ?? 0),
    absentCount: num(summary.absent) ?? 0,
    onLeaveCount: num(summary.on_leave) ?? employees.filter((e) => e.availability === 'on_leave').length,
    scheduledNotCheckedIn: num(availability.scheduledNotCheckedIn),
  };
}

export { parseIso };
