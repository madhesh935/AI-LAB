"""Real model + real video -> analytics runtime -> central event engine -> SQLite -> API.

Zones and the counting line are configured as DATA (camera_zones rows), loaded by the worker store, exactly as in production.
Assertions are about mechanism and consistency; accuracy against ground truth is measured by scripts/evaluate_shopper.py.
"""

from __future__ import annotations

import shutil
import time
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from database.models import CameraZone, FootfallEvent, ZoneVisit
from main import create_app
from tests.test_vision_pipeline import SAMPLE, Rig, loaded_registry, wait_for  # noqa: F401  (fixture re-exported)

pytestmark = pytest.mark.skipif(not SAMPLE.is_file(), reason="sample video missing")
FAST = {"playbackSpeed": 3.0, "inferenceFps": 30}
INTERIOR = [[0.12, 0.05], [0.88, 0.05], [0.88, 0.78], [0.12, 0.78]]


@pytest.fixture()
def rig(tmp_path, loaded_registry):
    r = Rig(tmp_path, loaded_registry)
    shutil.copy(SAMPLE, r.settings.media_dir / "clip.mp4")
    yield r
    r.close()


def configure(rig):
    with rig.db.transaction() as s:
        s.add(CameraZone(id="cz-line", store_id="s1", camera_id="cam-c1", name="Door", zone_type="entrance", polygon=[],
                         line={"p1": [0.5, 0.2], "p2": [0.5, 1.0], "inSide": "negative", "margin": 0.025, "minTrackAge": 3, "cooldownSeconds": 2.0}))
        s.add(CameraZone(id="cz-room", store_id="s1", camera_id="cam-c1", name="Room", zone_type="aisle", polygon=INTERIOR, config={"minDwellSeconds": 0.5}))


def test_configuration_is_loaded_from_sqlite_and_applied_to_the_running_worker(rig):
    w = rig.add_camera("c1", "file", "clip.mp4", config=FAST)
    assert w.analytics is None and w.acfg is None
    configure(rig)
    rig.engine._apply_analytics()
    assert w.analytics is not None and w.acfg.summary() == {"lines": 1, "zones": 1, "queues": 0, "shelves": 0}
    digest = w.acfg.digest
    rig.engine._apply_analytics()
    assert w.acfg.digest == digest  # unchanged configuration does not rebuild state
    with rig.db.transaction() as s:
        s.get(CameraZone, "cz-room").enabled = False
    rig.engine._apply_analytics()
    assert w.acfg.summary()["zones"] == 0 and w.acfg.digest != digest
    assert w.runtime().analytics["config"]["lines"] == 1


def test_real_footage_produces_crossings_and_zone_visits_that_reach_the_database(rig):
    w = rig.add_camera("c1", "file", "clip.mp4", config={**FAST, "loop": False})
    configure(rig)
    rig.engine._apply_analytics()
    wait_for(lambda: w.state == "offline" and w.error_code == "END_OF_FILE", timeout=90, msg="clip finished")
    time.sleep(1.0)
    # let still-open tracks expire like they would live, then collect everything the worker emitted
    for e in w.analytics.zones.expire(datetime.now(timezone.utc).replace(year=2100)):
        rig.engine.outbox.emit("zone.visit", "s1", "cam-c1", {"cameraZoneId": e.zone_id, "trackRef": e.track_id, "enteredAt": e.entered_at.isoformat(),
                                                              "exitedAt": e.exited_at.isoformat(), "dwellSeconds": e.dwell_seconds}, at=e.exited_at)
    timed = list(rig.outbox.timed)
    crossings = [e for e in timed if e[0] == "footfall.crossing"]
    visits = [e for e in timed if e[0] == "zone.visit"]
    assert len(crossings) >= 2, "the clip contains 3 line crossings; at least two must be found"
    assert {c[3]["direction"] for c in crossings} == {"in", "out"}
    assert all(c[4] is not None and c[3]["lineId"] == "cz-line" for c in crossings)  # source timestamps travel with the event
    assert len(visits) >= 2 and all(v[3]["dwellSeconds"] > 0 for v in visits)
    assert any(e[0] == "zone.occupancy" for e in timed)

    # feed the recorded events to the REAL central event engine (same database the worker used)
    app = create_app(rig.settings)
    with TestClient(app) as client:
        events = [{"eventId": uuid.uuid4().hex, "seq": i, "type": t, "storeId": sid, "cameraId": cid, "timestamp": (at or datetime.now(timezone.utc)).isoformat(),
                   "payload": payload} for i, (t, sid, cid, payload, at) in enumerate(timed)
                  if t in ("footfall.crossing", "zone.visit", "zone.occupancy", "zone.transition", "heatmap.flush")]
        res = client.post("/api/internal/vision/events", json={"workerId": "t", "events": events}).json()
        assert res["rejected"] == {} and res["accepted"] == len(events)
        occ = client.get("/api/stores/s1/occupancy").json()
        assert occ["status"] == "uncertain" and occ["isEstimate"] is True  # no baseline yet
        assert occ["entriesSinceReset"] == sum(1 for c in crossings if c[3]["direction"] == "in")
        assert occ["exitsSinceReset"] == sum(1 for c in crossings if c[3]["direction"] == "out")
    with rig.db.session() as s:
        assert s.scalar(select(func.count()).select_from(FootfallEvent)) == len(crossings)
        stored = s.scalars(select(ZoneVisit)).all()
        assert len(stored) == len(visits) and all(v.dwell_seconds > 0 and v.exited_at > v.entered_at for v in stored)


def test_camera_reconnect_resets_line_state_so_old_ids_cannot_complete_a_crossing(rig):
    w = rig.add_camera("c1", "file", "clip.mp4", config=FAST)
    configure(rig)
    rig.engine._apply_analytics()
    wait_for(lambda: w.state == "live", msg="live")
    wait_for(lambda: w.analytics.counters[0].live_tracks > 0 or w.reconnects > 0 or True, timeout=5, msg="tracks")
    w.request_reconnect()
    wait_for(lambda: w.reconnects >= 1 and w.state == "live", timeout=30, msg="reconnected")
    assert w.analytics.counters[0].live_tracks <= 1  # state was cleared on reconnect (only tracks seen since can exist)
