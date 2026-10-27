"""Vision worker entry point:  python -m vision

One worker per machine: the HTTP port doubles as the single-instance lock, and the process is
never started by the API's autoreloader, so hot reloads cannot create duplicate workers.
"""

from __future__ import annotations

import argparse
import logging
import os
import socket
import sys
import threading
import uuid

import uvicorn

from core.config import get_settings
from core.logging import configure_logging
from database.connection import Database


def _port_in_use(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m vision", description="RetailEdge vision worker")
    ap.add_argument("--device", default=os.environ.get("RETAILEDGE_VISION_DEVICE", "auto"), help="auto | cpu | cuda:0")
    ap.add_argument("--no-models", action="store_true", help="start without loading models (streams video only)")
    args = ap.parse_args(argv)

    settings = get_settings()
    configure_logging(settings.log_level, settings.log_json)
    log = logging.getLogger("retailedge.vision")
    if settings.vision_worker_host not in ("127.0.0.1", "localhost", "::1") and not settings.allow_lan:
        log.error("refusing to bind the video gateway to %s without RETAILEDGE_ALLOW_LAN=true", settings.vision_worker_host)
        return 2
    if _port_in_use(settings.vision_worker_host, settings.vision_worker_port):
        log.error("a vision worker (or another service) already listens on %s:%s - not starting a duplicate",
                  settings.vision_worker_host, settings.vision_worker_port)
        return 3

    from database import manage

    manage.upgrade(settings)  # no-op when the API already migrated

    from vision.device import select_device
    from vision.engine import VisionEngine
    from vision.outbox import EventOutbox
    from vision.persistence import WorkerStore
    from vision.registry import ModelRegistry
    from vision.server import create_worker_app

    device = select_device(args.device)
    worker_id = uuid.uuid4().hex[:12]
    db = Database(settings.database_url, settings.sqlite_busy_timeout_ms)
    store = WorkerStore(db, {"inference_fps": settings.vision_inference_fps, "stream_fps": settings.vision_stream_fps,
                             "stream_width": settings.vision_stream_width})
    outbox = EventOutbox(settings.api_internal_url, worker_id)
    holder: dict = {}
    registry = ModelRegistry.from_file(device, on_status=lambda e: holder["engine"].on_model_status(e))
    engine = holder["engine"] = VisionEngine(settings, registry, store, outbox, worker_id, device)
    log.info("vision worker %s starting on %s (device=%s)", worker_id, f"{settings.vision_worker_host}:{settings.vision_worker_port}", device)

    outbox.start()
    engine.start()
    if not args.no_models:
        threading.Thread(target=registry.load_all, name="model-loader", daemon=True).start()
    app = create_worker_app(engine, settings)
    try:
        uvicorn.run(app, host=settings.vision_worker_host, port=settings.vision_worker_port, log_config=None, access_log=False)
    finally:
        engine.stop()
        db.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main())
