"""Phase 4: unified task engine, workforce, customer privacy, realtime contract, LAN guard, overview/report honesty."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from core.network import in_networks, remote_allowed
from main import create_app
from tests.conftest import make_settings, open_events

STORE = "store-blr-104"


def mk_emp(client, role="inventory_associate", name="Phase Four", store="store-a"):
    r = client.post(f"/api/stores/{store}/staff", json={"name": name, "role": role, "skills": []})
    assert r.status_code == 201, r.text
    return r.json()


# ------------------------------------------------------------------ task engine
def test_idempotency_key_never_creates_two_tasks(client):
    body = {"title": "Restock almond milk", "category": "shelf_replenishment", "priority": "high"}
    a = client.post("/api/stores/store-a/tasks", json=body, headers={"Idempotency-Key": "k-1"})
    b = client.post("/api/stores/store-a/tasks", json=body, headers={"Idempotency-Key": "k-1"})
    assert a.status_code == 201 and b.status_code == 200
    assert b.headers.get("X-Idempotent-Replay") == "true"
    assert a.json()["id"] == b.json()["id"]
    assert client.get("/api/stores/store-a/tasks").json()["total"] == 1


def test_open_task_for_same_shelf_is_not_duplicated(seeded):
    shelf = seeded.get(f"/api/stores/{STORE}/inventory/shelves").json()[0]["id"]
    open_before = seeded.get(f"/api/stores/{STORE}/tasks").json()["total"]
    first = seeded.post(f"/api/stores/{STORE}/tasks", json={"title": "Restock shelf A", "category": "shelf_replenishment", "shelfId": shelf})
    second = seeded.post(f"/api/stores/{STORE}/tasks", json={"title": "Restock shelf A again", "category": "shelf_replenishment", "shelfId": shelf})
    assert second.json()["id"] == first.json()["id"], "a second open task for the same shelf must return the existing one"
    assert seeded.get(f"/api/stores/{STORE}/tasks").json()["total"] <= open_before + 1


def test_transitions_are_validated_and_recorded(client):
    emp = mk_emp(client)
    tid = client.post("/api/stores/store-a/tasks", json={"title": "Check camera", "category": "general_operations"}).json()["id"]
    # cannot complete a task nobody started
    assert client.post(f"/api/tasks/{tid}/complete", json={"employeeId": emp["id"]}).status_code == 409
    assert client.post(f"/api/tasks/{tid}/accept", json={"employeeId": emp["id"]}).status_code == 200
    assert client.post(f"/api/tasks/{tid}/start", json={"employeeId": emp["id"]}).json()["task"]["status"] == "in_progress"
    done = client.post(f"/api/tasks/{tid}/complete", json={"employeeId": emp["id"], "completionNotes": "ok"})
    assert done.json()["task"]["status"] == "completed"
    hist = client.get(f"/api/tasks/{tid}/history").json()
    assert [h["toStatus"] for h in hist][-1] == "completed" and len(hist) >= 3
    assert client.post(f"/api/tasks/{tid}/cancel", json={}).status_code == 409  # terminal


def test_role_eligibility_with_supervisor_override(client):
    cashier = mk_emp(client, role="cashier", name="Till Person")
    body = {"title": "Restock bread", "category": "shelf_replenishment", "assignedEmployeeId": cashier["id"]}
    refused = client.post("/api/stores/store-a/tasks", json=body)
    assert refused.status_code in (409, 422), refused.text
    forced = client.post("/api/stores/store-a/tasks", json={**body, "force": True})
    assert forced.status_code == 201
    hist = client.get(f"/api/tasks/{forced.json()['id']}/history").json()
    assert any("override" in (h.get("note") or "").lower() for h in hist), "the override must be visible in the task history"


def test_seeded_roles_map_to_canonical_eligibility(seeded):
    """'supervisor' / 'restock_specialist' (seeded role keys) are recognised for the categories they can really do."""
    staff = {e["id"]: e for e in seeded.get(f"/api/stores/{STORE}/staff").json()["items"]}
    restock = next(e for e in staff.values() if e["role"] == "restock_specialist")
    ok = seeded.post(f"/api/stores/{STORE}/tasks", json={"title": "Restock dairy shelf", "category": "shelf_replenishment", "assignedEmployeeId": restock["id"]})
    assert ok.status_code == 201, ok.text


def test_completing_a_task_does_not_touch_observed_stock(seeded):
    before = seeded.get(f"/api/stores/{STORE}/inventory").json()["shelves"]
    task = next(t for t in seeded.get(f"/api/stores/{STORE}/tasks").json()["items"] if t["status"] == "in_progress")
    assert seeded.post(f"/api/tasks/{task['id']}/complete", json={"employeeId": task["assignedEmployeeId"]}).status_code == 200
    after = seeded.get(f"/api/stores/{STORE}/inventory").json()["shelves"]
    key = lambda rows: {s["id"]: s["detectedVisibleUnits"] for s in rows}  # noqa: E731
    assert key(before) == key(after), "staff task completion must never rewrite observed shelf quantities"


# ------------------------------------------------------------------ workforce
def shift(emp, date, start, end, name="Shift"):
    return {"employeeId": emp, "shiftDate": date, "shiftName": name, "startTime": start, "endTime": end}


def test_shift_overlap_and_overnight(client):
    emp = mk_emp(client)["id"]
    assert client.post("/api/stores/store-a/shifts", json=shift(emp, "2030-01-10", "08:00", "16:00")).status_code == 201
    assert client.post("/api/stores/store-a/shifts", json=shift(emp, "2030-01-10", "15:00", "20:00", "Second")).status_code == 409
    night = client.post("/api/stores/store-a/shifts", json=shift(emp, "2030-01-10", "22:00", "06:00", "Night"))
    assert night.status_code == 201 and night.json()["overnight"] is True
    # the overnight shift runs into the 11th: an early shift that day collides with it
    assert client.post("/api/stores/store-a/shifts", json=shift(emp, "2030-01-11", "05:00", "09:00", "Early")).status_code == 409
    assert client.post("/api/stores/store-a/shifts", json=shift(emp, "2030-01-11", "08:00", "12:00", "Later")).status_code == 201


def around_now():
    """(date, start, end) of a shift that is running right now in the store's default timezone (Asia/Kolkata)."""
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    a, b = now - timedelta(hours=1), now + timedelta(hours=2)
    return a.date().isoformat(), a.strftime("%H:%M"), b.strftime("%H:%M")


def test_scheduled_is_not_checked_in_and_checkin_uses_server_time(client):
    emp = mk_emp(client)["id"]
    today, start, end = around_now()
    assert client.post("/api/stores/store-a/shifts", json=shift(emp, today, start, end, "Now")).status_code == 201
    av = client.get("/api/stores/store-a/staff/availability").json()
    row = next(r for r in av["items"] if r["employeeId"] == emp)
    assert row["scheduledNow"] is True and row["checkedIn"] is False
    assert row["onDuty"] is False, "rostered but nobody checked in => not on duty"
    res = client.post("/api/staff/me/check-in", json={"employeeId": emp}).json()
    assert res["success"] and res["record"]["actualIn"], "the server stamps the time"
    av = client.get("/api/stores/store-a/staff/availability").json()
    assert next(r for r in av["items"] if r["employeeId"] == emp)["onDuty"] is True


def test_derived_attendance_row_can_be_corrected_by_supervisor(client):
    emp = mk_emp(client)["id"]
    today, start, end = around_now()
    assert client.post("/api/stores/store-a/shifts", json=shift(emp, today, start, end, "Now")).status_code == 201
    rows = client.get("/api/stores/store-a/attendance").json()["items"]
    derived = next(r for r in rows if r["employeeId"] == emp)
    assert derived["derived"] is True and derived["actualIn"] is None
    r = client.patch(f"/api/attendance/{derived['id']}", json={"status": "present", "overrideReason": "Forgot to tap in"})
    assert r.status_code == 200, r.text
    rows = client.get("/api/stores/store-a/attendance").json()["items"]
    mine = next(x for x in rows if x["employeeId"] == emp)
    assert mine["derived"] is False and mine["source"] == "supervisor" and mine["status"] == "present"


# ------------------------------------------------------------------ customer privacy + assistance
FORBIDDEN_KEYS = {"stockroomQty", "detectedVisibleQty", "expectedVisibleQty", "confidenceScore", "modelId", "supplier", "cameraId", "sku", "assignedEmployeeId", "phone", "email"}


def walk(node):
    if isinstance(node, dict):
        for k, v in node.items():
            yield k
            yield from walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk(v)


def test_public_api_never_exposes_internal_fields(seeded):
    for path in (f"/api/public/stores/{STORE}/products", f"/api/public/stores/{STORE}/queues", f"/api/public/stores/{STORE}/layout", f"/api/public/stores/{STORE}/offers"):
        body = seeded.get(path).json()
        assert not (set(walk(body)) & FORBIDDEN_KEYS), (path, set(walk(body)) & FORBIDDEN_KEYS)
    prod = seeded.get(f"/api/public/stores/{STORE}/products").json()[0]
    assert prod["availability"]["state"] in ("in_stock", "low_stock", "out_of_stock", "unknown")
    assert "not the store" in prod["availability"]["note"].lower(), "shelf status must be distinguished from total store inventory"


def test_assistance_request_becomes_one_staff_task_and_syncs_status(seeded):
    before = seeded.get(f"/api/stores/{STORE}/tasks").json()["total"]
    r = seeded.post("/api/customer/assistance", json={"storeId": STORE, "category": "cannot_find_product", "description": "Cannot find oat milk", "aisleOrZone": "Aisle 2"})
    assert r.status_code == 201
    req = r.json()["request"]
    ref = req["statusRef"]
    assert len(ref) >= 24, "the status reference must be hard to guess"
    assert not (set(walk(req)) & {"assignedEmployeeId", "assignedStaffName", "phone", "email"})
    tasks = seeded.get(f"/api/stores/{STORE}/tasks").json()
    assert tasks["total"] == before + 1
    task = next(t for t in tasks["items"] if t.get("customerRequestId") == req["requestId"])
    # the request can only be read back with the long reference
    assert seeded.get("/api/customer/assistance/not-a-real-reference").status_code == 404
    got = seeded.get(f"/api/customer/assistance/{ref}").json()
    assert got["requestId"] == req["requestId"] and not (set(walk(got)) & {"assignedEmployeeId", "email", "phone"})
    # staff work on the task -> the customer's status follows
    emp = task.get("assignedEmployeeId")
    if emp:
        seeded.post(f"/api/tasks/{task['id']}/accept", json={"employeeId": emp})
        seeded.post(f"/api/tasks/{task['id']}/start", json={"employeeId": emp})
        seeded.post(f"/api/tasks/{task['id']}/complete", json={"employeeId": emp})
        assert seeded.get(f"/api/customer/assistance/{ref}").json()["status"] == "resolved"


# ------------------------------------------------------------------ LAN guard (network narrowing, NOT authentication)
def test_remote_allowlist_unit():
    assert remote_allowed("GET", "/api/public/stores/x/products")
    assert remote_allowed("POST", "/api/customer/assistance")
    assert remote_allowed("POST", "/api/tasks/T1/complete")
    assert not remote_allowed("POST", "/api/stores/x/counters/c/status")
    assert not remote_allowed("GET", "/api/stores/x/reports/summary/full")
    assert not remote_allowed("DELETE", "/api/tasks/T1")
    assert in_networks("192.168.1.20", ["192.168.0.0/16"]) and not in_networks("8.8.8.8", ["192.168.0.0/16"])


@pytest.mark.parametrize("allow_lan", [False, True])
def test_lan_guard_blocks_management_endpoints_for_remote_clients(tmp_path, allow_lan):
    s = make_settings(tmp_path, allow_lan=allow_lan)
    from database import manage
    from database.seed import seed_demo

    seed_demo(s)
    app = create_app(s)
    with TestClient(app, client=("192.168.1.50", 50000)) as remote:
        mgmt = remote.get(f"/api/stores/{STORE}/reports/summary/full")
        assert mgmt.status_code == 403 and mgmt.json()["error"]["code"] == "lan_restricted"
        pub = remote.get(f"/api/public/stores/{STORE}/products")
        assert pub.status_code == (200 if allow_lan else 403)
        assert remote.post(f"/api/stores/{STORE}/counters/cnt-01/status", json={"status": "closed"}).status_code == 403
    with TestClient(app, client=("8.8.8.8", 50000)) as outside:
        assert outside.get(f"/api/public/stores/{STORE}/products").status_code == 403  # not a private network
    with TestClient(app) as local:  # loopback keeps working
        assert local.get(f"/api/stores/{STORE}/reports/summary/full").status_code == 200
    _ = manage


# ------------------------------------------------------------------ realtime contract
def test_ws_envelope_replay_and_epoch_resync(client):
    with open_events(client, "store-a") as ws:
        epoch, seq0 = ws.hello["payload"]["epoch"], ws.snapshot["payload"]["seq"]
        client.post("/api/stores/store-a/tasks", json={"title": "Realtime task", "category": "general_operations"})
        ev = ws.receive_json()
        assert ev["type"] == "task.created" and ev["storeId"] == "store-a" and ev["seq"] == seq0 + 1
        assert set(ev) >= {"eventId", "seq", "storeId", "type", "timestamp", "source", "payload"}
    # reconnect with the last seq: nothing missed
    client.post("/api/stores/store-a/tasks", json={"title": "Missed while disconnected", "category": "general_operations"})
    with client.websocket_connect(f"/ws/stores/store-a/events?since={seq0 + 1}&epoch={epoch}") as ws:
        assert ws.receive_json()["payload"]["replay"] == "replayed"
        ws.receive_json()  # snapshot
        missed = ws.receive_json()
        assert missed["type"] == "task.created" and missed["payload"].get("title", "Missed while disconnected")
    # a different epoch (server restarted) => resync, not a bogus replay
    with client.websocket_connect(f"/ws/stores/store-a/events?since=1&epoch=oldrun") as ws:
        assert ws.receive_json()["payload"]["replay"] == "resync"
        ws.receive_json()
        assert ws.receive_json()["type"] == "resync"


def test_remote_ws_needs_an_audience_and_gets_filtered_events(tmp_path):
    s = make_settings(tmp_path, allow_lan=True)
    from database.seed import seed_demo

    seed_demo(s)
    app = create_app(s)
    with TestClient(app, client=("192.168.1.50", 5000)) as phone:
        with pytest.raises(Exception):
            with phone.websocket_connect(f"/ws/stores/{STORE}/events"):
                pass
        with phone.websocket_connect(f"/ws/stores/{STORE}/events?audience=customer") as ws:
            ws.receive_json()
            snap = ws.receive_json()
            assert set(snap["payload"]) <= {"epoch", "seq", "dataMode"}, "customers get no operational counters"


# ------------------------------------------------------------------ overview / reports honesty, demo vs real
def test_overview_reports_unmeasured_values_as_null_and_flags_demo(seeded, client):
    # the demo seed adds hourly footfall only for hours that already passed in store-local time, so the test must not depend on the clock:
    # remove it explicitly to model "no entrance counting data has been recorded"
    from database.connection import Database
    from database.models import FootfallAggregate

    db = Database(seeded.settings.database_url)
    with db.transaction() as s:
        for row in list(s.query(FootfallAggregate).filter(FootfallAggregate.store_id == STORE)):
            s.delete(row)
    db.dispose()
    ov = seeded.get(f"/api/stores/{STORE}/overview").json()
    assert ov["dataMode"] == "demo" and ov["metrics"]["totalFootfallToday"] is None and ov["metrics"]["currentOccupancy"] is None
    assert "freshness" in ov and ov["freshness"]["footfall"]["state"] == "unavailable"
    real = client.get("/api/stores/store-a/overview").json()
    assert real["dataMode"] == "real" and real["metrics"]["latestObservationAt"] is None
    stores = {s["id"]: s for s in seeded.get("/api/stores").json()}
    assert stores[STORE]["dataMode"] == "demo" and stores["store-a"]["dataMode"] == "real"


def test_reports_summary_has_no_fabricated_values_and_csv_is_safe(client):
    doc = client.get("/api/stores/store-a/reports/summary/full?range=week").json()
    assert doc["meta"]["dataState"] == "unavailable"
    assert doc["overview"]["kpis"]["totalFootfall"]["current"] is None
    assert doc["shoppers"]["dailyFootfall"] == [] and doc["queues"]["historyTimeline"] == []
    assert any("bounceRate" in f for f in doc["unavailableFields"])
    csv_ = client.get("/api/stores/store-a/reports/export/queues.csv?range=week")
    assert csv_.status_code == 200 and csv_.headers["content-type"].startswith("text/csv")
    assert "no records in this period" in csv_.text
    assert client.get("/api/stores/store-a/reports/export/nope.csv").status_code == 404


def test_report_csv_neutralises_formula_injection(seeded):
    from api.reports import _cell

    assert _cell("=HYPERLINK(\"x\")").startswith("'") and _cell("+1").startswith("'") and _cell("safe") == "safe" and _cell(None) == ""
    csv_ = seeded.get(f"/api/stores/{STORE}/reports/export/inventory.csv?range=today")
    assert csv_.status_code == 200 and "Stock-out log" in csv_.text


def test_camera_timeline_carries_source_timestamps(seeded):
    r = seeded.get(f"/api/stores/{STORE}/cameras/timeline")
    assert r.status_code == 200
    body = r.json()
    assert "items" in body and body["meta"]["dataState"] in ("available", "empty")
    for item in body["items"]:
        assert item["occurredAt"] and item["kind"] in ("status", "event", "alert")
    assert seeded.get(f"/api/stores/{STORE}/cameras/timeline?cameraId=nope").status_code == 404


def test_migration_0004_columns_exist(client):
    from sqlalchemy import inspect

    from database.connection import Database

    db = Database(client.settings.database_url)
    insp = inspect(db.engine)
    assert "data_mode" in {c["name"] for c in insp.get_columns("stores")}
    assert {"idempotency_key", "customer_request_id", "counter_id", "camera_id"} <= {c["name"] for c in insp.get_columns("tasks")}
    assert "idempotency_records" in insp.get_table_names() and "status_ref" in {c["name"] for c in insp.get_columns("customer_assistance_requests")}
    db.dispose()
    _ = json
