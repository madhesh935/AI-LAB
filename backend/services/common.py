"""Cross-cutting helpers shared by services."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.errors import NotFoundError
from database.models import Store

UTC = timezone.utc


def now_utc() -> datetime:
    return datetime.now(UTC)


def humanize(dt: Optional[datetime], now: Optional[datetime] = None) -> str:
    """'4 mins ago' style label the frontend displays verbatim."""
    if dt is None:
        return "-"
    now = now or now_utc()
    seconds = max(0, int((now - dt).total_seconds()))
    if seconds < 45:
        return "Just now"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} min{'s' if minutes != 1 else ''} ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} hr{'s' if hours != 1 else ''} ago"
    days = hours // 24
    return f"{days} day{'s' if days != 1 else ''} ago"


@dataclass(frozen=True)
class TimeWindow:
    start: datetime
    end: datetime
    previous_start: datetime
    previous_end: datetime
    label: str


def store_tz(store: Store) -> ZoneInfo:
    try:
        return ZoneInfo(store.timezone or "UTC")
    except Exception:  # noqa: BLE001
        return ZoneInfo("UTC")


def resolve_window(store: Store, range_key: str = "today", now: Optional[datetime] = None) -> TimeWindow:
    """Translate the frontend's range keys into UTC windows (store-local days)."""
    now = now or now_utc()
    tz = store_tz(store)
    local_now = now.astimezone(tz)
    midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)

    key = (range_key or "today").lower()
    if key == "yesterday":
        start, end = midnight - timedelta(days=1), midnight
    elif key in ("week", "7d"):
        start, end = midnight - timedelta(days=6), now.astimezone(tz)
    elif key in ("month", "30d"):
        start, end = midnight - timedelta(days=29), now.astimezone(tz)
    else:
        key = "today"
        start, end = midnight, now.astimezone(tz)

    span = end - start
    return TimeWindow(
        start=start.astimezone(UTC),
        end=end.astimezone(UTC),
        previous_start=(start - span).astimezone(UTC),
        previous_end=start.astimezone(UTC),
        label=key,
    )


def get_store_or_404(db: Session, store_id: str) -> Store:
    store = db.get(Store, store_id)
    if store is None:
        raise NotFoundError("Store", store_id)
    return store


def pct_change(current: float, previous: float) -> float:
    if not previous:
        return 0.0
    return round((current - previous) / previous * 100, 1)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def congestion_level(wait_minutes: float, sla_minutes: float = 4.5) -> str:
    if wait_minutes >= sla_minutes * 1.5:
        return "critical"
    if wait_minutes >= sla_minutes:
        return "high"
    if wait_minutes >= sla_minutes * 0.6:
        return "moderate"
    return "optimal"


def latest_by(db: Session, model, store_id: str):
    return db.scalars(select(model).where(model.store_id == store_id).limit(1)).first()
