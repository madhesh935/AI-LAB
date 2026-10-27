"""Shelf stock logic on top of a validated shelf-product detector's output.

Pipeline:  detections -> shelf region -> supported classes -> visible count -> availability % -> raw status
           -> repeated-observation confirmation -> confirmed status (and alert-worthy transitions).

Visible count is what the camera sees on the SHELF FACE, not warehouse stock; occlusion makes it a lower bound.
This module never runs a model: it consumes detections, so it can be tested without one and can never turn a
person detector into a fake product detector.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Sequence, Set, Tuple

from analytics.geometry import point_in_polygon

STATUSES = ("in_stock", "low_stock", "out_of_stock", "uncertain", "camera_offline")


@dataclass
class ShelfCfg:
    shelf_id: str
    polygon: Sequence[Sequence[float]]
    class_map: Dict[str, str]  # detector class -> product id / category label counted for this shelf
    expected_capacity: int
    low_pct: float = 30.0
    out_pct: float = 5.0
    confirm_n: int = 3
    min_conf: float = 0.4
    occlusion_limit: float = 0.25  # fraction of the shelf region covered by people above which low/out readings are unreliable


@dataclass(frozen=True)
class Det:
    cls: str
    conf: float
    x: float
    y: float
    w: float
    h: float

    @property
    def center(self) -> Tuple[float, float]:
        return (self.x + self.w / 2.0, self.y + self.h / 2.0)


@dataclass
class ShelfSample:
    shelf_id: str
    at: datetime
    count: int
    per_class: Dict[str, int]
    mean_confidence: Optional[float]
    availability_pct: Optional[float]
    occluded_fraction: float
    raw_status: str
    reason: Optional[str] = None
    boxes: List[Tuple[str, float, float, float, float, float]] = field(default_factory=list)  # (class, conf, x, y, w, h)


def _bbox_of(poly: Sequence[Sequence[float]]) -> Tuple[float, float, float, float]:
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


def occluded_fraction(poly: Sequence[Sequence[float]], people: Sequence[Tuple[float, float, float, float]]) -> float:
    """Share of the shelf's bounding rectangle covered by people boxes (union approximated by clipped sum, capped at 1)."""
    if not poly:
        return 0.0
    x0, y0, x1, y1 = _bbox_of(poly)
    area = max((x1 - x0) * (y1 - y0), 1e-9)
    covered = 0.0
    for px, py, pw, ph in people:
        ix = max(0.0, min(x1, px + pw) - max(x0, px))
        iy = max(0.0, min(y1, py + ph) - max(y0, py))
        covered += ix * iy
    return min(1.0, covered / area)


def sample_shelf(cfg: ShelfCfg, dets: Sequence[Det], people: Sequence[Tuple[float, float, float, float]], at: datetime,
                 model_ready: bool = True) -> ShelfSample:
    """One observation of one shelf."""
    if not model_ready:
        return ShelfSample(cfg.shelf_id, at, 0, {}, None, None, 0.0, "uncertain", "MODEL_NOT_CONFIGURED")
    kept = [d for d in dets if d.cls in cfg.class_map and d.conf >= cfg.min_conf and point_in_polygon(d.center, cfg.polygon)]
    per_class: Dict[str, int] = {}
    for d in kept:
        key = cfg.class_map[d.cls]
        per_class[key] = per_class.get(key, 0) + 1
    count = len(kept)
    mean_conf = round(sum(d.conf for d in kept) / count, 3) if count else None
    occ = occluded_fraction(cfg.polygon, people)
    boxes = [(d.cls, round(d.conf, 3), round(d.x, 4), round(d.y, 4), round(d.w, 4), round(d.h, 4)) for d in kept]
    if cfg.expected_capacity <= 0:
        return ShelfSample(cfg.shelf_id, at, count, per_class, mean_conf, None, occ, "uncertain", "no expected visible capacity configured", boxes)
    pct = round(count / cfg.expected_capacity * 100.0, 1)
    if count == 0 or pct <= cfg.out_pct:
        raw = "out_of_stock"
    elif pct < cfg.low_pct:
        raw = "low_stock"
    else:
        raw = "in_stock"
    reason = None
    if raw in ("low_stock", "out_of_stock") and occ > cfg.occlusion_limit:
        raw, reason = "uncertain", f"shelf {int(occ * 100)}% covered by people; count is only a lower bound"
    return ShelfSample(cfg.shelf_id, at, count, per_class, mean_conf, min(pct, 100.0), occ, raw, reason, boxes)


@dataclass
class StockState:
    """Confirmed status with repeated-observation confirmation (prevents single-frame false stock-outs)."""

    confirm_n: int = 3
    uncertain_after: int = 9
    confirmed: str = "uncertain"
    _pending: Optional[str] = None
    _streak: int = 0
    _uncertain_run: int = 0

    def feed(self, raw_status: str) -> Tuple[str, bool]:
        """Returns (confirmed_status, changed)."""
        prev = self.confirmed
        if raw_status == "uncertain":
            self._uncertain_run += 1
            if self._uncertain_run >= self.uncertain_after and self.confirmed != "uncertain":
                self.confirmed, self._pending, self._streak = "uncertain", None, 0
            return self.confirmed, self.confirmed != prev
        self._uncertain_run = 0
        if raw_status == self.confirmed:
            self._pending, self._streak = None, 0
            return self.confirmed, False
        if raw_status == self._pending:
            self._streak += 1
        else:
            self._pending, self._streak = raw_status, 1
        if self._streak >= self.confirm_n:
            self.confirmed, self._pending, self._streak = raw_status, None, 0
        return self.confirmed, self.confirmed != prev


# ----------------------------------------------------------------------------- planogram
@dataclass
class Slot:
    slot_id: str
    rect: Tuple[float, float, float, float]  # x, y, w, h normalised
    expected_class: str  # detector class expected in this slot


@dataclass
class SlotResult:
    slot_id: str
    state: str  # compliant | missing_product | wrong_category | unsupported
    expected: str
    observed: Optional[str]


@dataclass
class PlanogramResult:
    compliance_pct: Optional[float]
    slots: List[SlotResult]
    unexpected: List[Tuple[str, float, float]]  # (class, cx, cy) detections in the shelf but outside every slot
    supported_slots: int
    total_slots: int
    note: Optional[str] = None


def compare_planogram(slots: Sequence[Slot], dets: Sequence[Det], model_classes: Set[str], shelf_poly: Sequence[Sequence[float]] = (),
                      min_conf: float = 0.4) -> PlanogramResult:
    """Compare expected slot contents with detections.

    Only slots whose expected class the model can recognise are judged (`unsupported` otherwise); an unsupported slot is
    never reported as compliant or wrong - we do not claim SKU placement the detector cannot see."""
    usable = [d for d in dets if d.conf >= min_conf]
    results: List[SlotResult] = []
    claimed: Set[int] = set()
    for s in slots:
        if s.expected_class not in model_classes:
            results.append(SlotResult(s.slot_id, "unsupported", s.expected_class, None))
            continue
        sx, sy, sw, sh = s.rect
        inside = [(i, d) for i, d in enumerate(usable) if sx <= d.center[0] <= sx + sw and sy <= d.center[1] <= sy + sh]
        claimed.update(i for i, _ in inside)
        if not inside:
            results.append(SlotResult(s.slot_id, "missing_product", s.expected_class, None))
            continue
        counts: Dict[str, int] = {}
        for _, d in inside:
            counts[d.cls] = counts.get(d.cls, 0) + 1
        top = max(counts, key=counts.get)
        results.append(SlotResult(s.slot_id, "compliant" if top == s.expected_class else "wrong_category", s.expected_class, top))
    unexpected = [(d.cls, round(d.center[0], 3), round(d.center[1], 3)) for i, d in enumerate(usable)
                  if i not in claimed and (not shelf_poly or point_in_polygon(d.center, shelf_poly))]
    judged = [r for r in results if r.state != "unsupported"]
    pct = round(sum(1 for r in judged if r.state == "compliant") / len(judged) * 100.0, 1) if judged else None
    note = None if judged else "no planogram slot uses a class the detector supports"
    return PlanogramResult(pct, results, unexpected, len(judged), len(results), note)
