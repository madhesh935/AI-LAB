# AI model registry

Central folder for every model the platform can load. The registry is `configs/models.json`; the worker
(`python -m vision`) reads it, verifies each artifact, loads each model **once per worker**, and reports
`NOT_CONFIGURED | LOADING | READY | ERROR | DISABLED` through `GET /api/models/status`.

```
person/        pretrained person detector weights
shelf/         shelf-sku110k-v1/ appears here when `scripts/train_shelf_sku110k.py` finishes and passes its gate
forecasting/   footfall_forecaster.* appears here only after >= 14 days of real footfall (`scripts/train_footfall_forecaster.py`)
configs/       models.json
```

| id | file | task | source | SHA-256 |
|---|---|---|---|---|
| `person-yolo11n` | `person/yolo11n.pt` | person detection (COCO class 0 only) | official Ultralytics YOLO11n COCO checkpoint | `0ebbc80d4a7680d14987a577cd21342b65ecfd94632bd9a8da63ae6417644ee1` |

The checksum in `models.json` is verified at load time; a mismatch puts the model in `ERROR` (it never loads).
No model is trained here - weights are used exactly as published.

## Licence (read before distributing)

Ultralytics YOLO11 code **and its pretrained weights are AGPL-3.0**. Running it internally is fine; shipping
this product to customers, or offering it as a network service, either requires publishing the corresponding
source under AGPL-3.0 or buying an Ultralytics Enterprise licence. If that is not acceptable, swap in a
permissively licensed detector (e.g. an Apache-2.0 RT-DETR / YOLOX export) by adding an entry to `models.json`
with `"runtime": "onnxruntime"` and implementing that runtime in `vision/registry.py` (only `ultralytics` is
implemented today).

## Shelf product model (not trained yet)

`configs/models.json` has a `shelf-monitor` entry that stays `NOT_CONFIGURED` / disabled: **no labeled shelf dataset exists in this repository or on this machine**
(see `docs/PHASE3_AUDIT.md`), so none was trained and the person detector is never used as a product detector. `python -m ml.shelf.train ... --register` fills the entry
(path, labels, checksum, version) only for a dataset that passed `ml.shelf.prepare`'s size/session gates and a test mAP50 threshold. Trained weights go in
`shelf/<name>/weights/best.pt` with `model_card.json` (real metrics, training time, dataset splits, ONNX validation).

## Adding a model

1. Drop the file under the matching folder, 2. add an entry to `configs/models.json` (include `sha256`),
3. restart the worker or `POST` to the worker's `/control/models/{id}/reload` (loopback only).
