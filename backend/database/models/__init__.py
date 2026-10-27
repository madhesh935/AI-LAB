"""Import every model so Base.metadata (and Alembic autogenerate) sees all tables."""

from database.models.analytics import (
    CameraCalibration,
    CameraZone,
    DomainEvent,
    HeatmapCell,
    OccupancyState,
    QueueRegion,
    QueueServiceSample,
    ShelfRegion,
    ZoneVisit,
)
from database.models.ai import InferenceEvent, ModelHealth, ModelRegistry
from database.models.cameras import Camera, CameraStatus, CameraStatusEvent, CameraZoneMapping
from database.models.copilot import CopilotAction, CopilotConversation, CopilotMessage
from database.models.customers import CustomerAssistanceRequest, CustomerFeedback, CustomerRequestHistory, Offer
from database.models.insights import Insight
from database.models.platform_ops import IdempotencyRecord, RecommendationDecision
from database.models.inventory import Planogram, Product, Shelf, ShelfObservation, ShelfProduct
from database.models.operations import Alert, Attendance, Employee, Shift, Task, TaskHistory
from database.models.queues import CheckoutCounter, QueueForecast, QueueObservation, QueueRules
from database.models.reports import ReportConfiguration
from database.models.shoppers import (
    DwellTimeAggregate,
    FootfallAggregate,
    FootfallEvent,
    MovementAggregate,
    ZoneOccupancy,
)
from database.models.stores import Store, StoreZone
from database.models.store_map import MapEdge, MapNode, ShelfPlacement, StoreLayout

__all__ = [
    "IdempotencyRecord", "RecommendationDecision",
    "CameraCalibration", "CameraZone", "DomainEvent", "HeatmapCell", "OccupancyState", "QueueRegion",
    "QueueServiceSample", "ShelfRegion", "ZoneVisit",
    "Alert", "Attendance", "Camera", "CameraStatus", "CameraStatusEvent", "CameraZoneMapping", "CheckoutCounter",
    "CopilotAction", "CopilotConversation", "CopilotMessage", "CustomerAssistanceRequest",
    "CustomerFeedback", "CustomerRequestHistory", "DwellTimeAggregate", "Employee",
    "FootfallAggregate", "FootfallEvent", "InferenceEvent", "Insight", "ModelHealth",
    "ModelRegistry", "MovementAggregate", "Offer", "Planogram", "Product", "QueueForecast",
    "QueueObservation", "QueueRules", "ReportConfiguration", "Shelf", "ShelfObservation",
    "ShelfProduct", "Shift", "Store", "StoreZone", "Task", "TaskHistory", "ZoneOccupancy",
    "MapEdge", "MapNode", "ShelfPlacement", "StoreLayout",
]
