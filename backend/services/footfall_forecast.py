"""Hourly footfall forecast from the values stored in the database (FootfallAggregate, 60-minute buckets).

Method (deliberately simple and fully visible - this is NOT a trained model): the forecast for an hour is the AVERAGE of that same hour over the
previous stored days; the shaded range is the lowest..highest value seen at that hour (not a statistical confidence interval).
Quality is measured, not claimed: the most recent complete stored day is "forecast" from the days before it (backtest) and compared with the real
values of that day, and with the naive baseline "same hour yesterday". Both errors are reported.

Which rows are used: if the camera has recorded >= MIN_DAYS days of its own counts (source 'cv'), only those are used. Otherwise all stored values are
used and the result says so (`includesDemoHistory`) - the DEMO history rows are fixtures, so the forecast is then a forecast of the fixture pattern.
Nothing is returned (None) with fewer than MIN_DAYS complete previous days.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from database.models import FootfallAggregate, Store
from services.common import now_utc, store_tz

MIN_DAYS = 3
MIN_HOURS_PER_DAY = 6  # a "complete" day has at least this many hourly buckets


def _by_day(rows: List[Tuple[datetime, int]], tz) -> Dict[Any, Dict[int, int]]:
    out: Dict[Any, Dict[int, int]] = defaultdict(dict)
    for bucket, entries in rows:
        local = bucket.astimezone(tz)
        out[local.date()][local.hour] = out[local.date()].get(local.hour, 0) + int(entries or 0)
    return out


def _forecast_hour(history: List[Dict[int, int]], hour: int) -> Optional[Tuple[float, int, int]]:
    vals = [d[hour] for d in history if hour in d]
    if not vals:
        return None
    return sum(vals) / len(vals), min(vals), max(vals)


def build(db: Session, store_id: str, now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    store = db.get(Store, store_id)
    if store is None:
        return None
    now = now or now_utc()
    tz = store_tz(store)
    today = now.astimezone(tz).date()
    cur_hour = now.astimezone(tz).hour

    def fetch(only_cv: bool) -> Dict[Any, Dict[int, int]]:
        q = select(FootfallAggregate.bucket_start, FootfallAggregate.entries).where(FootfallAggregate.store_id == store_id).where(FootfallAggregate.bucket_minutes == 60)
        if only_cv:
            q = q.where(FootfallAggregate.source == "cv")
        return _by_day([(r[0], r[1]) for r in db.execute(q)], tz)

    def complete_prev(days: Dict[Any, Dict[int, int]]) -> List[Any]:
        return sorted(d for d, h in days.items() if d < today and len(h) >= MIN_HOURS_PER_DAY)

    cv_days = fetch(True)
    all_days = fetch(False)
    cv_prev = complete_prev(cv_days)
    used_cv = len(cv_prev) >= MIN_DAYS
    days = cv_days if used_cv else all_days
    prev = cv_prev if used_cv else complete_prev(all_days)
    if len(prev) < MIN_DAYS:
        return None
    includes_demo = (not used_cv) and any(d in all_days and d not in cv_days for d in prev) or (not used_cv and bool(prev))
    history = [days[d] for d in prev]
    hours = sorted({h for d in history for h in d})

    # ---- backtest on the latest complete day (needs >= 2 earlier days)
    mae_pct = base_pct = None
    if len(prev) >= MIN_DAYS:
        test_day, train = days[prev[-1]], [days[d] for d in prev[:-1]]
        errs, base_errs, actual_sum = [], [], 0
        yesterday = days[prev[-2]] if len(prev) >= 2 else {}
        for h in hours:
            f = _forecast_hour(train, h)
            if f is None or h not in test_day:
                continue
            errs.append(abs(f[0] - test_day[h]))
            actual_sum += test_day[h]
            if h in yesterday:
                base_errs.append(abs(yesterday[h] - test_day[h]))
        if errs and actual_sum > 0:
            n = len(errs)
            mae_pct = round(sum(errs) / actual_sum * 100, 1)
            base_pct = round(sum(base_errs) / actual_sum * 100 * (n / max(1, len(base_errs))), 1) if base_errs else None

    # The method with the lower backtest error is used (both errors are reported): "average of all stored days" or "same hour as the latest day".
    use_latest = base_pct is not None and mae_pct is not None and base_pct < mae_pct
    today_actual = (cv_days if used_cv else all_days).get(today, {})
    points = []
    for h in hours:
        f = _forecast_hour(history[-3:] if use_latest else history, h)
        if f is None:
            continue
        mean, lo, hi = f
        if use_latest and h in history[-1]:
            mean = history[-1][h]
        points.append({"hour": f"{h:02d}:00", "actualTraffic": today_actual.get(h) if h <= cur_hour else None, "forecastTraffic": round(mean),
                       "upperConfidence": hi, "lowerConfidence": lo, "isPeakHour": False, "isFuture": h > cur_hour})
    if not points:
        return None
    peak = max(points, key=lambda p: p["forecastTraffic"])
    peak["isPeakHour"] = True
    label = "camera counts" if used_cv else "stored values incl. DEMO history"
    return {
        "available": True, "horizon": "today", "modelName": (f"Same hour as the latest stored day ({label})" if use_latest else f"Average of the same hour over the last {len(prev)} stored days ({label})"),
        "generationTime": f"Computed from the database at {now.astimezone(tz):%H:%M}", "projectedTotalVolume": sum(p["forecastTraffic"] for p in points),
        "peakHour": peak["hour"], "peakVolume": peak["forecastTraffic"], "historicalReliabilityMae": (base_pct if use_latest else mae_pct), "averageMethodMaePct": mae_pct, "latestDayMethodMaePct": base_pct, "methodChosen": "latest_day" if use_latest else "average",
        "points": points, "daysUsed": len(prev), "basis": "camera" if used_cv else "stored_values", "includesDemoHistory": includes_demo,
        "method": "chosen by backtest on the latest complete day: average of the same hour over stored days, or the latest day's same hour; range = lowest..highest of the days used",
    }


_ = timedelta, timezone
