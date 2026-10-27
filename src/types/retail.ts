export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'demo' | 'stale' | 'error';

export interface SystemConnection {
  status: ConnectionStatus;
  latencyMs: number | null;
  lastHeartbeat: string;
  edgeServerId: string;
  edgeModelVersion: string | null;
  fpsAverage: number | null;
  activeCameras: number;
  totalCameras: number;
}

export interface Store {
  id: string;
  name: string;
  code: string;
  city: string;
  region: string;
  address: string;
  squareFootage: number;
  maxCapacity: number;
  openTime: string;
  closeTime: string;
  managerName: string;
  edgeServerStatus: ConnectionStatus;
  dataMode?: 'real' | 'demo';
}

export interface FootfallTrendPoint {
  time: string;
  entries: number;
  exits: number;
  previousPeriodEntries: number | null;
  occupancy: number | null;
  /** entries for charts: null where nothing was counted (a gap), so the line never drops to a fake 0 */
  plotEntries?: number | null;
}

export interface ZoneActivity {
  id: string;
  name: string;
  category: string;
  currentOccupancy: number | null;
  capacityLimit: number;
  dwellTimeMinutes: number | null;
  congestionLevel: 'optimal' | 'moderate' | 'high' | 'critical';
  trend: 'up' | 'down' | 'stable' | null;
  popularProduct: string | null;
}

export interface ShopperAnalytics {
  hourlyTraffic: FootfallTrendPoint[];
  peakHour: string | null;
  peakHourEntries: number | null;
  averageVisitDurationMinutes: number | null;
  retentionRatePercentage: number | null;
  bounceRatePercentage: number | null;
  zones: ZoneActivity[];
}

export interface DetectionBox {
  id: string;
  label: string;
  confidence: number;
  x: number; // percentage (0-100)
  y: number; // percentage (0-100)
  width: number; // percentage (0-100)
  height: number; // percentage (0-100)
  trackingId?: string;
  status?: string;
  dwellSeconds?: number;
}

export interface CameraDetection {
  timestamp: string;
  frameCount: number;
  detections: DetectionBox[];
  peopleCount: number | null;
  alertsDetected: number;
  anomaliesDetected?: string[];
}

export type CameraType = 'entrance' | 'shelf' | 'checkout' | 'aisle';

export interface CameraFeed {
  id: string;
  name: string;
  cameraCode: string;
  type: CameraType;
  zone: string;
  resolution: string;
  streamUrl?: string; // HLS / WebRTC / MJPEG endpoint
  streamType: 'demo_canvas' | 'mjpeg' | 'hls' | 'webrtc' | 'placeholder';
  fps: number | null;
  status: 'live' | 'offline' | 'connecting' | 'demo' | 'error' | 'buffering' | 'reconnecting';
  lastFrameTimestamp: string;
  currentDetection: CameraDetection;
  metrics: {
    primaryLabel: string;
    primaryValue: string | number;
    secondaryLabel: string;
    secondaryValue: string | number;
    statusTag?: string;
  };
  aiModule?: CameraAiModule;
  aiModelName?: string;
  purpose?: CameraPurpose;
  latencyMs?: number;
  bandwidthKbps?: number;
  packetLossPct?: number;
  countingLines?: CountingLineConfig[];
  roiPolygons?: RoiPolygonConfig[];
  zoneId?: string;
  lastFrameAt?: string;
  isDemo?: boolean;
  sourceType?: string;
  errorCode?: string | null;
  message?: string | null;
}

export type ShelfCondition = 'optimal' | 'low_stock' | 'out_of_stock' | 'misplaced_item';
export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low';

export interface ShelfStatus {
  id: string;
  shelfCode: string;
  zone: string;
  category: string;
  productName: string;
  currentUnits: number | null;
  capacityUnits: number;
  stockPercentage: number | null;
  condition: ShelfCondition;
  priority: PriorityLevel;
  lastDetection: string;
  monitoredByCamId: string;
}

export type QueueCongestion = 'optimal' | 'moderate' | 'high' | 'critical';

export interface QueueStatus {
  counterId: string;
  counterName: string;
  cashierName: string;
  status: 'open' | 'closed' | 'paused';
  waitingCustomers: number | null;
  estimatedWaitMinutes: number | null;
  congestion: QueueCongestion;
  avgItemsPerCustomer: number | null;
  recommendedAction: string;
  monitoredByCamId: string;
}

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertCategory = 
  | 'stock_shortage' 
  | 'queue_congestion' 
  | 'camera_disconnected' 
  | 'unusual_customer_traffic' 
  | 'pending_replenishment';

export interface Alert {
  id: string;
  title: string;
  description: string;
  category: AlertCategory;
  severity: AlertSeverity;
  zone: string;
  timestamp: string;
  recommendedAction: string;
  status: 'active' | 'acknowledged' | 'resolved';
  acknowledgedBy?: string;
  resolvedAt?: string;
  cameraId?: string;
  createdAt?: string;
  shelfId?: string;
  counterId?: string;
  taskId?: string;
  source?: string;
}

export interface StaffTask {
  id: string;
  title: string;
  assignedTo: string;
  assignedRole: string;
  priority: PriorityLevel;
  status: 'pending' | 'in_progress' | 'completed';
  zone: string;
  timeCreated: string;
  dueWithinMinutes: number;
}

export interface StoreMetrics {
  totalFootfallToday: number | null;
  footfallChangePercentage: number | null;
  footfallHistoryMini: number[]; // mini sparkline points
  
  currentOccupancy: number | null;
  maxCapacity: number;
  occupancyPercentage: number | null;

  averageDwellTimeMinutes: number | null;
  dwellTimeChangeMinutes: number | null; // e.g. +2.4 vs previous week

  lowStockShelvesCount: number;
  outOfStockShelvesCount: number;
  criticalInventoryAlertsCount: number;

  activeCheckoutQueuesCount: number;
  totalCustomersInQueue: number;
  overallQueueStatus: QueueCongestion;

  averageWaitTimeMinutes: number | null;
  waitTimeTrendMinutes: number | null; // e.g. -0.8 min vs peak average
  waitTimeCongestion: QueueCongestion;
  occupancyStatus?: string | null;
  occupancyBasis?: string | null;
  camerasOnline?: number;
  camerasTotal?: number;
  openTasks?: number;
  activeAlerts?: number;
  criticalAlertsCount?: number;
  latestObservationAt?: string | null;
}

export interface StoreOverviewData {
  store: Store;
  metrics: StoreMetrics;
  cameras: CameraFeed[];
  analytics: ShopperAnalytics;
  shelves: ShelfStatus[];
  queues: QueueStatus[];
  alerts: Alert[];
  connection: SystemConnection;
  lastUpdated: string;
  lastUpdatedAt?: string;
  dataMode?: 'real' | 'demo';
  freshness?: Record<string, { lastObservationAt: string | null; ageSeconds: number | null; state: 'fresh' | 'stale' | 'unavailable'; note?: string }>;
  dataQuality?: { module: string; level: 'info' | 'warning'; message: string }[];
  dataAvailability?: Record<string, 'available' | 'empty' | 'unavailable'>;
}

export type DateRange = 'today' | 'yesterday' | 'week' | 'month' | '7d' | '30d';

/* =========================================================================
   PAGE 2: SHOPPER ANALYTICS SPECIFIC TYPED INTERFACES
   ========================================================================= */

export type TimeOfDayFilter = 'all_day' | 'morning' | 'afternoon' | 'evening';

export interface ZoneGeometry {
  id: string;
  name: string;
  category: string;
  x: number;
  y: number;
  width: number;
  height: number;
  colorTheme: string;
  cameraIds: string[];
}

export interface ZoneMetrics {
  zoneId: string;
  zoneName: string;
  category: string;
  totalVisitors: number;
  currentOccupancy: number | null;
  capacityLimit: number;
  densityScore: number | null;
  densityLevel: 'low' | 'moderate' | 'high' | null;
  avgDwellMinutes: number | null;
  dwellChangePercentage: number | null;
  peakHour: string | null;
  peakVisitors: number | null;
  activityChangePercentage: number | null;
  monitoredByCameras: string[];
  hourlyTrend: { hour: string; visitors: number; dwellMinutes: number }[];
  geometry?: { x: number; y: number; width: number; height: number; color: string };
}

export interface DwellTimeDistribution {
  range: string;
  count: number;
  percentage: number;
}

export interface DwellTimeRecord {
  zoneId: string;
  zoneName: string;
  avgDwellMinutes: number | null;
  benchmarkTargetMinutes: number | null;
  distribution: DwellTimeDistribution[];
  visitors?: number;
}

export interface CustomerPath {
  id: string;
  pathName: string;
  sequence: string[];
  frequencyPercentage: number | null;
  avgDurationMinutes: number | null;
  conversionRate: number | null;
}

export interface ZoneTransitionNode {
  fromZone: string;
  toZone: string;
  transitionCount: number;
  probability: number | null;
}

export interface AggregatedMovement {
  topPaths: CustomerPath[];
  transitions: ZoneTransitionNode[];
  highEngagementZones: string[];
  lowEngagementZones: string[];
  bottleneckZones: string[];
  scopeNote?: string;
}

export interface PeakHourSlot {
  hour: string;
  visitorVolume: number;
  occupancyAvg: number | null;
  status: 'quiet' | 'normal' | 'busy' | 'peak';
  recommendedStaff: number | null;
  activeStaff: number | null;
  staffOpportunityNote?: string;
}

export interface ShopperInsight {
  id: string;
  title: string;
  description: string;
  type: 'traffic' | 'bottleneck' | 'merchandising' | 'staffing';
  importance: 'high' | 'medium' | 'info';
  metricImpact: string;
  suggestedAction: string;
  zoneId?: string;
}

export interface ShopperAnalyticsData {
  storeId: string;
  dateRange: DateRange;
  timeOfDay: TimeOfDayFilter;
  kpis: {
    totalEntries: number | null;
    totalEntriesMeasured: boolean;
    entriesChangePct: number | null;
    totalExits: number | null;
    totalExitsMeasured: boolean;
    exitsChangePct: number | null;
    currentOccupancy: number | null;
    occupancyChangePct: number | null;
    avgDwellTimeMinutes: number | null;
    dwellChangePct: number | null;
    busiestHour: string | null;
    busiestHourVolume: number | null;
    mostVisitedZone: string | null;
    mostVisitedZoneSharePct: number | null;
  };
  footfallTrend: FootfallTrendPoint[];
  dailyAggregation: { day: string; entries: number; exits: number; prevWeekEntries: number | null }[];
  weeklyAggregation: { week: string; entries: number; exits: number }[];
  zones: ZoneMetrics[];
  dwellAnalytics: DwellTimeRecord[];
  movementPatterns: AggregatedMovement;
  peakHourSlots: PeakHourSlot[];
  insights: ShopperInsight[];
  lastCalculated: string;
  dataState?: 'available' | 'empty' | 'unavailable';
  dataNote?: string;
}

/* =========================================================================
   PAGE 3: SMART INVENTORY SPECIFIC TYPED INTERFACES
   ========================================================================= */

export type ShelfConditionType = 'in_stock' | 'low_stock' | 'out_of_stock' | 'uncertain' | 'camera_offline';

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  department: string;
  shelfId: string;
  shelfCode: string;
  expectedVisibleQty: number | null;
  detectedVisibleQty: number | null;
  stockroomQty: number | null; // POS / ERP warehouse stock distinct from visible shelf count
  availabilityPct: number | null;
  confidenceScore: number | null;
  status: 'in_stock' | 'low_stock' | 'out_of_stock' | 'uncertain';
  lastObservation: string;
  price: number;
  unit: string;
  imageUrl?: string;
  /** customer app: store-map zone and the PUBLIC shelf-availability wording (never counts) */
  zoneId?: string;
  availabilityLabel?: string;
  availabilityNote?: string;
}

export interface ShelfDetail {
  id: string;
  shelfCode: string;
  department: string;
  category: string;
  tierCount: number;
  capacityUnits: number;
  expectedVisibleUnits: number | null;
  detectedVisibleUnits: number | null;
  availabilityPercentage: number | null;
  condition: ShelfConditionType;
  lastObservation: string;
  associatedCameraId: string;
  associatedCameraName: string;
  aisleLocation: string;
  planogramCompliancePct: number | null;
  productIds: string[];
  lastObservationAt?: string;
}

export type PlanogramSlotStatus = 'compliant' | 'missing' | 'misplaced' | 'uncertain';

export interface PlanogramSlot {
  slotId: string;
  tier: number;
  position: number;
  expectedProductId: string;
  expectedProductName: string;
  expectedSku: string;
  detectedProductId?: string;
  detectedProductName?: string;
  detectedSku?: string;
  status: PlanogramSlotStatus;
  confidence: number | null;
  evidenceNote: string;
}

export interface Planogram {
  id: string;
  shelfId: string;
  shelfCode: string;
  department: string;
  compliancePercentage: number | null;
  totalSlots: number;
  compliantSlots: number;
  mismatchedSlots: number;
  missingSlots: number;
  lastVerified: string;
  tiers: { tierNumber: number; slots: PlanogramSlot[] }[];
}

export interface StoreStaff {
  id: string;
  name: string;
  role: string;
  avatar: string;
  activeTasksCount: number;
  status: 'available' | 'busy' | 'off_shift';
}

export type ReplenishmentTaskStatus = 'new' | 'assigned' | 'in_progress' | 'completed';

export interface ReplenishmentTask {
  id: string;
  taskCode: string;
  title: string;
  productId: string;
  productName: string;
  sku: string;
  shelfId: string;
  shelfCode: string;
  department: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  assignedStaffId: string;
  assignedStaffName: string;
  assignedStaffRole: string;
  status: ReplenishmentTaskStatus;
  createdAt: string;
  dueWithin: string;
  completedAt?: string;
  cameraVerified: boolean;
  cameraVerifiedAt?: string;
  quantityToReplenish: number;
  notes?: string;
}

export interface InventoryAlert {
  id: string;
  alertCode: string;
  title: string;
  description: string;
  shelfId: string;
  shelfCode: string;
  cameraId: string;
  cameraName: string;
  severity: 'critical' | 'warning' | 'info';
  detectionTime: string;
  evidence: string;
  status: 'active' | 'acknowledged' | 'resolved';
  taskId?: string;
}

export interface StockAnalyticsData {
  availabilityHistory: { timestamp: string; overallAvailability: number | null; compliance: number | null }[];
  shortageByDepartment: { department: string; lowStockCount: number; outOfStockCount: number }[];
  frequentStockoutLocations: { shelfCode: string; department: string; occurrences: number; avgRecoveryMins: number | null }[];
  restockingResponseTrend: { day: string; avgResponseMins: number | null; targetMins: number | null }[];
}

export interface SmartInventoryData {
  storeId: string;
  dateRange: DateRange;
  departmentFilter: string;
  kpis: {
    monitoredShelvesCount: number;
    healthyShelvesCount: number;
    lowStockShelvesCount: number;
    outOfStockShelvesCount: number;
    planogramCompliancePct: number | null;
    pendingTasksCount: number;
  };
  shelves: ShelfDetail[];
  products: Product[];
  planograms: Planogram[];
  tasks: ReplenishmentTask[];
  alerts: InventoryAlert[];
  staff: StoreStaff[];
  stockAnalytics: StockAnalyticsData;
  lastUpdated: string;
  dataState?: 'available' | 'empty' | 'unavailable';
  dataNote?: string;
}

/* =========================================================================
   PAGE 4: QUEUE INTELLIGENCE SPECIFIC TYPED INTERFACES
   ========================================================================= */

export type CheckoutCounterType = 'express' | 'standard' | 'self_checkout';
export type CheckoutCounterStatus = 'open' | 'closed' | 'standby' | 'paused';
export type QueueCongestionSeverity = 'optimal' | 'moderate' | 'high' | 'critical';

export interface CheckoutCounter {
  id: string;
  counterCode: string;
  counterName: string;
  type: CheckoutCounterType;
  section: string;
  status: CheckoutCounterStatus;
  cashierId?: string;
  cashierName: string;
  cashierRole?: string;
  cashierAvatar?: string;
  customersWaiting: number | null;
  estimatedWaitMinutes: number | null;
  arrivalRatePerMin: number | null;
  serviceRatePerMin: number | null;
  utilizationPct: number | null;
  avgItemsPerCustomer: number | null;
  congestionLevel: QueueCongestionSeverity;
  slaThresholdMinutes: number;
  monitoredByCamId: string;
  lastUpdated: string;
  hourlyThroughput: number | null;
  totalProcessedToday: number | null;
  scanningSpeedItemsPerMin: number | null;
  idleTimePercentage: number | null;
  historicalWaitToday: { time: string; waitMinutes: number; queueLength: number }[];
}

export interface QueuePredictionPoint {
  timestamp: string; // e.g. "+5m", "+10m", "+15m"
  timeLabel: string; // e.g. "14:35"
  currentBaseline: number;
  predictedLength: number;
  upperConfidence: number | null;
  lowerConfidence: number | null;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  breachesSla: boolean;
}

export interface QueueCongestionForecast {
  counterId: string;
  counterName: string;
  currentQueue: number | null;
  arrivalRate: number | null;
  serviceRate: number | null;
  congestionRiskPct: number | null;
  timeToSlaBreachMinutes: number | null; // null if stable
  forecastPoints: QueuePredictionPoint[];
}

export type StaffingRecommendationType = 'open_counter' | 'reassign_staff' | 'rebalance_express' | 'cashier_break';

export interface StaffingRecommendation {
  id: string;
  type: StaffingRecommendationType;
  title: string;
  recommendationText: string;
  reason: string;
  sourceMetrics: {
    currentWait: number | null;
    projectedWait: number | null;
    queueSize: number | null;
  };
  expectedOutcome: string;
  targetCounterId: string;
  targetCounterName: string;
  suggestedStaffId: string;
  suggestedStaffName: string;
  suggestedStaffRole: string;
  priority: 'critical' | 'high' | 'medium';
  timestamp: string;
  status: 'pending' | 'acknowledged' | 'deployed' | 'dismissed';
}

export type QueueAlertCondition = 'sla_breach' | 'surge_detected' | 'idle_cashier' | 'express_overflow';

export interface QueueAlert {
  id: string;
  alertCode: string;
  title: string;
  counterId: string;
  counterName: string;
  severity: 'critical' | 'warning' | 'info';
  condition: QueueAlertCondition;
  metricTriggered: string;
  threshold: string;
  timestamp: string;
  status: 'active' | 'acknowledged' | 'resolved';
  suggestedAction: string;
}

export interface QueueRulesConfig {
  maxPreferredQueueLength: number; // default: 4
  slaWarningWaitMinutes: number; // default: 3.5
  slaCriticalWaitMinutes: number; // default: 5.0
  assumedServiceRatePerMin: number | null; // default: 1.2
  forecastHorizonMinutes: 5 | 10 | 15 | 30; // default: 15
  autoAlertTriggers: boolean; // default: true
  expressItemLimit: number; // default: 10
}

export interface QueueHistoricalAnalytics {
  hourlyQueueData: {
    hour: string;
    avgWaitMinutes: number | null;
    totalWaiting: number | null;
    throughput: number | null;
    counter1Wait: number | null;
    counter2Wait: number | null;
    counter3Wait: number | null;
    counter4Wait: number | null;
  }[];
  hourlyThroughput: {
    hour: string;
    counter1: number;
    counter2: number;
    counter3: number;
    counter4: number;
    total: number;
  }[];
  waitTimeDistribution: {
    range: string;
    percentage: number;
    count: number;
  }[];
  serviceSpeedVsItems: {
    itemsBracket: string;
    avgSeconds: number;
    benchmarkSeconds: number;
  }[];
}

export interface QueueIntelligenceData {
  storeId: string;
  dateRange: DateRange;
  checkoutSection: string;
  kpis: {
    activeCounters: number;
    totalCounters: number;
    waitingCustomers: number | null;
    avgWaitMinutes: number | null;
    avgWaitMinutesTrend: number | null;
    longestQueueCounter: string | null;
    longestQueueLength: number | null;
    longestQueueWaitMinutes: number | null;
    hourlyThroughput: number | null;
    throughputTrendPct: number | null;
    congestedCountersCount: number;
  };
  counters: CheckoutCounter[];
  cameraFeed: CameraFeed | null;
  cameraFeedsList: CameraFeed[];
  forecast: QueueCongestionForecast[];
  staffingRecommendations: StaffingRecommendation[];
  queueAlerts: QueueAlert[];
  historicalAnalytics: QueueHistoricalAnalytics;
  rulesConfig: QueueRulesConfig;
  availableStaff: StoreStaff[];
  lastUpdated: string;
  dataState?: 'available' | 'empty' | 'unavailable';
  dataNote?: string;
}

/* =========================================================================
   PAGE 5: LIVE CAMERA MONITORING SPECIFIC TYPED INTERFACES
   ========================================================================= */

export type CameraAiModule =
  | 'people_counting'
  | 'shelf_detection'
  | 'queue_monitoring'
  | 'zone_analytics'
  | 'loss_prevention';

export type CameraPurpose =
  | 'overview'
  | 'shelf_inspection'
  | 'queue_staging'
  | 'loss_prevention'
  | 'logistics';

export type StreamProtocol = 'webrtc' | 'hls' | 'mjpeg' | 'demo_canvas';
export type CameraStreamState = 'live' | 'offline' | 'connecting' | 'buffering' | 'reconnecting' | 'demo' | 'error';

export interface CountingLineConfig {
  id: string;
  name: string;
  y: number; // percentage (0-100)
  inCount: number;
  outCount: number;
}

export interface RoiPolygonConfig {
  id: string;
  name: string;
  points: { x: number; y: number }[];
  color: string;
  label: string;
}

export interface CameraConfig {
  id: string;
  cameraCode: string;
  name: string;
  zone: string;
  type: CameraType;
  purpose: CameraPurpose;
  aiModule: CameraAiModule;
  aiModelName: string;
  streamType: StreamProtocol;
  streamUrl?: string;
  resolution: string;
  targetFps: number;
  ptzSupported?: boolean;
  audioEnabled?: boolean;
  enabled: boolean;
}

export type CameraEventSeverity = 'critical' | 'warning' | 'info';
export type CameraEventCategory = 'footfall' | 'shelf_gap' | 'queue' | 'dwell' | 'offline' | 'motion';

export interface CameraDetectionEvent {
  id: string;
  cameraId: string;
  cameraCode: string;
  cameraName: string;
  zone: string;
  title: string;
  description: string;
  timestamp: string;
  severity: CameraEventSeverity;
  category: CameraEventCategory;
  detectionCount?: number;
  snapshotUrl?: string;
  trackingId?: string;
  occurredAt?: string;
}

export interface CameraKpiSummary {
  totalCameras: number;
  connectedCameras: number;
  offlineCameras: number;
  aiEnabledCameras: number;
  activeAlerts: number;
  latestDetectionTime: string | null;
  avgLatencyMs: number | null;
  averageFps?: number | null;
}

export interface LiveCamerasData {
  storeId: string;
  cameras: CameraFeed[];
  events: CameraDetectionEvent[];
  kpis: CameraKpiSummary;
  lastUpdated: string;
  dataState?: 'available' | 'empty' | 'unavailable';
  dataNote?: string;
}

/* =========================================================================
   PAGE 6: AI INSIGHTS & RECOMMENDATIONS SPECIFIC TYPED INTERFACES
   ========================================================================= */

export type InsightCategory =
  | 'shopper_analytics'
  | 'inventory'
  | 'queue_intelligence'
  | 'operational_efficiency'
  | 'camera_health';

export type InsightSeverity = 'critical' | 'warning' | 'info';
export type InsightActionStatus = 'pending' | 'in_progress' | 'completed' | 'dismissed';

export interface SupportingEvidence {
  observedStatement: string;
  dataSource: string;
  timeWindow: string;
  metricsTable: {
    metric: string;
    measuredValue: string;
    targetThreshold: string;
    variance: string;
  }[];
  triggerRule: string;
  riskAnalysis: string;
  confidenceReliability: string;
  relatedModuleUrl: string;
  relatedModuleName: string;
}

export interface OperationalInsight {
  id: string;
  code: string;
  title: string;
  category: InsightCategory;
  severity: InsightSeverity;
  status: InsightActionStatus;
  zone: string;
  timestamp: string;
  summary: string;
  explanation: string;
  recommendedAction: string;
  evidence: SupportingEvidence;
  assignedStaffId?: string;
  assignedStaffName?: string;
  completedAt?: string;
  dismissedReason?: string;
  taskId?: string;
  source?: string;
}

export interface FootfallForecastPoint {
  hour: string;
  actualTraffic: number | null;
  forecastTraffic: number;
  upperConfidence: number;
  lowerConfidence: number;
  isPeakHour: boolean;
  isFuture: boolean;
}

export interface FootfallForecastData {
  horizon: 'today' | 'next_4h' | 'next_8h' | 'tomorrow';
  modelName: string;
  generationTime: string;
  projectedTotalVolume: number;
  peakHour: string;
  peakVolume: number;
  historicalReliabilityMae: number | null; // backtest error in % of the day's real total
  points: FootfallForecastPoint[];
  daysUsed?: number;
  includesDemoHistory?: boolean;
  methodNote?: string;
}

export interface FootfallHistoryStatus {
  reason: string;
  daysOfHistory: number;
  requiredDays: number;
  hourlyBuckets: number;
  observedHourly: { hour: string; entries: number }[];
}

export interface RetailOpportunity {
  id: string;
  title: string;
  zone: string;
  type: 'high_traffic' | 'bottleneck' | 'promotion' | 'cold_spot' | 'shelf_velocity';
  metricLabel: string;
  metricValue: string;
  observation: string;
  opportunityNote: string;
  actionLabel: string;
  targetUrl: string;
}

export interface AiInsightsKpis {
  activeInsights: number;
  criticalIssues: number;
  pendingActions: number;
  completedRecommendations: number;
  inventoryRiskAlerts: number;
  queueCongestionRisk: number;
}

export interface AiInsightsData {
  storeId: string;
  dateRange: DateRange;
  kpis: AiInsightsKpis;
  insights: OperationalInsight[];
  footfallForecast: FootfallForecastData | null;
  footfallStatus?: FootfallHistoryStatus | null;
  opportunities: RetailOpportunity[];
  lastUpdated: string;
  dataState?: 'available' | 'empty' | 'unavailable';
  dataNote?: string;
}

/* =========================================================================
   PAGE 7: REPORTS & ANALYTICS SPECIFIC TYPED INTERFACES
   ========================================================================= */

export type ReportCategory = 'overview' | 'shoppers' | 'inventory' | 'queues' | 'operations';
export type ComparePeriod = 'none' | 'previous_period' | 'previous_year';

export interface ReportConfiguration {
  id: string;
  name: string;
  category: ReportCategory;
  dateRange: DateRange;
  comparePeriod: ComparePeriod;
  createdAt: string;
  updatedAt: string;
  departmentFilter?: string;
  counterFilter?: string;
}

export interface ExecutiveKpiMetric {
  current: number | null;
  previous: number | null;
  delta: number | null;
  percentChange: number | null;
  unit: string;
  isPositiveGood: boolean; // e.g. true for footfall/tasks, false for queue wait/incidents/low stock
}

export interface MultiMetricTrendPoint {
  timestamp: string;
  footfall: number;
  avgWaitMinutes: number | null;
  lowStockEvents: number;
  tasksCompleted: number;
  prevFootfall?: number | null;
}

export interface HistoricalInsightItem {
  id: string;
  headline: string;
  detail: string;
  category: ReportCategory;
  metricTelemetry: string;
  period: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface ExecutiveOverviewReport {
  kpis: {
    totalFootfall: ExecutiveKpiMetric;
    averageDwellTimeMinutes: ExecutiveKpiMetric;
    detectedLowStockEvents: ExecutiveKpiMetric;
    averageQueueWaitMinutes: ExecutiveKpiMetric;
    completedTasks: ExecutiveKpiMetric;
    criticalIncidents: ExecutiveKpiMetric;
  };
  multiMetricTrends: MultiMetricTrendPoint[];
  keyTrendsSummary: string[];
  historicalInsights: HistoricalInsightItem[];
}

export interface HistoricalFootfall {
  date: string;
  entries: number;
  exits: number;
  netOccupancyChange: number;
  peakHour: string | null;
  peakVolume: number;
  avgDwellTimeMinutes: number | null;
  bounceRateEstimatedPct: number | null;
  prevEntries?: number | null;
}

export interface HourlyFootfallTrend {
  hour: string;
  entries: number;
  exits: number;
  prevEntries: number | null;
  avgDwell: number | null;
}

export interface ZoneDistributionData {
  zone: string;
  visits: number;
  percentage: number;
  avgDwellMinutes: number | null;
  prevVisits?: number | null;
}

export interface PeakPeriodData {
  period: string;
  hours: string;
  avgShoppersPerHour: number;
  congestionLevel: 'low' | 'moderate' | 'high' | 'peak';
}

export interface ShopperReportData {
  hourlyTrends: HourlyFootfallTrend[];
  dailyFootfall: HistoricalFootfall[];
  zoneDistribution: ZoneDistributionData[];
  peakShoppingPeriods: PeakPeriodData[];
  footfallComparisonSummary: {
    currentTotal: number;
    previousTotal: number | null;
    netGrowthPct: number | null;
    busiestDay: string | null;
  };
}

export interface InventoryHistory {
  date: string;
  shelfAvailabilityPercentage: number | null;
  lowStockEventsCount: number;
  outOfStockEventsCount: number;
  tasksCreatedCount: number;
  tasksResolvedCount: number;
  avgResponseMinutes: number | null;
  planogramCompliancePercentage: number | null;
}

export interface DepletedShelfItem {
  shelfId: string;
  aisle: string;
  department: string;
  productName: string;
  depletionCount: number;
  avgRestockMinutes: number | null;
  cameraVerified: boolean;
}

export interface DepartmentShortageData {
  department: string;
  lowStockIncidents: number;
  outOfStockIncidents: number;
  availabilityRate: number | null;
}

export interface StockoutLogItem {
  id: string;
  timestamp: string;
  shelfId: string;
  product: string;
  department: string;
  durationMinutes: number | null;
  restockedBy: string | null;
  status: 'resolved' | 'pending' | 'in_progress';
}

export interface InventoryReportData {
  historyTimeline: InventoryHistory[];
  depletedShelves: DepletedShelfItem[];
  departmentShortages: DepartmentShortageData[];
  replenishmentTaskStats: {
    totalCreated: number;
    totalCompleted: number;
    avgResponseTimeMinutes: number | null;
    compliantWithSlaPercent: number | null;
  };
  stockoutLog: StockoutLogItem[];
}

export interface QueueHistory {
  date: string;
  avgWaitMinutes: number | null;
  peakWaitMinutes: number | null;
  avgQueueLength: number | null;
  peakQueueLength: number | null;
  totalCustomersProcessed: number | null;
  congestionIncidentsCount: number;
  avgResponseToAlertMinutes: number | null;
}

export interface HourlyQueueTrend {
  hour: string;
  avgWaitMinutes: number | null;
  prevAvgWaitMinutes: number | null;
  maxQueueLength: number;
  throughputPerMinute: number | null;
}

export interface CounterComparisonData {
  counterId: string;
  counterName: string;
  type: CheckoutCounterType;
  avgWaitMinutes: number | null;
  customersServed: number | null;
  utilizationPct: number | null;
  congestionAlerts: number;
}

export interface QueueAlertLogItem {
  id: string;
  timestamp: string;
  counterId: string;
  triggerWaitMinutes: number | null;
  resolutionMinutes: number | null;
  actionTaken: string;
  status: 'resolved' | 'active';
}

export interface QueueReportData {
  historyTimeline: QueueHistory[];
  hourlyQueueTrends: HourlyQueueTrend[];
  counterComparisons: CounterComparisonData[];
  queueAlertLog: QueueAlertLogItem[];
  overallThroughputSummary: {
    totalServed: number | null;
    avgThroughputPerMin: number | null;
    slaComplianceRate: number | null; // percentage under 4.5m wait
  };
}

export interface OperationalPerformance {
  date: string;
  alertsGenerated: number;
  alertsAcknowledged: number;
  alertsResolved: number;
  avgAlertResponseMinutes: number | null;
  replenishmentTasksCompleted: number;
  staffingTasksCompleted: number;
  repeatedIncidents: number;
  overallCameraUptimePct: number | null;
}

export interface CameraUptimeStats {
  cameraId: string;
  name: string;
  zone: string;
  streamProtocol: string;
  uptimePct: number | null;
  offlineIncidentsCount: number;
  lastChecked: string | null;
}

export interface IncidentCategoryData {
  category: string;
  count: number;
  percentage: number;
  avgResolutionMinutes: number | null;
}

export interface StaffEfficiencyData {
  staffId: string;
  name: string;
  role: string;
  tasksCompleted: number;
  avgResponseMinutes: number | null;
  slaCompliancePct: number | null;
}

export interface OperationsEventLogItem {
  id: string;
  timestamp: string;
  eventType: string;
  zone: string;
  detail: string;
  responseTimeMinutes: number | null;
  status: 'resolved' | 'escalated' | 'acknowledged';
}

export interface OperationsReportData {
  historyTimeline: OperationalPerformance[];
  cameraUptimeList: CameraUptimeStats[];
  incidentCategoryBreakdown: IncidentCategoryData[];
  staffEfficiencySummary: StaffEfficiencyData[];
  operationsEventLog: OperationsEventLogItem[];
  overallOperationsSummary: {
    totalIncidents: number;
    acknowledgmentRatePct: number | null;
    resolutionRatePct: number | null;
    avgResponseMinutes: number | null;
  };
}

export interface ReportSummaryData {
  storeId: string;
  storeName: string;
  dateRange: DateRange;
  comparePeriod: ComparePeriod;
  generatedAt: string;
  overview: ExecutiveOverviewReport;
  shoppers: ShopperReportData;
  inventory: InventoryReportData;
  queues: QueueReportData;
  operations: OperationsReportData;
  dataState?: 'available' | 'empty' | 'unavailable';
  dataNote?: string;
  dataMode?: 'real' | 'demo';
  unavailableFields?: string[];
}

export interface ReportExport {
  format: 'csv' | 'pdf' | 'print';
  generatedAt: string;
  filename: string;
  reportCategory: ReportCategory;
  storeName: string;
  dateRange: DateRange;
}

/* =========================================================================
   PAGE 8: STORE COPILOT SPECIFIC TYPED INTERFACES
   ========================================================================= */

export type CopilotMessageRole = 'user' | 'assistant' | 'system';

export interface CopilotToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface CopilotToolResult {
  toolCallId: string;
  name: string;
  result: any;
  executedAt: string;
}

export interface CopilotGroundingSource {
  module: 'shopper_analytics' | 'smart_inventory' | 'queue_intelligence' | 'live_cameras' | 'alerts_tasks' | 'store_reports';
  moduleTitle: string;
  storeName: string;
  timeRange: string;
  lastUpdated: string;
  telemetryEvidence: string;
  targetUrl?: string;
}

export type CopilotActionType =
  | 'create_replenishment_task'
  | 'assign_staff_task'
  | 'acknowledge_alert'
  | 'open_checkout_counter'
  | 'generate_store_report'
  | 'update_task_status'
  | 'create_checkout_assistance_task';

export interface CopilotActionPreview {
  actionId: string;
  idempotencyKey: string;
  actionType: CopilotActionType;
  title: string;
  description: string;
  params: Record<string, any>;
  requiresConfirmation: boolean;
  status: 'awaiting_confirmation' | 'confirmed' | 'cancelled' | 'executed';
  createdAt: string;
}

export interface CopilotActionResult {
  actionId: string;
  idempotencyKey: string;
  actionType: CopilotActionType;
  success: boolean;
  message: string;
  executedAt: string;
  resultReferenceId?: string; // e.g. TSK-104 or ALR-201
  details?: Record<string, any>;
}

export type CopilotRichPayloadType =
  | 'kpi_summary'
  | 'footfall_chart'
  | 'shelf_cards'
  | 'queue_status'
  | 'camera_links'
  | 'staff_list'
  | 'alerts_list'
  | 'tasks_table';

export interface CopilotRichPayload {
  type: CopilotRichPayloadType;
  title?: string;
  description?: string;
  data: any;
}

export interface CopilotStructuredIssue {
  num: number;
  title: string;
  priority: string;
  priorityVariant?: 'rose' | 'amber' | 'blue';
  bullets: string[];
  actionQuery?: string;
}

export interface CopilotTaskSuccess {
  title: string;
  description: string;
}

export interface CopilotMessage {
  id: string;
  role: CopilotMessageRole;
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  toolCalls?: CopilotToolCall[];
  toolResults?: CopilotToolResult[];
  groundingSources?: CopilotGroundingSource[];
  richPayload?: CopilotRichPayload;
  actionPreview?: CopilotActionPreview;
  actionResult?: CopilotActionResult;
  followUpQuestions?: string[];
  structuredIssues?: CopilotStructuredIssue[];
  recommendedActions?: string[];
  taskSuccess?: CopilotTaskSuccess;
  /** REAL mode: how this answer was produced (model + tools, or database tools only) and whether the grounding check passed */
  copilot?: {
    mode?: string;
    model?: string;
    totalMs?: number;
    llmMs?: number;
    stopped?: boolean;
    providerNotice?: string;
    notes?: string[] | null;
    groundingCheck?: { passed: boolean; ungroundedNumbers?: string[] };
    errors?: { tool: string; message: string }[];
  };
}

export interface CopilotConversationContext {
  lastReferencedShelfId?: string;
  lastReferencedCounterId?: string;
  lastReferencedStaffId?: string;
  lastReferencedAlertId?: string;
  lastTopic?: string;
}

export interface CopilotConversation {
  id: string;
  title: string;
  storeId: string;
  storeName: string;
  createdAt: string;
  updatedAt: string;
  isPinned: boolean;
  messages: CopilotMessage[];
  context: CopilotConversationContext;
}

export type AiProviderMode = 'fastapi_cloud' | 'local_edge_engine';

export interface AiProviderStatus {
  provider: AiProviderMode;
  providerName: string;
  modelName: string;
  isConnected: boolean;
  latencyMs: number;
  deviceInfo: string;
  isStreamingSupported: boolean;
  toolCallingSupported: boolean;
}

/* =========================================================================
   PAGE 9: STAFF MANAGEMENT SPECIFIC TYPED INTERFACES
   ========================================================================= */

export type EmployeeRole =
  | 'store_manager'
  | 'floor_supervisor'
  | 'cashier'
  | 'inventory_associate'
  | 'shelf_replenishment'
  | 'customer_support'
  | 'security';

export type DepartmentName = string;

export type StaffAvailabilityStatus =
  | 'available'
  | 'busy'
  | 'on_break'
  | 'off_duty'
  | 'on_leave'
  | 'unknown';

export type AttendanceStatus =
  | 'present'
  | 'late'
  | 'checked_out'
  | 'absent'
  | 'on_leave'
  | 'scheduled';

export interface StaffEmployee {
  id: string; // e.g. STF-01
  name: string;
  email: string;
  phone: string;
  role: EmployeeRole;
  roleLabel: string;
  department: DepartmentName;
  storeId: string;
  avatar: string;
  availability: StaffAvailabilityStatus;
  attendance: AttendanceStatus;
  currentShiftId?: string;
  currentShiftLabel?: string;
  checkInTime?: string;
  checkOutTime?: string;
  activeTasksCount: number;
  completedTasksCount: number;
  skills: string[];
  isActive: boolean;
  joinedDate: string;
  assignedZone: string;
}

export interface ShiftTiming {
  id: string;
  name: string; // e.g. Morning Shift
  startTime: string; // 08:00
  endTime: string; // 16:00
  breakDurationMinutes: number; // 45
  color: string;
}

export interface ShiftAssignment {
  id: string;
  employeeId: string;
  employeeName: string;
  roleLabel: string;
  department: DepartmentName;
  storeId: string;
  date: string; // YYYY-MM-DD
  shiftTimingId: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'swapped' | 'absent';
  hasConflict?: boolean;
  conflictReason?: string;
  overnight?: boolean;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  department: DepartmentName;
  date: string;
  scheduledShift: string;
  scheduledStart: string;
  scheduledEnd: string;
  actualCheckIn?: string;
  actualCheckOut?: string;
  status: AttendanceStatus;
  totalHoursWorked: number;
  isLateCheckIn: boolean;
  lateMinutes?: number;
  manualOverrideNote?: string;
  overriddenBy?: string;
  derived?: boolean;
  source?: string;
}

export type StaffTaskCategory =
  | 'shelf_replenishment'
  | 'checkout_assistance'
  | 'inventory_inspection'
  | 'customer_assistance'
  | 'camera_maintenance'
  | 'general_operations';

export type StaffTaskStatus = 'new' | 'assigned' | 'in_progress' | 'completed' | 'cancelled';

export interface StaffTaskExtended {
  id: string; // e.g. TSK-101
  title: string;
  description: string;
  category: StaffTaskCategory;
  priority: PriorityLevel;
  status: StaffTaskStatus;
  assignedEmployeeId?: string;
  assignedEmployeeName?: string;
  assignedEmployeeRole?: string;
  storeId: string;
  zone: string;
  relatedEntity?: {
    type: 'shelf' | 'counter' | 'camera' | 'zone';
    id: string;
    label: string;
  };
  createdTime: string;
  dueTime: string;
  completedTime?: string;
  sourceAlertId?: string;
  notes?: string;
  createdAt?: string;
  dueAt?: string;
  source?: string;
  customerRequestId?: string;
  /** Status the shopper sees for a customer help task (submitted / assigned / on_the_way / in_progress / resolved / cancelled). */
  customerRequestStatus?: string;
  /** set while an action taken offline has not been confirmed by the server yet */
  syncState?: 'pending';
  fromCache?: boolean;
}

export interface StaffingAiRecommendation {
  id: string;
  title: string;
  reason: string;
  zone: string;
  priority: PriorityLevel;
  recommendedAction: string;
  suggestedEmployeeId?: string;
  suggestedEmployeeName?: string;
  sourceMetrics: string;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface StaffWorkloadAnalytics {
  departmentLoads: Array<{
    department: string;
    assignedTasks: number;
    completedTasks: number;
    staffCount: number;
  }>;
  hourlyCoverage: Array<{
    hour: string;
    scheduledStaff: number;
    availableStaff: number | null;
    requiredStaff: number | null;
  }>;
  statusDistribution: Array<{
    status: string;
    count: number;
    color: string;
  }>;
  dailyCompletions: Array<{
    date: string;
    completed: number;
    target: number;
  }>;
  employeeWorkloads: Array<{
    name: string;
    activeTasks: number;
    completedToday: number;
    avgCompletionMins: number | null;
  }>;
}

export interface StaffManagementKpis {
  totalEmployees: number;
  onDuty: number;
  availableStaff: number;
  busyStaff: number;
  pendingTasks: number;
  attendanceRatePct: number | null;
  checkedInCount: number;
  absentCount: number;
  onLeaveCount: number;
  scheduledNotCheckedIn?: number | null;
}

export interface StaffActivityLogItem {
  id: string;
  employeeId: string;
  timestamp: string;
  activityType: 'task_assigned' | 'task_completed' | 'shift_started' | 'shift_ended' | 'status_changed' | 'attendance_marked';
  description: string;
}

/* =========================================================================
   CUSTOMER PWA: SMART SHOPPING COMPANION INTERFACES
   ========================================================================= */

export interface CustomerShoppingItem {
  id: string;
  productId: string;
  productName: string;
  category: string;
  department: string;
  aisle: string;
  shelfCode: string;
  price: number;
  quantity: number;
  isCollected: boolean;
  addedAt: string;
  notes?: string;
}

export interface CustomerOffer {
  id: string;
  title: string;
  description: string;
  discountLabel: string;
  category: string;
  productId?: string;
  productName?: string;
  originalPrice?: number;
  offerPrice?: number;
  validUntil: string;
  couponCode?: string;
  bannerColor?: string;
  imageUrl?: string;
}

export type CustomerAssistanceCategory =
  | 'cannot_find_product'
  | 'product_unavailable'
  | 'checkout_assistance'
  | 'store_navigation'
  | 'product_location'
  | 'restock_request'
  | 'heavy_lifting'
  | 'sampling'
  | 'general_help';

export interface CustomerAssistanceRequest {
  id: string;
  storeId: string;
  category: CustomerAssistanceCategory;
  description: string;
  aisleOrZone?: string;
  productId?: string;
  productName?: string;
  customerContact?: string;
  status: 'submitted' | 'assigned' | 'in_progress' | 'resolved' | 'cancelled';
  assignedStaffName?: string;
  submittedAt: string;
  updatedAt: string;
  /** long random reference: the only way to read this request back from the server */
  statusRef?: string;
  statusLabel?: string;
  teamMemberAssigned?: boolean;
}

export interface StoreMapZone {
  id: string;
  name: string;
  type: 'aisle' | 'entrance' | 'exit' | 'checkout' | 'help_desk' | 'feature_zone';
  aisleNumber?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  shelfCodes: string[];
  description: string;
}

export interface CustomerStorePublic {
  id: string;
  code: string;
  name: string;
  branch: string;
  address: string;
  city: string;
  operatingHours: string;
  isOpen: boolean;
  phone: string;
  mapDimensions: { width: number; height: number };
  isDemo?: boolean;
}

export interface CustomerFeedbackPayload {
  storeId: string;
  experienceRating?: number;
  availabilityRating?: number;
  checkoutRating?: number;
  rating?: number;
  comment?: string;
  comments?: string;
  category?: string;
  timestamp?: string;
  submittedAt?: string;
}




