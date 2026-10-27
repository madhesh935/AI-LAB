"""Store Copilot conversation persistence (SQLite). Orchestration and actions live in the `copilot` package.

Conversations are bound to ONE store and an explicit conversation id. There is no authentication, so conversations are NOT private to a
verified user: anyone who can reach the API can read them. They never contain raw CCTV or personal data (only text and tool-result summaries).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from core.errors import NotFoundError
from database.models import CopilotConversation, CopilotMessage
from repositories.base import get_or_404
from repositories.platform import CopilotRepository
from services.common import get_store_or_404, store_tz


def _clock(dt: datetime, tz) -> str:
    return dt.astimezone(tz).strftime("%I:%M %p").lstrip("0")


class CopilotService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = CopilotRepository(db)

    def _message_dict(self, m: CopilotMessage, tz) -> Dict[str, Any]:
        data = {"id": m.public_id, "role": m.role, "content": m.content, "timestamp": _clock(m.created_at, tz)}
        data.update(m.payload or {})
        return data

    def _conv_dict(self, c: CopilotConversation, with_messages: bool = True) -> Dict[str, Any]:
        store = get_store_or_404(self.db, c.store_id)
        tz = store_tz(store)
        return {
            "id": c.id, "title": c.title, "storeId": c.store_id, "storeName": store.name, "createdAt": c.created_at.isoformat(), "updatedAt": c.updated_at.isoformat(),
            "isPinned": c.is_pinned, "context": c.context or {}, "messageCount": len(c.messages),
            "messages": [self._message_dict(m, tz) for m in c.messages] if with_messages else [],
        }

    def list(self, store_id: str, with_messages: bool = False) -> List[Dict[str, Any]]:
        get_store_or_404(self.db, store_id)
        return [self._conv_dict(c, with_messages) for c in self.repo.conversations(store_id)]

    def get(self, conversation_id: str, store_id: Optional[str] = None) -> Dict[str, Any]:
        conv = get_or_404(self.db, CopilotConversation, conversation_id, "Conversation")
        if conv.is_archived or (store_id and conv.store_id != store_id):
            raise NotFoundError("Conversation", conversation_id)
        return self._conv_dict(conv)

    def rename(self, conversation_id: str, title: Optional[str], pinned: Optional[bool]) -> Dict[str, Any]:
        conv = get_or_404(self.db, CopilotConversation, conversation_id, "Conversation")
        if conv.is_archived:
            raise NotFoundError("Conversation", conversation_id)
        if title is not None:
            conv.title = title.strip()[:160] or conv.title
        if pinned is not None:
            conv.is_pinned = pinned
        self.db.flush()
        return self._conv_dict(conv, with_messages=False)

    def archive(self, conversation_id: str) -> Dict[str, Any]:
        """Soft delete: the conversation disappears from lists but its history is kept."""
        conv = get_or_404(self.db, CopilotConversation, conversation_id, "Conversation")
        conv.is_archived = True
        self.db.flush()
        return {"success": True, "deleted": conversation_id, "archived": True}
