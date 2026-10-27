"""Request bodies for Phase 3 configuration (zones, counting lines, calibration, queue/shelf regions, occupancy)."""

from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import Field, field_validator, model_validator

from schemas.common import ApiModel

ZoneType = Literal["entrance", "aisle", "category", "promotion", "checkout", "queue", "service", "other"]
Pt = List[float]


def _check_points(points: List[Pt], minimum: int = 0) -> List[Pt]:
    if len(points) < minimum:
        raise ValueError(f"needs at least {minimum} points")
    for p in points:
        if len(p) != 2 or not all(0.0 <= v <= 1.0 for v in p):
            raise ValueError("points must be [x, y] with x and y between 0 and 1 (fractions of the image)")
    return points


class LineBody(ApiModel):
    """Directed counting line in normalised image coordinates.

    Give EITHER `inSide` ('positive'|'negative') OR `insidePoint` (any point known to be inside the store) - the latter is
    converted to inSide so nobody has to reason about cross products."""

    p1: Pt
    p2: Pt
    in_side: Optional[Literal["positive", "negative"]] = None
    inside_point: Optional[Pt] = None
    margin: float = Field(default=0.025, ge=0.002, le=0.2)
    min_track_age: int = Field(default=3, ge=1, le=100)
    cooldown_seconds: float = Field(default=2.0, ge=0, le=60)
    count_only: Optional[Literal["in", "out"]] = None  # entrance line: "in"; exit line: "out"; None counts both directions

    @model_validator(mode="after")
    def _check(self):
        _check_points([self.p1, self.p2])
        if abs(self.p1[0] - self.p2[0]) + abs(self.p1[1] - self.p2[1]) < 0.02:
            raise ValueError("line is too short")
        if self.in_side is None and self.inside_point is None:
            raise ValueError("provide inSide or insidePoint so entry/exit direction is defined")
        if self.inside_point is not None:
            _check_points([self.inside_point])
        return self


class CameraZoneBody(ApiModel):
    id: Optional[str] = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    camera_id: str
    name: str = Field(min_length=2, max_length=160)
    zone_type: ZoneType = "aisle"
    store_zone_id: Optional[str] = None
    polygon: List[Pt] = []
    line: Optional[LineBody] = None
    enabled: bool = True
    min_dwell_seconds: Optional[float] = Field(default=None, ge=0, le=600)
    exit_grace_seconds: Optional[float] = Field(default=None, ge=0, le=60)

    @field_validator("polygon")
    @classmethod
    def _poly(cls, v):
        return _check_points(v)

    @model_validator(mode="after")
    def _need_geometry(self):
        if len(self.polygon) < 3 and self.line is None:
            raise ValueError("a zone needs a polygon (3+ points) and/or a counting line")
        if self.polygon and len(self.polygon) < 3:
            raise ValueError("polygon needs at least 3 points")
        return self


class CalibrationBody(ApiModel):
    image_points: List[Pt] = Field(min_length=4, max_length=32)
    floor_points: List[List[float]] = Field(min_length=4, max_length=32)

    @model_validator(mode="after")
    def _match(self):
        _check_points(self.image_points, 4)
        if len(self.image_points) != len(self.floor_points) or any(len(p) != 2 for p in self.floor_points):
            raise ValueError("imagePoints and floorPoints must be matching [x, y] lists")
        return self


class QueueRegionBody(ApiModel):
    camera_id: str
    queue_polygon: List[Pt]
    service_polygon: List[Pt] = []
    priority: int = Field(default=0, ge=0, le=100)
    warning_length: int = Field(default=4, ge=1, le=100)
    critical_length: int = Field(default=7, ge=1, le=200)
    warning_wait_seconds: float = Field(default=180.0, ge=10, le=7200)
    critical_wait_seconds: float = Field(default=270.0, ge=10, le=7200)
    assumed_service_rate_per_min: Optional[float] = Field(default=None, gt=0, le=60)
    enabled: bool = True

    @model_validator(mode="after")
    def _check(self):
        _check_points(self.queue_polygon, 3)
        if self.service_polygon:
            _check_points(self.service_polygon, 3)
        if self.critical_length < self.warning_length or self.critical_wait_seconds < self.warning_wait_seconds:
            raise ValueError("critical thresholds must not be lower than warning thresholds")
        return self


class SlotBody(ApiModel):
    slot_id: str = Field(max_length=40)
    rect: List[float] = Field(min_length=4, max_length=4)  # x, y, w, h (normalised)
    expected_class: str = Field(max_length=64)


class ShelfRegionBody(ApiModel):
    camera_id: str
    polygon: List[Pt]
    class_map: Dict[str, str] = Field(min_length=1)  # detector class -> product id / category label
    expected_visible_capacity: int = Field(ge=1, le=5000)
    low_stock_pct: float = Field(default=30.0, gt=0, lt=100)
    out_of_stock_pct: float = Field(default=5.0, ge=0, lt=100)
    confirm_observations: int = Field(default=3, ge=1, le=20)
    min_confidence: float = Field(default=0.4, ge=0.05, le=0.99)
    interval_seconds: float = Field(default=15.0, ge=1, le=3600)
    enabled: bool = True
    slots: List[SlotBody] = []

    @model_validator(mode="after")
    def _check(self):
        _check_points(self.polygon, 3)
        if self.out_of_stock_pct >= self.low_stock_pct:
            raise ValueError("outOfStockPct must be below lowStockPct")
        for s in self.slots:
            if not all(0 <= v <= 1 for v in s.rect):
                raise ValueError("slot rect values must be between 0 and 1")
        return self


class OccupancyResetBody(ApiModel):
    value: int = Field(default=0, ge=0, le=100000)
    reason: str = Field(default="manual reset", min_length=3, max_length=160)
