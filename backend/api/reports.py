from __future__ import annotations

from typing import List

import csv
import io
from typing import Any, Dict

from fastapi import APIRouter, Query, Response

from api.deps import DbSession
from core.errors import ConfirmationRequiredError, NotFoundError
from schemas.platform import ReportConfigCreate, ReportConfigOut, ReportOut
from services.report_builder import ReportBuilder
from services.reports import ReportService

router = APIRouter(prefix="/api/stores/{store_id}/reports", tags=["reports"])
config_router = APIRouter(prefix="/api/report-configurations", tags=["reports"])


# NOTE: declared before "/{category}" so "configurations" is not captured as a category.
@router.get("/configurations", response_model=List[ReportConfigOut])
def list_configs(store_id: str, db: DbSession):
    return ReportService(db).configs(store_id)


@router.post("/configurations", response_model=ReportConfigOut, status_code=201)
def save_config(store_id: str, body: ReportConfigCreate, db: DbSession):
    return ReportService(db).save_config(store_id, body)


RANGE = Query("today", pattern="^(today|yesterday|week|month|7d|30d)$")
COMPARE = Query("previous_period", pattern="^(none|previous_period|previous_year)$")

# CSV tables per exported report: (title, path into the summary document)
EXPORT_TABLES = {
    "overview": [("Key metrics", ("overview", "kpis")), ("Trend", ("overview", "multiMetricTrends"))],
    "shoppers": [("Daily footfall", ("shoppers", "dailyFootfall")), ("Hourly trend", ("shoppers", "hourlyTrends")), ("Zones", ("shoppers", "zoneDistribution"))],
    "inventory": [("History", ("inventory", "historyTimeline")), ("Depleted shelves", ("inventory", "depletedShelves")), ("Stock-out log", ("inventory", "stockoutLog"))],
    "queues": [("History", ("queues", "historyTimeline")), ("Hourly", ("queues", "hourlyQueueTrends")), ("Counters", ("queues", "counterComparisons")),
               ("Alert log", ("queues", "queueAlertLog"))],
    "operations": [("History", ("operations", "historyTimeline")), ("Event log", ("operations", "operationsEventLog"))],
    "staff_tasks": [("Staff task performance", ("operations", "staffEfficiencySummary"))],
    "alert_history": [("Alert history", ("operations", "operationsEventLog")), ("By category", ("operations", "incidentCategoryBreakdown"))],
    "camera_availability": [("Camera availability", ("operations", "cameraUptimeList"))],
}


def _cell(v: Any) -> Any:
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v  # spreadsheet formula injection guard
    return "" if v is None else v


def _rows(node: Any):
    if isinstance(node, list):
        return node
    if isinstance(node, dict):  # KPI object -> one row per metric
        return [{"metric": k, **v} for k, v in node.items() if isinstance(v, dict)]
    return []


# NOTE: also before "/{category}".
@router.get("/summary/full")
def report_summary(store_id: str, db: DbSession, range: str = RANGE, compare: str = COMPARE) -> Dict[str, Any]:
    """Everything the Reports page needs in one document (derived from stored records only)."""
    return ReportBuilder(db).build(store_id, range, compare)


@router.get("/export/{category}.csv")
def report_csv(store_id: str, category: str, db: DbSession, range: str = RANGE, compare: str = COMPARE):
    if category not in EXPORT_TABLES:
        raise NotFoundError("Report category", category)
    doc = ReportBuilder(db).build(store_id, range, compare)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["RetailEdge AI report", category, "store", doc["storeName"], "range", range, "generated", doc["generatedAt"], "dataMode", doc["dataMode"]])
    for title, path in EXPORT_TABLES[category]:
        node: Any = doc
        for k in path:
            node = node[k]
        rows = _rows(node)
        w.writerow([])
        w.writerow([title])
        if not rows:
            w.writerow(["no records in this period"])
            continue
        cols = list(rows[0].keys())
        w.writerow(cols)
        for r in rows:
            w.writerow([_cell(r.get(c)) for c in cols])
    return Response(content="﻿" + out.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="retailedge-{category}-{range}.csv"'})


@router.get("/{category}", response_model=ReportOut)
def report(store_id: str, category: str, db: DbSession, range: str = Query("today"), compare: str = Query("none", pattern="^(none|previous_period|previous_year)$")):
    return ReportService(db).build(store_id, category, range, compare)


@config_router.delete("/{config_id}", status_code=204)
def delete_config(config_id: str, db: DbSession, confirm: bool = Query(False)):
    if not confirm:
        raise ConfirmationRequiredError("a saved report configuration")
    ReportService(db).delete_config(config_id)
    return Response(status_code=204)
