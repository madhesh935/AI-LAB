from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Query

from api.deps import DbSession, SettingsDep
from schemas.monitoring import CameraCreate, CameraFeedOut, CamerasOut, ReconnectOut
from services.cameras import CameraService

router = APIRouter(prefix="/api/stores/{store_id}/cameras", tags=["cameras"])


@router.get("", response_model=CamerasOut)
def cameras(store_id: str, db: DbSession, settings: SettingsDep):
    return CameraService(db, settings).overview(store_id)


@router.get("/timeline")
def timeline(store_id: str, db: DbSession, settings: SettingsDep, camera_id: Optional[str] = Query(None, alias="cameraId", max_length=64), limit: int = Query(60, ge=1, le=300)):
    return CameraService(db, settings).timeline(store_id, camera_id, limit)


@router.get("/monitoring", response_model=CamerasOut)
def monitoring(
    store_id: str,
    db: DbSession, settings: SettingsDep,
    q: Optional[str] = Query(None, max_length=80),
    zone: Optional[str] = Query(None, max_length=160),
    state: Optional[str] = Query(None, max_length=16),
):
    return CameraService(db, settings).overview(store_id, query=q, zone=zone, state=state)


@router.post("", response_model=CameraFeedOut, status_code=201)
def register_camera(store_id: str, body: CameraCreate, db: DbSession, settings: SettingsDep):
    return CameraService(db, settings).register(store_id, body)


@router.post("/{camera_id}/reconnect", response_model=ReconnectOut)
def reconnect(store_id: str, camera_id: str, db: DbSession, settings: SettingsDep):
    return CameraService(db, settings).request_reconnect(store_id, camera_id)
