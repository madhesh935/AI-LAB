"""AI Insights DERIVED from live measurements (rule-based; no model, no invented numbers).

Every insight states the rule that fired, the measured values and the time of the latest observation. They are upserted into the `insights` table under
deterministic ids (`DRV-...`, source 'derived'), so the existing actions (acknowledge, dismiss, create task) keep working. A derived insight whose condition
has cleared is removed (or completed, if someone already created a task for it). A dismissed insight stays dismissed.

Opportunities are measured facts about zones/shelves/counters with a plain suggestion - never a predicted improvement.
The footfall "forecast" is reported as unavailable with the real amount of history, because no forecasting model exists yet.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.config import Settings, get_settings
from database.models import CameraZone, FootfallAggregate, Insight
from services.common import now_utc

SOURCE = "derived"


def ev(statement: str, source: str, window: str, rows: List[Tuple[str, str, str]], rule: str, risk: str, url: str, module: str, last: Optional[str] = None) -> Dict[str, Any]:
    return {"observedStatement": statement, "dataSource": source, "timeWindow": window, "triggerRule": rule, "riskAnalysis": risk,
            "confidenceReliability": f"Measured values, not a model prediction. Latest observation: {last or 'time not recorded'}.",
            "metricsTable": [{"metric": m, "measuredValue": v, "targetThreshold": t, "variance": "—"} for m, v, t in rows], "relatedModuleUrl": url, "relatedModuleName": module}


class InsightDeriver:
    def __init__(self, db: Session, settings: Optional[Settings] = None):
        self.db = db
        self.settings = settings or get_settings()

    # ------------------------------------------------------------------ rules
    def _queue(self, store_id: str) -> List[Dict[str, Any]]:
        from services.queues import QueueService

        q = QueueService(self.db).overview(store_id).model_dump(by_alias=True, mode="json")
        rules = q.get("rules") or {}
        warn_w, crit_w, max_len = rules.get("slaWarningWaitMinutes"), rules.get("slaCriticalWaitMinutes"), rules.get("maxQueueLength")
        out = []
        for c in q.get("counters", []):
            wait, n, status = c.get("estimatedWaitMinutes"), c.get("waitingCustomers"), c.get("status")
            if status not in ("open", None) or n is None:
                continue
            over_crit = wait is not None and crit_w is not None and wait > crit_w
            over_warn = wait is not None and warn_w is not None and wait > warn_w
            over_len = max_len is not None and n > max_len
            if not (over_crit or over_warn or over_len):
                continue
            last = c.get("lastObservationAt")
            out.append({
                "key": f"queue-{c['id']}", "code": "INS-QUEUE", "category": "queue_intelligence", "severity": "critical" if (over_crit or over_len) else "warning",
                "title": f"{c['name']}: queue is over the limit", "zone": "Checkout",
                "summary": f"{n} waiting" + (f", estimated wait {wait} min" if wait is not None else "") + (f" (limit {crit_w} min)." if wait is not None and crit_w else "."),
                "explanation": "Wait time is estimated from the measured queue length and the counter's service rate.",
                "recommended_action": "Send a cashier to this counter or direct shoppers to a shorter lane.",
                "evidence": ev(f"{c['name']} has {n} customers waiting.", "Queue camera measurements", "Latest observation",
                               [("Customers waiting", str(n), f"<= {max_len}" if max_len is not None else "—"), ("Estimated wait", f"{wait} min" if wait is not None else "—", f"<= {warn_w} min" if warn_w is not None else "—")],
                               "queue length above the maximum, or estimated wait above the SLA", "Customers abandon long queues.", "/queue-intelligence", "Queue Intelligence", last)})
        return out

    def _inventory(self, store_id: str) -> List[Dict[str, Any]]:
        from services.inventory import InventoryService

        inv = InventoryService(self.db)
        out = []
        for s in [x.model_dump(by_alias=True, mode="json") for x in inv.shelves(store_id)]:
            cond = s.get("condition")
            if cond not in ("low_stock", "out_of_stock"):
                continue
            units, cap, pct = s.get("detectedVisibleUnits"), s.get("capacityUnits"), s.get("availabilityPercentage")
            out.append({
                "key": f"stock-{s['id']}", "code": "INS-STOCK", "category": "inventory", "severity": "critical" if cond == "out_of_stock" else "warning",
                "title": f"{s['shelfCode']} is {'empty' if cond == 'out_of_stock' else 'running low'}", "zone": s.get("aisleLocation") or s.get("department"),
                "summary": f"{units if units is not None else '?'} of {cap if cap is not None else '?'} units visible on the shelf" + (f" ({pct}%)." if pct is not None else "."),
                "explanation": "Counted from the latest shelf observation; it shows what is visible on the shelf display, not stockroom stock.",
                "recommended_action": f"Restock {s['shelfCode']} from the stockroom.",
                "evidence": ev(f"{s['shelfCode']} is {cond.replace('_', ' ')}.", "Shelf observations", "Latest observation",
                               [("Visible units", str(units) if units is not None else "—", "—"), ("Shelf capacity", str(cap) if cap is not None else "—", "—"), ("Availability", f"{pct}%" if pct is not None else "—", "—")],
                               "visible units below the low-stock threshold", "Shoppers cannot buy what is not on the shelf.", "/smart-inventory", "Smart Inventory", s.get("lastObservationAt"))})
        return out

    def _cameras(self, store_id: str) -> List[Dict[str, Any]]:
        from services.cameras import CameraService

        out = []
        for f in [x.model_dump(by_alias=True, mode="json") for x in CameraService(self.db, self.settings).feeds(store_id)]:
            if f.get("sourceType") in (None, "unconfigured") or not f.get("enabled", True) or f.get("status") == "live":
                continue
            out.append({
                "key": f"camera-{f['cameraCode']}", "code": "INS-CAM", "category": "camera_health", "severity": "warning", "title": f"{f['name']} is {f.get('status') or 'offline'}",
                "zone": f.get("zone"), "summary": f.get("message") or "The camera is configured but not delivering frames.",
                "explanation": "While a camera is down, its counts (footfall, queue, shelf) are missing, not zero.", "recommended_action": "Check the camera connection or the video source.",
                "evidence": ev(f"{f['name']} status: {f.get('status')}.", "Camera status", "Now", [("Status", str(f.get("status")), "live"), ("Error code", str(f.get("errorCode") or "—"), "—")],
                               "configured camera not live", "Counts from this camera are unavailable.", "/", "Live Cameras", f.get("lastFrameAt"))})
        return out

    def _traffic(self, store_id: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        from services.analytics_read import AnalyticsReadService
        from services.overview import OverviewService
        from services.shoppers import ShopperService

        insights: List[Dict[str, Any]] = []
        opps: List[Dict[str, Any]] = []
        ov = OverviewService(self.db).build(store_id).model_dump(by_alias=True, mode="json")["metrics"]
        occ, cap = ov.get("currentOccupancy"), ov.get("maxCapacity")
        if occ is not None and cap and occ >= 0.9 * cap:
            insights.append({
                "key": "occupancy-capacity", "code": "INS-OCC", "category": "shopper_analytics", "severity": "warning" if occ < cap else "critical", "title": "Store is close to its capacity",
                "zone": "Store", "summary": f"Estimated {occ} people inside; capacity is {cap}.", "explanation": "Occupancy is an estimate from entrance crossings.",
                "recommended_action": "Check the entrance and manage entry if the count is confirmed.",
                "evidence": ev("Occupancy is at or above 90% of capacity.", "Entrance camera crossings", "Now", [("Estimated occupancy", str(occ), f"< {int(cap * 0.9)}")], "occupancy >= 90% of capacity",
                               "Crowding slows service and is a safety limit.", "/shopper-analytics", "Shopper Analytics", ov.get("latestObservationAt"))})
        zones = [z.model_dump(by_alias=True, mode="json") for z in ShopperService(self.db).zone_activity(store_id, "today")]
        dwell = {i["name"]: i for i in AnalyticsReadService(self.db, self.settings).zone_analytics(store_id, "today")["items"]}
        visited = [z for z in zones if (z.get("visitors") or 0) > 0]
        if visited:
            top = max(visited, key=lambda z: z["visitors"])
            d = dwell.get(top["name"], {})
            mean = d.get("meanDwellSeconds")
            opps.append({"id": f"OPP-traffic-{top['id']}", "title": f"{top['name']} draws the most visits", "zone": top["name"], "type": "high_traffic", "metricLabel": "visits today",
                         "metricValue": str(top["visitors"]), "observation": f"{top['visitors']} visits measured" + (f", mean stay {round(mean)} s." if mean else "."),
                         "opportunityNote": "Busiest measured zone: keep it stocked and staffed.", "actionLabel": "Open Shopper Analytics", "targetUrl": "/shopper-analytics"})
        covered = {r[0] for r in self.db.execute(select(CameraZone.store_zone_id, CameraZone.polygon).where(CameraZone.store_id == store_id).where(CameraZone.enabled.is_(True)))
                   if r[0] and r[1] and len(r[1]) >= 3}  # visits are measured by polygons; an entrance line counts crossings, not visits
        if len(visited) >= 2:
            # only zones a camera actually covers can be 'cold'; an uncovered zone is simply not measured
            quiet = [z for z in zones if (z.get("visitors") or 0) == 0 and z.get("id") in covered]
            for z in quiet[:2]:
                opps.append({"id": f"OPP-cold-{z['id']}", "title": f"No visits measured in {z['name']}", "zone": z["name"], "type": "cold_spot", "metricLabel": "visits today", "metricValue": "0",
                             "observation": f"Other zones recorded visits ({len(visited)} of {len(zones)}) but none were measured here.", "opportunityNote": "Check the camera covers this zone, or review the layout.",
                             "actionLabel": "Open Shopper Analytics", "targetUrl": "/shopper-analytics"})
        return insights, opps

    # ------------------------------------------------------------------ sync + outputs
    def derive(self, store_id: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        traffic_i, opps = self._traffic(store_id)
        specs = self._queue(store_id) + self._inventory(store_id) + self._cameras(store_id) + traffic_i
        # shelf/queue opportunities reuse the same measured facts
        for s in specs:
            if s["category"] == "queue_intelligence":
                opps.append({"id": f"OPP-{s['key']}", "title": s["title"], "zone": s["zone"], "type": "bottleneck", "metricLabel": "waiting", "metricValue": s["summary"].split(" waiting")[0],
                             "observation": s["summary"], "opportunityNote": s["recommended_action"], "actionLabel": "Open Queue Intelligence", "targetUrl": "/queue-intelligence"})
            elif s["category"] == "inventory":
                opps.append({"id": f"OPP-{s['key']}", "title": s["title"], "zone": s["zone"] or "Shelf", "type": "shelf_velocity", "metricLabel": "visible units", "metricValue": s["summary"].split(" of")[0],
                             "observation": s["summary"], "opportunityNote": s["recommended_action"], "actionLabel": "Open Smart Inventory", "targetUrl": "/smart-inventory"})
        return specs, opps[:8]

    def sync(self, store_id: str) -> List[Dict[str, Any]]:
        specs, opps = self.derive(store_id)
        now = now_utc()
        existing = {i.id: i for i in self.db.scalars(select(Insight).where(Insight.store_id == store_id).where(Insight.source == SOURCE))}
        seen = set()
        for s in specs:
            iid = f"DRV-{s['key']}"[:48]
            seen.add(iid)
            row = existing.get(iid)
            fields = dict(code=s["code"][:32], category=s["category"], severity=s["severity"], title=s["title"][:200], zone=s.get("zone"), summary=s["summary"],
                          explanation=s.get("explanation"), recommended_action=s.get("recommended_action"), evidence=s["evidence"])
            if row is None:
                self.db.add(Insight(id=iid, store_id=store_id, status="pending", source=SOURCE, **fields))
            else:
                for k, v in fields.items():
                    setattr(row, k, v)
                if row.status == "completed":  # the condition came back after it was resolved: a new occurrence
                    row.status, row.completed_at = "pending", None
        for iid, row in existing.items():
            if iid in seen or row.status == "dismissed":
                continue
            if row.task_id and row.status != "completed":
                row.status, row.completed_at = "completed", now  # someone acted on it and the condition cleared
            elif not row.task_id:
                self.db.delete(row)
        self.db.flush()
        return opps

    def forecast_status(self, store_id: str) -> Dict[str, Any]:
        from services.footfall_forecast import build

        built = build(self.db, store_id)
        if built is not None:  # enough stored history: a transparent same-hour average with a measured backtest error
            return built
        rows = list(self.db.execute(select(FootfallAggregate.bucket_start, FootfallAggregate.entries).where(FootfallAggregate.store_id == store_id)
                                    .where(FootfallAggregate.source == "cv").where(FootfallAggregate.bucket_minutes == 60).order_by(FootfallAggregate.bucket_start)))
        days = 0.0
        if len(rows) > 1:
            days = round((rows[-1][0] - rows[0][0]).total_seconds() / 86400, 2)
        n = self.db.scalar(select(func.count()).select_from(FootfallAggregate).where(FootfallAggregate.store_id == store_id).where(FootfallAggregate.source == "cv")) or 0
        return {"available": False, "model": None, "reason": "No footfall forecasting model exists: it is trained only from at least 14 days of real entrance-camera counts (scripts/train_footfall_forecaster.py).",
                "daysOfHistory": days, "requiredDays": 14, "hourlyBuckets": int(n),
                "observedHourly": [{"hour": r[0].isoformat(), "entries": int(r[1] or 0)} for r in rows[-24:]]}


_ = datetime
