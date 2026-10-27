"""Read-side analytics: occupancy, dwell statistics, heatmaps, movement, queue status/history/forecast, inventory observations."""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from analytics.geometry import apply_homography
from analytics.occupancy import Occupancy, OccupancyEstimator
from analytics.waittime import estimate_wait
from core.config import Settings, get_settings
from core.errors import InvalidStateError, NotFoundError
from database.models import (
    Camera, CameraCalibration, CameraStatus, CameraZone, CheckoutCounter, DomainEvent, FootfallEvent, HeatmapCell, ModelRegistry,
    MovementAggregate, OccupancyState, QueueForecast, QueueObservation, QueueRegion, QueueServiceSample, Shelf, ShelfObservation,
    ShelfRegion, Store, StoreZone, ZoneVisit,
)
from services.common import TimeWindow, get_store_or_404, now_utc, resolve_window, store_tz


def meta(state: str, note: Optional[str] = None, last: Optional[datetime] = None, sources: Optional[List[str]] = None) -> Dict[str, Any]:
    return {"dataState": state, "note": note, "lastObservationAt": last.isoformat() if last else None, "sources": sources or []}


def percentile(values: List[float], p: float) -> Optional[float]:
    if not values:
        return None
    s = sorted(values)
    k = (len(s) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


class AnalyticsReadService:
    def __init__(self, db: Session, settings: Optional[Settings] = None):
        self.db = db
        self.settings = settings or get_settings()
        self.occ = OccupancyEstimator(self.settings.occupancy_stale_minutes)

    # ------------------------------------------------------------------ occupancy
    def _entrance_cameras(self, store_id: str) -> List[Dict[str, Any]]:
        ids = sorted({z.camera_id for z in self.db.scalars(select(CameraZone).where(CameraZone.store_id == store_id).where(CameraZone.enabled.is_(True))) if z.line})
        out = []
        for cid in ids:
            st = self.db.get(CameraStatus, cid)
            out.append({"cameraId": cid, "state": st.state if st else "unknown"})
        return out

    def occupancy(self, store_id: str, now: Optional[datetime] = None) -> Dict[str, Any]:
        store = get_store_or_404(self.db, store_id)
        now = now or now_utc()
        row = self.db.get(OccupancyState, store_id)
        occ = Occupancy()
        if row is not None:
            occ = Occupancy(estimate=row.estimate, status=row.status, reason=row.reason, entries=row.entries_since_reset, exits=row.exits_since_reset,
                            negative_clamps=row.negative_clamps, last_event_at=row.last_event_at, last_reset_at=row.last_reset_at,
                            reset_reason=row.reset_reason, baseline_set=row.last_reset_at is not None, camera_down_since=row.camera_down_since,
                            camera_gap=bool(row.camera_gap))
            occ = self._closing_reset(store, row, occ, now)
            occ = self.occ.evaluate(occ, now)
        cams = self._entrance_cameras(store_id)
        configured = bool(cams)
        out = {
            "storeId": store_id, "estimate": occ.estimate, "status": occ.status, "reason": occ.reason,
            "entriesSinceReset": occ.entries, "exitsSinceReset": occ.exits, "negativeClamps": occ.negative_clamps,
            "lastEventAt": occ.last_event_at.isoformat() if occ.last_event_at else None,
            "lastResetAt": occ.last_reset_at.isoformat() if occ.last_reset_at else None, "resetReason": occ.reset_reason,
            "capacity": store.max_capacity or None,
            "percentOfCapacity": round(occ.estimate / store.max_capacity * 100, 1) if occ.estimate is not None and store.max_capacity else None,
            "entranceCameras": cams, "isEstimate": True,
            "policy": {"startup": "counting from first crossing is 'uncertain' until a baseline reset", "missedCrossings": "negative counts are clamped to 0 and marked uncertain",
                       "cameraOffline": "uncertain at once, stale after %d min" % int(self.settings.occupancy_stale_minutes),
                       "reconcile": "POST /occupancy/reset with a counted value, or automatic reset at the store's closing time"},
        }
        if not configured:
            out["meta"] = meta("unavailable", "No entrance counting line is configured for this store.")
        elif occ.estimate is None:
            out["meta"] = meta("unavailable", "No crossings observed yet.")
        else:
            out["meta"] = meta("available", None, occ.last_event_at, ["footfall_events"])
        return out

    def _closing_reset(self, store: Store, row: OccupancyState, occ: Occupancy, now: datetime) -> Occupancy:
        """Automatic reconciliation: after the store's closing time the building is empty, so re-baseline to 0."""
        if not store.close_time or occ.estimate is None:
            return occ
        try:
            hh, mm = (int(x) for x in store.close_time.split(":")[:2])
        except ValueError:
            return occ
        tz = store_tz(store)
        local = now.astimezone(tz)
        close_today = local.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if local < close_today:
            close_today -= timedelta(days=1)
        last = (occ.last_reset_at or datetime.min.replace(tzinfo=tz)).astimezone(tz)
        if last < close_today:
            close_utc = close_today.astimezone(now.tzinfo)
            new = self.occ.reset(occ, close_utc, 0, "closing-time reset")
            # the building was empty at closing time, but crossings counted AFTER it are real and must survive the re-baseline
            after = self.db.scalars(select(FootfallEvent).where(FootfallEvent.store_id == store.id).where(FootfallEvent.observed_at > close_utc)
                                    .order_by(FootfallEvent.observed_at)).all()
            for ev in after:
                new = self.occ.apply_crossing(new, ev.direction, ev.observed_at, ev.count or 1)
            row.estimate, row.status, row.reason = new.estimate, new.status, new.reason
            row.entries_since_reset, row.exits_since_reset, row.negative_clamps = new.entries, new.exits, new.negative_clamps
            row.last_reset_at, row.reset_reason, row.camera_gap, row.updated_at = new.last_reset_at, new.reset_reason, False, now
            return new
        return occ

    def reset_occupancy(self, store_id: str, value: int, reason: str) -> Dict[str, Any]:
        get_store_or_404(self.db, store_id)
        row = self.db.get(OccupancyState, store_id)
        if row is None:
            row = OccupancyState(store_id=store_id, status="unknown", entries_since_reset=0, exits_since_reset=0, negative_clamps=0, camera_gap=False,
                                 updated_at=now_utc())
            self.db.add(row)
            self.db.flush()
        now = now_utc()
        cur = Occupancy(camera_down_since=row.camera_down_since, last_event_at=row.last_event_at)
        new = self.occ.reset(cur, now, value, reason)
        # a manual head-count re-baselines everything, including a past camera gap
        row.estimate, row.status, row.reason = new.estimate, new.status, new.reason
        row.entries_since_reset, row.exits_since_reset, row.negative_clamps = 0, 0, 0
        row.last_reset_at, row.reset_reason, row.camera_gap, row.updated_at = now, reason, False, now
        self.db.flush()
        return self.occupancy(store_id, now)

    # ------------------------------------------------------------------ footfall events
    def recent_crossings(self, store_id: str, limit: int = 100) -> Dict[str, Any]:
        get_store_or_404(self.db, store_id)
        rows = self.db.scalars(select(FootfallEvent).where(FootfallEvent.store_id == store_id).order_by(FootfallEvent.observed_at.desc()).limit(limit)).all()
        return {"storeId": store_id, "items": [{"id": r.id, "direction": r.direction, "cameraId": r.camera_id, "lineId": r.line_id,
                                                 "observedAt": r.observed_at.isoformat(), "source": r.source} for r in rows],
                "meta": meta("available" if rows else "empty", None if rows else "No crossings recorded.", rows[0].observed_at if rows else None, ["footfall_events"])}

    # ------------------------------------------------------------------ dwell / zones
    def zone_analytics(self, store_id: str, range_key: str = "today") -> Dict[str, Any]:
        store = get_store_or_404(self.db, store_id)
        win = resolve_window(store, range_key)
        tz = store_tz(store)
        visits = self.db.execute(select(ZoneVisit.camera_zone_id, ZoneVisit.entered_at, ZoneVisit.dwell_seconds)
                                 .where(ZoneVisit.store_id == store_id).where(ZoneVisit.entered_at >= win.start).where(ZoneVisit.entered_at < win.end)
                                 .limit(200000)).all()
        zones = {z.id: z for z in self.db.scalars(select(CameraZone).where(CameraZone.store_id == store_id))}
        by_zone: Dict[str, List[float]] = defaultdict(list)
        hourly: Dict[str, Dict[int, List[float]]] = defaultdict(lambda: defaultdict(list))
        for zid, entered, dwell in visits:
            by_zone[zid].append(dwell)
            hourly[zid][entered.astimezone(tz).hour].append(dwell)
        items = []
        for zid, ds in by_zone.items():
            z = zones.get(zid)
            items.append({
                "cameraZoneId": zid, "name": z.name if z else zid, "zoneType": z.zone_type if z else None, "storeZoneId": z.store_zone_id if z else None,
                "cameraId": z.camera_id if z else None, "visits": len(ds), "meanDwellSeconds": round(statistics.fmean(ds), 1),
                "medianDwellSeconds": round(statistics.median(ds), 1), "p90DwellSeconds": round(percentile(ds, 0.9) or 0, 1),
                "hourly": [{"hour": h, "visits": len(v), "meanDwellSeconds": round(statistics.fmean(v), 1), "medianDwellSeconds": round(statistics.median(v), 1)}
                           for h, v in sorted(hourly[zid].items())],
            })
        items.sort(key=lambda i: -i["visits"])
        return {"storeId": store_id, "range": win.label, "items": items,
                "definition": "dwell = zone exit time - zone entry time, COMPLETE visits only (track vanished inside the zone / entry unseen => excluded)",
                "meta": meta("available" if items else "empty", None if items else "No completed zone visits in the selected range.",
                             max((v[1] for v in visits), default=None), ["zone_visits"])}

    # ------------------------------------------------------------------ heatmap
    def heatmap(self, store_id: str, camera_id: str, range_key: str = "today", mode: str = "camera") -> Dict[str, Any]:
        store = get_store_or_404(self.db, store_id)
        cam = self.db.get(Camera, camera_id)
        if cam is None or cam.store_id != store_id:
            raise NotFoundError("Camera", camera_id)
        win = resolve_window(store, range_key)
        rows = self.db.execute(select(HeatmapCell.gx, HeatmapCell.gy, func.sum(HeatmapCell.count), func.max(HeatmapCell.grid_w), func.max(HeatmapCell.grid_h))
                               .where(HeatmapCell.camera_id == camera_id).where(HeatmapCell.bucket_start >= win.start).where(HeatmapCell.bucket_start < win.end)
                               .group_by(HeatmapCell.gx, HeatmapCell.gy)).all()
        gw = max((r[3] for r in rows), default=32)
        gh = max((r[4] for r in rows), default=18)
        total = sum(int(r[2]) for r in rows)
        peak = max((int(r[2]) for r in rows), default=0)
        base = {"storeId": store_id, "cameraId": camera_id, "range": win.label, "gridWidth": gw, "gridHeight": gh, "totalSamples": total, "peak": peak,
                "unit": "anonymous foot-position samples (>= 0.5 s apart per track); no identities are stored"}
        if mode == "floor":
            calib = self.db.get(CameraCalibration, camera_id)
            if calib is None:
                raise InvalidStateError("Floor-plan heatmap needs camera calibration (PUT /api/stores/{store}/cameras/{camera}/calibration). Camera-space data is not placed on the floor plan without it.")
            pts = []
            for gx, gy, cnt, *_ in rows:
                x, y = apply_homography(calib.homography, ((gx + 0.5) / gw, (gy + 0.5) / gh))
                if 0 <= x <= store.map_width and 0 <= y <= store.map_height:
                    pts.append({"x": round(x, 1), "y": round(y, 1), "count": int(cnt)})
            return {**base, "mode": "floor", "mapWidth": store.map_width, "mapHeight": store.map_height, "points": pts,
                    "calibration": {"rmse": calib.rmse, "points": len(calib.image_points)},
                    "meta": meta("available" if pts else "empty", None if pts else "No samples inside the floor plan.", None, ["heatmap_cells", "camera_calibrations"])}
        cells = [{"gx": int(r[0]), "gy": int(r[1]), "count": int(r[2])} for r in rows]
        return {**base, "mode": "camera", "cells": cells, "meta": meta("available" if cells else "empty", None if cells else "No samples in the selected range.", None, ["heatmap_cells"])}

    # ------------------------------------------------------------------ movement
    def movement(self, store_id: str, range_key: str = "today") -> Dict[str, Any]:
        store = get_store_or_404(self.db, store_id)
        win = resolve_window(store, range_key)
        names = {z.id: z.name for z in self.db.scalars(select(StoreZone).where(StoreZone.store_id == store_id))}
        trans = self.db.execute(select(MovementAggregate.from_zone_id, MovementAggregate.to_zone_id, func.sum(MovementAggregate.transitions))
                                .where(MovementAggregate.store_id == store_id).where(MovementAggregate.bucket_start >= win.start).where(MovementAggregate.bucket_start < win.end)
                                .group_by(MovementAggregate.from_zone_id, MovementAggregate.to_zone_id).order_by(func.sum(MovementAggregate.transitions).desc())).all()
        visits = self.db.execute(select(ZoneVisit.store_zone_id, func.count(), func.avg(ZoneVisit.dwell_seconds))
                                 .where(ZoneVisit.store_id == store_id).where(ZoneVisit.store_zone_id.is_not(None)).where(ZoneVisit.entered_at >= win.start)
                                 .where(ZoneVisit.entered_at < win.end).group_by(ZoneVisit.store_zone_id).order_by(func.count().desc())).all()
        items = [{"fromZoneId": a, "fromName": names.get(a), "toZoneId": b, "toName": names.get(b), "transitions": int(n)} for a, b, n in trans]
        most = [{"zoneId": z, "name": names.get(z), "visits": int(n), "meanDwellSeconds": round(float(d), 1)} for z, n, d in visits]
        return {"storeId": store_id, "range": win.label, "transitions": items, "mostVisitedZones": most,
                "scope": "aggregated zone-to-zone moves observed within ONE camera's view; people are not matched across cameras",
                "meta": meta("available" if items or most else "empty", None if items or most else "No zone movement recorded.", None, ["movement_aggregates", "zone_visits"])}

    # ------------------------------------------------------------------ queue
    def _wait_for(self, counter: CheckoutCounter, obs: QueueObservation, region: Optional[QueueRegion]) -> Dict[str, Any]:
        w = estimate_wait(obs.queue_length, obs.in_service or 0, obs.service_rate_per_min,
                          region.assumed_service_rate_per_min if region else None, counter_open=counter.status != "closed")
        return {"seconds": w.seconds, "basis": w.basis, "note": w.note, "customersAhead": w.customers_ahead}

    def queue_status(self, store_id: str) -> Dict[str, Any]:
        get_store_or_404(self.db, store_id)
        regions = {r.counter_id: r for r in self.db.scalars(select(QueueRegion).where(QueueRegion.store_id == store_id))}
        items = []
        for c in self.db.scalars(select(CheckoutCounter).where(CheckoutCounter.store_id == store_id).order_by(CheckoutCounter.id)):
            obs = self.db.scalars(select(QueueObservation).where(QueueObservation.counter_id == c.id).order_by(QueueObservation.observed_at.desc()).limit(1)).first()
            region = regions.get(c.id)
            cam = self.db.get(CameraStatus, region.camera_id) if region else None
            cam_live = cam is not None and cam.state in ("live", "buffering")
            age = (now_utc() - obs.observed_at).total_seconds() if obs else None
            stale = obs is not None and (age is None or age > 90 or not cam_live)
            fc = self.db.scalars(select(QueueForecast).where(QueueForecast.counter_id == c.id).order_by(QueueForecast.generated_at.desc()).limit(3)).all()
            latest_gen = fc[0].generated_at if fc else None
            fcs = sorted([f for f in fc if f.generated_at == latest_gen], key=lambda f: f.horizon_minutes)
            items.append({
                "counterId": c.id, "name": c.name, "status": c.status, "configured": region is not None, "cameraId": region.camera_id if region else c.camera_id,
                "cameraState": cam.state if cam else None, "length": obs.queue_length if obs and not stale else None, "inService": obs.in_service if obs else None,
                "congestion": obs.congestion if obs and not stale else None, "arrivalRatePerMin": obs.arrival_rate_per_min if obs else None,
                "serviceRatePerMin": obs.service_rate_per_min if obs else None,
                "wait": self._wait_for(c, obs, region) if obs and not stale else {"seconds": None, "basis": "unavailable", "note": "no live observation", "customersAhead": None},
                "observedAt": obs.observed_at.isoformat() if obs else None, "stale": stale,
                "thresholds": {"warningLength": region.warning_length, "criticalLength": region.critical_length, "warningWaitSeconds": region.warning_wait_seconds,
                               "criticalWaitSeconds": region.critical_wait_seconds} if region else None,
                "forecast": [{"horizonMinutes": f.horizon_minutes, "predictedLength": f.predicted_length, "predictedWaitSeconds": f.predicted_wait_seconds,
                              "congestionRisk": f.congestion_risk, "forecastFor": f.forecast_for.isoformat() if f.forecast_for else None,
                              "modelVersion": f.model_version, "inputs": f.inputs} for f in fcs] if not stale else [],
            })
        configured = [i for i in items if i["configured"]]
        stamps = [i["observedAt"] for i in items if i["observedAt"]]
        state = "empty" if not items else "unavailable" if not configured or not stamps else "available"
        note = {"empty": "No checkout counters configured.", "unavailable": "No queue region is configured or no observation has been reported yet.", "available": None}[state]
        return {"storeId": store_id, "counters": items, "meta": meta(state, note, datetime.fromisoformat(max(stamps)) if stamps else None, ["queue_observations"]),
                "waitFormula": "wait ~= (waiting + in service) / measured service rate; unavailable or labelled 'assumption' without a measured rate"}

    def queue_history(self, store_id: str, counter_id: Optional[str], range_key: str = "today", limit: int = 2000) -> Dict[str, Any]:
        store = get_store_or_404(self.db, store_id)
        win = resolve_window(store, range_key)
        q = select(QueueObservation).where(QueueObservation.store_id == store_id).where(QueueObservation.observed_at >= win.start).where(QueueObservation.observed_at < win.end)
        if counter_id:
            q = q.where(QueueObservation.counter_id == counter_id)
        rows = self.db.scalars(q.order_by(QueueObservation.observed_at).limit(limit)).all()
        return {"storeId": store_id, "range": win.label, "points": [
            {"counterId": r.counter_id, "at": r.observed_at.isoformat(), "length": r.queue_length, "waitSeconds": r.estimated_wait_seconds, "waitBasis": r.wait_basis,
             "arrivalRatePerMin": r.arrival_rate_per_min, "serviceRatePerMin": r.service_rate_per_min, "congestion": r.congestion} for r in rows],
                "meta": meta("available" if rows else "empty", None if rows else "No queue observations in range.", rows[-1].observed_at if rows else None, ["queue_observations"])}

    def queue_forecast(self, store_id: str, counter_id: Optional[str]) -> Dict[str, Any]:
        st = self.queue_status(store_id)
        items = [{"counterId": c["counterId"], "name": c["name"], "forecast": c["forecast"], "basis": (c["forecast"][0]["inputs"] or {}).get("basis") if c["forecast"] else None}
                 for c in st["counters"] if not counter_id or c["counterId"] == counter_id]
        return {"storeId": store_id, "items": items, "model": "persistence-v1 (statistics, no learned model): L(h)=L0 with risk class and a wait from the measured service rate. The fluid drift model (fluid-v1) did not beat persistence in evaluation and is diagnostic only.",
                "meta": st["meta"]}

    def service_rates(self, store_id: str, range_key: str = "today") -> Dict[str, Any]:
        store = get_store_or_404(self.db, store_id)
        win = resolve_window(store, range_key)
        rows = self.db.execute(select(QueueServiceSample.counter_id, func.count(), func.avg(QueueServiceSample.service_seconds), func.avg(QueueServiceSample.wait_seconds))
                               .where(QueueServiceSample.store_id == store_id).where(QueueServiceSample.completed_at >= win.start).where(QueueServiceSample.completed_at < win.end)
                               .group_by(QueueServiceSample.counter_id)).all()
        items = [{"counterId": c, "completedServices": int(n), "meanServiceSeconds": round(float(s), 1), "serviceRatePerMin": round(60.0 / float(s), 2) if s else None,
                  "meanMeasuredWaitSeconds": round(float(w), 1) if w is not None else None} for c, n, s, w in rows]
        return {"storeId": store_id, "range": win.label, "items": items, "meta": meta("available" if items else "empty", None if items else "No completed services observed.", None, ["queue_service_samples"])}

    # ------------------------------------------------------------------ inventory
    def shelf_model_status(self) -> Dict[str, Any]:
        row = self.db.get(ModelRegistry, "shelf-monitor")
        status = row.status if row else "NOT_CONFIGURED"
        ready = status == "READY"
        return {"modelId": "shelf-monitor", "status": status, "ready": ready, "labels": (row.labels if row else None) or [],
                "version": row.version if row else None, "lastError": row.last_error if row else None,
                "code": None if ready else "MODEL_NOT_CONFIGURED",
                "message": None if ready else "No validated shelf product model is configured: shelf counts are not produced (a person detector is never used as a product detector). See docs/PHASE3_REPORT.md for the dataset requirements."}

    def shelf_observations(self, store_id: str, shelf_id: Optional[str], limit: int = 100) -> Dict[str, Any]:
        get_store_or_404(self.db, store_id)
        q = select(ShelfObservation).where(ShelfObservation.store_id == store_id)
        if shelf_id:
            q = q.where(ShelfObservation.shelf_id == shelf_id)
        rows = self.db.scalars(q.order_by(ShelfObservation.observed_at.desc()).limit(limit)).all()
        return {"storeId": store_id, "items": [self._obs_out(r) for r in rows], "model": self.shelf_model_status(),
                "meta": meta("available" if rows else "empty", None if rows else "No shelf observations.", rows[0].observed_at if rows else None, ["shelf_observations"])}

    def _obs_out(self, r: ShelfObservation) -> Dict[str, Any]:
        return {"id": r.id, "shelfId": r.shelf_id, "cameraId": r.camera_id, "status": r.status, "visibleCount": r.detected_units, "expectedUnits": r.expected_units,
                "availabilityPct": r.availability_pct, "confidence": r.confidence, "planogramCompliancePct": r.planogram_compliance_pct, "modelId": r.model_id,
                "observedAt": r.observed_at.isoformat(), "source": r.source, "evidence": r.evidence}

    def inventory_history(self, store_id: str, shelf_id: Optional[str], range_key: str = "today", limit: int = 2000) -> Dict[str, Any]:
        store = get_store_or_404(self.db, store_id)
        win = resolve_window(store, range_key)
        q = select(ShelfObservation).where(ShelfObservation.store_id == store_id).where(ShelfObservation.observed_at >= win.start).where(ShelfObservation.observed_at < win.end)
        if shelf_id:
            q = q.where(ShelfObservation.shelf_id == shelf_id)
        rows = self.db.scalars(q.order_by(ShelfObservation.observed_at).limit(limit)).all()
        return {"storeId": store_id, "range": win.label, "points": [{"shelfId": r.shelf_id, "at": r.observed_at.isoformat(), "visibleCount": r.detected_units,
                                                                       "availabilityPct": r.availability_pct, "status": r.status, "source": r.source} for r in rows],
                "meta": meta("available" if rows else "empty", None if rows else "No observations in range.", rows[-1].observed_at if rows else None, ["shelf_observations"])}

    def planogram_status(self, store_id: str) -> Dict[str, Any]:
        get_store_or_404(self.db, store_id)
        model = self.shelf_model_status()
        items = []
        for reg in self.db.scalars(select(ShelfRegion).where(ShelfRegion.store_id == store_id)):
            obs = self.db.scalars(select(ShelfObservation).where(ShelfObservation.shelf_id == reg.shelf_id).where(ShelfObservation.source == "cv")
                                  .order_by(ShelfObservation.observed_at.desc()).limit(1)).first()
            plano = (obs.evidence or {}).get("planogram") if obs else None
            items.append({"shelfId": reg.shelf_id, "slotsConfigured": len(reg.slots or []), "compliancePct": plano.get("compliancePct") if plano else None,
                          "judgedSlots": plano.get("supportedSlots") if plano else None, "totalSlots": plano.get("totalSlots") if plano else len(reg.slots or []),
                          "violations": (plano or {}).get("violations", []), "unexpected": (plano or {}).get("unexpected", []),
                          "observedAt": obs.observed_at.isoformat() if obs else None,
                          "note": plano.get("note") if plano else ("MODEL_NOT_CONFIGURED" if not model["ready"] else "no observation yet")})
        return {"storeId": store_id, "items": items, "model": model,
                "scope": "compliance is judged only for slots whose expected class the detector can recognise; broader SKU placement is not claimed",
                "meta": meta("available" if any(i["compliancePct"] is not None for i in items) else "unavailable",
                             None if any(i["compliancePct"] is not None for i in items) else "No model-backed planogram comparison yet.", None, ["shelf_observations"])}

    # ------------------------------------------------------------------ events
    def events(self, store_id: str, event_type: Optional[str], limit: int = 100) -> Dict[str, Any]:
        get_store_or_404(self.db, store_id)
        q = select(DomainEvent).where(DomainEvent.store_id == store_id)
        if event_type:
            q = q.where(DomainEvent.event_type == event_type)
        rows = self.db.scalars(q.order_by(DomainEvent.occurred_at.desc()).limit(limit)).all()
        return {"storeId": store_id, "items": [{"id": r.id, "type": r.event_type, "severity": r.severity, "cameraId": r.camera_id, "occurredAt": r.occurred_at.isoformat(),
                                                 "receivedAt": r.received_at.isoformat(), "payload": r.payload} for r in rows],
                "meta": meta("available" if rows else "empty", None, rows[0].occurred_at if rows else None, ["domain_events"])}
