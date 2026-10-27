import type {
  CameraFeed,
  CheckoutCounter,
  DateRange,
  QueueAlert,
  QueueCongestionForecast,
  QueueCongestionSeverity,
  QueueHistoricalAnalytics,
  QueueIntelligenceData,
  QueueRulesConfig,
  StaffingRecommendation,
  StoreStaff,
} from '../../../types/retail';
import { arr, clock, Dto, initials, num, obj, parseIso, str, strOrNull, timeAgo } from './common';
import { adaptAlert } from './overview';

const LEVELS: QueueCongestionSeverity[] = ['optimal', 'moderate', 'high', 'critical'];
const level = (v: unknown): QueueCongestionSeverity => (LEVELS.includes(v as QueueCongestionSeverity) ? (v as QueueCongestionSeverity) : 'optimal');

export function rulesFromApi(r: Dto): QueueRulesConfig {
  return {
    maxPreferredQueueLength: num(r.maxQueueLength) ?? 5,
    slaWarningWaitMinutes: num(r.slaWarningWaitMinutes) ?? 3,
    slaCriticalWaitMinutes: num(r.slaCriticalWaitMinutes) ?? 4.5,
    assumedServiceRatePerMin: null,
    forecastHorizonMinutes: ([5, 10, 15, 30] as const).includes(r.forecastHorizonMinutes) ? r.forecastHorizonMinutes : 15,
    autoAlertTriggers: r.autoDispatch === true,
    expressItemLimit: num(r.expressCartLimit) ?? 10,
  };
}

export function rulesToApi(c: QueueRulesConfig): Dto {
  return {
    maxQueueLength: c.maxPreferredQueueLength,
    slaWarningWaitMinutes: c.slaWarningWaitMinutes,
    slaCriticalWaitMinutes: c.slaCriticalWaitMinutes,
    expressCartLimit: c.expressItemLimit,
    forecastHorizonMinutes: c.forecastHorizonMinutes,
    autoDispatch: c.autoAlertTriggers,
  };
}

function adaptCounter(c: Dto, cameras: CameraFeed[], rules: QueueRulesConfig, history: Dto[], staff: Dto[]): CheckoutCounter {
  const cam = cameras.find((f) => f.id === c.cameraId);
  const mine = history.filter((p) => p.counterId === c.id);
  const cashier = staff.find((s) => s.name === c.cashierName);
  const status = ['open', 'closed', 'standby', 'paused'].includes(c.status) ? c.status : 'closed';
  return {
    id: str(c.id),
    counterCode: str(c.id).toUpperCase(),
    counterName: str(c.name),
    type: ['express', 'standard', 'self_checkout'].includes(c.counterType) ? c.counterType : 'standard',
    section: str(c.counterType) === 'express' ? 'Express' : 'Main',
    status,
    cashierId: cashier ? str(cashier.id) : undefined,
    cashierName: str(c.cashierName, 'Unstaffed'),
    cashierRole: cashier ? str(cashier.roleLabel) : undefined,
    cashierAvatar: c.cashierName ? initials(str(c.cashierName)) : undefined,
    customersWaiting: num(c.waitingCustomers),
    estimatedWaitMinutes: num(c.estimatedWaitMinutes),
    arrivalRatePerMin: null,
    serviceRatePerMin: num(c.serviceRatePerMin),
    utilizationPct: null,
    avgItemsPerCustomer: num(c.avgItemsPerCustomer),
    congestionLevel: level(c.congestion),
    slaThresholdMinutes: rules.slaCriticalWaitMinutes,
    monitoredByCamId: cam?.cameraCode ?? str(c.cameraId, '—'),
    lastUpdated: c.lastObservationAt ? timeAgo(c.lastObservationAt) : 'No observation yet',
    hourlyThroughput: null,
    totalProcessedToday: null,
    scanningSpeedItemsPerMin: null,
    idleTimePercentage: null,
    historicalWaitToday: mine
      .filter((p) => num(p.waitSeconds) !== null)
      .map((p) => ({ time: clock(p.at), waitMinutes: Math.round(((num(p.waitSeconds) ?? 0) / 60) * 10) / 10, queueLength: num(p.length) ?? 0 })),
  };
}

function adaptForecast(counters: CheckoutCounter[], forecast: Dto[], rules: QueueRulesConfig): QueueCongestionForecast[] {
  return counters
    .map((c) => {
      const pts = forecast.filter((f) => f.counterId === c.id).sort((a, b) => (num(a.horizonMinutes) ?? 0) - (num(b.horizonMinutes) ?? 0));
      if (!pts.length) return null;
      const base = c.customersWaiting ?? 0;
      const worst = Math.max(...pts.map((p) => num(p.predictedLength) ?? 0));
      return {
        counterId: c.id,
        counterName: c.counterName,
        currentQueue: c.customersWaiting,
        arrivalRate: c.arrivalRatePerMin,
        serviceRate: c.serviceRatePerMin,
        congestionRiskPct: rules.maxPreferredQueueLength > 0 ? Math.min(100, Math.round((worst / rules.maxPreferredQueueLength) * 100)) : null,
        timeToSlaBreachMinutes: null,
        forecastPoints: [
          { timestamp: 'Now', timeLabel: 'Now', currentBaseline: base, predictedLength: base, upperConfidence: null, lowerConfidence: null, riskLevel: 'low', breachesSla: false } as QueueCongestionForecast['forecastPoints'][number],
          ...pts.map((p) => {
          const len = num(p.predictedLength) ?? 0;
          const ratio = rules.maxPreferredQueueLength > 0 ? len / rules.maxPreferredQueueLength : 0;
          const m = num(p.horizonMinutes) ?? 0;
          const at = parseIso(p.generatedAt);
          return {
            timestamp: `+${m}m`,
            timeLabel: at ? clock(new Date(at.getTime() + m * 60000).toISOString()) : `+${m}m`,
            currentBaseline: base,
            predictedLength: len,
            upperConfidence: null,
            lowerConfidence: null,
            riskLevel: ratio >= 1.5 ? 'critical' : ratio >= 1 ? 'high' : ratio >= 0.6 ? 'medium' : 'low',
            breachesSla: len > rules.maxPreferredQueueLength,
          } as QueueCongestionForecast['forecastPoints'][number];
          }),
        ],
      } as QueueCongestionForecast;
    })
    .filter((f): f is QueueCongestionForecast => f !== null);
}

function adaptQueueAlert(a: Dto, counters: CheckoutCounter[]): QueueAlert {
  const base = adaptAlert(a);
  const counter = counters.find((c) => c.id === a.counterId);
  return {
    id: base.id,
    alertCode: base.id,
    title: base.title,
    counterId: str(a.counterId),
    counterName: counter?.counterName ?? str(a.counterId, '—'),
    severity: base.severity,
    condition: 'sla_breach',
    metricTriggered: base.description,
    threshold: '',
    timestamp: base.timestamp,
    status: base.status,
    suggestedAction: base.recommendedAction,
  };
}

function adaptRecommendation(r: Dto, alerts: Dto[], counters: CheckoutCounter[]): StaffingRecommendation {
  const alert = alerts.find((a) => a.id === r.sourceAlertId);
  const counter = counters.find((c) => c.id === alert?.counterId);
  const status = r.status === 'accepted' ? 'deployed' : r.status === 'rejected' ? 'dismissed' : 'pending';
  return {
    id: str(r.id),
    type: 'open_counter',
    title: str(r.title),
    recommendationText: str(r.recommendedAction),
    reason: str(r.reason),
    sourceMetrics: {
      currentWait: counter?.estimatedWaitMinutes ?? null,
      projectedWait: null,
      queueSize: counter?.customersWaiting ?? null,
    },
    expectedOutcome: '',
    targetCounterId: counter?.id ?? str(alert?.counterId),
    targetCounterName: counter?.counterName ?? '—',
    suggestedStaffId: str(r.suggestedEmployeeId),
    suggestedStaffName: str(r.suggestedEmployeeName, 'No eligible staff on duty'),
    suggestedStaffRole: '',
    priority: r.priority === 'critical' || r.priority === 'high' ? r.priority : 'medium',
    timestamp: alert?.createdAt ? timeAgo(alert.createdAt) : '',
    status,
  };
}

function adaptHistorical(points: Dto[], counters: CheckoutCounter[]): QueueHistoricalAnalytics {
  const byHour = new Map<string, Dto[]>();
  points.forEach((p) => {
    const h = clock(p.at).slice(0, 2) + ':00';
    byHour.set(h, [...(byHour.get(h) ?? []), p]);
  });
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const waits = (rows: Dto[]) => rows.map((r) => num(r.waitSeconds)).filter((w): w is number => w !== null).map((w) => w / 60);
  const hourly = [...byHour.entries()].sort().map(([hour, rows]) => ({
    hour,
    avgWaitMinutes: avg(waits(rows)),
    totalWaiting: avg(rows.map((r) => num(r.length) ?? 0)),
    throughput: null,
    counter1Wait: avg(waits(rows.filter((r) => r.counterId === counters[0]?.id))),
    counter2Wait: avg(waits(rows.filter((r) => r.counterId === counters[1]?.id))),
    counter3Wait: avg(waits(rows.filter((r) => r.counterId === counters[2]?.id))),
    counter4Wait: avg(waits(rows.filter((r) => r.counterId === counters[3]?.id))),
  }));
  const all = waits(points);
  const buckets: [string, (m: number) => boolean][] = [
    ['< 2 min', (m) => m < 2],
    ['2 - 4 min', (m) => m >= 2 && m < 4],
    ['4 - 6 min', (m) => m >= 4 && m < 6],
    ['6+ min', (m) => m >= 6],
  ];
  return {
    hourlyQueueData: hourly,
    hourlyThroughput: [],
    waitTimeDistribution: all.length
      ? buckets.map(([range, f]) => {
          const count = all.filter(f).length;
          return { range, count, percentage: Math.round((count / all.length) * 100) };
        })
      : [],
    serviceSpeedVsItems: [],
  };
}

export function adaptQueue(
  storeId: string,
  dateRange: DateRange,
  section: string,
  q: Dto,
  history: Dto[],
  recs: Dto[],
  staff: Dto[],
  cameras: CameraFeed[],
): QueueIntelligenceData {
  const rules = rulesFromApi(obj(q.rules));
  const counters = arr(q.counters)
    .map((c) => adaptCounter(c, cameras, rules, history, staff))
    .filter((c) => section === 'all' || c.section.toLowerCase() === section.toLowerCase() || c.type === section);
  const k = obj(q.kpis);
  const longest = [...counters].sort((a, b) => (b.customersWaiting ?? -1) - (a.customersWaiting ?? -1))[0];
  const checkoutCams = cameras.filter((c) => c.type === 'checkout');
  const meta = obj(q.meta);
  const alerts = arr(q.alerts);
  const totalWaiting = num(k.customersWaiting);
  return {
    storeId,
    dateRange,
    checkoutSection: section,
    kpis: {
      activeCounters: num(k.activeCounters) ?? 0,
      totalCounters: num(k.totalCounters) ?? 0,
      waitingCustomers: totalWaiting,
      avgWaitMinutes: num(k.averageWaitMinutes),
      avgWaitMinutesTrend: null,
      longestQueueCounter: longest && (longest.customersWaiting ?? 0) > 0 ? longest.counterName : null,
      longestQueueLength: longest ? longest.customersWaiting : null,
      longestQueueWaitMinutes: num(k.longestWaitMinutes),
      hourlyThroughput: null,
      throughputTrendPct: null,
      congestedCountersCount: num(k.congestedCounters) ?? 0,
    },
    counters,
    cameraFeed: checkoutCams[0] ?? cameras[0] ?? null,
    cameraFeedsList: checkoutCams.length ? checkoutCams : cameras,
    forecast: adaptForecast(counters, arr(q.forecast), rules),
    staffingRecommendations: recs.filter((r) => r.kind === 'checkout_assistance').map((r) => adaptRecommendation(r, alerts, counters)),
    queueAlerts: alerts.map((a) => adaptQueueAlert(a, counters)),
    historicalAnalytics: adaptHistorical(history, counters),
    rulesConfig: rules,
    availableStaff: staff.map(
      (e): StoreStaff => ({
        id: str(e.id),
        name: str(e.name),
        role: str(e.roleLabel, str(e.role)),
        avatar: initials(str(e.name)),
        activeTasksCount: num(e.activeTasksCount) ?? 0,
        status: e.availability === 'busy' ? 'busy' : e.availability === 'available' ? 'available' : 'off_shift',
      }),
    ),
    lastUpdated: meta.lastObservationAt ? timeAgo(meta.lastObservationAt) : 'No observation yet',
    dataState: (meta.dataState as QueueIntelligenceData['dataState']) ?? 'unavailable',
    dataNote: strOrNull(meta.note) ?? undefined,
  };
}
