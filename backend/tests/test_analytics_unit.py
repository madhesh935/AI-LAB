"""Phase 3 pure-logic tests. Trajectories here are SYNTHETIC by construction (they test the algorithms' rules,
not detector accuracy); real-footage evaluation lives in scripts/evaluate_*.py and docs/PHASE3_REPORT.md."""

from __future__ import annotations

import math
import random
from datetime import datetime, timedelta, timezone

import pytest

from analytics.footfall import LineConfig, LineCounter
from analytics.forecast import backtest, forecast_queue, predict_length
from analytics.geometry import (
    apply_homography, fit_homography, infer_in_side, point_in_polygon, polygon_area, reprojection_rmse, signed_distance,
    valid_polygon,
)
from analytics.heatmap import HeatmapGrid
from analytics.occupancy import Occupancy, OccupancyEstimator
from analytics.queue import QueueMonitor, QueueRegionCfg
from analytics.shelf import Det, ShelfCfg, Slot, StockState, compare_planogram, sample_shelf
from analytics.waittime import estimate_wait
from analytics.zones import ZoneConfig, ZoneTracker

T0 = datetime(2026, 1, 5, 9, 0, 0, tzinfo=timezone.utc)


def t(sec: float) -> datetime:
    return T0 + timedelta(seconds=sec)


# ------------------------------------------------------------------ geometry
def test_polygon_membership_area_and_validation():
    sq = [[0.2, 0.2], [0.6, 0.2], [0.6, 0.6], [0.2, 0.6]]
    assert point_in_polygon((0.4, 0.4), sq) and not point_in_polygon((0.7, 0.4), sq)
    assert polygon_area(sq) == pytest.approx(0.16)
    assert valid_polygon(sq) is None
    assert "3 points" in valid_polygon([[0, 0], [1, 1]])
    assert "within 0-1" in valid_polygon([[0, 0], [2, 0], [1, 1]])
    assert "zero" in valid_polygon([[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]])


def test_homography_recovers_a_known_mapping_and_rejects_degenerate_input():
    src = [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9), (0.5, 0.5)]
    true_h = [[2.0, 0.1, 5.0], [0.05, 3.0, 2.0], [0.01, 0.02, 1.0]]
    dst = [apply_homography(true_h, p) for p in src]
    h = fit_homography(src, dst)
    assert reprojection_rmse(h, src, dst) < 1e-6
    assert apply_homography(h, (0.3, 0.7)) == pytest.approx(apply_homography(true_h, (0.3, 0.7)), abs=1e-6)
    with pytest.raises(ValueError):
        fit_homography(src[:3], dst[:3])
    with pytest.raises(ValueError):
        fit_homography([(0.1, 0.1), (0.2, 0.2), (0.3, 0.3), (0.4, 0.4)], [(1, 1), (2, 2), (3, 3), (4, 4)])


# ------------------------------------------------------------------ footfall
def line(**kw):
    # horizontal line at y=0.5; positive side (y > 0.5 in image coords with p1->p2 left-to-right) is... computed below
    return LineCounter(LineConfig("L1", (0.1, 0.5), (0.9, 0.5), **kw))


def walk(counter, track, ys, x=0.5, step=0.1, start=0.0, age0=5):
    out = []
    for i, y in enumerate(ys):
        c = counter.update(track, (x, y), t(start + i * step), age0 + i)
        if c:
            out.append(c)
    return out


def test_direction_follows_configuration():
    # For p1=(0.1,.5)->p2=(0.9,.5) the 'positive' side is y > 0.5 (dx*(py-y1) > 0).
    assert signed_distance((0.1, 0.5), (0.9, 0.5), (0.5, 0.7)) > 0
    down = [0.2, 0.3, 0.4, 0.45, 0.55, 0.6, 0.7, 0.8]  # top -> bottom
    c = line(in_side="positive")
    r = walk(c, 1, down)
    assert [x.direction for x in r] == ["in"] and (c.entries, c.exits) == (1, 0)
    c = line(in_side="negative")
    r = walk(c, 1, down)
    assert [x.direction for x in r] == ["out"] and (c.entries, c.exits) == (0, 1)
    c = line(in_side="positive")
    assert [x.direction for x in walk(c, 2, list(reversed(down)))] == ["out"]
    assert infer_in_side((0.1, 0.5), (0.9, 0.5), (0.5, 0.9)) == "positive"


def test_jitter_inside_the_dead_band_never_counts():
    c = line()
    rnd = random.Random(1)
    ys = [0.5 + rnd.uniform(-0.02, 0.02) for _ in range(400)]  # |d| < margin(0.025)
    assert walk(c, 1, ys) == [] and (c.entries, c.exits) == (0, 0)


def test_a_track_straddling_the_line_counts_once_not_every_wobble():
    c = line()
    path = [0.30, 0.38, 0.45, 0.52, 0.47, 0.53, 0.49, 0.55, 0.51, 0.58, 0.65, 0.75, 0.80]  # wobbles across the band
    r = walk(c, 1, path)
    assert len(r) == 1 and r[0].direction == "in" and (c.entries, c.exits) == (1, 0)


def test_ping_pong_beyond_margin_is_suppressed_by_cooldown_and_counted_as_suppressed():
    c = line(cooldown_seconds=2.0, margin=0.02)
    ys = [0.3, 0.7, 0.3, 0.7, 0.3, 0.7]  # flips sides every 0.1 s (e.g. a tracker glitch)
    r = walk(c, 1, ys, step=0.1)
    assert len(r) == 1 and c.suppressed >= 3


def test_young_tracks_and_crossings_outside_the_segment_are_not_counted():
    c = line(min_track_age=10)
    assert walk(c, 1, [0.3, 0.7], age0=1) == [] and c.suppressed == 1
    c = line()
    assert walk(c, 2, [0.3, 0.7], x=0.97) == [] and c.suppressed == 1  # walked around the end of the line
    assert walk(c, 3, [0.3, 0.7], x=0.5) != []


def test_expired_tracks_are_forgotten_and_cannot_complete_an_old_crossing():
    c = line()
    walk(c, 1, [0.3, 0.35])
    assert c.live_tracks == 1 and c.expire(t(60)) == 1 and c.live_tracks == 0
    # the same id returning later starts fresh on the far side: no crossing is invented
    assert walk(c, 1, [0.7, 0.75], start=61) == []


# ------------------------------------------------------------------ zones & dwell
ZA = ZoneConfig("A", [[0.0, 0.0], [0.5, 0.0], [0.5, 1.0], [0.0, 1.0]], enter_frames=2, exit_grace_seconds=1.0, min_dwell_seconds=1.0)
ZB = ZoneConfig("B", [[0.5, 0.0], [1.0, 0.0], [1.0, 1.0], [0.5, 1.0]], enter_frames=2, exit_grace_seconds=1.0, min_dwell_seconds=1.0)


def feed(zt, track, xs, start=0.0, step=0.5):
    visits, trans = [], []
    for i, x in enumerate(xs):
        v, tr = zt.update(track, (x, 0.5), t(start + i * step))
        visits += v
        trans += tr
    return visits, trans


def test_dwell_is_exit_minus_entry_from_real_timestamps():
    zt = ZoneTracker([ZA])
    # outside (x=0.9) -> inside A from t=1.0 to t=5.0 -> outside; exit declared after 1 s grace but timed at FIRST outside obs
    xs = [0.9, 0.9, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.9, 0.9, 0.9]
    visits, _ = feed(zt, 1, xs)
    assert len(visits) == 1
    v = visits[0]
    assert v.entered_at == t(1.0) and v.exited_at == t(5.0) and v.dwell_seconds == pytest.approx(4.0)


def test_visit_censoring_expiry_and_min_dwell():
    zt = ZoneTracker([ZA])
    # track first seen INSIDE the zone: entry unobserved => excluded from dwell statistics
    visits, _ = feed(zt, 1, [0.2] * 6 + [0.9] * 4)
    assert visits == [] and zt.incomplete == 1
    # a track that disappears while inside is incomplete, never a (fake) visit
    feed(zt, 2, [0.9, 0.9, 0.2, 0.2, 0.2], start=10)
    assert zt.occupancy()["A"] == 1
    assert zt.expire(t(100)) == [] and zt.incomplete == 2 and zt.occupancy()["A"] == 0  # vanished mid-zone: no visit, just counted
    # grazing the edge for under min_dwell is not a visit
    zt2 = ZoneTracker([ZoneConfig("A", ZA.polygon, enter_frames=1, exit_grace_seconds=0.2, min_dwell_seconds=2.0)])
    assert feed(zt2, 3, [0.9, 0.2, 0.9, 0.9, 0.9])[0] == []


def test_transitions_between_zones_and_zone_occupancy():
    zt = ZoneTracker([ZA, ZB], transition_gap_seconds=6.0)
    xs = [0.2] * 2 + [0.1] * 4 + [0.9] * 6  # starts inside A (entry unseen => no dwell sample) but the A->B movement IS observed
    visits, trans = feed(zt, 1, xs, step=0.5)
    assert visits == [] and [(x.from_zone, x.to_zone) for x in trans] == [("A", "B")]
    zt = ZoneTracker([ZA, ZB])
    _, trans = feed(zt, 1, [0.9, 0.9, 0.3, 0.3, 0.3, 0.3, 0.3, 0.9, 0.9, 0.9, 0.9], step=0.5)
    assert [(x.from_zone, x.to_zone) for x in trans] == [("B", "A"), ("A", "B")]  # B -> A -> B, each observed once
    assert zt.occupancy() == {"A": 0, "B": 1}


# ------------------------------------------------------------------ heatmap
def test_heatmap_samples_per_interval_not_per_frame():
    g = HeatmapGrid(grid_w=10, grid_h=10, sample_interval_seconds=0.5)
    added = sum(g.add(1, 0.25, 0.75, t(i * 0.1)) for i in range(20))  # 2 s of frames at 10 fps
    assert added == 4
    cells = g.drain()
    assert cells == {(2, 7): 4} and g.drain() == {}
    g.add(2, 1.0, 1.0, t(5))  # clamped into the last cell
    assert (9, 9) in g.drain()


# ------------------------------------------------------------------ queue
Q1 = QueueRegionCfg("C1", [[0.0, 0.2], [0.5, 0.2], [0.5, 0.8], [0.0, 0.8]], [[0.0, 0.0], [0.5, 0.0], [0.5, 0.2], [0.0, 0.2]], priority=1)
Q2 = QueueRegionCfg("C2", [[0.3, 0.2], [0.8, 0.2], [0.8, 0.8], [0.3, 0.8]], [[0.5, 0.0], [0.8, 0.0], [0.8, 0.2], [0.5, 0.2]], priority=0)


def run_queue(qm, scripts, seconds, step=0.5):
    """scripts: {track: callable(time)->(x,y) or None}"""
    events = []
    n = int(seconds / step)
    for i in range(n + 1):
        now = i * step
        tracks = [(tid, f(now)) for tid, f in scripts.items() if f(now) is not None]
        events += qm.update(tracks, t(now))
        events += qm.expire(t(now))
    return events


def test_overlapping_queue_polygons_never_double_count_a_person():
    qm = QueueMonitor([Q1, Q2])
    # x in 0.3..0.5 is inside BOTH polygons; priority picks C1 and the choice is sticky
    scripts = {i: (lambda now, i=i: (0.4, 0.4 + 0.05 * i)) for i in range(3)}
    run_queue(qm, scripts, 10)
    s1, s2 = qm.snapshot("C1", t(10)), qm.snapshot("C2", t(10))
    assert s1.raw_length == 3 and s2.raw_length == 0
    # one person drifting right into the C2-only area leaves C1 after the grace period and joins C2 (never both)
    scripts = {1: lambda now: (0.4, 0.4) if now < 2 else (0.7, 0.4)}
    qm = QueueMonitor([Q1, Q2])
    run_queue(qm, scripts, 12)
    assert (qm.snapshot("C1", t(12)).raw_length, qm.snapshot("C2", t(12)).raw_length) == (0, 1)


def test_walkers_passing_through_are_not_queue_members_and_departures_are_reported():
    qm = QueueMonitor([Q1])
    ev = run_queue(qm, {1: lambda now: (0.2, 0.3 + 0.1 * now) if now < 1.5 else None}, 3)  # 1.5 s inside < 2 s presence
    assert [e.kind for e in ev if e.kind == "arrival"] == []
    qm = QueueMonitor([Q1])
    ev = run_queue(qm, {1: lambda now: (0.2, 0.5) if now < 10 else (0.9, 0.9)}, 15)
    kinds = [e.kind for e in ev]
    assert kinds.count("arrival") == 1 and kinds.count("departure") == 1
    assert next(e for e in ev if e.kind == "departure").reason == "left"


def test_service_time_wait_and_rates_are_measured_from_observations_only():
    qm = QueueMonitor([Q1], min_service_samples=3)
    assert qm.service_rate("C1") is None
    # five customers: each waits in the queue 4 s, is served for 20 s, then leaves
    scripts = {}
    for k in range(5):
        base = k * 30.0

        def f(now, base=base):
            if now < base:
                return None
            if now < base + 4:
                return (0.2, 0.5)  # queue
            if now < base + 24:
                return (0.2, 0.1)  # service
            return (0.9, 0.9)

        scripts[k] = f
    ev = run_queue(qm, scripts, 170)
    done = [e for e in ev if e.kind == "service_complete"]
    assert len(done) == 5 and all(abs(e.service_seconds - 20.0) <= 1.0 for e in done)
    waits = [e.wait_seconds for e in ev if e.kind == "service_start"]
    assert waits and all(w is not None and abs(w - 4.0) <= 1.0 for w in waits)
    assert qm.service_rate("C1") == pytest.approx(3.0, rel=0.1)  # 60 s / 20 s
    snap = qm.snapshot("C1", t(170))
    assert snap.service_rate_per_min == pytest.approx(3.0, rel=0.1) and snap.arrival_rate_per_min is not None


def test_smoothing_hides_a_single_frame_flicker_and_reset_clears_state():
    qm = QueueMonitor([Q1])
    base = {i: (lambda now, i=i: (0.2, 0.4 + 0.05 * i)) for i in range(3)}
    run_queue(qm, base, 8)
    assert qm.snapshot("C1", t(8)).length == 3
    # one frame where tracking drops everyone
    qm.update([], t(8.5))
    assert qm.snapshot("C1", t(8.5)).raw_length == 3  # members persist through short gaps (grace) ...
    qm.reset()
    assert qm.snapshot("C1", t(9)).raw_length == 0


# ------------------------------------------------------------------ waiting time & forecast
def test_wait_time_never_fabricates_precision():
    assert estimate_wait(4, 1, 2.0).seconds == pytest.approx(150.0) and estimate_wait(4, 1, 2.0).basis == "measured"
    unknown = estimate_wait(4, 1, None)
    assert unknown.seconds is None and unknown.basis == "unavailable"
    assumed = estimate_wait(4, 1, None, assumed_rate_per_min=1.5)
    assert assumed.basis == "assumption" and assumed.seconds == pytest.approx(200.0)
    assert estimate_wait(0, 0, None).seconds == 0.0
    assert estimate_wait(3, 1, 2.0, counter_open=False).seconds is None
    assert estimate_wait(3, 1, 2.0, reliable=False).seconds is None


def test_forecast_default_is_persistence_and_fluid_is_an_explicit_diagnostic_method():
    pts = forecast_queue(t(0), 4, 3.0, 2.0, warning_length=6, critical_length=9, in_service=1)
    assert [p.horizon_minutes for p in pts] == [5, 10, 15] and all(p.basis == "persistence" and p.predicted_length == 4 for p in pts)
    assert pts[0].model_version == "persistence-v1" and pts[0].forecast_for == t(300) and pts[0].drift_per_min == pytest.approx(1.0)
    assert pts[0].predicted_wait_seconds == pytest.approx(150.0) and pts[0].congestion_risk == "low"
    fl = forecast_queue(t(0), 4, 3.0, 2.0, warning_length=6, critical_length=9, method="fluid")
    assert fl[0].predicted_length == pytest.approx(9.0) and fl[0].congestion_risk == "high" and fl[0].model_version == "fluid-v1" and fl[0].basis == "fluid"
    assert all(p.basis == "persistence" for p in forecast_queue(t(0), 4, None, 2.0, 6, 9, method="fluid"))
    assert predict_length(2, 1.0, 3.0, 10)[0] == 0.0  # never negative
    assert forecast_queue(t(0), 2, 3.0, None, 6, 9)[0].predicted_wait_seconds is None


def test_backtest_on_a_deterministic_series_beats_or_loses_to_persistence_honestly():
    # SYNTHETIC: queue grows by (lambda-mu)=0.5/min with lambda known; the model should beat persistence.
    series = [(t(60 * i), 2 + 0.5 * i) for i in range(40)]
    r = backtest(series, [2.5] * len(series), 2.0, 5)
    assert r and r.beats_persistence and r.mae_model < 1e-9 and r.mae_persistence == pytest.approx(2.5, abs=0.01)
    # if the arrival rate knowledge is wrong the model must lose, and the metric must say so
    bad = backtest(series, [0.0] * len(series), 2.0, 5)
    assert bad and not bad.beats_persistence
    assert backtest(series[:4], [2.5] * 4, 2.0, 5) is None


# ------------------------------------------------------------------ occupancy
def test_occupancy_startup_baseline_negative_clamp_and_camera_loss():
    est = OccupancyEstimator(stale_after_minutes=10)
    occ = Occupancy()
    assert occ.status == "unknown" and occ.estimate is None
    occ = est.apply_crossing(occ, "in", t(0))
    assert (occ.estimate, occ.status) == (1, "uncertain") and "no baseline" in occ.reason
    occ = est.reset(occ, t(1), 0, "store opening")
    assert (occ.estimate, occ.status) == (0, "ok")
    for i in range(3):
        occ = est.apply_crossing(occ, "in", t(2 + i))
    occ = est.apply_crossing(occ, "out", t(10))
    assert (occ.estimate, occ.entries, occ.exits, occ.status) == (2, 3, 1, "ok")
    occ = est.apply_crossing(est.apply_crossing(occ, "out", t(11)), "out", t(12))
    occ = est.apply_crossing(occ, "out", t(13))  # third exit with nobody left -> proof of a missed entry
    assert occ.estimate == 0 and occ.negative_clamps == 1 and occ.status == "uncertain"
    # reset policy clears it
    assert est.reset(occ, t(20), 5, "manual head-count").status == "ok"
    with pytest.raises(ValueError):
        est.reset(occ, t(20), -1)
    # camera loss: uncertain immediately, stale after the limit, stays uncertain after recovery until a reset
    occ = est.reset(Occupancy(), t(0), 7)
    occ = est.camera_lost(occ, t(100))
    assert occ.status == "uncertain" and est.evaluate(occ, t(100 + 60)).status == "uncertain"
    assert est.evaluate(occ, t(100 + 11 * 60)).status == "stale"
    occ = est.camera_restored(occ, t(1000))
    assert occ.status == "uncertain" and "was offline" in occ.reason
    assert est.reset(occ, t(1001), 7).status == "ok"
    with pytest.raises(ValueError):
        est.apply_crossing(occ, "sideways", t(0))


# ------------------------------------------------------------------ shelf
SHELF = ShelfCfg("S1", [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]], {"cola": "prod-cola", "juice": "prod-juice"}, expected_capacity=10, confirm_n=3)


def bottles(n, cls="cola", conf=0.8, y=0.4):
    return [Det(cls, conf, 0.12 + 0.07 * i, y, 0.05, 0.2) for i in range(n)]


def test_shelf_counts_only_supported_classes_inside_the_region_above_min_confidence():
    dets = bottles(6) + bottles(2, "juice") + [Det("person_like", 0.9, 0.5, 0.5, 0.1, 0.1), Det("cola", 0.2, 0.5, 0.5, 0.05, 0.1), Det("cola", 0.9, 0.95, 0.5, 0.02, 0.1)]
    s = sample_shelf(SHELF, dets, [], t(0))
    assert s.count == 8 and s.per_class == {"prod-cola": 6, "prod-juice": 2} and s.availability_pct == 80.0 and s.raw_status == "in_stock"
    assert 0.8 <= s.mean_confidence <= 0.81 and len(s.boxes) == 8


def test_shelf_status_thresholds_occlusion_and_missing_model():
    assert sample_shelf(SHELF, bottles(2), [], t(0)).raw_status == "low_stock"
    assert sample_shelf(SHELF, [], [], t(0)).raw_status == "out_of_stock"
    person = [(0.1, 0.1, 0.8, 0.8)]  # a person covering the shelf: an empty reading is NOT evidence of an empty shelf
    s = sample_shelf(SHELF, [], person, t(0))
    assert s.raw_status == "uncertain" and "lower bound" in s.reason
    assert sample_shelf(SHELF, bottles(8), person, t(0)).raw_status == "in_stock"  # a lower bound that is already healthy
    ns = sample_shelf(SHELF, bottles(5), [], t(0), model_ready=False)
    assert ns.raw_status == "uncertain" and ns.reason == "MODEL_NOT_CONFIGURED" and ns.count == 0 and ns.availability_pct is None
    zero_cap = ShelfCfg("S2", SHELF.polygon, SHELF.class_map, expected_capacity=0)
    assert sample_shelf(zero_cap, bottles(3), [], t(0)).raw_status == "uncertain"


def test_stock_alerts_need_repeated_confirmation_and_recover_the_same_way():
    st = StockState(confirm_n=3)
    assert [st.feed("in_stock")[0] for _ in range(3)][-1] == "in_stock"
    assert st.feed("out_of_stock") == ("in_stock", False)  # one empty frame (a hand, a glare) changes nothing
    assert st.feed("in_stock") == ("in_stock", False)
    assert [st.feed("out_of_stock")[1] for _ in range(3)] == [False, False, True]
    assert st.confirmed == "out_of_stock"
    st.feed("uncertain"), st.feed("uncertain")
    assert st.confirmed == "out_of_stock"  # a couple of uncertain samples neither confirm nor clear
    assert [st.feed("in_stock")[1] for _ in range(3)] == [False, False, True]
    s2 = StockState(confirm_n=3, uncertain_after=4)
    for _ in range(3):
        s2.feed("in_stock")
    assert [s2.feed("uncertain")[1] for _ in range(4)] == [False, False, False, True] and s2.confirmed == "uncertain"


def test_planogram_compliance_never_judges_unsupported_classes():
    slots = [Slot("a", (0.1, 0.1, 0.2, 0.8), "cola"), Slot("b", (0.3, 0.1, 0.2, 0.8), "juice"), Slot("c", (0.5, 0.1, 0.2, 0.8), "cola"), Slot("d", (0.7, 0.1, 0.2, 0.8), "biscuit")]
    dets = [Det("cola", 0.9, 0.15, 0.3, 0.05, 0.2), Det("cola", 0.9, 0.35, 0.3, 0.05, 0.2), Det("juice", 0.9, 0.85, 0.3, 0.04, 0.2)]
    r = compare_planogram(slots, dets, {"cola", "juice"}, SHELF.polygon)
    states = {s.slot_id: s.state for s in r.slots}
    assert states == {"a": "compliant", "b": "wrong_category", "c": "missing_product", "d": "unsupported"}
    assert r.supported_slots == 3 and r.total_slots == 4 and r.compliance_pct == pytest.approx(33.3)
    assert r.unexpected and r.unexpected[0][0] == "juice"
    none = compare_planogram([Slot("x", (0, 0, 1, 1), "biscuit")], dets, {"cola"})
    assert none.compliance_pct is None and none.note


def test_a_track_that_vanishes_at_the_zone_border_is_an_inferred_exit_not_a_lost_visit():
    zt = ZoneTracker([ZoneConfig("A", [[0.0, 0.0], [0.5, 0.0], [0.5, 1.0], [0.0, 1.0]], enter_frames=2, exit_margin=0.06)])
    feed(zt, 1, [0.9, 0.9, 0.3, 0.35, 0.4, 0.45, 0.47], step=0.5)  # walks toward the zone's right border (x=0.5) and disappears there
    out = zt.expire(t(60))
    assert len(out) == 1 and out[0].exit_inferred and out[0].entered_at == t(1.0) and out[0].exited_at == t(3.0) and zt.incomplete == 0
    feed(zt, 2, [0.9, 0.9, 0.2, 0.2, 0.2, 0.2], start=70, step=0.5)  # vanishes in the middle: incomplete
    assert zt.expire(t(200)) == [] and zt.incomplete == 1


def test_service_that_ends_by_leaving_the_camera_view_is_still_measured():
    qm = QueueMonitor([Q1], min_service_samples=1)
    ev = run_queue(qm, {1: lambda now: (0.2, 0.5) if now < 4 else ((0.2, 0.1) if now < 24 else None)}, 40)  # vanishes while in the service region
    done = [e for e in ev if e.kind == "service_complete"]
    assert len(done) == 1 and abs(done[0].service_seconds - 20.0) <= 1.0
    assert qm.service_rate("C1") == pytest.approx(3.0, rel=0.1)


def test_queue_forecaster_training_refuses_without_real_history(tmp_path):
    import json as _json
    import subprocess
    import sys

    from core.config import BACKEND_DIR
    from database import manage
    from tests.conftest import make_settings

    s = make_settings(tmp_path)
    manage.upgrade(s)
    r = subprocess.run([sys.executable, str(BACKEND_DIR / "scripts" / "train_queue_forecaster.py"), "--counter", "cnt-x", "--db", str(s.db_path)],
                       capture_output=True, text=True)
    assert r.returncode == 3
    out = _json.loads(r.stdout)
    assert out["trained"] is False and out["reason"] == "insufficient real history" and "persistence" in out["decision"]


def test_one_direction_lines_never_count_the_other_way():
    """An entrance line counts only 'in', an exit line only 'out' (so a webcam shared by both cameras never counts a person twice)."""
    from datetime import datetime, timedelta, timezone

    from analytics.footfall import LineConfig, LineCounter

    def run(count_only):
        c = LineCounter(LineConfig("l", (0.5, 0.0), (0.5, 1.0), in_side="positive", margin=0.02, min_track_age=1, cooldown_seconds=0, count_only=count_only))
        t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
        for i, x in enumerate([0.2, 0.3, 0.8, 0.9, 0.3, 0.2]):  # cross to the right (in), then back to the left (out)
            c.update(1, (x, 0.5), t0 + timedelta(seconds=i), 10)
        return c.entries, c.exits

    assert run(None) == (1, 1)
    assert run("in") == (1, 0)
    assert run("out") == (0, 1)


def test_reference_point_uses_the_box_middle_when_cut_off_by_the_bottom_edge():
    from analytics.geometry import foot_point, reference_point

    assert reference_point(0.2, 0.3, 0.2, 0.4) == foot_point(0.2, 0.3, 0.2, 0.4)  # whole person visible: feet
    x, y = reference_point(0.3, 0.2, 0.4, 0.8)  # touches the bottom: feet are outside the picture
    assert abs(x - 0.5) < 1e-9 and abs(y - 0.6) < 1e-9
