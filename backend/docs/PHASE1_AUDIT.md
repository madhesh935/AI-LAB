# Phase 1 audit - frontend routes, data contracts, and backend mapping

Everything below was read from the repository (not assumed). Source of truth:
`src/App.tsx` (routes), `src/services/apiService.ts` (admin API contract),
`src/services/{staffApiService,customerService,copilotService}.ts`, `src/types/retail.ts`.

## 1. Repository inventory (relevant parts)

| Area | Path |
|---|---|
| React entry / router | `src/main.tsx`, `src/App.tsx` (react-router-dom v7, `BrowserRouter`) |
| Vite config | `vite.config.ts` (react plugin, `@` alias; no dev proxy) |
| Admin layout | `src/components/layout/{AppLayout,Sidebar,Header}.tsx` |
| Admin pages | `src/pages/{OverviewDashboard,ShopperAnalytics,SmartInventory,QueueIntelligence,AiInsights,ReportsAnalytics,StaffManagement,StoreCopilot}.tsx` |
| Staff PWA | `src/pages/staff/*`, `src/components/staff-pwa/*`, `public/sw-staff.js` |
| Customer PWA | `src/pages/customer/*`, `src/components/customer/*`, `public/sw-customer.js` |
| State | React context only: `StoreContext`, `StaffAuthContext` (`sessionStorage` employee pick - context, not identity) + TanStack Query for the staff PWA |
| API layer | `src/services/apiService.ts` (admin; `VITE_API_URL`, falls back to mock on any failure), `staffApiService.ts`, `customerService.ts`, `copilotService.ts` (hard-coded `http://127.0.0.1:8000`) |
| Mock data | `src/services/mockData.ts` (~3,900 lines), `staffService.ts`, localStorage persistence |
| WebSocket | `apiService.subscribeToStoreEvents` -> `/ws/stores/{id}/events` (only when `VITE_API_URL` set; otherwise a fake heartbeat timer) |
| Camera components | `src/components/dashboard/CameraFeedCard.tsx`, `CameraFullscreenModal.tsx` (canvas-drawn placeholder video; no real stream) |
| Pre-existing backend | `backend/main.py` (single file, **in-memory** copilot / staff / customer endpoints), `tools.py` (hard-coded fixtures), `llm_adapter.py` (Ollama + deterministic engine) |
| SQLite files / models / datasets | **none existed** (no `.db`, `.pt`, `.onnx`, notebooks, CSVs) |
| Python venvs | none existed; `backend/.venv` created in Phase 1 |
| Tests | none existed (frontend or backend) |

## 2. Route audit

`/live-cameras` appears in `README.md` but **is not routed** in `App.tsx`; live camera tiles exist only as the
"Live Cameras" section of Overview. There is no Store Management / Settings route and none was added.
`getMockLiveCamerasData` + `apiService.getLiveCamerasData` exist for a future page.

| Route | Component | Layout | Data source today | API calls (when `VITE_API_URL` set) | Needed backend |
|---|---|---|---|---|---|
| `/` | OverviewDashboard | AppLayout | `getMockOverviewData` | `GET /stores/{id}/overview`, `/alerts`, `POST /alerts/{id}/acknowledge|resolve`, WS | overview, alerts, cameras |
| `/shopper-analytics` | ShopperAnalytics | AppLayout | `getMockShopperData` | `/shopper-analytics`, `/footfall`, `/zones`, `/dwell` | shoppers |
| `/smart-inventory` | SmartInventory | AppLayout | `getMockSmartInventoryData` | `/inventory`, `/inventory/shelves|alerts|planograms`, `GET/POST /tasks`, `PATCH /tasks/{id}` | inventory, tasks, alerts |
| `/queue-intelligence` | QueueIntelligence | AppLayout | `getMockQueueIntelligenceData` | `/queue-intelligence`, `POST /counters/{id}/status`, `POST /queue/recommendations/{id}/deploy`, `POST /queue/alerts/{id}/resolve`, `PUT /queue/rules` | queues |
| *(not routed)* Live Cameras | - | - | `getMockLiveCamerasData` | `/cameras/monitoring`, `POST /cameras`, `POST /cameras/{id}/reconnect` | cameras |
| `/ai-insights` | AiInsights | AppLayout | `getMockAiInsightsData` | `/insights`, `POST /insights/{id}/actions`, `POST /insights/{id}/tasks` | insights |
| `/reports` | ReportsAnalytics | AppLayout | `getMockReportData` | `/reports/{category}` | reports (+ saved configurations) |
| `/staff-management` | StaffManagement | AppLayout | `staffService` + localStorage | *(none - fully local today)* | staff, shifts, attendance, tasks |
| `/store-copilot` | StoreCopilot | AppLayout | `copilotService` (local engine, optional backend) | `/api/copilot/{health,conversations,chat,actions/confirm}` | copilot |
| `/staff/login`, `/staff`, `/staff/tasks[/:id]`, `/staff/schedule`, `/staff/attendance`, `/staff/notifications`, `/staff/profile` | `pages/staff/*` | StaffLayout + `StaffProtectedRoute` (session pick) | `staffService` (+ prefetch `GET /api/staff/me/tasks`) | `/api/staff/me*`, `/api/tasks/{id}/accept|start|complete|report-issue` | staff PWA |
| `/customer`, `/products[/:id]`, `/map`, `/list`, `/queues`, `/offers`, `/help`, `/profile` | `pages/customer/*` | CustomerLayout | `customerService` (local) | `/api/public/stores*`, `/api/customer/assistance`, `/api/customer/feedback` | customer |
| `*` | - | - | - | redirects to `/` | - |

Status today: all 8 admin pages + both PWAs render from local mock data (verified in a browser, all routes load,
no console errors). With `VITE_API_URL` **unset** the frontend never calls the new backend (except the staff
task prefetch and Copilot, which hit `127.0.0.1:8000`).

## 3. Integration matrix (frontend -> backend)

| Frontend need | TS interface | Backend endpoint | Service | SQLite tables | Fidelity in Phase 1 |
|---|---|---|---|---|---|
| Overview KPIs/cameras/alerts | `StoreOverviewData` | `GET /api/stores/{id}/overview` | `OverviewService` | footfall_*, queue_observations, shelf_observations, cameras, camera_status, alerts, tasks | field names match; values `null` when unmeasured |
| Shopper analytics | `ShopperAnalyticsData` | `/shopper-analytics`, `/footfall`, `/dwell`, `/zones` | `ShopperService` | footfall_aggregates/events, zone_occupancy, dwell_time_aggregates, movement_aggregates | core fields (hourly, zones, dwell, movements); heatmap/paths/peak-slot extras not yet |
| Smart inventory | `SmartInventoryData` | `/inventory`, `/inventory/shelves|products|planograms|alerts` | `InventoryService` | shelves, products, shelf_products, shelf_observations, planograms, alerts | shelf/product/planogram/alert core fields |
| Restock tasks | `ReplenishmentTask` | `/tasks` CRUD | `TaskService` | tasks, task_history | superset of `StaffTask`/task fields |
| Queue intelligence | `QueueIntelligenceData` | `/queue-intelligence`, counters/rules/deploy | `QueueService` | checkout_counters, queue_observations, queue_forecasts, queue_rules | counters, KPIs, forecast, alerts, rules; staffing *recommendations* are not generated yet |
| Live cameras | `LiveCamerasData` | `/cameras`, `/cameras/monitoring`, register, reconnect | `CameraService` | cameras, camera_status, camera_zone_mapping | status/heartbeat only; no detections/events yet |
| AI insights | `AiInsightsData` | `/insights` (+ actions, task) | `InsightService` | insights | list, KPIs, actions; forecast/opportunities = `null`/`[]` (no model) |
| Reports | `*ReportData` | `/reports/{category}` (+ `/reports/configurations`) | `ReportService` | all observation tables, report_configurations | real aggregates; shape is `{summary, series}` not the TS report types yet |
| Staff directory/KPIs | `StaffEmployee`, `StaffManagementKpis` | `/stores/{id}/staff`, `PATCH /staff/{id}` | `StaffService` | employees, tasks, attendance | core fields |
| Staff PWA | `StaffTaskExtended` ... | `/api/staff/me*`, task lifecycle | `StaffService`, `TaskService` | employees, shifts, attendance, tasks | existing URLs preserved |
| Copilot | `CopilotConversation` ... | `/api/copilot/*` | `CopilotService` | copilot_* | persisted; engine still uses legacy fixtures (see 5) |
| Customer PWA | `CustomerAssistanceRequest`, `CustomerOffer` ... | `/api/public/*`, `/api/customer/*` | `PublicStoreService`, `CustomerService` | stores, store_zones, offers, customer_* , tasks | existing URLs preserved |
| Realtime | `{type, payload}` | `WS /ws/stores/{id}/events` | `EventBus` | - | TASK_/ALERT_/INSIGHT_/CAMERA_/TELEMETRY_ events + heartbeat |

**Important:** the frontend only reads these endpoints once `VITE_API_URL` is set, and several page shapes
(shopper movement paths, queue staffing recommendations, report TS types) still need adapters in Phase 2/3.
Phase 1 deliberately did not edit the frontend.

## 4. Frontend-generated fake values and what replaces them

| Fake value (where) | Backend source | Needs computer vision? |
|---|---|---|
| Footfall, occupancy (`mockData.getMockOverviewData`) | `footfall_events/aggregates` (+ `zone_occupancy`) | **Yes** - entrance tripwire counts |
| Dwell time, zone occupancy, movement paths | `dwell_time_aggregates`, `zone_occupancy`, `movement_aggregates` | **Yes** - person tracking / re-ID |
| Camera connectivity, FPS, `HEARTBEAT_TICK` (`Math.random`) | `camera_status` | No - stream supervisor (Phase 2) |
| Detection boxes / people counts per camera | `inference_events` | **Yes** |
| Stock availability, planogram compliance | `shelf_observations` | **Yes** - shelf gap detection |
| Queue length, waiting time | `queue_observations` | **Yes** - queue head-count |
| Queue forecast | `queue_forecasts` | Model (forecasting) |
| AI recommendations, footfall forecast | `insights` | Rules/forecast engine |
| Staff availability, task status | `employees`, `tasks`, `attendance` | No |
| Copilot telemetry (right panel, hard-coded 148/250/2,840) | `GET /api/copilot/context` (DB-built) | indirectly |
| Customer product availability | `GET /api/public/stores/{id}/products` (camera observations only) | **Yes** |

Not converted to invented backend values: when no observation exists the API returns `null`, `condition="uncertain"`
or `meta.dataState="unavailable"` - never a guessed number.

## 5. Known gaps carried to later phases

* `tools.py`/`llm_adapter.py` (Copilot engine) still read hard-coded fixtures; replies can quote numbers that
  are **not** in SQLite. Persistence of conversations/actions is DB-backed; grounding is Phase 4.
* Bug fixed on the way: `llm_adapter.py` used `datetime` without importing it, so "assign ..." requests raised
  `NameError`.
* `README.md` lists `/live-cameras`, which is not routed.
