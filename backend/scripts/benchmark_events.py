"""SQLite write performance of the central event engine (real engine, real database file, temp directory).

    python scripts/benchmark_events.py [--events 6000] [--batch 100]

Sends batches of realistic worker events (crossings, zone visits, queue updates, shelf observations, heatmap flushes) through
EventEngine.process() on a freshly migrated WAL database and reports events/second and batch latency percentiles. Also measures the
concurrent-reader case (an API-style SELECT loop while the engine writes) to show WAL does not block readers."""

from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sqlalchemy import func, select  # noqa: E402

from core.config import Settings  # noqa: E402
from database import manage  # noqa: E402
from database.connection import Database  # noqa: E402
from database.models import Camera, CameraZone, CheckoutCounter, FootfallEvent, QueueRegion, Shelf, Store  # noqa: E402
from services.event_engine import MEMORY, EventEngine  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--events", type=int, default=6000)
    ap.add_argument("--batch", type=int, default=100)
    args = ap.parse_args()
    tmp = Path(tempfile.mkdtemp(prefix="retailedge-evbench-"))
    settings = Settings(data_dir=tmp / "data", log_json=False, log_level="WARNING")
    manage.upgrade(settings)
    db = Database(settings.database_url)
    with db.transaction() as s:
        s.add(Store(id="b", code="B", name="B", max_capacity=100, edge_server_status="disconnected"))
        s.flush()
        s.add(Camera(id="cam", store_id="b", camera_code="C", name="C", camera_type="aisle"))
        s.flush()
        s.add(CameraZone(id="line", store_id="b", camera_id="cam", name="l", zone_type="entrance", polygon=[], line={"p1": [0, 0.5], "p2": [1, 0.5], "inSide": "positive"}))
        s.add(CameraZone(id="zone", store_id="b", camera_id="cam", name="z", zone_type="aisle", polygon=[[0, 0], [1, 0], [1, 1]]))
        s.add(CheckoutCounter(id="cnt", store_id="b", name="C", counter_type="standard", status="open", camera_id="cam"))
        s.add(Shelf(id="shf", store_id="b", shelf_code="S", capacity_units=10, camera_id="cam"))
        s.flush()
        s.add(QueueRegion(counter_id="cnt", store_id="b", camera_id="cam", queue_polygon=[[0, 0], [1, 0], [1, 1]]))
    rnd = random.Random(0)
    now = datetime.now(timezone.utc)

    def make(i: int):
        at = now - timedelta(seconds=args.events - i)
        kind = rnd.choices(["cross", "visit", "queue", "shelf", "heat"], [20, 25, 30, 20, 5])[0]
        base = {"eventId": uuid.uuid4().hex, "seq": i, "storeId": "b", "cameraId": "cam", "timestamp": at.isoformat()}
        if kind == "cross":
            return {**base, "type": "footfall.crossing", "payload": {"lineId": "line", "direction": rnd.choice(["in", "out"]), "trackRef": i, "occurredAt": at.isoformat()}}
        if kind == "visit":
            return {**base, "type": "zone.visit", "payload": {"cameraZoneId": "zone", "trackRef": i, "enteredAt": (at - timedelta(seconds=20)).isoformat(), "exitedAt": at.isoformat(), "dwellSeconds": 20.0}}
        if kind == "queue":
            return {**base, "type": "queue.updated", "payload": {"counterId": "cnt", "length": rnd.randint(0, 6), "rawLength": 3, "inService": 1, "arrivalRatePerMin": 1.5,
                                                                    "serviceRatePerMin": 2.0, "congestion": "optimal", "reliable": True}}
        if kind == "shelf":
            return {**base, "type": "shelf.observation", "payload": {"shelfId": "shf", "status": "in_stock", "rawStatus": "in_stock", "changed": False, "count": 8, "perClass": {"a": 8},
                                                                        "availabilityPct": 80.0, "expectedUnits": 10, "observedAt": at.isoformat(), "boxes": [["a", 0.9, 0.1, 0.1, 0.1, 0.1]] * 8}}
        return {**base, "type": "heatmap.flush", "payload": {"bucketStart": at.isoformat(), "gridW": 32, "gridH": 18, "cells": [[rnd.randrange(32), rnd.randrange(18), 3] for _ in range(40)]}}

    events = [make(i) for i in range(args.events)]
    reader_lat = []
    stop = threading.Event()

    def reader():
        rdb = Database(settings.database_url)
        while not stop.is_set():
            t = time.perf_counter()
            with rdb.session() as s:
                s.scalar(select(func.count()).select_from(FootfallEvent))
            reader_lat.append((time.perf_counter() - t) * 1000)
            time.sleep(0.005)
        rdb.dispose()

    th = threading.Thread(target=reader, daemon=True)
    th.start()
    lat, rejected = [], 0
    t_all = time.perf_counter()
    for i in range(0, len(events), args.batch):
        chunk = events[i:i + args.batch]
        t = time.perf_counter()
        with db.transaction() as s:
            res = EventEngine(s, settings).process(chunk)
        lat.append((time.perf_counter() - t) * 1000)
        rejected += len(res.rejected)
    total = time.perf_counter() - t_all
    stop.set()
    th.join(2)
    db_mb = round(settings.db_path.stat().st_size / 2**20, 1)
    print(json.dumps({
        "events": args.events, "batch": args.batch, "seconds": round(total, 2), "events_per_second": round(args.events / total), "rejected": rejected,
        "batch_latency_ms": {"p50": round(statistics.median(lat), 1), "p95": round(sorted(lat)[int(len(lat) * 0.95) - 1], 1), "max": round(max(lat), 1)},
        "reader_query_ms_during_writes": {"samples": len(reader_lat), "p50": round(statistics.median(reader_lat), 2), "p99": round(sorted(reader_lat)[int(len(reader_lat) * 0.99) - 1], 2), "max": round(max(reader_lat), 1)},
        "db_size_mb": db_mb, "journal_mode": db.pragma("journal_mode"),
        "worker_event_rate_reference": "2 cameras x (queue.updated every 5 s + zone events) is well under 5 events/s; Phase-2 camera.frame events are not persisted",
    }, indent=1))
    MEMORY.reset()
    db.dispose()


if __name__ == "__main__":
    main()
