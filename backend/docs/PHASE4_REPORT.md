# Phase 4 report - backend services, frontend integration, Staff & Customer PWAs

Scope: complete backend services, connect the existing frontend to them (without redesigning it), staff/customer PWAs on the shared backend.
Out of scope (Phase 5): Store Copilot LLM integration. No authentication was added. SQLite only.

## What was delivered

**Backend (`backend/`)**
* Unified task engine (`services/tasks.py`): create / assign / reassign / accept / start / complete / cancel / history; validated transitions with compare-and-swap; idempotency keys; natural de-duplication of OPEN tasks for the same alert/shelf/counter/camera; role eligibility with a recorded supervisor override; customer-request sync.
* Workforce (`services/workforce.py`): shifts (overlap + overnight), self/supervisor attendance with server timestamps, derived roster rows, availability (scheduled != checked-in), derived staffing recommendations, workload.
* Customer API (`services/customers.py`): status-only shelf availability, long random `statusRef`, one shared staff task per request, no employee/internal data.
* Overview (`services/overview.py`): every KPI computed from stored rows, `freshness`, `dataQuality`, `dataMode`, occupancy as a labelled estimate.
* Reports (`services/report_builder.py`, `api/reports.py`): the full Reports document, previous-period comparison, server CSV for 8 report kinds; non-measurable fields are `null` and listed in `unavailableFields`.
* Camera event timeline (`GET /stores/{id}/cameras/timeline`): status transitions + durable events + camera alerts with source timestamps.
* Realtime contract (`core/events.py`, `api/events.py`): one envelope, per-store `seq`, ring-buffer replay, `epoch`, hello/snapshot/resync/heartbeat, audience filtering.
* LAN guard (`core/network.py`): network narrowing + allowlist (documented as NOT authentication).
* Migration `0004` applied to the real database (automatic pre-upgrade backup in `backend/data/backups/`); API (8000) and vision worker (8100) restarted on it.

**Frontend (`src/`)** - see `PHASE4_INTEGRATION_MAP.md`: central API client, adapters, realtime client, REAL/DEMO modes, Offline/Not-configured states, header REAL/DEMO + Live/Stale/Offline chips, Staff Management on the backend, Staff PWA with a pending-sync queue, Customer PWA on the public API, server CSV export, removal of fabricated numbers/animations in REAL mode.

## Test results (actual)

| Check | Result |
|---|---|
| Backend `pytest` (whole suite, incl. Phases 1-3) | **148 passed**, 0 failed (4 min 7 s). 21 are new in `tests/test_phase4.py` |
| Frontend `tsc -b` | 0 errors |
| `oxlint` | 0 errors (existing warnings only) |
| `npm run build` | succeeds (the 1.5 MB main chunk warning pre-dates Phase 4; it is mostly the DEMO fixtures) |
| Playwright end-to-end, real FastAPI + SQLite + Vite (`27` scenarios) | **27 / 27 passed** (list below) |
| DEMO mode smoke (`VITE_DATA_MODE=demo`, no backend running) | all 10 routes render, `DEMO DATA` badge on admin pages, **0 API calls**, no `null/NaN` text |

New backend tests cover: idempotent task create, no duplicate OPEN task per shelf, transition validation + history, role eligibility + recorded override, seeded role aliases, task completion never touching observed shelf quantities, shift overlap incl. overnight, scheduled-is-not-checked-in, server-stamped check-in, supervisor correction of a derived attendance row, public API never exposing internal fields, assistance request -> one task -> status sync + hard-to-guess reference, LAN guard (allowlist unit, blocked management routes, non-private networks, loopback unaffected), WebSocket envelope/replay/epoch resync, audience filtering, overview nulls + demo flag, report honesty + CSV safety, camera timeline, migration columns.

End-to-end scenarios (all PASS): API healthy on SQLite; Overview shows the backend queue/stock numbers and the DEMO label; unmeasured footfall is "-" not 0; Shopper / Inventory / Queue / AI Insights / Reports / Staff pages render backend values with no `null|undefined|NaN`; admin-created task (201) and idempotent replay (no duplicate); the open Staff PWA shows it **without reload** (WebSocket); accept/start/complete from the phone UI reach the server; admin Staff Management lists it completed; Customer app shows shelf availability from the backend with no counts/SKUs/model words; customer assistance creates exactly ONE shared task, the customer sees a reference and no employee name, and the assigned employee's Staff PWA shows it; an alert acknowledged elsewhere updates the open admin console (Live badge); a REAL store with no data shows **no fixtures**; stopping the API makes the UI say Offline/Retry (never sample data); all tasks persist across an API restart; Retry reconnects; no uncaught page errors.

## Known limits and remaining data/model dependencies (honest list)

* **No CCTV was verified.** Footfall, occupancy, dwell, movement, shelf counts and queue lengths are `null`/empty until a camera source is configured and calibrated (Phase 2/3 pipeline). The demo seed adds hourly footfall only for hours that have already passed in store time (so a database seeded early in the morning shows none, and `seed-demo` must be re-run on a new day); all seeded footfall, shelf and queue numbers are fixtures labelled DEMO, never camera measurements. (Corrected in Phase 5.)
* **No shelf model exists** (Phase 3 found no validated labelled data), so REAL shelf data comes only from observations posted to the ingest API; planogram slots show only what was recorded.
* **Not recorded -> null:** shopper bounce rate, retention, counter utilisation, per-item service speed, footfall forecast (AI Insights shows "forecast unavailable"), staff average completion time.
* **Reports PDF** uses the page's print flow; there is no server-side PDF renderer.
* **Store Copilot** still uses its Phase-1 service and `STORES_LIST` fixture for the store picker; wiring it to REAL stores/LLM is Phase 5.
* **Staff PWA offline:** reads are cached; writes queue with idempotency keys and are shown "pending sync", never as success; check-in/out time is the *server's* time when the queue drains. A queued action the server later refuses stays visible as failed.
* **LAN mode is not authentication** (see `LAN_DEPLOYMENT.md`): anyone on an allowed network can pick any employee and read the roster picker list.
* The e2e/Playwright scripts live in the session scratchpad, not in the repo; the backend tests do.
* Saved report presets are per-browser (localStorage) view settings, not operational data.
