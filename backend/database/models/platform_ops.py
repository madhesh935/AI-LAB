"""Phase 4 platform records: idempotency keys and staffing-recommendation decisions."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from database.base import Base, UTCDateTime, utcnow


class IdempotencyRecord(Base):
    """A client-supplied key already applied to a state-changing request. Replays return the original outcome instead of repeating it."""

    __tablename__ = "idempotency_records"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    scope: Mapped[str] = mapped_column(String(40), primary_key=True)  # e.g. task.create, task.start
    ref: Mapped[Optional[str]] = mapped_column(String(64))  # id of what the first request created / changed
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)


class RecommendationDecision(Base):
    """A manager's decision on a derived staffing recommendation (the recommendation itself is computed from live alerts, never stored)."""

    __tablename__ = "recommendation_decisions"
    __table_args__ = (Index("ix_recommendation_decisions_store", "store_id", "decided_at"),)

    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), primary_key=True)
    key: Mapped[str] = mapped_column(String(120), primary_key=True)  # stable key of the underlying condition, e.g. queue:cnt-02:alert-id
    status: Mapped[str] = mapped_column(String(12), nullable=False)  # accepted | rejected
    task_id: Mapped[Optional[str]] = mapped_column(String(48))
    decided_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
