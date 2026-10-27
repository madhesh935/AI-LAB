"""Phase 5 system health: every component is probed; an answering API alone never means a healthy system."""

from __future__ import annotations

from fastapi.testclient import TestClient

from main import create_app
from tests.conftest import make_settings
from tests.fake_openrouter import API_KEY, FakeOpenRouter

STATES = {"READY", "LOADING", "DEGRADED", "OFFLINE", "NOT_CONFIGURED", "ERROR"}


def health(client):
    r = client.get("/api/system/health")
    assert r.status_code == 200
    return r.json(), {c["id"]: c for c in r.json()["components"]}


def test_all_components_reported_with_valid_states(seeded):
    h, c = health(seeded)
    assert {"fastapi", "sqlite", "cameras", "inference_worker", "person_model", "shelf_model", "tracking", "queue_analytics", "websocket", "llm", "pwa_integration"} <= set(c)
    assert all(x["state"] in STATES for x in c.values())
    assert h["coreOk"] is True and c["fastapi"]["state"] == "READY" and c["sqlite"]["state"] == "READY" and c["sqlite"]["facts"]["revision"] == c["sqlite"]["facts"]["head"]


def test_api_alone_is_not_a_healthy_system(seeded):
    h, c = health(seeded)
    # no vision worker runs in tests and the seeded cameras have no video source
    assert c["inference_worker"]["state"] == "OFFLINE" and c["person_model"]["state"] == "OFFLINE" and c["tracking"]["state"] == "OFFLINE"
    assert c["cameras"]["state"] == "NOT_CONFIGURED" and c["queue_analytics"]["state"] in ("NOT_CONFIGURED", "DEGRADED")
    assert h["overall"] != "READY" and h["fullyOperational"] is False
    assert {"inference_worker", "person_model"} <= set(h["notReadyRequired"])
    assert c["shelf_model"]["state"] == "NOT_CONFIGURED" and c["shelf_model"]["required"] is False and "validated shelf model" in c["shelf_model"]["detail"]


def test_empty_database_is_flagged_not_hidden(client):
    h, c = health(client)
    assert c["cameras"]["state"] == "NOT_CONFIGURED" and c["pwa_integration"]["state"] in ("DEGRADED", "NOT_CONFIGURED")


def test_llm_component_reflects_the_real_probe(tmp_path):
    from database.seed import seed_demo

    with FakeOpenRouter() as f:
        s = make_settings(tmp_path, openrouter_base_url=f.url, openrouter_api_key=API_KEY, copilot_model=f.model)
        seed_demo(s)
        with TestClient(create_app(s)) as c:
            _, comps = health(c)
            o = comps["llm"]
            assert o["state"] == "READY" and o["facts"]["supportsTools"] is True and o["facts"]["isCloudModel"] is True
    s2 = make_settings(tmp_path / "b", openrouter_base_url="http://127.0.0.1:9/api/v1", openrouter_api_key=API_KEY)
    seed_demo(s2)
    with TestClient(create_app(s2)) as c:
        _, comps = health(c)
        assert comps["llm"]["state"] == "OFFLINE" and "not reachable" in comps["llm"]["detail"]
