# Phase 2 audit - what existed before camera work started

Findings from reading the repository before changing anything (frontend at `D:\new\src`, backend at `D:\new\backend`).

## Existing camera code

| Area | State before Phase 2 |
|---|---|
| Frontend dashboard (`CameraSection`, `CameraFeedCard`, `CameraFullscreenModal`) | A 4-card grid. Each card painted a scripted canvas scene and moved fixed boxes with a sine "jitter". No network video, no real detections. Feed ids `CAM-01..04`; codes `CAM-ENT-01`, `CAM-SHF-02`, `CAM-QCK-03`, `CAM-ASL-04` come from the frontend type data. |
| Other camera widgets (`LiveCheckoutCamera`, `LiveShelfCameraMonitoring`, `CameraPreviewModal`) | Same scripted scenes; they belong to the queue / inventory / shopper phases and are **not** touched in Phase 2. |
| Backend Phase 1 | `cameras`, `camera_status`, `camera_zone_mapping`, `model_registry`, `model_health`, `inference_events` tables; `GET/POST /api/stores/{id}/cameras`; a *recorded* reconnect request (no supervisor); `POST /api/stores/{id}/ingest` for worker results. No frame source, no model, no tracker, no video gateway. |
| Camera ids in the demo seed | `CAM-01` Entrance, `CAM-02` Smart Shelf, `CAM-03` Checkout, `CAM-04` Aisle for each seeded store - the real DB is empty until a store is created or `seed-demo` is run. The code never assumes four physical cameras; cameras are rows. |
| Existing weights | `backend/ai_models/person/yolo11n.pt` (5,613,764 bytes). SHA-256 `0ebbc80d…644ee1` matches the official Ultralytics YOLO11n COCO checkpoint; it loads and detects. Licence: AGPL-3.0. |

## Hardware / environment (measured, `python -m vision` -> `GET /api/vision/status`)

* CPU AMD64 Family 25 Model 68 (AuthenticAMD), 8 physical / 16 logical cores, 23.7 GB RAM.
* GPU NVIDIA GeForce RTX 4050 Laptop (6 GB), driver 591.66. PyTorch `2.11.0+cu128` in the **project venv** uses it; no system-wide CUDA toolkit was installed or is needed (the wheel bundles the CUDA runtime).
* OpenCV 5.0.0 with FFmpeg support (RTSP / HTTP / files). `ffmpeg` and `mediamtx` binaries are **not installed**, hence no WebRTC/HLS (see report).
* Python 3.14. The venv has `include-system-site-packages = true` and currently takes `ultralytics`, `opencv-python`, `scipy`, `lap`, `psutil` from the user-site folder; `requirements-vision.txt` lists everything for a clean install.

## Decisions taken because of the audit

1. Keep the Phase 1 API and the frontend structure; add fields and endpoints, replace only the scripted video area.
2. Camera sources are **backend-managed**: `cameras.source_type/source_ref/enabled/is_demo` (migration 0002). `source_ref` is never serialised.
3. Inference runs in a separate process (`python -m vision`); the API only relays metadata and answers status queries.
4. MJPEG over HTTP with per-frame metadata is the streaming transport (works with no extra binaries and gives frame-accurate overlays); WebRTC/HLS stay optional.
5. No fake data: without a `READY` model there are no detections; without the worker, configured cameras are `offline`.
