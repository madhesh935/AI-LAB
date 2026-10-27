# Phase 4 - Frontend audit and file-level integration map

Audited before any change: every page, its route, API client calls, TypeScript types, hard-coded data, state, button actions, required backend
operations and shared records. Designs, routes and component names were preserved; nothing was rebuilt.

## 1. Findings of the audit (what was wrong before Phase 4)

| Finding | Where | Resolution |
|---|---|---|
| Every `apiService` call silently fell back to fixtures (`console.warn` then `getMock*`) | `src/services/apiService.ts` | REAL mode throws `ApiError`; pages render Offline / Not configured / Error + Retry. Fixtures exist only in `VITE_DATA_MODE=demo`. |
| Page types were non-nullable (`number`), so "not measured" was impossible to express | `src/types/retail.ts` | Types widened to `number \| null`; `tsc` then listed every unsafe use (59) and each was fixed; unmeasured values render as an em dash. |
| Hard-coded "live" numbers inside components (`96.8%` detection accuracy, `+14.2% vs yesterday`, `Fresh Produce (82%)`, `88.4% reach checkout`, `Peak 6-8 PM`, `Counter 2 - 5.8 min`, `24 racks`, `99% confidence` ...) | dashboard / shopper / inventory / queue / insights components | Replaced by values derived from the backend payload, or removed. |
| Simulated camera canvases that draw fake detections (shelf camera, checkout camera, shopper journey map) | `LiveShelfCameraMonitoring`, `LiveCheckoutCamera`, `UnifiedShopperMap` | REAL mode uses the existing Phase-2 player (`CameraFeedCard` + `LiveVideoCanvas`) or an explicit Offline state; `MeasuredZoneMap` draws only counted zones/moves. The originals still run in DEMO mode. |
| Staff Management / Staff PWA / Customer PWA were three separate localStorage worlds | `staffService`, `staffApiService`, `customerService` | One backend task engine; one `StaffDataSource` facade; public API for customers. |
| Fixture employee ids (`STF-01`) and the store id `store-blr-104` baked into services/contexts | `StaffAuthContext`, `staffApiService`, `customerService` | Store and roster come from the API (`/api/public/stores`, `/api/stores/{id}/staff`). |
| A "PIN" login that did nothing, "Authorized Workforce Access Only" | `StaffLogin` | Honest copy: it only selects which employee the phone acts as; PIN field removed. |
| `offlineStorage.processQueue()` with no executor marked queued actions as synced without sending anything | `offlineStorage.ts` | Fixed: nothing is removed unless the server confirmed it. |
| Customer app showed raw counts, SKUs, "Live Computer Vision", an assigned employee's name, a promised arrival time | customer pages | Public API returns status-only shelf availability; the employee is never named; arrival is not promised. |

## 2. Shared infrastructure (new)

| File | Responsibility |
|---|---|
| `src/services/api/config.ts` | `VITE_DATA_MODE` (real\|demo), `VITE_API_URL` (dev default `http://127.0.0.1:8000`), WS URL helper |
| `src/services/api/client.ts` | the only HTTP client: typed JSON, backend error envelope -> `ApiError`, cancellation, timeout, bounded retry for GET, `Idempotency-Key`, connectivity state |
| `src/services/api/realtime.ts` | ONE WebSocket per tab: hello/snapshot, replay or resync, dedupe by `eventId`, heartbeat stale detection, reconnect with backoff, `useRealtime`, `useRealtimeEvents`, `useLiveRefresh` |
| `src/services/api/adapters/*.ts` | DTO -> existing page models (`overview, shopper, inventory, queue, cameras, insights, reports, workforce`); unmeasured stays `null` |
| `src/services/api/staffRemote.ts` | REAL Staff Management data source (cache + server-first writes) |
| `src/services/api/useStaffPage.ts` | `runStaffAction` (truthful outcome toasts), `useServerChanged` |
| `src/components/common/ModeBadge.tsx`, `BackendState.tsx` | REAL/DEMO + Live/Stale/Offline chips; the Offline / Not configured / Retry panel |
| `src/utils/display.ts` | `fmt`, `signed`, `withUnit`, `barPct` - null renders as an em dash |

## 3. Page -> API -> tables map

| Page (route) | Frontend entry | Adapter | Backend endpoints | Tables read | Records written / shared |
|---|---|---|---|---|---|
| Overview `/` | `StoreContext.loadData` -> `apiService.getStoreOverview` | `adaptOverview` | `GET /api/stores`, `/stores/{id}/overview`, WS | stores, footfall_*, occupancy_state, shelf_observations, queue_observations, alerts, tasks, camera_status | alerts (ack/resolve) |
| Shopper Analytics `/shopper-analytics` | `getShopperAnalytics` | `adaptShopper` | `/shopper-analytics`, `/dwell`, `/movement`, `/zones` | footfall_aggregates, dwell_time_aggregates, movement_aggregates, zone_visits, store_zones | none (read-only) |
| Smart Inventory `/smart-inventory` | `getSmartInventoryData` | `adaptInventory` | `/inventory`, `/tasks`, `/staff`, `/reports/summary/full`, `/cameras`; actions: `POST /tasks`, `PATCH /tasks/{id}`, `POST /alerts/{id}/acknowledge|resolve` | shelves, shelf_observations, products, planograms, alerts, tasks | **tasks** (shared), alerts |
| Queue Intelligence `/queue-intelligence` | `getQueueIntelligenceData` | `adaptQueue` | `/queue-intelligence`, `/queue/history`, `/staff/recommendations`, `/staff`, `/cameras`; actions: counter status, `POST /queue/recommendations/{id}/deploy`, `PUT /queue/rules` | queue_observations, queue_forecasts, checkout_counters, alerts | **tasks** (Checkout Assistance, shared), counters, queue rules |
| Live cameras (Overview section + Shelf/Checkout camera) | `CameraSection`, `LiveShelfCameraReal`, `LiveCheckoutCameraReal` | `adaptCamera`, `adaptCameraEvent` | `GET /api/cameras` (Phase 2 poll), `/stores/{id}/cameras/timeline`, `POST /cameras/{id}/reconnect` | cameras, camera_status, camera_status_events, domain_events, alerts | camera status transitions |
| AI Insights `/ai-insights` | `getOperationalInsightsData` | `adaptInsights` | `/insights`, `POST /insights/{id}/actions`, `POST /insights/{id}/tasks` | insights, tasks | insights, **tasks** |
| Reports `/reports` | `getStoreReportsData` | `adaptReport` | `/reports/summary/full`, `/reports/export/{category}.csv` | every history table (see `services/report_builder.py`) | none |
| Staff Management `/staff-management` | `staffService` (-> `staffRemote`) | `adaptEmployee/Shift/Attendance/Task/...` | `/staff`, `/shifts`, `/attendance`, `/tasks`, `/staff/{recommendations,availability,workload}` and their writes | employees, shifts, attendance, tasks, task_history, recommendation_decisions | employees, shifts, attendance (supervisor override), **tasks** |
| Staff PWA `/staff/*` | `staffApiService` | `adaptTask/Shift/Attendance` | `/staff/me/*`, `/tasks/{id}/{accept,start,complete,report-issue}`, WS `audience=staff` | tasks, shifts, attendance | **tasks**, attendance (server timestamp); offline writes go through the pending-sync queue |
| Customer PWA `/customer/*` | `customerService.hydrate` + `submitAssistanceRequestAsync` | `toProduct`, queue/layout mapping | `/api/public/stores/*`, `POST /api/customer/assistance`, `GET /api/customer/assistance/{statusRef}`, `POST /api/customer/feedback`, WS `audience=customer` | products, shelf_observations (status only), queue_observations, customer_assistance_requests | customer_assistance_requests + one **task** |

### The shared records (no duplicates)

* `tasks` is the single task record for: manual tasks (Staff Management), replenishment (Smart Inventory), checkout assistance (Queue Intelligence),
  insight-derived tasks (AI Insights), accepted staffing recommendations, and customer assistance requests. Every writer goes through `TaskService`
  (idempotency keys, compare-and-swap transitions, de-duplication of OPEN tasks for the same alert/shelf/counter/camera, history rows).
* `customer_assistance_requests` -> exactly one `tasks` row (`customer_request_id`); task status changes flow back to the request.
* Attendance comes only from self check-in / supervisor events / supervisor override - never from surveillance.

## 4. Event contract (single WebSocket per tab)

`/ws/stores/{store_id}/events?since=<seq>&epoch=<epoch>&audience=staff|customer` -> `hello`, `snapshot`, (`replayed` events | `resync`), live events, heartbeat/15 s.
Envelope: `{eventId, seq, storeId, type, timestamp, source, payload}`. Types: `footfall.updated, occupancy.updated, shelf.updated, inventory.alert, queue.updated, camera.status, task.created, task.assigned, task.completed (+ task.*), customer.assistance.created|updated, alert.*, attendance.*, shift.*, staff.*, recommendation.*`.
Remote (LAN) clients must declare an audience and only receive that audience's event types.
