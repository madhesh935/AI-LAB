# RetailEdge API reference (Phase 5)

Base URL: `http://127.0.0.1:8000` (loopback by default). Interactive docs: `/docs`, machine-readable: `/openapi.json`.
There is **no authentication** anywhere. See `LAN_DEPLOYMENT.md` for what that means on a network.

## Conventions

* JSON, camelCase. Timestamps are ISO-8601 UTC with an offset.
* Errors: `{"error": {"code", "message", "details", "requestId"}}` - codes include `validation_error`, `not_found`, `conflict`, `invalid_state`, `confirmation_required` (428), `lan_restricted` (403).
* Destructive deletes need `?confirm=true`.
* `meta.dataState` = `available | empty | unavailable`; unmeasured numeric fields are `null`, never `0`.
* `dataMode` on stores/overview/reports: `real` or `demo` (seeded fixtures).
* **Idempotency**: `POST` task writes accept `Idempotency-Key`. `201` = created, `200 + X-Idempotent-Replay: true` = the key (or an already-open task for the same alert/shelf/counter/camera) was already applied; the existing task is returned.
* Task states: `new -> assigned -> in_progress -> completed`, `cancelled` from any open state; completed/cancelled are final. Categories: `shelf_replenishment, checkout_assistance, inventory_inspection, customer_assistance, camera_maintenance, general_operations`.
* Role eligibility per category is enforced; a supervisor can override with `force: true` (recorded in `task_history`).

## Reports

`GET /api/stores/{id}/reports/summary/full?range=today|yesterday|week|month&compare=none|previous_period` returns the whole Reports page document
(overview KPIs with previous-period comparison, shoppers, inventory, queues, operations) computed from stored records only, plus `unavailableFields`
(e.g. shopper bounce rate and counter utilisation are not recorded and are `null`).
`GET .../reports/export/{overview|shoppers|inventory|queues|operations|staff_tasks|alert_history|camera_availability}.csv` is the server-generated CSV (UTF-8 BOM, formula-injection safe).
PDF is produced by the page's existing print-to-PDF flow.

## Customer (public) API

Only status-level shelf availability (`in_stock | low_stock | out_of_stock | unknown`) with an explicit "shelf display only, not total store stock" note.
Never returned: raw CCTV, camera ids/credentials, model identifiers, stockroom quantities, supplier info, employee records/contact details.
Assistance requests are read back only with the long random `statusRef` (>= 190 bits); the short request id is not enough.

## Store Copilot (Phase 5)

`POST /api/copilot/chat` `{query, storeId, conversationId?, requestId?}` -> `{conversation_id, message}`. The model never receives SQL or files: it can only call the
allowlisted read tools (store is fixed by the conversation, not a tool argument). `message` carries `content`, `toolCalls`, `toolResults`, `groundingSources`
(store, module, time range, latest update, supporting measurements), `richPayload` (queue_status | shelf_cards | footfall_chart | staff_list | alerts_list | tasks_table | kpi_summary),
`structuredIssues`, `recommendedActions`, `followUpQuestions`, `actionPreview` and `copilot` (mode `llm_tools` | `deterministic_tools`, model, latency, grounding check).
Write requests only PREPARE a preview; `POST /api/copilot/actions/confirm` `{actionId, idempotencyKey, storeId}` (the human button) executes it once; replays return `replayed: true`.
`POST /api/copilot/chat/{requestId}/stop` cancels a running generation. `GET /api/copilot/health` is the real OpenRouter probe (key + model check) (READY | LOADING | DEGRADED | OFFLINE | NOT_CONFIGURED | ERROR).
Costly requests are rate limited (HTTP 429). A confirmation is **not** proof of identity: there is no authentication.

## System health (Phase 5)

`GET /api/system/health` probes FastAPI, SQLite (schema at head), cameras, inference worker, person model, shelf model, tracking, queue analytics, WebSocket, Ollama and the Staff/Customer PWA backend.
An answering API alone is never reported as a healthy system.

## Real-time

See `PHASE4_INTEGRATION_MAP.md` section 4 (envelope: `{type, storeId, seq, epoch, timestamp, payload}`; types seen in the pipeline test: `hello, snapshot, camera.frame, person.detected, footfall.updated, occupancy.updated, alert.created, camera.status, camera.disconnected, heartbeat`).

## Operations (generated from the live OpenAPI schema; 138 operations)

### alerts

| Method | Path | LAN phone? |
|---|---|---|
| GET | `/api/alerts/{alert_id}` | loopback only |
| PATCH | `/api/alerts/{alert_id}` | loopback only |
| DELETE | `/api/alerts/{alert_id}` | loopback only |
| POST | `/api/alerts/{alert_id}/acknowledge` | loopback only |
| POST | `/api/alerts/{alert_id}/resolve` | loopback only |
| GET | `/api/stores/{store_id}/alerts` | loopback only |
| POST | `/api/stores/{store_id}/alerts` | loopback only |

### analytics

| Method | Path | LAN phone? |
|---|---|---|
| GET | `/api/stores/{store_id}/analytics/config` | loopback only |
| GET | `/api/stores/{store_id}/camera-zones` | loopback only |
| POST | `/api/stores/{store_id}/camera-zones` | loopback only |
| PUT | `/api/stores/{store_id}/camera-zones/{zone_id}` | loopback only |
| DELETE | `/api/stores/{store_id}/camera-zones/{zone_id}` | loopback only |
| GET | `/api/stores/{store_id}/cameras/{camera_id}/calibration` | loopback only |
| PUT | `/api/stores/{store_id}/cameras/{camera_id}/calibration` | loopback only |
| DELETE | `/api/stores/{store_id}/cameras/{camera_id}/calibration` | loopback only |
| PUT | `/api/stores/{store_id}/counters/{counter_id}/queue-region` | loopback only |
| DELETE | `/api/stores/{store_id}/counters/{counter_id}/queue-region` | loopback only |
| GET | `/api/stores/{store_id}/events` | loopback only |
| GET | `/api/stores/{store_id}/footfall/events` | loopback only |
| GET | `/api/stores/{store_id}/heatmap` | loopback only |
| GET | `/api/stores/{store_id}/inventory/history` | loopback only |
| GET | `/api/stores/{store_id}/inventory/model` | loopback only |
| GET | `/api/stores/{store_id}/inventory/observations` | loopback only |
| GET | `/api/stores/{store_id}/inventory/planogram-status` | loopback only |
| GET | `/api/stores/{store_id}/inventory/shelf-regions` | loopback only |
| GET | `/api/stores/{store_id}/movement` | loopback only |
| GET | `/api/stores/{store_id}/occupancy` | loopback only |
| POST | `/api/stores/{store_id}/occupancy/reset` | loopback only |
| GET | `/api/stores/{store_id}/queue/forecast` | loopback only |
| GET | `/api/stores/{store_id}/queue/history` | loopback only |
| GET | `/api/stores/{store_id}/queue/regions` | loopback only |
| GET | `/api/stores/{store_id}/queue/service-rates` | loopback only |
| GET | `/api/stores/{store_id}/queue/status` | loopback only |
| PUT | `/api/stores/{store_id}/shelves/{shelf_id}/region` | loopback only |
| DELETE | `/api/stores/{store_id}/shelves/{shelf_id}/region` | loopback only |
| GET | `/api/stores/{store_id}/zones/analytics` | loopback only |

### cameras

| Method | Path | LAN phone? |
|---|---|---|
| GET | `/api/stores/{store_id}/cameras` | loopback only |
| POST | `/api/stores/{store_id}/cameras` | loopback only |
| GET | `/api/stores/{store_id}/cameras/monitoring` | loopback only |
| GET | `/api/stores/{store_id}/cameras/timeline` | loopback only |
| POST | `/api/stores/{store_id}/cameras/{camera_id}/reconnect` | loopback only |

### copilot

| Method | Path | LAN phone? |
|---|---|---|
| POST | `/api/copilot/actions/cancel` | loopback only |
| POST | `/api/copilot/actions/confirm` | loopback only |
| POST | `/api/copilot/chat` | loopback only |
| POST | `/api/copilot/chat/{request_id}/stop` | loopback only |
| GET | `/api/copilot/context` | loopback only |
| GET | `/api/copilot/conversations` | loopback only |
| GET | `/api/copilot/conversations/{conversation_id}` | loopback only |
| PATCH | `/api/copilot/conversations/{conversation_id}` | loopback only |
| DELETE | `/api/copilot/conversations/{conversation_id}` | loopback only |
| GET | `/api/copilot/health` | loopback only |

### customer

| Method | Path | LAN phone? |
|---|---|---|
| POST | `/api/customer/assistance` | yes |
| GET | `/api/customer/assistance/{status_ref}` | yes |
| POST | `/api/customer/feedback` | yes |
| GET | `/api/public/stores` | yes |
| GET | `/api/public/stores/{store_id}` | yes |
| GET | `/api/public/stores/{store_id}/categories` | yes |
| GET | `/api/public/stores/{store_id}/layout` | yes |
| GET | `/api/public/stores/{store_id}/offers` | yes |
| GET | `/api/public/stores/{store_id}/products` | yes |
| GET | `/api/public/stores/{store_id}/products/{product_id}` | yes |
| GET | `/api/public/stores/{store_id}/queues` | yes |

### ingest

| Method | Path | LAN phone? |
|---|---|---|
| POST | `/api/stores/{store_id}/ingest` | loopback only |

### insights

| Method | Path | LAN phone? |
|---|---|---|
| GET | `/api/stores/{store_id}/insights` | loopback only |
| POST | `/api/stores/{store_id}/insights` | loopback only |
| POST | `/api/stores/{store_id}/insights/{insight_id}/actions` | loopback only |
| POST | `/api/stores/{store_id}/insights/{insight_id}/tasks` | loopback only |

### inventory

| Method | Path | LAN phone? |
|---|---|---|
| GET | `/api/stores/{store_id}/inventory` | loopback only |
| GET | `/api/stores/{store_id}/inventory/alerts` | loopback only |
| GET | `/api/stores/{store_id}/inventory/planograms` | loopback only |
| GET | `/api/stores/{store_id}/inventory/products` | loopback only |
| GET | `/api/stores/{store_id}/inventory/shelves` | loopback only |

### queues

| Method | Path | LAN phone? |
|---|---|---|
| POST | `/api/stores/{store_id}/counters/{counter_id}/status` | loopback only |
| GET | `/api/stores/{store_id}/queue-intelligence` | loopback only |
| POST | `/api/stores/{store_id}/queue/alerts/{alert_id}/resolve` | loopback only |
| POST | `/api/stores/{store_id}/queue/recommendations/{recommendation_id}/deploy` | loopback only |
| PUT | `/api/stores/{store_id}/queue/rules` | loopback only |

### reports

| Method | Path | LAN phone? |
|---|---|---|
| DELETE | `/api/report-configurations/{config_id}` | loopback only |
| GET | `/api/stores/{store_id}/reports/configurations` | loopback only |
| POST | `/api/stores/{store_id}/reports/configurations` | loopback only |
| GET | `/api/stores/{store_id}/reports/export/{category}.csv` | loopback only |
| GET | `/api/stores/{store_id}/reports/summary/full` | loopback only |
| GET | `/api/stores/{store_id}/reports/{category}` | loopback only |

### shoppers

| Method | Path | LAN phone? |
|---|---|---|
| GET | `/api/stores/{store_id}/dwell` | loopback only |
| GET | `/api/stores/{store_id}/footfall` | loopback only |
| GET | `/api/stores/{store_id}/shopper-analytics` | loopback only |

### staff

| Method | Path | LAN phone? |
|---|---|---|
| GET | `/api/staff/me` | yes |
| GET | `/api/staff/me/attendance` | yes |
| POST | `/api/staff/me/check-in` | yes |
| POST | `/api/staff/me/check-out` | yes |
| GET | `/api/staff/me/notifications` | yes |
| GET | `/api/staff/me/schedule` | yes |
| GET | `/api/staff/me/tasks` | yes |
| PATCH | `/api/staff/{employee_id}` | loopback only |
| GET | `/api/staff/{employee_id}` | loopback only |
| POST | `/api/staff/{employee_id}/deactivate` | loopback only |
| GET | `/api/stores/{store_id}/staff` | yes |
| POST | `/api/stores/{store_id}/staff` | loopback only |

### stores

| Method | Path | LAN phone? |
|---|---|---|
| GET | `/api/stores` | loopback only |
| GET | `/api/stores/{store_id}` | loopback only |
| GET | `/api/stores/{store_id}/overview` | loopback only |
| GET | `/api/stores/{store_id}/zones` | loopback only |

### system

| Method | Path | LAN phone? |
|---|---|---|
| GET | `/api/health` | yes |
| GET | `/api/system/health` | loopback only |
| GET | `/api/system/status` | loopback only |

### tasks

| Method | Path | LAN phone? |
|---|---|---|
| GET | `/api/stores/{store_id}/tasks` | yes |
| POST | `/api/stores/{store_id}/tasks` | loopback only |
| GET | `/api/tasks/{task_id}` | yes |
| PATCH | `/api/tasks/{task_id}` | loopback only |
| DELETE | `/api/tasks/{task_id}` | loopback only |
| POST | `/api/tasks/{task_id}/accept` | yes |
| POST | `/api/tasks/{task_id}/assign` | loopback only |
| POST | `/api/tasks/{task_id}/cancel` | loopback only |
| POST | `/api/tasks/{task_id}/complete` | yes |
| GET | `/api/tasks/{task_id}/history` | yes |
| POST | `/api/tasks/{task_id}/report-issue` | yes |
| POST | `/api/tasks/{task_id}/start` | yes |

### vision

| Method | Path | LAN phone? |
|---|---|---|
| GET | `/api/cameras` | loopback only |
| GET | `/api/cameras/{camera_id}` | loopback only |
| GET | `/api/cameras/{camera_id}/detections` | loopback only |
| PUT | `/api/cameras/{camera_id}/source` | loopback only |
| GET | `/api/cameras/{camera_id}/status` | loopback only |
| GET | `/api/cameras/{camera_id}/stream` | loopback only |
| GET | `/api/models/status` | loopback only |
| POST | `/api/vision/reload` | loopback only |
| GET | `/api/vision/status` | loopback only |

### workforce

| Method | Path | LAN phone? |
|---|---|---|
| PATCH | `/api/attendance/{attendance_id}` | loopback only |
| PATCH | `/api/shifts/{shift_id}` | loopback only |
| DELETE | `/api/shifts/{shift_id}` | loopback only |
| GET | `/api/stores/{store_id}/attendance` | loopback only |
| POST | `/api/stores/{store_id}/attendance/events` | loopback only |
| GET | `/api/stores/{store_id}/shifts` | loopback only |
| POST | `/api/stores/{store_id}/shifts` | loopback only |
| GET | `/api/stores/{store_id}/staff/availability` | loopback only |
| GET | `/api/stores/{store_id}/staff/recommendations` | loopback only |
| POST | `/api/stores/{store_id}/staff/recommendations/{recommendation_id}/accept` | loopback only |
| POST | `/api/stores/{store_id}/staff/recommendations/{recommendation_id}/reject` | loopback only |
| GET | `/api/stores/{store_id}/staff/workload` | loopback only |
