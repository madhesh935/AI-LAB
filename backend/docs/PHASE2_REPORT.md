# Phase 2 report - camera backend, real inference, tracking, live video

Scope stops here: no shopper journeys, queue or shelf business logic, no authentication, no PostgreSQL.
Everything below was run on this machine (Windows 11, RTX 4050 Laptop, Python 3.14); numbers are measured, not estimated.

## 1. What was built

```
frontend  --HTTP JSON-->  API (run.py :8000)  <--loopback metadata--  vision worker (python -m vision :8100)
   |                         | SQLite (WAL)  <----------------------------+   capture thread per camera
   +----MJPEG (fetch stream, per-frame metadata)-----------------------------+   -> bounded queue (2, drop-oldest)
                                                                              -> inference thread (1 model instance)
                                                                              -> ByteTrack per camera -> metadata events
```

| Piece | Files |
|---|---|
| Hardware detection + device choice (CUDA if PyTorch can use it, else CPU; no system CUDA) | `vision/device.py` |
| Central model registry (`ai_models/configs/models.json`, SHA-256 check, statuses `NOT_CONFIGURED/LOADING/READY/ERROR/DISABLED`, load once per worker, warm-up) | `vision/registry.py` |
| Person detector: own letterbox -> FP16 forward (CUDA-graph replay) -> NMS -> person class only -> boxes scaled back to source pixels | `vision/detector.py` |
| ByteTrack (Ultralytics implementation) with **per-camera** id counters, reset on reconnect/loop, expiry of lost tracks | `vision/tracker.py` |
| Sources: USB, RTSP, HTTP/MJPEG, local file, validation, credential redaction, error codes | `vision/sources.py`, `vision/source_validation.py` |
| Capture workers, bounded queues, frame dropping, reconnect with backoff, EOF, resource release, round-robin inference, throttled persistence | `vision/engine.py`, `vision/persistence.py` |
| Worker HTTP: MJPEG gateway, snapshot, status, loopback-only control; single-instance guard (port) | `vision/server.py`, `vision/__main__.py` |
| Metadata outbox (bounded, never blocks inference) -> API -> WebSocket EventBus | `vision/outbox.py`, `services/vision.py`, `api/vision.py` |
| Contracts | `vision/schemas.py`, `schemas/vision.py` |
| DB migration 0002 (camera source columns, status stats, `camera_status_events`, registry columns + status CHECK) | `database/migrations/versions/0002_*.py` |
| Frontend: `LiveVideoCanvas`, `liveCameraService`, wired into the existing dashboard card/modal | `src/components/dashboard/*`, `src/services/liveCameraService.ts` |
| Benchmark | `scripts/benchmark_vision.py` |

### Model and checkpoint

`person-yolo11n` = official Ultralytics **YOLO11n COCO** checkpoint (`ai_models/person/yolo11n.pt`, 5,613,764 bytes, SHA-256
`0ebbc80d4a7680d14987a577cd21342b65ecfd94632bd9a8da63ae6417644ee1`, verified at every load). Input 640 px long side, confidence 0.35,
NMS IoU 0.5, class 0 only. **Nothing was trained.** The checkpoint was loaded, run on 596 frames of real video, and its boxes were compared
with Ultralytics' own `predict()` (11/11 sampled boxes agree at IoU > 0.9, GPU and CPU).

### Detection schema (`DetectionFrame`, pydantic)

`eventId, frameId, cameraId, storeId, sourceTimestamp, modelId, modelVersion, frameWidth, frameHeight, inferenceMs, peopleCount, mode ("real"),
isDemoFootage, detections[{objectClass:"person", trackId, confidence, bbox{x,y,w,h normalised, top-left}, bboxPx, firstSeen, lastSeen, ageFrames}]`.
Track ids are anonymous, camera-local integers; there is no face data, embedding or cross-camera identity. Individual boxes are **not** stored in SQLite.

### Streaming

MJPEG (`multipart/x-mixed-replace`) from the worker straight to the browser. Each part has `X-Frame-Meta` with that frame's id/timestamp, size, FPS
and the overlay computed for it (`overlay.frameId`, `lagFrames`, boxes). The browser draws video and boxes on one canvas from the same part, so
boxes are always aligned to the frame they belong to; an overlay older than 8 source frames is hidden instead of drawn misaligned. The browser never
sees an RTSP URL or credentials; the stream descriptor from the API is `{kind:"mjpeg", url:"http://127.0.0.1:8100/stream/<id>.mjpg"}`.

## 2. Measured performance (this machine)

Sample: `people-detection.mp4`, 768x432, 12 FPS, 596 frames. Script: `python scripts/benchmark_vision.py ...`.

| Test | CUDA (RTX 4050, FP16 + CUDA graph) | CPU (8 threads) |
|---|---|---|
| Model load + warm-up | 24-30 s (CUDA init + 4 shape graphs) | 1.4 s |
| Detector latency per frame, p50 / p95 | **8.0 ms / 16.4 ms** (pre 2.5, model 2.1, post 2.2) | **87 ms / 94 ms** (model 83) |
| Detector throughput (no video pacing) | **88 FPS** | **11.3 FPS** |
| Pipeline, 1 camera at 12 FPS source | - | inference 11.3 FPS, median 86 ms, 16 frames dropped in 20 s (CPU cannot keep 12 FPS) |
| Pipeline, 2 cameras, 1 viewer each (JPEG encode), 60 s | input 12.0 FPS each, inference 12.0 FPS each, median 17.9 ms, **2 dropped frames**, 0 reconnects, GPU 28 % mean | - |
| Process memory | 1.78 GB RSS (torch + CUDA context), flat over the run | 0.74 GB |

**Soak, 300 s, 2 cameras + 1 MJPEG viewer each, CUDA:** both cameras `live` the whole time, input 12.0 FPS and inference 12.0 FPS per camera,
median inference 16.6 ms (worst 2-s window median 27.9 ms), 1 dropped frame, 0 reconnects, process CPU 3.3 % of the machine, GPU 25 % mean (2.4 GB used),
RSS 1,777 -> 1,782 MB (no leak visible), 2,167 metadata events emitted, 0 database write errors.

**Resilience in the browser (Playwright, real worker process killed and restarted):** the card flipped to OFFLINE 1.6 s after the worker died;
after restart the stream reconnected by itself and video was moving again 29 s later (almost all of it Python/torch start-up + model warm-up).
A second `python -m vision` while one is running refuses to start (exit code 3, "not starting a duplicate").
An HTTP-MJPEG camera pointed at the worker's own loopback stream went `live` and was inferred at 12 FPS (this exercises the `http` source path; it is not a
third-party IP camera).

Notes that matter:

* An eager PyTorch forward of YOLO11n took ~41 ms here because the Python/CPU side is launch-bound (~62 us per tiny kernel). CUDA-graph replay
  gives ~1.6 ms forward with bit-identical output, which is why the detector captures one graph per input shape (each with its own copy of the
  network: sharing one module made the YOLO head free anchors an earlier graph still used and produced **zero detections** - caught by the
  pipeline test, now covered by a regression test).
* On CPU the inference thread needs an explicit `torch.set_num_threads` (OpenMP counts are per thread); without it the same work took 196 ms instead of 86 ms.
* "Detections per second" depends on the footage: this clip contains 0-4 people and averages 0.6 per frame.

## 3. Verification performed

* **Backend tests: see section 6 (all passing).** Real model + real video: tracked detections with stable ids, bounding boxes in range, no pixels in events,
  no identity fields, EOF handling, file-handle release (the clip can be deleted after stop), unreachable RTSP with backoff and credential redaction,
  missing USB device code, invalid source (no retry loop), disabled/unconfigured cameras start no thread, reconnect resets track ids, DB writes throttled
  and no per-box rows, no detections when no model is READY, MJPEG parts parse and carry frame-synced overlay, viewer count released.
* **API tests (worker not running):** validation codes, `sourceRef`/credentials absent from every response and from `openapi.json`, configured cameras
  reported `offline`/`WORKER_OFFLINE` (even if SQLite still says `live`), models never `READY` without a worker, event relay to the WebSocket with dedupe.
* **Real end-to-end run** (API :8010 + worker :8110, seeded store, scratch DB): 2 demo cameras `live` with real detections, 1 unreachable RTSP camera
  (`offline`, `CONNECT_FAILED`, no credentials in any response/DB row/request), 1 unconfigured camera; WebSocket delivered `camera.frame`,
  `person.detected`, `camera.connected/disconnected`; SQLite held the model row (`READY`, `cuda:0`, checksum), status rows, transitions and `model_health`; zero `inference_events`.
* **Browser (Playwright/Chrome):** cards show MJPEG video, DEMO + LIVE badges, measured FPS/latency/people; overlay pixels appear only with the toggle on;
  fullscreen drawer shows measured video FPS, AI FPS, latency, resolution, model, last inference and the track list; no request contained a secret.

## 4. Known limitations (honest list)

1. **Only recorded footage and failure paths were exercised.** No physical CCTV camera, USB webcam or RTSP server was available/used: RTSP and USB are verified for
   error handling (unreachable host, missing device) but **not** against a working live source. The webcam was deliberately not opened without being asked.
   Nothing here claims accuracy on a real store feed; the demo camera is labelled DEMO.
2. WebRTC/HLS are not implemented (no FFmpeg/MediaMTX installed); MJPEG is used. MJPEG costs more bandwidth than H.264 and is capped by `RETAILEDGE_VISION_STREAM_FPS/WIDTH`.
   Descriptor `alternatives` is empty on purpose.
3. **Licence:** Ultralytics YOLO11 code and weights are AGPL-3.0. Fine for internal use; redistribution / network service needs AGPL compliance or a commercial
   licence (see `ai_models/README.md`). Sample video is CC BY 4.0 (Intel).
4. The worker is one process with one inference thread shared by all cameras (fair round-robin). On CPU, ~11 FPS total; on this GPU ~88 FPS total. No multi-GPU/batching.
5. ByteTrack uses no appearance features: a person leaving and re-entering gets a new id after the 30-frame buffer; crowded occlusion can swap ids. That is intended (no re-identification).
6. Overlay lag: boxes come from the latest finished inference (<= `inferenceFps` interval old, typically 1 frame); beyond 8 frames they are hidden.
7. The frontend reads cameras only when `VITE_CAMERA_API_URL` is set; without it the previous placeholder scenes remain. The queue, inventory and shopper-preview
   camera widgets still use placeholder scenes (their phases come later). The dashboard WebSocket is not yet consumed by the UI (cameras poll every 2 s).
8. Camera tuning (`inferenceFps`, `streamWidth`) updates live for streaming; source changes restart that camera's worker. `playbackSpeed`/`loop` are config-only (used by tests).
9. The venv depends on user-site packages (`include-system-site-packages = true`); use `requirements-vision.txt` for a clean machine.
10. SQLite is shared between two processes (WAL, short transactions, 5 s busy timeout); fine for this load, not a substitute for a server database.

## 5. How to run

See `README.md` ("Phase 2"). Short version: `python run.py`, `python -m vision`, configure a camera with `PUT /api/cameras/{id}/source`, build the
frontend with `VITE_CAMERA_API_URL=http://127.0.0.1:8000`.

## 6. Test results

`python -m pytest` -> **73 passed** (2 min 15 s): the 35 Phase 1 tests (one assertion updated on purpose: reconnect on a camera with no source now says so
instead of claiming a supervisor) + 17 unit tests (tracker isolation/expiry, source validation, redaction, bounded queue, device fallback, registry statuses,
shipped config) + 11 pipeline tests (real model + real video, listed in section 3) + 10 API tests.

Frontend: `tsc -b` clean, `oxlint` 0 errors, `npm run build` succeeds, the 9 main routes render without console errors, and the dashboard without
`VITE_CAMERA_API_URL` still shows the original placeholder cards and makes no camera requests.

The API process imports none of torch / cv2 / ultralytics (checked), so inference can never run on a request thread.
The real `data/retailedge.db` was upgraded 0001 -> 0002 (backup in `data/backups/`).
