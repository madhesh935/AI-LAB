"""
Database administration CLI.

    python -m database.manage setup        # backup (if DB exists) + migrate to head
    python -m database.manage upgrade      # apply pending migrations (with backup)
    python -m database.manage backup       # consistent online copy into data/backups/
    python -m database.manage restore FILE # restore a backup (the current DB is backed up first)
    python -m database.manage status       # revision, tables, row counts
    python -m database.manage verify       # integrity, foreign keys, model/migration drift
    python -m database.manage seed-demo    # insert demo data (explicit opt-in; never automatic)
    python -m database.manage seed-footfall-history [--days 7]   # DEMO hourly footfall for previous days (baseline + forecast input; never today)
    python -m database.manage seed-demo-catalog [--store ID]     # DEMO stores only: Customer PWA catalogue, shelves, offers
    python -m database.manage seed-store-map [--store ID] [--replace]   # prototype floor-plan walkway graph from the store's zones

Recovery guidance
-----------------
* Every upgrade/restore first writes data/backups/retailedge-<UTC timestamp>-<reason>.db
* To roll a bad migration back: stop the API, `python -m database.manage restore <that file>`.
* To step the schema back one revision: `alembic downgrade -1` (data in dropped columns is lost -
  restoring the backup is the safer path).
"""

from __future__ import annotations

import argparse
import logging
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from alembic.autogenerate import compare_metadata
from sqlalchemy import create_engine, inspect, text

from core.config import BACKEND_DIR, Settings, get_settings

log = logging.getLogger("retailedge.manage")


def alembic_config(settings: Settings) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "database" / "migrations"))
    cfg.attributes["db_url"] = settings.database_url
    return cfg


def head_revision(settings: Settings) -> str:
    return ScriptDirectory.from_config(alembic_config(settings)).get_current_head()


def current_revision(settings: Settings) -> Optional[str]:
    if not settings.db_path.exists():
        return None
    engine = create_engine(settings.database_url)
    try:
        with engine.connect() as conn:
            return MigrationContext.configure(conn).get_current_revision()
    finally:
        engine.dispose()


def backup_database(settings: Settings, reason: str = "manual") -> Optional[Path]:
    """Consistent copy using SQLite's online backup API (safe while the API is running)."""
    if not settings.db_path.exists():
        return None
    settings.backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = settings.backup_dir / f"retailedge-{stamp}-{reason}.db"
    src = sqlite3.connect(str(settings.db_path))
    dst = sqlite3.connect(str(target))
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    _prune_backups(settings)
    log.info("database backed up", extra={"target": str(target)})
    return target


def _prune_backups(settings: Settings) -> None:
    backups = sorted(settings.backup_dir.glob("retailedge-*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old in backups[settings.backup_retention:]:
        old.unlink(missing_ok=True)


def upgrade(settings: Settings, revision: str = "head") -> dict:
    """Apply migrations. Takes a backup first when the DB already holds a schema."""
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    before = current_revision(settings)
    target = head_revision(settings) if revision == "head" else revision
    backup = None
    if before is not None and before != target:
        backup = backup_database(settings, reason=f"pre-upgrade-from-{before}")
    elif before is None and settings.db_path.exists() and settings.db_path.stat().st_size > 0:
        # A database file with no Alembic history: preserve it before touching it.
        backup = backup_database(settings, reason="pre-adopt-existing")
    command.upgrade(alembic_config(settings), revision)
    after = current_revision(settings)
    return {"before": before, "after": after, "backup": str(backup) if backup else None}


def restore(settings: Settings, backup_file: Path) -> Path:
    backup_file = Path(backup_file).resolve()
    if not backup_file.is_file():
        raise FileNotFoundError(backup_file)
    check = sqlite3.connect(str(backup_file))
    try:
        if check.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("The backup failed its integrity check; refusing to restore")
    finally:
        check.close()
    safety = backup_database(settings, reason="pre-restore")
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    for suffix in ("-wal", "-shm"):
        Path(str(settings.db_path) + suffix).unlink(missing_ok=True)
    shutil.copy2(backup_file, settings.db_path)
    log.info("database restored", extra={"from": str(backup_file), "safety_backup": str(safety) if safety else None})
    return safety or backup_file


def verify(settings: Settings) -> dict:
    """Integrity + FK + drift between the live schema and the SQLAlchemy models."""
    from database.base import Base
    import database.models  # noqa: F401

    if not settings.db_path.exists():
        return {"ok": False, "problems": ["database file does not exist - run `setup`"]}
    engine = create_engine(settings.database_url)
    problems = []
    try:
        with engine.connect() as conn:
            integrity = conn.execute(text("PRAGMA integrity_check")).scalar()
            if integrity != "ok":
                problems.append(f"integrity_check: {integrity}")
            fk = conn.execute(text("PRAGMA foreign_key_check")).fetchall()
            if fk:
                problems.append(f"{len(fk)} foreign key violation(s)")
            rev = MigrationContext.configure(conn).get_current_revision()
            if rev != head_revision(settings):
                problems.append(f"schema revision {rev} is not head {head_revision(settings)}")
            ctx = MigrationContext.configure(conn, opts={"compare_type": True, "render_as_batch": True})
            diff = compare_metadata(ctx, Base.metadata)
            if diff:
                problems.append(f"{len(diff)} difference(s) between models and migrations")
        return {"ok": not problems, "problems": problems, "revision": rev}
    finally:
        engine.dispose()


def status(settings: Settings) -> dict:
    if not settings.db_path.exists():
        return {"database": str(settings.db_path), "exists": False}
    engine = create_engine(settings.database_url)
    try:
        insp = inspect(engine)
        counts = {}
        with engine.connect() as conn:
            for table in sorted(insp.get_table_names()):
                if table == "alembic_version":
                    continue
                counts[table] = conn.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar()
        return {"database": str(settings.db_path), "exists": True, "revision": current_revision(settings), "head": head_revision(settings), "rows": counts}
    finally:
        engine.dispose()


def main(argv=None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(prog="python -m database.manage")
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("setup", "upgrade", "backup", "status", "verify", "seed-demo"):
        sub.add_parser(name)
    hist = sub.add_parser("seed-footfall-history")
    hist.add_argument("--days", type=int, default=7)
    rest = sub.add_parser("restore")
    rest.add_argument("file")
    cat = sub.add_parser("seed-demo-catalog")
    cat.add_argument("--store", default="store-blr-104")
    smap = sub.add_parser("seed-store-map")
    smap.add_argument("--store", default="store-blr-104")
    smap.add_argument("--replace", action="store_true", help="write a NEW layout version (the previous one is kept, inactive)")
    args = parser.parse_args(argv)

    settings = get_settings()
    if args.cmd in ("setup", "upgrade"):
        print(upgrade(settings))
    elif args.cmd == "backup":
        print(backup_database(settings) or "no database to back up")
    elif args.cmd == "restore":
        print(restore(settings, Path(args.file)))
    elif args.cmd == "status":
        import json

        print(json.dumps(status(settings), indent=2))
    elif args.cmd == "verify":
        result = verify(settings)
        print(result)
        return 0 if result["ok"] else 1
    elif args.cmd == "seed-demo":
        from database.seed import seed_demo

        print(seed_demo(settings))
    elif args.cmd == "seed-footfall-history":
        from database.seed import seed_footfall_history

        print(seed_footfall_history(settings, args.days))
    elif args.cmd == "seed-demo-catalog":
        from database.seed_customer import seed_demo_catalog

        print(seed_demo_catalog(settings, args.store))
    elif args.cmd == "seed-store-map":
        from database.seed_customer import seed_store_map

        print(seed_store_map(settings, args.store, args.replace))
    return 0


if __name__ == "__main__":
    sys.exit(main())
