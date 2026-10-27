"""Aggregate reports computed from stored observations. Nothing is synthesised:
categories with no source rows return empty series with meta.dataState='unavailable'."""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, List

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.errors import NotFoundError
from database.models import (
    Alert,
    Attendance,
    CheckoutCounter,
    QueueObservation,
    ReportConfiguration,
    ShelfObservation,
    Task,
)
from repositories.base import get_or_404
from repositories.platform import ReportRepository
from schemas.common import Meta
from schemas.platform import ReportConfigCreate, ReportConfigOut, ReportOut
from services.common import get_store_or_404, now_utc, pct_change, resolve_window, store_tz
from services.shoppers import ShopperService

CATEGORIES = ("overview", "shoppers", "inventory", "queues", "operations")


class ReportService:
    def __init__(self, db: Session):
        self.db = db

    # --------------------------------------------------------------- builders
    def build(self, store_id: str, category: str, range_key: str = "today", compare: str = "none") -> ReportOut:
        if category not in CATEGORIES:
            raise NotFoundError("Report category", category)
        store = get_store_or_404(self.db, store_id)
        window = resolve_window(store, range_key)
        builder = getattr(self, f"_{category}")
        summary, series, sources = builder(store, window, compare)
        has_rows = any(series.values()) or any(isinstance(v, (int, float)) and v for v in summary.values())
        meta = Meta(
            data_state="available" if has_rows else "unavailable",
            sources=sources if has_rows else [],
            note=None if has_rows else "No observations have been recorded for this report yet.",
        )
        return ReportOut(
            store_id=store_id,
            category=category,
            range=window.label,
            compare_period=compare,
            generated_at=now_utc(),
            summary=summary,
            series=series,
            meta=meta,
        )

    def _count(self, model, store_id: str, start: datetime, end: datetime, ts_col, *extra) -> int:
        stmt = select(func.count()).select_from(model).where(model.store_id == store_id).where(ts_col >= start).where(ts_col < end)
        for cond in extra:
            stmt = stmt.where(cond)
        return self.db.scalar(stmt) or 0

    def _shoppers(self, store, w, compare):
        svc = ShopperService(self.db)
        current = svc.footfall(store.id, w.label)
        dwell = svc.dwell(store.id, w.label)
        prev_total = sum(p.previous_period_entries for p in current.points)
        summary = {
            "totalEntries": current.total_entries,
            "totalExits": current.total_exits,
            "changePct": pct_change(current.total_entries, prev_total) if compare != "none" else None,
            "averageDwellMinutes": dwell.average_dwell_minutes,
        }
        series = {
            "hourlyFootfall": [{"time": p.time, "entries": p.entries, "exits": p.exits, "previousEntries": p.previous_period_entries} for p in current.points],
            "zoneDwell": [d.model_dump(by_alias=True) for d in dwell.items],
        }
        return summary, series, ["footfall_aggregates", "dwell_time_aggregates"]

    def _inventory(self, store, w, compare):
        tz = store_tz(store)
        rows = self.db.execute(
            select(ShelfObservation.observed_at, ShelfObservation.detected_units)
            .where(ShelfObservation.store_id == store.id)
            .where(ShelfObservation.observed_at >= w.start)
            .where(ShelfObservation.observed_at < w.end)
        ).all()
        by_day: Dict[str, Dict[str, int]] = defaultdict(lambda: {"observations": 0, "emptyEvents": 0})
        for ts, units in rows:
            key = ts.astimezone(tz).date().isoformat()
            by_day[key]["observations"] += 1
            by_day[key]["emptyEvents"] += 1 if units == 0 else 0
        tasks_created = self._count(Task, store.id, w.start, w.end, Task.created_at, Task.shelf_id.is_not(None))
        tasks_done = self._count(Task, store.id, w.start, w.end, Task.completed_at, Task.shelf_id.is_not(None), Task.status == "completed")
        summary = {
            "observations": len(rows),
            "emptyShelfEvents": sum(d["emptyEvents"] for d in by_day.values()),
            "restockTasksCreated": tasks_created,
            "restockTasksCompleted": tasks_done,
        }
        series = {"daily": [{"date": k, **v} for k, v in sorted(by_day.items())]}
        return summary, series, ["shelf_observations", "tasks"]

    def _queues(self, store, w, compare):
        tz = store_tz(store)
        rows = self.db.execute(
            select(QueueObservation.observed_at, QueueObservation.counter_id, QueueObservation.queue_length, QueueObservation.estimated_wait_seconds)
            .where(QueueObservation.store_id == store.id)
            .where(QueueObservation.observed_at >= w.start)
            .where(QueueObservation.observed_at < w.end)
        ).all()
        hourly: Dict[str, List[float]] = defaultdict(list)
        per_counter: Dict[str, List[float]] = defaultdict(list)
        for ts, counter_id, length, wait in rows:
            if wait is not None:
                hourly[ts.astimezone(tz).strftime("%H:00")].append(wait / 60)
                per_counter[counter_id].append(wait / 60)
        names = {c.id: c.name for c in self.db.scalars(select(CheckoutCounter).where(CheckoutCounter.store_id == store.id)).all()}
        all_waits = [x for v in hourly.values() for x in v]
        summary = {
            "observations": len(rows),
            "averageWaitMinutes": round(sum(all_waits) / len(all_waits), 1) if all_waits else None,
            "longestWaitMinutes": round(max(all_waits), 1) if all_waits else None,
            "queueAlerts": self._count(Alert, store.id, w.start, w.end, Alert.created_at, Alert.module == "queue"),
        }
        series = {
            "hourlyWait": [{"time": h, "averageWaitMinutes": round(sum(v) / len(v), 1)} for h, v in sorted(hourly.items())],
            "counters": [{"counterId": c, "name": names.get(c, c), "averageWaitMinutes": round(sum(v) / len(v), 1)} for c, v in per_counter.items()],
        }
        return summary, series, ["queue_observations", "alerts"]

    def _operations(self, store, w, compare):
        alert_rows = self.db.execute(
            select(Alert.category, Alert.status, func.count())
            .where(Alert.store_id == store.id).where(Alert.created_at >= w.start).where(Alert.created_at < w.end)
            .group_by(Alert.category, Alert.status)
        ).all()
        task_rows = self.db.execute(
            select(Task.status, func.count()).where(Task.store_id == store.id).where(Task.created_at >= w.start).where(Task.created_at < w.end).group_by(Task.status)
        ).all()
        tz = store_tz(store)
        att = self.db.execute(
            select(Attendance.status, func.count())
            .where(Attendance.store_id == store.id)
            .where(Attendance.work_date >= w.start.astimezone(tz).date()).where(Attendance.work_date <= w.end.astimezone(tz).date())
            .group_by(Attendance.status)
        ).all()
        total_alerts = sum(r[2] for r in alert_rows)
        resolved = sum(r[2] for r in alert_rows if r[1] == "resolved")
        summary = {
            "alerts": total_alerts,
            "alertsResolved": resolved,
            "resolutionRatePct": round(resolved / total_alerts * 100, 1) if total_alerts else None,
            "tasksCreated": sum(r[1] for r in task_rows),
            "tasksCompleted": sum(r[1] for r in task_rows if r[0] == "completed"),
        }
        series = {
            "alertsByCategory": [{"category": r[0], "status": r[1], "count": r[2]} for r in alert_rows],
            "tasksByStatus": [{"status": r[0], "count": r[1]} for r in task_rows],
            "attendance": [{"status": r[0], "count": r[1]} for r in att],
        }
        return summary, series, ["alerts", "tasks", "attendance"]

    def _overview(self, store, w, compare):
        s_sum, s_series, _ = self._shoppers(store, w, compare)
        q_sum, _, _ = self._queues(store, w, compare)
        o_sum, _, _ = self._operations(store, w, compare)
        i_sum, _, _ = self._inventory(store, w, compare)
        summary = {
            "totalEntries": s_sum["totalEntries"],
            "averageDwellMinutes": s_sum["averageDwellMinutes"],
            "averageWaitMinutes": q_sum["averageWaitMinutes"],
            "emptyShelfEvents": i_sum["emptyShelfEvents"],
            "tasksCompleted": o_sum["tasksCompleted"],
            "alerts": o_sum["alerts"],
        }
        return summary, {"hourlyFootfall": s_series["hourlyFootfall"]}, ["footfall_aggregates", "queue_observations", "shelf_observations", "alerts", "tasks"]

    # ------------------------------------------------- saved configurations
    def configs(self, store_id: str) -> List[ReportConfigOut]:
        get_store_or_404(self.db, store_id)
        return [ReportConfigOut.model_validate(c) for c in ReportRepository(self.db).configs(store_id)]

    def save_config(self, store_id: str, body: ReportConfigCreate) -> ReportConfigOut:
        get_store_or_404(self.db, store_id)
        cfg = ReportConfiguration(id=f"RPT-{uuid.uuid4().hex[:8].upper()}", store_id=store_id, **body.model_dump())
        self.db.add(cfg)
        self.db.flush()
        return ReportConfigOut.model_validate(cfg)

    def delete_config(self, config_id: str) -> None:
        cfg = get_or_404(self.db, ReportConfiguration, config_id, "Report configuration")
        self.db.delete(cfg)
        self.db.flush()
