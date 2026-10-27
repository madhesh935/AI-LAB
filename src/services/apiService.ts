/**
 * Page-level data service.
 *
 * REAL mode (default): every call goes to the RetailEdge backend through services/api/client.ts and is adapted to the page models in
 *   services/api/adapters. Failures THROW an ApiError - the pages show Offline / Not configured / Error; nothing falls back to fixtures.
 * DEMO mode (VITE_DATA_MODE=demo): the built-in fixtures from mockData.ts, labelled DEMO in the UI.
 */
import type {
  AiInsightsData,
  Alert,
  CameraConfig,
  CameraDetectionEvent,
  CameraFeed,
  CameraStreamState,
  CheckoutCounter,
  ComparePeriod,
  DateRange,
  FootfallTrendPoint,
  InsightActionStatus,
  InventoryAlert,
  LiveCamerasData,
  Planogram,
  QueueIntelligenceData,
  QueueRulesConfig,
  ReplenishmentTask,
  ReplenishmentTaskStatus,
  ReportCategory,
  ReportConfiguration,
  ReportSummaryData,
  ShelfDetail,
  ShopperAnalyticsData,
  SmartInventoryData,
  Store,
  StoreOverviewData,
  StoreStaff,
  SystemConnection,
  TimeOfDayFilter,
  ZoneMetrics,
  DwellTimeRecord,
} from '../types/retail';
import {
  DEFAULT_QUEUE_RULES_CONFIG,
  INITIAL_STORE_STAFF,
  INITIAL_SYSTEM_CONNECTION,
  STORES_LIST,
  STORE_FLOOR_PLAN_GEOMETRIES,
  getMockAiInsightsData,
  getMockLiveCamerasData,
  getMockOverviewData,
  getMockQueueIntelligenceData,
  getMockReportsData,
  getMockShopperData,
  getMockSmartInventoryData,
} from './mockData';
import { apiGet, apiPatch, apiPost, apiPut, buildUrl, newIdempotencyKey } from './api/client';
import { API_BASE, IS_DEMO_MODE } from './api/config';
import { adaptAlert, adaptCamera, adaptOverview, adaptStore } from './api/adapters/overview';
import { adaptShopper } from './api/adapters/shopper';
import { adaptInventory, adaptInventoryAlert, adaptPlanogram, adaptReplenishmentTask, adaptShelf, adaptStoreStaff } from './api/adapters/inventory';
import { adaptQueue, rulesToApi, rulesFromApi } from './api/adapters/queue';
import { adaptCameraEvent, adaptLiveCameras } from './api/adapters/cameras';
import { adaptInsights } from './api/adapters/insights';
import { adaptReport } from './api/adapters/reports';
import { arr, Dto, items, obj, str } from './api/adapters/common';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sid = (storeId: string) => `/api/stores/${encodeURIComponent(storeId)}`;
const PRESET_KEY = 'retailedge_saved_reports';

class RetailEdgeApiService {
  readonly isDemo = IS_DEMO_MODE;

  /* ------------------------------------------------------------------ stores */
  /** REAL: GET /api/stores. DEMO: the fixture list. */
  async fetchStores(signal?: AbortSignal): Promise<Store[]> {
    if (IS_DEMO_MODE) return STORES_LIST.map((s) => ({ ...s, dataMode: 'demo' as const }));
    const rows = items(await apiGet<Dto>('/api/stores', undefined, signal));
    return rows.map(adaptStore);
  }

  getAvailableStores(): Store[] {
    return IS_DEMO_MODE ? STORES_LIST : [];
  }

  getFloorPlanGeometries() {
    return STORE_FLOOR_PLAN_GEOMETRIES;
  }

  getSystemStatus(): SystemConnection {
    return IS_DEMO_MODE
      ? { ...INITIAL_SYSTEM_CONNECTION, status: 'demo' }
      : { ...INITIAL_SYSTEM_CONNECTION, status: 'connecting', latencyMs: null, edgeModelVersion: null, fpsAverage: null, activeCameras: 0, totalCameras: 0, edgeServerId: '—', lastHeartbeat: '—' };
  }

  /* ------------------------------------------------------------------ overview */
  async getStoreOverview(storeId: string, dateRange: DateRange = 'today', signal?: AbortSignal): Promise<StoreOverviewData> {
    if (IS_DEMO_MODE) {
      await delay(250);
      return { ...getMockOverviewData(storeId, dateRange), dataMode: 'demo' };
    }
    return adaptOverview(await apiGet<Dto>(`${sid(storeId)}/overview`, { range: dateRange }, signal));
  }

  async getStoreCameras(storeId: string): Promise<CameraFeed[]> {
    if (IS_DEMO_MODE) return getMockOverviewData(storeId).cameras;
    return arr(obj(await apiGet<Dto>(`${sid(storeId)}/cameras`)).cameras).map(adaptCamera);
  }

  async getStoreAlerts(storeId: string): Promise<Alert[]> {
    if (IS_DEMO_MODE) return getMockOverviewData(storeId).alerts;
    return items(await apiGet<Dto>(`${sid(storeId)}/alerts`, { limit: 200 })).map(adaptAlert);
  }

  async acknowledgeAlert(alertId: string, _storeId: string, acknowledgedBy: string = 'Store Supervisor'): Promise<boolean> {
    if (IS_DEMO_MODE) return true;
    await apiPost(`/api/alerts/${encodeURIComponent(alertId)}/acknowledge`, { actor: acknowledgedBy });
    return true;
  }

  async resolveAlert(alertId: string, _storeId: string, actor: string = 'Store Supervisor'): Promise<boolean> {
    if (IS_DEMO_MODE) return true;
    await apiPost(`/api/alerts/${encodeURIComponent(alertId)}/resolve`, { actor });
    return true;
  }

  /** Demo-only heartbeat. REAL mode uses the shared WebSocket in services/api/realtime.ts. */
  subscribeToStoreEvents(_storeId: string, onMessage: (event: { type: string; payload: unknown }) => void): () => void {
    if (!IS_DEMO_MODE) return () => undefined;
    const interval = setInterval(
      () => onMessage({ type: 'HEARTBEAT_TICK', payload: { timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), fps: 30 } }),
      3000,
    );
    return () => clearInterval(interval);
  }

  /* ------------------------------------------------------------------ shopper analytics */
  async getShopperAnalytics(storeId: string, dateRange: DateRange = 'today', timeOfDay: TimeOfDayFilter = 'all_day', signal?: AbortSignal): Promise<ShopperAnalyticsData> {
    if (IS_DEMO_MODE) {
      await delay(250);
      return getMockShopperData(storeId, dateRange, timeOfDay);
    }
    const [shopper, dwell, movement, zones, occupancy] = await Promise.all([
      apiGet<Dto>(`${sid(storeId)}/shopper-analytics`, { range: dateRange }, signal),
      apiGet<Dto>(`${sid(storeId)}/dwell`, { range: dateRange }, signal),
      apiGet<Dto>(`${sid(storeId)}/movement`, { range: dateRange }, signal),
      apiGet<Dto[]>(`${sid(storeId)}/zones`, undefined, signal),
      apiGet<Dto>(`${sid(storeId)}/occupancy`, undefined, signal), // the same occupancy estimate the Overview shows
    ]);
    return adaptShopper(storeId, dateRange, timeOfDay, shopper, dwell, movement, arr(zones), typeof occupancy.estimate === 'number' ? occupancy.estimate : null);
  }

  async getStoreFootfall(storeId: string, dateRange: DateRange = 'today'): Promise<FootfallTrendPoint[]> {
    return (await this.getShopperAnalytics(storeId, dateRange)).footfallTrend;
  }
  async getStoreZones(storeId: string, dateRange: DateRange = 'today', timeOfDay: TimeOfDayFilter = 'all_day'): Promise<ZoneMetrics[]> {
    return (await this.getShopperAnalytics(storeId, dateRange, timeOfDay)).zones;
  }
  async getStoreDwellAnalytics(storeId: string, dateRange: DateRange = 'today'): Promise<DwellTimeRecord[]> {
    return (await this.getShopperAnalytics(storeId, dateRange)).dwellAnalytics;
  }

  /* ------------------------------------------------------------------ smart inventory */
  async getSmartInventoryData(storeId: string, dateRange: DateRange = 'today', departmentFilter: string = 'all', signal?: AbortSignal): Promise<SmartInventoryData> {
    if (IS_DEMO_MODE) {
      await delay(280);
      return getMockSmartInventoryData(storeId, dateRange, departmentFilter);
    }
    const [inv, tasks, staff, report] = await Promise.all([
      apiGet<Dto>(`${sid(storeId)}/inventory`, { range: dateRange }, signal),
      apiGet<Dto>(`${sid(storeId)}/tasks`, { limit: 200 }, signal),
      apiGet<Dto>(`${sid(storeId)}/staff`, undefined, signal),
      apiGet<Dto>(`${sid(storeId)}/reports/summary/full`, { range: dateRange === 'today' || dateRange === 'yesterday' ? 'week' : dateRange, compare: 'none' }, signal).catch(() => null),
    ]);
    return adaptInventory(storeId, dateRange, departmentFilter, inv, items(tasks), items(staff), report);
  }

  async getInventoryShelves(storeId: string): Promise<ShelfDetail[]> {
    if (IS_DEMO_MODE) return getMockSmartInventoryData(storeId).shelves;
    return arr(await apiGet<Dto[]>(`${sid(storeId)}/inventory/shelves`)).map(adaptShelf);
  }
  async getInventoryAlerts(storeId: string): Promise<InventoryAlert[]> {
    if (IS_DEMO_MODE) return getMockSmartInventoryData(storeId).alerts;
    const [alerts, shelves] = await Promise.all([apiGet<Dto>(`${sid(storeId)}/inventory/alerts`), this.getInventoryShelves(storeId)]);
    return items(alerts).map((a) => adaptInventoryAlert(a, shelves));
  }
  async getInventoryPlanograms(storeId: string): Promise<Planogram[]> {
    if (IS_DEMO_MODE) return getMockSmartInventoryData(storeId).planograms;
    return arr(await apiGet<Dto[]>(`${sid(storeId)}/inventory/planograms`)).map(adaptPlanogram);
  }
  async getReplenishmentTasks(storeId: string): Promise<ReplenishmentTask[]> {
    if (IS_DEMO_MODE) return getMockSmartInventoryData(storeId).tasks;
    return items(await apiGet<Dto>(`${sid(storeId)}/tasks`, { limit: 200 })).filter((t) => t.status !== 'cancelled' && (t.shelfId || t.category === 'shelf_replenishment')).map(adaptReplenishmentTask);
  }

  /** Creates ONE task (the backend de-duplicates open tasks for the same shelf and honours the idempotency key). */
  async createReplenishmentTask(storeId: string, taskInput: Omit<ReplenishmentTask, 'id' | 'taskCode' | 'createdAt'>, idempotencyKey?: string): Promise<ReplenishmentTask> {
    if (IS_DEMO_MODE) {
      return { ...taskInput, id: `tsk-${Date.now()}`, taskCode: `TSK-DEMO-${Math.floor(10 + Math.random() * 90)}`, createdAt: 'Just now' };
    }
    const dueMin = parseInt(taskInput.dueWithin, 10);
    const body = {
      title: taskInput.title,
      category: 'shelf_replenishment',
      priority: taskInput.priority,
      shelfId: taskInput.shelfId || undefined,
      productId: taskInput.productId || undefined,
      quantity: taskInput.quantityToReplenish || undefined,
      assignedEmployeeId: taskInput.assignedStaffId || undefined,
      notes: taskInput.notes || undefined,
      dueInMinutes: Number.isFinite(dueMin) && dueMin > 0 ? dueMin : undefined,
      alertId: undefined,
    };
    const created = await apiPost<Dto>(`${sid(storeId)}/tasks`, body, { idempotencyKey: idempotencyKey ?? newIdempotencyKey('repl') });
    return adaptReplenishmentTask(created);
  }

  async updateTaskStatus(taskId: string, status: ReplenishmentTaskStatus, _completedAt?: string): Promise<boolean> {
    if (IS_DEMO_MODE) return true;
    await apiPatch(`/api/tasks/${encodeURIComponent(taskId)}`, { status });
    return true;
  }

  getStoreStaff(): StoreStaff[] {
    return IS_DEMO_MODE ? INITIAL_STORE_STAFF : [];
  }
  async fetchStoreStaff(storeId: string): Promise<StoreStaff[]> {
    if (IS_DEMO_MODE) return INITIAL_STORE_STAFF;
    return items(await apiGet<Dto>(`${sid(storeId)}/staff`)).filter((e) => e.isActive !== false).map(adaptStoreStaff);
  }

  /* ------------------------------------------------------------------ queue intelligence */
  async getQueueIntelligenceData(storeId: string, dateRange: DateRange = 'today', checkoutSection: string = 'all', rulesConfig: QueueRulesConfig = DEFAULT_QUEUE_RULES_CONFIG, signal?: AbortSignal): Promise<QueueIntelligenceData> {
    if (IS_DEMO_MODE) {
      await delay(200);
      return getMockQueueIntelligenceData(storeId, dateRange, checkoutSection, rulesConfig);
    }
    const [q, history, recs, staff, cams] = await Promise.all([
      apiGet<Dto>(`${sid(storeId)}/queue-intelligence`, { range: dateRange }, signal),
      apiGet<Dto>(`${sid(storeId)}/queue/history`, { range: dateRange }, signal).catch(() => ({ points: [] })),
      apiGet<Dto>(`${sid(storeId)}/staff/recommendations`, undefined, signal).catch(() => ({ items: [] })),
      apiGet<Dto>(`${sid(storeId)}/staff`, undefined, signal),
      apiGet<Dto>(`${sid(storeId)}/cameras`, undefined, signal).catch(() => ({ cameras: [] })),
    ]);
    return adaptQueue(storeId, dateRange, checkoutSection, q, arr(history.points), items(recs), items(staff).filter((e) => e.isActive !== false), arr(cams.cameras).map(adaptCamera));
  }

  async updateCounterStatus(storeId: string, counterId: string, status: CheckoutCounter['status']): Promise<{ success: boolean; counterId: string; status: CheckoutCounter['status'] }> {
    if (IS_DEMO_MODE) return { success: true, counterId, status };
    await apiPost(`${sid(storeId)}/counters/${encodeURIComponent(counterId)}/status`, { status });
    return { success: true, counterId, status };
  }

  /** Creates the Checkout Assistance task through the shared task engine (it then appears in Staff Management and the Staff PWA). */
  async deployStaffingRecommendation(storeId: string, recommendationId: string, staffId: string, targetCounterId: string): Promise<{ success: boolean; taskId: string }> {
    if (IS_DEMO_MODE) {
      await delay(200);
      return { success: true, taskId: `TSK-DEMO-${Math.floor(100 + Math.random() * 900)}` };
    }
    const task = await apiPost<Dto>(`${sid(storeId)}/queue/recommendations/${encodeURIComponent(recommendationId)}/deploy`, { employeeId: staffId || undefined, counterId: targetCounterId || undefined }, { idempotencyKey: `deploy-${recommendationId}-${staffId}` });
    return { success: true, taskId: str(task.id) };
  }

  async resolveQueueAlert(storeId: string, alertId: string, action: 'acknowledge' | 'resolve'): Promise<{ success: boolean; alertId: string; status: 'acknowledged' | 'resolved' }> {
    if (IS_DEMO_MODE) return { success: true, alertId, status: action === 'acknowledge' ? 'acknowledged' : 'resolved' };
    if (action === 'acknowledge') await apiPost(`/api/alerts/${encodeURIComponent(alertId)}/acknowledge`, { actor: 'Store Supervisor' });
    else await apiPost(`${sid(storeId)}/queue/alerts/${encodeURIComponent(alertId)}/resolve`, {});
    return { success: true, alertId, status: action === 'acknowledge' ? 'acknowledged' : 'resolved' };
  }

  async saveQueueRulesConfig(storeId: string, config: QueueRulesConfig): Promise<{ success: boolean; config: QueueRulesConfig }> {
    if (IS_DEMO_MODE) return { success: true, config };
    const saved = await apiPut<Dto>(`${sid(storeId)}/queue/rules`, rulesToApi(config));
    return { success: true, config: { ...config, ...rulesFromApi(saved) } };
  }

  /* ------------------------------------------------------------------ live cameras */
  async getLiveCamerasData(storeId: string, searchQuery: string = '', zoneFilter: string = 'all', signal?: AbortSignal): Promise<LiveCamerasData> {
    if (IS_DEMO_MODE) {
      await delay(200);
      return getMockLiveCamerasData(storeId, searchQuery, zoneFilter);
    }
    const [mon, timeline, alerts] = await Promise.all([
      apiGet<Dto>(`${sid(storeId)}/cameras/monitoring`, { q: searchQuery, zone: zoneFilter === 'all' ? undefined : zoneFilter }, signal),
      apiGet<Dto>(`${sid(storeId)}/cameras/timeline`, { limit: 60 }, signal).catch(() => ({ items: [] })),
      apiGet<Dto>(`${sid(storeId)}/alerts`, { status: 'active', limit: 1 }, signal).catch(() => ({ total: 0 })),
    ]);
    return adaptLiveCameras(storeId, mon, arr(timeline.items), Number(alerts.total) || 0);
  }

  async getCameraTimeline(storeId: string, signal?: AbortSignal): Promise<CameraDetectionEvent[]> {
    if (IS_DEMO_MODE) return getMockLiveCamerasData(storeId).events;
    return arr(obj(await apiGet<Dto>(`${sid(storeId)}/cameras/timeline`, { limit: 60 }, signal)).items).map(adaptCameraEvent);
  }

  async registerCamera(storeId: string, config: CameraConfig): Promise<{ success: boolean; camera: CameraFeed }> {
    if (IS_DEMO_MODE) {
      await delay(200);
      const base = getMockLiveCamerasData(storeId).cameras[0];
      return { success: true, camera: { ...base, id: config.id || `CAM-${Date.now()}`, name: config.name, cameraCode: config.cameraCode, zone: config.zone, status: 'demo' } };
    }
    const created = await apiPost<Dto>(`${sid(storeId)}/cameras`, {
      name: config.name,
      cameraCode: config.cameraCode,
      type: config.type,
      resolution: config.resolution,
      streamType: 'placeholder',
      aiModule: config.aiModule,
      purpose: config.purpose,
      sourceType: 'unconfigured',
      enabled: false,
    });
    return { success: true, camera: adaptCamera(created) };
  }

  async reconnectCamera(storeId: string, cameraId: string): Promise<{ success: boolean; status: CameraStreamState }> {
    if (IS_DEMO_MODE) {
      await delay(800);
      return { success: true, status: 'demo' };
    }
    const r = await apiPost<Dto>(`${sid(storeId)}/cameras/${encodeURIComponent(cameraId)}/reconnect`, {});
    return { success: r.requested === true, status: (str(r.state, 'connecting') as CameraStreamState) };
  }

  /** Snapshots come from the camera's real stream descriptor; if it has none this says so instead of inventing a file. */
  async captureCameraSnapshot(cameraId: string): Promise<{ success: boolean; snapshotUrl: string; timestamp: string }> {
    if (IS_DEMO_MODE) return { success: true, snapshotUrl: `/snapshots/${cameraId}-${Date.now()}.jpg`, timestamp: new Date().toLocaleTimeString() };
    const d = await apiGet<Dto>(`/api/cameras/${encodeURIComponent(cameraId)}/stream`);
    const url = d.snapshotUrl ? `${API_BASE}${d.snapshotUrl}` : '';
    return { success: !!url, snapshotUrl: url, timestamp: new Date().toLocaleTimeString() };
  }

  /* ------------------------------------------------------------------ AI insights */
  async getOperationalInsightsData(storeId: string, dateRange: DateRange = 'today', category: string = 'all', severity: string = 'all', status: string = 'all', signal?: AbortSignal): Promise<AiInsightsData> {
    if (IS_DEMO_MODE) {
      await delay(200);
      return getMockAiInsightsData(storeId, dateRange, category, severity, status);
    }
    const dto = await apiGet<Dto>(`${sid(storeId)}/insights`, {
      range: dateRange,
      category: category === 'all' ? undefined : category,
      severity: severity === 'all' ? undefined : severity,
      status: status === 'all' ? undefined : status,
    }, signal);
    return adaptInsights(storeId, dateRange, dto);
  }

  async executeInsightAction(storeId: string, insightId: string, action: 'acknowledge' | 'start' | 'complete' | 'dismiss', payload?: { staffId?: string; reason?: string }): Promise<{ success: boolean; insightId: string; status: InsightActionStatus }> {
    if (IS_DEMO_MODE) {
      const status: InsightActionStatus = action === 'complete' ? 'completed' : action === 'dismiss' ? 'dismissed' : 'in_progress';
      return { success: true, insightId, status };
    }
    const r = await apiPost<Dto>(`${sid(storeId)}/insights/${encodeURIComponent(insightId)}/actions`, { action, reason: payload?.reason });
    return { success: true, insightId, status: str(r.status, 'pending') as InsightActionStatus };
  }

  async createTaskFromInsight(storeId: string, insightId: string, staffId: string, taskTitle: string, dueMinutes: number = 30): Promise<{ success: boolean; taskId: string }> {
    if (IS_DEMO_MODE) {
      await delay(200);
      return { success: true, taskId: `TSK-DEMO-${Math.floor(100 + Math.random() * 900)}` };
    }
    const r = await apiPost<Dto>(`${sid(storeId)}/insights/${encodeURIComponent(insightId)}/tasks`, { employeeId: staffId || undefined, instructions: taskTitle, dueInMinutes: dueMinutes }, { idempotencyKey: `ins-${insightId}-${staffId}` });
    return { success: true, taskId: str(obj(r.task).id) };
  }

  /* ------------------------------------------------------------------ reports */
  async getStoreReportsData(storeId: string, _category: ReportCategory = 'overview', dateRange: DateRange = '7d', comparePeriod: ComparePeriod = 'previous_period', signal?: AbortSignal): Promise<ReportSummaryData> {
    if (IS_DEMO_MODE) {
      await delay(220);
      return { ...getMockReportsData(storeId, dateRange, comparePeriod), dataMode: 'demo' };
    }
    return adaptReport(storeId, dateRange, comparePeriod, await apiGet<Dto>(`${sid(storeId)}/reports/summary/full`, { range: dateRange, compare: comparePeriod }, signal));
  }

  /** URL of the server-generated CSV for a report (opened by the browser, no auth involved). */
  reportCsvUrl(storeId: string, category: string, dateRange: DateRange, comparePeriod: ComparePeriod): string {
    return buildUrl(`${sid(storeId)}/reports/export/${encodeURIComponent(category)}.csv`, { range: dateRange, compare: comparePeriod });
  }

  /** Report presets are per-browser view settings (not operational data), so they stay in localStorage; REAL mode starts empty. */
  async getSavedReportConfigurations(): Promise<ReportConfiguration[]> {
    try {
      const stored = localStorage.getItem(PRESET_KEY);
      if (stored) return JSON.parse(stored);
    } catch {
      /* storage unavailable */
    }
    return [];
  }

  async saveReportConfiguration(config: ReportConfiguration): Promise<ReportConfiguration> {
    try {
      const existing = await this.getSavedReportConfigurations();
      const updated = existing.some((c) => c.id === config.id) ? existing.map((c) => (c.id === config.id ? config : c)) : [config, ...existing];
      localStorage.setItem(PRESET_KEY, JSON.stringify(updated));
    } catch {
      /* storage unavailable */
    }
    return config;
  }

  async deleteSavedReportConfiguration(configId: string): Promise<boolean> {
    try {
      const existing = await this.getSavedReportConfigurations();
      localStorage.setItem(PRESET_KEY, JSON.stringify(existing.filter((c) => c.id !== configId)));
      return true;
    } catch {
      return false;
    }
  }
}

export const apiService = new RetailEdgeApiService();
