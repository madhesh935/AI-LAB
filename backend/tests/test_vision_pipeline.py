"""Phase 2 pipeline tests: REAL model + REAL video through capture -> inference -> tracking -> persistence.

Uses data/samples/people-detection.mp4 (Intel sample footage, CC BY 4.0). Nothing here is mocked
except the outbox (it records events instead of POSTing them). The checkpoint is loaded once.
"""

from __future__ import annotations

import shutil
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from core.config import BACKEND_DIR
from database import manage
from database.connection import Database
from database.models import Camera, CameraStatus, CameraStatusEvent, InferenceEvent, ModelRegistry as ModelRow, Store
from tests.conftest import make_settings
from vision.device import select_device
from vision.engine import VisionEngine
from vision.persistence import WorkerStore
from vision.registry import ModelRegistry
from vision.server import create_worker_app

SAMPLE = BACKEND_DIR / "data" / "samples" / "people-detection.mp4"
pytestmark = pytest.mark.skipif(not SAMPLE.is_file(), reason="sample video missing (see backend/data/samples/README.md)")


class RecordingOutbox:
    sent = dropped = 0

    def __init__(self):
        self.events = []
        self.timed = []  # the same events with their source timestamps
        self.lock = threading.Lock()

    def emit(self, type_, store_id, camera_id, payload, at=None):
        with self.lock:
            self.events.append((type_, store_id, camera_id, payload))
            self.timed.append((type_, store_id, camera_id, payload, at))

    def of(self, type_):
        with self.lock:
            return [e for e in self.events if e[0] == type_]

    def stop(self):
        pass


def wait_for(cond, timeout=60.0, step=0.1, msg="condition"):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        v = cond()
        if v:
            return v
        time.sleep(step)
    raise AssertionError(f"timed out waiting for {msg}")


@pytest.fixture(scope="module")
def loaded_registry():
    reg = ModelRegistry.from_file(select_device("auto"))
    reg.load_all()
    assert reg.entries["person-yolo11n"].status == "READY", reg.entries["person-yolo11n"].last_error
    return reg


class Rig:
    def __init__(self, tmp_path, registry):
        self.settings = make_settings(tmp_path, vision_stats_persist_seconds=1.0, media_dir=tmp_path / "media")
        self.settings.media_dir.mkdir(parents=True, exist_ok=True)
        manage.upgrade(self.settings)
        self.db = Database(self.settings.database_url)
        with self.db.transaction() as s:
            s.add(Store(id="s1", code="S1", name="S1", max_capacity=10, edge_server_status="disconnected"))
            s.flush()
        self.outbox = RecordingOutbox()
        self.store = WorkerStore(self.db, {"inference_fps": 25.0, "stream_fps": 15.0, "stream_width": 640})
        self.engine = VisionEngine(self.settings, registry, self.store, self.outbox, "test-worker", registry.device)
        self.engine.media_roots = [self.settings.media_dir]
        self.engine.start()

    def add_camera(self, code, source_type, ref, *, enabled=True, demo=False, config=None):
        with self.db.transaction() as s:
            s.add(Camera(id=f"cam-{code}", store_id="s1", camera_code=code, name=code, camera_type="aisle",
                         source_type=source_type, source_ref=ref, enabled=enabled, is_demo=demo, config=config or {}))
        self.engine.reload()
        return self.engine.get(f"cam-{code}")

    def close(self):
        self.engine.stop()
        self.db.dispose()


@pytest.fixture()
def rig(tmp_path, loaded_registry):
    r = Rig(tmp_path, loaded_registry)
    shutil.copy(SAMPLE, r.settings.media_dir / "clip.mp4")
    yield r
    r.close()


FAST = {"playbackSpeed": 3.0, "inferenceFps": 30}


def test_cuda_graph_detector_matches_eager_across_interleaved_shapes(loaded_registry):
    """Regression: graphs captured for several shapes once shared anchor tensors and returned zero boxes."""
    import cv2
    import numpy as np

    from vision.detector import PersonDetector

    graph_det = loaded_registry.get_ready("person_detection").instance
    if graph_det.mode != "cuda-graph":
        pytest.skip("CUDA graphs not in use on this machine")
    eager = PersonDetector(graph_det.weights, graph_det.device, use_cuda_graph=False)
    cap = cv2.VideoCapture(str(SAMPLE))
    frames = []
    for i in range(260):
        ok, f = cap.read()
        frames.append(f if ok and i in (40, 120, 200, 240, 250) else None)
    for f in [f for f in frames if f is not None]:
        graph_det.detect(np.zeros((480, 640, 3), np.uint8))  # a different shape in between
        a, b = graph_det.detect(f), eager.detect(f)
        assert len(a.xyxy) == len(b.xyxy)
        if len(a.xyxy):
            assert np.abs(np.sort(a.xyxy, axis=0) - np.sort(b.xyxy, axis=0)).max() < 2.0  # pixels, FP16 vs eager FP16


def test_real_video_yields_real_tracked_detections(rig):
    w = rig.add_camera("c1", "file", "clip.mp4", demo=True, config=FAST)
    wait_for(lambda: w.state == "live", msg="camera live")
    results = []
    last = [None]

    def collect():
        r = w.last_result
        if r is not None and r is not last[0]:
            last[0] = r
            results.append(r)
        return len(results) >= 40 and any(x.people_count > 0 for x in results)

    wait_for(collect, timeout=60, step=0.02, msg="detections with people")
    people = [x for x in results if x.people_count]
    d = people[0]
    assert d.mode == "real" and d.is_demo_footage is True and d.model_id == "person-yolo11n"
    assert d.frame_width == 768 and d.frame_height == 432 and d.inference_ms > 0
    for det in d.detections:
        assert det.object_class == "person" and 0.35 <= det.confidence <= 1
        assert 0 <= det.bbox.x <= 1 and 0 <= det.bbox.y <= 1 and det.bbox.x + det.bbox.w <= 1.001 and det.bbox.y + det.bbox.h <= 1.001
        assert det.bbox_px.x2 > det.bbox_px.x1 and det.bbox_px.y2 > det.bbox_px.y1
    # tracking: some anonymous id is seen in several consecutive inferences
    seen = {}
    for x in results:
        for t in x.detections:
            seen[t.track_id] = seen.get(t.track_id, 0) + 1
    assert max(seen.values()) >= 5, f"no stable track found: {seen}"
    assert any(t.age_frames >= 5 for x in people for t in x.detections)
    # metadata events: frame events carry detections but NEVER pixels
    frames = rig.outbox.of("camera.frame")
    assert frames and "image" not in str(frames[0][3]).lower() and "jpeg" not in str(frames[0][3]).lower()
    assert rig.outbox.of("person.detected") and rig.outbox.of("camera.connected")
    pd = rig.outbox.of("person.detected")[0][3]
    assert "faceId" not in str(pd) and "identity" not in str(pd).lower()


def test_without_a_ready_model_the_camera_streams_but_never_invents_detections(tmp_path):
    reg = ModelRegistry.from_file(select_device("cpu"))
    for e in reg.entries.values():
        e.enabled = False  # nothing loadable
    reg.load_all()
    rig = Rig(tmp_path, reg)
    try:
        shutil.copy(SAMPLE, rig.settings.media_dir / "clip.mp4")
        w = rig.add_camera("c1", "file", "clip.mp4", config=FAST)
        wait_for(lambda: w.state == "live", msg="live")
        time.sleep(2.0)
        assert w.last_result is None and w.people_count is None and w.inference_ms is None
        assert rig.outbox.of("camera.frame") == [] and rig.outbox.of("person.detected") == []
        assert w.in_rate.value() is not None  # video itself is flowing
    finally:
        rig.close()


def test_end_of_file_is_reported_and_releases_the_file(rig):
    w = rig.add_camera("c1", "file", "clip.mp4", config={"playbackSpeed": 0, "loop": False})
    wait_for(lambda: w.state == "offline" and w.error_code == "END_OF_FILE", timeout=60, msg="EOF")
    wait_for(lambda: not w._thread.is_alive(), timeout=10, msg="capture thread finished")  # state flips just before the thread releases the file and exits
    ev = [e for e in rig.outbox.of("camera.disconnected") if e[3]["errorCode"] == "END_OF_FILE"]
    assert ev and ev[0][3]["previousState"] == "live"
    rig.engine.stop()
    (rig.settings.media_dir / "clip.mp4").unlink()  # fails on Windows if a handle leaked


def test_unreachable_rtsp_reconnects_with_backoff_and_never_leaks_credentials(rig):
    w = rig.add_camera("c1", "rtsp", "rtsp://admin:SuperSecret123@127.0.0.1:1/stream")
    wait_for(lambda: w.state in ("reconnecting", "offline") and w.error_code == "CONNECT_FAILED", timeout=20, msg="connect failure")
    wait_for(lambda: w._thread.is_alive() and w.state == "offline", timeout=30, msg="offline after repeated failures")
    assert "SuperSecret123" not in (w.message or "") and "admin" not in (w.message or "")
    time.sleep(1.5)  # let housekeeping persist
    with rig.db.session() as s:
        rows = [r.message or "" for r in s.scalars(select(CameraStatusEvent))] + [r.message or "" for r in s.scalars(select(CameraStatus))]
    assert rows and all("SuperSecret123" not in m for m in rows)
    assert all("SuperSecret123" not in str(e) for e in rig.outbox.events)


def test_missing_usb_device_is_reported_with_a_code(rig):
    w = rig.add_camera("c1", "usb", "97")
    wait_for(lambda: w.error_code == "DEVICE_NOT_FOUND", timeout=30, msg="DEVICE_NOT_FOUND")
    assert w.state in ("reconnecting", "offline")


def test_invalid_source_is_a_fatal_configuration_error_without_retry_loops(rig):
    w = rig.add_camera("c1", "http", "ftp://nope/x")
    wait_for(lambda: w.state == "error", timeout=10, msg="error state")
    assert w.error_code == "INVALID_SOURCE"
    wait_for(lambda: not w._thread.is_alive(), timeout=5, msg="thread ended")  # no retry loop for a config error


def test_disabled_and_unconfigured_cameras_do_not_start_threads(rig):
    a = rig.add_camera("off", "file", "clip.mp4", enabled=False)
    b = rig.add_camera("none", "unconfigured", None)
    assert a._thread is None and a.error_code == "DISABLED" and a.state == "offline"
    assert b._thread is None and b.error_code == "NOT_CONFIGURED"


def test_reconnect_resets_the_tracker_and_counts_reconnects(rig):
    w = rig.add_camera("c1", "file", "clip.mp4", config=FAST)
    wait_for(lambda: len(rig.outbox.of("person.detected")) >= 1, timeout=60, msg="first person")
    before = len(rig.outbox.of("person.detected"))
    w.request_reconnect()
    wait_for(lambda: w.reconnects >= 1 and w.state == "live", timeout=30, msg="reconnected")
    wait_for(lambda: len(rig.outbox.of("person.detected")) > before, timeout=60, msg="person after reconnect")
    first_after = rig.outbox.of("person.detected")[before][3]["track"]["trackId"]
    assert first_after == 1, "track ids must restart after a reconnect"


def test_persistence_is_throttled_and_never_stores_boxes(rig, loaded_registry):
    rig.store.sync_model(loaded_registry.entries["person-yolo11n"])
    w = rig.add_camera("c1", "file", "clip.mp4", config=FAST)
    wait_for(lambda: w.state == "live" and w.last_result is not None, timeout=60, msg="inference running")
    time.sleep(4.5)
    infer_count = len(rig.outbox.of("camera.frame"))
    with rig.db.session() as s:
        transitions = s.scalar(select(func.count()).select_from(CameraStatusEvent))
        status = s.get(CameraStatus, "cam-c1")
        inference_rows = s.scalar(select(func.count()).select_from(InferenceEvent))
        model = s.get(ModelRow, "person-yolo11n")
    assert transitions <= 3 and infer_count > 10  # a few state rows vs. many processed frames
    assert inference_rows == 0  # individual detections are not persisted
    assert status.state == "live" and status.input_fps and status.inference_fps and status.inference_ms
    assert status.frame_width == 768 and status.last_inference_at is not None
    assert model.status == "READY" and len(model.sha256) == 64 and model.license.startswith("AGPL")
    assert w.queue.dropped >= 0 and w.queue._dq.maxlen == 2  # bounded queue


def test_mjpeg_gateway_serves_frame_synced_metadata(rig):
    w = rig.add_camera("c1", "file", "clip.mp4", demo=True, config=FAST)
    wait_for(lambda: w.state == "live", msg="live")
    client = TestClient(create_worker_app(rig.engine, rig.settings))
    assert client.get("/stream/nope.mjpg").status_code == 404
    assert client.get("/health").json()["modelsReady"] == 1
    got = []
    with client.stream("GET", "/stream/cam-c1.mjpg") as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("multipart/x-mixed-replace")
        assert w.viewers == 1
        buf = b""
        for chunk in r.iter_bytes():
            buf += chunk
            while b"\r\n\r\n" in buf:
                head, _, rest = buf.partition(b"\r\n\r\n")
                n = int([ln for ln in head.decode().split("\r\n") if ln.lower().startswith("content-length")][0].split(":")[1])
                if len(rest) < n + 2:
                    break
                import json

                meta = json.loads([ln for ln in head.decode().split("\r\n") if ln.startswith("X-Frame-Meta")][0].split(": ", 1)[1])
                assert rest[:2] == b"\xff\xd8"
                got.append(meta)
                buf = rest[n + 2:]
            if len(got) >= 25:
                break
    wait_for(lambda: w.viewers == 0, timeout=10, msg="viewer released")
    assert [m["frameId"] for m in got] == sorted(m["frameId"] for m in got)
    assert all(m["isDemo"] is True and m["cameraId"] == "cam-c1" and m["w"] == 768 for m in got)
    with_overlay = [m for m in got if m["overlay"]]
    assert with_overlay and all(m["overlay"]["frameId"] <= m["frameId"] for m in with_overlay)
    assert all(m["overlay"]["lagFrames"] == m["frameId"] - m["overlay"]["frameId"] for m in with_overlay)
    snap = client.get("/snapshot/cam-c1.jpg")
    assert snap.status_code == 200 and snap.content[:2] == b"\xff\xd8"
    # control endpoints are loopback-only (TestClient host is whitelisted); gateway never exposes the source
    status_text = client.get("/status").text
    assert "clip.mp4" not in status_text
