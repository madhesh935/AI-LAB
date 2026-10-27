import type {
  DateRange,
  InventoryAlert,
  Planogram,
  PlanogramSlot,
  Product,
  ReplenishmentTask,
  ShelfDetail,
  ShelfConditionType,
  SmartInventoryData,
  StockAnalyticsData,
  StoreStaff,
} from '../../../types/retail';
import { arr, clock, Dto, initials, num, obj, str, strOrNull, timeAgo, minutesUntil } from './common';

const CONDITIONS: ShelfConditionType[] = ['in_stock', 'low_stock', 'out_of_stock', 'uncertain', 'camera_offline'];

export function adaptShelf(s: Dto): ShelfDetail {
  return {
    id: str(s.id),
    shelfCode: str(s.shelfCode),
    department: str(s.department, '—'),
    category: str(s.category, '—'),
    tierCount: num(s.tierCount) ?? 0,
    capacityUnits: num(s.capacityUnits) ?? 0,
    expectedVisibleUnits: num(s.expectedVisibleUnits),
    detectedVisibleUnits: num(s.detectedVisibleUnits),
    availabilityPercentage: num(s.availabilityPercentage),
    condition: CONDITIONS.includes(s.condition) ? s.condition : s.condition === 'optimal' ? 'in_stock' : 'uncertain',
    lastObservation: s.lastObservationAt ? timeAgo(s.lastObservationAt) : 'No observation yet',
    lastObservationAt: strOrNull(s.lastObservationAt) ?? undefined,
    associatedCameraId: str(s.associatedCameraId),
    associatedCameraName: str(s.associatedCameraName, '—'),
    aisleLocation: str(s.aisleLocation, '—'),
    planogramCompliancePct: num(s.planogramCompliancePct),
    productIds: arr<string>(s.productIds),
  };
}

export function adaptProduct(p: Dto): Product {
  const status = ['in_stock', 'low_stock', 'out_of_stock', 'uncertain'].includes(p.status) ? p.status : 'uncertain';
  return {
    id: str(p.id),
    name: str(p.name),
    sku: str(p.sku),
    category: str(p.category, '—'),
    department: str(p.department, '—'),
    shelfId: str(p.shelfId),
    shelfCode: str(p.shelfCode, '—'),
    expectedVisibleQty: num(p.expectedVisibleQty),
    detectedVisibleQty: num(p.detectedVisibleQty),
    stockroomQty: num(p.stockroomQty),
    availabilityPct: num(p.availabilityPct),
    confidenceScore: num(p.confidenceScore),
    status,
    lastObservation: p.lastObservationAt ? timeAgo(p.lastObservationAt) : str(p.lastObservation, 'No observation yet'),
    price: num(p.price) ?? 0,
    unit: str(p.unit),
    imageUrl: strOrNull(p.imageUrl) ?? undefined,
  };
}

export function adaptPlanogram(p: Dto): Planogram {
  const slots = arr(p.slots).map<PlanogramSlot>((s) => ({
    slotId: str(s.slotId),
    tier: num(s.tier) ?? 1,
    position: num(s.position) ?? 1,
    expectedProductId: str(s.expectedProductId),
    expectedProductName: str(s.expectedProductName, str(s.expectedSku)),
    expectedSku: str(s.expectedSku),
    detectedProductId: strOrNull(s.detectedProductId) ?? undefined,
    detectedProductName: strOrNull(s.detectedProductName) ?? undefined,
    detectedSku: strOrNull(s.detectedSku) ?? undefined,
    status: ['compliant', 'missing', 'misplaced', 'uncertain'].includes(s.status) ? s.status : 'uncertain',
    confidence: num(s.confidence),
    evidenceNote: str(s.evidenceNote, ''),
  }));
  const byTier = new Map<number, PlanogramSlot[]>();
  slots.forEach((s) => byTier.set(s.tier, [...(byTier.get(s.tier) ?? []), s]));
  return {
    id: str(p.id),
    shelfId: str(p.shelfId),
    shelfCode: str(p.shelfCode),
    department: str(p.department, '—'),
    compliancePercentage: num(p.compliancePercentage),
    totalSlots: num(p.totalSlots) ?? slots.length,
    compliantSlots: slots.filter((s) => s.status === 'compliant').length,
    mismatchedSlots: slots.filter((s) => s.status === 'misplaced').length,
    missingSlots: slots.filter((s) => s.status === 'missing').length,
    lastVerified: str(p.lastVerified, 'Not verified'),
    tiers: [...byTier.entries()].sort((a, b) => a[0] - b[0]).map(([tierNumber, s]) => ({ tierNumber, slots: s.sort((a, b) => a.position - b.position) })),
  };
}

export function adaptInventoryAlert(a: Dto, shelves: ShelfDetail[]): InventoryAlert {
  const shelf = shelves.find((s) => s.id === a.shelfId);
  return {
    id: str(a.id),
    alertCode: str(a.id),
    title: str(a.title),
    description: str(a.description),
    shelfId: str(a.shelfId),
    shelfCode: shelf?.shelfCode ?? str(a.zone, '—'),
    cameraId: str(a.cameraId ?? shelf?.associatedCameraId),
    cameraName: shelf?.associatedCameraName ?? '—',
    severity: a.severity === 'critical' || a.severity === 'warning' ? a.severity : 'info',
    detectionTime: a.createdAt ? timeAgo(a.createdAt) : str(a.timestamp),
    evidence: typeof a.evidence === 'string' ? a.evidence : a.evidence ? JSON.stringify(a.evidence) : str(a.recommendedAction),
    status: a.status === 'acknowledged' || a.status === 'resolved' ? a.status : 'active',
    taskId: strOrNull(a.taskId) ?? undefined,
  };
}

/** backend TaskOut -> the Smart Inventory "ReplenishmentTask" card model */
export function adaptReplenishmentTask(t: Dto): ReplenishmentTask {
  const status = t.status === 'completed' ? 'completed' : t.status === 'in_progress' ? 'in_progress' : t.status === 'assigned' ? 'assigned' : 'new';
  return {
    id: str(t.id),
    taskCode: str(t.id),
    title: str(t.title),
    productId: str(t.productId),
    productName: str(t.productName, str(t.title)),
    sku: str(t.sku, ''),
    shelfId: str(t.shelfId),
    shelfCode: str(t.shelfCode, '—'),
    department: str(t.department, '—'),
    priority: ['critical', 'high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
    assignedStaffId: str(t.assignedEmployeeId),
    assignedStaffName: str(t.assignedEmployeeName, 'Unassigned'),
    assignedStaffRole: str(t.assignedRole, ''),
    status,
    createdAt: t.createdAt ? timeAgo(t.createdAt) : str(t.timeCreated),
    dueWithin: t.dueAt ? (status === 'completed' ? 'Done' : `${minutesUntil(t.dueAt)} mins`) : '—',
    completedAt: t.completedAt ? clock(t.completedAt) : undefined,
    cameraVerified: t.cameraVerified === true,
    cameraVerifiedAt: t.cameraVerifiedAt ? clock(t.cameraVerifiedAt) : undefined,
    quantityToReplenish: num(t.quantity) ?? 0,
    notes: strOrNull(t.notes) ?? undefined,
  };
}

export function adaptStoreStaff(e: Dto): StoreStaff {
  const status = e.availability === 'busy' ? 'busy' : e.availability === 'available' ? 'available' : 'off_shift';
  return {
    id: str(e.id),
    name: str(e.name),
    role: str(e.roleLabel, str(e.role)),
    avatar: initials(str(e.name)),
    activeTasksCount: num(e.activeTasksCount) ?? 0,
    status,
  };
}

export function adaptStockAnalytics(report: Dto | null): StockAnalyticsData {
  const inv = obj(report?.inventory);
  return {
    availabilityHistory: arr(inv.historyTimeline)
      .filter((h) => num(h.shelfAvailabilityPercentage) !== null)
      .map((h) => ({ timestamp: str(h.date), overallAvailability: num(h.shelfAvailabilityPercentage), compliance: num(h.planogramCompliancePercentage) })),
    shortageByDepartment: arr(inv.departmentShortages).map((d) => ({
      department: str(d.department),
      lowStockCount: num(d.lowStockIncidents) ?? 0,
      outOfStockCount: num(d.outOfStockIncidents) ?? 0,
    })),
    frequentStockoutLocations: arr(inv.depletedShelves).map((d) => ({
      shelfCode: str(d.shelfId),
      department: str(d.department),
      occurrences: num(d.depletionCount) ?? 0,
      avgRecoveryMins: num(d.avgRestockMinutes),
    })),
    restockingResponseTrend: arr(inv.historyTimeline)
      .filter((h) => num(h.avgResponseMinutes) !== null)
      .map((h) => ({ day: str(h.date), avgResponseMins: num(h.avgResponseMinutes), targetMins: null })),
  };
}

export function adaptInventory(
  storeId: string,
  dateRange: DateRange,
  departmentFilter: string,
  inv: Dto,
  tasks: Dto[],
  staff: Dto[],
  report: Dto | null,
): SmartInventoryData {
  const shelves = arr(inv.shelves).map(adaptShelf);
  const inDept = <T extends { department: string }>(x: T) => departmentFilter === 'all' || x.department === departmentFilter;
  const k = obj(inv.kpis);
  const shelfTasks = tasks.filter((t) => t.status !== 'cancelled' && (t.shelfId || t.category === 'shelf_replenishment' || t.category === 'inventory_inspection'));
  const meta = obj(inv.meta);
  return {
    storeId,
    dateRange,
    departmentFilter,
    kpis: {
      monitoredShelvesCount: num(k.trackedShelves) ?? shelves.length,
      healthyShelvesCount: num(k.optimal) ?? 0,
      lowStockShelvesCount: num(k.lowStock) ?? 0,
      outOfStockShelvesCount: num(k.outOfStock) ?? 0,
      planogramCompliancePct: num(k.averagePlanogramScore),
      pendingTasksCount: shelfTasks.filter((t) => t.status !== 'completed').length,
    },
    shelves: shelves.filter(inDept),
    products: arr(inv.products).map(adaptProduct).filter(inDept),
    planograms: arr(inv.planograms).map(adaptPlanogram).filter(inDept),
    tasks: shelfTasks.map(adaptReplenishmentTask),
    alerts: arr(inv.alerts).map((a) => adaptInventoryAlert(a, shelves)),
    staff: staff.map(adaptStoreStaff),
    stockAnalytics: adaptStockAnalytics(report),
    lastUpdated: meta.lastObservationAt ? timeAgo(meta.lastObservationAt) : 'No observation yet',
    dataState: (meta.dataState as SmartInventoryData['dataState']) ?? 'unavailable',
    dataNote: strOrNull(meta.note) ?? undefined,
  };
}
