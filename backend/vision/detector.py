"""YOLO person detector (pretrained COCO checkpoint, class 0 only).

Pipeline per frame (all explicit, no hidden magic):
  1. letterbox: keep aspect ratio, long side -> `imgsz`, pad to a stride-32 rectangle (grey 114)
  2. BGR->RGB, uint8 -> float/half tensor in [0, 1]
  3. forward pass (CUDA-graph replay on GPU, eager on CPU)
  4. confidence threshold + NMS, person class (COCO id 0) only
  5. boxes scaled back to SOURCE-frame pixel coordinates and clipped

Why CUDA graphs: on this machine an eager YOLO11n forward is CPU-launch-bound (~40 ms for ~300
small kernels) while the replayed graph takes ~1.6 ms with bit-identical output. Graphs are
captured once per input shape; if capture ever fails the detector transparently stays eager.
"""

from __future__ import annotations

import copy
import logging
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
import torch

log = logging.getLogger("retailedge.vision.detector")

PERSON_CLASS_ID = 0
STRIDE = 32
MAX_GRAPH_SHAPES = 8
# Source sizes whose letterboxed shapes cover 16:9, 4:3, 1:1 and portrait cameras (graphs are captured per shape).
WARMUP_SOURCES = ((720, 1280), (480, 640), (640, 640), (1280, 720))


@dataclass
class RawDetections:
    xyxy: np.ndarray  # (N,4) float32, source pixels
    conf: np.ndarray  # (N,)
    cls: np.ndarray  # (N,)
    inference_ms: float  # whole detect() call: letterbox + forward + NMS + scaling
    preprocess_ms: float
    model_ms: float
    postprocess_ms: float


class _GraphRunner:
    """A captured CUDA graph for one fixed input shape.

    Owns a PRIVATE copy of the network: the Detect head caches its anchor tensors per input shape,
    so sharing one module across graphs would free anchors an earlier graph still points at
    (silently producing zero detections)."""

    def __init__(self, net: torch.nn.Module, shape: Tuple[int, int], dtype: torch.dtype, device: str):
        net = copy.deepcopy(net)
        self.net = net
        self.static_in = torch.zeros(1, 3, shape[0], shape[1], device=device, dtype=dtype)
        stream = torch.cuda.Stream()
        stream.wait_stream(torch.cuda.current_stream())
        with torch.cuda.stream(stream), torch.no_grad():
            for _ in range(3):
                net(self.static_in)
        torch.cuda.current_stream().wait_stream(stream)
        self.graph = torch.cuda.CUDAGraph()
        with torch.cuda.graph(self.graph), torch.no_grad():
            out = net(self.static_in)
        self.static_out = out[0] if isinstance(out, (list, tuple)) else out

    def run(self, x: torch.Tensor) -> torch.Tensor:
        self.static_in.copy_(x)
        self.graph.replay()
        return self.static_out.clone()


class YoloDetector:
    """Generic Ultralytics-checkpoint detector (letterbox -> FP16/CUDA-graph forward -> NMS -> source-pixel boxes).

    `classes` restricts NMS to those class ids (None = all classes of the checkpoint). The person detector and the shelf
    product detector share this implementation but are separate registry entries with separate weights."""

    def __init__(self, weights: Path, device: str, imgsz: int = 640, conf: float = 0.35, iou: float = 0.5,
                 use_cuda_graph: bool = True, classes: Optional[List[int]] = None):
        from ultralytics import YOLO

        self.weights = weights
        self.device = device
        self.imgsz = imgsz
        self.conf = conf
        self.iou = iou
        self.classes = classes
        self.is_cuda = device.startswith("cuda")
        self.dtype = torch.float16 if self.is_cuda else torch.float32
        yolo = YOLO(str(weights))
        self.net = yolo.model.to(device).eval()
        self.net = self.net.half() if self.is_cuda else self.net.float()
        for p in self.net.parameters():
            p.requires_grad_(False)
        self.names = getattr(yolo, "names", {})
        self.use_cuda_graph = use_cuda_graph and self.is_cuda
        self._graphs: Dict[Tuple[int, int], _GraphRunner] = {}
        self._lock = threading.Lock()  # the model and its static graph buffers are not re-entrant
        self.mode = "cuda-graph" if self.use_cuda_graph else ("cuda-eager" if self.is_cuda else "cpu")

    # ------------------------------------------------------------------ preprocessing
    def _letterbox(self, frame: np.ndarray) -> Tuple[np.ndarray, float, Tuple[float, float]]:
        h, w = frame.shape[:2]
        r = min(self.imgsz / h, self.imgsz / w)
        nw, nh = int(round(w * r)), int(round(h * r))
        resized = cv2.resize(frame, (nw, nh), interpolation=cv2.INTER_LINEAR) if (nw, nh) != (w, h) else frame
        pad_w = (STRIDE - nw % STRIDE) % STRIDE
        pad_h = (STRIDE - nh % STRIDE) % STRIDE
        left, top = pad_w / 2, pad_h / 2
        out = cv2.copyMakeBorder(
            resized, int(round(top - 0.1)), int(round(pad_h - top + 0.1)),
            int(round(left - 0.1)), int(round(pad_w - left + 0.1)),
            cv2.BORDER_CONSTANT, value=(114, 114, 114),
        )
        return out, r, (left, top)

    def _to_tensor(self, img_bgr: np.ndarray) -> torch.Tensor:
        rgb = np.ascontiguousarray(img_bgr[:, :, ::-1].transpose(2, 0, 1))
        t = torch.from_numpy(rgb).to(self.device, non_blocking=True)
        return (t.to(self.dtype) / 255.0).unsqueeze(0)

    # ------------------------------------------------------------------ forward
    def _forward(self, x: torch.Tensor) -> torch.Tensor:
        shape = (x.shape[2], x.shape[3])
        if self.use_cuda_graph:
            runner = self._graphs.get(shape)
            if runner is None and len(self._graphs) < MAX_GRAPH_SHAPES:
                try:
                    runner = self._graphs[shape] = _GraphRunner(self.net, shape, self.dtype, self.device)
                except Exception as exc:  # noqa: BLE001
                    log.warning("CUDA graph capture failed (%s); using eager execution", exc)
                    self.use_cuda_graph, self.mode = False, "cuda-eager"
            if runner is not None:
                return runner.run(x)
        with torch.no_grad():
            out = self.net(x)
        return out[0] if isinstance(out, (list, tuple)) else out

    def warmup(self) -> None:
        """Run blank frames of common camera shapes so CUDA init and graph capture happen at load time,
        not during the first live frame."""
        for h, w in WARMUP_SOURCES:
            self.detect(np.zeros((h, w, 3), dtype=np.uint8))

    # ------------------------------------------------------------------ public API
    def detect(self, frame_bgr: np.ndarray, conf: float | None = None) -> RawDetections:
        from ultralytics.utils.nms import non_max_suppression

        src_h, src_w = frame_bgr.shape[:2]
        t0 = time.perf_counter()
        boxed, ratio, (padx, pady) = self._letterbox(frame_bgr)
        x = self._to_tensor(boxed)
        t1 = time.perf_counter()
        with self._lock:
            pred = self._forward(x)
            if self.is_cuda:
                torch.cuda.synchronize()
            t2 = time.perf_counter()
            dets = non_max_suppression(
                pred.float(), conf_thres=conf if conf is not None else self.conf, iou_thres=self.iou,
                classes=self.classes, max_det=300,
            )[0]
        if dets is None or len(dets) == 0:
            xyxy = np.zeros((0, 4), np.float32)
            confs = np.zeros((0,), np.float32)
            cls = np.zeros((0,), np.float32)
        else:
            arr = dets.cpu().numpy()
            xyxy = arr[:, :4].astype(np.float32)
            xyxy[:, [0, 2]] = (xyxy[:, [0, 2]] - padx) / ratio
            xyxy[:, [1, 3]] = (xyxy[:, [1, 3]] - pady) / ratio
            xyxy[:, [0, 2]] = xyxy[:, [0, 2]].clip(0, src_w)
            xyxy[:, [1, 3]] = xyxy[:, [1, 3]].clip(0, src_h)
            confs = arr[:, 4].astype(np.float32)
            cls = arr[:, 5].astype(np.float32)
            keep = (xyxy[:, 2] - xyxy[:, 0] > 1) & (xyxy[:, 3] - xyxy[:, 1] > 1)
            xyxy, confs, cls = xyxy[keep], confs[keep], cls[keep]
        t3 = time.perf_counter()
        return RawDetections(
            xyxy=xyxy, conf=confs, cls=cls, inference_ms=round((t3 - t0) * 1000, 2),
            preprocess_ms=round((t1 - t0) * 1000, 2), model_ms=round((t2 - t1) * 1000, 2),
            postprocess_ms=round((t3 - t2) * 1000, 2),
        )


class PersonDetector(YoloDetector):
    """COCO person detector: class 0 only."""

    def __init__(self, weights: Path, device: str, imgsz: int = 640, conf: float = 0.35, iou: float = 0.5, use_cuda_graph: bool = True):
        super().__init__(weights, device, imgsz, conf, iou, use_cuda_graph, classes=[PERSON_CLASS_ID])
