"""Camera / vision API contracts (Phase 2). Source references and credentials are write-only."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import Field

from schemas.common import ApiModel

SourceType = Literal["unconfigured", "usb", "rtsp", "http", "file"]


class CameraSourceUpdate(ApiModel):
    """Write-only: `source_ref` is stored server-side and is never returned by any endpoint."""

    source_type: SourceType
    source_ref: Optional[str] = Field(default=None, max_length=500)
    enabled: bool = True
    is_demo: bool = False
    inference_fps: Optional[float] = Field(default=None, ge=0.5, le=30)
    stream_fps: Optional[float] = Field(default=None, ge=1, le=30)
    stream_width: Optional[int] = Field(default=None, ge=160, le=1920)
    loop: Optional[bool] = None


class StreamDescriptor(ApiModel):
    """How a browser can watch this camera. Contains no credentials and never a raw RTSP URL."""

    kind: Literal["mjpeg", "none"]
    available: bool
    url: Optional[str] = None
    snapshot_url: Optional[str] = None
    content_type: Optional[str] = None
    overlay: Literal["per-frame-header", "none"] = "none"
    is_demo: bool = False
    reason: Optional[str] = None
    alternatives: List[str] = []


class CameraLiveOut(ApiModel):
    id: str
    store_id: str
    camera_code: str
    name: str
    type: str
    zone: Optional[str] = None
    source_type: SourceType
    source_configured: bool
    enabled: bool
    is_demo: bool
    status: str
    error_code: Optional[str] = None
    message: Optional[str] = None
    resolution: Optional[str] = None
    frame_width: Optional[int] = None
    frame_height: Optional[int] = None
    input_fps: Optional[float] = None
    inference_fps: Optional[float] = None
    inference_ms: Optional[float] = None
    last_frame_at: Optional[datetime] = None
    last_inference_at: Optional[datetime] = None
    people_count: Optional[int] = None
    worker_online: bool
    stream: StreamDescriptor


class CameraStatusOut(ApiModel):
    camera_id: str
    status: str
    error_code: Optional[str] = None
    message: Optional[str] = None
    worker_online: bool
    input_fps: Optional[float] = None
    inference_fps: Optional[float] = None
    inference_ms: Optional[float] = None
    dropped_frames: Optional[int] = None
    reconnects: Optional[int] = None
    last_frame_at: Optional[datetime] = None
    last_inference_at: Optional[datetime] = None
    last_transitions: List[Dict[str, Any]] = []


class DetectionHistoryPoint(ApiModel):
    frame_id: int
    source_timestamp: datetime
    people_count: int
    inference_ms: float


class DetectionsOut(ApiModel):
    camera_id: str
    available: bool
    reason: Optional[str] = None
    latest: Optional[Dict[str, Any]] = None  # one DetectionFrame
    history: List[DetectionHistoryPoint] = []


class ModelsStatusOut(ApiModel):
    worker_online: bool
    device: Optional[str] = None
    models: List[Dict[str, Any]]
    note: Optional[str] = None


class VisionStatusOut(ApiModel):
    worker_online: bool
    worker: Optional[Dict[str, Any]] = None
    note: Optional[str] = None


class ReloadOut(ApiModel):
    requested: bool
    worker_online: bool
    result: Optional[Dict[str, Any]] = None
    note: Optional[str] = None
