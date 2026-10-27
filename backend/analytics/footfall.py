"""Directional line-crossing counter with hysteresis (no repeated counts when a track jitters on the line)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Optional

from analytics.geometry import Point, segment_param, signed_distance


@dataclass
class LineConfig:
    line_id: str
    p1: Point
    p2: Point
    in_side: str = "positive"  # side of p1->p2 a customer is on AFTER entering ('positive' | 'negative')
    margin: float = 0.025  # dead band (normalised units) on each side of the line
    min_track_age: int = 3  # inference steps a track must have lived before it can count
    cooldown_seconds: float = 2.0  # suppress ping-pong crossings of one track inside this window
    track_ttl_seconds: float = 5.0  # forget tracks not seen for this long (expiry)
    extent_tolerance: float = 0.05  # how far beyond the segment ends a crossing may still count
    count_only: Optional[str] = None  # "in" | "out" | None: an entrance line counts only "in", an exit line only "out" (the other direction is ignored, never counted)


@dataclass
class Crossing:
    line_id: str
    direction: str  # 'in' | 'out'
    track_id: int
    at: datetime


@dataclass
class _TrackState:
    side: int = 0  # committed side: +1 / -1 / 0 (not yet outside the dead band)
    last_seen: Optional[datetime] = None
    last_cross: Optional[datetime] = None


@dataclass
class LineCounter:
    cfg: LineConfig
    entries: int = 0
    exits: int = 0
    suppressed: int = 0  # ping-pong / out-of-extent / too-young crossings that were NOT counted
    _tracks: Dict[int, _TrackState] = field(default_factory=dict)

    @property
    def _in_sign(self) -> int:
        return 1 if self.cfg.in_side == "positive" else -1

    def update(self, track_id: int, point: Point, at: datetime, age_frames: int) -> Optional[Crossing]:
        st = self._tracks.setdefault(track_id, _TrackState())
        st.last_seen = at
        d = signed_distance(self.cfg.p1, self.cfg.p2, point)
        side = 1 if d > self.cfg.margin else -1 if d < -self.cfg.margin else 0
        if side == 0:
            return None  # inside the dead band: jitter here can never count
        if st.side == 0:
            st.side = side  # first confident side establishes the reference
            return None
        if side == st.side:
            return None
        # A confident move from one side to the other.
        st.side = side
        t = segment_param(self.cfg.p1, self.cfg.p2, point)
        if not (-self.cfg.extent_tolerance <= t <= 1 + self.cfg.extent_tolerance) or age_frames < self.cfg.min_track_age:
            self.suppressed += 1
            return None
        if st.last_cross is not None and (at - st.last_cross).total_seconds() < self.cfg.cooldown_seconds:
            self.suppressed += 1
            st.last_cross = at
            return None
        st.last_cross = at
        direction = "in" if side == self._in_sign else "out"
        if self.cfg.count_only and direction != self.cfg.count_only:
            return None
        if direction == "in":
            self.entries += 1
        else:
            self.exits += 1
        return Crossing(self.cfg.line_id, direction, track_id, at)

    def expire(self, now: datetime) -> int:
        """Drop tracks that have not been seen recently. Returns how many were dropped."""
        dead = [k for k, s in self._tracks.items() if s.last_seen is None or (now - s.last_seen).total_seconds() > self.cfg.track_ttl_seconds]
        for k in dead:
            del self._tracks[k]
        return len(dead)

    def reset_tracks(self) -> None:
        """Camera reconnect / tracker reset: ids are no longer comparable."""
        self._tracks.clear()

    @property
    def live_tracks(self) -> int:
        return len(self._tracks)
