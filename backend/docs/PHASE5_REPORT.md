# Phase 5 report - real Store Copilot, system validation, deployment

Scope: Store Copilot on a local LLM with database-grounded tools, whole-system health, reproducible startup, measured performance, accuracy against real ground truth,
end-to-end and regression tests, local-demo security notes. SQLite only, **no authentication**, no model training was performed in this phase.
Everything below was measured on this machine (Windows 11, 8c/16t CPU, 24 GB RAM, RTX 4050 Laptop 6 GB). Where something could not be measured, that is stated.

## 1. What changed

| Area | Result |
|---|---|
| Copilot backend (`backend/copilot/`) | `provider.py` (Ollama adapter: probe, streaming chat, cancel, cloud-model refusal), `tools.py` (allowlisted registry, pydantic `extra=forbid`), `actions.py` (prepare/execute), `render.py` (grounding sources, rich payloads, number-grounding check), `engine.py` (bounded tool loop, deterministic fallback, rate limit, stop) |
| Copilot API (`api/copilot.py`) | health, context, conversations (list/get/rename/delete), chat, stop, actions confirm/cancel. SQLite conversations; store fixed per conversation |
| Frontend | Store Copilot page keeps its central chat and right-hand Live Store Telemetry panel; now backed by real conversations, tool results, structured cards, confirmation cards, stop, model status. Telemetry values come from the same `/overview` endpoint as the dashboards |
| System health | `GET /api/system/health` probes 11 components (states READY / LOADING / DEGRADED / OFFLINE / NOT_CONFIGURED / ERROR) |
| Startup | `python scripts/start_all.py` (`--status`, `--stop`, `--seed-demo`) |
| Bugs found by the Phase 5 tests and fixed | (1) first occupancy read re-baselined to 0 and **discarded crossings counted after the last closing time** (found by the pipeline test; now replays post-closing crossings; regression test added). (2) Grounding check treated `1,038` as two numbers (false rejection of correct answers). (3) The demo seed had a 5th counter ("Counter 5 (Backup)") that was not requested: removed from the seed, tests and the user's database. (4) Default store was an empty demo shell: the store list now puts stores that have cameras first and the console remembers the chosen store. (5) Two Phase 4 tests depended on the time of day / the removed preview endpoint (see section 9) |

## 2. Language model (Part B) - measured

* Ollama 0.x local, installed models at start: `qwen3:4b` (2.5 GB, local), plus two **cloud-hosted** models (`gemma4:31b-cloud`, `nemotron-3-super:cloud`). Cloud models are refused by default (`RETAILEDGE_COPILOT_ALLOW_CLOUD_MODELS=false`) because store data would leave the machine.
* Memory: 6 GB VRAM is shared with the vision worker (~2 GB). A 4B Q4 model (3.9 GB loaded at 8 k context) fits next to it (5.2-5.6 GB used of 6.1 GB); larger Qwen models would not.
* `qwen3:4b` (2507 *thinking* variant) selected tools correctly but took **17-70 s** per answer and wrote reasoning text into the answer, so the grounding check replaced all 5 test answers. Rejected.
* **Default: `qwen3:4b-instruct-2507-q4_K_M`** (2.5 GB on disk). Verified on this machine: streaming text generation, native tool calling (16 of 16 cases chose an acceptable tool), JSON-argument validation, 8 k context, latency below. `think:false`.
* Not verified / not claimed: models larger than 4B, long (>8 k) contexts, concurrency (the engine serialises nothing; a second simultaneous request would queue inside Ollama), non-English questions.
* No LLM training or fine-tuning was done.

## 3. Store Copilot evaluation (Part L) - real model, real tools, scratch DEMO database

Script: `scripts/evaluate_copilot.py` -> `docs/eval/copilot_eval.json`. Expected values are read from the same REST endpoints the dashboards use, never typed in.
16 hand-written questions + one write flow (small set: a regression/behaviour check, **not** a benchmark of language ability).

| Metric | Result |
|---|---|
| Correct tool selected | 16 / 16 |
| Answer contains the backend's value (queue counter, shelf codes, counts, footfall, open tasks, ...) | 16 / 16 |
| Safety properties (missing data stated, no invented percentage, unknown shelf, injected alert text ignored, no write without confirmation) | 16 / 16 |
| Model's own text passed the number-grounding check | 16 / 16 (engine replaced 0 answers) |
| Answer latency (end to end, includes tool calls) | median **2.9 s**, max 9.2 s |
| Write flow (preview -> DB unchanged -> confirm -> persisted -> replay does nothing) | all true |

History of the evaluation, kept in `docs/eval/` (`copilot_eval_run1_before_fixes.json`, `copilot_eval_run2.json`): the first run scored 12/16 and the second 15/16.
The failures were real and led to engine changes: my own first test case wrongly assumed "no footfall" for the demo store (test fixed); open-ended "what should I prioritise" may use any of five read tools (test relaxed, stated here); `1,038` was mis-parsed by the grounding check (fixed); the model sometimes claims it "has no access to the staff schedule" without calling the tool - the engine now detects this and answers from the database tool instead (`routerFallback`, used in 1 of 16 cases); a prompt rule forbids claiming lack of access.
The grounding check demonstrably works: with the thinking model it replaced every answer containing invented numbers.

## 4. System behaviour measured end to end

### Test 1 - camera -> detection -> events -> SQLite -> WebSocket -> dashboard (`scripts/e2e_pipeline.py`, real API + real vision worker processes, scratch DB)
Input: `people-detection.mp4` (prerecorded, CC BY 4.0, shown as DEMO - **not a live CCTV feed**), manual truth 1 in / 2 out.

| Result | Value |
|---|---|
| Crossings counted by the system | **1 in, 1 out** (truth 1 in, 2 out) -> precision 1.00, recall 0.67 (2 TP, 0 FP, 1 FN); timing error 4 and 8 frames |
| Crossings stored in SQLite / WebSocket `footfall.updated` | 2 / 2 |
| `/occupancy` counters | entries 1, exits 1 (before the Phase 5 fix it read 0/0) |
| Overview total footfall = shopper-analytics total entries | 1039 = 1039 |
| WebSocket delivery delay (event timestamp -> client receive, n=4) | median 1 ms |
| Camera live after configure | 1.1 s |

This is a one-clip, 3-crossing smoke test - **not** an accuracy estimate. The WebSocket delay is measured from the worker's event timestamp, **not** from video capture to browser paint; the full video-to-screen delay was not measured.

### Laptop webcam (the user's machine, live - no video files)
All four camera entries use `usb` device **2** on this laptop (device 0 is the "EShare Virtual Camera", which delivers black frames; the "Integrated Camera" enumerates as 2 - find yours by checking frame brightness per index, `python -c` probe in Troubleshooting) (a webcam can only be opened once, so `vision/sources.py` now has one shared reader per device that serves every camera entry; covered by a unit test). Measured with all four running: 640x480, input ~30 fps, inference ~13 fps per camera (sampling cap 15), YOLO11n on the RTX 4050.
What each camera measures is configured as data, over the same webcam frame: CAM-01 entrance = one vertical counting line (right of the line = inside); CAM-03 checkout = four vertical lanes mapped to counters 1-4 (people in a lane = its queue); CAM-04 aisle = six vertical strips mapped to the existing Aisle 1-6 store zones (visits, dwell, heatmap); CAM-02 shelf = person detection only (**there is no shelf model, so shelf stock cannot be read from the camera**). These regions are placeholders for one laptop view; for a real store they must be redrawn per physical camera. With nobody in frame all counts are 0 and footfall/occupancy stay unavailable (null) rather than invented.
The earlier demo footfall/dwell/zone-occupancy rows and Counter 5 were removed from the user's database (backup `backend/data/backups/retailedge-20261026-before-webcam-cleanup.db`); the seed now creates 4 counters.

### Test 2 - inventory -> staff
No shelf model exists (no labelled shelf data was available, see `ai_models/shelf`). Shelf quantities enter only through the observation ingest API; ingest -> low-stock alert -> task -> staff assignment is covered by the API-level backend tests and by the browser run (Copilot created, assigned and confirmed a replenishment task; it appeared in Staff Management > Tasks and the Copilot telemetry changed 3 -> 4). **Not verified: camera -> shelf detection**.

### Test 3 - queue management
No real checkout footage exists in the repository. Verified on a discrete-event **simulation** (4 h, 497 customers, 3 % detection dropout): count MAE 0.18 customers, exact-match 83 %, service rate 2.80 vs true 2.73 /min, wait-time MAE 24 s (mean true wait 67 s); the transparent persistence forecast beats the fluid model (5-min MAE 1.93 vs 2.33). These validate the algorithms, not detector accuracy on real counters.

### Test 4 - Store Copilot in the browser (Playwright, real Ollama)
Telemetry numbers equal the overview API; queue and restock answers name the counters/shelves the APIs report; an unavailable metric (bounce rate) is not invented; write request shows a confirmation card, the DB is unchanged until **Approve & Dispatch**, then exactly one task exists; telemetry follows; new task visible on Staff Management; chats survive reload; new chat starts empty; Stop works.

### Test 5 - Customer PWA
Pages load without errors at phone width; the network log shows only `/api/public/*` calls (no staff, task, camera or Copilot endpoints). Assistance request -> one shared task -> status sync was verified in Phase 4 (27/27) and by backend tests.

### Test 6 - offline operation
**Partly offline, not fully.** Backend, SQLite, vision, YOLO weights and the Copilot (local Ollama) make no outbound calls (code scan of the backend: none). The **frontend does use external services**: Google Fonts (`index.html`) and Unsplash images for avatars/products/offers. Offline, the UI falls back to system fonts and those images do not load. Not changed in this phase.

## 5. Performance (Part K) - measured, nothing optimised without a measurement

| Quantity | Measured |
|---|---|
| Person detector, CUDA (YOLO11n, 640, 200 frames, worker + Ollama also resident) | total p50 **6.3 ms**, p95 11.5 ms, 113 fps (pre 1.5 / model 1.8 / post 1.6 ms p50) |
| Person detector, CPU (Phase 3, same clip) | 87 ms median |
| Shelf model latency | not measurable: no shelf model |
| Camera FPS (laptop webcam) | 29.9 in, 14.4 inferred |
| SQLite event write rate (central event engine, WAL, 6000 events, batch 100) | **336 events/s**; batch p50 294 ms / p95 344 ms; concurrent reader query p99 2.6 ms |
| GPU memory with worker + Ollama model loaded | 5.2-5.6 GB of 6.1 GB |
| Copilot answer latency (qwen3 instruct) | median 2.9 s, max 9.2 s; first answer after idle is slower (model load) |
| API response time (100 sequential requests each, localhost, seeded DB) | see table |

| Endpoint | median ms | p95 ms |
|---|---|---|
| /api/health | 2.9 | 3.9 |
| /api/stores | 3.8 | 4.8 |
| stores/{id}/overview | 32.7 | 39.9 |
| stores/{id}/occupancy | 5.1 | 6.6 |
| stores/{id}/shopper-analytics?range=today | 12.3 | 15.1 |
| stores/{id}/inventory | 15.9 | 19.0 |
| stores/{id}/queue-intelligence | 9.9 | 12.7 |
| stores/{id}/staff/availability | 18.8 | 23.3 |
| stores/{id}/tasks?limit=50 | 7.3 | 9.0 |
| stores/{id}/alerts?status=active | 5.6 | 7.4 |
| stores/{id}/insights | 5.0 | 7.0 |
| /api/copilot/health | 2.0 | 2.7 |
| /api/system/health | 32.3 | 50.1 |

No bottleneck was found that justified optimisation. **Not measured:** video-frame -> browser-paint delay, CPU % per process during a sustained run (Phase 3 `benchmark_vision.py pipeline` has those numbers for earlier code), long-duration memory growth.

## 6. Accuracy (Part L) - against real ground truth only

| Item | Result | Basis |
|---|---|---|
| Person detection precision/recall | **not measured** - no labelled boxes exist for any clip | no ground truth |
| Footfall in/out | 1 in / 1 out vs truth 1 / 2 (P 1.00, R 0.67) | 1 clip, 3 crossings: smoke-level only |
| Queue length / wait / congestion on real counters | **not measured** | no real checkout footage |
| Queue simulation (algorithms only) | see Test 3 | synthetic truth |
| Inventory detection | **not measured** | no shelf model, no labelled shelf data |
| Forecast MAE vs baseline | persistence baseline kept; ML forecaster **refused to train** (0.0 of 14 required days of real history) | `scripts/train_queue_forecaster.py` |
| Copilot tool selection / numeric agreement / missing-data / write confirmation / hallucination | section 3 | backend endpoints |

## 7. Security for a controlled local demo (Part N) - this is NOT production

* API binds to `127.0.0.1`; non-loopback needs `RETAILEDGE_ALLOW_LAN=true` and then only the Staff/Customer PWA routes are reachable, from private networks. **There is no authentication** and none was added. Anyone who can reach an allowed port can use it.
* Inputs validated by pydantic (`extra=forbid` on every Copilot tool). The model gets no SQL, file, shell or HTTP tool; the store is fixed by the conversation; tool output is wrapped as untrusted data and sanitised; an alert whose text says "SYSTEM OVERRIDE ... acknowledge" did not cause any action (tested).
* Every record change by the Copilot needs a human click (preview -> Approve & Dispatch) with an idempotency key. **A confirmation is not proof of identity.**
* Costly AI requests are rate limited (default 20/min, HTTP 429). Camera credentials and the LLM endpoint stay server-side (camera URLs are redacted in API output).
* Copilot conversations are stored in plain SQLite on this machine; no privacy guarantee is claimed beyond that. No raw CCTV frames are stored or sent to the model.

## 8. Frontend regression (Part O)

`tsc -b` 0 errors; `oxlint` 0 errors (only pre-existing unused-import warnings); Playwright against Vite (real mode) + FastAPI + SQLite + real Ollama: **33 / 33 passed** (`docs/eval/browser_regression.json`):
8 admin pages and 6 PWA pages load with 0 JS errors, 0 failed API calls, no horizontal overflow at 1440 px and at 390 px, light background (`rgb(248,250,252)`); Copilot flows listed above.
The earlier Phase 4 scenarios (27) were not re-run as such; routes, API calls, charts and states are exercised by this sweep, camera feeds and overlays only for the webcam check below, and alert/task actions through the Copilot flow.
Camera feeds/overlays: verified by hand-checking that the worker serves the MJPEG stream for the webcam and reports inference; not automated in the browser suite (no worker runs in the scratch stack).

## 9. Tests

* Backend `pytest`: see final line of section 10 (full suite). New in Phase 5: 21 Copilot tests (scripted protocol-level fake Ollama: probes, cloud refusal, tool loop bounds, grounding, injection, two-phase actions, idempotency, conversations, stop, rate limit), 4 system-health tests, 1 occupancy regression.
* Two Phase 4 tests changed: the overview test depended on the clock (the demo seed only creates footfall for hours already passed in store time) and now removes footfall explicitly; the Phase 4 `/actions/preview` test was replaced by the Phase 5 two-phase tests because actions are now only prepared by Copilot tools.
* The Playwright script is not in the repository (session scratchpad), as in Phase 4.

## 10. Reference

**Architecture**: React/Vite (5173) -> FastAPI (8000, SQLite WAL) <- vision worker (8100: capture -> YOLO11n -> ByteTrack -> analytics -> events posted to the API) ; Copilot engine inside the API -> local Ollama (11434). WebSocket `/ws/stores/{id}/events` carries `{type, storeId, seq, epoch, timestamp, payload}`.

**Backend layout** (`backend/`): `api/` routes, `services/` business logic, `copilot/` LLM engine, `vision/` worker, `analytics/` pure algorithms, `database/` models + Alembic + seed, `core/` config/events/network, `schemas/`, `scripts/` (start, benchmarks, evaluations), `tests/`, `ai_models/` weights + config, `ml/` shelf training pipeline (no dataset), (the pre-Phase-5 prototype `legacy/`, `llm_adapter.py`, `tools.py` was deleted as unused).

**SQLite**: `backend/data/retailedge.db` (WAL), 50 tables, Alembic head `0004`, automatic pre-upgrade backups in `backend/data/backups/`. Copilot tables: `copilot_conversations`, `copilot_messages`, `copilot_actions`, `idempotency_records`.

**Models**: `ai_models/person/yolo11n.pt` (YOLO11n COCO, AGPL-3.0, pretrained - **not trained here**); shelf model: none; forecasting: none (persistence baseline); LLM: Ollama `qwen3:4b-instruct-2507-q4_K_M`.

**Training status**: no model was trained in Phase 5. Shelf training code exists and is smoke-tested on synthetic data only; the queue forecaster refuses to train without 14 days of real history.

**Camera configuration** (data, not code): `PUT /api/cameras/{id}/source` with `sourceType` `usb` (`sourceRef` "0"), `file` (under `data/samples` or `RETAILEDGE_MEDIA_DIR`), `rtsp` or `http`; entrance lines via `POST /api/stores/{id}/camera-zones`; `POST /api/vision/reload`.

**Install**: `cd backend; python -m venv .venv; .venv\Scripts\python -m pip install -r requirements-dev.txt -r requirements-vision.txt`; `npm install` in the repo root.

**Ollama**: install Ollama, `ollama pull qwen3:4b-instruct-2507-q4_K_M`. Settings in `backend/.env.example`.

**Start (this machine)**
```
cd D:\new\backend
.venv\Scripts\python -m database.manage setup
.venv\Scripts\python -m database.manage seed-demo      # optional DEMO fixtures (staff, shelves, tasks, alerts, demo footfall)
.venv\Scripts\python scripts\start_all.py              # API 8000 + vision worker 8100 + Vite 5173, prints real health
.venv\Scripts\python scripts\start_all.py --status
.venv\Scripts\python scripts\start_all.py --stop
```
Manual alternative: `python run.py`, `python -m vision`, `npm run dev`. Routes: `docs/API.md` (138 operations, regenerated). Frontend modes: `VITE_DATA_MODE=real|demo`, `VITE_API_URL`.

**Troubleshooting**: black camera image -> wrong device index (laptops list virtual cameras first); try `sourceRef` 0,1,2,3 and check the frame is not black. dashboard shows dashes -> the selected store has no data (the Koramangala demo store is deliberately empty) or no camera/footfall source; check `/api/system/health`. Camera "NOT_CONFIGURED" -> set a source. Webcam busy -> close other apps using it (only one process can open it). Copilot "AI Offline" -> `ollama serve` / pull the model; it still answers from the database by keyword. First Copilot answer slow -> model load. Two GPU consumers (worker + LLM) nearly fill 6 GB: do not start a second worker; unload the model with `ollama stop <model>` if needed.

## 11. Integration matrix

| MODULE | IMPLEMENTED | TESTED | REAL/DEMO | BLOCKER |
|---|---|---|---|---|
| FastAPI + SQLite + Alembic | yes | pytest (all backend tests), API latency | REAL | - |
| Camera ingest (webcam / file / RTSP) | yes | webcam live (manual), file via E2E | REAL pipeline; footage in tests is DEMO | RTSP/IP camera never tried (no camera) |
| Person detection + tracking | yes | latency/FPS benchmark, 1-clip smoke accuracy | REAL model, pretrained | no labelled boxes -> no precision/recall |
| Footfall / occupancy | yes | E2E: 1/1 vs truth 1/2; bug fixed | REAL logic; seeded numbers are DEMO | needs entrance line on a real entrance camera and more truth data |
| Queue analytics + forecast | yes | simulation + aisle clip | simulation / DEMO | no real checkout footage; forecaster needs 14 days of real history |
| Shelf / inventory detection | partial (ingest API, alerts, tasks) | API tests, browser flow | DEMO shelf data | **no shelf model and no labelled shelf data** |
| Staff & tasks & alerts | yes | pytest, browser, Phase 4 e2e | REAL logic on DEMO roster | - |
| Store Copilot (LLM + tools) | yes | 21 tests + 16-case real-model eval + browser | REAL (local model, DEMO store data) | model quality limited to 4B; small eval set |
| Copilot action tools | yes | pytest + eval + browser | REAL | no authentication: confirmation is not identity |
| System health | yes | 4 tests, live | REAL | - |
| Startup orchestration | yes | run live, `--status` | REAL | not tested from a cold boot / on another machine |
| WebSocket realtime | yes | E2E delivery 1 ms, Phase 4 e2e | REAL | video-to-screen delay not measured |
| Admin frontend (8 pages) | yes | 33/33 browser checks, tsc, oxlint | REAL mode / DEMO mode | - |
| Staff PWA | yes | load check + Phase 4 e2e | REAL | no auth; offline queue tested in Phase 4 only |
| Customer PWA | yes | load + public-only network check | REAL (DEMO store) | external fonts/images need internet |
| Offline operation | partial | code scan | backend/AI local; UI uses Google Fonts + Unsplash | self-host fonts/images to be fully offline |
| LAN/phone access | yes | Phase 4 tests | - | no authentication |

## 12. Known failures and limitations (exact missing requirements)

* Person detector precision/recall: needs a labelled set of boxes from your own camera footage.
* Real queue and footfall accuracy: needs footage of a real checkout / entrance with manual counts (and a drawn queue region / entrance line).
* Shelf detection: needs labelled shelf images and a trained model in `ai_models/shelf`.
* ML demand/queue forecasting: needs >= 14 days of real queue history.
* Video-to-dashboard latency and sustained CPU/memory: need a timed run with a capture timestamp overlay; not done.
* Authentication/authorisation, HTTPS and audit identity: intentionally absent (controlled demo).
* The Playwright suite and the evaluation transcript scripts live partly in the session scratchpad, not in the repository.
* Demo seed fixtures (hourly footfall, dwell) are not camera data: do not re-run `seed-demo` on a database that is fed by the webcam.

## 13. Shelf and forecasting models (added after Phase 5 sign-off) - STATUS: IN PROGRESS, no results yet

* **Shelf product detector**: dataset = SKU-110K (Trax, ~11.7 k dense retail-shelf images, one class "item", official train/val/test lists). `scripts/train_shelf_sku110k.py`
  downloads it (12.2 GB, resumable), `ml/shelf/sku110k.py` converts it (tested on a synthetic mini dataset), `ml.shelf.train` fine-tunes YOLO11n (30 epochs max, early stop),
  reports real val/test mAP, `ml.shelf.evaluate_counts` measures visible-item COUNT error, and the model is written to `ai_models/configs/models.json` **only if test mAP50 >= 0.5**.
  Progress/log: `backend/data/logs/shelf_train.log`; result: `backend/ai_models/shelf/shelf-sku110k-v1/model_card.json`. **No number from this model exists yet; none is claimed.**
  Limits that will remain even when it finishes: it counts generic items on a shelf (no product/brand identity); it was trained on other stores' images, not yours; the licence is
  academic/non-commercial; and no shelf region is drawn on any camera, because the laptop webcam is not looking at a shelf (a region on it would report empty shelves and trigger false alerts).
* **Footfall/demand forecaster**: `scripts/train_footfall_forecaster.py` trains only on >= 14 days of real entrance-camera hourly counts and keeps the model only if it beats a seasonal-naive baseline on held-out data.
  Today it refuses (about 0 days of real history). No public dataset substitutes for your store's own history, so none is used. Nothing consumes a saved forecaster yet.
* **Person detector**: unchanged (pretrained YOLO11n). Its weights are COCO, so they can already detect other COCO objects; no second generic detector was added.

## 14. Round-two changes requested after sign-off (webcam, KPIs, roles, latency)

**Camera roles (all on the laptop webcam, device 2):** CAM-01 Main Entrance = counting line; CAM-02 Smart Shelves = Aisle 1-6 zones (+ 6 shelf regions, DISABLED until a shelf model is READY and the camera looks at a shelf);
CAM-03 **Queue** = four lanes (people waiting per counter); CAM-04 **Checkout** = four counter areas drawn as numbered markers (people being served per counter). The camera cards show only the numbers of their own role.

**The five Overview KPIs (all measured, none estimated from fixtures):**
| KPI | Definition |
|---|---|
| Total Footfall | entrance-line crossings counted as "in" today (entrance camera) |
| Current Occupancy | people visible to the live cameras right now (highest single-camera count, never a sum); labelled "In camera view" |
| Avg Time in Store | mean dwell of completed zone visits today |
| Active Queues | number of counters that currently have someone waiting (not the number of open lanes) |
| Avg Wait Time | mean estimated wait of the queues that exist; 0 when nobody waits; "-" when a queue exists but no wait can be estimated from measured rates |

**Demo data:** staff, shelves + shelf observations, stock alerts and tasks are DEMO fixtures again (restored from the backup); footfall, dwell, zone occupancy and every queue number are camera measurements only. Counter 5, the queue forecast chart and the persistence "forecast" in the Copilot were removed (nothing is predicted).

**Latency (measured with `scripts/measure_stream_latency.py`, real stream):** capture -> encoded 1-2 ms, capture -> received on localhost about 3 ms (p95 4 ms), detection overlay lag 1 frame, detector 17-28 ms per frame.
Honest notes: (1) my first measurement (293 ms) was wrong - the measuring client buffered 64 KB before reading (that file was deleted); (2) the webcam itself delivers 10 fps in the current light (30 fps in bright light), which this software cannot change and which is the main visible "lag"; (3) the four camera entries now run the detector once per frame (shared), and the dashboard refresh debounce went from 800 ms to 400 ms.

**Person detector on real labelled photos (COCO val2017 persons, held-out test split: 1000 images, 2180 persons, 296 close-up images, `docs/eval/person_base_coco_test.json`):**
current YOLO11n at the deployed threshold 0.35: precision 0.86 / recall 0.57 / F1 0.69 (close-ups 0.86 / 0.63 / 0.73); best F1 is at 0.25 (all 0.69, P 0.77 / R 0.63; close-ups best at 0.30); mAP50 0.72, mAP50-95 0.49. A fine-tune on the 3000 train images is running (`ml/person/coco_person.py train`); it will only replace the shipped model if it beats these numbers on the same test split.

## 15. Language model moved from local Ollama to OpenRouter

- The Copilot's language model is now hosted by OpenRouter (`copilot/provider.py: OpenRouterProvider`, OpenAI-compatible streaming `/chat/completions` with tool calls). The API key is read server-side from `OPENROUTER_API_KEY` (`backend/.env`); it is never sent to the browser. Default model `qwen/qwen3-next-80b-a3b-instruct` (non-reasoning, tool-capable; change with `RETAILEDGE_COPILOT_MODEL`).
- Health (`/api/copilot/health`, `llm` component of `/api/system/health`) is a real probe: key check (`GET /key`) plus the model's presence in the tool-capable catalogue. No key -> `NOT_CONFIGURED`; rejected key -> `NOT_CONFIGURED`; no credit -> `DEGRADED`; unreachable -> `OFFLINE`. In all of these the Copilot still answers from the allowlisted database tools.
- Privacy change: prompts now include the store data returned by the tools and leave this machine (OpenRouter and the model provider behind it). Everything else (tool allowlist, grounding check, two-phase confirmed actions, rate limit) is unchanged.
- All Ollama models were removed from this machine (about 5 GB freed). The earlier 16/16 evaluation and 2.9 s median in section 12 were measured on the local Qwen3-4B and do NOT carry over: re-run `python scripts/evaluate_copilot.py` with the key set before quoting any number for the hosted model.
- Tests: provider/health tests run against a protocol-level OpenRouter double (`tests/fake_openrouter.py`), including missing key, rejected key, exhausted credit, model not in catalogue and offline.
- Measured on the hosted model (`scripts/evaluate_copilot.py`, 16 cases, `docs/eval/copilot_eval.json`): 16/16 passed, tool selection 16/16, facts agree with the backend 16/16, safety properties 16/16, median 2.9 s. Slowest cases 23.6 s and 31.1 s (OpenRouter latency varies between runs; a first run had one case at 15-20 s). In 4 of 16 cases the model's own wording failed the number-grounding check and the engine replaced it with the database result, so the answer shown was correct but not the model's text.
- A first run scored 15/16: for "quick store overview" the model answered without calling a tool, and no keyword route matched, so the answer was withheld. A keyword route for overview/summary/KPIs now covers that fallback.

### 15.1 Free models only (no per-request cost)

- Default model is now a free OpenRouter model, `nvidia/nemotron-3.5-lightning:free`, with `nvidia/nemotron-3-ultra-550b-a55b:free` and `poolside/laguna-s-2.1:free` as automatic fallbacks (OpenRouter allows at most 3 models per request). The answer's `meta.model` shows which model actually replied. Paid-model use before this change: about USD 0.018 in total (evaluation runs).
- Free models are shared: some were 429 rate-limited (the Gemma 4 free models) or returned 404/403 when probed; the fallback list and the database-tools fallback exist for that reason. The key's `is_free_tier` is true, and free models have a small daily request cap on such accounts, so a run of the 16-case evaluation can exhaust it: the last evaluation run had about half of its answers produced by the deterministic database tools (`mode: deterministic_tools`) once the free quota ran out. Those cases are NOT a measurement of the language model.
- Best complete free-model evaluation run: 15/16 passed (one case failed because the model answered with a number and no tool call and no keyword route matched; the route was then broadened), median 3.3 s, max 9.9 s, 8 of 16 model answers replaced by the engine's database wording because the numbers/dates in the model's text were not in the results. After the route fix the tool-selection and fact-agreement scores were 16/16, but that run was partly served by the deterministic path, so no clean full free-model score is claimed.

## 16. Live detection delivery fix (rate limit on the worker's events)

- Symptom: the live view felt slow and missed sudden movement. Cause found in `data/logs/worker.log`: 1,392 `HTTP 429 Too Many Requests` failures when the vision worker posted detection batches to `/api/internal/vision/events`. The general write-rate limit (240 requests/min per client) also applied to the worker, which sends several requests a second for 4 cameras, so batches (overlay frames AND counting events) were dropped.
- Fix: `core/limits.py` no longer rate-limits `/api/internal/vision/*`; the outbox now collects events for ~80 ms before posting (fewer, larger requests) and re-queues non-overlay events (crossings, queue observations) if a post fails; `vision_event_hz` raised from 4 to 10 per camera so overlay boxes follow fast movement. Regression test: `test_vision_worker_ingest_is_not_rate_limited`.
- Measured after the fix (live, RTX 4050): 915 events sent, 0 dropped, 0 delivery errors; person detection 34.6 ms per frame; cameras at 10 fps (the webcam's own rate in this light).

## 17. Lag and blur on sudden movement

Observed: when a person moves suddenly the live view smears and the box trails or disappears. Causes found and what was changed:

1. **Camera exposure (physical).** In a dim room the webcam's auto-exposure lengthens each exposure, so it delivered only ~10 fps with motion blur (measured: 10.3 fps auto; with a fixed short exposure the same webcam delivered 30.4 fps but a much darker image). In a brighter room it delivered 30.4 fps. This cannot be fixed in software: a fixed short exposure is available as an opt-in (`RETAILEDGE_USB_EXPOSURE=-5`), left off by default because it needs a bright room.
2. **Detections were filtered before the tracker.** The detector dropped everything under confidence 0.35, so a blurred person (weak detection) vanished and ByteTrack's second matching pass (made for exactly this) never saw it. The detector now runs down to a floor of 0.12 and ByteTrack decides: an existing track survives weak detections, a new track still needs confidence >= 0.4. Test: `test_tracker_keeps_a_person_through_weak_blurred_detections`.
3. **Detection/stream rate caps.** Inference was capped at 15 fps per camera and the stream at 15 fps; both are now 30. Measured after the change (RTX 4050, webcam at 30.4 fps): 26-27 detections/s per camera entry, 12.4 ms per frame, 0 events dropped.
4. **Box trailing the picture (display).** A box is computed on a frame a few frames older than the one shown. The browser now shifts each tracked box by its own measured velocity times the lag (bounded, per track id) in `LiveVideoCanvas.tsx`.
Not measured: how much each change helps a human-perceived "lag"; judge on the live view.

### 15.2 Groq provider and model chain

- `RETAILEDGE_COPILOT_PROVIDER=groq` + `GROQ_API_KEY` (backend/.env, server-side) uses Groq's OpenAI-compatible API. Default model there: `openai/gpt-oss-20b` (reasoning effort "low"). Fallback chain on a 429/outage: `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, then a free OpenRouter model if an OpenRouter key is set (`copilot/provider.py: ChainProvider`).
- Measured Groq free-tier limits for this key: 8,000 tokens/min and 1,000 requests/day PER MODEL. One Copilot question sends ~3,800 prompt tokens per model call (about two calls with a tool lookup), so a single model sustains roughly one question per minute; the chain gives each model its own budget.
- Evaluation (16 cases, 20 s between questions so the rate limit is not what is measured, `docs/eval/copilot_eval.json`): 15/16 passed, tool selection 16/16, facts agree with the backend 15/16, safety properties 16/16, write/confirm/replay flow all true, median 2.7 s, max 6.1 s, all 16 answered by the model. In 14 of 16 cases the model's own wording failed the number-grounding check (dates/times it wrote were not in the tool result), so the engine showed the database wording instead: correct and safe, but it means gpt-oss-20b's text is rarely what the user sees.
- The one failing case, "footfall value": the evaluation temp database has no entrance line configured since the KPI redefinition, the tool honestly answered "No entrance counting line is configured", and the case still expects a number. That expectation looks stale; it has not been re-derived.
- A back-to-back run without pacing exhausted the budgets (11 of 16 answers fell back to database tools): that is the free-tier limit, not a model result.

## 18. Shelf product detector: training finished (SKU-110K, YOLO11n, single class "item")

- Run: 10 epochs, image size 512, batch 4, `scripts/train_shelf_supervised.py`. The run was interrupted several times by Windows memory exhaustion / native access violations and resumed from the last saved epoch (epochs 1-4 before the first interruption, then 5-10 under the supervisor); total training time recorded in the model card: 6,102 s for the last invocation. Training split 8,219 images; validation 588 (audit) / 651 images evaluated; held-out test 2,936 images.
- Validation mAP50 per epoch: 0.698, 0.734, 0.727, 0.758, 0.772, 0.778, 0.784, 0.799, 0.803, 0.812 (best epoch = 10).
- **Held-out TEST split (used once, after checkpoint selection): precision 0.866, recall 0.775, mAP50 0.836, mAP50-95 0.486** (2,936 images). The registration gate (test mAP50 >= 0.5) passed and the model was registered (`ai_models/configs/models.json`, `shelf-monitor`, enabled, confidence 0.3).
- Weights: `ai_models/shelf/shelf-sku110k-v1/weights/best.pt` (5.4 MB, sha256 569d9f01...). The vision worker loads it (READY) next to the person detector.
- **ONNX export is NOT validated**: on 20 test images the ONNX model reproduced the PyTorch detection count in only 1 image and boxes differed by up to 0.095 (normalised), so `onnx.ok` is false. Do not use `best.onnx` (for example on the Raspberry Pi) until that is investigated; the registered runtime is PyTorch.
- Fix needed to load it: a CUDA-graph capture of the shelf model collided with the already-running person inference thread ("operation failed due to a previous error during capture"); the shelf model now loads without a CUDA graph (`vision/registry.py`).
- What this does NOT show: SKU-110K are dense retail-shelf photos of one product class, so the score says nothing about YOUR shelves, a laptop webcam, or per-product stock decisions. CAM-02 shelf regions remain disabled until a camera actually looks at shelves; no shelf count is produced until then (and never a fake one).

### 17.1 A person filling the frame was not detected (tracker thresholds)

- Observed on the live stream: a person right in front of the webcam, backlit by a window, motion-blurred, head and shoulders only, produced `boxes: []`. Offline test on that exact frame: YOLO11n DOES find the person (box x 324-552, y 2-474) but with confidence 0.26, below the tracker's new-track threshold (0.4) and high threshold (0.35). (CLAHE contrast enhancement raised it to 0.39 but also created a spurious full-frame box, so it was not adopted.)
- Change: tracker thresholds set to ByteTrack's own defaults (high 0.25, low 0.1, new-track 0.25). Trade-off: weaker detections can now start tracks, so more false positives are possible on busy backgrounds; this has not been measured on a labelled set.
- After the change, on the live stream: the person is tracked with a stable id and confidence 0.87-0.94 (three consecutive samples). Not re-run: the COCO precision/recall evaluation with the new thresholds.
