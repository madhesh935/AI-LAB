"""Whole-system health. Every component is PROBED; the API merely answering is never reported as "system healthy".

States: READY | LOADING | DEGRADED | OFFLINE | NOT_CONFIGURED | ERROR. `overall` is READY only when every component is READY.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.config import Settings
from core.events import event_bus
from database import manage
from database.connection import Database
from database.models import Camera, CameraStatus, Employee, ModelRegistry, QueueObservation, QueueRegion, Store
from services.common import now_utc

READY, LOADING, DEGRADED, OFFLINE, NOT_CONFIGURED, ERROR = "READY", "LOADING", "DEGRADED", "OFFLINE", "NOT_CONFIGURED", "ERROR"
_ORDER = [ERROR, OFFLINE, DEGRADED, NOT_CONFIGURED, LOADING, READY]
_STARTED = time.monotonic()


def comp(cid: str, name: str, state: str, detail: str, required: bool = True, **facts: Any) -> Dict[str, Any]:
    return {"id": cid, "name": name, "state": state, "required": required, "detail": detail, "facts": {k: v for k, v in facts.items() if v is not None}}


class SystemHealthService:
    def __init__(self, db: Session, database: Database, settings: Settings, app: Any):
        self.db, self.database, self.settings, self.app = db, database, settings, app

    # ------------------------------------------------------------------ components
    def _fastapi(self) -> Dict[str, Any]:
        return comp("fastapi", "FastAPI backend", READY, f"Serving on {self.settings.host}:{self.settings.port}", version=self.settings.app_version, uptimeSeconds=int(time.monotonic() - _STARTED),
                    bindHost=self.settings.host, lanAllowed=self.settings.allow_lan, authentication="none (controlled local demo)")

    def _sqlite(self) -> Dict[str, Any]:
        t0 = time.perf_counter()
        if not self.database.ping():
            return comp("sqlite", "SQLite database", ERROR, "The database cannot be queried.", path=str(self.settings.db_path))
        ms = round((time.perf_counter() - t0) * 1000, 2)
        try:
            cur, head = manage.current_revision(self.settings), manage.head_revision(self.settings)
        except Exception as exc:  # noqa: BLE001
            return comp("sqlite", "SQLite database", ERROR, f"Schema check failed: {type(exc).__name__}", path=str(self.settings.db_path))
        size = self.settings.db_path.stat().st_size if self.settings.db_path.exists() else None
        if cur != head:
            return comp("sqlite", "SQLite database", DEGRADED, f"Schema is at {cur}, code expects {head}: run `python -m database.manage setup`.", path=str(self.settings.db_path), revision=cur, head=head)
        return comp("sqlite", "SQLite database", READY, "Reachable, schema at head.", path=str(self.settings.db_path), revision=cur, head=head, pingMs=ms, sizeBytes=size, journalMode="wal")

    def _worker(self):
        from services.vision import worker_client_for

        return worker_client_for(self.settings)

    def _cameras(self) -> Dict[str, Any]:
        cams = list(self.db.scalars(select(Camera)))
        if not cams:
            return comp("cameras", "Camera streams", NOT_CONFIGURED, "No camera is registered.", registered=0)
        configured = [c for c in cams if c.source_type != "unconfigured" and c.source_ref and c.enabled]
        if not configured:
            return comp("cameras", "Camera streams", NOT_CONFIGURED, f"{len(cams)} cameras are registered but none has a video source configured and enabled.", registered=len(cams), configured=0)
        states = {s.camera_id: s.state for s in self.db.scalars(select(CameraStatus))}
        live = [c for c in configured if states.get(c.id) in ("live", "buffering")]
        if self._worker().online() is False:
            return comp("cameras", "Camera streams", OFFLINE, "Cameras are configured but the vision worker that reads them is not running.", registered=len(cams), configured=len(configured), live=0)
        if len(live) == len(configured):
            return comp("cameras", "Camera streams", READY, f"{len(live)} of {len(configured)} configured cameras are live.", registered=len(cams), configured=len(configured), live=len(live))
        return comp("cameras", "Camera streams", DEGRADED if live else OFFLINE, f"{len(live)} of {len(configured)} configured cameras are live.", registered=len(cams), configured=len(configured), live=len(live))

    def _worker_components(self) -> List[Dict[str, Any]]:
        client = self._worker()
        h = client.health()
        if h is None:
            off = "Vision worker is not running (python -m vision)."
            return [comp("inference_worker", "Inference worker", OFFLINE, off), comp("person_model", "Person detection model", OFFLINE, "No worker holds the model in memory.", path="ai_models/person"),
                    comp("tracking", "Tracking", OFFLINE, off), self._shelf_model(None)]
        st = client.status() or {}
        models = st.get("models") or []
        person = next((m for m in models if "person" in str(m.get("task", "")).lower() or "detect" in str(m.get("task", "")).lower()), None)
        out = [comp("inference_worker", "Inference worker", READY, "One worker is running and answering.", workerId=h.get("workerId"), device=st.get("device") or h.get("device"),
                    cameraRuntimes=len(client.runtimes()), singleInstancePort=self.settings.vision_worker_port)]
        if person is None:
            out.append(comp("person_model", "Person detection model", NOT_CONFIGURED, "The worker reports no person detector."))
        else:
            s = str(person.get("status"))
            out.append(comp("person_model", "Person detection model", s if s in (READY, LOADING, ERROR, DEGRADED) else NOT_CONFIGURED, person.get("lastError") or f"{person.get('name')} {person.get('version') or ''} on {person.get('device')}",
                            model=person.get("name"), path=person.get("path"), device=person.get("device"), license=person.get("license")))
        rts = client.runtimes()
        running = [r for r in rts.values() if (r.get("state") or r.get("status")) in ("live", "buffering") or r.get("running")]
        tracked = any(r.get("trackingEnabled") or r.get("tracker") for r in rts.values()) or bool(running)  # ByteTrack runs with every live stream
        if out[-1]["state"] != READY:
            out.append(comp("tracking", "Tracking", NOT_CONFIGURED, "Tracking needs the person detector to be READY."))
        elif not running:
            out.append(comp("tracking", "Tracking", NOT_CONFIGURED, "No camera stream is running, so nothing is being tracked.", cameras=len(rts)))
        else:
            out.append(comp("tracking", "Tracking", READY, f"ByteTrack runs on {len(running)} camera stream(s).", cameras=len(running), trackerReported=bool(tracked) or None))
        out.append(self._shelf_model(models))
        return out

    def _shelf_model(self, live_models: Optional[List[Dict[str, Any]]]) -> Dict[str, Any]:
        rows = [r for r in self.db.scalars(select(ModelRegistry)) if "shelf" in (r.task or "").lower()]
        if live_models is not None:
            shelf = next((m for m in live_models if "shelf" in str(m.get("task", "")).lower()), None)
            if shelf and shelf.get("status") == READY:
                return comp("shelf_model", "Shelf model", READY, f"{shelf.get('name')} loaded.", model=shelf.get("name"), path=shelf.get("path"))
        if not rows:
            return comp("shelf_model", "Shelf model", NOT_CONFIGURED, "No validated shelf model exists (no labelled shelf data was available to train one). Shelf counts only come from observations posted to the ingest API.", required=False,
                        path="ai_models/shelf")
        return comp("shelf_model", "Shelf model", NOT_CONFIGURED if rows[0].status != ERROR else ERROR, rows[0].last_error or "A shelf model is registered but not loaded.", required=False, model=rows[0].name)

    def _queue(self) -> Dict[str, Any]:
        regions = self.db.scalar(select(func.count()).select_from(QueueRegion)) or 0
        if regions == 0:
            return comp("queue_analytics", "Queue analytics", NOT_CONFIGURED, "No queue region is drawn for any counter.", configuredRegions=0)
        last = self.db.scalar(select(func.max(QueueObservation.observed_at)))
        if last is None:
            return comp("queue_analytics", "Queue analytics", DEGRADED, f"{regions} queue regions configured, no observation has been recorded yet.", configuredRegions=regions)
        age = (now_utc() - last).total_seconds()
        st = READY if age < 120 else DEGRADED
        return comp("queue_analytics", "Queue analytics", st, f"Last queue observation {int(age)} s ago." if st == READY else f"Queue data is stale ({int(age // 60)} min old).", configuredRegions=regions, lastObservationAt=last.isoformat(), ageSeconds=int(age))

    def _websocket(self) -> Dict[str, Any]:
        return comp("websocket", "WebSocket event feed", READY, "Event bus running; per-store sequence numbers and replay buffer active.", subscribers=event_bus.subscriber_count(), epoch=event_bus.epoch,
                    note="Client-side connectivity is reported per browser in the header chip (Live / Stale / Offline).")

    def _llm(self) -> Dict[str, Any]:
        engine = getattr(self.app.state, "copilot", None)
        if engine is None:
            return comp("llm", "Copilot language model (OpenRouter)", NOT_CONFIGURED, "Copilot engine not initialised.", required=False)
        st = engine.provider.status()
        d = st.as_dict()
        state = st.state
        return comp("llm", "Copilot language model (OpenRouter)", state, st.detail, required=False, model=d["model"], endpoint=d["endpoint"], isCloudModel=d["isCloudModel"], supportsTools=d["supportsTools"],
                    contextLength=d["contextLength"], answersWithoutModel="deterministic database tools")

    def _pwa(self) -> Dict[str, Any]:
        stores = self.db.scalar(select(func.count()).select_from(Store)) or 0
        staff = self.db.scalar(select(func.count()).select_from(Employee).where(Employee.is_active.is_(True))) or 0
        if stores == 0:
            return comp("pwa_integration", "Staff & Customer PWA backend", NOT_CONFIGURED, "No store exists, so the PWAs have nothing to show.", stores=0)
        try:
            from services.customers import PublicStoreService

            public = PublicStoreService(self.db).stores()
        except Exception as exc:  # noqa: BLE001
            return comp("pwa_integration", "Staff & Customer PWA backend", ERROR, f"Public store API failed: {type(exc).__name__}")
        if staff == 0:
            return comp("pwa_integration", "Staff & Customer PWA backend", DEGRADED, "The customer API works but there are no active employees for the Staff PWA.", stores=stores, publicStores=len(public), employees=0)
        return comp("pwa_integration", "Staff & Customer PWA backend", READY, "Staff roster, task engine and the public customer API answer.", stores=stores, publicStores=len(public), employees=staff,
                    lanMode=self.settings.allow_lan)

    # ------------------------------------------------------------------ assemble
    def report(self) -> Dict[str, Any]:
        t0 = time.perf_counter()
        comps = [self._fastapi(), self._sqlite(), self._cameras(), *self._worker_components(), self._queue(), self._websocket(), self._llm(), self._pwa()]
        states = [c["state"] for c in comps]
        overall = next((s for s in _ORDER if s in states), READY)
        core_ok = all(c["state"] == READY for c in comps if c["id"] in ("fastapi", "sqlite"))
        required_bad = [c["id"] for c in comps if c["required"] and c["state"] != READY]
        optional_bad = [c["id"] for c in comps if not c["required"] and c["state"] != READY]
        return {
            "overall": overall, "coreOk": core_ok, "fullyOperational": overall == READY,
            "summary": {s: states.count(s) for s in _ORDER if states.count(s)},
            "notReadyRequired": required_bad, "notReadyOptional": optional_bad,
            "components": comps, "checkedAt": now_utc().isoformat(), "probeMs": round((time.perf_counter() - t0) * 1000, 1),
            "note": "READY means the component was probed and works. NOT_CONFIGURED means a required input (camera source, model, calibration, ...) is missing - not that something crashed.",
        }


_ = (datetime, timedelta, timezone)
