from __future__ import annotations

from fastapi import APIRouter

from api.deps import DbSession
from schemas.platform import IngestBatch, IngestResult
from services.ingest import IngestService

router = APIRouter(prefix="/api/stores/{store_id}/ingest", tags=["ingest"])


@router.post("", response_model=IngestResult)
def ingest(store_id: str, body: IngestBatch, db: DbSession):
    """Write-side contract for AI inference workers (structured results only, no frames)."""
    return IngestService(db).ingest(store_id, body)
