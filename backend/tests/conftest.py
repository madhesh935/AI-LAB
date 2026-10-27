from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.config import Settings  # noqa: E402
from database import manage  # noqa: E402
from database.connection import Database  # noqa: E402
from database.models import Store  # noqa: E402
from main import create_app  # noqa: E402


def _free_port() -> int:
    import socket

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def make_settings(tmp_path: Path, use_env_file: bool = False, **overrides) -> Settings:
    # Tests never read the developer's backend/.env (API keys, provider choice); scripts/evaluate_copilot.py opts in with use_env_file=True because it measures the REAL configured model.
    # A free worker port keeps API tests hermetic even if a real vision worker is running on 8100.
    overrides.setdefault("vision_worker_port", _free_port())
    return Settings(**({} if use_env_file else {"_env_file": None}), data_dir=tmp_path / "data", log_json=False, log_level="WARNING", mutation_rate_limit_per_minute=100000, **overrides)


@pytest.fixture(autouse=True)
def _reset_vision_state():
    from services.vision import vision_state

    vision_state.reset()
    yield
    vision_state.reset()


@pytest.fixture()
def settings(tmp_path) -> Settings:
    return make_settings(tmp_path)


@pytest.fixture()
def client(settings):
    """Empty (migrated) database with a single bare store - no demo data."""
    manage.upgrade(settings)
    db = Database(settings.database_url)
    with db.transaction() as s:
        s.add(Store(id="store-a", code="A-1", name="Store A", max_capacity=100, edge_server_status="disconnected"))
        s.add(Store(id="store-b", code="B-1", name="Store B", max_capacity=50, edge_server_status="disconnected"))
    db.dispose()
    app = create_app(settings)
    with TestClient(app) as c:
        c.settings = settings
        yield c


@pytest.fixture()
def seeded(settings):
    """Database populated with the EXPLICIT demo seed."""
    from database.seed import seed_demo

    seed_demo(settings)
    app = create_app(settings)
    with TestClient(app) as c:
        c.settings = settings
        yield c


from contextlib import contextmanager  # noqa: E402


@contextmanager
def open_events(client, store_id, **params):
    """Connect to the store's event feed and consume the hello + snapshot control messages, yielding a socket positioned at live events."""
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    with client.websocket_connect(f"/ws/stores/{store_id}/events" + (f"?{qs}" if qs else "")) as ws:
        hello = ws.receive_json()
        assert hello["type"] == "hello"
        snap = ws.receive_json()
        assert snap["type"] == "snapshot"
        ws.hello, ws.snapshot = hello, snap
        yield ws
