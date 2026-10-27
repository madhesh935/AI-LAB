"""Per-camera analytics runtime: tracks -> footfall / zone / dwell / heatmap / queue events.

Pure logic around `analytics.*` (no torch / OpenCV / database): the worker feeds it each inference step's tracked people and
posts the returned events to the API's central event engine. Configuration (zones, lines, queue regions) is data loaded from
SQLite; nothing about a camera's geometry is hardcoded here.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Tuple

from analytics.footfall import LineConfig, LineCounter
from analytics.geometry import reference_point
from analytics.heatmap import HeatmapGrid
from analytics.queue import QueueMonitor, QueueRegionCfg
from analytics.shelf import ShelfCfg, Slot
from analytics.zones import ZoneConfig, ZoneTracker

QUEUE_EMIT_SECONDS = 5.0
HEATMAP_FLUSH_SECONDS = 30.0
ZONE_OCC_MIN_INTERVAL = 1.0


@dataclass
class ShelfRuntimeCfg:
    cfg: ShelfCfg
    camera_id: str
    interval_seconds: float
    slots: List[Slot] = field(default_factory=list)


@dataclass
class CameraAnalyticsConfig:
    camera_id: str
    lines: List[LineConfig] = field(default_factory=list)
    zones: List[ZoneConfig] = field(default_factory=list)
    queues: List[QueueRegionCfg] = field(default_factory=list)
    shelves: List[ShelfRuntimeCfg] = field(default_factory=list)
    digest: str = ""
    names: Dict[str, str] = field(default_factory=dict)  # zone / line / counter / shelf id -> display name (for the live overlay only)
    kinds: Dict[str, str] = field(default_factory=dict)  # camera-zone id -> zone type (entrance / aisle / checkout / ...), for the live overlay only

    @property
    def has_people_analytics(self) -> bool:
        return bool(self.lines or self.zones or self.queues)

    def summary(self) -> Dict[str, int]:
        return {"lines": len(self.lines), "zones": len(self.zones), "queues": len(self.queues), "shelves": len(self.shelves)}


def digest_of(*parts: Any) -> str:
    return hashlib.sha1(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:16]


@dataclass
class TrackIn:
    track_id: int
    x: float  # normalised bbox
    y: float
    w: float
    h: float
    age_frames: int


class CameraAnalytics:
    def __init__(self, cfg: CameraAnalyticsConfig):
        self.cfg = cfg
        self.counters = [LineCounter(c) for c in cfg.lines]
        self.zones = ZoneTracker(cfg.zones) if cfg.zones else None
        self.queue = QueueMonitor(cfg.queues) if cfg.queues else None
        self.heat = HeatmapGrid() if (cfg.zones or cfg.queues or cfg.lines) else None
        self._last_counts: Optional[Dict[str, int]] = None
        self._last_occ_emit: Optional[datetime] = None
        self._last_queue_emit: Optional[datetime] = None
        self._last_heat_flush: Optional[datetime] = None
        self.emitted: Dict[str, int] = {}

    # ------------------------------------------------------------------ main step
    def process(self, tracks: Sequence[TrackIn], at: datetime) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        pts = [(t, reference_point(t.x, t.y, t.w, t.h)) for t in tracks]

        for counter in self.counters:
            for t, pt in pts:
                c = counter.update(t.track_id, pt, at, t.age_frames)
                if c is not None:
                    out.append(self._ev("footfall.crossing", {"lineId": c.line_id, "direction": c.direction, "trackRef": c.track_id,
                                                              "occurredAt": c.at.isoformat()}, at))
            counter.expire(at)

        if self.zones is not None:
            for t, pt in pts:
                visits, transitions = self.zones.update(t.track_id, pt, at)
                for v in visits:
                    out.append(self._ev("zone.visit", {"cameraZoneId": v.zone_id, "trackRef": v.track_id, "enteredAt": v.entered_at.isoformat(),
                                                       "exitedAt": v.exited_at.isoformat(), "dwellSeconds": round(v.dwell_seconds, 2)}, at))
                for tr in transitions:
                    out.append(self._ev("zone.transition", {"fromZoneId": tr.from_zone, "toZoneId": tr.to_zone, "trackRef": tr.track_id,
                                                            "occurredAt": tr.at.isoformat()}, at))
            for v in self.zones.expire(at):
                out.append(self._ev("zone.visit", {"cameraZoneId": v.zone_id, "trackRef": v.track_id, "enteredAt": v.entered_at.isoformat(),
                                                   "exitedAt": v.exited_at.isoformat(), "dwellSeconds": round(v.dwell_seconds, 2),
                                                   "exitInferred": True}, at))
            counts = self.zones.occupancy()
            if counts != self._last_counts and (self._last_occ_emit is None or (at - self._last_occ_emit).total_seconds() >= ZONE_OCC_MIN_INTERVAL):
                self._last_counts, self._last_occ_emit = dict(counts), at
                out.append(self._ev("zone.occupancy", {"counts": counts}, at))

        if self.heat is not None:
            for t, (x, y) in pts:
                self.heat.add(t.track_id, x, y, at)
            if self._last_heat_flush is None:
                self._last_heat_flush = at
            elif (at - self._last_heat_flush).total_seconds() >= HEATMAP_FLUSH_SECONDS:
                out.extend(self._flush_heatmap(at))
                self.heat.forget_old_tracks(at)

        if self.queue is not None:
            for qe in self.queue.update([(t.track_id, pt) for t, pt in pts], at) + self.queue.expire(at):
                if qe.kind == "service_complete":
                    out.append(self._ev("queue.service", {"counterId": qe.counter_id, "serviceSeconds": round(qe.service_seconds or 0.0, 2),
                                                          "waitSeconds": round(qe.wait_seconds, 2) if qe.wait_seconds is not None else None,
                                                          "completedAt": qe.at.isoformat()}, at))
            if self._last_queue_emit is None or (at - self._last_queue_emit).total_seconds() >= QUEUE_EMIT_SECONDS:
                self._last_queue_emit = at
                for r in self.cfg.queues:
                    s = self.queue.snapshot(r.counter_id, at)
                    out.append(self._ev("queue.updated", {
                        "counterId": s.counter_id, "length": s.length, "rawLength": s.raw_length, "inService": s.in_service,
                        "arrivalRatePerMin": s.arrival_rate_per_min, "serviceRatePerMin": s.service_rate_per_min,
                        "congestion": s.congestion, "reliable": s.reliable}, at))
        return out

    def _flush_heatmap(self, at: datetime) -> List[Dict[str, Any]]:
        assert self.heat is not None
        self._last_heat_flush = at
        cells = self.heat.drain()
        if not cells:
            return []
        return [self._ev("heatmap.flush", {"bucketStart": at.isoformat(), "gridW": self.heat.grid_w, "gridH": self.heat.grid_h,
                                           "cells": [[gx, gy, n] for (gx, gy), n in sorted(cells.items())]}, at)]

    def flush(self, at: datetime) -> List[Dict[str, Any]]:
        """Called on shutdown / reload so counted samples are not lost."""
        return self._flush_heatmap(at) if self.heat is not None else []

    def reset(self) -> None:
        """Camera reconnected or tracker reset: ids restart, so every in-flight per-track state must go."""
        for c in self.counters:
            c.reset_tracks()
        if self.zones is not None:
            self.zones.reset()
            self._last_counts = None
        if self.queue is not None:
            self.queue.reset()

    def _ev(self, type_: str, payload: Dict[str, Any], at: datetime) -> Dict[str, Any]:
        self.emitted[type_] = self.emitted.get(type_, 0) + 1
        return {"type": type_, "payload": payload, "at": at}

    def stats(self) -> Dict[str, Any]:
        return {"config": self.cfg.summary(), "emitted": dict(self.emitted),
                "lineSuppressed": sum(c.suppressed for c in self.counters),
                "lineEntries": sum(c.entries for c in self.counters), "lineExits": sum(c.exits for c in self.counters),
                "incompleteZoneVisits": self.zones.incomplete if self.zones else 0}
