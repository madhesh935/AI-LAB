"""
Bounds for mutating requests. The API is unauthenticated, so mutations are
size-limited and rate-limited per client address to contain accidents and
runaway scripts. This is NOT a security boundary.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Deque, Dict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from core.logging import request_id_ctx

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
INTERNAL_PREFIX = "/api/internal/vision/"


class MutationLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, per_minute: int, max_body_bytes: int):
        super().__init__(app)
        self.per_minute = per_minute
        self.max_body = max_body_bytes
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next):
        # The vision worker posts detection batches many times a second; throttling it would silently drop counts, and the route is only reachable from this machine / the trusted LAN (core/network.py).
        if request.method in MUTATING and not request.url.path.startswith(INTERNAL_PREFIX):
            length = request.headers.get("content-length")
            if length and length.isdigit() and int(length) > self.max_body:
                return self._reject(413, "payload_too_large", "Request body is too large")

            client = request.client.host if request.client else "unknown"
            now = time.monotonic()
            window = self._hits[client]
            while window and now - window[0] > 60:
                window.popleft()
            if len(window) >= self.per_minute:
                return self._reject(429, "rate_limited", "Too many write requests; slow down")
            window.append(now)
        return await call_next(request)

    @staticmethod
    def _reject(status: int, code: str, message: str) -> JSONResponse:
        return JSONResponse(
            status_code=status,
            content={"error": {"code": code, "message": message, "details": None, "requestId": request_id_ctx.get()}},
        )
