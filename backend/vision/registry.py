"""Central AI model registry: reads ai_models/configs/models.json, validates artifacts, loads each model once.

Status lifecycle: NOT_CONFIGURED -> LOADING -> READY | ERROR (and DISABLED when switched off).
A model is only READY after its weights loaded AND a warm-up inference on a blank frame succeeded.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from core.config import BACKEND_DIR
from vision.schemas import ModelStatusOut

log = logging.getLogger("retailedge.vision.registry")

AI_MODELS_DIR = BACKEND_DIR / "ai_models"
CONFIG_PATH = AI_MODELS_DIR / "configs" / "models.json"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class ModelEntry:
    id: str
    name: str
    version: str
    task: str
    path: Optional[str] = None
    runtime: Optional[str] = None
    input_size: Optional[int] = None
    labels: List[str] = field(default_factory=list)
    confidence_threshold: Optional[float] = None
    device_pref: str = "auto"
    enabled: bool = False
    license: Optional[str] = None
    sha256: Optional[str] = None
    notes: Optional[str] = None
    # runtime state
    status: str = "NOT_CONFIGURED"
    device: Optional[str] = None
    loaded_at: Optional[datetime] = None
    load_ms: Optional[float] = None
    last_error: Optional[str] = None
    instance: Any = None

    @property
    def abs_path(self) -> Optional[Path]:
        return (AI_MODELS_DIR / self.path) if self.path else None

    def to_status(self) -> ModelStatusOut:
        return ModelStatusOut(
            id=self.id, name=self.name, version=self.version, task=self.task, runtime=self.runtime,
            path=self.path, input_size=self.input_size, labels=self.labels,
            confidence_threshold=self.confidence_threshold, device=self.device, enabled=self.enabled,
            status=self.status, license=self.license, sha256=self.sha256, loaded_at=self.loaded_at,
            load_ms=self.load_ms, last_error=self.last_error,
        )


def parse_config(raw: Dict[str, Any]) -> List[ModelEntry]:
    entries: List[ModelEntry] = []
    for m in raw.get("models", []):
        entries.append(ModelEntry(
            id=m["id"], name=m["name"], version=str(m.get("version", "0")), task=m["task"],
            path=m.get("path"), runtime=m.get("runtime"), input_size=m.get("inputSize"),
            labels=list(m.get("labels", [])), confidence_threshold=m.get("confidenceThreshold"),
            device_pref=m.get("device", "auto"), enabled=bool(m.get("enabled", False)),
            license=m.get("license"), sha256=m.get("sha256"), notes=m.get("notes"),
        ))
    return entries


class ModelRegistry:
    """Owns the in-process model instances; one load per model per worker."""

    def __init__(self, entries: List[ModelEntry], device: str,
                 on_status: Optional[Callable[[ModelEntry], None]] = None):
        self.entries: Dict[str, ModelEntry] = {e.id: e for e in entries}
        self.device = device
        self._on_status = on_status
        self._lock = threading.RLock()

    @classmethod
    def from_file(cls, device: str, path: Path = CONFIG_PATH, **kw) -> "ModelRegistry":
        raw = json.loads(path.read_text(encoding="utf-8"))
        return cls(parse_config(raw), device, **kw)

    def _set(self, e: ModelEntry, status: str, error: Optional[str] = None) -> None:
        e.status, e.last_error = status, error
        if self._on_status:
            try:
                self._on_status(e)
            except Exception:  # noqa: BLE001
                log.exception("model status callback failed")

    def load_all(self) -> None:
        for e in self.entries.values():
            self.load(e.id)

    def load(self, model_id: str) -> ModelEntry:
        with self._lock:
            e = self.entries[model_id]
            if e.instance is not None and e.status == "READY":
                return e  # already loaded once for this worker
            if not e.enabled:
                self._set(e, "DISABLED" if e.path else "NOT_CONFIGURED")
                return e
            if not e.path or not e.runtime:
                self._set(e, "NOT_CONFIGURED", "no weights path/runtime configured")
                return e
            self._set(e, "LOADING")
            started = time.perf_counter()
            try:
                path = e.abs_path
                assert path is not None
                if not path.is_file():
                    raise FileNotFoundError(f"weights not found: {e.path}")
                actual = sha256_file(path)
                if e.sha256 and actual.lower() != e.sha256.lower():
                    raise ValueError(f"checksum mismatch for {e.path}: expected {e.sha256[:12]}…, got {actual[:12]}…")
                e.sha256 = actual
                if e.runtime == "ultralytics":
                    from vision.detector import PersonDetector, YoloDetector

                    e.device = self.device if e.device_pref == "auto" else e.device_pref
                    if e.task == "person_detection":
                        det = PersonDetector(path, device=e.device, imgsz=e.input_size or 640, conf=e.confidence_threshold or 0.35)
                    else:  # custom retail models (e.g. shelf products): all classes of the checkpoint
                        # no CUDA graph: capturing one while the person model's inference thread is already running invalidates the capture; the shelf model only runs every few seconds anyway
                        det = YoloDetector(path, device=e.device, imgsz=e.input_size or 640, conf=e.confidence_threshold or 0.35, use_cuda_graph=False)
                        names = [str(n) for _, n in sorted(det.names.items())] if isinstance(det.names, dict) else list(det.names)
                        if e.labels and list(e.labels) != names:
                            raise ValueError(f"checkpoint classes {names} do not match configured labels {list(e.labels)}")
                        e.labels = names
                    det.warmup()
                    e.instance = det
                else:
                    raise ValueError(f"unsupported runtime '{e.runtime}'")
                e.load_ms = round((time.perf_counter() - started) * 1000, 1)
                e.loaded_at = datetime.now(timezone.utc)
                self._set(e, "READY")
                log.info("model %s READY on %s in %.0f ms", e.id, e.device, e.load_ms)
            except Exception as exc:  # noqa: BLE001
                e.instance = None
                self._set(e, "ERROR", str(exc)[:390])
                log.error("model %s failed to load: %s", e.id, exc)
            return e

    def get_ready(self, task: str) -> Optional[ModelEntry]:
        for e in self.entries.values():
            if e.task == task and e.status == "READY" and e.instance is not None:
                return e
        return None

    def statuses(self) -> List[ModelStatusOut]:
        return [e.to_status() for e in self.entries.values()]
