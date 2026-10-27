"""Queue membership, arrivals/departures, measured service times and congestion for the counters of ONE camera.

Rules that keep the numbers honest:
* a person belongs to AT MOST ONE queue (overlapping polygons are resolved by priority, then smaller area, and the
  choice is sticky until the person has really left);
* standing in the service region wins over any queue polygon;
* a person only counts after `min_presence_seconds` inside, so walkers passing through are ignored;
* the displayed length is a windowed median of raw counts (no flicker);
* service rate comes only from OBSERVED completed services - never from a default.
"""

from __future__ import annotations

import statistics
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Deque, Dict, List, Optional, Sequence, Tuple

from analytics.geometry import Point, point_in_polygon, polygon_area

CONGESTION_LEVELS = ("optimal", "moderate", "high", "critical")


@dataclass
class QueueRegionCfg:
    counter_id: str
    queue_polygon: Sequence[Sequence[float]]
    service_polygon: Sequence[Sequence[float]] = ()
    priority: int = 0
    warning_length: int = 4
    critical_length: int = 7
    warning_wait_seconds: float = 180.0
    critical_wait_seconds: float = 270.0
    assumed_service_rate_per_min: Optional[float] = None
    min_presence_seconds: float = 2.0
    leave_grace_seconds: float = 2.0
    min_service_seconds: float = 5.0
    smoothing_window_seconds: float = 6.0


@dataclass
class QueueEvent:
    kind: str  # arrival | departure | service_start | service_complete
    counter_id: str
    track_id: int
    at: datetime
    reason: Optional[str] = None  # departure: served | left | lost
    wait_seconds: Optional[float] = None  # service_start: measured wait of THIS person
    service_seconds: Optional[float] = None  # service_complete


@dataclass
class QueueSnapshot:
    counter_id: str
    at: datetime
    raw_length: int
    length: int  # smoothed
    in_service: int
    arrival_rate_per_min: Optional[float]
    service_rate_per_min: Optional[float]  # 60 / mean observed service seconds; None until >= min_service_samples
    congestion: str
    reliable: bool


@dataclass
class _T:
    assigned: Optional[str] = None
    queue_since: Optional[datetime] = None
    q_outside_since: Optional[datetime] = None
    member: bool = False
    service_counter: Optional[str] = None
    service_since: Optional[datetime] = None
    s_outside_since: Optional[datetime] = None
    wait_seconds: Optional[float] = None
    last_seen: Optional[datetime] = None


def classify_congestion(length: int, cfg: QueueRegionCfg, wait_seconds: Optional[float] = None) -> str:
    level = 0
    if length >= cfg.critical_length:
        level = 3
    elif length >= cfg.warning_length:
        level = 2
    elif length >= max(1, cfg.warning_length // 2):
        level = 1
    if wait_seconds is not None:
        if wait_seconds >= cfg.critical_wait_seconds:
            level = max(level, 3)
        elif wait_seconds >= cfg.warning_wait_seconds:
            level = max(level, 2)
    return CONGESTION_LEVELS[level]


@dataclass
class QueueMonitor:
    regions: List[QueueRegionCfg]
    track_ttl_seconds: float = 5.0
    min_service_samples: int = 3
    arrival_window_seconds: float = 300.0
    service_sample_window: int = 12
    warmup_seconds: float = 10.0
    _tracks: Dict[int, _T] = field(default_factory=dict)
    _raw: Dict[str, Deque[Tuple[datetime, int]]] = field(default_factory=dict)
    _arrivals: Dict[str, Deque[datetime]] = field(default_factory=dict)
    _service: Dict[str, Deque[float]] = field(default_factory=dict)
    _started: Optional[datetime] = None

    def __post_init__(self) -> None:
        self._cfg = {r.counter_id: r for r in self.regions}
        for r in self.regions:
            self._raw[r.counter_id] = deque()
            self._arrivals[r.counter_id] = deque()
            self._service[r.counter_id] = deque(maxlen=self.service_sample_window)

    # ------------------------------------------------------------------ per-track update
    def _queue_candidates(self, pt: Point) -> List[QueueRegionCfg]:
        return [r for r in self.regions if r.queue_polygon and point_in_polygon(pt, r.queue_polygon)]

    def _service_candidate(self, pt: Point) -> Optional[QueueRegionCfg]:
        hits = [r for r in self.regions if r.service_polygon and point_in_polygon(pt, r.service_polygon)]
        return max(hits, key=lambda r: (r.priority, -polygon_area(r.service_polygon)), default=None)

    def update(self, tracks: Sequence[Tuple[int, Point]], at: datetime) -> List[QueueEvent]:
        if self._started is None:
            self._started = at
        events: List[QueueEvent] = []
        for track_id, pt in tracks:
            t = self._tracks.setdefault(track_id, _T())
            t.last_seen = at
            svc = self._service_candidate(pt)

            # ---- service region (takes precedence over queue polygons)
            if svc is not None:
                t.s_outside_since = None
                if t.service_counter != svc.counter_id:
                    if t.service_counter is not None:
                        pass  # moved between service regions: restart
                    t.service_counter, t.service_since = svc.counter_id, at
                    wait = None
                    if t.assigned == svc.counter_id and t.queue_since is not None:
                        wait = (at - t.queue_since).total_seconds()
                        t.wait_seconds = wait
                    events.append(QueueEvent("service_start", svc.counter_id, track_id, at, wait_seconds=wait))
                if t.assigned is not None:
                    if t.member:
                        events.append(QueueEvent("departure", t.assigned, track_id, at, reason="served"))
                    t.assigned, t.member, t.queue_since, t.q_outside_since = None, False, None, None
                continue
            if t.service_counter is not None:
                if t.s_outside_since is None:
                    t.s_outside_since = at
                cfg = self._cfg[t.service_counter]
                if (at - t.s_outside_since).total_seconds() >= cfg.leave_grace_seconds:
                    events.extend(self._close_service(t, track_id, t.s_outside_since))

            # ---- queue membership (single assignment, sticky)
            cands = self._queue_candidates(pt)
            if t.assigned is not None:
                still_in = any(c.counter_id == t.assigned for c in cands)
                if still_in:
                    t.q_outside_since = None
                else:
                    if t.q_outside_since is None:
                        t.q_outside_since = at
                    if (at - t.q_outside_since).total_seconds() >= self._cfg[t.assigned].leave_grace_seconds:
                        if t.member:
                            events.append(QueueEvent("departure", t.assigned, track_id, at, reason="left"))
                        t.assigned, t.member, t.queue_since, t.q_outside_since = None, False, None, None
            if t.assigned is None and cands:
                best = max(cands, key=lambda r: (r.priority, -polygon_area(r.queue_polygon)))
                t.assigned, t.queue_since, t.q_outside_since = best.counter_id, at, None
            if t.assigned is not None and not t.member and t.queue_since is not None:
                if (at - t.queue_since).total_seconds() >= self._cfg[t.assigned].min_presence_seconds:
                    t.member = True
                    self._arrivals[t.assigned].append(at)
                    events.append(QueueEvent("arrival", t.assigned, track_id, at))

        # raw sample for smoothing (once per update call)
        counts = self._current_counts()
        for cid, raw in counts.items():
            dq = self._raw[cid]
            dq.append((at, raw))
            horizon = at - timedelta(seconds=self._cfg[cid].smoothing_window_seconds)
            while dq and dq[0][0] < horizon:
                dq.popleft()
            arr = self._arrivals[cid]
            while arr and (at - arr[0]).total_seconds() > self.arrival_window_seconds:
                arr.popleft()
        return events

    def _close_service(self, t: _T, track_id: int, exit_at: datetime) -> List[QueueEvent]:
        out: List[QueueEvent] = []
        cid, since = t.service_counter, t.service_since
        t.service_counter, t.service_since, t.s_outside_since = None, None, None
        if cid is None or since is None:
            return out
        secs = (exit_at - since).total_seconds()
        if secs >= self._cfg[cid].min_service_seconds:
            self._service[cid].append(secs)
            out.append(QueueEvent("service_complete", cid, track_id, exit_at, service_seconds=secs, wait_seconds=t.wait_seconds))
        return out

    def _current_counts(self) -> Dict[str, int]:
        counts = {r.counter_id: 0 for r in self.regions}
        for t in self._tracks.values():
            if t.assigned is not None and t.member:
                counts[t.assigned] += 1
        return counts

    # ------------------------------------------------------------------ housekeeping
    def expire(self, now: datetime) -> List[QueueEvent]:
        events: List[QueueEvent] = []
        for tid in [k for k, t in self._tracks.items() if t.last_seen is None or (now - t.last_seen).total_seconds() > self.track_ttl_seconds]:
            t = self._tracks.pop(tid)
            if t.assigned is not None and t.member:
                events.append(QueueEvent("departure", t.assigned, tid, now, reason="lost"))  # not counted as served
            if t.service_counter is not None and t.service_since is not None and t.last_seen is not None:
                # left the camera's view from the service region: the service ended when we last saw them (inferred, like a zone exit)
                events.extend(self._close_service(t, tid, t.last_seen))
        return events

    def reset(self) -> None:
        """Camera reconnected / tracker reset: ids restart, so drop every in-flight state (rates are kept)."""
        self._tracks.clear()
        for dq in self._raw.values():
            dq.clear()

    # ------------------------------------------------------------------ outputs
    def service_rate(self, counter_id: str) -> Optional[float]:
        s = self._service[counter_id]
        if len(s) < self.min_service_samples:
            return None
        mean = sum(s) / len(s)
        return round(60.0 / mean, 3) if mean > 0 else None

    def arrival_rate(self, counter_id: str, now: datetime) -> Optional[float]:
        if self._started is None:
            return None
        observed = min(self.arrival_window_seconds, (now - self._started).total_seconds())
        if observed < 60.0:
            return None  # too little observation time for a rate
        n = sum(1 for a in self._arrivals[counter_id] if (now - a).total_seconds() <= observed)
        return round(n / (observed / 60.0), 3)

    def snapshot(self, counter_id: str, now: datetime) -> QueueSnapshot:
        cfg = self._cfg[counter_id]
        samples = [v for _, v in self._raw[counter_id]]
        raw = self._current_counts().get(counter_id, 0)
        length = int(round(statistics.median(samples))) if samples else raw
        in_service = sum(1 for t in self._tracks.values() if t.service_counter == counter_id)
        warmed = self._started is not None and (now - self._started).total_seconds() >= self.warmup_seconds
        return QueueSnapshot(
            counter_id=counter_id, at=now, raw_length=raw, length=length, in_service=in_service,
            arrival_rate_per_min=self.arrival_rate(counter_id, now), service_rate_per_min=self.service_rate(counter_id),
            congestion=classify_congestion(length, cfg), reliable=bool(warmed),
        )
