"""Request-scoped dependencies (dependency injection)."""

from __future__ import annotations

from typing import Annotated, Iterator

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from core.config import Settings
from database.connection import Database


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings


def get_database(request: Request) -> Database:
    return request.app.state.db


def get_db(request: Request) -> Iterator[Session]:
    """One short transaction per request: commit when the handler succeeds,
    roll back on any error. scope='function' (see DbSession) makes the commit
    happen BEFORE the response is sent, so a follow-up request always sees it."""
    session = request.app.state.db.session()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


DbSession = Annotated[Session, Depends(get_db, scope="function")]
SettingsDep = Annotated[Settings, Depends(get_settings_dep)]
DatabaseDep = Annotated[Database, Depends(get_database)]
