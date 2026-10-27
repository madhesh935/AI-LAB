"""Phase 2 API tests (worker NOT running): validation, secrecy, honest offline status, event relay."""

from __future__ import annotations

from tests.conftest import open_events

import uuid
from datetime import datetime, timezone

from database.connection import Database
from database.models import Camera

SECRET = "SuperSecret-p4ss"
RTSP = f"rtsp://admin:{SECRET}@10.20.30.40:554/Streaming/1"


def make_camera(client, code="CAM-01", store="store-a"):
    r = client.post(f"/api/stores/{store}/cameras", json={"name": f"{code} test", "cameraCode": code, "type": "entrance"})
    assert r.status_code == 201
    return r.json()["id"]


def put_source(client, cid, **body):
    return client.put(f"/api/cameras/{cid}/source", json=body)


def test_source_validation_rejects_bad_input_with_codes(client):
    cid = make_camera(client)
    r = put_source(client, cid, sourceType="rtsp", sourceRef="http://not-rtsp")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_source"
    assert put_source(client, cid, sourceType="usb", sourceRef="front").status_code == 422
    assert put_source(client, cid, sourceType="file", sourceRef="../../secrets.txt").status_code == 422
    r = put_source(client, cid, sourceType="file", sourceRef="missing.mp4")
    assert r.status_code == 422 and r.json()["error"]["details"]["code"] == "SOURCE_NOT_FOUND"
    assert put_source(client, "nope", sourceType="usb", sourceRef="0").status_code == 404
    assert put_source(client, cid, sourceType="usb", sourceRef="0", inferenceFps=500).status_code == 422


def test_source_reference_and_credentials_never_leave_the_server(client):
    cid = make_camera(client)
    r = put_source(client, cid, sourceType="rtsp", sourceRef=RTSP, enabled=True)
    assert r.status_code == 200
    surfaces = [
        r.text,
        client.get("/api/cameras").text,
        client.get(f"/api/cameras/{cid}").text,
        client.get(f"/api/cameras/{cid}/status").text,
        client.get(f"/api/cameras/{cid}/stream").text,
        client.get(f"/api/cameras/{cid}/detections").text,
        client.get("/api/stores/store-a/cameras").text,
        client.get("/api/stores/store-a/cameras/monitoring").text,
        client.get("/api/models/status").text,
        client.get("/api/vision/status").text,
        client.get("/openapi.json").text,
    ]
    for body in surfaces:
        assert SECRET not in body and "10.20.30.40" not in body and "admin:" not in body
    assert "sourceRef" not in client.get(f"/api/cameras/{cid}").text
    # it IS stored server-side for the worker
    db = Database(client.settings.database_url)
    with db.session() as s:
        assert s.get(Camera, cid).source_ref == RTSP
    db.dispose()


def test_configured_cameras_are_offline_when_the_worker_is_not_running(client):
    cid = make_camera(client)
    cam = client.get(f"/api/cameras/{cid}").json()
    assert cam["status"] == "offline" and cam["errorCode"] == "NOT_CONFIGURED" and cam["sourceConfigured"] is False
    assert cam["stream"]["available"] is False and cam["stream"]["url"] is None

    cam = put_source(client, cid, sourceType="rtsp", sourceRef=RTSP, enabled=True).json()
    assert cam["status"] == "offline" and cam["errorCode"] == "WORKER_OFFLINE" and cam["workerOnline"] is False
    assert cam["stream"]["kind"] == "none" and "not running" in cam["stream"]["reason"]
    assert cam["peopleCount"] is None and cam["inferenceFps"] is None and cam["inputFps"] is None

    # legacy per-store endpoint tells the same truth (a persisted 'live' must not survive a dead worker)
    feed = client.get("/api/stores/store-a/cameras").json()["cameras"][0]
    assert feed["status"] == "offline" and feed["errorCode"] == "WORKER_OFFLINE" and feed["sourceType"] == "rtsp"

    off = put_source(client, cid, sourceType="rtsp", sourceRef=RTSP, enabled=False).json()
    assert off["errorCode"] == "DISABLED" and off["enabled"] is False


def test_stale_live_status_is_not_trusted_without_a_worker(client):
    from database.models import CameraStatus

    cid = make_camera(client)
    put_source(client, cid, sourceType="rtsp", sourceRef=RTSP, enabled=True)
    db = Database(client.settings.database_url)
    with db.transaction() as s:
        st = s.get(CameraStatus, cid)
        st.state, st.input_fps, st.inference_fps = "live", 25.0, 20.0
    db.dispose()
    cam = client.get(f"/api/cameras/{cid}").json()
    assert cam["status"] == "offline" and cam["inputFps"] is None and cam["inferenceFps"] is None


def test_models_status_without_worker_never_claims_ready(client):
    from database.models import ModelRegistry

    db = Database(client.settings.database_url)
    with db.transaction() as s:
        s.add(ModelRegistry(id="person-yolo11n", name="YOLO11n", version="11.0", task="person_detection", status="READY"))
    db.dispose()
    body = client.get("/api/models/status").json()
    assert body["workerOnline"] is False and body["models"][0]["status"] == "NOT_CONFIGURED"
    assert "not running" in body["note"]
    vs = client.get("/api/vision/status").json()
    assert vs["workerOnline"] is False and vs["worker"] is None
    reload_ = client.post("/api/vision/reload").json()
    assert reload_["requested"] is False and "python -m vision" in reload_["note"]


def test_detections_endpoint_is_unavailable_not_empty_without_inference(client):
    cid = make_camera(client)
    d = client.get(f"/api/cameras/{cid}/detections").json()
    assert d["available"] is False and d["latest"] is None and d["history"] == [] and d["reason"]
    assert client.get("/api/cameras/unknown/detections").status_code == 404


# --------------------------------------------------------------- worker -> API relay
def frame_event(cid, frame_id=1, people=1):
    now = datetime.now(timezone.utc).isoformat()
    eid = uuid.uuid4().hex
    det = {"objectClass": "person", "trackId": 1, "confidence": 0.9, "bbox": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.5},
           "bboxPx": {"x1": 1, "y1": 1, "x2": 2, "y2": 2}, "firstSeen": now, "lastSeen": now, "ageFrames": 3}
    payload = {
        "eventId": eid, "frameId": frame_id, "cameraId": cid, "storeId": "store-a", "sourceTimestamp": now,
        "modelId": "person-yolo11n", "modelVersion": "11.0", "frameWidth": 768, "frameHeight": 432, "peopleCount": people,
        "inferenceMs": 8.1, "mode": "real", "isDemoFootage": False, "detections": [det][:people],
    }
    return {"eventId": eid, "seq": frame_id, "type": "camera.frame", "storeId": "store-a", "cameraId": cid, "timestamp": now, "payload": payload}


def test_internal_events_are_relayed_to_websocket_and_deduplicated(client):
    cid = make_camera(client)
    ev = frame_event(cid)
    other = {"eventId": uuid.uuid4().hex, "seq": 2, "type": "camera.connected", "storeId": "store-a", "cameraId": cid,
             "timestamp": ev["timestamp"], "payload": {"cameraId": cid, "state": "live"}}
    with open_events(client, "store-a") as ws:
        r = client.post("/api/internal/vision/events", json={"workerId": "w", "events": [ev, other]})
        assert r.json()["accepted"] == 2 and r.json()["rejected"] == {}
        got = [ws.receive_json(), ws.receive_json()]
        assert {g["type"] for g in got} == {"camera.frame", "camera.connected"}
        frame = next(g for g in got if g["type"] == "camera.frame")
        assert frame["payload"]["peopleCount"] == 1 and frame["payload"]["eventId"] == ev["eventId"]
        assert "T" in frame["timestamp"]
        # a replayed batch is ignored
        dup = client.post("/api/internal/vision/events", json={"workerId": "w", "events": [ev]}).json()
        assert dup["accepted"] == 0 and dup["duplicates"] == 1


def test_relayed_frames_feed_the_detections_endpoint_only_while_live(client, monkeypatch):
    from services import vision as svc

    cid = make_camera(client)
    put_source(client, cid, sourceType="rtsp", sourceRef=RTSP, enabled=True)
    client.post("/api/internal/vision/events", json={"workerId": "w", "events": [frame_event(cid, 7, people=1)]})
    # Worker still offline -> the cached frame must not be presented as current.
    assert client.get(f"/api/cameras/{cid}/detections").json()["available"] is False

    # Pretend the worker is online and reports the camera live (the real path is covered in the pipeline tests).
    monkeypatch.setattr(svc.WorkerClient, "online", lambda self: True)
    monkeypatch.setattr(svc.WorkerClient, "runtimes", lambda self: {cid: {
        "state": "live", "peopleCount": 1, "inputFps": 12.0, "inferenceFps": 11.5, "inferenceMs": 8.0,
        "frameWidth": 768, "frameHeight": 432}})
    d = client.get(f"/api/cameras/{cid}/detections").json()
    assert d["available"] is True and d["latest"]["frameId"] == 7 and d["history"][0]["peopleCount"] == 1
    cam = client.get(f"/api/cameras/{cid}").json()
    assert cam["status"] == "live" and cam["inferenceFps"] == 11.5 and cam["peopleCount"] == 1 and cam["stream"]["available"] is True
    assert cam["stream"]["url"].endswith(f"/stream/{cid}.mjpg") and "rtsp" not in cam["stream"]["url"]


def test_event_ingest_rejects_malformed_batches(client):
    bad = {"workerId": "w", "events": [{"type": "camera.explode"}]}
    assert client.post("/api/internal/vision/events", json=bad).status_code == 422
    assert client.post("/api/internal/vision/events", json={"nope": 1}).status_code == 422


def test_legacy_reconnect_is_honest_without_a_worker(client):
    cid = make_camera(client)
    put_source(client, cid, sourceType="rtsp", sourceRef=RTSP, enabled=True)
    r = client.post(f"/api/stores/store-a/cameras/{cid}/reconnect").json()
    assert r["requested"] is False and r["state"] == "offline" and "vision worker is not running" in r["note"].lower()
