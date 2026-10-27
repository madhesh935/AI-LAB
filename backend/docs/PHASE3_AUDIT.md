# Phase 3 audit - what existed before the analytics work

Read before writing any Phase 3 code (frontend at `D:\new\src`, backend at `D:\new\backend`).

## Frontend data contracts (unchanged in Phase 3)

`src/services/apiService.ts` already names the routes each page needs. Phase 1 built the backend to those shapes; Phase 3 only makes the
tables behind them REAL:

| Page / widget | Route it reads | Table(s) Phase 3 now writes |
|---|---|---|
| Shopper Analytics (footfall chart, KPIs) | `GET /api/stores/{id}/footfall`, `/shopper-analytics` | `footfall_events`, `footfall_aggregates` (store-local hours) |
| Zone / dwell panels, store map | `/zones`, `/dwell` | `zone_visits`, `dwell_time_aggregates`, `zone_occupancy`, `movement_aggregates` |
| Queue Intelligence (counter cards, waits, forecast, alerts) | `/queue-intelligence` | `queue_observations`, `queue_forecasts`, `alerts` |
| Smart Inventory (shelf grid, alerts, planograms) | `/inventory`, `/inventory/shelves`, `/inventory/alerts` | `shelf_observations`, `alerts` |
| Alerts everywhere | `/alerts`, `/alerts/{id}/acknowledge|resolve` | `alerts` (lifecycle: dedupe key, occurrences, auto-resolve) |

No frontend file was modified in Phase 3 (the instruction was not to redesign it). The dashboard still reads these through its built-in data unless
`VITE_API_URL` is set (it must stay unset until the page types are aligned - a Phase 1 finding that still holds).

## Existing backend before Phase 3

* Tables: `footfall_events/aggregates`, `zone_occupancy`, `dwell_time_aggregates`, `movement_aggregates`, `checkout_counters`, `queue_observations/forecasts/rules`,
  `shelves`, `shelf_products`, `shelf_observations`, `planograms`, `alerts`, `model_registry`, `store_zones` (floor-plan rectangles).
* Services/routes that READ them (shoppers, queues, inventory, alerts) and `POST /api/stores/{id}/ingest` (Phase 1 contract for workers).
* Phase 2: person detector (YOLO11n), ByteTrack with anonymous per-camera ids, MJPEG gateway, worker -> API event relay + EventBus.
* **Missing**: camera-space geometry (zones/lines/queue/shelf regions), anything that turns tracks into counts, a shelf model, an event/alert engine.

## Geometry decision

`store_zones` holds floor-plan rectangles. Camera detections live in IMAGE space, so Phase 3 adds `camera_zones` (normalised polygons + optional directed
counting line), `queue_regions`, `shelf_regions` and `camera_calibrations` (image->floor homography). Floor-plan heatmaps are produced only for cameras
with a calibration row; otherwise the API answers 409 `calibration required`. Nothing links a person across cameras.

## Shelf dataset search (Part C1)

Searched: `D:\` (including `D:\retail\Retail_New`, `D:\ml_new`, `D:\new`), `C:\Users\madhe\{Downloads,Documents,Desktop,Pictures}` for images, YOLO/COCO/VOC
annotations, `data.yaml`, planograms, SKU lists and trained shelf models.

| Found | Verdict |
|---|---|
| `D:\retail\Retail_New\barcodes\*.png` (19 files) + `catalog.json` | barcode images for an older retail demo - not shelf photos, no boxes |
| `C:\Users\madhe\Downloads\datasets\runs\detect\train\args.yaml` | a **1-epoch** attempt at `SKU-110K.yaml` with `yolov8n.pt`; `weights/` is empty and the SKU-110K dataset is not on disk. No usable model |
| ~63 unrelated screenshots/images in Downloads (slides, passes, chat images) | not shelf data |
| any shelf photos, product images with labels, bounding-box annotations, planogram images, trained shelf weights | **none** |

Conclusion: **no valid labeled shelf dataset exists**. No shelf model was trained, and none is claimed. What was built instead is the full pipeline that
turns a dataset into a trusted, registered model the moment one exists (`ml/shelf/*`, see the report) plus the inference path that stays inert
(`MODEL_NOT_CONFIGURED`) until then.

## Footage available for evaluation

Intel IoT DevKit sample videos (CC BY 4.0), downloaded into `data/samples/`: `people-detection.mp4` (768x432, 12 fps, 8 people, doorways - used with manual
ground truth), `store-aisle-detection.mp4` (store aisle, 60 fps, up to 5 people - mechanics only), `one-by-one-person-detection.mp4`, `worker-zone-detection.mp4`
(not used). **There is no checkout/queue footage and no shelf-product footage**, which limits what can be measured (see the report).
