from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from database.models import QueueObservation, ShelfObservation, Store
from sqlalchemy import func, select
from services.analytics_read import AnalyticsReadService
from repositories.operations import AlertRepository, TaskRepository
from repositories.telemetry import CameraRepository, ShopperRepository
from schemas.common import Meta
from schemas.monitoring import (
    OverviewOut,
    StoreMetricsOut,
    StoreOut,
    SystemConnectionOut,
)
from services.alerts import AlertService
from services.cameras import LIVE_STATES, CameraService
from services.common import get_store_or_404, pct_change, resolve_window, now_utc
from services.inventory import InventoryService
from services.queues import QueueService
from services.shoppers import ShopperService


def store_out(store: Store) -> StoreOut:
    return StoreOut(
        id=store.id,
        name=store.name,
        code=store.code,
        city=store.city,
        region=store.region,
        address=store.address,
        square_footage=store.square_footage,
        max_capacity=store.max_capacity,
        open_time=store.open_time,
        close_time=store.close_time,
        manager_name=store.manager_name,
        edge_server_status=store.edge_server_status,
        data_mode=store.data_mode,
    )


class OverviewService:
    def __init__(self, db: Session):
        self.db = db

    def build(self, store_id: str, range_key: str = "today") -> OverviewOut:
        store = get_store_or_404(self.db, store_id)
        window = resolve_window(store, range_key)

        shoppers = ShopperService(self.db)
        cameras_svc = CameraService(self.db)
        inventory = InventoryService(self.db)
        queues = QueueService(self.db)

        analytics = shoppers.analytics(store_id, range_key)
        footfall = shoppers.footfall(store_id, range_key)
        feeds = cameras_svc.feeds(store_id)
        shelves = inventory.shelves(store_id)
        counters = queues.counters(store_id)
        q_kpis = queues.kpis(counters)
        alerts = AlertService(self.db).list(store_id, status="active", limit=20).items

        has_footfall = footfall.meta.data_state == "available"
        occ = AnalyticsReadService(self.db).occupancy(store_id)
        # People visible to the live cameras right now: a direct measurement. Cameras may overlap (or share one physical webcam), so the highest
        # single-camera count is used - never the sum - and it is labelled as "in view" rather than a store-wide head count.
        in_view = [f.people_count for f in feeds if f.status in LIVE_STATES and f.people_count is not None]
        if in_view:
            occupancy, occ_status, occ_basis = max(in_view), "ok", "people_in_view"
        elif occ["estimate"] is not None:
            occupancy, occ_status, occ_basis = occ["estimate"], occ["status"], "crossing_estimate"
        elif has_footfall and footfall.points:  # aggregates without a crossing-state row (e.g. seeded fixtures): the plain running sum
            occupancy, occ_status, occ_basis = footfall.points[-1].occupancy, "uncertain", "footfall_running_sum"
        else:
            occupancy, occ_status, occ_basis = None, None, None
        mini = [p.entries for p in footfall.points][-12:]
        live = sum(1 for f in feeds if f.status in LIVE_STATES)

        availability: Dict[str, str] = {
            "footfall": footfall.meta.data_state,
            "occupancy": "available" if occupancy is not None else "unavailable",
            "dwell": "available" if analytics.average_visit_duration_minutes is not None else "unavailable",
            "inventory": inventory.meta(store_id, shelves).data_state,
            "queues": queues.meta(store_id, counters).data_state,
            "cameras": cameras_svc.meta(store_id, feeds).data_state,
        }

        measured = [c for c in counters if c.waiting_customers is not None and c.status == "open"]
        queued = [c for c in measured if (c.waiting_customers or 0) > 0]
        active_queues = len(queued)  # lanes that currently have a queue (not the number of open lanes)
        waits = [c.estimated_wait_minutes for c in queued if c.estimated_wait_minutes is not None]
        if queued:
            avg_wait = round(sum(waits) / len(waits), 1) if waits else None  # None = a queue exists but no wait can be estimated from measured rates
        else:
            avg_wait = 0.0 if measured else None  # nobody is waiting; unknown if no lane is being measured

        metrics = StoreMetricsOut(
            total_footfall_today=footfall.total_entries if has_footfall else None,
            footfall_change_percentage=footfall.change_percentage if has_footfall else None,
            footfall_history_mini=mini,
            current_occupancy=occupancy,
            occupancy_status=occ_status,
            occupancy_basis=occ_basis,
            max_capacity=store.max_capacity,
            occupancy_percentage=round(occupancy / store.max_capacity * 100, 1) if occupancy is not None and store.max_capacity else None,
            average_dwell_time_minutes=analytics.average_visit_duration_minutes,
            low_stock_shelves_count=sum(1 for s in shelves if s.condition == "low_stock"),
            out_of_stock_shelves_count=sum(1 for s in shelves if s.condition == "out_of_stock"),
            critical_inventory_alerts_count=sum(1 for a in alerts if a.module == "inventory" and a.severity == "critical"),
            active_checkout_queues_count=active_queues,
            total_customers_in_queue=q_kpis.customers_waiting,
            overall_queue_status=max((c.congestion for c in counters), key=["optimal", "moderate", "high", "critical"].index, default="optimal"),
            average_wait_time_minutes=avg_wait,
            cameras_online=live,
            cameras_total=len(feeds),
            open_tasks=TaskRepository(self.db).open_count(store_id),
            active_alerts=len(alerts),
            critical_alerts_count=sum(1 for a in alerts if a.severity == "critical"),
        )

        heartbeats = [f.last_frame_at for f in feeds if f.last_frame_at]
        last_inf = CameraRepository(self.db).last_inference_at(store_id)
        latest = max(heartbeats + ([last_inf] if last_inf else []), default=None)
        fps = [f.fps for f in feeds if f.fps is not None and f.status in LIVE_STATES]
        connection = SystemConnectionOut(
            status=store.edge_server_status,
            latency_ms=None,
            last_heartbeat=latest,
            edge_server_id=f"edge-{store.code.lower()}",
            edge_model_version=None,
            fps_average=round(sum(fps) / len(fps), 1) if fps else None,
            active_cameras=live,
            total_cameras=len(feeds),
        )

        freshness, quality = self._freshness(store, feeds, shelves, counters, footfall, occ, inventory, queues, latest)
        metrics.latest_observation_at = max((v["lastObservationAt"] for v in freshness.values() if v["lastObservationAt"]), default=None)
        any_available = any(v == "available" for v in availability.values())
        meta = Meta(
            data_state="available" if any_available else "unavailable",
            last_observation_at=latest,
            sources=[k for k, v in availability.items() if v == "available"],
            note=None if any_available else "No vision pipeline has reported data for this store yet.",
        )
        return OverviewOut(
            store=store_out(store),
            metrics=metrics,
            cameras=feeds,
            analytics=analytics,
            shelves=shelves,
            queues=counters,
            alerts=alerts,
            connection=connection,
            last_updated=now_utc(),
            meta=meta,
            data_availability=availability,
            data_mode=store.data_mode,
            freshness=freshness,
            data_quality=quality,
        )

    # ---------------------------------------------------------------- freshness
    STALE_AFTER = {"footfall": 900, "occupancy": 900, "shelves": 1800, "queues": 120, "cameras": 90}

    def _freshness(self, store, feeds, shelves, counters, footfall, occ, inventory, queues, cam_latest):
        now = now_utc()
        shelf_at = self.db.scalar(select(func.max(ShelfObservation.observed_at)).where(ShelfObservation.store_id == store.id))
        queue_at = self.db.scalar(select(func.max(QueueObservation.observed_at)).where(QueueObservation.store_id == store.id))
        foot_at = footfall.meta.last_observation_at
        occ_at = datetime.fromisoformat(occ["lastEventAt"]) if occ.get("lastEventAt") else None
        stamps = {"footfall": foot_at, "occupancy": occ_at, "shelves": shelf_at, "queues": queue_at, "cameras": cam_latest}
        fresh: Dict[str, Dict[str, Any]] = {}
        for k, at in stamps.items():
            if at is None:
                fresh[k] = {"lastObservationAt": None, "ageSeconds": None, "state": "unavailable"}
                continue
            age = int((now - at).total_seconds())
            fresh[k] = {"lastObservationAt": at, "ageSeconds": age, "state": "fresh" if age <= self.STALE_AFTER[k] else "stale"}
        if store.data_mode == "demo":
            for v in fresh.values():
                v["note"] = "seeded demo fixture"
        notes: List[Dict[str, Any]] = []
        if store.data_mode == "demo":
            notes.append({"module": "all", "level": "info", "message": "DEMO store: every value comes from seeded fixtures, not from cameras."})
        if occ["status"] in ("uncertain", "stale", "unknown") and occ["estimate"] is not None:
            notes.append({"module": "occupancy", "level": "warning", "message": f"Occupancy is an estimate ({occ['status']}): {occ['reason']}"})
        if not occ["entranceCameras"]:
            notes.append({"module": "occupancy", "level": "info", "message": "No entrance counting line is configured, so footfall and occupancy are unavailable."})
        for f in feeds:
            if f.status not in ("live", "buffering") and f.enabled:
                notes.append({"module": "cameras", "level": "warning", "message": f"{f.name} is {f.status}" + (f" ({f.error_code})" if f.error_code else "")})
        if inventory.meta(store.id, shelves).data_state == "unavailable":
            m = AnalyticsReadService(self.db).shelf_model_status()
            notes.append({"module": "inventory", "level": "info" if m["ready"] else "warning",
                          "message": "No shelf observations yet." if m["ready"] else "MODEL_NOT_CONFIGURED: no validated shelf model is loaded, so shelf counts are not produced."})
        assumed = [c for c in AnalyticsReadService(self.db).queue_status(store.id)["counters"] if c["wait"]["basis"] == "assumption"]
        if assumed:
            notes.append({"module": "queues", "level": "info", "message": f"{len(assumed)} wait estimate(s) use a configured assumption, not a measured service rate."})
        for k, v in fresh.items():
            if v["state"] == "stale":
                notes.append({"module": k, "level": "warning", "message": f"{k} data is stale (last update {v['ageSeconds'] // 60} min ago)"})
        return fresh, notes
