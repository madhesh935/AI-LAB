import type {
  AggregatedMovement,
  CustomerPath,
  DateRange,
  DwellTimeRecord,
  FootfallTrendPoint,
  PeakHourSlot,
  ShopperAnalyticsData,
  ShopperInsight,
  TimeOfDayFilter,
  ZoneMetrics,
} from '../../../types/retail';
import { arr, Dto, num, obj, str, strOrNull, timeAgo } from './common';

const DENSITY = (pct: number | null): ZoneMetrics['densityLevel'] | null => (pct === null ? null : pct >= 80 ? 'high' : pct >= 50 ? 'moderate' : 'low');

/** time-of-day filter applied to the hourly series ("07:00" labels, store local time) */
const WINDOWS: Record<TimeOfDayFilter, [number, number]> = { all_day: [0, 24], morning: [6, 12], afternoon: [12, 17], evening: [17, 24] };
const hourOf = (label: string): number | null => {
  const m = /^(\d{1,2})/.exec(label);
  return m ? Number(m[1]) : null;
};

export function adaptShopper(
  storeId: string,
  dateRange: DateRange,
  timeOfDay: TimeOfDayFilter,
  shopper: Dto,
  dwell: Dto,
  movement: Dto,
  geometry: Dto[],
  liveOccupancy: number | null = null,
): ShopperAnalyticsData {
  const meta = obj(shopper.meta);
  const measured = meta.dataState === 'available';
  const [from, to] = WINDOWS[timeOfDay];
  const allPoints = arr(shopper.hourlyTraffic);
  const points: FootfallTrendPoint[] = allPoints
    .filter((p) => {
      const h = hourOf(str(p.time));
      return h === null || (h >= from && h < to);
    })
    .map((p) => ({
      time: str(p.time),
      entries: num(p.entries) ?? 0,
      exits: num(p.exits) ?? 0,
      previousPeriodEntries: num(p.previousPeriodEntries),
      occupancy: num(p.occupancy),
      plotEntries: p.measured === false ? null : num(p.entries) ?? 0,
    }));

  const entries = points.reduce((a, p) => a + p.entries, 0);
  const exits = points.reduce((a, p) => a + p.exits, 0);
  const prevEntries = points.reduce((a, p) => a + (p.previousPeriodEntries ?? 0), 0);
  const hasPrev = points.some((p) => p.previousPeriodEntries !== null && p.previousPeriodEntries > 0);
  // The stored previous period may be DEMO history (a chart baseline), so no % change against it is ever reported.
  const changePct = null as number | null;
  void hasPrev;
  void prevEntries;

  const peak = points.reduce<FootfallTrendPoint | null>((best, p) => (p.entries > (best?.entries ?? -1) ? p : best), null);
  const lastOcc = [...points].reverse().find((p) => p.occupancy !== null)?.occupancy ?? null;

  const dwellItems = arr(dwell.items);
  const dwellByZone = new Map<string, Dto>(dwellItems.map((d) => [str(d.zoneId), d]));
  const geoById = new Map<string, Dto>(geometry.map((g) => [str(g.id), g]));
  const zones: ZoneMetrics[] = arr(shopper.zones).map((z) => {
    const occ = num(z.currentOccupancy);
    const cap = num(z.capacityLimit) ?? 0;
    const density = occ !== null && cap > 0 ? Math.min(100, Math.round((occ / cap) * 100)) : null;
    const d = dwellByZone.get(str(z.id));
    return {
      zoneId: str(z.id),
      zoneName: str(z.name),
      category: str(z.category),
      totalVisitors: num(z.visitors) ?? 0,
      currentOccupancy: occ,
      capacityLimit: cap,
      densityScore: density,
      densityLevel: DENSITY(density),
      avgDwellMinutes: num(d?.averageDwellMinutes) ?? num(z.dwellTimeMinutes),
      dwellChangePercentage: null,
      peakHour: null,
      peakVisitors: null,
      activityChangePercentage: null,
      monitoredByCameras: [],
      hourlyTrend: [],
      geometry: geoById.has(str(z.id))
        ? {
            x: num(geoById.get(str(z.id))?.x) ?? 0,
            y: num(geoById.get(str(z.id))?.y) ?? 0,
            width: num(geoById.get(str(z.id))?.width) ?? 0,
            height: num(geoById.get(str(z.id))?.height) ?? 0,
            color: str(geoById.get(str(z.id))?.color, '#3B82F6'),
          }
        : undefined,
    };
  });

  const totalVisits = zones.reduce((a, z) => a + z.totalVisitors, 0);
  const topZone = [...zones].sort((a, b) => b.totalVisitors - a.totalVisitors)[0];

  const dwellAnalytics: DwellTimeRecord[] = dwellItems.map((d) => ({
    zoneId: str(d.zoneId),
    zoneName: str(d.zoneName),
    avgDwellMinutes: num(d.averageDwellMinutes),
    benchmarkTargetMinutes: null,
    distribution: [],
    visitors: num(d.visitors) ?? 0,
  }));

  // Movement: only the aggregated zone-to-zone moves the backend actually recorded. No invented routes.
  const transitions = arr(movement.transitions);
  const totalTransitions = transitions.reduce((a, t) => a + (num(t.transitions) ?? 0), 0);
  const topPaths: CustomerPath[] = transitions.slice(0, 6).map((t, i) => ({
    id: `p${i + 1}`,
    pathName: `${str(t.fromName, str(t.fromZoneId))} → ${str(t.toName, str(t.toZoneId))}`,
    sequence: [str(t.fromZoneId), str(t.toZoneId)],
    frequencyPercentage: totalTransitions > 0 ? Math.round(((num(t.transitions) ?? 0) / totalTransitions) * 1000) / 10 : null,
    avgDurationMinutes: null,
    conversionRate: null,
  }));
  const movementPatterns: AggregatedMovement = {
    topPaths,
    transitions: transitions.map((t) => ({
      fromZone: str(t.fromZoneId),
      toZone: str(t.toZoneId),
      transitionCount: num(t.transitions) ?? 0,
      probability: totalTransitions > 0 ? (num(t.transitions) ?? 0) / totalTransitions : null,
    })),
    highEngagementZones: [],
    lowEngagementZones: [],
    bottleneckZones: [],
    scopeNote: strOrNull(movement.scope) ?? undefined,
  };

  const peakHourSlots: PeakHourSlot[] = points
    .filter((p) => p.entries > 0)
    .map((p) => {
      const ratio = peak && peak.entries ? p.entries / peak.entries : 0;
      return {
        hour: p.time,
        visitorVolume: p.entries,
        occupancyAvg: p.occupancy,
        status: ratio >= 0.9 ? 'peak' : ratio >= 0.6 ? 'busy' : ratio >= 0.3 ? 'normal' : 'quiet',
        recommendedStaff: null,
        activeStaff: null,
      };
    });

  // Descriptive observations computed from the data above only (no model-written advice).
  const insights: ShopperInsight[] = [];
  if (peak && peak.entries > 0) {
    insights.push({
      id: 'obs-peak',
      title: `Busiest hour: ${peak.time}`,
      description: `${peak.entries} entries were counted in the hour starting ${peak.time}.`,
      type: 'traffic',
      importance: 'info',
      metricImpact: `${peak.entries} entries`,
      suggestedAction: '',
    });
  }
  if (topZone && topZone.totalVisitors > 0 && totalVisits > 0) {
    insights.push({
      id: 'obs-zone',
      title: `Most visited zone: ${topZone.zoneName}`,
      description: `${topZone.totalVisitors} of ${totalVisits} zone visits (${Math.round((topZone.totalVisitors / totalVisits) * 100)}%).`,
      type: 'traffic',
      importance: 'info',
      metricImpact: `${topZone.totalVisitors} visits`,
      suggestedAction: '',
      zoneId: topZone.zoneId,
    });
  }

  const daily = new Map<string, { entries: number; exits: number; prev: number }>();
  if (dateRange !== 'today' && dateRange !== 'yesterday') {
    allPoints.forEach((p) => {
      const key = str(p.bucketStart).slice(0, 10) || str(p.time);
      const row = daily.get(key) ?? { entries: 0, exits: 0, prev: 0 };
      row.entries += num(p.entries) ?? 0;
      row.exits += num(p.exits) ?? 0;
      row.prev += num(p.previousPeriodEntries) ?? 0;
      daily.set(key, row);
    });
  }

  return {
    storeId,
    dateRange,
    timeOfDay,
    kpis: {
      totalEntries: measured ? entries : null,
      totalEntriesMeasured: measured,
      entriesChangePct: changePct,
      totalExits: measured ? exits : null,
      totalExitsMeasured: measured,
      exitsChangePct: null,
      currentOccupancy: dateRange === 'today' ? liveOccupancy ?? lastOcc : lastOcc,
      occupancyChangePct: null,
      avgDwellTimeMinutes: num(dwell.averageDwellMinutes) ?? num(shopper.averageVisitDurationMinutes),
      dwellChangePct: null,
      busiestHour: peak && peak.entries > 0 ? peak.time : null,
      busiestHourVolume: peak && peak.entries > 0 ? peak.entries : null,
      mostVisitedZone: topZone && topZone.totalVisitors > 0 ? topZone.zoneName : null,
      mostVisitedZoneSharePct: topZone && totalVisits > 0 ? Math.round((topZone.totalVisitors / totalVisits) * 100) : null,
    },
    footfallTrend: points,
    dailyAggregation: [...daily.entries()].sort().map(([day, r]) => ({ day, entries: r.entries, exits: r.exits, prevWeekEntries: r.prev || null })),
    weeklyAggregation: [],
    zones,
    dwellAnalytics,
    movementPatterns,
    peakHourSlots,
    insights,
    lastCalculated: meta.lastObservationAt ? timeAgo(meta.lastObservationAt) : 'No observation yet',
    dataState: (meta.dataState as ShopperAnalyticsData['dataState']) ?? 'unavailable',
    dataNote: strOrNull(meta.note) ?? undefined,
  };
}
