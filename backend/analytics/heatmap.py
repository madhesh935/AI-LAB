"""Camera-space presence heatmap: counts anonymous foot positions per grid cell (no identities kept)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Tuple


@dataclass
class HeatmapGrid:
    grid_w: int = 32
    grid_h: int = 18
    sample_interval_seconds: float = 0.5  # per track at most one sample per interval, so FPS does not weight slow walkers
    _cells: Dict[Tuple[int, int], int] = field(default_factory=dict)
    _last: Dict[int, datetime] = field(default_factory=dict)

    def add(self, track_id: int, x: float, y: float, at: datetime) -> bool:
        last = self._last.get(track_id)
        if last is not None and (at - last).total_seconds() < self.sample_interval_seconds:
            return False
        self._last[track_id] = at
        gx = min(self.grid_w - 1, max(0, int(x * self.grid_w)))
        gy = min(self.grid_h - 1, max(0, int(y * self.grid_h)))
        self._cells[(gx, gy)] = self._cells.get((gx, gy), 0) + 1
        return True

    def drain(self) -> Dict[Tuple[int, int], int]:
        out, self._cells = self._cells, {}
        return out

    def forget_old_tracks(self, now: datetime, ttl_seconds: float = 10.0) -> None:
        for t in [t for t, s in self._last.items() if (now - s).total_seconds() > ttl_seconds]:
            del self._last[t]
