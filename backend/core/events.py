"""
In-process event bus feeding the /ws/stores/{id}/events WebSocket - ONE envelope for every event.

    {"eventId": "...", "seq": 123, "storeId": "...", "type": "task.created", "timestamp": "2026-..Z",
     "source": "api|vision|system", "payload": {...}}

* `seq` is per store and strictly increasing; a bounded ring buffer lets a reconnecting client replay what it missed
  (`?since=<seq>`), or learn that the gap is too large and must refetch (`resync`).
* `epoch` identifies this process run: a changed epoch tells a client the server restarted (sequence restarted) => full refetch.
* Legacy UPPER_SNAKE names used by older services are normalised to dotted lower-case (TASK_CREATED -> task.created).
Events are best-effort, ephemeral notifications - the database remains the source of truth.
"""

from __future__ import annotations

import asyncio
import re
import threading
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional, Tuple

RING_SIZE = 1000
_LEGACY = re.compile(r"^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$")


def canonical_type(event_type: str) -> str:
    """TASK_CREATED -> task.created ; ANALYTICS_CONFIG_UPDATED -> analytics.config_updated ; already-dotted names pass through."""
    if _LEGACY.match(event_type):
        head, _, tail = event_type.partition("_")
        return f"{head.lower()}.{tail.lower()}"
    return event_type


class EventBus:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subs: Dict[str, List[Tuple[asyncio.AbstractEventLoop, asyncio.Queue]]] = {}
        self._seq: Dict[str, int] = {}
        self._ring: Dict[str, Deque[Dict[str, Any]]] = {}
        self.epoch = uuid.uuid4().hex[:12]

    # ------------------------------------------------------------------ subscribe
    def subscribe(self, store_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=500)
        loop = asyncio.get_running_loop()
        with self._lock:
            self._subs.setdefault(store_id, []).append((loop, queue))
        return queue

    def unsubscribe(self, store_id: str, queue: asyncio.Queue) -> None:
        with self._lock:
            self._subs[store_id] = [s for s in self._subs.get(store_id, []) if s[1] is not queue]

    # ------------------------------------------------------------------ publish
    def publish(self, store_id: str, event_type: str, payload: Dict[str, Any], source: str = "api",
                event_id: Optional[str] = None, occurred_at: Optional[datetime] = None) -> Dict[str, Any]:
        with self._lock:
            seq = self._seq.get(store_id, 0) + 1
            self._seq[store_id] = seq
            event = {
                "eventId": event_id or uuid.uuid4().hex,
                "seq": seq,
                "storeId": store_id,
                "type": canonical_type(event_type),
                "timestamp": (occurred_at or datetime.now(timezone.utc)).isoformat(),
                "source": source,
                "payload": payload,
            }
            self._ring.setdefault(store_id, deque(maxlen=RING_SIZE)).append(event)
            targets = list(self._subs.get(store_id, []))
        for loop, queue in targets:
            try:
                loop.call_soon_threadsafe(self._offer, queue, event)
            except RuntimeError:
                pass  # loop closed
        return event

    @staticmethod
    def _offer(queue: asyncio.Queue, event: Dict[str, Any]) -> None:
        if queue.full():
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
        queue.put_nowait(event)

    # ------------------------------------------------------------------ recovery
    def current_seq(self, store_id: str) -> int:
        with self._lock:
            return self._seq.get(store_id, 0)

    def since(self, store_id: str, last_seq: int) -> Optional[List[Dict[str, Any]]]:
        """Events with seq > last_seq, or None when the ring no longer covers the gap (client must refetch)."""
        with self._lock:
            ring = self._ring.get(store_id)
            cur = self._seq.get(store_id, 0)
            if last_seq > cur:
                return None  # client is ahead of us: the server restarted
            if last_seq == cur:
                return []
            if not ring or ring[0]["seq"] > last_seq + 1:
                return None
            return [e for e in ring if e["seq"] > last_seq]

    def subscriber_count(self) -> int:
        with self._lock:
            return sum(len(v) for v in self._subs.values())

    def reset(self) -> None:
        """Tests only."""
        with self._lock:
            self._seq.clear()
            self._ring.clear()
            self.epoch = uuid.uuid4().hex[:12]


event_bus = EventBus()
