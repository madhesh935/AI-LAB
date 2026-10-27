"""Forecast from stored values: needs >= 3 complete previous days, states its basis, reports backtest error, never invents a history."""

from __future__ import annotations

from database.seed import seed_footfall_history

STORE = "store-blr-104"


def test_no_history_means_no_forecast_and_an_honest_reason(seeded):
    from database.connection import Database
    from database.models import FootfallAggregate

    db = Database(seeded.settings.database_url)
    with db.transaction() as s:
        for r in list(s.query(FootfallAggregate).filter(FootfallAggregate.store_id == STORE)):
            s.delete(r)
    db.dispose()
    fc = seeded.get(f"/api/stores/{STORE}/insights").json()["footfallForecast"]
    assert fc["available"] is False and fc["requiredDays"] == 14 and "forecast" in fc["reason"].lower()


def test_forecast_from_stored_history_is_labelled_and_backtested(seeded):
    assert seed_footfall_history(seeded.settings, days=7)["inserted"] > 0
    assert seed_footfall_history(seeded.settings, days=7)["inserted"] == 0, "idempotent"
    fc = seeded.get(f"/api/stores/{STORE}/insights").json()["footfallForecast"]
    assert fc["available"] is True and fc["daysUsed"] == 7 and fc["includesDemoHistory"] is True and fc["basis"] == "stored_values"
    assert fc["points"] and all(p["lowerConfidence"] <= p["forecastTraffic"] <= p["upperConfidence"] or fc["methodChosen"] == "latest_day" for p in fc["points"])
    assert fc["historicalReliabilityMae"] is not None and fc["averageMethodMaePct"] is not None and fc["latestDayMethodMaePct"] is not None
    assert sum(1 for p in fc["points"] if p["isPeakHour"]) == 1


def test_footfall_change_is_not_computed_against_demo_history(seeded):
    seed_footfall_history(seeded.settings, days=7)
    f = seeded.get(f"/api/stores/{STORE}/shopper-analytics?range=today").json()
    assert f["meta"]["dataState"] in ("available", "empty", "unavailable")
    o = seeded.get(f"/api/stores/{STORE}/overview").json()["metrics"]
    assert o["footfallChangePercentage"] is None, "no camera-counted previous period exists, so no % change is shown"
