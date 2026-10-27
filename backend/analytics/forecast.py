"""Transparent short-horizon queue forecast.

Two statistical baselines, both explicit about what they assume:

* persistence-v1 (DEFAULT):  L(h) = L0, plus a congestion-risk class and a wait estimate from the measured service rate.
* fluid-v1 (diagnostic):     L(h) = max(0, L0 + (lambda - mu) * h) with lambda = observed arrivals/min, mu = observed service rate.

Why persistence is the default: on the controlled simulation in scripts/evaluate_queue.py (6 seeds, 4 h each, alternating calm/rush half-hours,
noisy arrival-rate estimates) the fluid drift model and damped / gated / recent-trend variants all had HIGHER error than persistence at 5, 10 and 15
minutes. Noisy rate estimates make the extrapolation worse than doing nothing. Re-evaluate on real checkout history (backtest()) before changing the default.
A machine-learning forecaster needs weeks of real history that does not exist yet (scripts/train_queue_forecaster.py refuses to train without it).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import List, Optional, Sequence, Tuple

MODEL_VERSION = "persistence-v1"
MODEL_VERSION_FLUID = "fluid-v1"
DEFAULT_HORIZONS = (5, 10, 15)


@dataclass(frozen=True)
class ForecastPoint:
    generated_at: datetime
    forecast_for: datetime
    horizon_minutes: int
    predicted_length: float
    predicted_wait_seconds: Optional[float]
    congestion_risk: str  # low | medium | high
    basis: str  # persistence | fluid
    model_version: str = MODEL_VERSION
    drift_per_min: Optional[float] = None  # observed arrivals - service (diagnostic; a prediction input only for method='fluid')


def risk_for(length: float, warning_length: int, critical_length: int) -> str:
    if length >= critical_length:
        return "high"
    if length >= warning_length:
        return "medium"
    return "low"


def predict_length(l0: float, lam: Optional[float], mu: Optional[float], horizon_min: float) -> Tuple[float, str]:
    if lam is None or mu is None:
        return float(l0), "persistence"
    return max(0.0, l0 + (lam - mu) * horizon_min), "fluid"


def forecast_queue(
    now: datetime,
    length: int,
    arrival_rate_per_min: Optional[float],
    service_rate_per_min: Optional[float],
    warning_length: int,
    critical_length: int,
    horizons: Sequence[int] = DEFAULT_HORIZONS,
    in_service: int = 0,
    method: str = "persistence",
) -> List[ForecastPoint]:
    out: List[ForecastPoint] = []
    drift = round(arrival_rate_per_min - service_rate_per_min, 3) if arrival_rate_per_min is not None and service_rate_per_min else None
    for h in horizons:
        if method == "fluid":
            pred, basis = predict_length(length, arrival_rate_per_min, service_rate_per_min, h)
        else:
            pred, basis = float(length), "persistence"
        wait = None
        if service_rate_per_min and service_rate_per_min > 0:
            wait = round((pred + in_service) / service_rate_per_min * 60.0, 1)
        out.append(ForecastPoint(now, now + timedelta(minutes=h), h, round(pred, 2), wait, risk_for(pred, warning_length, critical_length), basis,
                                 MODEL_VERSION_FLUID if method == "fluid" else MODEL_VERSION, drift))
    return out


@dataclass(frozen=True)
class BacktestResult:
    horizon_minutes: int
    n: int
    mae_model: float
    mae_persistence: float
    rmse_model: float

    @property
    def beats_persistence(self) -> bool:
        return self.mae_model < self.mae_persistence


def backtest(
    series: Sequence[Tuple[datetime, float]],
    arrivals_per_min: Sequence[Optional[float]],
    service_rate_per_min: Optional[float],
    horizon_minutes: int,
) -> Optional[BacktestResult]:
    """Walk a REAL (time-ordered) length series; at each point forecast `horizon_minutes` ahead and compare with what happened.

    `arrivals_per_min[i]` is the arrival rate that was known at point i (no look-ahead). Returns None if the series is too short."""
    errs_m: List[float] = []
    errs_p: List[float] = []
    j = 0
    for i, (t, l0) in enumerate(series):
        target = t + timedelta(minutes=horizon_minutes)
        while j < len(series) and series[j][0] < target:
            j += 1
        if j >= len(series):
            break
        actual = series[j][1]
        pred, _ = predict_length(l0, arrivals_per_min[i], service_rate_per_min, horizon_minutes)
        errs_m.append(abs(pred - actual))
        errs_p.append(abs(l0 - actual))
    if len(errs_m) < 5:
        return None
    return BacktestResult(horizon_minutes, len(errs_m), sum(errs_m) / len(errs_m), sum(errs_p) / len(errs_p),
                          math.sqrt(sum(e * e for e in errs_m) / len(errs_m)))
