"""Evaluate footfall counting and dwell time on a recorded clip against manual ground truth.

    python scripts/evaluate_shopper.py [--video people-detection.mp4] [--device auto]

Runs the REAL detector + ByteTrack + the same analytics engines the worker uses, offline, with VIDEO time as the clock
(frame_index / fps) so the result does not depend on how fast the machine decodes. Ground truth lives in
data/samples/ground_truth/<video>.json (manual annotation; see its `limitations`).
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import cv2  # noqa: E402

from analytics.footfall import LineConfig  # noqa: E402
from analytics.geometry import infer_in_side  # noqa: E402
from analytics.zones import ZoneConfig  # noqa: E402
from vision.analytics_runtime import CameraAnalytics, CameraAnalyticsConfig, TrackIn  # noqa: E402
from vision.device import select_device  # noqa: E402
from vision.registry import ModelRegistry  # noqa: E402
from vision.tracker import CameraTracker  # noqa: E402

SAMPLES = ROOT / "data" / "samples"
T0 = datetime(2026, 1, 1, 9, 0, 0, tzinfo=timezone.utc)


def run_offline(video: Path, cfg: CameraAnalyticsConfig, device: str):
    """Yield (frame_index, at, tracks, events) for every frame; also returns fps."""
    reg = ModelRegistry.from_file(device)
    reg.load_all()
    det = reg.get_ready("person_detection").instance
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 12.0
    tracker, analytics = CameraTracker(), CameraAnalytics(cfg)
    results, events, i = [], [], 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        h, w = frame.shape[:2]
        at = T0 + timedelta(seconds=i / fps)
        raw = det.detect(frame)
        tracks = tracker.update(raw.xyxy, raw.conf, raw.cls, at)
        tin = [TrackIn(t.track_id, t.x1 / w, t.y1 / h, (t.x2 - t.x1) / w, (t.y2 - t.y1) / h, t.age_frames) for t in tracks]
        evs = analytics.process(tin, at)
        for e in evs:
            e["frame"] = i
        events += evs
        results.append((i, at, tin))
        i += 1
    end = T0 + timedelta(seconds=i / fps)
    if analytics.zones is not None:  # end of clip: let every still-open track expire exactly as it would live (TTL 5 s)
        for v in analytics.zones.expire(end + timedelta(seconds=60)):
            events.append({"type": "zone.visit", "frame": i, "at": end, "payload": {"cameraZoneId": v.zone_id, "trackRef": v.track_id,
                           "enteredAt": v.entered_at.isoformat(), "exitedAt": v.exited_at.isoformat(), "dwellSeconds": round(v.dwell_seconds, 2), "exitInferred": True}})
    events += [dict(e, frame=i) for e in analytics.flush(T0 + timedelta(seconds=i / fps))]
    return results, events, fps, analytics


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", default="people-detection.mp4")
    ap.add_argument("--device", default="auto")
    ap.add_argument("--tolerance-frames", type=int, default=8)
    args = ap.parse_args()
    gt = json.loads((SAMPLES / "ground_truth" / (Path(args.video).stem + ".json")).read_text())
    ln = gt["line"]
    in_side = infer_in_side(tuple(ln["p1"]), tuple(ln["p2"]), tuple(ln["inside_point"]))
    cfg = CameraAnalyticsConfig(
        camera_id="eval",
        lines=[LineConfig("line", tuple(ln["p1"]), tuple(ln["p2"]), in_side=in_side)],
        zones=[ZoneConfig(gt["dwell_zone"]["id"], gt["dwell_zone"]["polygon"], exit_grace_seconds=1.0, min_dwell_seconds=0.5)],
    )
    results, events, fps, analytics = run_offline(SAMPLES / args.video, cfg, select_device(args.device))
    cross = [(e["frame"], e["payload"]["direction"]) for e in events if e["type"] == "footfall.crossing"]
    truth = [(c["frame"], c["direction"]) for c in gt["crossings"]]

    # match each ground-truth crossing to the nearest unmatched system crossing of the same direction within tolerance
    used, tp, errs = set(), 0, []
    for f, d in truth:
        best = min((j for j, (g, dd) in enumerate(cross) if dd == d and j not in used), key=lambda j: abs(cross[j][0] - f), default=None)
        if best is not None and abs(cross[best][0] - f) <= args.tolerance_frames:
            used.add(best)
            tp += 1
            errs.append(cross[best][0] - f)
    fp = len(cross) - len(used)
    fn = len(truth) - tp
    ent = sum(1 for _, d in cross if d == "in")
    ext = sum(1 for _, d in cross if d == "out")
    gt_in = sum(1 for _, d in truth if d == "in")
    gt_out = sum(1 for _, d in truth if d == "out")

    visits = [e["payload"] for e in events if e["type"] == "zone.visit"]
    dwell_rows = []
    for v in gt["zone_visits"]:
        t_in = v["enter_frame"] / fps
        cand = [x for x in visits if abs((datetime.fromisoformat(x["enteredAt"]) - T0).total_seconds() - t_in) < 2.0]
        if cand:
            best = min(cand, key=lambda x: abs((datetime.fromisoformat(x["enteredAt"]) - T0).total_seconds() - t_in))
            m_in = (datetime.fromisoformat(best["enteredAt"]) - T0).total_seconds()
            dwell_rows.append({"who": v["who"][:40], "truth_s": v["seconds"], "measured_s": best["dwellSeconds"], "error_s": round(best["dwellSeconds"] - v["seconds"], 2),
                               "entry_time_error_s": round(m_in - t_in, 2)})
        else:
            dwell_rows.append({"who": v["who"][:40], "truth_s": v["seconds"], "measured_s": None, "error_s": None})

    report = {
        "video": args.video, "frames": len(results), "line_in_side": in_side, "tolerance_frames": args.tolerance_frames,
        "ground_truth": {"entries": gt_in, "exits": gt_out},
        "measured": {"entries": ent, "exits": ext, "suppressed_by_hysteresis": analytics.stats()["lineSuppressed"]},
        "crossing_matches": {"true_positive": tp, "false_positive": fp, "false_negative": fn,
                             "precision": round(tp / (tp + fp), 3) if tp + fp else None, "recall": round(tp / (tp + fn), 3) if tp + fn else None,
                             "timing_error_frames": errs},
        "system_crossings": cross, "truth_crossings": truth,
        "entry_count_error": ent - gt_in, "exit_count_error": ext - gt_out,
        "dwell": dwell_rows, "all_zone_visits": [{"enter_s": round((datetime.fromisoformat(v["enteredAt"]) - T0).total_seconds(), 2), "dwell_s": v["dwellSeconds"]} for v in visits],
        "incomplete_visits": analytics.stats()["incompleteZoneVisits"],
        "note": gt["limitations"],
    }
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
