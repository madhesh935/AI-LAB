"""Historical reports in the exact shape the Reports & Analytics page consumes (ReportSummaryData), derived ONLY from stored records.

Anything that cannot be measured from the data this platform records is returned as null (never a made-up number) and is named in
`unavailableFields`, e.g. shopper bounce rate (no definition of a 'bounce' is recorded) or counter utilisation.
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database.models import (
    Alert, Camera, CameraStatusEvent, CheckoutCounter, DwellTimeAggregate, Employee, Insight, QueueObservation, QueueServiceSample, Shelf,
    ShelfObservation, Store, StoreZone, Task, TaskHistory, Product,
)
from repositories.telemetry import ShopperRepository
from services.common import TimeWindow, get_store_or_404, now_utc, pct_change, resolve_window, store_tz

UNAVAILABLE = ["shoppers.dailyFootfall[].bounceRateEstimatedPct", "queues.counterComparisons[].utilizationPct"]


def _avg(xs: List[float]) -> Optional[float]:
    return round(sum(xs) / len(xs), 1) if xs else None


def _mins(a: Optional[datetime], b: Optional[datetime]) -> Optional[float]:
    return round((b - a).total_seconds() / 60, 1) if a and b and b >= a else None


class ReportBuilder:
    def __init__(self, db: Session):
        self.db = db

    # ------------------------------------------------------------------ helpers
    def _buckets(self, store: Store, w: TimeWindow) -> Tuple[str, List[datetime]]:
        """('hour'|'day', bucket starts in UTC) covering the window in store-local time."""
        tz = store_tz(store)
        hourly = w.label in ("today", "yesterday")
        local_start = w.start.astimezone(tz).replace(minute=0, second=0, microsecond=0)
        if not hourly:
            local_start = local_start.replace(hour=0)
        step = timedelta(hours=1) if hourly else timedelta(days=1)
        out, cur, end = [], local_start, w.end.astimezone(tz)
        while cur < end:
            out.append(cur.astimezone(timezone.utc))
            cur = (cur + step)
        return ("hour" if hourly else "day"), out

    @staticmethod
    def _bucket_of(ts: datetime, buckets: List[datetime], gran: str) -> Optional[datetime]:
        for b, nxt in zip(buckets, buckets[1:] + [buckets[-1] + (timedelta(hours=1) if gran == "hour" else timedelta(days=1))]):
            if b <= ts < nxt:
                return b
        return None

    def _label(self, store: Store, b: datetime, gran: str) -> str:
        loc = b.astimezone(store_tz(store))
        return loc.strftime("%H:00") if gran == "hour" else loc.strftime("%Y-%m-%d")

    # ------------------------------------------------------------------ main
    def build(self, store_id: str, range_key: str = "today", compare: str = "previous_period") -> Dict[str, Any]:
        store = get_store_or_404(self.db, store_id)
        w = resolve_window(store, range_key)
        gran, buckets = self._buckets(store, w)
        prev_w = TimeWindow(start=w.previous_start, end=w.previous_end, previous_start=w.previous_start, previous_end=w.previous_end, label=w.label)
        shop = self._shoppers(store, w, prev_w, gran, buckets, compare)
        inv = self._inventory(store, w, gran, buckets)
        que = self._queues(store, w, prev_w, gran, buckets)
        ops = self._operations(store, w, gran, buckets)
        overview = self._overview(store, w, prev_w, gran, buckets, compare, shop, inv, que, ops)
        has = bool(shop["dailyFootfall"] or inv["historyTimeline"] or que["historyTimeline"] or ops["operationsEventLog"])
        return {
            "storeId": store_id, "storeName": store.name, "dateRange": range_key, "comparePeriod": compare, "generatedAt": now_utc().isoformat(),
            "dataMode": store.data_mode, "overview": overview, "shoppers": shop, "inventory": inv, "queues": que, "operations": ops,
            "unavailableFields": UNAVAILABLE,
            "meta": {"dataState": "available" if has else "unavailable", "note": None if has else "No observations were recorded in this period.",
                     "sources": ["footfall", "dwell", "shelf_observations", "queue_observations", "alerts", "tasks", "camera_status_events"]},
        }

    # ------------------------------------------------------------------ shoppers
    def _footfall(self, store_id: str, w: TimeWindow) -> Dict[datetime, Tuple[int, int]]:
        return ShopperRepository(self.db).hourly(store_id, w.start, w.end)

    def _dwell_rows(self, store_id: str, w: TimeWindow):
        return self.db.execute(select(DwellTimeAggregate.bucket_start, DwellTimeAggregate.zone_id, DwellTimeAggregate.visitors, DwellTimeAggregate.avg_dwell_seconds)
                               .where(DwellTimeAggregate.store_id == store_id).where(DwellTimeAggregate.bucket_start >= w.start)
                               .where(DwellTimeAggregate.bucket_start < w.end)).all()

    def _shoppers(self, store, w, prev_w, gran, buckets, compare) -> Dict[str, Any]:
        tz = store_tz(store)
        ff = self._footfall(store.id, w)
        pf = self._footfall(store.id, prev_w)
        dwell = self._dwell_rows(store.id, w)
        by_b: Dict[datetime, List[int]] = {b: [0, 0] for b in buckets}
        for hb, (e, x) in ff.items():
            b = self._bucket_of(hb, buckets, gran)
            if b:
                by_b[b][0] += e
                by_b[b][1] += x
        prev_list = [sum(v[0] for hb, v in pf.items() if self._same_slot(hb, prev_w, b, w, gran)) for b in buckets]
        dwell_by: Dict[datetime, List[Tuple[int, float]]] = defaultdict(list)
        for hb, _, visitors, avg in dwell:
            b = self._bucket_of(hb, buckets, gran)
            if b:
                dwell_by[b].append((visitors, avg))

        def dwell_min(b: datetime) -> Optional[float]:
            rows = dwell_by.get(b)
            tot = sum(v for v, _ in rows) if rows else 0
            return round(sum(v * a for v, a in rows) / tot / 60, 1) if tot else None

        hourly = []
        if gran == "hour":
            for i, b in enumerate(buckets):
                e, x = by_b[b]
                if e or x or dwell_by.get(b):
                    hourly.append({"hour": self._label(store, b, gran), "entries": e, "exits": x, "prevEntries": prev_list[i] if compare != "none" else None, "avgDwell": dwell_min(b)})
        else:  # for multi-day ranges the hourly profile aggregates by local hour of day
            prof: Dict[int, List[int]] = defaultdict(lambda: [0, 0])
            for hb, (e, x) in ff.items():
                h = hb.astimezone(tz).hour
                prof[h][0] += e
                prof[h][1] += x
            hourly = [{"hour": f"{h:02d}:00", "entries": v[0], "exits": v[1], "prevEntries": None, "avgDwell": None} for h, v in sorted(prof.items())]

        days: Dict[str, Dict[str, Any]] = {}
        for hb, (e, x) in ff.items():
            d = hb.astimezone(tz).date().isoformat()
            row = days.setdefault(d, {"entries": 0, "exits": 0, "hours": {}})
            row["entries"] += e
            row["exits"] += x
            row["hours"][hb.astimezone(tz).hour] = row["hours"].get(hb.astimezone(tz).hour, 0) + e
        prev_days: Dict[str, int] = defaultdict(int)
        for hb, (e, _) in pf.items():
            prev_days[hb.astimezone(tz).date().isoformat()] += e
        prev_totals = list(prev_days.values())
        daily = []
        dwell_day: Dict[str, List[Tuple[int, float]]] = defaultdict(list)
        for hb, _, v, a in dwell:
            dwell_day[hb.astimezone(tz).date().isoformat()].append((v, a))
        for i, (d, row) in enumerate(sorted(days.items())):
            peak_h = max(row["hours"], key=row["hours"].get) if row["hours"] else None
            dv = dwell_day.get(d)
            tot = sum(v for v, _ in dv) if dv else 0
            daily.append({"date": d, "entries": row["entries"], "exits": row["exits"], "netOccupancyChange": row["entries"] - row["exits"],
                          "peakHour": f"{peak_h:02d}:00" if peak_h is not None else None, "peakVolume": row["hours"].get(peak_h, 0) if peak_h is not None else 0,
                          "avgDwellTimeMinutes": round(sum(v * a for v, a in dv) / tot / 60, 1) if tot else None, "bounceRateEstimatedPct": None,
                          "prevEntries": prev_totals[i] if compare != "none" and i < len(prev_totals) else None})
        zone_names = {z.id: z.name for z in self.db.scalars(select(StoreZone).where(StoreZone.store_id == store.id))}
        zone_tot: Dict[str, List[Tuple[int, float]]] = defaultdict(list)
        for _, z, v, a in dwell:
            zone_tot[z].append((v, a))
        prev_zone: Dict[str, int] = defaultdict(int)
        for _, z, v, _a in self._dwell_rows(store.id, prev_w):
            prev_zone[z] += v
        total_visits = sum(v for rows in zone_tot.values() for v, _ in rows)
        zones = []
        for z, rows in sorted(zone_tot.items(), key=lambda kv: -sum(v for v, _ in kv[1])):
            vis = sum(v for v, _ in rows)
            zones.append({"zone": zone_names.get(z, z), "visits": vis, "percentage": round(vis / total_visits * 100, 1) if total_visits else 0.0,
                          "avgDwellMinutes": round(sum(v * a for v, a in rows) / vis / 60, 1) if vis else None, "prevVisits": prev_zone.get(z) if compare != "none" else None})
        # peak periods by local daypart, from measured hourly entries only
        parts = {"Morning": (6, 12), "Afternoon": (12, 17), "Evening": (17, 24)}
        per_hour: Dict[int, List[int]] = defaultdict(list)
        for hb, (e, _) in ff.items():
            per_hour[hb.astimezone(tz).hour].append(e)
        vols = {h: statistics.fmean(v) for h, v in per_hour.items()}
        peak_val = max(vols.values(), default=0)
        periods = []
        for name, (a, b) in parts.items():
            hs = [vols[h] for h in vols if a <= h < b]
            if not hs:
                continue
            avg = statistics.fmean(hs)
            ratio = avg / peak_val if peak_val else 0
            periods.append({"period": name, "hours": f"{a:02d}:00-{b % 24:02d}:00", "avgShoppersPerHour": round(avg, 1),
                            "congestionLevel": "peak" if ratio >= 0.9 else "high" if ratio >= 0.65 else "moderate" if ratio >= 0.35 else "low"})
        cur_total = sum(r["entries"] for r in daily)
        prev_total = sum(prev_totals)
        busiest = max(daily, key=lambda r: r["entries"], default=None)
        return {"hourlyTrends": hourly, "dailyFootfall": daily, "zoneDistribution": zones, "peakShoppingPeriods": periods,
                "footfallComparisonSummary": {"currentTotal": cur_total, "previousTotal": prev_total if compare != "none" else None,
                                              "netGrowthPct": pct_change(cur_total, prev_total) if compare != "none" and prev_total else None,
                                              "busiestDay": busiest["date"] if busiest else None}}

    @staticmethod
    def _same_slot(prev_hour: datetime, prev_w: TimeWindow, b: datetime, w: TimeWindow, gran: str) -> bool:
        off = (prev_hour - prev_w.start).total_seconds()
        span = timedelta(hours=1) if gran == "hour" else timedelta(days=1)
        boff = (b - w.start).total_seconds()
        return boff <= off < boff + span.total_seconds()

    # ------------------------------------------------------------------ inventory
    def _inventory(self, store, w, gran, buckets) -> Dict[str, Any]:
        tz = store_tz(store)
        shelves = {s.id: s for s in self.db.scalars(select(Shelf).where(Shelf.store_id == store.id))}
        products = {p.id: p for p in self.db.scalars(select(Product).where(Product.store_id == store.id))}
        emps = {e.id: e for e in self.db.scalars(select(Employee).where(Employee.store_id == store.id))}
        obs = self.db.execute(select(ShelfObservation.observed_at, ShelfObservation.availability_pct, ShelfObservation.detected_units, ShelfObservation.shelf_id,
                                     ShelfObservation.planogram_compliance_pct, ShelfObservation.status)
                              .where(ShelfObservation.store_id == store.id).where(ShelfObservation.observed_at >= w.start).where(ShelfObservation.observed_at < w.end)).all()
        alerts = list(self.db.scalars(select(Alert).where(Alert.store_id == store.id).where(Alert.module == "inventory")
                                      .where(Alert.created_at >= w.start).where(Alert.created_at < w.end)))
        tasks = list(self.db.scalars(select(Task).where(Task.store_id == store.id).where(Task.category.in_(("shelf_replenishment", "inventory_inspection")))
                                     .where(Task.created_at >= w.start).where(Task.created_at < w.end)))
        day = lambda ts: ts.astimezone(tz).date().isoformat()  # noqa: E731
        hist: Dict[str, Dict[str, Any]] = {}
        for ts, pct, units, sid, comp, status in obs:
            r = hist.setdefault(day(ts), {"avail": [], "comp": []})
            if pct is not None:
                r["avail"].append(pct)
            elif units is not None and shelves.get(sid) and shelves[sid].capacity_units:
                r["avail"].append(min(100.0, units / shelves[sid].capacity_units * 100))
            if comp is not None:
                r["comp"].append(comp)
        for a in alerts:
            hist.setdefault(day(a.created_at), {"avail": [], "comp": []})
        for t in tasks:
            hist.setdefault(day(t.created_at), {"avail": [], "comp": []})
        timeline = []
        for d, r in sorted(hist.items()):
            da = [a for a in alerts if day(a.created_at) == d]
            dt = [t for t in tasks if day(t.created_at) == d]
            resp = [x for x in (self._task_response(t) for t in dt) if x is not None]
            timeline.append({"date": d, "shelfAvailabilityPercentage": _avg(r["avail"]),
                             "lowStockEventsCount": sum(1 for a in da if a.severity != "critical"), "outOfStockEventsCount": sum(1 for a in da if a.severity == "critical"),
                             "tasksCreatedCount": len(dt), "tasksResolvedCount": sum(1 for t in dt if t.status == "completed"), "avgResponseMinutes": _avg(resp),
                             "planogramCompliancePercentage": _avg(r["comp"])})
        by_shelf: Dict[str, List[Alert]] = defaultdict(list)
        for a in alerts:
            if a.shelf_id:
                by_shelf[a.shelf_id].append(a)
        depleted = []
        for sid, al in sorted(by_shelf.items(), key=lambda kv: -len(kv[1]))[:8]:
            sh = shelves.get(sid)
            tasks_for = [t for t in tasks if t.shelf_id == sid and t.status == "completed"]
            rest = [m for m in (_mins(t.created_at, t.completed_at) for t in tasks_for) if m is not None]
            prod = next((products[p] for p in [t.product_id for t in tasks if t.shelf_id == sid and t.product_id] if p in products), None)
            depleted.append({"shelfId": sh.shelf_code if sh else sid, "aisle": (sh.aisle_location if sh else None) or "-", "department": (sh.department if sh else None) or "-",
                             "productName": prod.name if prod else ((sh.category if sh else None) or "-"), "depletionCount": len(al), "avgRestockMinutes": _avg(rest),
                             "cameraVerified": any(t.camera_verified for t in tasks_for)})
        dept: Dict[str, Dict[str, Any]] = {}
        for a in alerts:
            sh = shelves.get(a.shelf_id or "")
            d = (sh.department if sh else None) or "Unassigned"
            r = dept.setdefault(d, {"department": d, "lowStockIncidents": 0, "outOfStockIncidents": 0, "avail": []})
            r["outOfStockIncidents" if a.severity == "critical" else "lowStockIncidents"] += 1
        for ts, pct, units, sid, *_ in obs:
            sh = shelves.get(sid)
            d = (sh.department if sh else None) or "Unassigned"
            if pct is not None and d in dept:
                dept[d]["avail"].append(pct)
        dept_rows = [{"department": r["department"], "lowStockIncidents": r["lowStockIncidents"], "outOfStockIncidents": r["outOfStockIncidents"], "availabilityRate": _avg(r["avail"])}
                     for r in dept.values()]
        done = [t for t in tasks if t.status == "completed"]
        sla = [t for t in done if t.due_at and t.completed_at]
        resp_all = [x for x in (self._task_response(t) for t in tasks) if x is not None]
        log = []
        for a in sorted(alerts, key=lambda a: a.created_at, reverse=True)[:25]:
            sh = shelves.get(a.shelf_id or "")
            task = next((t for t in tasks if t.alert_id == a.id), None)
            emp = emps.get(task.assigned_employee_id or "") if task else None
            status = "resolved" if a.status == "resolved" else ("in_progress" if task and task.status == "in_progress" else "pending")
            log.append({"id": a.id, "timestamp": a.created_at.astimezone(tz).strftime("%Y-%m-%d %H:%M"), "shelfId": sh.shelf_code if sh else (a.shelf_id or "-"),
                        "product": (sh.category if sh else None) or a.title, "department": (sh.department if sh else None) or "-",
                        "durationMinutes": _mins(a.created_at, a.resolved_at), "restockedBy": emp.name if emp else None, "status": status})
        return {"historyTimeline": timeline, "depletedShelves": depleted, "departmentShortages": dept_rows,
                "replenishmentTaskStats": {"totalCreated": len(tasks), "totalCompleted": len(done), "avgResponseTimeMinutes": _avg(resp_all),
                                           "compliantWithSlaPercent": round(sum(1 for t in sla if t.completed_at <= t.due_at) / len(sla) * 100, 1) if sla else None},
                "stockoutLog": log}

    def _task_response(self, t: Task) -> Optional[float]:
        """Minutes from creation until work started (first in_progress) - the time the store took to react."""
        h = self.db.scalars(select(TaskHistory).where(TaskHistory.task_id == t.id).where(TaskHistory.to_status == "in_progress").order_by(TaskHistory.id).limit(1)).first()
        return _mins(t.created_at, h.created_at) if h else None

    # ------------------------------------------------------------------ queues
    def _queues(self, store, w, prev_w, gran, buckets) -> Dict[str, Any]:
        tz = store_tz(store)
        counters = {c.id: c for c in self.db.scalars(select(CheckoutCounter).where(CheckoutCounter.store_id == store.id))}

        def rows(win):
            return self.db.execute(select(QueueObservation.observed_at, QueueObservation.counter_id, QueueObservation.queue_length, QueueObservation.estimated_wait_seconds)
                                   .where(QueueObservation.store_id == store.id).where(QueueObservation.observed_at >= win.start)
                                   .where(QueueObservation.observed_at < win.end)).all()

        cur, prev = rows(w), rows(prev_w)
        served = self.db.execute(select(QueueServiceSample.completed_at, QueueServiceSample.counter_id).where(QueueServiceSample.store_id == store.id)
                                 .where(QueueServiceSample.completed_at >= w.start).where(QueueServiceSample.completed_at < w.end)).all()
        q_alerts = list(self.db.scalars(select(Alert).where(Alert.store_id == store.id).where(Alert.module == "queue").where(Alert.created_at >= w.start).where(Alert.created_at < w.end)))
        day = lambda ts: ts.astimezone(tz).date().isoformat()  # noqa: E731
        days: Dict[str, Dict[str, list]] = {}
        for ts, cid, ln, wait in cur:
            r = days.setdefault(day(ts), {"w": [], "l": []})
            r["l"].append(ln)
            if wait is not None:
                r["w"].append(wait / 60)
        timeline = []
        for d, r in sorted(days.items()):
            al = [a for a in q_alerts if day(a.created_at) == d]
            resp = [m for m in (_mins(a.created_at, a.acknowledged_at or a.resolved_at) for a in al) if m is not None]
            timeline.append({"date": d, "avgWaitMinutes": _avg(r["w"]), "peakWaitMinutes": round(max(r["w"]), 1) if r["w"] else None,
                             "avgQueueLength": _avg(r["l"]), "peakQueueLength": max(r["l"]) if r["l"] else None,
                             "totalCustomersProcessed": sum(1 for t, _ in served if day(t) == d) or None, "congestionIncidentsCount": len(al), "avgResponseToAlertMinutes": _avg(resp)})
        hourly_cur: Dict[int, List[Tuple[float, int]]] = defaultdict(list)
        hourly_prev: Dict[int, List[float]] = defaultdict(list)
        for ts, cid, ln, wait in cur:
            hourly_cur[ts.astimezone(tz).hour].append((wait / 60 if wait is not None else None, ln))
        for ts, cid, ln, wait in prev:
            if wait is not None:
                hourly_prev[ts.astimezone(tz).hour].append(wait / 60)
        served_h: Dict[int, int] = defaultdict(int)
        for t, _ in served:
            served_h[t.astimezone(tz).hour] += 1
        days_n = max(1, len(days))
        hourly = []
        for h, vals in sorted(hourly_cur.items()):
            waits = [x for x, _ in vals if x is not None]
            hourly.append({"hour": f"{h:02d}:00", "avgWaitMinutes": _avg(waits), "prevAvgWaitMinutes": _avg(hourly_prev.get(h, [])), "maxQueueLength": max(l for _, l in vals),
                           "throughputPerMinute": round(served_h.get(h, 0) / days_n / 60, 2) if served_h.get(h) else None})
        comp = []
        for cid, c in counters.items():
            cw = [wait / 60 for ts, k, ln, wait in cur if k == cid and wait is not None]
            if not cw and not any(k == cid for _, k, *_ in cur):
                continue
            comp.append({"counterId": cid, "counterName": c.name, "type": c.counter_type, "avgWaitMinutes": _avg(cw), "customersServed": sum(1 for _, k in served if k == cid) or None,
                         "utilizationPct": None, "congestionAlerts": sum(1 for a in q_alerts if a.counter_id == cid)})
        log = []
        for a in sorted(q_alerts, key=lambda a: a.created_at, reverse=True)[:25]:
            ev = {}
            try:
                import json as _json

                ev = _json.loads(a.evidence) if a.evidence else {}
            except Exception:  # noqa: BLE001
                ev = {}
            ws = ev.get("waitSeconds")
            log.append({"id": a.id, "timestamp": a.created_at.astimezone(tz).strftime("%Y-%m-%d %H:%M"), "counterId": a.counter_id or "-",
                        "triggerWaitMinutes": round(ws / 60, 1) if isinstance(ws, (int, float)) else None, "resolutionMinutes": _mins(a.created_at, a.resolved_at),
                        "actionTaken": a.recommended_action or "-", "status": "resolved" if a.status == "resolved" else "active"})
        rules_sla = 4.5
        waits_all = [wait / 60 for _, _, _, wait in cur if wait is not None]
        total_served = len(served)
        return {"historyTimeline": timeline, "hourlyQueueTrends": hourly, "counterComparisons": comp, "queueAlertLog": log,
                "overallThroughputSummary": {"totalServed": total_served or None, "avgThroughputPerMin": None if not served else round(total_served / max(1, (w.end - w.start).total_seconds() / 60), 3),
                                              "slaComplianceRate": round(sum(1 for x in waits_all if x <= rules_sla) / len(waits_all) * 100, 1) if waits_all else None}}

    # ------------------------------------------------------------------ operations
    def _uptime(self, store, w) -> List[Dict[str, Any]]:
        out = []
        span = (w.end - w.start).total_seconds()
        for cam in self.db.scalars(select(Camera).where(Camera.store_id == store.id).order_by(Camera.camera_code)):
            evs = list(self.db.scalars(select(CameraStatusEvent).where(CameraStatusEvent.camera_id == cam.id).where(CameraStatusEvent.occurred_at < w.end).order_by(CameraStatusEvent.occurred_at)))
            if not evs:
                out.append({"cameraId": cam.camera_code, "name": cam.name, "zone": "-", "streamProtocol": cam.source_type, "uptimePct": None,
                            "offlineIncidentsCount": 0, "lastChecked": None})
                continue
            state, t, live, incidents = None, w.start, 0.0, 0
            for e in evs:
                if e.occurred_at <= w.start:
                    state = e.to_state
                    continue
                if state == "live":
                    live += (e.occurred_at - t).total_seconds()
                if t < e.occurred_at:
                    t = e.occurred_at
                if e.from_state == "live" and e.to_state != "live":
                    incidents += 1
                state = e.to_state
            if state == "live":
                live += (min(w.end, now_utc()) - t).total_seconds()
            measured = (min(w.end, now_utc()) - w.start).total_seconds() or span
            out.append({"cameraId": cam.camera_code, "name": cam.name, "zone": "-", "streamProtocol": cam.source_type, "uptimePct": round(min(100.0, live / measured * 100), 1),
                        "offlineIncidentsCount": incidents, "lastChecked": evs[-1].occurred_at.isoformat()})
        return out

    def _operations(self, store, w, gran, buckets) -> Dict[str, Any]:
        tz = store_tz(store)
        emps = {e.id: e for e in self.db.scalars(select(Employee).where(Employee.store_id == store.id))}
        alerts = list(self.db.scalars(select(Alert).where(Alert.store_id == store.id).where(Alert.created_at >= w.start).where(Alert.created_at < w.end)))
        tasks = list(self.db.scalars(select(Task).where(Task.store_id == store.id).where(Task.created_at >= w.start).where(Task.created_at < w.end)))
        day = lambda ts: ts.astimezone(tz).date().isoformat()  # noqa: E731
        uptime = self._uptime(store, w)
        overall_up = _avg([u["uptimePct"] for u in uptime if u["uptimePct"] is not None])
        days = sorted({day(a.created_at) for a in alerts} | {day(t.created_at) for t in tasks})
        timeline = []
        for d in days:
            da = [a for a in alerts if day(a.created_at) == d]
            dt = [t for t in tasks if day(t.created_at) == d]
            resp = [m for m in (_mins(a.created_at, a.acknowledged_at or a.resolved_at) for a in da) if m is not None]
            timeline.append({"date": d, "alertsGenerated": len(da), "alertsAcknowledged": sum(1 for a in da if a.acknowledged_at or a.status in ("acknowledged", "resolved")),
                             "alertsResolved": sum(1 for a in da if a.status == "resolved"), "avgAlertResponseMinutes": _avg(resp),
                             "replenishmentTasksCompleted": sum(1 for t in dt if t.status == "completed" and t.category in ("shelf_replenishment", "inventory_inspection")),
                             "staffingTasksCompleted": sum(1 for t in dt if t.status == "completed" and t.category not in ("shelf_replenishment", "inventory_inspection")),
                             "repeatedIncidents": sum(max(0, (a.occurrences or 1) - 1) for a in da), "overallCameraUptimePct": overall_up})
        by_cat: Dict[str, List[Alert]] = defaultdict(list)
        for a in alerts:
            by_cat[a.category].append(a)
        total = len(alerts)
        incidents = [{"category": c, "count": len(v), "percentage": round(len(v) / total * 100, 1) if total else 0.0,
                      "avgResolutionMinutes": _avg([m for m in (_mins(a.created_at, a.resolved_at) for a in v) if m is not None])} for c, v in sorted(by_cat.items(), key=lambda kv: -len(kv[1]))]
        eff = []
        for eid, e in emps.items():
            mine = [t for t in tasks if t.assigned_employee_id == eid]
            done = [t for t in mine if t.status == "completed"]
            if not mine:
                continue
            resp = [x for x in (self._task_response(t) for t in mine) if x is not None]
            sla = [t for t in done if t.due_at and t.completed_at]
            eff.append({"staffId": eid, "name": e.name, "role": e.role_label or e.role, "tasksCompleted": len(done), "avgResponseMinutes": _avg(resp),
                        "slaCompliancePct": round(sum(1 for t in sla if t.completed_at <= t.due_at) / len(sla) * 100, 1) if sla else None})
        events = []
        for a in sorted(alerts, key=lambda a: a.created_at, reverse=True)[:40]:
            events.append({"id": a.id, "timestamp": a.created_at.astimezone(tz).strftime("%Y-%m-%d %H:%M"), "eventType": a.category, "zone": a.zone or "-", "detail": a.title,
                           "responseTimeMinutes": _mins(a.created_at, a.acknowledged_at or a.resolved_at),
                           "status": "resolved" if a.status == "resolved" else "acknowledged" if a.status == "acknowledged" else "escalated"})
        ack = sum(1 for a in alerts if a.acknowledged_at or a.status in ("acknowledged", "resolved"))
        res = sum(1 for a in alerts if a.status == "resolved")
        resp_all = [m for m in (_mins(a.created_at, a.acknowledged_at or a.resolved_at) for a in alerts) if m is not None]
        return {"historyTimeline": timeline, "cameraUptimeList": uptime, "incidentCategoryBreakdown": incidents, "staffEfficiencySummary": eff, "operationsEventLog": events,
                "overallOperationsSummary": {"totalIncidents": total, "acknowledgmentRatePct": round(ack / total * 100, 1) if total else None,
                                             "resolutionRatePct": round(res / total * 100, 1) if total else None, "avgResponseMinutes": _avg(resp_all)}}

    # ------------------------------------------------------------------ overview
    def _kpi(self, cur: Optional[float], prev: Optional[float], unit: str, good: bool, compare: str) -> Dict[str, Any]:
        use_prev = compare != "none"
        delta = round(cur - prev, 1) if use_prev and cur is not None and prev is not None else None
        return {"current": cur, "previous": prev if use_prev else None, "delta": delta,
                "percentChange": pct_change(cur, prev) if delta is not None and prev else None, "unit": unit, "isPositiveGood": good}

    def _overview(self, store, w, prev_w, gran, buckets, compare, shop, inv, que, ops) -> Dict[str, Any]:
        tz = store_tz(store)
        prev_ff = sum(e for e, _ in self._footfall(store.id, prev_w).values())
        cur_ff = shop["footfallComparisonSummary"]["currentTotal"]
        has_ff = bool(shop["dailyFootfall"])
        has_pff = shop["footfallComparisonSummary"]["previousTotal"] is not None and bool(prev_ff)
        dw = self._dwell_rows(store.id, w)
        dwp = self._dwell_rows(store.id, prev_w)

        def avg_dwell(rows):
            tot = sum(v for _, _, v, _ in rows)
            return round(sum(v * a for _, _, v, a in rows) / tot / 60, 1) if tot else None

        def count(model, win, *conds, col):
            stmt = select(func.count()).select_from(model).where(model.store_id == store.id).where(col >= win.start).where(col < win.end)
            for c in conds:
                stmt = stmt.where(c)
            return self.db.scalar(stmt) or 0

        low_c = count(Alert, w, Alert.module == "inventory", col=Alert.created_at)
        low_p = count(Alert, prev_w, Alert.module == "inventory", col=Alert.created_at)
        done_c = count(Task, w, Task.status == "completed", col=Task.completed_at)
        done_p = count(Task, prev_w, Task.status == "completed", col=Task.completed_at)
        crit_c = count(Alert, w, Alert.severity == "critical", col=Alert.created_at)
        crit_p = count(Alert, prev_w, Alert.severity == "critical", col=Alert.created_at)

        def qwait(win):
            r = self.db.scalar(select(func.avg(QueueObservation.estimated_wait_seconds)).where(QueueObservation.store_id == store.id)
                               .where(QueueObservation.observed_at >= win.start).where(QueueObservation.observed_at < win.end).where(QueueObservation.estimated_wait_seconds.is_not(None)))
            return round(r / 60, 1) if r is not None else None

        trend = []
        ff = self._footfall(store.id, w)
        wait_rows = self.db.execute(select(QueueObservation.observed_at, QueueObservation.estimated_wait_seconds).where(QueueObservation.store_id == store.id)
                                    .where(QueueObservation.observed_at >= w.start).where(QueueObservation.observed_at < w.end)).all()
        ev_rows = [a.created_at for a in self.db.scalars(select(Alert).where(Alert.store_id == store.id).where(Alert.module == "inventory").where(Alert.created_at >= w.start).where(Alert.created_at < w.end))]
        td_rows = [t.completed_at for t in self.db.scalars(select(Task).where(Task.store_id == store.id).where(Task.status == "completed").where(Task.completed_at >= w.start).where(Task.completed_at < w.end))]
        pff = self._footfall(store.id, prev_w)
        for i, b in enumerate(buckets):
            nxt = buckets[i + 1] if i + 1 < len(buckets) else b + (timedelta(hours=1) if gran == "hour" else timedelta(days=1))
            f = sum(e for hb, (e, _) in ff.items() if b <= hb < nxt)
            wv = [s / 60 for t, s in wait_rows if s is not None and b <= t < nxt]
            lo = sum(1 for t in ev_rows if b <= t < nxt)
            tc = sum(1 for t in td_rows if t and b <= t < nxt)
            if f or wv or lo or tc:
                trend.append({"timestamp": self._label(store, b, gran), "footfall": f, "avgWaitMinutes": _avg(wv), "lowStockEvents": lo, "tasksCompleted": tc,
                              "prevFootfall": sum(e for hb, (e, _) in pff.items() if self._same_slot(hb, prev_w, b, w, gran)) if compare != "none" else None})
        facts: List[str] = []
        if shop["footfallComparisonSummary"]["busiestDay"]:
            bd = max(shop["dailyFootfall"], key=lambda r: r["entries"])
            facts.append(f"Busiest day {bd['date']} with {bd['entries']} entries" + (f", peaking at {bd['peakHour']}." if bd.get("peakHour") else "."))
        if que["overallThroughputSummary"]["slaComplianceRate"] is not None:
            facts.append(f"{que['overallThroughputSummary']['slaComplianceRate']}% of queue observations were within the 4.5 min wait target.")
        if inv["replenishmentTaskStats"]["totalCreated"]:
            s = inv["replenishmentTaskStats"]
            facts.append(f"{s['totalCompleted']} of {s['totalCreated']} replenishment tasks completed.")
        if ops["overallOperationsSummary"]["totalIncidents"]:
            facts.append(f"{ops['overallOperationsSummary']['totalIncidents']} alerts raised, {ops['overallOperationsSummary']['resolutionRatePct']}% resolved.")
        insights = []
        for i in self.db.scalars(select(Insight).where(Insight.store_id == store.id).where(Insight.created_at >= w.start).where(Insight.created_at < w.end).order_by(Insight.created_at.desc()).limit(6)):
            cat = "queues" if "queue" in (i.category or "") else "inventory" if ("stock" in (i.category or "") or "inventory" in (i.category or "")) else "shoppers" if "traffic" in (i.category or "") or "customer" in (i.category or "") else "operations"
            insights.append({"id": i.id, "headline": i.title, "detail": i.summary or "", "category": cat, "metricTelemetry": ", ".join(f"{k}: {v}" for k, v in list((i.evidence or {}).items())[:3]),
                             "period": w.label, "severity": i.severity})
        return {"kpis": {"totalFootfall": self._kpi(float(cur_ff) if has_ff else None, float(prev_ff) if has_pff else None, "visitors", True, compare),
                         "averageDwellTimeMinutes": self._kpi(avg_dwell(dw), avg_dwell(dwp), "min", True, compare),
                         "detectedLowStockEvents": self._kpi(float(low_c), float(low_p), "events", False, compare),
                         "averageQueueWaitMinutes": self._kpi(qwait(w), qwait(prev_w), "min", False, compare),
                         "completedTasks": self._kpi(float(done_c), float(done_p), "tasks", True, compare),
                         "criticalIncidents": self._kpi(float(crit_c), float(crit_p), "incidents", False, compare)},
                "multiMetricTrends": trend, "keyTrendsSummary": facts, "historicalInsights": insights}
