"""Pydantic contracts for detection metadata and worker status (shared by worker and API)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import Field

from schemas.common import ApiModel

CameraState = Literal["live", "connecting", "reconnecting", "offline", "error"]
VisionEventType = Literal[
    "camera.connected", "camera.disconnected", "camera.frame", "person.detected", "model.ready", "model.error",
    # Phase 3 analytics (raw worker events; the central event engine turns them into domain events)
    "footfall.crossing", "zone.visit", "zone.occupancy", "zone.transition", "heatmap.flush",
    "queue.updated", "queue.service", "shelf.observation",
]


class NormBox(ApiModel):
    """Top-left origin, all values in [0, 1] relative to the SOURCE frame size."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(ge=0, le=1)
    h: float = Field(ge=0, le=1)


class PixelBox(ApiModel):
    x1: float
    y1: float
    x2: float
    y2: float


class TrackedPerson(ApiModel):
    """One anonymous, camera-local track. IDs are NOT comparable across cameras and carry no identity."""

    object_class: Literal["person"] = "person"
    track_id: int = Field(ge=1)
    confidence: float = Field(ge=0, le=1)
    bbox: NormBox
    bbox_px: PixelBox
    first_seen: datetime
    last_seen: datetime
    age_frames: int = Field(ge=1)


class DetectionFrame(ApiModel):
    event_id: str
    frame_id: int = Field(ge=0)
    camera_id: str
    store_id: str
    source_timestamp: datetime
    model_id: str
    model_version: str
    frame_width: int = Field(gt=0)
    frame_height: int = Field(gt=0)
    detections: List[TrackedPerson]
    people_count: int = Field(ge=0)
    inference_ms: float = Field(ge=0)
    mode: Literal["real"] = "real"  # fabricated detections are never produced
    is_demo_footage: bool = False


class VisionEvent(ApiModel):
    event_id: str
    seq: int
    type: VisionEventType
    store_id: str
    camera_id: Optional[str] = None
    timestamp: datetime
    payload: Dict[str, Any] = {}


class VisionEventBatch(ApiModel):
    worker_id: str
    events: List[VisionEvent] = Field(max_length=500)


class CameraRuntime(ApiModel):
    camera_id: str
    camera_code: str
    store_id: str
    state: CameraState
    source_type: str
    is_demo: bool
    error_code: Optional[str] = None
    message: Optional[str] = None
    frame_width: Optional[int] = None
    frame_height: Optional[int] = None
    input_fps: Optional[float] = None
    inference_fps: Optional[float] = None
    inference_ms: Optional[float] = None
    dropped_frames: int = 0
    reconnects: int = 0
    last_frame_at: Optional[datetime] = None
    last_inference_at: Optional[datetime] = None
    people_count: Optional[int] = None
    viewers: int = 0
    analytics: Optional[Dict[str, Any]] = None  # Phase 3: zone/line/queue/shelf configuration summary + counters


class ModelStatusOut(ApiModel):
    id: str
    name: str
    version: str
    task: str
    runtime: Optional[str] = None
    path: Optional[str] = None
    input_size: Optional[int] = None
    labels: List[str] = []
    confidence_threshold: Optional[float] = None
    device: Optional[str] = None
    enabled: bool
    status: Literal["NOT_CONFIGURED", "LOADING", "READY", "ERROR", "DISABLED"]
    license: Optional[str] = None
    sha256: Optional[str] = None
    loaded_at: Optional[datetime] = None
    load_ms: Optional[float] = None
    last_error: Optional[str] = None


class ResourceSample(ApiModel):
    process_cpu_percent: Optional[float] = None
    process_rss_mb: Optional[float] = None
    system_cpu_percent: Optional[float] = None
    gpu_name: Optional[str] = None
    gpu_util_percent: Optional[float] = None
    gpu_mem_used_mb: Optional[float] = None
    gpu_mem_total_mb: Optional[float] = None


class WorkerStatus(ApiModel):
    worker_id: str
    pid: int
    started_at: datetime
    device: str
    hardware: Dict[str, Any]
    models: List[ModelStatusOut]
    cameras: List[CameraRuntime]
    resources: ResourceSample
    api_events_sent: int = 0
    api_events_dropped: int = 0
