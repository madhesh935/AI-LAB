import type { CameraDetectionEvent, CameraEventCategory, CameraFeed, LiveCamerasData } from '../../../types/retail';
import { arr, Dto, num, obj, str, strOrNull, timeAgo } from './common';
import { adaptCamera } from './overview';

const CATEGORIES: CameraEventCategory[] = ['footfall', 'shelf_gap', 'queue', 'dwell', 'offline', 'motion'];

export function adaptCameraEvent(e: Dto): CameraDetectionEvent {
  return {
    id: str(e.id),
    cameraId: str(e.cameraId),
    cameraCode: str(e.cameraCode, '—'),
    cameraName: str(e.cameraName, '—'),
    zone: str(e.zone, '—'),
    title: str(e.title),
    description: str(e.description),
    timestamp: timeAgo(e.occurredAt),
    occurredAt: strOrNull(e.occurredAt) ?? undefined,
    severity: e.severity === 'critical' || e.severity === 'warning' ? e.severity : 'info',
    category: CATEGORIES.includes(e.category) ? e.category : 'motion',
    detectionCount: num(e.detectionCount) ?? undefined,
  };
}

export function adaptLiveCameras(storeId: string, dto: Dto, timeline: Dto[], activeAlerts: number): LiveCamerasData {
  const cameras: CameraFeed[] = arr(dto.cameras).map(adaptCamera);
  const k = obj(dto.kpis);
  const meta = obj(dto.meta);
  const events = timeline.map(adaptCameraEvent);
  const lats = cameras.map((c) => c.latencyMs).filter((x): x is number => typeof x === 'number');
  return {
    storeId,
    cameras,
    events,
    kpis: {
      totalCameras: num(k.total) ?? cameras.length,
      connectedCameras: num(k.live) ?? 0,
      offlineCameras: num(k.offline) ?? 0,
      aiEnabledCameras: cameras.filter((c) => !!c.aiModule && c.status === 'live').length,
      activeAlerts,
      latestDetectionTime: events[0]?.timestamp ?? null,
      avgLatencyMs: lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : null,
      averageFps: num(k.averageFps),
    },
    lastUpdated: meta.lastObservationAt ? timeAgo(meta.lastObservationAt) : 'No frames received',
    dataState: (meta.dataState as LiveCamerasData['dataState']) ?? 'unavailable',
    dataNote: strOrNull(meta.note) ?? undefined,
  };
}
