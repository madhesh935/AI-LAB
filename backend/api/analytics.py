"""Phase 3 endpoints: zone/line/calibration config, shopper analytics, queue intelligence, inventory inference, event log.

No authentication (controlled local deployment). Destructive deletes need ?confirm=true like the rest of the API.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Query

from api.deps import DbSession, SettingsDep
from core.errors import ConfirmationRequiredError
from schemas.analytics import CalibrationBody, CameraZoneBody, OccupancyResetBody, QueueRegionBody, ShelfRegionBody
from services.analytics_config import AnalyticsConfigService
from services.analytics_read import AnalyticsReadService

router = APIRouter(prefix="/api/stores/{store_id}", tags=["analytics"])


def _confirm(confirm: bool, what: str) -> None:
    if not confirm:
        raise ConfirmationRequiredError(what)


# ------------------------------------------------------------------ configuration
@router.get("/analytics/config")
def analytics_config(store_id: str, db: DbSession) -> Dict[str, Any]:
    return AnalyticsConfigService(db).overview(store_id)


@router.get("/camera-zones")
def list_zones(store_id: str, db: DbSession, camera_id: Optional[str] = Query(None, alias="cameraId")):
    return AnalyticsConfigService(db).list_zones(store_id, camera_id)


@router.post("/camera-zones", status_code=201)
def create_zone(store_id: str, body: CameraZoneBody, db: DbSession):
    return AnalyticsConfigService(db).save_zone(store_id, body)


@router.put("/camera-zones/{zone_id}")
def update_zone(store_id: str, zone_id: str, body: CameraZoneBody, db: DbSession):
    return AnalyticsConfigService(db).save_zone(store_id, body, zone_id)


@router.delete("/camera-zones/{zone_id}", status_code=204)
def delete_zone(store_id: str, zone_id: str, db: DbSession, confirm: bool = Query(False)):
    _confirm(confirm, "a camera zone")
    AnalyticsConfigService(db).delete_zone(store_id, zone_id)


@router.get("/cameras/{camera_id}/calibration")
def get_calibration(store_id: str, camera_id: str, db: DbSession):
    return AnalyticsConfigService(db).get_calibration(store_id, camera_id) or {"cameraId": camera_id, "calibrated": False}


@router.put("/cameras/{camera_id}/calibration")
def put_calibration(store_id: str, camera_id: str, body: CalibrationBody, db: DbSession):
    return AnalyticsConfigService(db).save_calibration(store_id, camera_id, body)


@router.delete("/cameras/{camera_id}/calibration", status_code=204)
def delete_calibration(store_id: str, camera_id: str, db: DbSession, confirm: bool = Query(False)):
    _confirm(confirm, "a camera calibration")
    AnalyticsConfigService(db).delete_calibration(store_id, camera_id)


@router.get("/queue/regions")
def list_queue_regions(store_id: str, db: DbSession):
    return AnalyticsConfigService(db).list_queue_regions(store_id)


@router.put("/counters/{counter_id}/queue-region")
def put_queue_region(store_id: str, counter_id: str, body: QueueRegionBody, db: DbSession):
    return AnalyticsConfigService(db).save_queue_region(store_id, counter_id, body)


@router.delete("/counters/{counter_id}/queue-region", status_code=204)
def delete_queue_region(store_id: str, counter_id: str, db: DbSession, confirm: bool = Query(False)):
    _confirm(confirm, "a queue region")
    AnalyticsConfigService(db).delete_queue_region(store_id, counter_id)


@router.get("/inventory/shelf-regions")
def list_shelf_regions(store_id: str, db: DbSession):
    return AnalyticsConfigService(db).list_shelf_regions(store_id)


@router.put("/shelves/{shelf_id}/region")
def put_shelf_region(store_id: str, shelf_id: str, body: ShelfRegionBody, db: DbSession):
    return AnalyticsConfigService(db).save_shelf_region(store_id, shelf_id, body)


@router.delete("/shelves/{shelf_id}/region", status_code=204)
def delete_shelf_region(store_id: str, shelf_id: str, db: DbSession, confirm: bool = Query(False)):
    _confirm(confirm, "a shelf region")
    AnalyticsConfigService(db).delete_shelf_region(store_id, shelf_id)


# ------------------------------------------------------------------ shopper analytics
@router.get("/occupancy")
def occupancy(store_id: str, db: DbSession, settings: SettingsDep):
    return AnalyticsReadService(db, settings).occupancy(store_id)


@router.post("/occupancy/reset")
def reset_occupancy(store_id: str, body: OccupancyResetBody, db: DbSession, settings: SettingsDep):
    return AnalyticsReadService(db, settings).reset_occupancy(store_id, body.value, body.reason)


@router.get("/footfall/events")
def footfall_events(store_id: str, db: DbSession, settings: SettingsDep, limit: int = Query(100, ge=1, le=1000)):
    return AnalyticsReadService(db, settings).recent_crossings(store_id, limit)


@router.get("/zones/analytics")
def zone_analytics(store_id: str, db: DbSession, settings: SettingsDep, range: str = Query("today")):
    return AnalyticsReadService(db, settings).zone_analytics(store_id, range)


@router.get("/heatmap")
def heatmap(store_id: str, db: DbSession, settings: SettingsDep, camera_id: str = Query(..., alias="cameraId"), range: str = Query("today"),
            mode: str = Query("camera", pattern="^(camera|floor)$")):
    return AnalyticsReadService(db, settings).heatmap(store_id, camera_id, range, mode)


@router.get("/movement")
def movement(store_id: str, db: DbSession, settings: SettingsDep, range: str = Query("today")):
    return AnalyticsReadService(db, settings).movement(store_id, range)


# ------------------------------------------------------------------ queue
@router.get("/queue/status")
def queue_status(store_id: str, db: DbSession, settings: SettingsDep):
    return AnalyticsReadService(db, settings).queue_status(store_id)


@router.get("/queue/history")
def queue_history(store_id: str, db: DbSession, settings: SettingsDep, counter_id: Optional[str] = Query(None, alias="counterId"), range: str = Query("today")):
    return AnalyticsReadService(db, settings).queue_history(store_id, counter_id, range)


@router.get("/queue/forecast")
def queue_forecast(store_id: str, db: DbSession, settings: SettingsDep, counter_id: Optional[str] = Query(None, alias="counterId")):
    return AnalyticsReadService(db, settings).queue_forecast(store_id, counter_id)


@router.get("/queue/service-rates")
def queue_service_rates(store_id: str, db: DbSession, settings: SettingsDep, range: str = Query("today")):
    return AnalyticsReadService(db, settings).service_rates(store_id, range)


# ------------------------------------------------------------------ inventory
@router.get("/inventory/model")
def inventory_model(store_id: str, db: DbSession, settings: SettingsDep):
    return AnalyticsReadService(db, settings).shelf_model_status()


@router.get("/inventory/observations")
def inventory_observations(store_id: str, db: DbSession, settings: SettingsDep, shelf_id: Optional[str] = Query(None, alias="shelfId"), limit: int = Query(100, ge=1, le=1000)):
    return AnalyticsReadService(db, settings).shelf_observations(store_id, shelf_id, limit)


@router.get("/inventory/history")
def inventory_history(store_id: str, db: DbSession, settings: SettingsDep, shelf_id: Optional[str] = Query(None, alias="shelfId"), range: str = Query("today")):
    return AnalyticsReadService(db, settings).inventory_history(store_id, shelf_id, range)


@router.get("/inventory/planogram-status")
def planogram_status(store_id: str, db: DbSession, settings: SettingsDep):
    return AnalyticsReadService(db, settings).planogram_status(store_id)


# ------------------------------------------------------------------ central event log
@router.get("/events")
def events(store_id: str, db: DbSession, settings: SettingsDep, type: Optional[str] = Query(None, max_length=48), limit: int = Query(100, ge=1, le=1000)):
    return AnalyticsReadService(db, settings).events(store_id, type, limit)
