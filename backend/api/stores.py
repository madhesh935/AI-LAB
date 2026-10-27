from __future__ import annotations

from typing import List

from fastapi import APIRouter, Query
from sqlalchemy import exists, select

from api.deps import DbSession
from database.models import Camera, Store
from schemas.monitoring import OverviewOut, StoreOut, ZoneOut
from services.common import get_store_or_404
from services.overview import OverviewService, store_out
from services.shoppers import ShopperService

router = APIRouter(prefix="/api/stores", tags=["stores"])


@router.get("", response_model=List[StoreOut])
def list_stores(db: DbSession):
    # stores that actually have cameras registered come first, so the console opens on a store with data rather than an empty shell
    has_camera = exists().where(Camera.store_id == Store.id)
    return [store_out(s) for s in db.scalars(select(Store).order_by(has_camera.desc(), Store.name)).all()]


@router.get("/{store_id}", response_model=StoreOut)
def get_store(store_id: str, db: DbSession):
    return store_out(get_store_or_404(db, store_id))


@router.get("/{store_id}/overview", response_model=OverviewOut)
def store_overview(store_id: str, db: DbSession, range: str = Query("today")):
    return OverviewService(db).build(store_id, range)


@router.get("/{store_id}/zones", response_model=List[ZoneOut])
def store_zones(store_id: str, db: DbSession, range: str = Query("today"), time_of_day: str = Query("all_day", alias="timeOfDay")):
    return ShopperService(db).zones_with_metrics(store_id, range)
