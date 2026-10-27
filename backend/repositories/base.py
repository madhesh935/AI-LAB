from __future__ import annotations

from typing import Optional, Type, TypeVar

from sqlalchemy.orm import Session

from core.errors import NotFoundError

T = TypeVar("T")


def get_or_404(db: Session, model: Type[T], identifier, label: Optional[str] = None) -> T:
    obj = db.get(model, identifier)
    if obj is None:
        raise NotFoundError(label or model.__name__, identifier)
    return obj
