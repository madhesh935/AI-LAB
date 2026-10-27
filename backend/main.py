"""
RetailEdge AI backend - application factory.

    python run.py                          # development server (127.0.0.1:8000)
    uvicorn main:app --host 127.0.0.1      # equivalent

The original single-file, in-memory prototype has been removed.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api import (
    alerts, cameras, copilot, customer, events, ingest, insights, inventory,
    queues, reports, shoppers, staff, stores, system, tasks, vision, analytics, workforce,
)
from core.config import Settings, get_settings
from core.errors import register_exception_handlers
from core.limits import MutationLimitMiddleware
from core.network import LanGuardMiddleware
from core.logging import RequestContextMiddleware, configure_logging
from database.connection import Database

log = logging.getLogger("retailedge")


def create_app(settings: Optional[Settings] = None, database: Optional[Database] = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        configure_logging(settings.log_level, settings.log_json)
        if settings.auto_migrate:
            from database import manage

            result = manage.upgrade(settings)
            log.info("database ready", extra=result)
        app.state.db = database or Database(settings.database_url, settings.sqlite_busy_timeout_ms)
        from copilot.engine import CopilotEngine

        app.state.copilot = CopilotEngine(settings, app.state.db)
        from copilot.customer_engine import CustomerCopilot

        app.state.customer_copilot = CustomerCopilot(settings, app.state.db, app.state.copilot.provider)
        log.info("startup complete", extra={"db": str(settings.db_path), "host": settings.host})
        try:
            yield
        finally:
            app.state.db.dispose()
            log.info("shutdown complete")

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description=(
            "Backend for RetailEdge AI. NO AUTHENTICATION: intended for a controlled local "
            "demonstration; bound to localhost by default."
        ),
        lifespan=lifespan,
    )
    app.state.settings = settings

    # Middleware order: last added runs first.
    app.add_middleware(MutationLimitMiddleware, per_minute=settings.mutation_rate_limit_per_minute, max_body_bytes=settings.max_request_body_bytes)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )
    app.add_middleware(LanGuardMiddleware, allow_lan=settings.allow_lan, cidrs=settings.lan_allowed_cidrs)  # outermost: runs first
    register_exception_handlers(app)

    for router in (
        system.router,
        stores.router,
        shoppers.router,
        inventory.router,
        queues.router,
        cameras.router,
        alerts.store_router,
        alerts.router,
        tasks.store_router,
        tasks.router,
        staff.store_router,
        staff.router,
        insights.router,
        reports.router,
        reports.config_router,
        copilot.router,
        customer.public,
        customer.router,
        customer.store,
        ingest.router,
        events.router,
        vision.router,
        analytics.router,
        workforce.store_router,
        workforce.router,
    ):
        app.include_router(router)
    # Shopper catalog photos live with the PWA. Serving them here lets an API-prefixed image URL work too.
    products_dir = Path(__file__).resolve().parent.parent / "public" / "products"
    if products_dir.is_dir():
        app.mount("/products", StaticFiles(directory=products_dir), name="product-images")
    return app


app = create_app()
