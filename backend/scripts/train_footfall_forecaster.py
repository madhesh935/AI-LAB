"""Hourly footfall (demand) forecaster - trains ONLY when enough REAL camera history exists.

    python scripts/train_footfall_forecaster.py [--store store-blr-104] [--db data/retailedge.db] [--min-days 14]

Data: `footfall_aggregates` rows with source 'cv' (entrance-camera crossings), 60-minute buckets. Seeded demo rows (source 'demo') are never used.
Refuses (exit code 3) with the exact shortfall unless the store has >= min-days of real hourly buckets. When data is sufficient: time-ordered
70/15/15 split (no shuffling); features = same hour yesterday / last week, previous hour, hour-of-day and day-of-week; baseline = seasonal naive
(same hour last week, else yesterday). A scikit-learn GradientBoostingRegressor is compared with the baseline on the VALIDATION split, the TEST MAE
is reported for both, and the model is saved only if it beats the baseline on test by >= 5 %. Nothing is trained from simulated or seeded data.
Output: ai_models/forecasting/footfall_forecaster.pkl + footfall_forecaster.json (the model card with the real numbers).
Note: nothing in the API consumes this model yet; AI Insights keeps saying "forecast unavailable" until a consumer is wired to a saved model.
"""

from __future__ import annotations

import argparse
import json
import pickle
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(db: Path, store: str):
    con = sqlite3.connect(str(db))
    rows = con.execute("SELECT bucket_start, entries FROM footfall_aggregates WHERE store_id=? AND source='cv' AND bucket_minutes=60 ORDER BY bucket_start", (store,)).fetchall()
    con.close()
    return [(datetime.fromisoformat(str(r[0]).replace("Z", "+00:00")), float(r[1])) for r in rows]


def features(series: dict, t: datetime):
    from datetime import timedelta

    def at(h):
        return series.get(t - timedelta(hours=h))

    lag1, lag24, lag168 = at(1), at(24), at(168)
    return lag1, lag24, lag168


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--store", default="store-blr-104")
    ap.add_argument("--db", type=Path, default=ROOT / "data" / "retailedge.db")
    ap.add_argument("--min-days", type=float, default=14.0)
    ap.add_argument("--out", type=Path, default=ROOT / "ai_models" / "forecasting" / "footfall_forecaster")
    args = ap.parse_args(argv)

    rows = load(args.db, args.store) if args.db.exists() else []
    span = (rows[-1][0] - rows[0][0]).total_seconds() / 86400 if len(rows) > 1 else 0.0
    if span < args.min_days:
        print(json.dumps({"trained": False, "reason": "insufficient real history", "hourly_buckets": len(rows), "days_of_history": round(span, 2), "required_days": args.min_days,
                          "decision": "no footfall forecast model; AI Insights keeps reporting the forecast as unavailable"}, indent=1))
        return 3

    import numpy as np
    from sklearn.ensemble import GradientBoostingRegressor

    series = {t: v for t, v in rows}
    X, y, base = [], [], []
    for t, v in rows:
        lag1, lag24, lag168 = features(series, t)
        if lag1 is None or lag24 is None:
            continue
        seasonal = lag168 if lag168 is not None else lag24
        X.append([lag1, lag24, lag168 if lag168 is not None else lag24, np.sin(2 * np.pi * t.hour / 24), np.cos(2 * np.pi * t.hour / 24), t.weekday()])
        y.append(v)
        base.append(seasonal)
    X, y, base = np.array(X), np.array(y), np.array(base)
    n = len(y)
    if n < 24 * 7:
        print(json.dumps({"trained": False, "reason": "too few usable hourly samples after lagging", "usable_samples": n, "required": 24 * 7}, indent=1))
        return 3
    a, b = int(n * 0.70), int(n * 0.85)
    model = GradientBoostingRegressor(random_state=0, n_estimators=200, max_depth=3, learning_rate=0.05).fit(X[:a], y[:a])
    mae = lambda p, t: float(np.mean(np.abs(p - t)))  # noqa: E731
    result = {"store": args.store, "days": round(span, 1), "samples": {"train": a, "validation": b - a, "test": n - b},
              "validation_mae": {"seasonal_naive": mae(base[a:b], y[a:b]), "gbr": mae(model.predict(X[a:b]), y[a:b])},
              "test_mae": {"seasonal_naive": mae(base[b:], y[b:]), "gbr": mae(model.predict(X[b:]), y[b:])}}
    improves = result["test_mae"]["gbr"] <= 0.95 * result["test_mae"]["seasonal_naive"] and result["validation_mae"]["gbr"] < result["validation_mae"]["seasonal_naive"]
    result.update({"trained": True, "saved": bool(improves), "decision": "model saved" if improves else "did not beat the seasonal-naive baseline on held-out data: no model saved"})
    if improves:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.with_suffix(".pkl").write_bytes(pickle.dumps(model))
        args.out.with_suffix(".json").write_text(json.dumps(result, indent=1))
    print(json.dumps(result, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
