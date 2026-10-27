"""Validated payloads for the analytics events the vision worker sends to the central event engine."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import Field

from schemas.common import ApiModel


class CrossingPayload(ApiModel):
    line_id: str
    direction: Literal["in", "out"]
    track_ref: int = Field(ge=0)
    occurred_at: datetime


class ZoneVisitPayload(ApiModel):
    camera_zone_id: str
    track_ref: int = Field(ge=0)
    entered_at: datetime
    exited_at: datetime
    dwell_seconds: float = Field(ge=0)


class ZoneOccupancyPayload(ApiModel):
    counts: Dict[str, int]


class TransitionPayload(ApiModel):
    from_zone_id: str
    to_zone_id: str
    track_ref: int = Field(ge=0)
    occurred_at: datetime


class HeatmapPayload(ApiModel):
    bucket_start: datetime
    grid_w: int = Field(ge=1, le=256)
    grid_h: int = Field(ge=1, le=256)
    cells: List[List[int]]  # [gx, gy, count]


class QueueUpdatePayload(ApiModel):
    counter_id: str
    length: int = Field(ge=0)
    raw_length: int = Field(ge=0)
    in_service: int = Field(ge=0, default=0)
    arrival_rate_per_min: Optional[float] = None
    service_rate_per_min: Optional[float] = None
    congestion: Literal["optimal", "moderate", "high", "critical"] = "optimal"
    reliable: bool = True


class QueueServicePayload(ApiModel):
    counter_id: str
    service_seconds: float = Field(gt=0)
    wait_seconds: Optional[float] = None
    completed_at: datetime


class ShelfObservationPayload(ApiModel):
    shelf_id: str
    status: Literal["in_stock", "low_stock", "out_of_stock", "uncertain"]  # CONFIRMED status
    raw_status: Literal["in_stock", "low_stock", "out_of_stock", "uncertain"]
    changed: bool = False
    count: int = Field(ge=0)
    per_class: Dict[str, int] = {}
    mean_confidence: Optional[float] = None
    availability_pct: Optional[float] = None
    expected_units: Optional[int] = None
    occluded_fraction: float = 0.0
    reason: Optional[str] = None
    model_id: Optional[str] = None
    model_version: Optional[str] = None
    boxes: List[List[Any]] = []
    planogram: Optional[Dict[str, Any]] = None
    observed_at: datetime


class CameraStatePayload(ApiModel):
    state: Optional[str] = None
    previous_state: Optional[str] = None
    error_code: Optional[str] = None
    message: Optional[str] = None
