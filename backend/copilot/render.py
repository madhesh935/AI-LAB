"""Turns TOOL RESULTS into what the existing chat UI renders (grounding sources, KPI/table/queue/shelf/chart payloads, issues, recommendations).

All of this is produced by code from real tool output - the language model only writes the prose. That is what keeps the evidence panel,
the cards and the numbers identical to the dashboards, and it is how the answer text is checked (see `check_grounding`).
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from services.common import now_utc


def ok(r: Dict[str, Any]) -> bool:
    return "error" not in r


def fmt(v: Any, unit: str = "") -> str:
    if v is None:
        return "not available"
    if isinstance(v, float):
        v = round(v, 1)
        if v == int(v):
            v = int(v)
    return f"{v}{unit}"


def when(iso: Optional[str]) -> str:
    if not iso:
        return "no observation yet"
    try:
        d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if d.tzinfo is None:
            from datetime import timezone

            d = d.replace(tzinfo=timezone.utc)
        mins = int((now_utc() - d).total_seconds() // 60)
        if mins < 1:
            return "just now"
        if mins < 90:
            return f"{mins} min ago"
        return d.astimezone().strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return iso


# ------------------------------------------------------------------ deterministic text (used when no model is available, and as the fallback)
def summarize(r: Dict[str, Any]) -> str:
    if not ok(r):
        return f"{r.get('message') or r['error']}"
    t, d = r["tool"], r["data"]
    head = f"{r['storeName']}"
    if r.get("dataState") == "unavailable":
        return f"{head}: {(r.get('note') or 'this data is not available').rstrip('.')}."
    if t == "get_store_overview":
        m = d["metrics"]
        return (f"{head} - footfall today {fmt(m.get('totalFootfallToday'))}, occupancy {fmt(m.get('currentOccupancy'))} of {fmt(m.get('maxCapacity'))}, "
                f"{m.get('lowStockShelvesCount')} low-stock and {m.get('outOfStockShelvesCount')} empty shelves, {m.get('totalCustomersInQueue')} people queuing "
                f"(average wait {fmt(m.get('averageWaitTimeMinutes'), ' min')}), {m.get('camerasOnline')}/{m.get('camerasTotal')} cameras online, "
                f"{m.get('openTasks')} open tasks, {m.get('criticalAlertsCount')} critical alerts.")
    if t == "get_current_footfall":
        return (f"{head} - footfall today: {fmt(d.get('totalFootfallToday'))} entries; estimated people in store now: {fmt(d.get('currentOccupancyEstimate'))} "
                f"({d.get('occupancyStatus') or 'unknown'} estimate). Last crossing: {when(d.get('lastCrossingAt'))}.")
    if t == "get_footfall_history":
        return (f"{head} ({d['range']}) - {d['totalEntries']} entries, {d['totalExits']} exits"
                + (f"; busiest hour {d['busiestHour']} with {d['busiestHourEntries']} entries." if d.get("busiestHour") else "; no hourly peak can be named."))
    if t == "get_zone_analytics":
        zs = sorted(d["zones"], key=lambda z: -(z.get("visitors") or 0))[:3]
        return f"{head} ({d['range']}) - top zones: " + "; ".join(f"{z['name']} ({z.get('visitors', 0)} visits)" for z in zs) + "."
    if t == "get_low_stock_shelves":
        rows = d["lowOrEmptyShelves"]
        if not rows:
            return f"{head} - no shelf is currently low or empty among {d['monitoredShelves']} monitored shelves."
        return f"{head} - {d['totalLowOrEmpty']} shelves need restocking: " + "; ".join(
            f"{s['shelfCode']} ({s['condition'].replace('_', ' ')}, {fmt(s.get('detectedVisibleUnits'))}/{s['capacityUnits']} units, seen {when(s.get('lastObservationAt'))})" for s in rows[:5]) + "."
    if t == "get_shelf_details":
        s = d["shelf"]
        return f"{s['shelfCode']}: {s['condition'].replace('_', ' ')}, {fmt(s.get('detectedVisibleUnits'))}/{s['capacityUnits']} units visible, last observed {when(s.get('lastObservationAt'))}."
    if t in ("get_queue_status", "get_queue_forecast"):
        if t == "get_queue_forecast":
            return f"{head} - " + "; ".join(f"{f['name']}: " + ", ".join(f"+{p['horizonMinutes']} min {p['predictedLength']}" for p in f["forecast"][:3]) for f in d["forecasts"][:4]) + " (persistence baseline)."
        cs = d["counters"]
        hot = [c for c in cs if c["overSlaCritical"] or c["overMaxQueueLength"] or c["congestion"] in ("high", "critical")]
        base = "; ".join(f"{c['name']}: {fmt(c.get('waitingCustomers'))} waiting, wait {fmt(c.get('estimatedWaitMinutes'), ' min')} ({c['congestion']})" for c in cs[:5])
        return f"{head} - " + (f"congested: {', '.join(c['name'] for c in hot)}. " if hot else "no counter is congested. ") + base + "."
    if t == "get_camera_status":
        return f"{head} - {d['live']} of {d['total']} cameras are live" + ("; " + "; ".join(f"{c['name']}: {c['status']}" for c in d["cameras"] if c["status"] != "live")[:300] if d["live"] < d["total"] else "") + "."
    if t == "get_recent_alerts":
        return f"{head} - {d['totalMatching']} {d['filter']['status'] or ''} alerts" + (": " + "; ".join(f"{a['title']} ({a['severity']})" for a in d["alerts"][:4]) if d["alerts"] else "") + "."
    if t == "get_available_staff":
        av = [s for s in d["staff"] if s["status"] == "available"]
        return f"{head} - {d['availableNow']} available now" + (": " + ", ".join(s["name"] for s in av[:6]) if av else "") + f" ({d['checkedIn']} checked in, {d['scheduledNotCheckedIn']} rostered but not checked in)."
    if t == "get_staff_schedule":
        return f"{head} - {d['count']} shifts on {d['date']}" + (": " + "; ".join(f"{s['employeeName']} {s['startTime']}-{s['endTime']}" for s in d["shifts"][:5]) if d["shifts"] else "") + "."
    if t == "get_pending_tasks":
        return f"{head} - {d['totalOpen']} open tasks" + (": " + "; ".join(f"{x['id']} {x['title']} ({x['priority']}, {x['status']})" for x in d["openTasks"][:5]) if d["openTasks"] else "") + "."
    if t == "get_task_details":
        k = d["task"]
        return f"{k['id']} {k['title']}: {k['status']}, assigned to {k.get('assignedEmployeeName') or 'nobody'}, priority {k['priority']}."
    if t == "get_operational_insights":
        return f"{head} - {len(d['insights'])} active insights and {len(d['staffingRecommendations'])} staffing recommendations."
    if t == "get_store_report":
        return f"{head} - {d['section']} report for {d['range']} (see the table)."
    if "preview" in r:
        return r["data"]["description"]
    return head


def evidence(r: Dict[str, Any]) -> str:
    if not ok(r):
        return str(r.get("message"))[:120]
    s = summarize(r)
    return s.split(" - ", 1)[-1][:240]


def grounding_sources(results: Iterable[Dict[str, Any]], range_label: str = "latest") -> List[Dict[str, Any]]:
    out, seen = [], set()
    for r in results:
        if not ok(r) or "preview" in r or r["tool"] in seen:
            continue
        seen.add(r["tool"])
        out.append({
            "module": r["module"], "moduleTitle": r["moduleTitle"], "storeName": r["storeName"],
            "timeRange": (r.get("data") or {}).get("range") or range_label, "lastUpdated": when(r.get("latestObservationAt") or r.get("queriedAt")),
            "telemetryEvidence": evidence(r), "targetUrl": r.get("targetUrl"), "sourceTool": r["tool"], "dataState": r.get("dataState"), "dataMode": r.get("dataMode"),
        })
    return out


# ------------------------------------------------------------------ rich payloads
def rich_payload(results: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    by = {r["tool"]: r for r in results if ok(r) and "tool" in r and r.get("dataState") != "unavailable"}
    if "get_queue_status" in by:
        d = by["get_queue_status"]["data"]
        return {"type": "queue_status", "title": "Checkout counters", "data": [{"id": c["id"], "name": c["name"], "queue": c.get("waitingCustomers"), "wait": c.get("estimatedWaitMinutes"),
                                                                                "status": "congested" if (c["overSlaCritical"] or c["overMaxQueueLength"] or c["congestion"] in ("high", "critical")) else (c["status"] if c["status"] != "open" else "normal")}
                                                                               for c in d["counters"]]}
    if "get_low_stock_shelves" in by and by["get_low_stock_shelves"]["data"]["lowOrEmptyShelves"]:
        return {"type": "shelf_cards", "title": "Shelves needing attention", "data": [{"shelfId": s["id"], "shelfCode": s["shelfCode"], "productName": s.get("category") or s["shelfCode"], "stock": s.get("detectedVisibleUnits"),
                                                                                       "camera": "latest observation " + when(s.get("lastObservationAt"))} for s in by["get_low_stock_shelves"]["data"]["lowOrEmptyShelves"]]}
    if "get_footfall_history" in by and by["get_footfall_history"]["data"]["points"]:
        d = by["get_footfall_history"]["data"]
        return {"type": "footfall_chart", "title": f"Footfall ({d['range']})", "data": [{"hour": p["time"], "entries": p["entries"], "exits": p["exits"]} for p in d["points"]]}
    if "get_available_staff" in by:
        return {"type": "staff_list", "title": "Staff availability", "data": [{k: s.get(k) for k in ("name", "roleLabel", "status", "activeTasks", "eligibleForCategory", "shift")} for s in by["get_available_staff"]["data"]["staff"][:8]]}
    if "get_recent_alerts" in by and by["get_recent_alerts"]["data"]["alerts"]:
        return {"type": "alerts_list", "title": "Alerts", "data": [{k: a.get(k) for k in ("id", "title", "severity", "status", "zone", "createdAt")} for a in by["get_recent_alerts"]["data"]["alerts"]]}
    if "get_pending_tasks" in by and by["get_pending_tasks"]["data"]["openTasks"]:
        return {"type": "tasks_table", "title": "Open tasks", "data": by["get_pending_tasks"]["data"]["openTasks"]}
    if "get_current_footfall" in by:
        d = by["get_current_footfall"]["data"]
        return {"type": "kpi_summary", "title": "Footfall", "data": [{"label": "Entries today", "value": d.get("totalFootfallToday")}, {"label": "In store now (estimate)", "value": d.get("currentOccupancyEstimate")},
                                                                      {"label": "Capacity", "value": d.get("capacity")}]}
    if "get_store_overview" in by:
        m = by["get_store_overview"]["data"]["metrics"]
        return {"type": "kpi_summary", "title": "Store overview", "data": [{"label": "Footfall today", "value": m.get("totalFootfallToday")}, {"label": "Occupancy", "value": m.get("currentOccupancy")},
                                                                         {"label": "Low-stock shelves", "value": m.get("lowStockShelvesCount")}, {"label": "Empty shelves", "value": m.get("outOfStockShelvesCount")},
                                                                         {"label": "People in queues", "value": m.get("totalCustomersInQueue")}, {"label": "Avg wait (min)", "value": m.get("averageWaitTimeMinutes")},
                                                                         {"label": "Critical alerts", "value": m.get("criticalAlertsCount")}, {"label": "Open tasks", "value": m.get("openTasks")}]}
    return None


def structured_issues(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """'What needs my attention': one issue card per real problem found in the tool results."""
    issues: List[Dict[str, Any]] = []
    by = {r["tool"]: r for r in results if ok(r) and "tool" in r}
    al = by.get("get_recent_alerts")
    if al:
        for a in al["data"]["alerts"][:4]:
            sev = a["severity"]
            issues.append({"title": a["title"], "priority": "High Priority" if sev == "critical" else "Medium Priority", "priorityVariant": "rose" if sev == "critical" else "amber",
                           "bullets": [b for b in (a.get("description"), f"Raised {when(a.get('createdAt'))}" if a.get("createdAt") else None, a.get("recommendedAction")) if b], "actionQuery": None})
    q = by.get("get_queue_status")
    if q:
        for c in q["data"]["counters"]:
            if c["overSlaCritical"] or c["overMaxQueueLength"]:
                issues.append({"title": f"{c['name']} queue over the limit", "priority": "Medium Priority", "priorityVariant": "amber",
                               "bullets": [f"{fmt(c.get('waitingCustomers'))} waiting; estimated wait {fmt(c.get('estimatedWaitMinutes'), ' min')} (critical limit {q['data']['rules']['slaCriticalWaitMinutes']} min, max length {q['data']['rules']['maxQueueLength']})."],
                               "actionQuery": f"Show queue analytics for {c['name']}"})
    s = by.get("get_low_stock_shelves")
    if s:
        for sh in s["data"]["lowOrEmptyShelves"][:3]:
            empty = sh["condition"] == "out_of_stock"
            issues.append({"title": f"{sh['shelfCode']} {'is empty' if empty else 'is running low'}", "priority": "High Priority" if empty else "Medium Priority", "priorityVariant": "rose" if empty else "amber",
                           "bullets": [f"{fmt(sh.get('detectedVisibleUnits'))} of {sh['capacityUnits']} units visible, observed {when(sh.get('lastObservationAt'))}."], "actionQuery": f"Create a replenishment task for {sh['shelfCode']}"})
    seen, out = set(), []
    for i in issues:
        if i["title"] in seen:
            continue
        seen.add(i["title"])
        out.append({"num": len(out) + 1, **i})
    return out[:5]


def recommended_actions(results: List[Dict[str, Any]]) -> List[str]:
    """Each recommendation names its source observation, timestamp and triggering condition. No predicted improvements are ever stated."""
    out: List[str] = []
    by = {r["tool"]: r for r in results if ok(r) and "tool" in r}
    s = by.get("get_low_stock_shelves")
    if s:
        for sh in s["data"]["lowOrEmptyShelves"][:3]:
            out.append(f"Restock {sh['shelfCode']} - camera observation {when(sh.get('lastObservationAt'))}: {fmt(sh.get('detectedVisibleUnits'))}/{sh['capacityUnits']} units ({sh['condition'].replace('_', ' ')}).")
    q = by.get("get_queue_status")
    if q:
        rules = q["data"]["rules"]
        for c in q["data"]["counters"]:
            if c["overSlaCritical"] or c["overMaxQueueLength"]:
                why = f"wait {fmt(c.get('estimatedWaitMinutes'), ' min')} > {rules['slaCriticalWaitMinutes']} min" if c["overSlaCritical"] else f"{c.get('waitingCustomers')} waiting > {rules['maxQueueLength']}"
                out.append(f"Consider opening or assisting another checkout for {c['name']} - trigger: {why} (observed {when(c.get('lastObservationAt'))}).")
    ins = by.get("get_operational_insights")
    if ins:
        for r_ in ins["data"]["staffingRecommendations"][:3]:
            out.append(f"{r_['title']} - {r_['reason']}" + (f" Suggested: {r_['suggestedEmployeeName']}." if r_.get("suggestedEmployeeName") else ""))
        for i in ins["data"]["insights"][:2]:
            if i.get("recommendedAction"):
                out.append(f"{i['recommendedAction']} (insight '{i['title']}', {when(i.get('createdAt'))}).")
    return out[:6]


def follow_ups(results: List[Dict[str, Any]]) -> List[str]:
    tools = {r.get("tool") for r in results}
    out: List[str] = []
    if "get_low_stock_shelves" in tools:
        out.append("Who is available to restock?")
    if "get_queue_status" in tools:
        out.append("Show the queue forecast")
    if "get_available_staff" in tools:
        out.append("Which tasks are still open?")
    if "get_recent_alerts" in tools:
        out.append("Which shelves need restocking?")
    for q in ("What needs my attention now?", "What is today's footfall?", "Which checkout counter is congested?"):
        if len(out) < 3 and q not in out:
            out.append(q)
    return out[:4]


# ------------------------------------------------------------------ grounding check
_NUM = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)(?![\w])")
_THOUSANDS = re.compile(r"(?<=\d),(?=\d{3}(?!\d))")
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}")
_CLOCK = re.compile(r"\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}")


def _collect(node: Any, nums: Set[float]) -> None:
    if isinstance(node, bool):
        return
    if isinstance(node, (int, float)):
        nums.add(round(float(node), 2))
        nums.add(round(float(node)))
    elif isinstance(node, str):
        if _ISO.match(node):
            return  # a timestamp's digits are not measurements (they must not whitelist other numbers)
        for m in re.finditer(r"\d+(?:\.\d+)?", node):
            try:
                nums.add(round(float(m.group()), 2))
            except ValueError:
                pass
    elif isinstance(node, dict):
        for v in node.values():
            _collect(v, nums)
    elif isinstance(node, list):
        nums.add(float(len(node)))
        for v in node:
            _collect(v, nums)


def allowed_numbers(results: List[Dict[str, Any]], extra_text: str = "") -> Set[float]:
    nums: Set[float] = set()
    for r in results:
        _collect({k: v for k, v in r.items() if k not in ("ms",)}, nums)
    for m in re.finditer(r"\d+(?:\.\d+)?", extra_text):
        nums.add(round(float(m.group()), 2))
    return nums


def check_grounding(answer: str, results: List[Dict[str, Any]], user_text: str = "", now_text: str = "") -> Tuple[bool, List[str]]:
    """Every number in the answer must appear in a tool result (or in the user's own question). Returns (ok, offending numbers)."""
    allowed = allowed_numbers(results, user_text)
    bad: List[str] = []
    answer = _THOUSANDS.sub("", answer)  # "1,038" is one number
    # Times/dates the model quotes (the store clock from its prompt, or a timestamp from a tool result) are fine; their digits never whitelist other numbers.
    clock_source = now_text + " " + json.dumps(results, default=str)
    for tok in set(_CLOCK.findall(clock_source)):
        answer = answer.replace(tok, " ")
    for m in _NUM.finditer(answer):
        raw = m.group(1)
        try:
            v = float(raw)
        except ValueError:
            continue
        if round(v, 2) in allowed or round(v) in allowed or any(abs(v - a) < 0.051 for a in allowed):
            continue
        bad.append(raw)
    return (not bad, bad)
