"""Network exposure control for the unauthenticated demo deployment.

* Default: the API binds to loopback and everything is reachable only from this machine.
* LAN demo (RETAILEDGE_ALLOW_LAN=true): phones on a controlled network may use ONLY the Staff and Customer PWA surface (an explicit allowlist);
  management endpoints (camera/analytics configuration, ingest, vision control, reports, copilot, employee/shift/attendance admin,
  queue/occupancy controls, ...) stay loopback-only. Remote clients must also come from an allowed private CIDR.

THIS IS NOT AUTHENTICATION. It narrows the network surface; it cannot tell one phone on the LAN from another, so anyone on the allowed
network can act as any staff member or customer. Use a network you control.
"""

from __future__ import annotations

import ipaddress
import json
import re
from typing import Iterable, List, Optional, Pattern, Sequence, Tuple

DEFAULT_LAN_CIDRS = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "fe80::/10", "fd00::/8"]
LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}

# (methods, path regex) a REMOTE client may call. Everything else needs loopback.
REMOTE_ALLOW: List[Tuple[Optional[Sequence[str]], Pattern[str]]] = [
    (("GET", "OPTIONS"), re.compile(r"^/api/public/")),
    (None, re.compile(r"^/api/customer/")),
    (("GET", "OPTIONS"), re.compile(r"^/api/staff/me(/|$)")),
    (("POST", "OPTIONS"), re.compile(r"^/api/staff/me/(check-in|check-out)$")),
    (("GET", "OPTIONS"), re.compile(r"^/api/stores/[^/]+/staff$")),  # employee picker of the Staff PWA (demo context, not login)
    (("GET", "OPTIONS"), re.compile(r"^/api/stores/[^/]+/tasks$")),
    (("GET", "OPTIONS"), re.compile(r"^/api/tasks/[^/]+(/history)?$")),
    (("POST", "OPTIONS"), re.compile(r"^/api/tasks/[^/]+/(accept|start|on-the-way|complete|report-issue)$")),
    (("GET", "OPTIONS"), re.compile(r"^/api/health$")),
    (None, re.compile(r"^/ws/stores/[^/]+/events$")),  # audience-filtered by the WebSocket handler
]
_COMPILED = REMOTE_ALLOW


def is_loopback(host: Optional[str]) -> bool:
    return host in LOOPBACK


def in_networks(host: Optional[str], cidrs: Iterable[str]) -> bool:
    if not host:
        return False
    try:
        addr = ipaddress.ip_address(host.split("%")[0])
    except ValueError:
        return False
    return any(addr in ipaddress.ip_network(c, strict=False) for c in cidrs)


def remote_allowed(method: str, path: str) -> bool:
    return any((methods is None or method in methods) and rx.match(path) for methods, rx in _COMPILED)


class LanGuardMiddleware:
    """Pure ASGI middleware (also covers WebSockets)."""

    def __init__(self, app, allow_lan: bool, cidrs: Sequence[str]):
        self.app, self.allow_lan, self.cidrs = app, allow_lan, list(cidrs or DEFAULT_LAN_CIDRS)

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        client = scope.get("client")
        host = client[0] if client else None
        if is_loopback(host):
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        method = scope.get("method", "GET")
        ok = self.allow_lan and in_networks(host, self.cidrs) and remote_allowed(method if scope["type"] == "http" else "GET", path)
        if ok:
            return await self.app(scope, receive, send)
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 4403})
            return
        body = json.dumps({"error": {"code": "lan_restricted", "message": "This endpoint is only reachable from the machine that runs RetailEdge", "details": None,
                                     "requestId": "-"}}).encode()
        await send({"type": "http.response.start", "status": 403, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})
