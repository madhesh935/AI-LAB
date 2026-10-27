"""Allowlisted Copilot tools. Every tool is a thin, validated wrapper over the SAME service layer the dashboards use.

* The model can only pick from this registry; arguments are validated with pydantic (`extra=forbid`).
* The store is fixed by the conversation - it is NOT a tool argument, so the model cannot read another store.
* There is no SQL, file or shell access. Read tools never change state; write tools only PREPARE a previewed action (copilot/actions.py).
* Text coming out of the database (alert titles, product names, notes) is untrusted: it is stripped of control characters, length-capped and
  handed to the model inside a data envelope that the system prompt declares non-instructional.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Literal, Optional, Type

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.orm import Session

from core.config import Settings
from core.errors import AppError
from services.common import get_store_or_404, now_utc, store_tz

Range = Literal["today", "yesterday", "week", "month"]


class Args(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NoArgs(Args):
    pass


class RangeArgs(Args):
    range: Range = "today"


class ZoneArgs(RangeArgs):
    pass


class LowStockArgs(Args):
    limit: int = Field(default=8, ge=1, le=20)


class ShelfArgs(Args):
    shelf: str = Field(min_length=1, max_length=64, description="Shelf code like 'Shelf B2-Bakery' or 'B2', or the shelf id")


class AlertArgs(Args):
    status: Optional[Literal["active", "acknowledged", "resolved"]] = "active"
    severity: Optional[Literal["critical", "warning", "info"]] = None
    limit: int = Field(default=8, ge=1, le=20)


class StaffArgs(Args):
    category: Optional[Literal["shelf_replenishment", "checkout_assistance", "inventory_inspection", "customer_assistance", "camera_maintenance", "general_operations"]] = Field(
        default=None, description="Only mark employees eligible for this kind of work"
    )


class ScheduleArgs(Args):
    date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$", description="YYYY-MM-DD, default today (store time)")
    employee: Optional[str] = Field(default=None, max_length=64)


class TaskListArgs(Args):
    limit: int = Field(default=8, ge=1, le=20)


class TaskDetailArgs(Args):
    task_id: str = Field(min_length=3, max_length=40)


class ReportArgs(RangeArgs):
    section: Literal["overview", "shoppers", "inventory", "queues", "operations"] = "overview"


class CounterArgs(Args):
    counter: Optional[str] = Field(default=None, max_length=64, description="Counter name/id; default all counters")


# write (prepare-only) tools
class ReplenishArgs(Args):
    shelf: str = Field(min_length=1, max_length=64)
    employee: Optional[str] = Field(default=None, max_length=64, description="Employee name or id to assign, optional")
    quantity: Optional[int] = Field(default=None, ge=1, le=100000)


class AssignArgs(Args):
    task_id: Optional[str] = Field(default=None, max_length=40)
    shelf: Optional[str] = Field(default=None, max_length=64, description="Alternative to task_id: the open replenishment task of this shelf")
    employee: str = Field(min_length=1, max_length=64)


class AckArgs(Args):
    alert_id: str = Field(min_length=3, max_length=40)


class UpdateTaskArgs(Args):
    task_id: str = Field(min_length=3, max_length=40)
    status: Literal["in_progress", "completed", "cancelled"]


class CheckoutTaskArgs(Args):
    counter: str = Field(min_length=1, max_length=64)
    employee: Optional[str] = Field(default=None, max_length=64)


class ToolError(Exception):
    """A user-facing problem with the request (unknown shelf, ineligible employee ...). Returned to the model as an error result."""


@dataclass
class ToolContext:
    db: Session
    settings: Settings
    store_id: str
    conversation_id: Optional[str] = None

    @property
    def store(self):
        return get_store_or_404(self.db, self.store_id)


@dataclass
class Tool:
    name: str
    description: str
    args: Type[BaseModel]
    handler: Callable[[ToolContext, Any], Dict[str, Any]]
    module: str  # grounding module id used by the UI
    title: str
    url: str
    writes: bool = False

    def schema(self) -> Dict[str, Any]:
        sch = self.args.model_json_schema()
        props = {k: {kk: vv for kk, vv in v.items() if kk != "title"} for k, v in sch.get("properties", {}).items()}
        return {"type": "function", "function": {"name": self.name, "description": self.description, "parameters": {"type": "object", "properties": props, "required": sch.get("required", [])}}}


# ----------------------------------------------------------------------------- sanitising
_CTRL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def clean(value: Any, limit: int = 160) -> Any:
    """Make database text safe to hand to a model: no control characters, bounded length, no markup-looking tags."""
    if isinstance(value, str):
        v = _CTRL.sub(" ", value).replace("<", "(").replace(">", ")").strip()
        return v[:limit]
    if isinstance(value, dict):
        return {k: clean(v, limit) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v, limit) for v in value]
    return value


def dump(model: Any) -> Any:
    if hasattr(model, "model_dump"):
        return model.model_dump(by_alias=True, mode="json")
    if isinstance(model, list):
        return [dump(m) for m in model]
    return model


def _meta(m: Any) -> Dict[str, Any]:
    d = dump(m) if m is not None else {}
    return {"dataState": d.get("dataState"), "lastObservationAt": d.get("lastObservationAt"), "note": d.get("note"), "sources": d.get("sources")}


def _result(ctx: ToolContext, data: Any, meta: Optional[Dict[str, Any]] = None, **extra) -> Dict[str, Any]:
    meta = meta or {}
    return {"storeId": ctx.store_id, "storeName": ctx.store.name, "dataMode": ctx.store.data_mode, "queriedAt": now_utc().isoformat(),
            "dataState": meta.get("dataState") or "available", "latestObservationAt": meta.get("lastObservationAt"), "note": meta.get("note"),
            "sources": meta.get("sources") or [], "data": clean(data), **extra}


# ----------------------------------------------------------------------------- entity lookups
def find_shelf(ctx: ToolContext, text: str):
    from sqlalchemy import select

    from database.models import Shelf

    t = text.strip().lower()
    rows = list(ctx.db.scalars(select(Shelf).where(Shelf.store_id == ctx.store_id)))
    exact = [s for s in rows if s.id.lower() == t or (s.shelf_code or "").lower() == t]
    if len(exact) == 1:
        return exact[0]
    part = [s for s in rows if t in (s.shelf_code or "").lower() or t in (s.id or "").lower() or t.replace("shelf", "").strip() in (s.shelf_code or "").lower().replace("shelf", "")]
    part = [s for s in part] if t else []
    if len(part) == 1:
        return part[0]
    if not part:
        raise ToolError(f"No shelf matches '{text}' in this store. Known shelves: {', '.join(s.shelf_code for s in rows[:12])}")
    raise ToolError(f"'{text}' matches several shelves: {', '.join(s.shelf_code for s in part[:6])}. Ask the user which one.")


def find_employee(ctx: ToolContext, text: str):
    from sqlalchemy import select

    from database.models import Employee

    t = text.strip().lower()
    rows = list(ctx.db.scalars(select(Employee).where(Employee.store_id == ctx.store_id).where(Employee.is_active.is_(True))))
    hit = [e for e in rows if e.id.lower() == t or e.name.lower() == t] or [e for e in rows if t in e.name.lower()]
    if len(hit) == 1:
        return hit[0]
    if not hit:
        raise ToolError(f"No active employee matches '{text}'. Staff: {', '.join(e.name for e in rows[:12])}")
    raise ToolError(f"'{text}' matches several employees: {', '.join(e.name for e in hit[:6])}. Ask the user which one.")


def find_counter(ctx: ToolContext, text: str):
    from sqlalchemy import select

    from database.models import CheckoutCounter

    t = text.strip().lower()
    rows = list(ctx.db.scalars(select(CheckoutCounter).where(CheckoutCounter.store_id == ctx.store_id)))
    hit = [c for c in rows if c.id.lower() == t or c.name.lower() == t] or [c for c in rows if t in c.name.lower() or t in c.id.lower()]
    if len(hit) == 1:
        return hit[0]
    if not hit:
        raise ToolError(f"No checkout counter matches '{text}'. Counters: {', '.join(c.name for c in rows)}")
    raise ToolError(f"'{text}' matches several counters: {', '.join(c.name for c in hit)}. Ask the user which one.")


# ----------------------------------------------------------------------------- read tools
def t_overview(ctx: ToolContext, a: NoArgs):
    from services.overview import OverviewService

    ov = dump(OverviewService(ctx.db).build(ctx.store_id))
    m = ov["metrics"]
    keep = {k: m.get(k) for k in ("totalFootfallToday", "footfallChangePercentage", "currentOccupancy", "occupancyStatus", "occupancyBasis", "maxCapacity", "occupancyPercentage",
                                  "averageDwellTimeMinutes", "lowStockShelvesCount", "outOfStockShelvesCount", "criticalInventoryAlertsCount", "activeCheckoutQueuesCount",
                                  "totalCustomersInQueue", "overallQueueStatus", "averageWaitTimeMinutes", "camerasOnline", "camerasTotal", "openTasks", "activeAlerts",
                                  "criticalAlertsCount", "latestObservationAt")}
    return _result(ctx, {"metrics": keep, "dataAvailability": ov.get("dataAvailability"), "freshness": ov.get("freshness"), "dataQuality": ov.get("dataQuality")},
                   {"dataState": "available" if any(v == "available" for v in ov.get("dataAvailability", {}).values()) else "unavailable", "lastObservationAt": m.get("latestObservationAt")})


def t_footfall_now(ctx: ToolContext, a: NoArgs):
    from services.analytics_read import AnalyticsReadService
    from services.overview import OverviewService

    ov = dump(OverviewService(ctx.db).build(ctx.store_id))["metrics"]
    occ = AnalyticsReadService(ctx.db, ctx.settings).occupancy(ctx.store_id)
    data = {"totalFootfallToday": ov.get("totalFootfallToday"), "changeVsPreviousPercent": ov.get("footfallChangePercentage"), "currentOccupancyEstimate": occ.get("estimate"),
            "occupancyStatus": occ.get("status"), "occupancyReason": occ.get("reason"), "capacity": occ.get("capacity"), "percentOfCapacity": occ.get("percentOfCapacity"),
            "entranceCamerasConfigured": len(occ.get("entranceCameras") or []), "lastCrossingAt": occ.get("lastEventAt"), "isEstimate": True}
    state = "available" if data["totalFootfallToday"] is not None or data["currentOccupancyEstimate"] is not None else "unavailable"
    note = None if state == "available" else (occ.get("meta") or {}).get("note") or "No footfall has been recorded."
    return _result(ctx, data, {"dataState": state, "lastObservationAt": occ.get("lastEventAt"), "note": note, "sources": ["footfall", "occupancy"]})


def t_footfall_history(ctx: ToolContext, a: RangeArgs):
    from services.shoppers import ShopperService

    f = dump(ShopperService(ctx.db).footfall(ctx.store_id, a.range))
    pts = [{"time": p["time"], "entries": p["entries"], "exits": p["exits"], "previousPeriodEntries": p.get("previousPeriodEntries")} for p in f["points"]]
    peak = max(pts, key=lambda p: p["entries"], default=None)
    data = {"range": a.range, "totalEntries": f["totalEntries"], "totalExits": f["totalExits"], "changePercentage": f["changePercentage"], "points": pts,
            "busiestHour": peak["time"] if peak and peak["entries"] else None, "busiestHourEntries": peak["entries"] if peak and peak["entries"] else None}
    return _result(ctx, data, _meta(f.get("meta")))


def t_zone_analytics(ctx: ToolContext, a: ZoneArgs):
    from services.analytics_read import AnalyticsReadService
    from services.shoppers import ShopperService

    zones = dump(ShopperService(ctx.db).zone_activity(ctx.store_id, a.range))
    dwell = dump(ShopperService(ctx.db).dwell(ctx.store_id, a.range))
    za = AnalyticsReadService(ctx.db, ctx.settings).zone_analytics(ctx.store_id, a.range)
    data = {"range": a.range, "zones": [{k: z.get(k) for k in ("name", "category", "visitors", "currentOccupancy", "capacityLimit", "dwellTimeMinutes", "congestionLevel")} for z in zones[:12]],
            "averageDwellMinutes": dwell.get("averageDwellMinutes"), "measuredZoneVisits": [{"name": i["name"], "visits": i["visits"], "meanDwellSeconds": i["meanDwellSeconds"]} for i in za["items"][:8]]}
    state = "available" if za["items"] or any((z.get("visitors") or 0) > 0 for z in zones) else "unavailable"
    return _result(ctx, data, {"dataState": state, "lastObservationAt": (za.get("meta") or {}).get("lastObservationAt"), "note": None if state == "available" else "No zone visits have been measured.", "sources": ["zone_visits", "dwell_time_aggregates"]})


def t_low_stock(ctx: ToolContext, a: LowStockArgs):
    from services.inventory import InventoryService

    inv = InventoryService(ctx.db)
    shelves = dump(inv.shelves(ctx.store_id))
    low = [s for s in shelves if s["condition"] in ("low_stock", "out_of_stock")]
    low.sort(key=lambda s: (s["condition"] != "out_of_stock", s.get("availabilityPercentage") if s.get("availabilityPercentage") is not None else 101))
    items = [{k: s.get(k) for k in ("id", "shelfCode", "department", "category", "condition", "detectedVisibleUnits", "capacityUnits", "availabilityPercentage", "lastObservationAt", "aisleLocation")} for s in low[: a.limit]]
    meta = _meta(inv.meta(ctx.store_id, inv.shelves(ctx.store_id)))
    unknown = [s["shelfCode"] for s in shelves if s["condition"] in ("uncertain", "camera_offline")]
    return _result(ctx, {"lowOrEmptyShelves": items, "totalLowOrEmpty": len(low), "monitoredShelves": len(shelves), "shelvesWithUnknownStatus": unknown[:10]}, meta)


def t_shelf_details(ctx: ToolContext, a: ShelfArgs):
    from services.inventory import InventoryService

    shelf = find_shelf(ctx, a.shelf)
    inv = InventoryService(ctx.db)
    s = next((x for x in dump(inv.shelves(ctx.store_id)) if x["id"] == shelf.id), None)
    prods = [p for p in dump(inv.products(ctx.store_id)) if p.get("shelfId") == shelf.id]
    data = {"shelf": s, "products": [{k: p.get(k) for k in ("name", "category", "status", "detectedVisibleQty", "expectedVisibleQty", "availabilityPct")} for p in prods[:8]]}
    return _result(ctx, data, {"dataState": "available" if s and s.get("detectedVisibleUnits") is not None else "unavailable", "lastObservationAt": s.get("lastObservationAt") if s else None,
                               "note": None if s and s.get("detectedVisibleUnits") is not None else "This shelf has no recent observation."})


def t_queue_status(ctx: ToolContext, a: CounterArgs):
    from services.queues import QueueService

    q = dump(QueueService(ctx.db).overview(ctx.store_id))
    counters = q["counters"]
    if a.counter:
        c = find_counter(ctx, a.counter)
        counters = [x for x in counters if x["id"] == c.id]
    rules = q["rules"]
    for c in counters:
        c["overSlaCritical"] = c.get("estimatedWaitMinutes") is not None and c["estimatedWaitMinutes"] > rules["slaCriticalWaitMinutes"]
        c["overMaxQueueLength"] = c.get("waitingCustomers") is not None and c["waitingCustomers"] > rules["maxQueueLength"]
    data = {"kpis": q["kpis"], "rules": rules, "counters": [{k: c.get(k) for k in ("id", "name", "counterType", "status", "waitingCustomers", "estimatedWaitMinutes", "congestion", "serviceRatePerMin", "overSlaCritical", "overMaxQueueLength", "lastObservationAt")} for c in counters],
            "queueAlerts": [{k: a_.get(k) for k in ("id", "title", "severity", "status", "counterId", "createdAt")} for a_ in q.get("alerts", [])[:6]]}
    return _result(ctx, data, _meta(q.get("meta")))


def t_queue_forecast(ctx: ToolContext, a: CounterArgs):
    """No forecasting model exists, so no prediction is made. The current measured queue is returned instead so the model can answer honestly."""
    from services.queues import QueueService

    q = dump(QueueService(ctx.db).overview(ctx.store_id))
    counters = q["counters"]
    if a.counter:
        c = find_counter(ctx, a.counter)
        counters = [x for x in counters if x["id"] == c.id]
    data = {"forecastAvailable": False, "reason": "No queue forecasting model exists (it needs 14+ days of real queue history), so nothing is predicted.",
            "currentMeasuredQueue": [{k: c.get(k) for k in ("id", "name", "waitingCustomers", "estimatedWaitMinutes", "lastObservationAt")} for c in counters]}
    return _result(ctx, data, {"dataState": "unavailable", "lastObservationAt": None, "note": data["reason"], "sources": ["queue_observations"]})


def t_camera_status(ctx: ToolContext, a: NoArgs):
    from services.cameras import CameraService

    feeds = dump(CameraService(ctx.db, ctx.settings).feeds(ctx.store_id))
    data = {"cameras": [{k: f.get(k) for k in ("name", "cameraCode", "type", "zone", "status", "errorCode", "message", "inputFps", "inferenceFps", "lastFrameAt", "sourceType", "enabled")} for f in feeds],
            "live": sum(1 for f in feeds if f.get("status") == "live"), "total": len(feeds)}
    return _result(ctx, data, {"dataState": "available" if feeds else "empty", "lastObservationAt": max((f.get("lastFrameAt") for f in feeds if f.get("lastFrameAt")), default=None)})


def t_alerts(ctx: ToolContext, a: AlertArgs):
    from services.alerts import AlertService

    al = dump(AlertService(ctx.db).list(ctx.store_id, status=a.status, severity=a.severity, limit=a.limit))
    items = [{k: x.get(k) for k in ("id", "title", "description", "category", "severity", "status", "zone", "createdAt", "recommendedAction", "taskId")} for x in al["items"]]
    return _result(ctx, {"alerts": items, "totalMatching": al["total"], "filter": {"status": a.status, "severity": a.severity}}, {"dataState": "available" if al["items"] else "empty",
                                                                                                                         "lastObservationAt": items[0]["createdAt"] if items else None})


def t_staff_available(ctx: ToolContext, a: StaffArgs):
    from services.workforce import AvailabilityService

    av = dump(AvailabilityService(ctx.db).availability(ctx.store_id, a.category))
    rows = [{k: r.get(k) for k in ("employeeId", "name", "roleLabel", "department", "status", "onDuty", "scheduledNow", "checkedIn", "activeTasks", "eligibleForCategory", "shift")} for r in av["items"]]
    rows.sort(key=lambda r: (r["status"] != "available", r["activeTasks"]))
    data = {"availableNow": av["availableNow"], "checkedIn": av["checkedIn"], "scheduledNotCheckedIn": av["scheduledNotCheckedIn"], "category": a.category, "staff": rows[:15],
            "basis": av["basis"]}
    return _result(ctx, data, _meta(av.get("meta")), asOf=av["at"])


def t_staff_schedule(ctx: ToolContext, a: ScheduleArgs):
    from services.workforce import ShiftService

    store = ctx.store
    day = date.fromisoformat(a.date) if a.date else now_utc().astimezone(store_tz(store)).date()
    emp = find_employee(ctx, a.employee).id if a.employee else None
    sh = dump(ShiftService(ctx.db).list(ctx.store_id, day, day, emp))
    rows = [{k: s.get(k) for k in ("employeeName", "shiftName", "startTime", "endTime", "overnight", "zone", "status", "shiftDate")} for s in sh["items"]]
    return _result(ctx, {"date": day.isoformat(), "shifts": rows[:25], "count": len(rows)}, {"dataState": "available" if rows else "empty", "note": None if rows else "No shifts are rostered for that day."})


def t_pending_tasks(ctx: ToolContext, a: TaskListArgs):
    from services.tasks import OPEN_STATUSES, TaskService

    out = []
    total = 0
    for st in sorted(OPEN_STATUSES):
        tl = dump(TaskService(ctx.db).list(ctx.store_id, status=st, limit=a.limit))
        total += tl["total"]
        out += tl["items"]
    prio = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    out.sort(key=lambda t: (prio.get(t["priority"], 9), t["createdAt"]))
    items = [{k: t.get(k) for k in ("id", "title", "category", "priority", "status", "assignedEmployeeName", "shelfCode", "counterName", "dueWithin", "createdAt", "source")} for t in out[: a.limit]]
    return _result(ctx, {"openTasks": items, "totalOpen": total}, {"dataState": "available" if items else "empty"})


def t_task_details(ctx: ToolContext, a: TaskDetailArgs):
    from services.tasks import TaskService

    svc = TaskService(ctx.db)
    try:
        t = dump(svc.out(svc.get(a.task_id)))
    except AppError as exc:
        raise ToolError(str(exc.message if hasattr(exc, "message") else exc)) from exc
    if t["storeId"] != ctx.store_id:
        raise ToolError("That task belongs to a different store.")
    hist = dump(svc.history(a.task_id))
    return _result(ctx, {"task": {k: t.get(k) for k in ("id", "title", "description", "category", "priority", "status", "assignedEmployeeName", "shelfCode", "counterName", "dueWithin", "createdAt", "completedAt", "source", "notes")},
                         "history": [{k: h.get(k) for k in ("fromStatus", "toStatus", "createdAt", "note")} for h in hist[-8:]]}, {"dataState": "available"})


def t_insights(ctx: ToolContext, a: NoArgs):
    from services.insights import InsightService
    from services.workforce import RecommendationService

    ins = dump(InsightService(ctx.db, ctx.settings).overview(ctx.store_id))
    recs = dump(RecommendationService(ctx.db).list(ctx.store_id))
    items = [{k: i.get(k) for k in ("id", "title", "category", "severity", "status", "summary", "recommendedAction", "createdAt", "zone")} | {"evidenceTable": (i.get("evidence") or {}).get("metricsTable")} for i in ins["insights"][:8]]
    rec = [{k: r.get(k) for k in ("id", "kind", "title", "reason", "priority", "recommendedAction", "suggestedEmployeeName", "sourceAlertId", "status")} for r in recs["items"][:6]]
    return _result(ctx, {"insights": items, "kpis": ins.get("kpis"), "staffingRecommendations": rec, "recommendationBasis": recs.get("basis")},
                   {"dataState": "available" if items or rec else "empty", "lastObservationAt": items[0]["createdAt"] if items else None, "note": "No active insights." if not (items or rec) else None})


def t_report(ctx: ToolContext, a: ReportArgs):
    from services.report_builder import ReportBuilder

    doc = ReportBuilder(ctx.db).build(ctx.store_id, a.range, "previous_period")
    sec = doc[a.section]
    if a.section == "overview":
        data = {"kpis": sec["kpis"], "keyTrends": sec["keyTrendsSummary"]}
    elif a.section == "shoppers":
        data = {"dailyFootfall": sec["dailyFootfall"][-7:], "zoneDistribution": sec["zoneDistribution"][:6], "peakPeriods": sec["peakShoppingPeriods"], "comparison": sec["footfallComparisonSummary"]}
    elif a.section == "inventory":
        data = {"history": sec["historyTimeline"][-7:], "mostDepleted": sec["depletedShelves"][:6], "byDepartment": sec["departmentShortages"], "taskStats": sec["replenishmentTaskStats"]}
    elif a.section == "queues":
        data = {"history": sec["historyTimeline"][-7:], "counters": sec["counterComparisons"], "alertLog": sec["queueAlertLog"][:6], "summary": sec["overallThroughputSummary"]}
    else:
        data = {"history": sec["historyTimeline"][-7:], "incidents": sec["incidentCategoryBreakdown"], "staff": sec["staffEfficiencySummary"][:8], "summary": sec["overallOperationsSummary"], "cameraUptime": sec["cameraUptimeList"]}
    return _result(ctx, {"section": a.section, "range": a.range, **data, "unavailableFields": doc["unavailableFields"]}, doc["meta"], generatedAt=doc["generatedAt"])


READ_TOOLS: List[Tool] = [
    Tool("get_store_overview", "Current store KPIs: footfall, occupancy, dwell, low-stock and out-of-stock shelves, queues, waits, cameras, open tasks, critical alerts, plus data freshness.", NoArgs, t_overview, "store_reports", "Store Overview", "/"),
    Tool("get_current_footfall", "Today's footfall (entries) and the current occupancy ESTIMATE from entrance line crossings.", NoArgs, t_footfall_now, "shopper_analytics", "Footfall & Occupancy", "/shopper-analytics"),
    Tool("get_footfall_history", "Footfall per hour (today/yesterday) or per day (week/month) with previous-period comparison and the busiest hour.", RangeArgs, t_footfall_history, "shopper_analytics", "Footfall History", "/shopper-analytics"),
    Tool("get_zone_analytics", "Visits, occupancy and dwell time per store zone.", ZoneArgs, t_zone_analytics, "shopper_analytics", "Zone Analytics", "/shopper-analytics"),
    Tool("get_low_stock_shelves", "Shelves whose latest camera observation is low or empty, worst first.", LowStockArgs, t_low_stock, "smart_inventory", "Shelf Observations", "/smart-inventory"),
    Tool("get_shelf_details", "Latest observation, capacity and products of one shelf (by shelf code such as 'B2').", ShelfArgs, t_shelf_details, "smart_inventory", "Shelf Details", "/smart-inventory"),
    Tool("get_queue_status", "Checkout counters: queue length, estimated wait, congestion, SLA rules. Optionally one counter.", CounterArgs, t_queue_status, "queue_intelligence", "Queue Status", "/queue-intelligence"),
    Tool("get_queue_forecast", "Short-term queue length forecast (a persistence baseline, not a learned model).", CounterArgs, t_queue_forecast, "queue_intelligence", "Queue Forecast", "/queue-intelligence"),
    Tool("get_camera_status", "Camera connection state, FPS and errors.", NoArgs, t_camera_status, "live_cameras", "Camera Health", "/"),
    Tool("get_recent_alerts", "Alerts of this store, filterable by status and severity.", AlertArgs, t_alerts, "alerts_tasks", "Alerts", "/"),
    Tool("get_available_staff", "Who is on duty and available (checked in, not busy), optionally filtered to employees eligible for a task category.", StaffArgs, t_staff_available, "alerts_tasks", "Staff Availability", "/staff-management"),
    Tool("get_staff_schedule", "Rostered shifts for a day (default today), optionally one employee.", ScheduleArgs, t_staff_schedule, "alerts_tasks", "Staff Schedule", "/staff-management"),
    Tool("get_pending_tasks", "Open operational tasks (new, assigned, in progress), most urgent first.", TaskListArgs, t_pending_tasks, "alerts_tasks", "Operational Tasks", "/staff-management"),
    Tool("get_task_details", "Details and history of one task by id.", TaskDetailArgs, t_task_details, "alerts_tasks", "Task Details", "/staff-management"),
    Tool("get_operational_insights", "Active AI Insights and derived staffing recommendations with their evidence.", NoArgs, t_insights, "alerts_tasks", "AI Insights", "/ai-insights"),
    Tool("get_store_report", "Historical report section (overview, shoppers, inventory, queues, operations) with previous-period comparison.", ReportArgs, t_report, "store_reports", "Store Report", "/reports"),
]

WRITE_DESCRIPTIONS = {
    "create_replenishment_task": ("Prepare (NOT execute) a replenishment task for a shelf. The user must confirm before anything is created.", ReplenishArgs),
    "assign_staff_task": ("Prepare (NOT execute) assigning an employee to an existing task or to the open replenishment task of a shelf.", AssignArgs),
    "acknowledge_alert": ("Prepare (NOT execute) acknowledging an alert by id.", AckArgs),
    "update_task_status": ("Prepare (NOT execute) moving a task to in_progress, completed or cancelled.", UpdateTaskArgs),
    "create_checkout_assistance_task": ("Prepare (NOT execute) a checkout assistance task for a counter, optionally assigned to an employee.", CheckoutTaskArgs),
}

REGISTRY: Dict[str, Tool] = {t.name: t for t in READ_TOOLS}


def register_write_tools(prepare: Callable[[ToolContext, str, BaseModel], Dict[str, Any]]) -> None:
    mod = {"create_replenishment_task": ("smart_inventory", "Replenishment Task", "/smart-inventory"), "assign_staff_task": ("alerts_tasks", "Task Assignment", "/staff-management"),
           "acknowledge_alert": ("alerts_tasks", "Alert Acknowledgement", "/"), "update_task_status": ("alerts_tasks", "Task Status", "/staff-management"),
           "create_checkout_assistance_task": ("queue_intelligence", "Checkout Assistance", "/queue-intelligence")}
    for name, (desc, model) in WRITE_DESCRIPTIONS.items():
        m = mod[name]
        REGISTRY[name] = Tool(name, desc, model, (lambda n: (lambda ctx, a: prepare(ctx, n, a)))(name), m[0], m[1], m[2], writes=True)


def tool_schemas(enable_writes: bool = True) -> List[Dict[str, Any]]:
    return [t.schema() for t in REGISTRY.values() if enable_writes or not t.writes]


def run_tool(ctx: ToolContext, name: str, raw_args: Dict[str, Any]) -> Dict[str, Any]:
    """Validate and run one tool. Never raises: failures come back as {"error": ...} so the model can explain or retry."""
    tool = REGISTRY.get(name)
    t0 = time.perf_counter()
    if tool is None:
        return {"tool": name, "error": "unknown_tool", "message": f"'{name}' is not an available tool.", "ms": 0}
    try:
        args = tool.args.model_validate(raw_args or {})
    except ValidationError as exc:
        return {"tool": name, "error": "invalid_arguments", "message": "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())[:300], "ms": 0}
    try:
        out = tool.handler(ctx, args)
    except ToolError as exc:
        return {"tool": name, "error": "rejected", "message": str(exc), "ms": round((time.perf_counter() - t0) * 1000, 1)}
    except AppError as exc:
        return {"tool": name, "error": exc.code if hasattr(exc, "code") else "app_error", "message": str(getattr(exc, "message", exc)), "ms": round((time.perf_counter() - t0) * 1000, 1)}
    except Exception as exc:  # noqa: BLE001
        return {"tool": name, "error": "tool_failed", "message": f"{type(exc).__name__}", "ms": round((time.perf_counter() - t0) * 1000, 1)}
    out.update({"tool": name, "module": tool.module, "moduleTitle": tool.title, "targetUrl": tool.url, "ms": round((time.perf_counter() - t0) * 1000, 1)})
    return out


_ = (datetime, timedelta, timezone)
