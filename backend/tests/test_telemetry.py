"""Empty states, inference ingestion, derived metrics, seed behaviour."""
import pytest

from tests.conftest import open_events


def test_empty_store_never_fabricates_numbers(client):
    ov = client.get("/api/stores/store-a/overview").json()
    assert ov["meta"]["dataState"] == "unavailable"
    m = ov["metrics"]
    assert m["totalFootfallToday"] is None and m["currentOccupancy"] is None and m["averageWaitTimeMinutes"] is None
    assert m["maxCapacity"] == 100 and m["camerasTotal"] == 0
    assert all(v in ("unavailable", "empty") for v in ov["dataAvailability"].values())
    assert ov["connection"]["status"] == "disconnected"

    for path in ("shopper-analytics", "footfall", "dwell", "inventory", "queue-intelligence", "cameras", "insights", "reports/overview"):
        r = client.get(f"/api/stores/store-a/{path}")
        assert r.status_code == 200, path
        assert r.json()["meta"]["dataState"] in ("unavailable", "empty"), path

    assert client.get("/api/stores/store-a/shopper-analytics").json()["hourlyTraffic"] == []
    assert client.get("/api/stores/store-a/reports/bogus").status_code == 404
    tasks = client.get("/api/stores/store-a/tasks").json()
    assert tasks["items"] == [] and tasks["total"] == 0 and tasks["meta"]["dataState"] == "empty"


def test_demo_data_is_never_present_by_default(client):
    assert client.get("/api/system/status").json()["demoDataPresent"] is False
    assert client.get("/api/stores").json()[0]["edgeServerStatus"] == "disconnected"


def test_ingest_populates_dashboards(client):
    cam = client.post("/api/stores/store-a/cameras", json={"name": "Door", "cameraCode": "CAM-X", "type": "entrance"}).json()
    assert cam["status"] == "offline" and cam["message"]  # registered but never reported -> offline, not live

    batch = {
        "footfall": [{"cameraId": cam["id"], "direction": "in", "count": 40}, {"direction": "out", "count": 10}],
        "cameraStatus": [{"cameraId": cam["id"], "state": "live", "fps": 24.5}],
    }
    r = client.post("/api/stores/store-a/ingest", json=batch).json()
    assert r["accepted"] == {"footfall": 2, "cameraStatus": 1} and r["rejected"] == {}

    ov = client.get("/api/stores/store-a/overview").json()
    assert ov["metrics"]["totalFootfallToday"] == 40
    assert ov["metrics"]["currentOccupancy"] == 30
    assert ov["metrics"]["camerasOnline"] == 1
    assert ov["connection"]["status"] == "connected"
    assert ov["dataAvailability"]["footfall"] == "available"
    assert client.get("/api/stores/store-a/cameras").json()["cameras"][0]["status"] == "live"
    # store B is unaffected
    assert client.get("/api/stores/store-b/overview").json()["metrics"]["totalFootfallToday"] is None


def test_ingest_rejects_foreign_references(client):
    client.post("/api/stores/store-b/cameras", json={"name": "B cam", "cameraCode": "CAM-B", "type": "aisle"})
    cam_b = client.get("/api/stores/store-b/cameras").json()["cameras"][0]["id"]
    r = client.post("/api/stores/store-a/ingest", json={"footfall": [{"cameraId": cam_b, "direction": "in"}], "queueObservations": [{"counterId": "nope", "queueLength": 3}]}).json()
    assert r["accepted"] == {} and r["rejected"] == {"footfall": 1, "queueObservations": 1}
    assert client.post("/api/stores/store-a/ingest", json={"footfall": [{"direction": "sideways"}]}).status_code == 422
    assert client.post("/api/stores/store-a/ingest", json={"shelfObservations": [{"shelfId": "s", "detectedUnits": -1}]}).status_code == 422


def test_camera_registration_conflicts_and_reconnect(client):
    body = {"name": "Dock", "cameraCode": "CAM-D", "type": "aisle"}
    assert client.post("/api/stores/store-a/cameras", json=body).status_code == 201
    assert client.post("/api/stores/store-a/cameras", json=body).status_code == 409
    assert client.post("/api/stores/store-a/cameras", json={**body, "cameraCode": "bad code!"}).status_code == 422
    cid = client.get("/api/stores/store-a/cameras").json()["cameras"][0]["id"]
    r = client.post(f"/api/stores/store-a/cameras/{cid}/reconnect").json()
    # Phase 2: no source configured -> nothing to reconnect, and nothing is claimed live.
    assert r["requested"] is False and r["state"] == "offline" and "no source configured" in r["note"]
    assert client.post(f"/api/stores/store-b/cameras/{cid}/reconnect").status_code == 404


def test_queue_rules_and_counter_status(seeded):
    rules = {"slaWarningWaitMinutes": 2.5, "slaCriticalWaitMinutes": 4, "maxQueueLength": 6, "expressCartLimit": 8, "forecastHorizonMinutes": 15, "autoDispatch": False}
    assert seeded.put("/api/stores/store-blr-104/queue/rules", json=rules).json()["slaCriticalWaitMinutes"] == 4
    assert seeded.put("/api/stores/store-blr-104/queue/rules", json={**rules, "maxQueueLength": 0}).status_code == 422
    assert seeded.post("/api/stores/store-blr-104/counters/cnt-04/status", json={"status": "open"}).json()["status"] == "open"
    assert seeded.post("/api/stores/store-blr-104/counters/cnt-04/status", json={"status": "broken"}).status_code == 422
    assert seeded.post("/api/stores/store-kor-102/counters/cnt-04/status", json={"status": "open"}).status_code == 404


# ----------------------------------------------------------- demo seed
def test_seed_is_explicit_idempotent_and_never_overwrites(settings):
    from database.connection import Database
    from database.models import Store
    from database.seed import seed_demo

    first = seed_demo(settings)
    assert first["inserted"] > 50
    db = Database(settings.database_url)
    with db.transaction() as s:
        s.get(Store, "store-blr-104").name = "Renamed by a human"
    db.dispose()

    second = seed_demo(settings)
    assert second["inserted"] == 0  # primary-key checks: nothing duplicated
    db = Database(settings.database_url)
    with db.transaction() as s:
        assert s.get(Store, "store-blr-104").name == "Renamed by a human"  # real edits survive a re-seed
    db.dispose()


def test_seeded_pages_and_demo_flag(seeded):
    assert seeded.get("/api/system/status").json()["demoDataPresent"] is True
    ov = seeded.get("/api/stores/store-blr-104/overview").json()
    assert ov["metrics"]["outOfStockShelvesCount"] == 1  # Sourdough: 0 detected
    assert ov["metrics"]["lowStockShelvesCount"] >= 3
    assert ov["connection"]["status"] == "disconnected"  # seed does not claim a live pipeline
    assert all(c["status"] == "offline" for c in ov["cameras"])
    inv = seeded.get("/api/stores/store-blr-104/inventory").json()
    sourdough = next(s for s in inv["shelves"] if s["shelfCode"] == "Shelf B2-Bakery")
    assert sourdough["condition"] == "out_of_stock" and sourdough["detectedVisibleUnits"] == 0
    q = seeded.get("/api/stores/store-blr-104/queue-intelligence").json()
    assert q["kpis"]["totalCounters"] == 4 and q["kpis"]["longestWaitMinutes"] > 4.5
    c2 = next(c for c in q["counters"] if c["id"] == "cnt-02")
    assert c2["congestion"] in ("high", "critical")
    # second store is a bare shell: filtering works
    assert seeded.get("/api/stores/store-kor-102/tasks").json()["total"] == 0
    assert seeded.get("/api/stores/store-blr-104/tasks").json()["total"] == 3
    assert len(seeded.get("/api/stores").json()) == 2


def test_insights_actions_and_task_creation(seeded):
    ins = seeded.get("/api/stores/store-blr-104/insights").json()
    assert ins["footfallForecast"]["available"] is False and ins["footfallForecast"]["requiredDays"] == 14  # no forecast model yet, history is reported honestly
    derived = [i for i in ins["insights"] if i["source"] == "derived"]
    assert any("B2-Bakery" in i["title"] and i["severity"] == "critical" for i in derived), "an empty shelf in the observations must produce an insight"
    assert all(i["evidence"]["metricsTable"] and i["evidence"]["triggerRule"] for i in derived), "every derived insight states the rule and the measured values"
    assert any(o["type"] == "shelf_velocity" for o in ins["opportunities"])
    iid = ins["insights"][0]["id"]
    r = seeded.post(f"/api/stores/store-blr-104/insights/{iid}/tasks", json={"employeeId": "STF-02", "priority": "high"}).json()
    assert r["task"]["assignedEmployeeId"] == "STF-02" and r["insight"]["status"] == "in_progress" and r["insight"]["taskId"] == r["task"]["id"]
    assert seeded.post(f"/api/stores/store-blr-104/insights/{iid}/actions", json={"action": "dismiss", "reason": "Handled"}).json()["status"] == "dismissed"
    assert seeded.post(f"/api/stores/store-blr-104/insights/{iid}/actions", json={"action": "start"}).status_code == 409


def test_reports_aggregate_real_rows(seeded):
    ops = seeded.get("/api/stores/store-blr-104/reports/operations", params={"range": "today"}).json()
    assert ops["summary"]["alerts"] == 3 and ops["meta"]["dataState"] == "available"
    cfg = seeded.post("/api/stores/store-blr-104/reports/configurations", json={"name": "Weekly ops", "category": "operations", "dateRange": "week"})
    assert cfg.status_code == 201
    assert len(seeded.get("/api/stores/store-blr-104/reports/configurations").json()) == 1
    assert seeded.delete(f"/api/report-configurations/{cfg.json()['id']}").status_code == 428


# ------------------------------------------------------------- customer / copilot / ws
def test_customer_assistance_creates_real_task(seeded):
    r = seeded.post("/api/customer/assistance", json={"storeId": "store-blr-104", "category": "cannot_find_product", "description": "Need almond milk", "aisleOrZone": "Aisle 3"})
    assert r.status_code == 201
    req = r.json()["request"]
    assert req["status"] in ("submitted", "assigned") and len(req["statusRef"]) >= 30
    assert "assignedStaffName" not in req and "employee" not in str(req).lower()  # no employee data for shoppers
    tasks = seeded.get("/api/stores/store-blr-104/tasks", params={"category": "customer_assistance"}).json()["items"]
    assert len(tasks) == 1 and tasks[0]["source"] == "customer_request" and tasks[0]["customerRequestId"] == req["requestId"]
    assert seeded.get(f"/api/customer/assistance/{req['statusRef']}").json()["description"] == "Need almond milk"
    assert seeded.get(f"/api/customer/assistance/{req['requestId']}").status_code == 404  # the short id is not a credential
    assert seeded.get("/api/customer/assistance/REQ-NOPE").status_code == 404
    assert seeded.post("/api/customer/feedback", json={"storeId": "store-blr-104", "experienceRating": 4, "comments": "ok"}).status_code == 201
    assert seeded.get("/api/public/stores/store-blr-104/queues").status_code == 200
    assert seeded.get("/api/public/stores/store-blr-104/layout").json()["zones"]
    assert len(seeded.get("/api/public/stores/store-blr-104/offers").json()) == 2
    assert seeded.get("/api/public/stores/store-blr-104/products", params={"q": "almond"}).json()[0]["name"].startswith("Organic")


# (the Phase-4 /api/copilot/actions/preview test was replaced by the Phase 5 two-phase tests in tests/test_copilot.py: actions are now prepared only by the Copilot's own tools)


def test_copilot_conversation_soft_delete(seeded):
    from database.connection import Database
    from database.models import CopilotConversation

    db = Database(seeded.settings.database_url)
    with db.transaction() as s:
        s.add(CopilotConversation(id="conv-x", store_id="store-blr-104", title="Test", context={}))
    db.dispose()
    assert [c["id"] for c in seeded.get("/api/copilot/conversations", params={"store_id": "store-blr-104"}).json()] == ["conv-x"]
    assert seeded.delete("/api/copilot/conversations/conv-x").json()["archived"] is True
    assert seeded.get("/api/copilot/conversations", params={"store_id": "store-blr-104"}).json() == []
    assert seeded.get("/api/copilot/conversations/conv-x").status_code == 404


def test_websocket_receives_task_events(client):
    with open_events(client, "store-a") as ws:
        client.post("/api/stores/store-a/tasks", json={"title": "Realtime task"})
        event = ws.receive_json()
        assert event["type"] == "task.created" and event["payload"]["status"] == "new"
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/stores/ghost/events"):
            pass
