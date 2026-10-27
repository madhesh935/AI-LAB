from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import JSON, Boolean, CheckConstraint, Date, Float, ForeignKey, Index, Integer, String, Text, false
from sqlalchemy.orm import Mapped, mapped_column

from database.base import Base, TimestampMixin, UTCDateTime, utcnow


class CustomerAssistanceRequest(Base):
    __tablename__ = "customer_assistance_requests"
    __table_args__ = (
        CheckConstraint("status IN ('submitted','assigned','on_the_way','in_progress','resolved','cancelled')", name="status"),
        Index("ix_customer_requests_store", "store_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    category: Mapped[str] = mapped_column(String(40), default="general_help", nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    aisle_or_zone: Mapped[Optional[str]] = mapped_column(String(160))
    product_id: Mapped[Optional[str]] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"))
    product_name: Mapped[Optional[str]] = mapped_column(String(160))
    customer_contact: Mapped[Optional[str]] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(12), default="submitted", nullable=False)
    assigned_employee_id: Mapped[Optional[str]] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"))
    task_id: Mapped[Optional[str]] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    # Long random reference the customer's device keeps; the short public id is NOT enough to read a request.
    status_ref: Mapped[Optional[str]] = mapped_column(String(48), unique=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)


class CustomerRequestHistory(Base):
    __tablename__ = "customer_request_history"
    __table_args__ = (Index("ix_customer_request_history_req", "request_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    request_id: Mapped[str] = mapped_column(ForeignKey("customer_assistance_requests.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)


class CustomerFeedback(Base):
    __tablename__ = "customer_feedback"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    store_id: Mapped[Optional[str]] = mapped_column(ForeignKey("stores.id", ondelete="SET NULL"))
    rating: Mapped[Optional[int]] = mapped_column(Integer)
    comment: Mapped[Optional[str]] = mapped_column(Text)
    contact: Mapped[Optional[str]] = mapped_column(String(120))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)  # full submitted form
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)


class Offer(TimestampMixin, Base):
    __tablename__ = "offers"
    __table_args__ = (Index("ix_offers_store", "store_id"),)

    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    discount_label: Mapped[Optional[str]] = mapped_column(String(48))
    category: Mapped[Optional[str]] = mapped_column(String(80))
    product_id: Mapped[Optional[str]] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"))
    original_price: Mapped[Optional[float]] = mapped_column(Float)
    offer_price: Mapped[Optional[float]] = mapped_column(Float)
    valid_until: Mapped[Optional[date]] = mapped_column(Date)
    coupon_code: Mapped[Optional[str]] = mapped_column(String(32))
    banner_color: Mapped[Optional[str]] = mapped_column(String(64))
    image_url: Mapped[Optional[str]] = mapped_column(String(300))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Pricing rule (Phase 5). fixed_price uses offer_price; percent uses discount_value as a percentage; amount uses discount_value in rupees.
    discount_type: Mapped[str] = mapped_column(String(16), default="fixed_price", server_default="fixed_price", nullable=False)
    discount_value: Mapped[Optional[float]] = mapped_column(Float)
    valid_from: Mapped[Optional[date]] = mapped_column(Date)
    min_quantity: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    conditions: Mapped[Optional[str]] = mapped_column(Text)
    stackable: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)
