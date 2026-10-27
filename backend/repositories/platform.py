from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database.models import (
    CopilotAction,
    CopilotConversation,
    CopilotMessage,
    CustomerAssistanceRequest,
    Insight,
    Offer,
    Product,
    ReportConfiguration,
)


class InsightRepository:
    def __init__(self, db: Session):
        self.db = db

    def list(self, store_id: str, category: Optional[str], severity: Optional[str], status: Optional[str]) -> Sequence[Insight]:
        stmt = select(Insight).where(Insight.store_id == store_id)
        for col, value in ((Insight.category, category), (Insight.severity, severity), (Insight.status, status)):
            if value and value != "all":
                stmt = stmt.where(col == value)
        return self.db.scalars(stmt.order_by(Insight.created_at.desc())).all()

    def counts(self, store_id: str) -> dict:
        rows = self.db.execute(select(Insight.status, Insight.severity, func.count()).where(Insight.store_id == store_id).group_by(Insight.status, Insight.severity)).all()
        return {(r[0], r[1]): r[2] for r in rows}


class CopilotRepository:
    def __init__(self, db: Session):
        self.db = db

    def conversations(self, store_id: str) -> Sequence[CopilotConversation]:
        return self.db.scalars(
            select(CopilotConversation)
            .where(CopilotConversation.store_id == store_id)
            .where(CopilotConversation.is_archived.is_(False))
            .order_by(CopilotConversation.updated_at.desc())
        ).all()

    def message_count(self, conversation_id: str) -> int:
        return self.db.scalar(select(func.count()).select_from(CopilotMessage).where(CopilotMessage.conversation_id == conversation_id)) or 0

    def action_by_key(self, key: str) -> Optional[CopilotAction]:
        return self.db.scalars(select(CopilotAction).where(CopilotAction.idempotency_key == key)).first()


class CustomerRepository:
    def __init__(self, db: Session):
        self.db = db

    def offers(self, store_id: str) -> Sequence[Tuple[Offer, Optional[Product]]]:
        rows = self.db.execute(
            select(Offer, Product).outerjoin(Product, Product.id == Offer.product_id).where(Offer.store_id == store_id).where(Offer.is_active.is_(True)).order_by(Offer.valid_until)
        ).all()
        return [tuple(r) for r in rows]

    def requests(self, store_id: str, limit: int = 50) -> Sequence[CustomerAssistanceRequest]:
        return self.db.scalars(
            select(CustomerAssistanceRequest).where(CustomerAssistanceRequest.store_id == store_id).order_by(CustomerAssistanceRequest.created_at.desc()).limit(limit)
        ).all()


class ReportRepository:
    def __init__(self, db: Session):
        self.db = db

    def configs(self, store_id: str) -> Sequence[ReportConfiguration]:
        return self.db.scalars(select(ReportConfiguration).where(ReportConfiguration.store_id == store_id).order_by(ReportConfiguration.updated_at.desc())).all()
