from __future__ import annotations

from typing import Optional

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from database.base import Base, TimestampMixin


class ReportConfiguration(TimestampMixin, Base):
    __tablename__ = "report_configurations"
    __table_args__ = (Index("ix_report_configurations_store", "store_id"),)

    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(24), default="overview", nullable=False)
    date_range: Mapped[str] = mapped_column(String(12), default="today", nullable=False)
    compare_period: Mapped[str] = mapped_column(String(20), default="none", nullable=False)
    created_by: Mapped[Optional[str]] = mapped_column(String(48))
