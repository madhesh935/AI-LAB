"""Phase 3 API + central event engine tests. Events are crafted by hand (the worker's real output is covered by the pipeline tests)."""

from __future__ import annotations

from tests.conftest import open_events

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from database.connection import Database
from database.models import (
    Alert, Camera, CameraStatus, CheckoutCounter, DomainEvent, FootfallEvent, QueueForecast, QueueObservation, Shelf, ShelfObservation,
    Store, StoreZone, ZoneVisit,
)
from services.event_engine import MEMORY

# Events must fall inside the "today/week" windows the read APIs use, so the test clock is relative to now.
T0 = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(minutes=20)
STORE = "store-a"


def t(sec: float) -> datetime:
    return T0 + timedelta(seconds=sec)


@pytest.fixture(autouse=True)
def _reset_memory():
    MEMORY.reset()
    yield
    MEMORY.reset()


@pytest.fixture()
def world(client):
    db = Database(client.settings.database_url)
    with db.transaction() as s:
        s.add(StoreZone(id="zone-gro", store_id=STORE, name="Grocery", zone_type="aisle", capacity_limit=20))
        s.add(StoreZone(id="zone-dai", store_id=STORE, name="Dairy", zone_type="aisle", capacity_limit=20))
        s.flush()
        for cid, name in (("cam-ent", "Entrance"), ("cam-chk", "Checkout"), ("cam-shf", "Shelf")):
            s.add(Camera(id=cid, store_id=STORE, camera_code=cid.upper(), name=name, camera_type="entrance" if cid == "cam-ent" else "aisle"))
        s.flush()
        s.add(CheckoutCounter(id="cnt-1", store_id=STORE, name="Counter 1", counter_type="standard", status="open", camera_id="cam-chk"))
        s.add(Shelf(id="shf-1", store_id=STORE, shelf_code="A4", department="Dairy", category="Milk", capacity_units=12, camera_id="cam-shf"))
        s.add(CameraStatus(camera_id="cam-chk", state="live"))
        st = s.get(Store, STORE)
        st.max_capacity = 3
    db.dispose()
    return client


def collect(ws, wanted, limit=8):
    got = []
    for _ in range(limit):
        got.append(ws.receive_json())
        if set(wanted) <= {m["type"] for m in got}:
            break
    return got


def post_events(client, events):
    r = client.post("/api/internal/vision/events", json={"workerId": "w", "events": events})
    assert r.status_code == 200, r.text
    return r.json()


def ev(type_, payload, at=0.0, camera="cam-ent", store=STORE, eid=None):
    return {"eventId": eid or uuid.uuid4().hex, "seq": 1, "type": type_, "storeId": store, "cameraId": camera,
            "timestamp": t(at).isoformat(), "payload": payload}


def add_line(client, zone_id="cz-line", camera="cam-ent", **extra):
    body = {"id": zone_id, "cameraId": camera, "name": "Door line", "zoneType": "entrance",
            "line": {"p1": [0.1, 0.5], "p2": [0.9, 0.5], "insidePoint": [0.5, 0.9]}, **extra}
    r = client.post(f"/api/stores/{STORE}/camera-zones", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def crossing(zone_id, direction, at, **kw):
    at = at + 1000  # keep every crossing inside "today"/"week" and recent
    return ev("footfall.crossing", {"lineId": zone_id, "direction": direction, "trackRef": 1, "occurredAt": t(at).isoformat()}, at, **kw)


# ================================================================== configuration
def test_zone_configuration_validation_direction_inference_and_confirmed_delete(world):
    c = world
    assert c.post(f"/api/stores/{STORE}/camera-zones", json={"cameraId": "cam-ent", "name": "Bad", "polygon": [[0, 0], [1, 1]]}).status_code == 422
    assert c.post(f"/api/stores/{STORE}/camera-zones", json={"cameraId": "cam-ent", "name": "Out", "polygon": [[0, 0], [2, 0], [1, 1]]}).status_code == 422
    assert c.post(f"/api/stores/{STORE}/camera-zones", json={"cameraId": "cam-ent", "name": "NoGeo"}).status_code == 422
    assert c.post(f"/api/stores/{STORE}/camera-zones", json={"cameraId": "cam-ent", "name": "Dir", "line": {"p1": [0.1, 0.5], "p2": [0.9, 0.5]}}).status_code == 422
    assert c.post(f"/api/stores/{STORE}/camera-zones", json={"cameraId": "nope", "name": "Nope", "polygon": [[0, 0], [1, 0], [1, 1]]}).status_code == 404
    z = add_line(c)
    assert z["line"]["inSide"] == "positive"  # inside point y=0.9 is below the line => positive side
    flipped = c.put(f"/api/stores/{STORE}/camera-zones/cz-line", json={"cameraId": "cam-ent", "name": "Door line", "zoneType": "entrance",
                                                                        "line": {"p1": [0.1, 0.5], "p2": [0.9, 0.5], "insidePoint": [0.5, 0.1]}}).json()
    assert flipped["line"]["inSide"] == "negative"
    assert c.post(f"/api/stores/{STORE}/camera-zones", json={"id": "cz-line", "cameraId": "cam-ent", "name": "dup", "polygon": [[0, 0], [1, 0], [1, 1]]}).status_code == 409
    poly = c.post(f"/api/stores/{STORE}/camera-zones", json={"cameraId": "cam-ent", "name": "Grocery", "zoneType": "aisle", "storeZoneId": "zone-gro",
                                                              "polygon": [[0.1, 0.1], [0.5, 0.1], [0.5, 0.6], [0.1, 0.6]], "minDwellSeconds": 2}).json()
    assert poly["minDwellSeconds"] == 2 and poly["storeZoneId"] == "zone-gro"
    assert len(c.get(f"/api/stores/{STORE}/analytics/config").json()["cameraZones"]) == 2
    assert c.delete(f"/api/stores/{STORE}/camera-zones/cz-line").status_code == 428
    assert c.delete(f"/api/stores/{STORE}/camera-zones/cz-line?confirm=true").status_code == 204
    assert c.get(f"/api/stores/{STORE}/camera-zones?cameraId=cam-ent").json()[0]["name"] == "Grocery"


def test_queue_and_shelf_region_validation(world):
    c = world
    sq = [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]]
    assert c.put(f"/api/stores/{STORE}/counters/cnt-1/queue-region", json={"cameraId": "cam-chk", "queuePolygon": sq, "warningLength": 6, "criticalLength": 3}).status_code == 422
    assert c.put(f"/api/stores/{STORE}/counters/nope/queue-region", json={"cameraId": "cam-chk", "queuePolygon": sq}).status_code == 404
    ok = c.put(f"/api/stores/{STORE}/counters/cnt-1/queue-region", json={"cameraId": "cam-chk", "queuePolygon": sq, "servicePolygon": [[0.6, 0.1], [0.9, 0.1], [0.9, 0.4]]})
    assert ok.status_code == 200 and ok.json()["warningLength"] == 4 and ok.json()["assumedServiceRatePerMin"] is None
    bad = {"cameraId": "cam-shf", "polygon": sq, "classMap": {"milk": "prod-milk"}, "expectedVisibleCapacity": 12}
    assert c.put(f"/api/stores/{STORE}/shelves/shf-1/region", json={**bad, "lowStockPct": 5, "outOfStockPct": 10}).status_code == 422
    assert c.put(f"/api/stores/{STORE}/shelves/shf-1/region", json={**bad, "classMap": {}}).status_code == 422
    good = c.put(f"/api/stores/{STORE}/shelves/shf-1/region", json={**bad, "slots": [{"slotId": "s1", "rect": [0.1, 0.1, 0.2, 0.3], "expectedClass": "milk"}]})
    assert good.status_code == 200 and good.json()["slots"][0]["expectedClass"] == "milk"
    assert c.delete(f"/api/stores/{STORE}/shelves/shf-1/region").status_code == 428


def test_calibration_is_required_for_floor_heatmaps_and_degenerate_input_is_rejected(world):
    c = world
    cells = [[2, 3, 5], [10, 8, 9]]
    post_events(c, [ev("heatmap.flush", {"bucketStart": t(1100).isoformat(), "gridW": 32, "gridH": 18, "cells": cells}, 1100, camera="cam-ent")])
    cam = c.get(f"/api/stores/{STORE}/heatmap?cameraId=cam-ent&range=week").json()
    assert cam["mode"] == "camera" and cam["totalSamples"] == 14 and cam["peak"] == 9
    refused = c.get(f"/api/stores/{STORE}/heatmap?cameraId=cam-ent&range=week&mode=floor")
    assert refused.status_code == 409 and "calibration" in refused.json()["error"]["message"].lower()
    line_pts = [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3], [0.4, 0.4]]
    assert c.put(f"/api/stores/{STORE}/cameras/cam-ent/calibration", json={"imagePoints": line_pts, "floorPoints": [[1, 1], [2, 2], [3, 3], [4, 4]]}).status_code == 409
    img = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]
    floor = [[100, 100], [700, 100], [700, 500], [100, 500]]
    r = c.put(f"/api/stores/{STORE}/cameras/cam-ent/calibration", json={"imagePoints": img, "floorPoints": floor})
    assert r.status_code == 200 and r.json()["rmse"] < 1e-3
    fl = c.get(f"/api/stores/{STORE}/heatmap?cameraId=cam-ent&range=week&mode=floor").json()
    assert fl["mode"] == "floor" and fl["points"] and sum(p["count"] for p in fl["points"]) == 14 and fl["calibration"]["points"] == 4
    assert c.get(f"/api/stores/{STORE}/heatmap?cameraId=cam-ent&mode=bogus").status_code == 422


# ================================================================== footfall + occupancy
def test_crossings_persist_aggregate_publish_and_drive_the_occupancy_estimate(world):
    c = world
    add_line(c)
    with open_events(c, STORE) as ws:
        out = post_events(c, [crossing("cz-line", "in", 1), crossing("cz-line", "in", 2)])
        assert out["accepted"] == 2 and out["rejected"] == {}
        got = [ws.receive_json() for _ in range(4)]  # footfall.updated + occupancy.updated for each crossing
        assert [m["type"] for m in got].count("footfall.updated") == 2 and [m["type"] for m in got].count("occupancy.updated") == 2
        assert all({"eventId", "seq", "storeId", "type", "timestamp", "source", "payload"} <= set(m) and m["storeId"] == STORE and m["source"] == "vision" for m in got)
        assert [m["seq"] for m in got] == sorted({m["seq"] for m in got})  # strictly increasing per store
        occ_ev = [m for m in got if m["type"] == "occupancy.updated"][-1]["payload"]
        assert occ_ev["estimate"] == 2 and occ_ev["status"] == "uncertain" and occ_ev["capacity"] == 3
        last = [m for m in got if m["type"] == "footfall.updated"][-1]["payload"]
        assert last["occupancy"]["estimate"] == 2 and last["occupancy"]["status"] == "uncertain" and last["hour"]["entries"] == 2
        assert last["eventId"] and last["lineId"] == "cz-line"
    occ = c.get(f"/api/stores/{STORE}/occupancy").json()
    assert occ["estimate"] == 2 and occ["status"] == "uncertain" and "no baseline" in occ["reason"] and occ["isEstimate"] is True
    assert occ["entranceCameras"] == [{"cameraId": "cam-ent", "state": "unknown"}]
    # the existing Phase-1 footfall endpoint now serves REAL aggregates
    ff = c.get(f"/api/stores/{STORE}/footfall?range=week").json()
    assert ff["totalEntries"] == 2 and ff["totalExits"] == 0 and ff["meta"]["dataState"] == "available"
    # baseline reset -> ok; exit; negative clamp -> uncertain
    r = c.post(f"/api/stores/{STORE}/occupancy/reset", json={"value": 1, "reason": "head count at opening"}).json()
    assert r["estimate"] == 1 and r["status"] == "ok" and r["resetReason"] == "head count at opening"
    post_events(c, [crossing("cz-line", "out", 10), crossing("cz-line", "out", 20)])
    occ = c.get(f"/api/stores/{STORE}/occupancy").json()
    assert occ["estimate"] == 0 and occ["negativeClamps"] == 1 and occ["status"] == "uncertain" and "missed" in occ["reason"]
    assert c.post(f"/api/stores/{STORE}/occupancy/reset", json={"value": -1}).status_code == 422
    log = c.get(f"/api/stores/{STORE}/events?type=footfall.crossing").json()
    assert len(log["items"]) == 4 and all(i["severity"] == "info" for i in log["items"])


def test_event_validation_duplicates_and_durable_dedupe_across_restarts(world):
    c = world
    add_line(c)
    ok = crossing("cz-line", "in", 1)
    assert post_events(c, [ok])["accepted"] == 1
    again = post_events(c, [ok])
    assert again["accepted"] == 0 and again["duplicates"] == 1
    from services.vision import vision_state

    vision_state.reset()  # simulate an API restart: memory dedupe is gone, the database unique id must still catch it
    again = post_events(c, [ok])
    assert again["accepted"] == 0 and again["duplicates"] == 1
    db = Database(c.settings.database_url)
    with db.session() as s:
        assert s.scalar(select(func.count()).select_from(FootfallEvent)) == 1
    db.dispose()
    bad = post_events(c, [crossing("cz-missing", "in", 2), ev("footfall.crossing", {"lineId": "cz-line", "direction": "sideways", "trackRef": 1}, 3),
                          ev("footfall.crossing", {"lineId": "cz-line", "direction": "in", "trackRef": 1}, 4, store="no-such-store"),
                          ev("queue.updated", {"counterId": "nope", "length": 1, "rawLength": 1}, 5, camera="cam-chk")])
    assert bad["accepted"] == 0 and len(bad["rejected"]) == 4
    # one bad event never poisons the rest of its batch
    mixed = post_events(c, [crossing("cz-missing", "in", 6), crossing("cz-line", "in", 7)])
    assert mixed["accepted"] == 1 and len(mixed["rejected"]) == 1


def test_capacity_alert_closing_time_reset_and_camera_loss_policy(world):
    c = world
    add_line(c)
    c.post(f"/api/stores/{STORE}/occupancy/reset", json={"value": 0, "reason": "opening"})
    post_events(c, [crossing("cz-line", "in", i) for i in range(1, 5)])  # capacity is 3, estimate becomes 4
    alerts = c.get(f"/api/stores/{STORE}/inventory/alerts").json()["items"]  # module filter: not an inventory alert
    assert alerts == []
    all_alerts = c.get(f"/api/stores/{STORE}/alerts").json()["items"]
    cap = [a for a in all_alerts if a["category"] == "unusual_customer_traffic"]
    assert len(cap) == 1 and cap[0]["severity"] == "warning"
    post_events(c, [crossing("cz-line", "in", 5)])
    assert len([a for a in c.get(f"/api/stores/{STORE}/alerts").json()["items"] if a["category"] == "unusual_customer_traffic"]) == 1  # deduped
    # entrance camera goes offline: occupancy becomes uncertain and the alert is raised once
    d1 = ev("camera.disconnected", {"state": "offline", "previousState": "live", "errorCode": "STREAM_LOST", "message": "Stream lost"}, 1100, eid="d1")
    post_events(c, [d1])
    occ = c.get(f"/api/stores/{STORE}/occupancy").json()
    assert occ["status"] == "uncertain" and "offline" in occ["reason"]
    db = Database(c.settings.database_url)
    with db.transaction() as s:
        s.add(CameraStatus(camera_id="cam-ent", state="live"))
    db.dispose()
    post_events(c, [ev("camera.connected", {"state": "live", "previousState": "offline"}, 1200, eid="c1")])
    occ = c.get(f"/api/stores/{STORE}/occupancy").json()
    assert occ["status"] == "uncertain" and "was offline" in occ["reason"]  # stays uncertain until reconciled
    assert c.post(f"/api/stores/{STORE}/occupancy/reset", json={"value": 2, "reason": "recount"}).json()["status"] == "ok"
    # closing-time reset (store tz Asia/Kolkata); the store 'closed' long ago relative to the last reset
    db = Database(c.settings.database_url)
    with db.transaction() as s:
        s.get(Store, STORE).close_time = "00:01"
    db.dispose()
    occ = c.get(f"/api/stores/{STORE}/occupancy").json()
    assert occ["status"] == "ok" and occ["estimate"] == 2  # reset happened moments ago, after the last closing time: nothing to do
    db = Database(c.settings.database_url)
    from database.models import OccupancyState

    with db.transaction() as s:
        s.get(OccupancyState, STORE).last_reset_at = datetime.now(timezone.utc) - timedelta(days=2)
        # every counted crossing happened before the closing time in question, so the empty-building baseline wipes them
        for e in s.scalars(select(FootfallEvent).where(FootfallEvent.store_id == STORE)):
            e.observed_at = datetime.now(timezone.utc) - timedelta(days=3)
    db.dispose()
    occ = c.get(f"/api/stores/{STORE}/occupancy").json()
    assert occ["estimate"] == 0 and occ["resetReason"] == "closing-time reset" and occ["status"] == "ok"


def test_closing_reset_keeps_crossings_counted_after_closing(world):
    """Regression (found by the Phase 5 pipeline test): with no baseline yet, the first read re-baselined to 0 and silently discarded crossings."""
    c = world
    add_line(c)
    db = Database(c.settings.database_url)
    with db.transaction() as s:
        s.get(Store, STORE).close_time = "00:01"
    db.dispose()
    post_events(c, [crossing("cz-line", "in", 1), crossing("cz-line", "in", 2), crossing("cz-line", "out", 3)])
    occ = c.get(f"/api/stores/{STORE}/occupancy").json()
    assert occ["entriesSinceReset"] == 2 and occ["exitsSinceReset"] == 1 and occ["estimate"] == 1


# ================================================================== zones, dwell, movement
def visit(zone, enter, exit_, track=1, **kw):
    return ev("zone.visit", {"cameraZoneId": zone, "trackRef": track, "enteredAt": t(enter).isoformat(), "exitedAt": t(exit_).isoformat(),
                             "dwellSeconds": exit_ - enter}, exit_, **kw)


def test_dwell_statistics_come_from_complete_visits_and_feed_existing_endpoints(world):
    c = world
    for name, sz in (("Grocery", "zone-gro"), ("Dairy", "zone-dai")):
        c.post(f"/api/stores/{STORE}/camera-zones", json={"id": f"cz-{sz}", "cameraId": "cam-shf", "name": name, "storeZoneId": sz, "polygon": [[0.1, 0.1], [0.5, 0.1], [0.5, 0.6]]})
    now = datetime.now(timezone.utc)
    base = (now - timedelta(minutes=5)).timestamp() - T0.timestamp()
    visits = [visit("cz-zone-gro", base + 0, base + 60, 1), visit("cz-zone-gro", base + 10, base + 130, 2), visit("cz-zone-gro", base + 20, base + 320, 3),
              visit("cz-zone-dai", base + 5, base + 35, 4)]
    out = post_events(c, [{**v, "cameraId": "cam-shf"} for v in visits])
    assert out["accepted"] == 4
    za = c.get(f"/api/stores/{STORE}/zones/analytics?range=today").json()
    gro = next(i for i in za["items"] if i["cameraZoneId"] == "cz-zone-gro")
    assert gro["visits"] == 3 and gro["meanDwellSeconds"] == 160.0 and gro["medianDwellSeconds"] == 120.0 and gro["p90DwellSeconds"] > 120
    assert sum(h["visits"] for h in gro["hourly"]) == 3 and "COMPLETE" in za["definition"]
    dw = c.get(f"/api/stores/{STORE}/dwell?range=today").json()  # existing Phase-1 endpoint, now real
    by = {i["zoneId"]: i for i in dw["items"]}
    assert by["zone-gro"]["visitors"] == 3 and by["zone-gro"]["averageDwellMinutes"] == pytest.approx(2.7, abs=0.1)
    # transitions between mapped zones aggregate; movement endpoint reports most visited
    post_events(c, [ev("zone.transition", {"fromZoneId": "cz-zone-gro", "toZoneId": "cz-zone-dai", "trackRef": 1, "occurredAt": (now).isoformat()}, camera="cam-shf") for _ in range(3)])
    mv = c.get(f"/api/stores/{STORE}/movement?range=today").json()
    assert mv["transitions"][0]["fromZoneId"] == "zone-gro" and mv["transitions"][0]["transitions"] == 3
    assert mv["mostVisitedZones"][0]["zoneId"] == "zone-gro" and "not matched across cameras" in mv["scope"]
    zo = ev("zone.occupancy", {"counts": {"cz-zone-gro": 4, "cz-zone-dai": 1}}, 400, camera="cam-shf")
    with open_events(c, STORE) as ws:
        post_events(c, [zo])
        m = ws.receive_json()
        assert m["type"] == "zone.occupancy.updated" and {z["zoneId"]: z["count"] for z in m["payload"]["zones"]} == {"zone-gro": 4, "zone-dai": 1}
    assert c.get(f"/api/stores/{STORE}/analytics/config").status_code == 200


# ================================================================== queue
def setup_queue(c, **region):
    sq = [[0.1, 0.3], [0.5, 0.3], [0.5, 0.9], [0.1, 0.9]]
    body = {"cameraId": "cam-chk", "queuePolygon": sq, "servicePolygon": [[0.6, 0.3], [0.9, 0.3], [0.9, 0.7]], "warningLength": 4, "criticalLength": 7, **region}
    assert c.put(f"/api/stores/{STORE}/counters/cnt-1/queue-region", json=body).status_code == 200


def qupd(length, at, rate=None, arr=None, congestion="optimal", reliable=True, in_service=0, eid=None):
    return ev("queue.updated", {"counterId": "cnt-1", "length": length, "rawLength": length, "inService": in_service, "arrivalRatePerMin": arr,
                                "serviceRatePerMin": rate, "congestion": congestion, "reliable": reliable}, at, camera="cam-chk", eid=eid)


def test_queue_wait_estimates_are_measured_assumed_or_unavailable_never_invented(world):
    c = world
    setup_queue(c)
    now = (datetime.now(timezone.utc) - T0).total_seconds() - 60
    post_events(c, [qupd(3, now, rate=None)])
    st = c.get(f"/api/stores/{STORE}/queue/status").json()["counters"][0]
    assert st["length"] == 3 and st["wait"]["seconds"] is None and st["wait"]["basis"] == "unavailable"
    # an explicit, labelled assumption is allowed only if configured
    setup_queue(c, assumedServiceRatePerMin=1.5)
    post_events(c, [qupd(3, now + 20, rate=None)])
    w = c.get(f"/api/stores/{STORE}/queue/status").json()["counters"][0]["wait"]
    assert w["basis"] == "assumption" and w["seconds"] == pytest.approx(120.0)
    post_events(c, [qupd(3, now + 40, rate=2.0, in_service=1)])
    st = c.get(f"/api/stores/{STORE}/queue/status").json()["counters"][0]
    assert st["wait"]["basis"] == "measured" and st["wait"]["seconds"] == pytest.approx(120.0) and st["wait"]["customersAhead"] == 4
    assert st["serviceRatePerMin"] == 2.0 and st["forecast"] == [] or st["forecast"]
    # a closed counter has no wait
    db = Database(c.settings.database_url)
    with db.transaction() as s:
        s.get(CheckoutCounter, "cnt-1").status = "closed"
    db.dispose()
    assert c.get(f"/api/stores/{STORE}/queue/status").json()["counters"][0]["wait"]["seconds"] is None
    # the Phase-1 queue page reads the same observation rows
    qi = c.get(f"/api/stores/{STORE}/queue-intelligence").json()
    assert qi["counters"][0]["waitingCustomers"] == 3 and qi["counters"][0]["serviceRatePerMin"] == 2.0


def test_queue_persistence_is_throttled_and_forecast_is_stored_with_version(world):
    c = world
    setup_queue(c)
    now = (datetime.now(timezone.utc) - T0).total_seconds() - 60
    post_events(c, [qupd(2, now + i, rate=2.0, arr=3.0) for i in range(0, 14)])  # 14 s of 1 Hz updates
    db = Database(c.settings.database_url)
    with db.session() as s:
        assert s.scalar(select(func.count()).select_from(QueueObservation)) == 1  # cadence 15 s
        fc = s.scalars(select(QueueForecast).order_by(QueueForecast.horizon_minutes)).all()
    db.dispose()
    assert [f.horizon_minutes for f in fc] == [5, 10, 15] and all(f.model_version == "persistence-v1" for f in fc)
    assert fc[0].predicted_length == pytest.approx(2.0) and fc[0].inputs["basis"] == "persistence" and fc[0].inputs["driftPerMin"] == pytest.approx(1.0) and fc[0].forecast_for is not None
    post_events(c, [qupd(2, now + 15.5, rate=2.0, arr=3.0)])  # next cadence tick
    hist = c.get(f"/api/stores/{STORE}/queue/history?counterId=cnt-1&range=week").json()
    assert len(hist["points"]) == 2
    f = c.get(f"/api/stores/{STORE}/queue/forecast?counterId=cnt-1").json()
    assert f["items"][0]["forecast"][0]["congestionRisk"] in ("low", "medium", "high") and "no learned model" in f["model"] and "persistence-v1" in f["model"]


def test_congestion_alerts_need_to_persist_are_deduplicated_and_auto_resolve(world):
    c = world
    setup_queue(c)
    base = (datetime.now(timezone.utc) - T0).total_seconds() - 60
    with open_events(c, STORE) as ws:
        seq = [qupd(2, base, congestion="optimal"), qupd(8, base + 1, congestion="critical")]  # a flicker...
        post_events(c, seq)
        got = {m["type"] for m in collect(ws, ["queue.congestion", "queue.updated"])}
        assert "queue.congestion" in got and "queue.updated" in got
    assert [a for a in c.get(f"/api/stores/{STORE}/queue-intelligence").json()["alerts"] if a["status"] == "active"] == []  # held < 20 s: no alert yet
    post_events(c, [qupd(8, base + 5 + i * 5, congestion="critical") for i in range(8)])  # persists 40 s
    active = [a for a in c.get(f"/api/stores/{STORE}/alerts?module=queue").json()["items"] if a["status"] == "active"]
    assert len(active) == 1 and active[0]["severity"] == "critical" and active[0]["category"] == "queue_congestion" and active[0]["counterId"] == "cnt-1"
    db = Database(c.settings.database_url)
    with db.session() as s:
        a = s.scalars(select(Alert).where(Alert.dedupe_key == "queue:cnt-1:congestion")).one()
        assert a.occurrences >= 2 and a.last_seen_at is not None and '"length":8' in a.evidence
    db.dispose()
    # clears only after the condition has been gone for alert_clear_seconds
    post_events(c, [qupd(1, base + 50, congestion="optimal"), qupd(1, base + 80, congestion="optimal")])
    assert [x for x in c.get(f"/api/stores/{STORE}/alerts?module=queue").json()["items"] if x["status"] == "active"]
    post_events(c, [qupd(1, base + 120, congestion="optimal")])
    items = c.get(f"/api/stores/{STORE}/alerts?module=queue").json()["items"]
    assert all(x["status"] == "resolved" for x in items) and len(items) == 1
    # re-congestion right after re-opens the SAME alert row instead of flapping a new one
    post_events(c, [qupd(9, base + 125 + i * 5, congestion="critical") for i in range(8)])
    items = c.get(f"/api/stores/{STORE}/alerts?module=queue").json()["items"]
    assert len(items) == 1 and items[0]["status"] == "active"


def test_unreliable_queue_observations_never_raise_congestion_and_service_samples_persist(world):
    c = world
    setup_queue(c)
    base = (datetime.now(timezone.utc) - T0).total_seconds() - 60
    post_events(c, [qupd(12, base + i * 5, congestion="critical", reliable=False) for i in range(10)])
    assert c.get(f"/api/stores/{STORE}/alerts?module=queue").json()["items"] == []
    svc = ev("queue.service", {"counterId": "cnt-1", "serviceSeconds": 24.0, "waitSeconds": 51.0, "completedAt": t(base).isoformat()}, base, camera="cam-chk")
    assert post_events(c, [svc])["accepted"] == 1 and post_events(c, [svc])["duplicates"] == 1
    rates = c.get(f"/api/stores/{STORE}/queue/service-rates?range=week").json()["items"][0]
    assert rates["completedServices"] == 1 and rates["serviceRatePerMin"] == 2.5 and rates["meanMeasuredWaitSeconds"] == 51.0


def test_queue_trend_alert_when_the_forecast_says_it_will_become_congested(world):
    c = world
    setup_queue(c)
    base = (datetime.now(timezone.utc) - T0).total_seconds() - 60
    post_events(c, [qupd(2, base + i * 5, rate=1.0, arr=3.0, congestion="optimal") for i in range(10)])  # arrivals 3/min vs service 1/min
    trend = [a for a in c.get(f"/api/stores/{STORE}/alerts?module=queue").json()["items"] if "growing" in a["title"]]
    assert len(trend) == 1 and trend[0]["severity"] == "warning" and "faster than they are served" in trend[0]["description"]


# ================================================================== inventory
def setup_shelf(c):
    sq = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]
    assert c.put(f"/api/stores/{STORE}/shelves/shf-1/region", json={"cameraId": "cam-shf", "polygon": sq, "classMap": {"milk": "milk"}, "expectedVisibleCapacity": 12}).status_code == 200


def sobs(status, at, count, changed=False, raw=None, eid=None):
    return ev("shelf.observation", {"shelfId": "shf-1", "status": status, "rawStatus": raw or status, "changed": changed, "count": count, "perClass": {"milk": count},
                                    "meanConfidence": 0.82, "availabilityPct": round(count / 12 * 100, 1), "expectedUnits": 12, "occludedFraction": 0.0,
                                    "modelId": "shelf-test", "modelVersion": "0", "boxes": [["milk", 0.8, 0.1, 0.1, 0.05, 0.2]], "observedAt": t(at).isoformat()},
              at, camera="cam-shf", eid=eid)


def test_shelf_alerts_follow_confirmed_changes_dedupe_escalate_and_resolve(world):
    c = world
    setup_shelf(c)
    base = (datetime.now(timezone.utc) - T0).total_seconds() - 200
    with open_events(c, STORE) as ws:
        post_events(c, [sobs("low_stock", base, 3, changed=True)])
        types = {m["type"] for m in collect(ws, ["shelf.updated", "inventory.low_stock"])}
        assert {"shelf.updated", "inventory.low_stock"} <= types
    post_events(c, [sobs("low_stock", base + 20, 3), sobs("low_stock", base + 40, 2)])
    alerts = c.get(f"/api/stores/{STORE}/inventory/alerts").json()["items"]
    assert len(alerts) == 1 and alerts[0]["severity"] == "warning" and alerts[0]["category"] == "stock_shortage" and alerts[0]["shelfId"] == "shf-1"
    # escalation updates the SAME alert
    with open_events(c, STORE) as ws:
        post_events(c, [sobs("out_of_stock", base + 60, 0, changed=True)])
        types = {m["type"] for m in collect(ws, ["inventory.out_of_stock"])}
        assert "inventory.out_of_stock" in types
    alerts = c.get(f"/api/stores/{STORE}/inventory/alerts").json()["items"]
    assert len(alerts) == 1 and alerts[0]["severity"] == "critical" and "out of stock" in alerts[0]["title"]
    ev_log = c.get(f"/api/stores/{STORE}/events?type=inventory.out_of_stock").json()["items"]
    assert ev_log and ev_log[0]["severity"] == "critical" and ev_log[0]["payload"]["observed"] == 0
    post_events(c, [sobs("in_stock", base + 120, 10, changed=True)])
    assert c.get(f"/api/stores/{STORE}/inventory/alerts").json()["items"][0]["status"] == "resolved"
    obs = c.get(f"/api/stores/{STORE}/inventory/observations?shelfId=shf-1").json()
    assert obs["model"]["code"] == "MODEL_NOT_CONFIGURED" and obs["items"][0]["status"] == "in_stock"
    assert obs["items"][0]["evidence"]["perClass"] == {"milk": 10} and obs["items"][0]["modelId"] == "shelf-test"
    hist = c.get(f"/api/stores/{STORE}/inventory/history?shelfId=shf-1&range=week").json()
    assert [p["status"] for p in hist["points"]][-1] == "in_stock" and hist["meta"]["dataState"] == "available"


def test_shelf_observation_rows_are_throttled_when_nothing_changes(world):
    c = world
    setup_shelf(c)
    base = (datetime.now(timezone.utc) - T0).total_seconds() - 60
    post_events(c, [sobs("in_stock", base + i, 10) for i in range(30)])
    db = Database(c.settings.database_url)
    with db.session() as s:
        assert s.scalar(select(func.count()).select_from(ShelfObservation)) == 1  # 60 s cadence, 30 s of input
    db.dispose()


def test_shelf_model_status_and_inventory_service_use_confirmed_observation(world):
    c = world
    m = c.get(f"/api/stores/{STORE}/inventory/model").json()
    assert m["status"] == "NOT_CONFIGURED" and m["ready"] is False and m["code"] == "MODEL_NOT_CONFIGURED" and "person detector is never used" in m["message"]
    ps = c.get(f"/api/stores/{STORE}/inventory/planogram-status").json()
    assert ps["items"] == [] and ps["meta"]["dataState"] == "unavailable"
    setup_shelf(c)
    ps = c.get(f"/api/stores/{STORE}/inventory/planogram-status").json()
    assert ps["items"][0]["compliancePct"] is None and ps["items"][0]["note"] == "MODEL_NOT_CONFIGURED"


# ================================================================== camera health + central event log
def test_camera_disconnect_alert_is_deduplicated_and_resolved_when_the_camera_returns(world):
    c = world
    setup_queue(c)
    post_events(c, [ev("camera.disconnected", {"state": "offline", "previousState": "live", "errorCode": "STREAM_LOST", "message": "Stream lost"}, 10, camera="cam-chk", eid="dc1"),
                    ev("camera.disconnected", {"state": "offline", "previousState": "reconnecting", "errorCode": "CONNECT_FAILED"}, 40, camera="cam-chk", eid="dc2")])
    items = c.get(f"/api/stores/{STORE}/alerts").json()["items"]
    cam = [a for a in items if a["category"] == "camera_disconnected"]
    assert len(cam) == 2  # one camera alert + one queue-specific alert (queue camera unavailable), each only once
    assert {a["module"] for a in cam} == {"camera", "queue"} and all(a["status"] == "active" for a in cam)
    post_events(c, [ev("camera.connected", {"state": "live", "previousState": "offline"}, 100, camera="cam-chk")])
    assert all(a["status"] == "resolved" for a in c.get(f"/api/stores/{STORE}/alerts").json()["items"])
    log = c.get(f"/api/stores/{STORE}/events").json()["items"]
    assert {"camera.disconnected", "camera.connected"} <= {i["type"] for i in log}
    assert all(i["id"] for i in log)  # every logged event has an id, timestamp and severity
    assert all(i["occurredAt"] and i["severity"] in ("info", "warning", "critical") for i in log)


def test_passthrough_events_still_reach_the_websocket_and_model_errors_are_critical(world):
    c = world
    with open_events(c, STORE) as ws:
        post_events(c, [ev("model.error", {"id": "shelf-monitor", "status": "ERROR", "lastError": "weights missing"}, 1, camera=None, eid="me1")])
        m = ws.receive_json()
        assert m["type"] == "model.error" and m["payload"]["lastError"] == "weights missing" and m["payload"]["eventId"] == "me1"
    log = c.get(f"/api/stores/{STORE}/events?type=model.error").json()["items"]
    assert log[0]["severity"] == "critical"


def test_heatmap_payload_with_repeated_cells_is_merged_not_fatal(world):
    c = world
    cells = [[3, 4, 2], [3, 4, 5], [7, 7, 1]]
    out = post_events(c, [ev("heatmap.flush", {"bucketStart": t(1100).isoformat(), "gridW": 32, "gridH": 18, "cells": cells}, 1100, camera="cam-ent")])
    assert out["accepted"] == 1 and out["rejected"] == {}
    out = post_events(c, [ev("heatmap.flush", {"bucketStart": t(1100).isoformat(), "gridW": 32, "gridH": 18, "cells": [[3, 4, 3]]}, 1100, camera="cam-ent")])
    assert out["accepted"] == 1
    hm = c.get(f"/api/stores/{STORE}/heatmap?cameraId=cam-ent&range=week").json()
    assert {(x["gx"], x["gy"]): x["count"] for x in hm["cells"]} == {(3, 4): 10, (7, 7): 1}
