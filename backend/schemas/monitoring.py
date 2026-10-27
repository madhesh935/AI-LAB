"""Store, overview, shoppers, cameras, inventory, queues - response contracts.

Field names follow src/types/retail.ts so the existing React pages can consume
these payloads without a redesign. Every payload carries a `meta.dataState`
so the UI can distinguish "no data yet" from "zero".
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import Field

from schemas.common import ApiModel, Meta
from schemas.operations import AlertOut

Congestion = Literal["optimal", "moderate", "high", "critical"]


# ------------------------------------------------------------------- store
class StoreOut(ApiModel):
    id: str
    name: str
    code: str
    city: Optional[str] = None
    region: Optional[str] = None
    address: Optional[str] = None
    square_footage: Optional[int] = None
    max_capacity: int
    open_time: Optional[str] = None
    close_time: Optional[str] = None
    manager_name: Optional[str] = None
    edge_server_status: str
    data_mode: str = "real"  # real | demo (seeded fixtures)


class ZoneOut(ApiModel):
    id: str
    name: str
    zone_type: str
    category: Optional[str] = None
    aisle_number: Optional[int] = None
    x: float
    y: float
    width: float
    height: float
    color: Optional[str] = None
    capacity_limit: int
    shelf_codes: List[str] = []
    description: Optional[str] = None
    current_occupancy: Optional[int] = None
    dwell_time_minutes: Optional[float] = None


class PublicStoreOut(ApiModel):
    id: str
    code: str
    name: str
    branch: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    operating_hours: Optional[str] = None
    is_open: bool
    phone: Optional[str] = None
    map_dimensions: Dict[str, int]


class StoreLayoutOut(ApiModel):
    store_id: str
    name: str
    width: int
    height: int
    zones: List[Dict[str, Any]]


class SystemConnectionOut(ApiModel):
    status: str
    latency_ms: Optional[float] = None
    last_heartbeat: Optional[datetime] = None
    edge_server_id: str
    edge_model_version: Optional[str] = None
    fps_average: Optional[float] = None
    active_cameras: int
    total_cameras: int


# --------------------------------------------------------------- shoppers
class FootfallPointOut(ApiModel):
    time: str
    bucket_start: datetime
    entries: int
    exits: int
    previous_period_entries: int = 0
    occupancy: Optional[int] = None
    measured: bool = True  # False = an hour with stored baseline values but no count for this period (shown as a gap, not as 0)


class ZoneActivityOut(ApiModel):
    id: str
    name: str
    category: Optional[str] = None
    current_occupancy: Optional[int] = None
    capacity_limit: int
    dwell_time_minutes: Optional[float] = None
    visitors: int = 0
    congestion_level: Congestion = "optimal"


class ShopperAnalyticsOut(ApiModel):
    store_id: str
    range: str
    hourly_traffic: List[FootfallPointOut]
    total_entries: int
    total_exits: int
    peak_hour: Optional[str] = None
    peak_hour_entries: int = 0
    average_visit_duration_minutes: Optional[float] = None
    zones: List[ZoneActivityOut]
    movements: List[Dict[str, Any]] = []
    meta: Meta


class FootfallOut(ApiModel):
    store_id: str
    range: str
    points: List[FootfallPointOut]
    total_entries: int
    total_exits: int
    change_percentage: Optional[float] = None  # vs the previous period of CAMERA-counted history; None when there is none
    meta: Meta


class DwellRecordOut(ApiModel):
    zone_id: str
    zone_name: str
    visitors: int
    average_dwell_minutes: float


class DwellOut(ApiModel):
    store_id: str
    range: str
    items: List[DwellRecordOut]
    average_dwell_minutes: Optional[float] = None
    meta: Meta


# ---------------------------------------------------------------- cameras
class CameraFeedOut(ApiModel):
    id: str
    name: str
    camera_code: str
    type: str
    zone: Optional[str] = None
    zone_id: Optional[str] = None
    resolution: Optional[str] = None
    stream_type: str
    fps: Optional[float] = None
    status: str
    last_frame_timestamp: Optional[str] = None
    last_frame_at: Optional[datetime] = None
    latency_ms: Optional[float] = None
    packet_loss_pct: Optional[float] = None
    ai_module: Optional[str] = None
    purpose: Optional[str] = None
    message: Optional[str] = None
    # Detections are written by inference; until a model reports, there are none.
    people_count: Optional[int] = None
    # Phase 2 (all measured by the vision worker; null when not live). The source reference is never returned.
    source_type: str = "unconfigured"
    enabled: bool = False
    is_demo: bool = False
    error_code: Optional[str] = None
    input_fps: Optional[float] = None
    inference_fps: Optional[float] = None
    inference_ms: Optional[float] = None
    last_inference_at: Optional[datetime] = None
    frame_width: Optional[int] = None
    frame_height: Optional[int] = None


class CameraCreate(ApiModel):
    name: str = Field(min_length=2, max_length=160)
    camera_code: str = Field(min_length=2, max_length=48, pattern=r"^[A-Za-z0-9_-]+$")
    type: Literal["entrance", "shelf", "checkout", "aisle"]
    zone_id: Optional[str] = None
    resolution: Optional[str] = Field(default=None, max_length=32)
    stream_type: Literal["placeholder", "mjpeg", "hls", "webrtc", "demo_canvas"] = "placeholder"
    stream_url: Optional[str] = Field(default=None, max_length=300)
    ai_module: Optional[str] = Field(default=None, max_length=48)
    purpose: Optional[str] = Field(default=None, max_length=48)
    # Optional Phase 2 source (write-only; can also be set later with PUT /api/cameras/{id}/source)
    source_type: Literal["unconfigured", "usb", "rtsp", "http", "file"] = "unconfigured"
    source_ref: Optional[str] = Field(default=None, max_length=500)
    enabled: bool = False
    is_demo: bool = False


class CameraKpisOut(ApiModel):
    total: int
    live: int
    offline: int
    unknown: int
    average_fps: Optional[float] = None


class CamerasOut(ApiModel):
    store_id: str
    cameras: List[CameraFeedOut]
    kpis: CameraKpisOut
    meta: Meta


class ReconnectOut(ApiModel):
    requested: bool
    camera_id: str
    state: str
    note: str


# -------------------------------------------------------------- inventory
class ShelfDetailOut(ApiModel):
    id: str
    shelf_code: str
    department: Optional[str] = None
    category: Optional[str] = None
    tier_count: int
    capacity_units: int
    expected_visible_units: int
    detected_visible_units: Optional[int] = None
    availability_percentage: Optional[float] = None
    condition: str  # in_stock | low_stock | out_of_stock | uncertain | camera_offline
    last_observation: Optional[str] = None
    last_observation_at: Optional[datetime] = None
    associated_camera_id: Optional[str] = None
    associated_camera_name: Optional[str] = None
    aisle_location: Optional[str] = None
    planogram_compliance_pct: Optional[float] = None
    product_ids: List[str] = []


class ProductOut(ApiModel):
    id: str
    name: str
    sku: str
    category: Optional[str] = None
    department: Optional[str] = None
    shelf_id: Optional[str] = None
    shelf_code: Optional[str] = None
    expected_visible_qty: int = 0
    detected_visible_qty: Optional[int] = None
    stockroom_qty: int = 0
    availability_pct: Optional[float] = None
    confidence_score: Optional[float] = None
    status: str
    last_observation: Optional[str] = None
    price: Optional[float] = None
    unit: Optional[str] = None
    image_url: Optional[str] = None


class PlanogramOut(ApiModel):
    id: str
    shelf_id: str
    shelf_code: str
    department: Optional[str] = None
    version: int
    compliance_percentage: Optional[float] = None
    total_slots: int
    last_verified: Optional[str] = None
    slots: List[Dict[str, Any]]


class InventoryKpisOut(ApiModel):
    tracked_shelves: int
    optimal: int
    low_stock: int
    out_of_stock: int
    uncertain: int
    average_planogram_score: Optional[float] = None
    active_tasks: int


class InventoryOut(ApiModel):
    store_id: str
    range: str
    kpis: InventoryKpisOut
    shelves: List[ShelfDetailOut]
    products: List[ProductOut]
    planograms: List[PlanogramOut]
    alerts: List[AlertOut]
    meta: Meta


# ----------------------------------------------------------------- queues
class CounterOut(ApiModel):
    id: str
    name: str
    counter_type: str
    status: str
    cashier_name: Optional[str] = None
    camera_id: Optional[str] = None
    waiting_customers: Optional[int] = None
    estimated_wait_minutes: Optional[float] = None
    congestion: Congestion = "optimal"
    avg_items_per_customer: Optional[float] = None
    service_rate_per_min: Optional[float] = None
    last_observation_at: Optional[datetime] = None


class QueueForecastOut(ApiModel):
    counter_id: str
    horizon_minutes: int
    predicted_length: float
    confidence: Optional[float] = None
    generated_at: datetime


class QueueKpisOut(ApiModel):
    active_counters: int
    total_counters: int
    customers_waiting: Optional[int] = None
    average_wait_minutes: Optional[float] = None
    longest_wait_minutes: Optional[float] = None
    congested_counters: int


class QueueRulesBody(ApiModel):
    sla_warning_wait_minutes: float = Field(default=3.0, ge=0.5, le=60)
    sla_critical_wait_minutes: float = Field(default=4.5, ge=0.5, le=120)
    max_queue_length: int = Field(default=5, ge=1, le=200)
    express_cart_limit: int = Field(default=10, ge=1, le=100)
    forecast_horizon_minutes: int = Field(default=15, ge=1, le=240)
    auto_dispatch: bool = False


class QueueIntelligenceOut(ApiModel):
    store_id: str
    range: str
    kpis: QueueKpisOut
    counters: List[CounterOut]
    forecast: List[QueueForecastOut]
    alerts: List[AlertOut]
    rules: QueueRulesBody
    meta: Meta


class CounterStatusBody(ApiModel):
    status: Literal["open", "closed", "standby", "paused"]


class DeployRecommendationBody(ApiModel):
    employee_id: Optional[str] = None
    counter_id: Optional[str] = None
    title: Optional[str] = Field(default=None, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=1000)


# --------------------------------------------------------------- overview
class StoreMetricsOut(ApiModel):
    total_footfall_today: Optional[int] = None
    footfall_change_percentage: Optional[float] = None
    footfall_history_mini: List[int] = []
    current_occupancy: Optional[int] = None
    occupancy_status: Optional[str] = None  # ok | uncertain | stale | unknown (an ESTIMATE from line crossings)
    occupancy_basis: Optional[str] = None  # crossing_estimate | footfall_running_sum
    max_capacity: int
    occupancy_percentage: Optional[float] = None
    average_dwell_time_minutes: Optional[float] = None
    low_stock_shelves_count: int = 0
    out_of_stock_shelves_count: int = 0
    critical_inventory_alerts_count: int = 0
    active_checkout_queues_count: int = 0
    total_customers_in_queue: Optional[int] = None
    overall_queue_status: Congestion = "optimal"
    average_wait_time_minutes: Optional[float] = None
    cameras_online: int = 0
    cameras_total: int = 0
    open_tasks: int = 0
    active_alerts: int = 0
    critical_alerts_count: int = 0
    latest_observation_at: Optional[datetime] = None


class OverviewOut(ApiModel):
    store: StoreOut
    metrics: StoreMetricsOut
    cameras: List[CameraFeedOut]
    analytics: ShopperAnalyticsOut
    shelves: List[ShelfDetailOut]
    queues: List[CounterOut]
    alerts: List[AlertOut]
    connection: SystemConnectionOut
    last_updated: datetime
    meta: Meta
    data_availability: Dict[str, str]
    data_mode: str = "real"  # real | demo (seeded fixtures)
    freshness: Dict[str, Dict[str, Any]] = {}  # per module: lastObservationAt, ageSeconds, state fresh|stale|unavailable
    data_quality: List[Dict[str, Any]] = []  # human-readable caveats (uncertain occupancy, model not configured, ...)
