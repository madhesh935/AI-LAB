from __future__ import annotations

from fastapi import APIRouter, Query

from api.deps import DbSession
from schemas.monitoring import DwellOut, FootfallOut, ShopperAnalyticsOut
from services.shoppers import ShopperService

router = APIRouter(prefix="/api/stores/{store_id}", tags=["shoppers"])


@router.get("/shopper-analytics", response_model=ShopperAnalyticsOut)
def shopper_analytics(store_id: str, db: DbSession, range: str = Query("today"), time_of_day: str = Query("all_day", alias="timeOfDay")):
    return ShopperService(db).analytics(store_id, range, time_of_day)


@router.get("/footfall", response_model=FootfallOut)
def footfall(store_id: str, db: DbSession, range: str = Query("today")):
    return ShopperService(db).footfall(store_id, range)


@router.get("/dwell", response_model=DwellOut)
def dwell(store_id: str, db: DbSession, range: str = Query("today")):
    return ShopperService(db).dwell(store_id, range)
