"""
SQLite engine / session management.

* Foreign keys are enforced on every connection.
* WAL journal mode + busy timeout allow readers during writes.
* Sessions are short-lived and scoped per request; commits happen at the end
  of a successful request so write transactions stay short.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

log = logging.getLogger("retailedge.db")


class Database:
    def __init__(self, url: str, busy_timeout_ms: int = 5000, echo: bool = False):
        self.url = url
        if url.startswith("sqlite:///") and ":memory:" not in url:
            Path(url.replace("sqlite:///", "", 1)).parent.mkdir(parents=True, exist_ok=True)

        self.engine: Engine = create_engine(
            url,
            echo=echo,
            connect_args={"check_same_thread": False, "timeout": busy_timeout_ms / 1000},
            pool_pre_ping=True,
        )

        @event.listens_for(self.engine, "connect")
        def _pragmas(dbapi_conn, _record):  # noqa: ANN001
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute(f"PRAGMA busy_timeout={int(busy_timeout_ms)}")
            cur.execute("PRAGMA synchronous=NORMAL")
            if ":memory:" not in url:
                cur.execute("PRAGMA journal_mode=WAL")
            cur.close()

        self.session_factory = sessionmaker(bind=self.engine, expire_on_commit=False, autoflush=False)

    def session(self) -> Session:
        return self.session_factory()

    @contextmanager
    def transaction(self) -> Iterator[Session]:
        """Commit on success, roll back on error."""
        session = self.session()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def ping(self) -> bool:
        try:
            with self.engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return True
        except Exception:  # noqa: BLE001
            log.exception("database ping failed")
            return False

    def pragma(self, name: str):
        with self.engine.connect() as conn:
            return conn.execute(text(f"PRAGMA {name}")).scalar()

    def dispose(self) -> None:
        self.engine.dispose()
