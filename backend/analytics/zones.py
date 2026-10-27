"""Zone membership, debounced entry/exit, dwell time and zone-to-zone transitions for ONE camera."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Sequence, Tuple

from analytics.geometry import Point, distance_to_polygon_edge, point_in_polygon


@dataclass
class ZoneConfig:
    zone_id: str
    polygon: Sequence[Sequence[float]]
    enter_frames: int = 3  # consecutive inside observations required before an entry is declared
    exit_grace_seconds: float = 1.5  # continuous time outside before an exit is declared
    min_dwell_seconds: float = 1.0  # shorter visits are edge-grazing, not visits
    count_censored: bool = False  # include visits whose entry was not observed (track first appeared inside)
    exit_margin: float = 0.06  # a track that VANISHES within this distance of the zone border / frame edge is an inferred exit


@dataclass
class ZoneVisitEvent:
    zone_id: str
    track_id: int
    entered_at: datetime
    exited_at: datetime
    exit_inferred: bool = False  # the track vanished near the zone border instead of being seen outside

    @property
    def dwell_seconds(self) -> float:
        return (self.exited_at - self.entered_at).total_seconds()


@dataclass
class TransitionEvent:
    from_zone: str
    to_zone: str
    track_id: int
    at: datetime


@dataclass
class _Presence:
    inside_streak: int = 0
    entered_at: Optional[datetime] = None  # declared entry time (first inside observation of the streak)
    first_inside: Optional[datetime] = None
    outside_since: Optional[datetime] = None
    active: bool = False
    censored: bool = False
    last_pt: Optional[Point] = None
    last_inside_at: Optional[datetime] = None


@dataclass
class ZoneTracker:
    zones: List[ZoneConfig]
    transition_gap_seconds: float = 6.0
    track_ttl_seconds: float = 5.0
    incomplete: int = 0  # visits dropped because the track vanished inside the zone / the entry was never seen
    _p: Dict[Tuple[int, str], _Presence] = field(default_factory=dict)
    _seen: Dict[int, datetime] = field(default_factory=dict)
    _last_exit: Dict[int, Tuple[str, datetime]] = field(default_factory=dict)

    def update(self, track_id: int, point: Point, at: datetime) -> Tuple[List[ZoneVisitEvent], List[TransitionEvent]]:
        visits: List[ZoneVisitEvent] = []
        transitions: List[TransitionEvent] = []
        first_time = track_id not in self._seen
        self._seen[track_id] = at
        for z in self.zones:
            inside = point_in_polygon(point, z.polygon)
            key = (track_id, z.zone_id)
            p = self._p.get(key)
            if p is None:
                p = self._p[key] = _Presence()
                # A track whose very first sighting is inside the zone has an unobserved entry (left-censored).
                p.censored = first_time and inside
            if inside:
                p.last_pt, p.last_inside_at = point, at
                p.outside_since = None
                p.inside_streak += 1
                if p.first_inside is None:
                    p.first_inside = at
                if not p.active and p.inside_streak >= z.enter_frames:
                    p.active, p.entered_at = True, p.first_inside
                    last = self._last_exit.get(track_id)
                    for other in self.zones:  # a zone left moments ago but still inside its exit grace period counts as the origin
                        po = self._p.get((track_id, other.zone_id))
                        if other.zone_id != z.zone_id and po is not None and po.active and po.outside_since is not None:
                            if last is None or po.outside_since > last[1]:
                                last = (other.zone_id, po.outside_since)
                    if last and last[0] != z.zone_id and (p.entered_at - last[1]).total_seconds() <= self.transition_gap_seconds:
                        transitions.append(TransitionEvent(last[0], z.zone_id, track_id, p.entered_at))
            else:
                p.inside_streak, p.first_inside = 0, None
                if p.active:
                    if p.outside_since is None:
                        p.outside_since = at
                    if (at - p.outside_since).total_seconds() >= z.exit_grace_seconds:
                        ev = self._close(z, track_id, p, exit_at=p.outside_since)
                        if ev:
                            visits.append(ev)
        return visits, transitions

    def _close(self, z: ZoneConfig, track_id: int, p: _Presence, exit_at: datetime) -> Optional[ZoneVisitEvent]:
        entered, censored = p.entered_at, p.censored
        self._p.pop((track_id, z.zone_id), None)
        if entered is None:
            return None
        self._last_exit[track_id] = (z.zone_id, exit_at)
        if censored and not z.count_censored:
            self.incomplete += 1
            return None
        ev = ZoneVisitEvent(z.zone_id, track_id, entered, exit_at)
        if ev.dwell_seconds < z.min_dwell_seconds:
            return None
        return ev

    def occupancy(self) -> Dict[str, int]:
        counts = {z.zone_id: 0 for z in self.zones}
        for (_, zid), p in self._p.items():
            if p.active:
                counts[zid] = counts.get(zid, 0) + 1
        return counts

    def expire(self, now: datetime) -> List[ZoneVisitEvent]:
        """Tracks that vanished while inside a zone.

        * last seen near the zone border or the frame edge  -> inferred exit at the last-seen time (a complete visit, flagged);
        * vanished in the middle of the zone (occlusion, lost track) -> INCOMPLETE, excluded from dwell statistics."""
        out: List[ZoneVisitEvent] = []
        dead = [t for t, s in self._seen.items() if (now - s).total_seconds() > self.track_ttl_seconds]
        for t in dead:
            for z in self.zones:
                p = self._p.pop((t, z.zone_id), None)
                if p is None or not p.active or p.entered_at is None:
                    continue
                near_border = p.last_pt is not None and (
                    distance_to_polygon_edge(p.last_pt, z.polygon) <= z.exit_margin
                    or min(p.last_pt[0], 1 - p.last_pt[0], p.last_pt[1], 1 - p.last_pt[1]) <= 0.03)
                if near_border and p.last_inside_at is not None and not (p.censored and not z.count_censored):
                    ev = ZoneVisitEvent(z.zone_id, t, p.entered_at, p.last_inside_at, exit_inferred=True)
                    if ev.dwell_seconds >= z.min_dwell_seconds:
                        out.append(ev)
                        self._last_exit[t] = (z.zone_id, p.last_inside_at)
                        continue
                self.incomplete += 1
            self._seen.pop(t, None)
            self._last_exit.pop(t, None)
        return out

    def reset(self) -> None:
        self._p.clear()
        self._seen.clear()
        self._last_exit.clear()
