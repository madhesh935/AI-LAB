"""Per-camera ByteTrack (Ultralytics implementation) with isolated, anonymous track IDs.

Ultralytics' STrack hands out IDs from a process-global counter and BYTETracker.__init__ resets
it, so two trackers in one worker would clobber each other. Each CameraTracker therefore uses its
own STrack subclass with its own counter. Track IDs are camera-local integers: they are not
comparable across cameras and carry no identity (no re-identification, no face data).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from types import SimpleNamespace
from typing import Dict, List

import numpy as np
from ultralytics.trackers.byte_tracker import BYTETracker, STrack


class _Detections:
    """Results-like object that BYTETracker consumes (conf/xywh/cls + boolean indexing)."""

    def __init__(self, xywh: np.ndarray, conf: np.ndarray, cls: np.ndarray):
        self.xywh, self.conf, self.cls = xywh, conf, cls

    def __len__(self) -> int:
        return len(self.conf)

    def __getitem__(self, idx) -> "_Detections":
        return _Detections(self.xywh[idx], self.conf[idx], self.cls[idx])


@dataclass
class TrackOut:
    track_id: int
    x1: float
    y1: float
    x2: float
    y2: float
    confidence: float
    first_seen: datetime
    last_seen: datetime
    age_frames: int


def _make_track_class() -> type:
    """A fresh STrack subclass whose ID counter is private to one tracker."""

    class CameraSTrack(STrack):
        _local_count = 0

        def next_id(self) -> int:  # instance override of the global staticmethod
            cls = type(self)
            cls._local_count += 1
            return cls._local_count

    return CameraSTrack


class CameraTracker:
    def __init__(
        self,
        track_high_thresh: float = 0.25,  # ByteTrack's own defaults (0.25 / 0.1 / 0.25). A person who fills the frame or is backlit scores only ~0.25-0.3 on a COCO-trained model
        track_low_thresh: float = 0.1,    # (measured: 0.26 on a close-up silhouette that 0.35/0.4 never tracked), so stricter values made such people invisible
        new_track_thresh: float = 0.20,   # lowered from 0.25: catches motion-blurred detections one frame sooner, reducing "ghost new track" on resume
        track_buffer: int = 15,           # reduced from 30: at 5-15 FPS inference, 15 frames = 1-3 seconds. Prevents ghost tracks while still bridging momentary occlusion
        match_thresh: float = 0.65,       # reduced from 0.8: fast-moving people displace significantly between frames; strict 0.8 IoU fails to re-associate them
    ):
        self._args = SimpleNamespace(
            track_high_thresh=track_high_thresh,
            track_low_thresh=track_low_thresh,
            new_track_thresh=new_track_thresh,
            track_buffer=track_buffer,
            match_thresh=match_thresh,
            fuse_score=True,
        )
        self._tracker = self._build()
        self._seen: Dict[int, tuple[datetime, int]] = {}

    def _build(self) -> BYTETracker:
        tracker = BYTETracker(self._args)
        tracker.track_class = _make_track_class()
        return tracker

    def reset(self) -> None:
        """Drop all tracks and restart IDs (called when a source reconnects or restarts)."""
        self._tracker = self._build()
        self._seen.clear()

    def update(self, xyxy: np.ndarray, conf: np.ndarray, cls: np.ndarray, at: datetime) -> List[TrackOut]:
        """Advance the tracker one inference step. `xyxy` is in source-pixel coordinates."""
        xyxy = np.asarray(xyxy, dtype=np.float32).reshape(-1, 4)
        w = xyxy[:, 2] - xyxy[:, 0]
        h = xyxy[:, 3] - xyxy[:, 1]
        xywh = np.stack([xyxy[:, 0] + w / 2, xyxy[:, 1] + h / 2, w, h], axis=1) if len(xyxy) else np.zeros((0, 4), np.float32)
        out = self._tracker.update(_Detections(xywh, np.asarray(conf, np.float32), np.asarray(cls, np.float32)))

        tracks: List[TrackOut] = []
        live_ids = set()
        for row in out:
            x1, y1, x2, y2, tid, score = row[:6]
            tid = int(tid)
            live_ids.add(tid)
            first, count = self._seen.get(tid, (at, 0))
            self._seen[tid] = (first, count + 1)
            tracks.append(TrackOut(tid, float(x1), float(y1), float(x2), float(y2), float(score), first, at, count + 1))

        # forget IDs ByteTrack has dropped so the map stays bounded
        alive = {t.track_id for t in self._tracker.tracked_stracks} | {t.track_id for t in self._tracker.lost_stracks}
        for tid in [k for k in self._seen if k not in alive and k not in live_ids]:
            del self._seen[tid]
        return tracks
