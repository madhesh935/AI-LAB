"""Central exception types and handlers. Every error uses one JSON envelope."""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, OperationalError, SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from core.logging import request_id_ctx

log = logging.getLogger("retailedge.errors")


class AppError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str, details: Optional[Any] = None):
        super().__init__(message)
        self.message = message
        self.details = details


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"

    def __init__(self, resource: str, identifier: Any):
        super().__init__(f"{resource} '{identifier}' was not found")


class ConflictError(AppError):
    status_code = 409
    code = "conflict"


class InvalidStateError(AppError):
    status_code = 409
    code = "invalid_state"


class ServiceUnavailableError(AppError):
    status_code = 503
    code = "service_unavailable"


def _envelope(status: int, code: str, message: str, details: Any = None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": details,
                "requestId": request_id_ctx.get(),
            }
        },
    )


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        return _envelope(exc.status_code, exc.code, exc.message, exc.details)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        details = [
            {"field": ".".join(str(p) for p in err["loc"] if p != "body"), "message": err["msg"], "type": err["type"]}
            for err in exc.errors()
        ]
        return _envelope(422, "validation_error", "Request validation failed", details)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException):
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        return _envelope(exc.status_code, code, str(exc.detail))

    @app.exception_handler(IntegrityError)
    async def _integrity(_: Request, exc: IntegrityError):
        log.warning("integrity error", extra={"error": str(exc.orig)})
        return _envelope(409, "integrity_error", "The change conflicts with existing data")

    @app.exception_handler(OperationalError)
    async def _operational(_: Request, exc: OperationalError):
        log.error("database operational error", extra={"error": str(exc.orig)})
        return _envelope(503, "database_unavailable", "The database is temporarily unavailable")

    @app.exception_handler(SQLAlchemyError)
    async def _sqlalchemy(_: Request, exc: SQLAlchemyError):
        log.exception("database error")
        return _envelope(500, "database_error", "A database error occurred")

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        log.exception("unhandled exception")
        return _envelope(500, "internal_error", "An unexpected error occurred")


class ConfirmationRequiredError(AppError):
    """Destructive operations must be called with ?confirm=true."""

    status_code = 428
    code = "confirmation_required"

    def __init__(self, what: str):
        super().__init__(f"Deleting {what} is permanent. Repeat the request with confirm=true to proceed.")


class InvalidSourceError(AppError):
    """The camera source (device index, URL or file path) failed validation."""

    status_code = 422
    code = "invalid_source"
