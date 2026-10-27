"""WebSocket feed /ws/stores/{id}/events - one connection per browser tab, one envelope for every event.

Protocol (server -> client): hello -> snapshot -> [replayed events | resync] -> live events, with a heartbeat every
HEARTBEAT_SECONDS. A client reconnects with ?since=<last seq>&epoch=<epoch> to recover what it missed.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.events import event_bus
from core.network import is_loopback
from database.models import Store
from services.realtime import HEARTBEAT_SECONDS, control, hello, snapshot

router = APIRouter(tags=["events"])
log = logging.getLogger("retailedge.ws")


AUDIENCES = {
    # What a REMOTE (LAN phone) client may receive. Loopback clients (the admin app on this machine) get everything.
    "staff": ("task.", "alert.", "attendance.", "shift.", "staff.", "queue.", "shelf.updated", "inventory.", "customer.assistance.", "recommendation."),
    "customer": ("queue.updated", "customer.assistance.updated", "shelf.updated"),
}


def _allowed(event_type: str, audience: Optional[str]) -> bool:
    if audience is None:
        return True
    return any(event_type == p or (p.endswith(".") and event_type.startswith(p)) for p in AUDIENCES[audience]) or event_type in ("hello", "snapshot", "heartbeat", "resync")


def _view(event: dict, audience: Optional[str]) -> Optional[dict]:
    """What the given audience actually receives (None = nothing). Shoppers never see counts, camera ids or internal task ids."""
    if not _allowed(event["type"], audience):
        return None
    if audience != "customer":
        return event
    payload = event.get("payload") or {}
    if event["type"] == "shelf.updated":
        return {**event, "type": "customer.availability.changed", "payload": {"shelfId": payload.get("shelfId"), "occurredAt": payload.get("occurredAt")}}
    if event["type"] == "customer.assistance.updated":
        return {**event, "payload": {"requestId": payload.get("requestId"), "status": payload.get("status")}}
    return event


@router.websocket("/ws/stores/{store_id}/events")
async def store_events(websocket: WebSocket, store_id: str, since: Optional[int] = None, epoch: Optional[str] = None, audience: Optional[str] = None):
    db = websocket.app.state.db
    settings = websocket.app.state.settings
    with db.transaction() as session:
        store = session.get(Store, store_id)
        known = store is not None
        snap = snapshot(session, settings, store) if store is not None else None
    if not known:
        await websocket.close(code=4404, reason="Unknown store")
        return

    remote = websocket.client is None or not is_loopback(websocket.client.host)
    if remote and audience not in AUDIENCES:
        await websocket.close(code=4403, reason="Remote clients must declare audience=staff or audience=customer")
        return
    audience = audience if remote else None
    if remote:
        snap = {"epoch": snap["epoch"], "seq": snap["seq"], "dataMode": snap["dataMode"]}  # no operational counters for phones
    await websocket.accept()
    queue = event_bus.subscribe(store_id)  # subscribe first so nothing published during replay is lost
    log.info("ws connected", extra={"store_id": store_id})
    try:
        replay, missed = "none", None
        if since is not None:
            same_run = epoch == event_bus.epoch
            missed = event_bus.since(store_id, since) if same_run else None
            replay = "replayed" if missed is not None else "resync"
        await websocket.send_json(hello(store_id, replay))
        await websocket.send_json(control(store_id, "snapshot", snap))
        sent = set()
        if replay == "replayed":
            for ev in missed or []:
                sent.add(ev["eventId"])
                out = _view(ev, audience)
                if out is not None:
                    await websocket.send_json(out)
        elif replay == "resync":
            await websocket.send_json(control(store_id, "resync", {"reason": "missed events are no longer buffered or the server restarted; refetch page data"}))
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
            except asyncio.TimeoutError:
                event = control(store_id, "heartbeat", {"epoch": event_bus.epoch})
            if event["eventId"] in sent:
                sent.discard(event["eventId"])
                continue
            out = _view(event, audience)
            if out is not None:
                await websocket.send_json(out)
    except WebSocketDisconnect:
        pass
    finally:
        event_bus.unsubscribe(store_id, queue)
        log.info("ws disconnected", extra={"store_id": store_id})
