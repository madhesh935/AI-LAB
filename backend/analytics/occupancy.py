"""Store occupancy ESTIMATE from verified line crossings, with explicit uncertainty.

Occupancy = entries - exits since the last baseline. It is an estimate: every missed or duplicated crossing
shifts it permanently, so the status says how far to trust it:

  unknown    no baseline and no crossings yet
  ok         baseline set (manual reset / closing-time reset) and every entrance camera has been live since
  uncertain  counting since first observation (no baseline), an entrance camera was offline (missed crossings),
             or the count would have gone negative (clamped to 0 - proof of missed entries)
  stale      the entrance cameras have been offline for longer than `stale_after_minutes`; the number is just the last value
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Optional


@dataclass(frozen=True)
class Occupancy:
    estimate: Optional[int] = None
    status: str = "unknown"
    reason: Optional[str] = "no entrance crossings observed yet"
    entries: int = 0
    exits: int = 0
    negative_clamps: int = 0
    last_event_at: Optional[datetime] = None
    last_reset_at: Optional[datetime] = None
    reset_reason: Optional[str] = None
    baseline_set: bool = False
    camera_down_since: Optional[datetime] = None
    camera_gap: bool = False  # an entrance camera was offline since the baseline => crossings were missed


class OccupancyEstimator:
    def __init__(self, stale_after_minutes: float = 15.0):
        self.stale_after = timedelta(minutes=stale_after_minutes)

    def reset(self, occ: Occupancy, at: datetime, value: int = 0, reason: str = "manual reset") -> Occupancy:
        """Establish a baseline (e.g. 0 at opening, or a manual head-count)."""
        if value < 0:
            raise ValueError("occupancy cannot be negative")
        return Occupancy(estimate=value, status="ok", reason=None, entries=0, exits=0, negative_clamps=0,
                         last_event_at=occ.last_event_at, last_reset_at=at, reset_reason=reason, baseline_set=True,
                         camera_down_since=occ.camera_down_since, camera_gap=False)

    def apply_crossing(self, occ: Occupancy, direction: str, at: datetime, count: int = 1) -> Occupancy:
        if direction not in ("in", "out") or count < 0:
            raise ValueError("invalid crossing")
        entries = occ.entries + (count if direction == "in" else 0)
        exits = occ.exits + (count if direction == "out" else 0)
        base = occ.estimate if occ.estimate is not None else 0
        raw = base + (count if direction == "in" else -count)
        clamps = occ.negative_clamps
        if raw < 0:
            raw, clamps = 0, clamps + 1
        new = replace(occ, estimate=raw, entries=entries, exits=exits, negative_clamps=clamps, last_event_at=at)
        return self._status(new)

    def camera_lost(self, occ: Occupancy, at: datetime) -> Occupancy:
        if occ.camera_down_since is not None:
            return occ
        return self._status(replace(occ, camera_down_since=at, camera_gap=True))

    def camera_restored(self, occ: Occupancy, at: datetime) -> Occupancy:
        return self._status(replace(occ, camera_down_since=None))

    def evaluate(self, occ: Occupancy, now: datetime) -> Occupancy:
        """Recompute staleness for read-time (call before serving the value)."""
        if occ.camera_down_since is not None and now - occ.camera_down_since > self.stale_after and occ.estimate is not None:
            return replace(occ, status="stale", reason=f"entrance camera offline for over {int(self.stale_after.total_seconds() // 60)} min; value is the last known estimate")
        return occ

    def _status(self, occ: Occupancy) -> Occupancy:
        if occ.estimate is None and occ.entries == 0 and occ.exits == 0:
            return replace(occ, status="unknown", reason="no entrance crossings observed yet")
        if occ.negative_clamps > 0:
            return replace(occ, status="uncertain", reason=f"{occ.negative_clamps} exit(s) exceeded the estimate: entries were missed")
        if occ.camera_down_since is not None:
            return replace(occ, status="uncertain", reason="entrance camera offline: crossings are being missed")
        if occ.camera_gap:
            return replace(occ, status="uncertain", reason="entrance camera was offline since the baseline; crossings were missed")
        if not occ.baseline_set:
            return replace(occ, status="uncertain", reason="counting since first observation (no baseline: set one with a reset)")
        return replace(occ, status="ok", reason=None)
