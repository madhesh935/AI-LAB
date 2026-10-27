"""Phase 2 unit tests: tracker isolation, source validation, queue, device choice, registry statuses."""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

from vision.device import select_device
from vision.engine import Frame, FrameQueue
from vision.registry import ModelEntry, ModelRegistry
from vision.source_validation import SourceError, redact, validate_source
from vision.tracker import CameraTracker

NOW = datetime.now(timezone.utc)


# ---------------------------------------------------------------- tracker
def _step(tracker: CameraTracker, x: float):
    return tracker.update(np.array([[x, 100, x + 50, 220]]), np.array([0.9]), np.array([0]), NOW)


def test_track_ids_are_per_camera_and_stable_while_moving():
    a = CameraTracker()
    ids_a = [_step(a, 100 + i * 3)[0].track_id for i in range(5)]
    b = CameraTracker()  # created AFTER a already issued ids: must not reset or share a's counter
    ids_b = [_step(b, 300 + i * 3)[0].track_id for i in range(5)]
    assert set(ids_a) == {1} and set(ids_b) == {1}
    assert _step(a, 118)[0].track_id == 1  # a unaffected by b
    assert _step(a, 118)[0].age_frames >= 6


def test_second_person_gets_a_new_id_and_reset_restarts_ids():
    t = CameraTracker()
    out = None
    for i in range(4):
        out = t.update(np.array([[100 + i, 100, 150 + i, 220], [400, 100, 450, 220]]), np.array([0.9, 0.8]), np.array([0, 0]), NOW)
    assert sorted(o.track_id for o in out) == [1, 2]
    t.reset()
    out = _step(t, 100)
    assert [o.track_id for o in out] == [1] and out[0].age_frames == 1


def test_tracker_expires_lost_tracks():
    t = CameraTracker(track_buffer=3)
    for i in range(3):
        _step(t, 100 + i)
    for _ in range(10):  # person disappears
        t.update(np.zeros((0, 4)), np.zeros(0), np.zeros(0), NOW)
    assert t._tracker.tracked_stracks == [] and t._tracker.lost_stracks == [] and t._seen == {}


# ---------------------------------------------------------------- sources
ROOTS = [Path(__file__).parent]


@pytest.mark.parametrize("stype,ref,code", [
    ("rtsp", "http://wrong", "INVALID_SOURCE"),
    ("rtsp", "rtsp://", "INVALID_SOURCE"),
    ("http", "ftp://x/y", "INVALID_SOURCE"),
    ("usb", "front-door", "INVALID_SOURCE"),
    ("file", "../../etc/passwd", "INVALID_SOURCE"),
    ("file", "does-not-exist.mp4", "SOURCE_NOT_FOUND"),
    ("unconfigured", None, "NOT_CONFIGURED"),
    ("bogus", "x", "INVALID_SOURCE"),
])
def test_invalid_sources_are_rejected_with_codes(stype, ref, code):
    with pytest.raises(SourceError) as exc:
        validate_source(stype, ref, ROOTS)
    assert exc.value.code == code


def test_valid_sources_pass_and_credentials_are_redacted():
    validate_source("rtsp", "rtsp://u:p@10.0.0.5:554/s1", ROOTS)
    validate_source("http", "http://cam.local/mjpg", ROOTS)
    validate_source("usb", "0", ROOTS)
    validate_source("file", "test_vision_unit.py", ROOTS)
    text = redact("failed rtsp://admin:SuperSecret@10.0.0.5/stream and http://a:b@h/x")
    assert "SuperSecret" not in text and "admin" not in text and "10.0.0.5" in text


# ---------------------------------------------------------------- queue
def _frame(i):
    return Frame(i, NOW, np.zeros((2, 2, 3), np.uint8))


def test_frame_queue_is_bounded_drops_oldest_and_counts():
    q = FrameQueue(maxsize=2)
    for i in range(1, 6):
        q.put(_frame(i))
    assert q.dropped == 3  # 1,2,3 overwritten
    assert q.pop_latest().frame_id == 5
    assert q.dropped == 4  # frame 4 was skipped in favour of the newest
    assert q.pop_latest() is None


# ---------------------------------------------------------------- device
def test_device_falls_back_to_cpu_when_cuda_unavailable(monkeypatch):
    import torch

    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    assert select_device("auto") == "cpu"
    assert select_device("cuda") == "cpu"  # explicit request still degrades safely
    assert select_device("cpu") == "cpu"


def test_device_prefers_cuda_when_available(monkeypatch):
    import torch

    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    assert select_device("auto") == "cuda:0"
    assert select_device("cpu") == "cpu"


# ---------------------------------------------------------------- registry statuses
def _entry(**kw):
    base = dict(id="m", name="M", version="1", task="person_detection", path="person/yolo11n.pt", runtime="ultralytics",
                input_size=640, labels=["person"], confidence_threshold=0.35, enabled=True)
    base.update(kw)
    return ModelEntry(**base)


def test_registry_reports_not_configured_disabled_missing_and_bad_checksum():
    seen = []
    reg = ModelRegistry([
        _entry(id="nc", path=None, runtime=None, enabled=True),
        _entry(id="off", enabled=False),
        _entry(id="missing", path="person/nope.pt"),
        _entry(id="badsum", sha256="0" * 64),
    ], "cpu", on_status=lambda e: seen.append((e.id, e.status)))
    reg.load_all()
    st = {e.id: e for e in reg.entries.values()}
    assert st["nc"].status == "NOT_CONFIGURED"
    assert st["off"].status == "DISABLED"
    assert st["missing"].status == "ERROR" and "not found" in st["missing"].last_error
    assert st["badsum"].status == "ERROR" and "checksum mismatch" in st["badsum"].last_error
    assert ("missing", "LOADING") in seen and ("missing", "ERROR") in seen
    assert reg.get_ready("person_detection") is None  # nothing READY -> no detections can ever be produced


def test_shipped_config_is_valid_and_pins_the_checkpoint():
    cfg = json.loads((Path(__file__).parent.parent / "ai_models" / "configs" / "models.json").read_text())
    person = next(m for m in cfg["models"] if m["id"] == "person-yolo11n")
    assert person["labels"] == ["person"] and len(person["sha256"]) == 64 and "AGPL" in person["license"]


def test_one_webcam_is_shared_by_several_camera_entries(monkeypatch):
    """A webcam can be opened once; every camera entry on the same device index must get frames from ONE reader, and the last release frees it."""
    import numpy as np

    import vision.sources as sources

    opened = []

    class FakeCap:
        def __init__(self, index, backend=None):
            self.index, self.n, self.released = index, 0, False
            opened.append(self)

        def isOpened(self):
            return True

        def read(self):
            import time

            time.sleep(0.01)
            self.n += 1
            return True, np.full((4, 4, 3), self.n % 255, dtype=np.uint8)

        def release(self):
            self.released = True

    monkeypatch.setattr(sources.cv2, "VideoCapture", FakeCap)
    a, b = sources.open_capture("usb", "0", []), sources.open_capture("usb", "0", [])
    assert len(opened) == 1 and a.isOpened() and b.isOpened()
    ok_a, fa = a.read()
    ok_b, fb = b.read()
    assert ok_a and ok_b and fa.shape == fb.shape == (4, 4, 3)
    a.release()
    assert not opened[0].released and b.read()[0], "one camera entry stopping must not stop the others"
    b.release()
    assert opened[0].released and not sources._USB, "the last release frees the physical webcam"


def test_tracker_keeps_a_person_through_weak_blurred_detections():
    """Detections are NOT pre-filtered at the display threshold: ByteTrack's second pass keeps an existing track on a weak (blurred) detection, while a weak detection alone never starts a track."""
    import numpy as np
    from datetime import datetime, timezone

    from vision.tracker import CameraTracker

    t = CameraTracker()
    now = datetime.now(timezone.utc)
    box = lambda x: np.array([[x, 100.0, x + 80.0, 300.0]], np.float32)  # noqa: E731
    first = None
    for i in range(4):  # a clearly visible person walking right
        out = t.update(box(100.0 + 8 * i), np.array([0.8]), np.array([0.0]), now)
        first = out[0].track_id
    out = t.update(box(140.0), np.array([0.2]), np.array([0.0]), now)  # suddenly blurred: confidence 0.2 (< display threshold 0.35)
    assert [o.track_id for o in out] == [first]
    fresh = CameraTracker().update(box(300.0), np.array([0.2]), np.array([0.0]), now)
    assert fresh == []
