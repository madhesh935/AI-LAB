# Phase 3 report - retail analytics engines, shelf training pipeline, smart inventory, event engine

Scope stops here: no authentication, SQLite only, frontend untouched, person detector reused (not retrained). Every number below was measured on this machine
(Windows 11, RTX 4050 Laptop, Python 3.14) by a script in `backend/scripts/` or `backend/ml/`; the "what could not be measured" sections are as important as the results.

## 1. What was built

```
worker (python -m vision)                                 API (run.py)                                SQLite (WAL)
 capture -> person detector -> ByteTrack                   POST /api/internal/vision/events
   -> CameraAnalytics (per camera)  --- events --->        -> ONE central EventEngine ---------->  footfall / visits / aggregates / heatmap
        footfall lines (hysteresis)                            validate -> dedupe -> severity       queue observations / forecasts / service samples
        zone entry/exit, dwell, transitions                    persist -> alert lifecycle           shelf observations, occupancy_state
        heatmap grid, queue monitor                            -> WebSocket (EventBus)              alerts, domain_events (durable log)
   -> shelf step (ONLY with a READY shelf model)
 geometry = rows in camera_zones / queue_regions / shelf_regions / camera_calibrations (reloaded every 5 s, nothing hardcoded)
```

| Part | Implementation |
|---|---|
| A Shopper | `analytics/{geometry,footfall,zones,heatmap,occupancy}.py`; zones with polygons + directed counting lines are DATA (`PUT/POST /camera-zones`, direction by `insidePoint`); hysteresis line counter (dead band, min track age, cooldown, segment extent, track expiry); debounced zone entry/exit, dwell = exit - entry on complete visits, transitions; camera-space heatmap + calibrated floor heatmap (DLT homography, refused without calibration); store occupancy ESTIMATE with `unknown/ok/uncertain/stale`, negative clamp, camera-loss and closing-time/manual reconciliation |
| B Queue | `analytics/{queue,waittime,forecast}.py`; queue + service regions per counter, single polygon assignment (priority, sticky), presence debounce, windowed-median smoothing, arrivals/departures, **measured** service times -> service rate; wait = (waiting + in service) / measured rate, else `unavailable` or a labelled `assumption`; persistence forecast (5/10/15 min) with congestion risk; threshold alerts with hold/clear timers and dedupe |
| C Shelf data/training | `ml/shelf/{dataset,audit,prepare,extract_frames,prelabel,train,evaluate_counts}.py` - audit, validation, near-duplicate grouping, session-level splits with leakage re-check, annotation queue, UNVERIFIED pre-labels, gated fine-tuning, val-based checkpoint, test evaluation, ONNX export + parity check, gated registration |
| D Smart inventory | `analytics/shelf.py` + worker `_shelf_step`: shelf region -> supported classes -> visible count -> availability % -> status with N-observation confirmation (`in_stock/low_stock/out_of_stock/uncertain/camera_offline`), occlusion handling, planogram comparison limited to classes the model knows; inert (`MODEL_NOT_CONFIGURED`) without a READY `shelf-monitor` model |
| E Event engine | `services/event_engine.py` (+ `alert_lifecycle.py`, `schemas/events.py`): one processor for every event type, durable ids, severity, alert lifecycle, WebSocket names `footfall.updated`, `zone.occupancy.updated`, `queue.updated`, `queue.congestion`, `shelf.observation`, `inventory.low_stock`, `inventory.out_of_stock`, `camera.disconnected` (+ Phase 2 events) |
| API | `api/analytics.py` (config, occupancy, zone/dwell analytics, heatmap, movement, queue status/history/forecast/service-rates, inventory model/observations/history/planogram-status, event log); existing `/footfall /dwell /shopper-analytics /queue-intelligence /inventory /alerts` now read real rows |
| DB | migration 0003 (verified upgrade, downgrade, re-upgrade, `alembic check`; applied to the real DB with a backup) |

## 2. Evaluation results (real footage unless stated)

### 2.1 Shopper analytics - `python scripts/evaluate_shopper.py` (people-detection.mp4, manual ground truth, SMALL sample)

Real detector + ByteTrack + the same analytics code, offline with video time. Ground truth: 3 line crossings and 2 zone visits annotated by hand from contact
sheets (`data/samples/ground_truth/people-detection.json`; tolerance about +-6 frames / +-0.25 s).

| Metric | Result |
|---|---|
| Entry count (truth 1) | measured 1 (error 0) |
| Exit count (truth 2) | measured 1 (error -1) |
| Crossing precision / recall | **1.00 / 0.67** (2 of 3), 0 false crossings, timing error +4 and +8 frames (0.3-0.7 s) |
| Missed crossing | a man first appears at the bottom edge already inside the line's dead band (x = 0.52 vs line 0.5, margin 0.025), so no reference side is established before he crosses. Real limitation of hysteresis on edge-entering tracks |
| Dwell (interior zone, 2 matched visits) | truth 2.96 s -> measured 2.58 s (-0.38 s); truth 1.50 s -> 1.17 s (-0.33 s); entry-time errors 0.04 s and 0.12 s. Both exits were *inferred* (track vanished at the zone border) - see policy below |
| Hysteresis | 0 crossings suppressed on this clip; unit tests cover jitter in the dead band, wobbling across the band, ping-pong, young tracks, out-of-extent, expiry |
| Occupancy consistency | verified by integration test (`entries - exits` through the real engine and API; status `uncertain` until a baseline reset, clamps negatives, camera loss -> uncertain/stale) - not by a head-count |

This is **one 50-second clip with 3 crossings**: it shows the pipeline works on real footage and gives error magnitudes; it is not a statistically meaningful accuracy estimate.
Dwell policy found necessary on real footage: a track that vanishes within 6 % of a zone border / the frame edge is an *inferred exit* at its last-seen time; a track lost
in the middle of a zone is counted as incomplete and excluded.

### 2.2 Queue intelligence

* **Real checkout footage: none exists here, so queue count error, wait-time MAE on real queues and real forecast error are NOT MEASURABLE.**
* `python scripts/evaluate_queue.py simulate` - the real QueueMonitor/wait/forecast code on a **simulated** single-server queue with exactly known truth
  (497 customers over 4 h, Poisson arrivals with calm/rush half-hours, 3 % random detection dropout, position jitter):

| Metric (SIMULATION, validates algorithms not the detector) | Result |
|---|---|
| Queue length error (5 s samples, n = 2,856) | MAE 0.18 customers, exact 83 %, max error 4 |
| Measured service rate | 2.80 /min vs true 2.73 /min |
| Wait estimate vs realised wait of the next arrival (non-empty queues, n = 1,122) | MAE 24.0 s (mean true wait 67 s) |
| Forecast 5 / 10 / 15 min, persistence vs fluid drift model | persistence MAE 1.93 / 2.68 / 2.99 vs fluid 2.33 / 3.57 / 4.19 - **the drift model lost** |

  **Decision from that result:** over 6 seeds, no drift variant (fluid, damped, gated by arrival/service ratio, recent-trend) beat persistence at any horizon, because arrival-rate
  estimates are noisy. So the shipped forecast is `persistence-v1` (current smoothed length + congestion risk + wait from the measured service rate); `fluid-v1` is a diagnostic only.
  The "queue is growing" alert is a *fact*, not a prediction: measured arrivals >= 1.3 x measured service capacity while a queue exists. A machine-learning forecaster
  was NOT trained: `scripts/train_queue_forecaster.py` demands >= 14 days / 2,000 real observations per counter and refuses otherwise (tested).
  The model/rule choice was made on simulated data - re-check with `backtest()` on real history.
* `python scripts/evaluate_queue.py aisle` (real aisle footage, no ground truth): with two deliberately overlapping queue polygons the total members never exceeded the people present in any of the 14 queue snapshots emitted over the 3,921-frame clip - single assignment works (a mechanics check, no ground truth).
* Alert behaviour (integration tests): a 1-second flicker raises nothing; 40 s of congestion raises ONE alert (occurrences counted), clears only after 60 s, re-congestion re-opens the same row; unreliable observations never raise; closed counters have no wait; queue-camera loss raises one queue alert.

### 2.3 Shelf / inventory

* **No labeled shelf data exists** (`PHASE3_AUDIT.md`), so: no shelf model was trained, **no precision/recall, no visible-count error, no real low-stock correctness and no planogram accuracy could be measured**. No accuracy is claimed anywhere.
* The training pipeline was validated end to end on a **synthetic fixture** (coloured rectangles; tooling test only): audit flags unlabeled images and bad labels, refuses small datasets,
  session-level splits are leakage-free (independently re-checked), pre-labels are ignored until reviewed, training refuses untrusted data, a 2-epoch loop runs, writes val/test metrics, ONNX export reproduces the PyTorch detections, and registration is refused for untrusted data (`tests/test_shelf_training.py`). The synthetic model's numbers are meaningless and are not reported.
* Inventory logic (counting, class filter, region filter, confidence filter, occlusion, confirmation, planogram unsupported-slot handling, alert dedupe/escalation/resolution, throttled persistence) is covered by unit and API tests on hand-built detections.
* What a real model needs (minimum the audit enforces): >= 300 labeled images with boxes, >= 100 instances per class, >= 5 recording sessions (so val/test never share a session), human-verified boxes; recommended first scope: 3-6 visually distinct classes (e.g. bottles / milk packs / biscuit packets) with per-image attributes (occlusion, lighting, angle) so those can be stratified.

### 2.4 System

| Measure | Result |
|---|---|
| Inference, 2 cameras, 1 viewer each, CUDA, 60 s | without analytics: median 17.8 ms, 12.0 fps each, 0 dropped; **with line + zone + queue analytics on both cameras: median 17.9 ms, 12.0 fps each, 0 dropped**, process CPU 3.5 % (without) vs 3.3 % (with), 71 extra events in 60 s |
| Event engine -> SQLite (`scripts/benchmark_events.py`, 6,000 mixed events, batches of 100) | **339 events/s**, batch latency p50 293 ms / p95 357 ms / max 422 ms, 0 rejected; a concurrent reader saw p50 1.1 ms / p99 2.7 ms (WAL does not block readers); real worker rate is < 5 events/s |
| Detector, CUDA / CPU (Phase 2) | 8.0 ms / 87 ms median per frame |
| Memory | unchanged from Phase 2 (about 1.8 GB RSS with CUDA) |

## 3. Bugs found by evaluation (and fixed)

1. UTC hour buckets misaligned with local hours in +05:30 stores -> buckets now start on the store-local hour.
2. `heatmap.flush` with a repeated cell crashed a whole event batch (UNIQUE violation) -> cells merged per payload and any integrity error now rejects only that event.
3. Service time was lost when a customer left the camera view from the service region -> inferred completion at last-seen time.
4. Tracks vanishing at a zone border produced no dwell sample -> inferred-exit policy (above).
5. Zone transitions were missed while the previous zone's exit grace was still running -> origin zone taken from the pending exit.
6. `CameraService` read the global settings instead of the app's -> API tests could see a real worker on port 8100 (hermeticity fix).
7. The drift-based forecast, written first, was worse than persistence -> replaced as default (section 2.2).

## 4. Known limitations

1. Accuracy of footfall/dwell is demonstrated on ONE short clip (3 crossings, 2 visits); line counting misses people who first appear inside the line's dead band; ID switches under crowding can create or merge crossings (anonymous ByteTrack, no re-identification).
2. Occupancy is an estimate built from crossings; it drifts with every missed/duplicate crossing and says so (`uncertain`); it needs a baseline (manual reset or closing-time reset).
3. Heatmap/zones are per-camera. Floor-plan heatmaps need a surveyed 4+ point calibration; lens distortion is not modelled (the sample fish-eye clip would need undistortion first). No cross-camera person matching exists or is claimed.
4. Queue: wait/forecast quality on real checkouts is unmeasured. Wait needs observed completed services (>= 3) or a configured labelled assumption. Cart size/items per customer are not estimated.
5. Shelf: no model, no counts. The inventory page keeps its Phase 1 data/labelled demo values until a model is registered; `/api/stores/{id}/inventory/model` says `MODEL_NOT_CONFIGURED`. Visible count is a shelf-face lower bound, not stock.
6. Planogram compliance is judged only for slots whose expected class the detector knows; broader SKU placement is not claimed.
7. Alert hold/clear timers and throttles live in API memory (reset on restart); the alerts themselves and dedupe keys are persisted.
8. SQLite is shared by two processes (fine at < 5 events/s, measured 339 events/s capacity).
9. The frontend was not changed; its pages still use built-in data until `VITE_API_URL` and the page types are aligned.
10. AGPL-3.0 licence of Ultralytics applies to the detector code/weights (see `ai_models/README.md`); sample videos are CC BY 4.0.

## 5. How to run / use

Start `python run.py` and `python -m vision`. Configure geometry as data, e.g.:

```bash
# entrance counting line: 'insidePoint' is any point known to be inside the store
curl -X POST localhost:8000/api/stores/<store>/camera-zones -H 'content-type: application/json' -d '{"cameraId":"<cam>","name":"Door","zoneType":"entrance","line":{"p1":[0.1,0.5],"p2":[0.9,0.5],"insidePoint":[0.5,0.9]}}'
# dwell zone mapped to a floor-plan zone, queue region for a counter, shelf region (needs a shelf model to produce counts)
curl -X POST .../camera-zones -d '{"cameraId":"<cam>","name":"Dairy","storeZoneId":"zone-dairy","polygon":[[0.1,0.1],[0.5,0.1],[0.5,0.6],[0.1,0.6]]}'
curl -X PUT  .../counters/<counter>/queue-region -d '{"cameraId":"<cam>","queuePolygon":[...],"servicePolygon":[...]}'
```

Endpoints are listed in `README.md` (Phase 3). Shelf training: `python -m ml.shelf.extract_frames` -> annotate -> `ml.shelf.audit` -> `ml.shelf.prepare` -> `ml.shelf.train --register` -> `ml.shelf.evaluate_counts`.

## 6. Test results

`python -m pytest` -> **127 tests** (35 Phase 1 + 38 Phase 2 + 54 Phase 3). The last full run (3 min 21 s) gave **126 passed, 1 failed**: the failure was a race in a *Phase 2* test
(`test_end_of_file_is_reported_and_releases_the_file` asserted the capture thread was already dead the instant its state flipped to END_OF_FILE). The test now waits for the
thread to finish; it passed 3 of 3 re-runs, but the complete suite was not re-run after that one-line fix.

Phase 3 tests: 27 analytics unit tests (geometry/homography, line counter jitter/ping-pong/direction/expiry, zones/dwell/censoring/inferred exits, heatmap, queue single-assignment and
measured service rates, wait-time bases, forecast, backtest, occupancy policy, shelf counting/confirmation/planogram, forecaster refusal), 18 API + event-engine tests
(configuration validation, crossings -> aggregates -> occupancy -> WebSocket, durable dedupe across a simulated restart, dwell statistics feeding the existing `/dwell`, queue persistence
throttling and alert hold/dedupe/auto-resolve/re-open, shelf alert escalation and resolution, camera-loss handling, heatmap merging), 3 real-footage pipeline tests (configuration loaded
from SQLite into a running worker; real clip -> crossings and visits -> real event engine -> SQLite -> API; reconnect resets line state) and 6 shelf-tooling tests (synthetic fixture).
Frontend untouched in Phase 3 (Phase 2 checks still apply: `tsc -b`, `oxlint` 0 errors, `npm run build`).
