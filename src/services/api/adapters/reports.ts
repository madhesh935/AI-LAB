import type { ComparePeriod, DateRange, ReportSummaryData } from '../../../types/retail';
import { arr, Dto, obj, str } from './common';

/**
 * GET /reports/summary/full already emits the ReportSummaryData shape (the backend builds it from stored records only).
 * This only guarantees every section/array exists so the tabs never crash on a partial response; values the backend could
 * not measure stay null and the tabs render them as "—".
 */
export function adaptReport(storeId: string, dateRange: DateRange, compare: ComparePeriod, dto: Dto): ReportSummaryData {
  const o = obj(dto.overview);
  const s = obj(dto.shoppers);
  const i = obj(dto.inventory);
  const q = obj(dto.queues);
  const op = obj(dto.operations);
  return {
    storeId,
    storeName: str(dto.storeName),
    dateRange,
    comparePeriod: compare,
    generatedAt: str(dto.generatedAt),
    overview: {
      kpis: obj(o.kpis) as ReportSummaryData['overview']['kpis'],
      multiMetricTrends: arr(o.multiMetricTrends) as ReportSummaryData['overview']['multiMetricTrends'],
      keyTrendsSummary: arr<string>(o.keyTrendsSummary),
      historicalInsights: arr(o.historicalInsights) as ReportSummaryData['overview']['historicalInsights'],
    },
    shoppers: {
      hourlyTrends: arr(s.hourlyTrends),
      dailyFootfall: arr(s.dailyFootfall),
      zoneDistribution: arr(s.zoneDistribution),
      peakShoppingPeriods: arr(s.peakShoppingPeriods),
      footfallComparisonSummary: obj(s.footfallComparisonSummary),
    } as ReportSummaryData['shoppers'],
    inventory: {
      historyTimeline: arr(i.historyTimeline),
      depletedShelves: arr(i.depletedShelves),
      departmentShortages: arr(i.departmentShortages),
      replenishmentTaskStats: obj(i.replenishmentTaskStats),
      stockoutLog: arr(i.stockoutLog),
    } as ReportSummaryData['inventory'],
    queues: {
      historyTimeline: arr(q.historyTimeline),
      hourlyQueueTrends: arr(q.hourlyQueueTrends),
      counterComparisons: arr(q.counterComparisons),
      queueAlertLog: arr(q.queueAlertLog),
      overallThroughputSummary: obj(q.overallThroughputSummary),
    } as ReportSummaryData['queues'],
    operations: {
      historyTimeline: arr(op.historyTimeline),
      cameraUptimeList: arr(op.cameraUptimeList),
      incidentCategoryBreakdown: arr(op.incidentCategoryBreakdown),
      staffEfficiencySummary: arr(op.staffEfficiencySummary),
      operationsEventLog: arr(op.operationsEventLog),
      overallOperationsSummary: obj(op.overallOperationsSummary),
    } as ReportSummaryData['operations'],
    dataState: (obj(dto.meta).dataState as ReportSummaryData['dataState']) ?? 'unavailable',
    dataNote: str(obj(dto.meta).note) || undefined,
    dataMode: dto.dataMode === 'demo' ? 'demo' : 'real',
    unavailableFields: arr<string>(dto.unavailableFields),
  };
}
