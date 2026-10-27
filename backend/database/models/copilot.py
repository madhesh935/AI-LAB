from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy import JSON, Boolean, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database.base import Base, UTCDateTime, utcnow


class CopilotConversation(Base):
    __tablename__ = "copilot_conversations"
    __table_args__ = (Index("ix_copilot_conversations_store", "store_id", "updated_at"),)

    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Soft delete: removing a conversation hides it instead of destroying history.
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    context: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False)

    messages: Mapped[List["CopilotMessage"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", order_by="CopilotMessage.id"
    )


class CopilotMessage(Base):
    __tablename__ = "copilot_messages"
    __table_args__ = (Index("ix_copilot_messages_conversation", "conversation_id", "id"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(String(48), unique=True, nullable=False)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("copilot_conversations.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String(12), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # Structured extras: toolCalls, groundingSources, richPayload, actionPreview, followUpQuestions ...
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    conversation: Mapped[CopilotConversation] = relationship(back_populates="messages")


class CopilotAction(Base):
    """Two-phase actions: previewed first, executed only after explicit confirmation."""

    __tablename__ = "copilot_actions"

    id: Mapped[str] = mapped_column(String(48), primary_key=True)
    store_id: Mapped[str] = mapped_column(ForeignKey("stores.id", ondelete="CASCADE"), nullable=False)
    conversation_id: Mapped[Optional[str]] = mapped_column(ForeignKey("copilot_conversations.id", ondelete="SET NULL"))
    action_type: Mapped[str] = mapped_column(String(48), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(24), default="awaiting_confirmation", nullable=False)
    result: Mapped[Optional[dict]] = mapped_column(JSON)
    result_reference_id: Mapped[Optional[str]] = mapped_column(String(48))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    executed_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime)
