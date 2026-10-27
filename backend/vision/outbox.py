"""Non-blocking delivery of detection metadata to the API (loopback HTTP) for WebSocket fan-out.

Bounded queue: when the API is slow or down the oldest events are dropped and counted, so the
capture/inference loops never block on the network.
"""

from __future__ import annotations

import itertools
import json
import logging
import queue
import threading
import time
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from vision.schemas import VisionEvent, VisionEventBatch

log = logging.getLogger("retailedge.vision.outbox")


class EventOutbox(threading.Thread):
    def __init__(self, api_url: str, worker_id: str, maxsize: int = 2000):
        super().__init__(daemon=True, name="event-outbox")
        self.url = api_url.rstrip("/") + "/api/internal/vision/events"
        self.worker_id = worker_id
        self._q: "queue.Queue[VisionEvent]" = queue.Queue(maxsize=maxsize)
        self._seq = itertools.count(1)
        self._halt = threading.Event()
        self.sent = 0
        self.dropped = 0
        self.last_error: Optional[str] = None

    def emit(self, type_: str, store_id: str, camera_id: Optional[str], payload: Dict[str, Any], at: Optional[datetime] = None) -> None:
        """`at` = the SOURCE time the event happened (frame capture time); defaults to now."""
        ev = VisionEvent(
            event_id=uuid.uuid4().hex, seq=next(self._seq), type=type_, store_id=store_id,
            camera_id=camera_id, timestamp=at or datetime.now(timezone.utc), payload=payload,
        )
        try:
            self._q.put_nowait(ev)
        except queue.Full:
            try:
                self._q.get_nowait()
            except queue.Empty:
                pass
            self.dropped += 1
            try:
                self._q.put_nowait(ev)
            except queue.Full:
                self.dropped += 1

    def run(self) -> None:
        while not self._halt.is_set():
            try:
                batch = [self._q.get(timeout=0.25)]
            except queue.Empty:
                continue
            time.sleep(0.08)  # let the other cameras' events of the same moment join, so a request carries a handful of events instead of one
            while len(batch) < 100:
                try:
                    batch.append(self._q.get_nowait())
                except queue.Empty:
                    break
            self._post(batch)

    def _post(self, events: list) -> None:
        body = VisionEventBatch(worker_id=self.worker_id, events=events).model_dump_json(by_alias=True).encode()
        req = urllib.request.Request(self.url, data=body, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=3) as resp:
                resp.read()
            self.sent += len(events)
            self.last_error = None
        except Exception as exc:  # noqa: BLE001
            keep = [e for e in events if e.type != "camera.frame"]  # a stale video-overlay frame is worthless, a crossing or queue event is not
            for e in keep:
                try:
                    self._q.put_nowait(e)
                except queue.Full:
                    break
            self.dropped += len(events) - len(keep)
            msg = f"{type(exc).__name__}: {exc}"
            if msg != self.last_error:  # log each distinct failure once, not per batch
                log.warning("event delivery to API failed: %s", msg)
            self.last_error = msg
            time.sleep(1.0)

    def stop(self) -> None:
        self._halt.set()
