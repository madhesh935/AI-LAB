import type {
  Alert,
  AlertCategory,
  CameraFeed,
  ConnectionStatus,
  FootfallTrendPoint,
  QueueCongestion,
  QueueStatus,
  ShelfCondition,
  ShelfStatus,
  Store,
  StoreOverviewData,
  SystemConnection,
  ZoneActivity,
} from '../../../types/retail';
import { absoluteUrl } from '../config';
import { arr, clock, Dto, num, obj, parseIso, str, strOrNull, timeAgo } from './common';

export type DataModeLabel = 'real' | 'demo';

export function adaptStore(d: Dto): Store {
  const mode = str(d.dataMode, 'real') === 'demo' ? 'demo' : 'real';
  return {
    id: str(d.id),
    name: str(d.name),
    code: str(d.code),
    city: str(d.city),
    region: str(d.region),
    address: str(d.address),
    squareFootage: num(d.squareFootage) ?? 0,
    maxCapacity: num(d.maxCapacity) ?? 0,
    openTime: str(d.openTime, '—'),
    closeTime: str(d.closeTime, '—'),
    managerName: str(d.managerName, '—'),
    edgeServerStatus: (str(d.edgeServerStatus, 'disconnected') as ConnectionStatus),
    dataMode: mode,
  };
}

const ALERT_CATEGORIES: AlertCategory[] = ['stock_shortage', 'queue_congestion', 'camera_disconnected', 'unusual_customer_traffic', 'pending_replenishment'];

export function adaptAlert(d: Dto): Alert {
  const category = ALERT_CATEGORIES.includes(d.category) ? (d.category as AlertCategory) : 'unusual_customer_traffic';
  return {
    id: str(d.id),
    title: str(d.title),
    description: str(d.description),
    category,
    severity: d.severity === 'critical' || d.severity === 'warning' ? d.severity : 'info',
    zone: str(d.zone, '—'),
    timestamp: d.createdAt ? timeAgo(d.createdAt) : str(d.timestamp, ''),
    createdAt: strOrNull(d.createdAt) ?? undefined,
    recommendedAction: str(d.recommendedAction, ''),
    status: d.status === 'acknowledged' || d.status === 'resolved' ? d.status : 'active',
    acknowledgedBy: strOrNull(d.acknowledgedBy) ?? undefined,
    resolvedAt: d.resolvedAt ? clock(d.resolvedAt) : undefined,
    cameraId: strOrNull(d.cameraId) ?? undefined,
    shelfId: strOrNull(d.shelfId) ?? undefined,
    counterId: strOrNull(d.counterId) ?? undefined,
    taskId: strOrNull(d.taskId) ?? undefined,
    source: strOrNull(d.source) ?? undefined,
  };
}

const CAMERA_TYPES = ['entrance', 'shelf', 'checkout', 'aisle'] as const;
const CAMERA_STATES = ['live', 'offline', 'connecting', 'demo', 'error', 'buffering', 'reconnecting'] as const;

export function adaptCamera(d: Dto): CameraFeed {
  const status = (CAMERA_STATES as readonly string[]).includes(d.status) ? (d.status as CameraFeed['status']) : 'offline';
  const people = num(d.peopleCount);
  const type = (CAMERA_TYPES as readonly string[]).includes(d.type) ? (d.type as CameraFeed['type']) : 'aisle';
  const streamType = ['demo_canvas', 'mjpeg', 'hls', 'webrtc', 'placeholder'].includes(d.streamType) ? d.streamType : 'placeholder';
  const lastFrame = strOrNull(d.lastFrameAt);
  return {
    id: str(d.id),
    name: str(d.name),
    cameraCode: str(d.cameraCode),
    type,
    zone: str(d.zone, '—'),
    zoneId: strOrNull(d.zoneId) ?? undefined,
    resolution: str(d.resolution, '—'),
    streamUrl: absoluteUrl(strOrNull(d.streamUrl)) ?? undefined,
    streamType,
    fps: num(d.inputFps) ?? num(d.fps),
    status,
    lastFrameTimestamp: lastFrame ? timeAgo(lastFrame) : 'No frames received',
    lastFrameAt: lastFrame ?? undefined,
    currentDetection: {
      timestamp: strOrNull(d.lastInferenceAt) ?? lastFrame ?? '',
      frameCount: 0,
      detections: [],
      peopleCount: people,
      alertsDetected: 0,
    },
    metrics: {
      primaryLabel: 'People in view',
      primaryValue: people ?? '—',
      secondaryLabel: 'Inference',
      secondaryValue: num(d.inferenceFps) !== null ? `${num(d.inferenceFps)} fps` : '—',
      statusTag: str(d.message) || (status === 'live' ? 'Live' : status === 'offline' ? 'Offline' : status),
    },
    aiModule: strOrNull(d.aiModule) as CameraFeed['aiModule'],
    purpose: strOrNull(d.purpose) as CameraFeed['purpose'],
    latencyMs: num(d.latencyMs) ?? undefined,
    packetLossPct: num(d.packetLossPct) ?? undefined,
    isDemo: d.isDemo === true,
    sourceType: strOrNull(d.sourceType) ?? undefined,
    errorCode: strOrNull(d.errorCode),
    message: strOrNull(d.message),
  };
}

const QUEUE_LEVELS: QueueCongestion[] = ['optimal', 'moderate', 'high', 'critical'];
const queueLevel = (v: unknown): QueueCongestion => (QUEUE_LEVELS.includes(v as QueueCongestion) ? (v as QueueCongestion) : 'optimal');

export function adaptShelfStatus(d: Dto, cameras: Dto[]): ShelfStatus {
  const avail = num(d.availabilityPercentage);
  const cond = d.condition as string;
  const condition: ShelfCondition = cond === 'out_of_stock' ? 'out_of_stock' : cond === 'low_stock' ? 'low_stock' : cond === 'misplaced_item' ? 'misplaced_item' : 'optimal';
  const cam = cameras.find((c) => c.id === d.associatedCameraId);
  return {
    id: str(d.id),
    shelfCode: str(d.shelfCode),
    zone: str(d.aisleLocation) || str(d.department),
    category: str(d.category),
    productName: str(d.category),
    currentUnits: num(d.detectedVisibleUnits),
    capacityUnits: num(d.capacityUnits) ?? 0,
    stockPercentage: avail,
    condition,
    priority: condition === 'out_of_stock' ? 'critical' : condition === 'low_stock' ? 'high' : 'low',
    lastDetection: d.lastObservationAt ? timeAgo(d.lastObservationAt) : 'No observation yet',
    monitoredByCamId: str(cam?.cameraCode ?? d.associatedCameraId, '—'),
  };
}

export function adaptQueueStatus(d: Dto, cameras: Dto[]): QueueStatus {
  const cam = cameras.find((c) => c.id === d.cameraId);
  const st = d.status === 'open' || d.status === 'paused' ? d.status : 'closed';
  return {
    counterId: str(d.id),
    counterName: str(d.name),
    cashierName: str(d.cashierName, '—'),
    status: st,
    waitingCustomers: num(d.waitingCustomers),
    estimatedWaitMinutes: num(d.estimatedWaitMinutes),
    congestion: queueLevel(d.congestion),
    avgItemsPerCustomer: num(d.avgItemsPerCustomer),
    recommendedAction: str(d.recommendedAction, ''),
    monitoredByCamId: str(cam?.cameraCode ?? d.cameraId, '—'),
  };
}

function trendPoints(analytics: Dto): FootfallTrendPoint[] {
  return arr(analytics.hourlyTraffic).map((p) => ({
    time: str(p.time),
    entries: num(p.entries) ?? 0,
    exits: num(p.exits) ?? 0,
    previousPeriodEntries: num(p.previousPeriodEntries),
    occupancy: num(p.occupancy),
    plotEntries: p.measured === false ? null : num(p.entries) ?? 0,
  }));
}

export function adaptZoneActivity(z: Dto): ZoneActivity {
  return {
    id: str(z.id),
    name: str(z.name),
    category: str(z.category),
    currentOccupancy: num(z.currentOccupancy),
    capacityLimit: num(z.capacityLimit) ?? 0,
    dwellTimeMinutes: num(z.dwellTimeMinutes),
    congestionLevel: queueLevel(z.congestionLevel),
    trend: null,
    popularProduct: null,
  };
}

export function adaptConnection(c: Dto): SystemConnection {
  const status = (['connected', 'disconnected', 'connecting', 'demo', 'stale', 'error'] as const).find((s) => s === c.status) ?? 'disconnected';
  return {
    status,
    latencyMs: num(c.latencyMs),
    lastHeartbeat: c.lastHeartbeat ? clock(c.lastHeartbeat, true) : '—',
    edgeServerId: str(c.edgeServerId, '—'),
    edgeModelVersion: strOrNull(c.edgeModelVersion),
    fpsAverage: num(c.fpsAverage),
    activeCameras: num(c.activeCameras) ?? 0,
    totalCameras: num(c.totalCameras) ?? 0,
  };
}

export function adaptOverview(dto: Dto): StoreOverviewData {
  const m = obj(dto.metrics);
  const analytics = obj(dto.analytics);
  const cameras = arr(dto.cameras);
  const store = adaptStore({ ...obj(dto.store), dataMode: dto.dataMode });
  const dwell = num(m.averageDwellTimeMinutes);
  return {
    store,
    metrics: {
      totalFootfallToday: num(m.totalFootfallToday),
      footfallChangePercentage: num(m.footfallChangePercentage),
      footfallHistoryMini: arr<number>(m.footfallHistoryMini),
      currentOccupancy: num(m.currentOccupancy),
      occupancyStatus: strOrNull(m.occupancyStatus),
      occupancyBasis: strOrNull(m.occupancyBasis),
      maxCapacity: num(m.maxCapacity) ?? store.maxCapacity,
      occupancyPercentage: num(m.occupancyPercentage),
      averageDwellTimeMinutes: dwell,
      dwellTimeChangeMinutes: null,
      lowStockShelvesCount: num(m.lowStockShelvesCount) ?? 0,
      outOfStockShelvesCount: num(m.outOfStockShelvesCount) ?? 0,
      criticalInventoryAlertsCount: num(m.criticalInventoryAlertsCount) ?? 0,
      activeCheckoutQueuesCount: num(m.activeCheckoutQueuesCount) ?? 0,
      totalCustomersInQueue: num(m.totalCustomersInQueue) ?? 0,
      overallQueueStatus: queueLevel(m.overallQueueStatus),
      averageWaitTimeMinutes: num(m.averageWaitTimeMinutes),
      waitTimeTrendMinutes: null,
      waitTimeCongestion: queueLevel(m.overallQueueStatus),
      camerasOnline: num(m.camerasOnline) ?? 0,
      camerasTotal: num(m.camerasTotal) ?? 0,
      openTasks: num(m.openTasks) ?? 0,
      activeAlerts: num(m.activeAlerts) ?? 0,
      criticalAlertsCount: num(m.criticalAlertsCount) ?? 0,
      latestObservationAt: strOrNull(m.latestObservationAt),
    },
    cameras: cameras.map(adaptCamera),
    analytics: {
      hourlyTraffic: trendPoints(analytics),
      peakHour: strOrNull(analytics.peakHour),
      peakHourEntries: num(analytics.peakHourEntries),
      averageVisitDurationMinutes: num(analytics.averageVisitDurationMinutes),
      retentionRatePercentage: null,
      bounceRatePercentage: null,
      zones: arr(analytics.zones).map(adaptZoneActivity),
    },
    shelves: arr(dto.shelves).map((s) => adaptShelfStatus(s, cameras)),
    queues: arr(dto.queues).map((q) => adaptQueueStatus(q, cameras)),
    alerts: arr(dto.alerts).map(adaptAlert),
    connection: adaptConnection(obj(dto.connection)),
    lastUpdated: dto.lastUpdated ? clock(dto.lastUpdated, true) : '',
    lastUpdatedAt: strOrNull(dto.lastUpdated) ?? undefined,
    dataMode: str(dto.dataMode, 'real') === 'demo' ? 'demo' : 'real',
    freshness: obj(dto.freshness) as StoreOverviewData['freshness'],
    dataQuality: arr(dto.dataQuality) as StoreOverviewData['dataQuality'],
    dataAvailability: obj(dto.dataAvailability) as StoreOverviewData['dataAvailability'],
  };
}

export { parseIso };
