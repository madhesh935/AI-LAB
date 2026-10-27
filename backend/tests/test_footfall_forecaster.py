"""The footfall forecaster refuses without real history and its training path runs (mechanics only: the series below is SYNTHETIC test data)."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone

import numpy as np

from scripts import train_footfall_forecaster as tf


def make_db(path, days, source="cv"):
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE footfall_aggregates (store_id TEXT, bucket_start TEXT, bucket_minutes INT, entries INT, source TEXT)")
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    rng = np.random.default_rng(0)
    for h in range(days * 24):
        t = t0 + timedelta(hours=h)
        v = int(50 + 40 * np.sin(2 * np.pi * (t.hour - 6) / 24) + (15 if t.weekday() >= 5 else 0) + rng.integers(0, 5))
        con.execute("INSERT INTO footfall_aggregates VALUES (?,?,?,?,?)", ("s1", t.isoformat(), 60, v, source))
    con.commit()
    con.close()


def test_refuses_without_two_weeks_of_real_history(tmp_path, capsys):
    make_db(tmp_path / "a.db", 5)
    assert tf.main(["--store", "s1", "--db", str(tmp_path / "a.db"), "--out", str(tmp_path / "m")]) == 3
    assert json.loads(capsys.readouterr().out)["reason"] == "insufficient real history"
    assert not (tmp_path / "m.pkl").exists()


def test_seeded_demo_rows_are_never_used(tmp_path):
    make_db(tmp_path / "d.db", 40, source="demo")
    assert tf.main(["--store", "s1", "--db", str(tmp_path / "d.db"), "--out", str(tmp_path / "m")]) == 3


def test_training_path_runs_and_only_saves_when_it_beats_the_baseline(tmp_path, capsys):
    make_db(tmp_path / "b.db", 40)
    assert tf.main(["--store", "s1", "--db", str(tmp_path / "b.db"), "--out", str(tmp_path / "m")]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["trained"] is True and set(out["test_mae"]) == {"seasonal_naive", "gbr"}
    assert (tmp_path / "m.pkl").exists() == out["saved"]
