"""Baseline waiting-time estimate:  wait ~= customers_ahead / service_rate.

customers_ahead = people waiting + people currently being served (a new arrival waits for both).
service_rate    = 60 / mean OBSERVED service seconds of this counter (customers per minute).

Never invents a precise number: without a measured rate the result is either UNAVAILABLE or an explicit,
labelled ASSUMPTION built from a configured assumed rate.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class WaitEstimate:
    seconds: Optional[float]
    basis: str  # measured | assumption | unavailable
    rate_per_min: Optional[float]
    customers_ahead: int
    note: Optional[str] = None


def estimate_wait(
    waiting: int,
    in_service: int,
    measured_rate_per_min: Optional[float],
    assumed_rate_per_min: Optional[float] = None,
    counter_open: bool = True,
    reliable: bool = True,
) -> WaitEstimate:
    ahead = max(0, waiting) + max(0, in_service)
    if not counter_open:
        return WaitEstimate(None, "unavailable", None, ahead, "counter is closed")
    if not reliable:
        return WaitEstimate(None, "unavailable", None, ahead, "queue observation is not reliable yet")
    if ahead == 0:
        return WaitEstimate(0.0, "measured", measured_rate_per_min, 0, "nobody ahead")
    if measured_rate_per_min and measured_rate_per_min > 0:
        return WaitEstimate(round(ahead / measured_rate_per_min * 60.0, 1), "measured", measured_rate_per_min, ahead)
    if assumed_rate_per_min and assumed_rate_per_min > 0:
        return WaitEstimate(round(ahead / assumed_rate_per_min * 60.0, 1), "assumption", assumed_rate_per_min, ahead,
                            "no measured service rate yet; configured assumption used")
    return WaitEstimate(None, "unavailable", None, ahead, "no measured service rate yet")
