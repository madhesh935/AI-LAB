from database import manage


def test_startup_health_and_status(client):
    assert client.get("/api/health").json()["status"] == "ok"
    status = client.get("/api/system/status").json()
    assert status["database"]["ok"] is True
    assert status["database"]["foreignKeys"] is True
    assert status["database"]["journalMode"] == "wal"
    assert status["database"]["schemaRevision"] == manage.head_revision(client.settings)
    assert status["demoDataPresent"] is False
    assert status["auth"].startswith("none")


def test_router_registration(client):
    paths = client.get("/openapi.json").json()["paths"]
    for expected in (
        "/api/stores", "/api/stores/{store_id}/overview", "/api/stores/{store_id}/shopper-analytics",
        "/api/stores/{store_id}/inventory", "/api/stores/{store_id}/queue-intelligence",
        "/api/stores/{store_id}/cameras", "/api/stores/{store_id}/insights", "/api/stores/{store_id}/reports/{category}",
        "/api/stores/{store_id}/staff", "/api/stores/{store_id}/tasks", "/api/stores/{store_id}/alerts",
        "/api/stores/{store_id}/ingest", "/api/copilot/chat", "/api/staff/me", "/api/public/stores",
        "/api/customer/assistance",
    ):
        assert expected in paths, expected


def test_error_envelope_and_not_found(client):
    r = client.get("/api/stores/nope/overview")
    assert r.status_code == 404
    body = r.json()["error"]
    assert body["code"] == "not_found" and body["requestId"]
    assert client.get("/api/does-not-exist").status_code == 404


def test_no_authentication_surface(client):
    paths = client.get("/openapi.json").json()["paths"]
    assert not any(k in p.lower() for p in paths for k in ("login", "signup", "token", "oauth", "register"))


def test_mutation_rate_limit(tmp_path):
    from fastapi.testclient import TestClient
    from main import create_app
    from tests.conftest import make_settings

    s = make_settings(tmp_path)
    s.mutation_rate_limit_per_minute = 3
    manage.upgrade(s)
    with TestClient(create_app(s)) as c:
        codes = [c.post("/api/customer/feedback", json={"rating": 5}).status_code for _ in range(5)]
    assert 429 in codes and codes[0] == 201


def test_vision_worker_ingest_is_not_rate_limited(tmp_path):
    """The worker posts detection batches many times a second; a 429 there silently loses counts."""
    from fastapi.testclient import TestClient
    from main import create_app
    from tests.conftest import make_settings

    s = make_settings(tmp_path)
    s.mutation_rate_limit_per_minute = 3
    manage.upgrade(s)
    with TestClient(create_app(s)) as c:
        codes = [c.post("/api/internal/vision/events", json={"workerId": "w", "events": []}).status_code for _ in range(8)]
    assert 429 not in codes
