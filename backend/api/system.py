from __future__ import annotations

from fastapi import APIRouter, Request

from api.deps import DatabaseDep, DbSession, SettingsDep
from schemas.platform import HealthOut, SystemStatusOut
from services.common import now_utc
from services.system import SystemService

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health", response_model=HealthOut)
def health(database: DatabaseDep, settings: SettingsDep):
    """Liveness + database reachability. Returns 503 when the database is down."""
    from core.errors import ServiceUnavailableError

    if not database.ping():
        raise ServiceUnavailableError("Database is not reachable")
    return HealthOut(status="ok", version=settings.app_version, time=now_utc())


@router.get("/system/status", response_model=SystemStatusOut)
def system_status(db: DbSession, database: DatabaseDep, settings: SettingsDep):
    return SystemService(db, database, settings).status()


@router.get("/system/health")
def system_health(request: Request, db: DbSession, database: DatabaseDep, settings: SettingsDep):
    """Per-component health (fastapi, sqlite, cameras, models, tracking, queue analytics, workers, websocket, language model, PWAs). `overall` is READY only if everything is."""
    from services.system_health import SystemHealthService

    return SystemHealthService(db, database, settings, request.app).report()
