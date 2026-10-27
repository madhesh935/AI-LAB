# RetailEdge AI - backend (Phases 1-4)

FastAPI + SQLAlchemy 2 + Alembic + SQLite. **No authentication** (controlled local demonstration):
binds to `127.0.0.1`, CORS limited to the Vite dev origin, write requests size/rate limited.
Do not expose it to the public internet.

## Quick start (Windows / PowerShell or Git Bash)

```bash
cd backend
python -m venv .venv                                  # project venv - global Python is never touched
.venv/Scripts/python -m pip install -r requirements-dev.txt
cp .env.example .env                                  # optional

.venv/Scripts/python -m database.manage setup         # backup (if a DB exists) + migrate to head
.venv/Scripts/python -m database.manage seed-demo     # OPTIONAL, explicit opt-in demo data
.venv/Scripts/python run.py                           # http://127.0.0.1:8000  (docs at /docs)
.venv/Scripts/python -m pytest                        # full suite (needs the vision dependencies and data/samples/people-detection.mp4)
```

Run the frontend as before (`npm run dev`, http://localhost:5173). To make it use this backend set
`VITE_API_URL=http://127.0.0.1:8000` (not required in Phase 1; the frontend is unchanged).

## Phase 2 - cameras, real inference, tracking, live video

Two processes run side by side (never inside the API's request threads, never started by its autoreloader):

```bash
.venv/Scripts/python run.py            # API            http://127.0.0.1:8000
.venv/Scripts/python -m vision         # vision worker  http://127.0.0.1:8100  (video gateway + inference)
```

Install the extra dependencies once into the project venv (see `requirements-vision.txt`; CUDA is picked up
automatically when present, otherwise the worker runs on CPU).

Point a camera at a source (the reference is **write-only**; no endpoint ever returns it):

```bash
curl -X PUT localhost:8000/api/cameras/<id>/source -H 'content-type: application/json'   -d '{"sourceType":"file","sourceRef":"people-detection.mp4","enabled":true,"isDemo":true}'
# sourceType: usb ("0") | rtsp ("rtsp://user:pass@host/path") | http (MJPEG URL) | file (under data/samples or data/media)
```

The worker notices within ~5 s (or `POST /api/vision/reload`). Then open the dashboard built with
`VITE_CAMERA_API_URL=http://127.0.0.1:8000` (leave `VITE_API_URL` unset).

| Endpoint | Purpose |
|---|---|
| `GET /api/cameras[?storeId=]`, `/api/cameras/{id}` | camera + measured live numbers + stream descriptor |
| `GET /api/cameras/{id}/status` | state, error code, FPS, latency, drops, recent transitions |
| `GET /api/cameras/{id}/stream` | descriptor only (`mjpeg`, URL on the worker, no credentials) |
| `GET /api/cameras/{id}/detections` | latest anonymous tracked persons + short history; `available:false` + reason when nothing was inferred |
| `PUT /api/cameras/{id}/source` | configure source (write-only reference) |
| `GET /api/models/status` | registry status per model (`READY` only while a worker holds it in memory) |
| `GET /api/vision/status`, `POST /api/vision/reload` | worker health / re-read cameras |
| worker `GET /stream/{id}.mjpg`, `/snapshot/{id}.jpg` | MJPEG video; each part carries its own frame metadata + overlay |

WebSocket (`/ws/stores/{id}/events`) adds `camera.connected`, `camera.disconnected`, `camera.frame`
(detections metadata, never pixels), `person.detected` (new anonymous track), `model.ready`, `model.error`;
each has `eventId`, `seq`, `occurredAt`. The worker posts them to `POST /api/internal/vision/events` (loopback only).

Truth rules: a configured camera is reported `offline` (`WORKER_OFFLINE`) when the worker is not running; fps /
latency / people are `null` unless measured; no detections exist unless a model is `READY`; track ids are
camera-local integers with no identity. Details, measurements and limits: `docs/PHASE2_REPORT.md`.

## Phase 3 - retail analytics, queue intelligence, shelf inference, central event engine

Geometry is data. Configure it through the API and the worker applies it within ~5 s:

| What | Endpoint |
|---|---|
| Zones / counting lines (camera space, normalised) | `GET/POST /api/stores/{s}/camera-zones`, `PUT/DELETE .../camera-zones/{id}` (`insidePoint` sets entry direction) |
| Floor-plan calibration (4+ point pairs) | `PUT/GET/DELETE /api/stores/{s}/cameras/{c}/calibration` |
| Queue region per counter | `PUT/DELETE /api/stores/{s}/counters/{id}/queue-region`, `GET /queue/regions` |
| Shelf region, class map, thresholds, planogram slots | `PUT/DELETE /api/stores/{s}/shelves/{id}/region`, `GET /inventory/shelf-regions` |
| Occupancy estimate / reconcile | `GET /occupancy`, `POST /occupancy/reset` |
| Dwell, heatmap, movement | `GET /zones/analytics`, `/heatmap?cameraId=&mode=camera|floor`, `/movement`, `/footfall/events` |
| Queue | `GET /queue/status`, `/queue/history`, `/queue/forecast`, `/queue/service-rates` |
| Inventory | `GET /inventory/model`, `/inventory/observations`, `/inventory/history`, `/inventory/planogram-status` |
| Central event log | `GET /events?type=` |

(all under `/api/stores/{store_id}`). The existing `/footfall`, `/dwell`, `/shopper-analytics`, `/queue-intelligence`, `/inventory` and `/alerts` now serve real rows.
WebSocket: `footfall.updated`, `zone.occupancy.updated`, `queue.updated`, `queue.congestion`, `shelf.observation`, `inventory.low_stock`, `inventory.out_of_stock`, `camera.disconnected`.

Without a trained shelf model the inventory path reports `MODEL_NOT_CONFIGURED` (see `GET .../inventory/model`) and produces no counts. Shelf training tooling lives in
`ml/shelf/` (`python -m ml.shelf.audit|prepare|extract_frames|prelabel|train|evaluate_counts`); it refuses to train or register anything from an insufficient dataset.
Evaluation scripts: `scripts/evaluate_shopper.py`, `scripts/evaluate_queue.py`, `scripts/benchmark_vision.py --analytics`, `scripts/benchmark_events.py`.
Results, limitations and what could not be measured: `docs/PHASE3_REPORT.md`.

## Phase 4 - backend services + frontend integration + staff/customer PWAs

- Unified task engine (idempotent, validated transitions, role eligibility, history), shifts/attendance/availability/recommendations/workload, privacy-safe customer API, report builder + CSV, camera event timeline, one WebSocket contract with replay/resync, LAN guard (not authentication).
- Frontend: central API client + adapters, REAL vs DEMO modes (`VITE_DATA_MODE`), Offline/Not-configured states instead of silent mock fallback, pending-sync queue for the Staff PWA.
- Read: [docs/PHASE4_REPORT.md](docs/PHASE4_REPORT.md), [docs/PHASE4_INTEGRATION_MAP.md](docs/PHASE4_INTEGRATION_MAP.md), [docs/API.md](docs/API.md), [docs/LAN_DEPLOYMENT.md](docs/LAN_DEPLOYMENT.md).
- Frontend default API URL in dev is `http://127.0.0.1:8000`; load the labelled sample store with `python -m database.manage seed-demo`.

## Database

* File: `backend/data/retailedge.db` (override with `RETAILEDGE_DATA_DIR`; the path is always absolute and
  never depends on the working directory). Keep it on a local disk, not a network share.
* PRAGMAs per connection: `foreign_keys=ON`, `journal_mode=WAL`, `busy_timeout=5000`, `synchronous=NORMAL`.
* One short transaction per request, committed before the response is sent.
* Only structured observations are stored - never video frames.
* Migrations: `database/migrations` (Alembic, batch mode for SQLite).
  `alembic upgrade head`, `alembic downgrade -1`, `alembic check` work from `backend/`.

| Command | What it does |
|---|---|
| `python -m database.manage setup` / `upgrade` | backup if needed, then migrate to head |
| `python -m database.manage backup` | consistent online copy to `data/backups/` (keeps 10) |
| `python -m database.manage restore FILE` | integrity-check FILE, back up current DB, restore |
| `python -m database.manage status` / `verify` | revision + row counts / integrity, FK check, model-vs-migration drift |
| `python -m database.manage seed-demo` | demo data; inserts only missing primary keys, tags rows `source='demo'` |

Recovery: every upgrade/restore writes `data/backups/retailedge-<UTC>-<reason>.db` first. If a migration goes
wrong, stop the API and `restore` that file. An existing SQLite file without Alembic history is backed up
(`pre-adopt-existing`) before anything touches it. Demo data is never inserted by startup or migrations.

## Layout

```
backend/
  main.py              app factory (create_app) - routers, middleware, lifespan
  run.py               dev server; refuses non-loopback host unless RETAILEDGE_ALLOW_LAN=true
  api/                 routers (system, stores, shoppers, inventory, queues, cameras, alerts, tasks, staff,
                       insights, reports, copilot, customer, ingest, events[WebSocket]) + deps.py (DI)
  schemas/             Pydantic request/response models (camelCase on the wire)
  services/            business logic
  repositories/        read queries
  database/            connection.py, base.py, models/, migrations/, manage.py (CLI), seed.py
  core/                config, logging (JSON + request id), errors (one envelope), limits, events (WS bus)
  tests/               pytest + FastAPI TestClient
  copilot/             Store Copilot: OpenRouter provider, allowlisted tools, grounding, two-phase actions
```

## API conventions

* Errors: `{"error": {"code", "message", "details", "requestId"}}` (404 / 409 / 422 / 428 / 429 / 503).
* Every telemetry payload has `meta.dataState`: `available | empty | unavailable`. Unmeasured numbers are `null`.
* Destructive deletes need `?confirm=true` (otherwise `428`). Employees are deactivated, conversations archived.
* Inference workers write through `POST /api/stores/{id}/ingest` (footfall, shelf, queue, camera status, zone
  occupancy). See `docs/PHASE1_AUDIT.md` for the endpoint/contract matrix.
