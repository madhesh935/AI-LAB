from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import JSON, CheckConstraint, Index, String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from database.base import Base, UTCDateTime, utcnow


class Insight(Base):
    """AI recommendation produced by an analytics / inference pipeline.

    Required by GET /api/stores/{id}/insights, which the frontend's AI Insights
    page consumes. The schema list in the Phase 1 brief did not name it, so it is
    an addition driven by the verified frontend contract.
    """

    __tablename__ = "insights"
    __table_args__ = (
        CheckConstraint("severity IN ('critical','warning','info')", name="severity"),
        CheckConstraint("status IN ('pending','in_progress','completed','dismissed')", name="status"),
        Index("ix_insights_store_status", "store_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    severity: Mapped[str] = mapped_column(String(8), default="info", nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="pending", nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    zone: Mapped[Optional[str]] = mapped_column(String(160))
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    explanation: Mapped[Optional[str]] = mapped_column(Text)
    recommended_action: Mapped[Optional[str]] = mapped_column(Text)
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)
    dismissed_reason: Mapped[Optional[str]] = mapped_column(Text)
    task_id: Mapped[Optional[str]] = mapped_column(String(48))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)
    completed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
    source: Mapped[str] = mapped_column(String(16), default="system", nullable=False)
