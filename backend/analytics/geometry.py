"""Planar geometry in normalised image coordinates (x right, y down, 0-1) + homography fitting."""

from __future__ import annotations

import math
from typing import List, Optional, Sequence, Tuple

import numpy as np

Point = Tuple[float, float]


def foot_point(x: float, y: float, w: float, h: float) -> Point:
    """Where a person touches the floor: bottom-centre of the bounding box."""
    return (x + w / 2.0, y + h)


def reference_point(x: float, y: float, w: float, h: float) -> Point:
    """Foot point, except when the box touches the bottom edge: the feet are then outside the picture (a seated / close-up person), so the
    middle of the box is used instead of the frame edge."""
    if y + h >= 0.97:
        return (x + w / 2.0, y + h * 0.5)
    return foot_point(x, y, w, h)


def point_in_polygon(pt: Point, poly: Sequence[Sequence[float]]) -> bool:
    """Ray casting. Points exactly on an edge may land either side; callers debounce, so this is harmless."""
    if len(poly) < 3:
        return False
    x, y = pt
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i][0], poly[i][1]
        xj, yj = poly[j][0], poly[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def polygon_area(poly: Sequence[Sequence[float]]) -> float:
    if len(poly) < 3:
        return 0.0
    s = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % len(poly)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def distance_to_polygon_edge(pt: Point, poly: Sequence[Sequence[float]]) -> float:
    """Shortest distance from `pt` to the polygon's boundary (normalised units)."""
    best = float("inf")
    for i in range(len(poly)):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % len(poly)]
        dx, dy = bx - ax, by - ay
        t = 0.0 if dx == 0 and dy == 0 else max(0.0, min(1.0, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / (dx * dx + dy * dy)))
        best = min(best, math.hypot(pt[0] - (ax + t * dx), pt[1] - (ay + t * dy)))
    return best


def signed_distance(p1: Point, p2: Point, pt: Point) -> float:
    """Signed perpendicular distance of `pt` from the infinite line p1->p2 (normalised units).

    Positive when dx*(py-y1) - dy*(px-x1) > 0 (image coordinates, y down)."""
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    length = math.hypot(dx, dy) or 1e-12
    return (dx * (pt[1] - p1[1]) - dy * (pt[0] - p1[0])) / length


def segment_param(p1: Point, p2: Point, pt: Point) -> float:
    """Where along p1->p2 the projection of `pt` falls (0 at p1, 1 at p2)."""
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    denom = dx * dx + dy * dy or 1e-12
    return ((pt[0] - p1[0]) * dx + (pt[1] - p1[1]) * dy) / denom


def infer_in_side(p1: Point, p2: Point, inside_point: Point) -> str:
    """Which side ('positive' or 'negative') of the line a known-inside point is on. Lets an operator configure
    direction by clicking one point inside the store instead of reasoning about cross products."""
    return "positive" if signed_distance(p1, p2, inside_point) > 0 else "negative"


def valid_polygon(poly: Sequence[Sequence[float]], min_area: float = 1e-4) -> Optional[str]:
    """Return an error message, or None if the polygon is usable."""
    if len(poly) < 3:
        return "polygon needs at least 3 points"
    for p in poly:
        if len(p) != 2 or not all(isinstance(v, (int, float)) and 0.0 <= v <= 1.0 for v in p):
            return "polygon points must be [x, y] within 0-1 (normalised image coordinates)"
    if polygon_area(poly) < min_area:
        return "polygon area is (almost) zero"
    return None


# ----------------------------------------------------------------------------- homography
def fit_homography(src: Sequence[Sequence[float]], dst: Sequence[Sequence[float]]) -> List[List[float]]:
    """Direct linear transform from >=4 point pairs (image -> floor plan). Raises ValueError if degenerate."""
    if len(src) != len(dst) or len(src) < 4:
        raise ValueError("calibration needs at least 4 matching point pairs")
    rows = []
    for (x, y), (u, v) in zip(src, dst):
        rows.append([-x, -y, -1, 0, 0, 0, u * x, u * y, u])
        rows.append([0, 0, 0, -x, -y, -1, v * x, v * y, v])
    _, s, vt = np.linalg.svd(np.asarray(rows, dtype=float))
    if s[-2] < 1e-9:
        raise ValueError("calibration points are degenerate (collinear or duplicated)")
    h = vt[-1].reshape(3, 3)
    if abs(h[2, 2]) < 1e-12:
        raise ValueError("calibration is degenerate")
    return (h / h[2, 2]).tolist()


def apply_homography(h: Sequence[Sequence[float]], pt: Point) -> Point:
    m = np.asarray(h, dtype=float)
    v = m @ np.array([pt[0], pt[1], 1.0])
    if abs(v[2]) < 1e-12:
        raise ValueError("point maps to infinity")
    return (float(v[0] / v[2]), float(v[1] / v[2]))


def reprojection_rmse(h: Sequence[Sequence[float]], src: Sequence[Sequence[float]], dst: Sequence[Sequence[float]]) -> float:
    errs = []
    for s, d in zip(src, dst):
        u, v = apply_homography(h, (s[0], s[1]))
        errs.append((u - d[0]) ** 2 + (v - d[1]) ** 2)
    return float(math.sqrt(sum(errs) / len(errs)))
