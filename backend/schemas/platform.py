"""Insights, reports, copilot, customer, system and ingestion contracts."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import Field

from schemas.common import ApiModel, Meta
from schemas.operations import Severity, TaskOut

# ---------------------------------------------------------------- insights
InsightStatus = Literal["pending", "in_progress", "completed", "dismissed"]


class InsightOut(ApiModel):
    id: str
    code: str
    category: str
    severity: Severity
    status: InsightStatus
    title: str
    zone: Optional[str] = None
    timestamp: str
    summary: str
    explanation: Optional[str] = None
    recommended_action: Optional[str] = None
    evidence: Dict[str, Any] = {}
    dismissed_reason: Optional[str] = None
    task_id: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    source: str


class InsightKpisOut(ApiModel):
    active_insights: int
    critical_issues: int
    pending_actions: int
    completed_recommendations: int


class InsightsOut(ApiModel):
    store_id: str
    range: str
    kpis: InsightKpisOut
    insights: List[InsightOut]
    footfall_forecast: Optional[Dict[str, Any]] = None
    opportunities: List[Dict[str, Any]] = []
    meta: Meta


class InsightCreate(ApiModel):
    code: str = Field(min_length=3, max_length=32)
    category: str = Field(min_length=2, max_length=40)
    severity: Severity = "info"
    title: str = Field(min_length=3, max_length=200)
    zone: Optional[str] = Field(default=None, max_length=160)
    summary: str = Field(default="", max_length=2000)
    explanation: Optional[str] = Field(default=None, max_length=4000)
    recommended_action: Optional[str] = Field(default=None, max_length=2000)
    evidence: Dict[str, Any] = Field(default_factory=dict)


class InsightActionBody(ApiModel):
    action: Literal["acknowledge", "start", "complete", "dismiss"]
    reason: Optional[str] = Field(default=None, max_length=1000)


class InsightTaskBody(ApiModel):
    employee_id: Optional[str] = None
    priority: Literal["critical", "high", "medium", "low"] = "high"
    instructions: Optional[str] = Field(default=None, max_length=2000)
    due_in_minutes: Optional[int] = Field(default=30, ge=1, le=60 * 24 * 14)


class InsightTaskOut(ApiModel):
    insight: InsightOut
    task: TaskOut


# ----------------------------------------------------------------- reports
class ReportOut(ApiModel):
    store_id: str
    category: str
    range: str
    compare_period: str
    generated_at: datetime
    summary: Dict[str, Any]
    series: Dict[str, List[Dict[str, Any]]]
    meta: Meta


class ReportConfigCreate(ApiModel):
    name: str = Field(min_length=2, max_length=120)
    category: Literal["overview", "shoppers", "inventory", "queues", "operations"] = "overview"
    date_range: str = Field(default="today", max_length=12)
    compare_period: Literal["none", "previous_period", "previous_year"] = "none"


class ReportConfigOut(ApiModel):
    id: str
    store_id: str
    name: str
    category: str
    date_range: str
    compare_period: str
    created_at: datetime
    updated_at: datetime


# ----------------------------------------------------------------- copilot
class ChatRequest(ApiModel):
    query: str = Field(min_length=1, max_length=4000)
    store_id: str = "store-blr-104"
    conversation_id: Optional[str] = None
    stream: bool = False


class ActionPreviewRequest(ApiModel):
    action_type: str = Field(min_length=2, max_length=48)
    store_id: str
    params: Dict[str, Any] = Field(default_factory=dict)


class ActionConfirmRequest(ApiModel):
    action_id: str
    idempotency_key: str = Field(min_length=4, max_length=64)
    store_id: str


# ---------------------------------------------------------------- customer
class AssistanceCreate(ApiModel):
    store_id: str = "store-blr-104"
    category: str = Field(default="general_help", max_length=40)
    description: str = Field(default="Customer requested in-store assistance.", min_length=2, max_length=1000)
    aisle_or_zone: Optional[str] = Field(default="Store Floor", max_length=160)
    product_id: Optional[str] = None
    product_name: Optional[str] = Field(default="", max_length=160)
    customer_contact: Optional[str] = Field(default="Shopper App User", max_length=120)


class AssistanceOut(ApiModel):
    id: str
    store_id: str
    category: str
    description: str
    aisle_or_zone: Optional[str] = None
    product_id: Optional[str] = None
    product_name: Optional[str] = None
    customer_contact: Optional[str] = None
    status: str
    assigned_staff_name: Optional[str] = None
    submitted_at: str
    updated_at: str


class FeedbackBody(ApiModel):
    store_id: Optional[str] = None
    rating: Optional[int] = Field(default=None, ge=1, le=5)
    comment: Optional[str] = Field(default=None, max_length=2000)
    contact: Optional[str] = Field(default=None, max_length=120)


class OfferOut(ApiModel):
    id: str
    title: str
    description: Optional[str] = None
    discount_label: Optional[str] = None
    category: Optional[str] = None
    product_id: Optional[str] = None
    product_name: Optional[str] = None
    original_price: Optional[float] = None
    offer_price: Optional[float] = None
    valid_until: Optional[date] = None
    coupon_code: Optional[str] = None
    banner_color: Optional[str] = None
    image_url: Optional[str] = None


# ------------------------------------------------------- inference ingestion
class FootfallIngest(ApiModel):
    camera_id: Optional[str] = None
    direction: Literal["in", "out"]
    count: int = Field(default=1, ge=1, le=1000)
    observed_at: Optional[datetime] = None


class ShelfObservationIngest(ApiModel):
    shelf_id: str
    product_id: Optional[str] = None
    detected_units: int = Field(ge=0, le=100000)
    confidence: Optional[float] = Field(default=None, ge=0, le=1)
    planogram_compliance_pct: Optional[float] = Field(default=None, ge=0, le=100)
    observed_at: Optional[datetime] = None


class QueueObservationIngest(ApiModel):
    counter_id: str
    queue_length: int = Field(ge=0, le=500)
    estimated_wait_seconds: Optional[float] = Field(default=None, ge=0)
    avg_items_per_customer: Optional[float] = Field(default=None, ge=0)
    observed_at: Optional[datetime] = None


class CameraStatusIngest(ApiModel):
    camera_id: str
    state: Literal["live", "offline", "connecting", "buffering", "reconnecting", "error"]
    fps: Optional[float] = Field(default=None, ge=0, le=240)
    latency_ms: Optional[float] = Field(default=None, ge=0)
    packet_loss_pct: Optional[float] = Field(default=None, ge=0, le=100)
    message: Optional[str] = Field(default=None, max_length=240)


class ZoneOccupancyIngest(ApiModel):
    zone_id: str
    count: int = Field(ge=0, le=10000)
    observed_at: Optional[datetime] = None


class IngestBatch(ApiModel):
    footfall: List[FootfallIngest] = Field(default_factory=list, max_length=500)
    shelf_observations: List[ShelfObservationIngest] = Field(default_factory=list, max_length=500)
    queue_observations: List[QueueObservationIngest] = Field(default_factory=list, max_length=500)
    camera_status: List[CameraStatusIngest] = Field(default_factory=list, max_length=200)
    zone_occupancy: List[ZoneOccupancyIngest] = Field(default_factory=list, max_length=500)
    model_id: Optional[str] = None


class IngestResult(ApiModel):
    accepted: Dict[str, int]
    rejected: Dict[str, int]
    errors: List[str] = []


# ------------------------------------------------------------------ system
class HealthOut(ApiModel):
    status: str
    version: str
    time: datetime


class SystemStatusOut(ApiModel):
    status: str
    version: str
    environment: str
    database: Dict[str, Any]
    inference: Dict[str, Any]
    counts: Dict[str, int]
    demo_data_present: bool
    realtime_subscribers: int
    auth: str = "none (controlled local demonstration)"
    bound_host: str
