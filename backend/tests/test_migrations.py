import sqlite3

from sqlalchemy import create_engine, inspect

from core.config import Settings
from database import manage
from tests.conftest import make_settings


def test_upgrade_downgrade_upgrade_and_verify(tmp_path):
    s = make_settings(tmp_path)
    r = manage.upgrade(s)
    assert r["before"] is None and r["after"] == manage.head_revision(s)
    assert manage.verify(s)["ok"], manage.verify(s)

    from alembic import command
    command.downgrade(manage.alembic_config(s), "base")
    assert manage.current_revision(s) is None
    manage.upgrade(s)
    assert manage.verify(s)["ok"]


def test_schema_has_required_tables(tmp_path):
    s = make_settings(tmp_path)
    manage.upgrade(s)
    tables = set(inspect(create_engine(s.database_url)).get_table_names())
    for t in ("stores", "store_zones", "cameras", "camera_status", "camera_zone_mapping", "model_registry", "inference_events", "model_health",
              "footfall_events", "footfall_aggregates", "zone_occupancy", "dwell_time_aggregates", "movement_aggregates",
              "products", "shelves", "shelf_products", "shelf_observations", "planograms",
              "checkout_counters", "queue_observations", "queue_forecasts", "alerts", "tasks", "task_history",
              "employees", "shifts", "attendance", "copilot_conversations", "copilot_messages", "copilot_actions",
              "customer_assistance_requests", "customer_request_history", "offers", "report_configurations"):
        assert t in tables, t


def test_existing_database_is_backed_up_and_preserved(tmp_path):
    s = make_settings(tmp_path)
    s.data_dir.mkdir(parents=True)
    # A pre-existing SQLite file with real data and no Alembic history.
    con = sqlite3.connect(s.db_path)
    con.execute("CREATE TABLE legacy_notes (id INTEGER PRIMARY KEY, body TEXT)")
    con.execute("INSERT INTO legacy_notes (body) VALUES ('keep me')")
    con.commit(); con.close()

    result = manage.upgrade(s)
    assert result["backup"] and "pre-adopt-existing" in result["backup"]
    con = sqlite3.connect(s.db_path)
    assert con.execute("SELECT body FROM legacy_notes").fetchone()[0] == "keep me"  # untouched
    con.close()


def test_backup_and_restore_roundtrip(tmp_path):
    s = make_settings(tmp_path)
    manage.upgrade(s)
    con = sqlite3.connect(s.db_path)
    con.execute("INSERT INTO stores (id, code, name, max_capacity, timezone, map_width, map_height, is_open, edge_server_status, created_at, updated_at) VALUES ('s1','C1','One',1,'UTC',1,1,1,'disconnected',datetime('now'),datetime('now'))")
    con.commit(); con.close()
    backup = manage.backup_database(s, "test")
    assert backup and backup.exists()

    con = sqlite3.connect(s.db_path); con.execute("DELETE FROM stores"); con.commit(); con.close()
    manage.restore(s, backup)
    con = sqlite3.connect(s.db_path)
    assert con.execute("SELECT COUNT(*) FROM stores").fetchone()[0] == 1
    con.close()


def test_database_path_is_absolute_and_not_cwd_dependent(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    s = Settings(data_dir="relative-data")
    assert s.db_path.is_absolute()
    assert s.db_path.parent.name == "relative-data"
    assert str(tmp_path) not in str(s.db_path)  # resolved against the backend dir, not the CWD
