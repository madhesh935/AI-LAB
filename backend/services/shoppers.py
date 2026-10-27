from __future__ import annotations

from datetime import timedelta
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from repositories.telemetry import ShopperRepository
from schemas.common import Meta
from schemas.monitoring import (
    DwellOut,
    DwellRecordOut,
    FootfallOut,
    FootfallPointOut,
    ShopperAnalyticsOut,
    ZoneActivityOut,
    ZoneOut,
)
from services.common import TimeWindow, congestion_level, get_store_or_404, pct_change, resolve_window, store_tz


class ShopperService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = ShopperRepository(db)

    # ------------------------------------------------------------ footfall
    def _points(self, store, window: TimeWindow) -> List[FootfallPointOut]:
        tz = store_tz(store)
        current = self.repo.hourly(store.id, window.start, window.end)
        previous = self.repo.hourly(store.id, window.previous_start, window.previous_end)
        # previous period keyed by offset from its own start so hours line up
        prev_by_offset = {int((k - window.previous_start).total_seconds() // 3600): v[0] for k, v in previous.items()}

        points: List[FootfallPointOut] = []
        running = 0
        for bucket in sorted(current):
            entries, exits = current[bucket]
            running = max(0, running + entries - exits)
            offset = int((bucket - window.start).total_seconds() // 3600)
            points.append(
                FootfallPointOut(
                    time=bucket.astimezone(tz).strftime("%H:%M"),
                    bucket_start=bucket,
                    entries=entries,
                    exits=exits,
                    previous_period_entries=prev_by_offset.get(offset, 0),
                    occupancy=running,
                )
            )
        if (window.end - window.start) <= timedelta(days=1):
            # Hours that exist in the stored previous period but have no count today: keep them on the axis so the baseline graph is complete.
            have = {p.bucket_start for p in points}
            for offset, prev in sorted(prev_by_offset.items()):
                bucket = window.start + timedelta(hours=offset)
                if bucket in have or not (0 <= offset < 24):
                    continue
                points.append(FootfallPointOut(time=bucket.astimezone(tz).strftime("%H:%M"), bucket_start=bucket, entries=0, exits=0, previous_period_entries=prev,
                                               occupancy=None, measured=False))
            points.sort(key=lambda x: x.bucket_start)
        return points

    def footfall(self, store_id: str, range_key: str = "today") -> FootfallOut:
        store = get_store_or_404(self.db, store_id)
        window = resolve_window(store, range_key)
        points = self._points(store, window)
        total_in = sum(p.entries for p in points)
        total_out = sum(p.exits for p in points)
        prev_total = sum(p.previous_period_entries for p in points)
        return FootfallOut(
            store_id=store_id,
            range=window.label,
            points=points,
            total_entries=total_in,
            total_exits=total_out,
            change_percentage=self._real_change(store_id, window, total_in, prev_total),
            meta=self._meta(store_id, bool(points)),
        )

    def _real_change(self, store_id: str, window: TimeWindow, total_in: int, prev_total: int) -> Optional[float]:
        """% change vs the previous period - only against CAMERA-counted history. DEMO history rows are a chart baseline, never a comparison for a real count."""
        from sqlalchemy import func, select

        from database.models import FootfallAggregate

        prev_cv = self.db.scalar(select(func.sum(FootfallAggregate.entries)).where(FootfallAggregate.store_id == store_id).where(FootfallAggregate.bucket_minutes == 60)
                                 .where(FootfallAggregate.source == "cv").where(FootfallAggregate.bucket_start >= window.previous_start).where(FootfallAggregate.bucket_start < window.previous_end))
        if not prev_cv:
            return None
        return pct_change(total_in, int(prev_cv))

    # --------------------------------------------------------------- zones
    def zone_activity(self, store_id: str, range_key: str = "today") -> List[ZoneActivityOut]:
        store = get_store_or_404(self.db, store_id)
        window = resolve_window(store, range_key)
        occupancy = self.repo.latest_zone_occupancy(store_id)
        dwell = self.repo.dwell(store_id, window.start, window.end)
        out: List[ZoneActivityOut] = []
        for zone in self.repo.zones(store_id):
            occ = occupancy.get(zone.id)
            visitors, avg_seconds = dwell.get(zone.id, (0, 0.0))
            fill = (occ[0] / zone.capacity_limit) if occ and zone.capacity_limit else 0
            level = "critical" if fill >= 0.95 else "high" if fill >= 0.8 else "moderate" if fill >= 0.6 else "optimal"
            out.append(
                ZoneActivityOut(
                    id=zone.id,
                    name=zone.name,
                    category=zone.category,
                    current_occupancy=occ[0] if occ else None,
                    capacity_limit=zone.capacity_limit,
                    dwell_time_minutes=round(avg_seconds / 60, 1) if visitors else None,
                    visitors=visitors,
                    congestion_level=level,
                )
            )
        return out

    def zones_with_metrics(self, store_id: str, range_key: str = "today") -> List[ZoneOut]:
        activity = {z.id: z for z in self.zone_activity(store_id, range_key)}
        result: List[ZoneOut] = []
        for zone in self.repo.zones(store_id):
            act = activity.get(zone.id)
            result.append(
                ZoneOut(
                    id=zone.id,
                    name=zone.name,
                    zone_type=zone.zone_type,
                    category=zone.category,
                    aisle_number=zone.aisle_number,
                    x=zone.x,
                    y=zone.y,
                    width=zone.width,
                    height=zone.height,
                    color=zone.color,
                    capacity_limit=zone.capacity_limit,
                    shelf_codes=list(zone.shelf_codes or []),
                    description=zone.description,
                    current_occupancy=act.current_occupancy if act else None,
                    dwell_time_minutes=act.dwell_time_minutes if act else None,
                )
            )
        return result

    def dwell(self, store_id: str, range_key: str = "today") -> DwellOut:
        store = get_store_or_404(self.db, store_id)
        window = resolve_window(store, range_key)
        raw = self.repo.dwell(store_id, window.start, window.end)
        zones = {z.id: z for z in self.repo.zones(store_id)}
        items = [
            DwellRecordOut(zone_id=zid, zone_name=zones[zid].name if zid in zones else zid, visitors=v, average_dwell_minutes=round(sec / 60, 1))
            for zid, (v, sec) in raw.items()
        ]
        total_visitors = sum(i.visitors for i in items)
        overall = (
            round(sum(i.visitors * i.average_dwell_minutes for i in items) / total_visitors, 1) if total_visitors else None
        )
        return DwellOut(store_id=store_id, range=window.label, items=items, average_dwell_minutes=overall, meta=self._meta(store_id, bool(items), "dwell_time_aggregates"))

    # ------------------------------------------------------------- bundle
    def analytics(self, store_id: str, range_key: str = "today", time_of_day: str = "all_day") -> ShopperAnalyticsOut:
        store = get_store_or_404(self.db, store_id)
        window = resolve_window(store, range_key)
        points = self._points(store, window)
        if time_of_day and time_of_day != "all_day":
            span = {"morning": (6, 12), "afternoon": (12, 17), "evening": (17, 24)}.get(time_of_day)
            if span:
                points = [p for p in points if span[0] <= int(p.time[:2]) < span[1]]

        peak = max(points, key=lambda p: p.entries, default=None)
        dwell = self.dwell(store_id, range_key)
        movements = [
            {"fromZoneId": a, "toZoneId": b, "transitions": n}
            for a, b, n in self.repo.movements(store_id, window.start, window.end)
        ]
        return ShopperAnalyticsOut(
            store_id=store_id,
            range=window.label,
            hourly_traffic=points,
            total_entries=sum(p.entries for p in points),
            total_exits=sum(p.exits for p in points),
            peak_hour=peak.time if peak and peak.entries else None,
            peak_hour_entries=peak.entries if peak else 0,
            average_visit_duration_minutes=dwell.average_dwell_minutes,
            zones=self.zone_activity(store_id, range_key),
            movements=movements,
            meta=self._meta(store_id, bool(points)),
        )

    def _meta(self, store_id: str, has_rows: bool, source: str = "footfall") -> Meta:
        latest = self.repo.latest_footfall_at(store_id)
        if latest is None and not has_rows:
            return Meta(data_state="unavailable", note="No footfall has been reported by the vision pipeline yet.")
        if not has_rows:
            return Meta(data_state="empty", last_observation_at=latest, note="No observations in the selected range.", sources=[source])
        return Meta(data_state="available", last_observation_at=latest, sources=[source])
