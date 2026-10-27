"""Phase 2 camera / model / vision-worker endpoints (no authentication; loopback-bound)."""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Request

from api.deps import DbSession, SettingsDep
from schemas.vision import (
    CameraLiveOut, CameraSourceUpdate, CameraStatusOut, DetectionsOut, ModelsStatusOut, ReloadOut,
    StreamDescriptor, VisionStatusOut,
)
from services.vision import VisionService
from vision.schemas import VisionEventBatch

router = APIRouter(tags=["vision"])
LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}


@router.get("/api/cameras", response_model=List[CameraLiveOut])
def list_cameras(db: DbSession, settings: SettingsDep, store_id: Optional[str] = Query(None, alias="storeId", max_length=64)):
    return VisionService(db, settings).list_cameras(store_id)


@router.get("/api/cameras/{camera_id}", response_model=CameraLiveOut)
def get_camera(camera_id: str, db: DbSession, settings: SettingsDep):
    return VisionService(db, settings).camera(camera_id)


@router.get("/api/cameras/{camera_id}/status", response_model=CameraStatusOut)
def camera_status(camera_id: str, db: DbSession, settings: SettingsDep):
    return VisionService(db, settings).status(camera_id)


@router.get("/api/cameras/{camera_id}/stream", response_model=StreamDescriptor)
def camera_stream(camera_id: str, db: DbSession, settings: SettingsDep):
    return VisionService(db, settings).stream(camera_id)


@router.get("/api/cameras/{camera_id}/detections", response_model=DetectionsOut)
def camera_detections(camera_id: str, db: DbSession, settings: SettingsDep, limit: int = Query(60, ge=1, le=120)):
    return VisionService(db, settings).detections(camera_id, limit)


@router.put("/api/cameras/{camera_id}/source", response_model=CameraLiveOut)
def update_source(camera_id: str, body: CameraSourceUpdate, db: DbSession, settings: SettingsDep):
    """Configure where frames come from. `sourceRef` is write-only and never echoed back."""
    return VisionService(db, settings).update_source(camera_id, body)


@router.get("/api/models/status", response_model=ModelsStatusOut)
def models_status(db: DbSession, settings: SettingsDep):
    return VisionService(db, settings).models()


@router.get("/api/vision/status", response_model=VisionStatusOut)
def vision_status(db: DbSession, settings: SettingsDep):
    return VisionService(db, settings).vision_status()


@router.post("/api/vision/reload", response_model=ReloadOut)
def vision_reload(db: DbSession, settings: SettingsDep):
    return VisionService(db, settings).reload_worker()


@router.post("/api/internal/vision/events", include_in_schema=False)
def vision_events(batch: VisionEventBatch, request: Request, db: DbSession, settings: SettingsDep):
    """Worker -> API metadata relay. Loopback only; carries structured results, never frames."""
    if request.client is None or request.client.host not in LOOPBACK:
        raise HTTPException(status_code=403, detail="loopback only")
    events = [e.model_dump(mode="json", by_alias=True) for e in batch.events]
    res = VisionService(db, settings).relay_events(events)
    return {"accepted": res.accepted, "duplicates": res.duplicates, "rejected": res.rejected, "published": res.published}
