import type { AiInsightsData, DateRange, InsightActionStatus, InsightCategory, OperationalInsight, RetailOpportunity, SupportingEvidence } from '../../../types/retail';
import { arr, Dto, num, obj, str, strOrNull, timeAgo } from './common';

const CATEGORIES: InsightCategory[] = ['shopper_analytics', 'inventory', 'queue_intelligence', 'operational_efficiency', 'camera_health'];
const STATUSES: InsightActionStatus[] = ['pending', 'in_progress', 'completed', 'dismissed'];

const MODULE_LINKS: Record<InsightCategory, [string, string]> = {
  shopper_analytics: ['/shopper-analytics', 'Shopper Analytics'],
  inventory: ['/smart-inventory', 'Smart Inventory'],
  queue_intelligence: ['/queue-intelligence', 'Queue Intelligence'],
  operational_efficiency: ['/staff-management', 'Staff Management'],
  camera_health: ['/', 'Live Cameras'],
};

function adaptEvidence(i: Dto, category: InsightCategory): SupportingEvidence {
  const e = obj(i.evidence);
  const [url, name] = MODULE_LINKS[category];
  return {
    observedStatement: str(e.observedStatement, str(i.summary)),
    dataSource: str(e.dataSource, str(i.source) === 'demo' ? 'Seeded demo fixture' : 'Stored observations'),
    timeWindow: str(e.timeWindow, '—'),
    metricsTable: arr(e.metricsTable).map((m) => ({
      metric: str(m.metric),
      measuredValue: str(m.measuredValue),
      targetThreshold: str(m.targetThreshold, '—'),
      variance: str(m.variance, '—'),
    })),
    triggerRule: str(e.triggerRule, '—'),
    riskAnalysis: str(e.riskAnalysis, ''),
    confidenceReliability: str(e.confidenceReliability, ''),
    relatedModuleUrl: str(e.relatedModuleUrl, url),
    relatedModuleName: str(e.relatedModuleName, name),
  };
}

export function adaptInsight(i: Dto): OperationalInsight {
  const category = CATEGORIES.includes(i.category) ? (i.category as InsightCategory) : 'operational_efficiency';
  return {
    id: str(i.id),
    code: str(i.code, str(i.id)),
    title: str(i.title),
    category,
    severity: i.severity === 'critical' || i.severity === 'warning' ? i.severity : 'info',
    status: STATUSES.includes(i.status) ? i.status : 'pending',
    zone: str(i.zone, '—'),
    timestamp: i.createdAt ? timeAgo(i.createdAt) : str(i.timestamp),
    summary: str(i.summary),
    explanation: str(i.explanation, ''),
    recommendedAction: str(i.recommendedAction, ''),
    evidence: adaptEvidence(i, category),
    assignedStaffId: strOrNull(i.assignedEmployeeId) ?? undefined,
    assignedStaffName: strOrNull(i.assignedEmployeeName) ?? undefined,
    completedAt: strOrNull(i.completedAt) ?? undefined,
    dismissedReason: strOrNull(i.dismissedReason) ?? undefined,
    taskId: strOrNull(i.taskId) ?? undefined,
    source: strOrNull(i.source) ?? undefined,
  };
}

export function adaptInsights(storeId: string, dateRange: DateRange, dto: Dto): AiInsightsData {
  const insights = arr(dto.insights).map(adaptInsight);
  const k = obj(dto.kpis);
  const meta = obj(dto.meta);
  const fc = obj(dto.footfallForecast);
  return {
    storeId,
    dateRange,
    kpis: {
      activeInsights: num(k.activeInsights) ?? 0,
      criticalIssues: num(k.criticalIssues) ?? 0,
      pendingActions: num(k.pendingActions) ?? 0,
      completedRecommendations: num(k.completedRecommendations) ?? 0,
      inventoryRiskAlerts: insights.filter((i) => i.category === 'inventory' && i.status !== 'dismissed' && i.status !== 'completed').length,
      queueCongestionRisk: insights.filter((i) => i.category === 'queue_intelligence' && i.status !== 'dismissed' && i.status !== 'completed').length,
    },
    insights,
    // No forecasting model exists until >= 14 days of real counts are available; the backend reports how much history there is.
    footfallForecast: fc.available === true
      ? {
          horizon: 'today',
          modelName: str(fc.modelName),
          generationTime: str(fc.generationTime),
          projectedTotalVolume: num(fc.projectedTotalVolume) ?? 0,
          peakHour: str(fc.peakHour),
          peakVolume: num(fc.peakVolume) ?? 0,
          historicalReliabilityMae: num(fc.historicalReliabilityMae),
          daysUsed: num(fc.daysUsed) ?? undefined,
          includesDemoHistory: fc.includesDemoHistory === true,
          methodNote: str(fc.method, ''),
          points: arr(fc.points).map((p) => ({
            hour: str(p.hour),
            actualTraffic: num(p.actualTraffic),
            forecastTraffic: num(p.forecastTraffic) ?? 0,
            upperConfidence: num(p.upperConfidence) ?? 0,
            lowerConfidence: num(p.lowerConfidence) ?? 0,
            isPeakHour: p.isPeakHour === true,
            isFuture: p.isFuture === true,
          })),
        }
      : null,
    footfallStatus: fc.reason
      ? { reason: str(fc.reason), daysOfHistory: num(fc.daysOfHistory) ?? 0, requiredDays: num(fc.requiredDays) ?? 14, hourlyBuckets: num(fc.hourlyBuckets) ?? 0, observedHourly: arr(fc.observedHourly).map((p) => ({ hour: str(p.hour), entries: num(p.entries) ?? 0 })) }
      : null,
    opportunities: arr(dto.opportunities).map((o): RetailOpportunity => ({
      id: str(o.id), title: str(o.title), zone: str(o.zone, '—'),
      type: ['high_traffic', 'bottleneck', 'promotion', 'cold_spot', 'shelf_velocity'].includes(o.type) ? o.type : 'high_traffic',
      metricLabel: str(o.metricLabel), metricValue: str(o.metricValue), observation: str(o.observation), opportunityNote: str(o.opportunityNote),
      actionLabel: str(o.actionLabel, 'Open'), targetUrl: str(o.targetUrl, '/'),
    })),
    lastUpdated: meta.lastObservationAt ? timeAgo(meta.lastObservationAt) : insights[0]?.timestamp ?? 'No insights yet',
    dataState: (meta.dataState as AiInsightsData['dataState']) ?? 'unavailable',
    dataNote: strOrNull(meta.note) ?? undefined,
  };
}
