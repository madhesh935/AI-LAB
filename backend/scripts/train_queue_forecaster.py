"""Queue-length ML forecaster - trains ONLY when enough REAL history exists.

    python scripts/train_queue_forecaster.py --counter cnt-01 --horizon 10 [--db data/retailedge.db] [--min-days 14] [--min-rows 2000]

Refuses (exit code 3) unless the counter has >= min-days of real queue_observations (source 'cv') and >= min-rows rows. When data is sufficient:
time-ordered train/validation/test split (70/15/15, no shuffling), features = recent lengths, arrival/service rates, hour of day; compares
persistence vs a scikit-learn GradientBoostingRegressor on the VALIDATION split, then reports the held-out TEST MAE of both. The model is saved
only if it beats persistence on test by >= 5 %; otherwise the transparent persistence-v1 stays the forecast. Nothing is trained from simulated data."""

from __future__ import annotations

import argparse
import json
import sqlite3
import statistics
import sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(db: Path, counter: str):
    con = sqlite3.connect(str(db))
    rows = con.execute("SELECT observed_at, queue_length, arrival_rate_per_min, service_rate_per_min FROM queue_observations "
                       "WHERE counter_id=? AND source='cv' ORDER BY observed_at", (counter,)).fetchall()
    con.close()
    return [(datetime.fromisoformat(r[0]), r[1], r[2], r[3]) for r in rows]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--counter", required=True)
    ap.add_argument("--horizon", type=int, default=10, help="minutes ahead")
    ap.add_argument("--db", type=Path, default=ROOT / "data" / "retailedge.db")
    ap.add_argument("--min-days", type=float, default=14.0)
    ap.add_argument("--min-rows", type=int, default=2000)
    ap.add_argument("--out", type=Path, default=ROOT / "ai_models" / "forecasting" / "queue_forecaster.json")
    args = ap.parse_args(argv)

    rows = load(args.db, args.counter) if args.db.exists() else []
    span_days = (rows[-1][0] - rows[0][0]).total_seconds() / 86400 if len(rows) > 1 else 0.0
    if len(rows) < args.min_rows or span_days < args.min_days:
        print(json.dumps({"trained": False, "reason": "insufficient real history", "rows": len(rows), "required_rows": args.min_rows,
                          "days_of_history": round(span_days, 2), "required_days": args.min_days,
                          "decision": "keep the transparent persistence-v1 forecast"}, indent=1))
        return 3

    import numpy as np
    from sklearn.ensemble import GradientBoostingRegressor

    ts = np.array([r[0].timestamp() for r in rows])
    length = np.array([r[1] for r in rows], float)
    lam = np.array([r[2] if r[2] is not None else np.nan for r in rows], float)
    mu = np.array([r[3] if r[3] is not None else np.nan for r in rows], float)
    X, y, idx = [], [], []
    horizon_s = args.horizon * 60
    for i in range(len(rows)):
        j = np.searchsorted(ts, ts[i] + horizon_s)
        if j >= len(rows) or abs(ts[j] - ts[i] - horizon_s) > horizon_s * 0.25:
            continue
        lag = [length[max(0, i - k)] for k in (0, 4, 8, 20)]
        h = rows[i][0].hour + rows[i][0].minute / 60
        X.append(lag + [np.nan_to_num(lam[i]), np.nan_to_num(mu[i]), np.sin(2 * np.pi * h / 24), np.cos(2 * np.pi * h / 24)])
        y.append(length[j])
        idx.append(i)
    X, y = np.array(X), np.array(y)
    n = len(y)
    a, b = int(n * 0.70), int(n * 0.85)  # time-ordered: train | validation | test
    model = GradientBoostingRegressor(random_state=0, n_estimators=200, max_depth=3, learning_rate=0.05).fit(X[:a], y[:a])
    mae = lambda p, t: float(np.mean(np.abs(p - t)))  # noqa: E731
    result = {
        "rows": len(rows), "days": round(span_days, 1), "samples": {"train": a, "validation": b - a, "test": n - b}, "horizon_minutes": args.horizon,
        "validation_mae": {"persistence": mae(X[a:b, 0], y[a:b]), "gbr": mae(model.predict(X[a:b]), y[a:b])},
        "test_mae": {"persistence": mae(X[b:, 0], y[b:]), "gbr": mae(model.predict(X[b:]), y[b:])},
    }
    improves = result["test_mae"]["gbr"] <= 0.95 * result["test_mae"]["persistence"] and result["validation_mae"]["gbr"] < result["validation_mae"]["persistence"]
    result["trained"] = True
    result["saved"] = bool(improves)
    if improves:
        import pickle

        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.with_suffix(".pkl").write_bytes(pickle.dumps(model))
        args.out.write_text(json.dumps(result, indent=1))
    result["decision"] = "model saved" if improves else "did not beat persistence on held-out data: keep persistence-v1"
    print(json.dumps(result, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
