from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Query

from api.deps import DbSession
from schemas.monitoring import InventoryOut, PlanogramOut, ProductOut, ShelfDetailOut
from schemas.operations import AlertList
from services.alerts import AlertService
from services.inventory import InventoryService

router = APIRouter(prefix="/api/stores/{store_id}/inventory", tags=["inventory"])


@router.get("", response_model=InventoryOut)
def inventory(store_id: str, db: DbSession, range: str = Query("today"), dept: Optional[str] = Query(None)):
    return InventoryService(db).overview(store_id, range, dept)


@router.get("/shelves", response_model=List[ShelfDetailOut])
def shelves(store_id: str, db: DbSession, dept: Optional[str] = Query(None)):
    return InventoryService(db).shelves(store_id, dept)


@router.get("/products", response_model=List[ProductOut])
def products(store_id: str, db: DbSession, q: Optional[str] = Query(None, max_length=80)):
    return InventoryService(db).products(store_id, q)


@router.get("/planograms", response_model=List[PlanogramOut])
def planograms(store_id: str, db: DbSession):
    return InventoryService(db).planograms(store_id)


@router.get("/alerts", response_model=AlertList)
def inventory_alerts(store_id: str, db: DbSession):
    return AlertService(db).list(store_id, module="inventory", limit=200)
