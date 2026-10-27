"""Shelf-product dataset utilities: audit, validation, near-duplicate grouping, leakage-safe splitting.

Supported inputs: YOLO detection layout (images/ + labels/*.txt) - the training format - and COCO JSON / Pascal VOC XML
(converted). Nothing here guesses labels: images without a label file are reported as UNLABELED, never as empty shelves.
"""

from __future__ import annotations

import hashlib
import json
import random
import re
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import cv2
import numpy as np

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


@dataclass
class Box:
    cls: int
    cx: float
    cy: float
    w: float
    h: float


@dataclass
class Sample:
    image: Path
    label: Optional[Path]
    boxes: List[Box] = field(default_factory=list)
    problems: List[str] = field(default_factory=list)
    width: int = 0
    height: int = 0
    group: str = ""  # recording session / shelf configuration (split unit)
    phash: Optional[int] = None
    sharpness: Optional[float] = None
    brightness: Optional[float] = None


# ----------------------------------------------------------------------------- reading
def read_yolo_label(path: Path, n_classes: Optional[int]) -> Tuple[List[Box], List[str]]:
    boxes, problems = [], []
    for n, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip():
            continue
        parts = line.split()
        if len(parts) != 5:
            problems.append(f"line {n}: expected 5 values, got {len(parts)} (segmentation/pose labels are not supported)")
            continue
        try:
            c = int(parts[0])
            cx, cy, w, h = (float(x) for x in parts[1:])
        except ValueError:
            problems.append(f"line {n}: non-numeric value")
            continue
        if n_classes is not None and not 0 <= c < n_classes:
            problems.append(f"line {n}: class id {c} outside 0..{n_classes - 1}")
            continue
        if not (0 <= cx <= 1 and 0 <= cy <= 1 and 0 < w <= 1 and 0 < h <= 1):
            problems.append(f"line {n}: box outside the image or zero-sized ({cx:.3f},{cy:.3f},{w:.3f},{h:.3f})")
            continue
        if cx - w / 2 < -1e-6 or cx + w / 2 > 1 + 1e-6 or cy - h / 2 < -1e-6 or cy + h / 2 > 1 + 1e-6:
            problems.append(f"line {n}: box extends beyond the image")
            continue
        boxes.append(Box(c, cx, cy, w, h))
    return boxes, problems


def dhash(img_gray: np.ndarray, size: int = 8) -> int:
    small = cv2.resize(img_gray, (size + 1, size), interpolation=cv2.INTER_AREA)
    bits = (small[:, 1:] > small[:, :-1]).flatten()
    return int("".join("1" if b else "0" for b in bits), 2)


def hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def default_group(image: Path, root: Path, regex: Optional[str] = None) -> str:
    """Split unit: regex group 1 if given, else the first sub-directory under the dataset root, else the filename stem prefix
    before the last '_<number>' (frame counters), so frames of one recording stay together."""
    rel = image.relative_to(root)
    if regex:
        m = re.search(regex, str(rel).replace("\\", "/"))
        if m:
            return m.group(1)
    parts = rel.parts
    if len(parts) > 3:  # images/<session>/file.jpg style
        return parts[1]
    stem = re.sub(r"[_-]?\d+$", "", image.stem)
    return stem or image.stem


def load_yolo_dataset(root: Path, class_names: Optional[Sequence[str]] = None, group_regex: Optional[str] = None,
                      images_dir: str = "images", labels_dir: str = "labels") -> List[Sample]:
    img_root = root / images_dir
    if not img_root.exists():
        raise FileNotFoundError(f"{img_root} not found (expected a YOLO layout: {images_dir}/ and {labels_dir}/)")
    samples: List[Sample] = []
    for p in sorted(img_root.rglob("*")):
        if p.suffix.lower() not in IMAGE_EXT:
            continue
        rel = p.relative_to(img_root).with_suffix(".txt")
        lab = root / labels_dir / rel
        s = Sample(image=p, label=lab if lab.exists() else None, group=default_group(p, root, group_regex))
        img = cv2.imread(str(p))
        if img is None:
            s.problems.append("image cannot be decoded")
            samples.append(s)
            continue
        s.height, s.width = img.shape[:2]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        s.phash = dhash(gray)
        s.sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        s.brightness = float(gray.mean())
        if s.label is not None:
            s.boxes, probs = read_yolo_label(s.label, len(class_names) if class_names else None)
            s.problems += probs
        samples.append(s)
    return samples


# ----------------------------------------------------------------------------- audit
def near_duplicate_clusters(samples: Sequence[Sample], max_distance: int = 4) -> List[List[int]]:
    """Union-find over perceptual hashes: images within `max_distance` bits belong to one cluster."""
    idx = [i for i, s in enumerate(samples) if s.phash is not None]
    parent = {i: i for i in idx}

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a_pos, a in enumerate(idx):
        for b in idx[a_pos + 1:]:
            if hamming(samples[a].phash, samples[b].phash) <= max_distance:  # type: ignore[arg-type]
                parent[find(a)] = find(b)
    clusters: Dict[int, List[int]] = defaultdict(list)
    for i in idx:
        clusters[find(i)].append(i)
    return [c for c in clusters.values() if len(c) > 1]


def audit(samples: Sequence[Sample], class_names: Optional[Sequence[str]] = None) -> Dict:
    labeled = [s for s in samples if s.label is not None and not any("cannot be decoded" in p for p in s.problems)]
    with_boxes = [s for s in labeled if s.boxes]
    counts: Counter = Counter(b.cls for s in samples for b in s.boxes)
    n_boxes = sum(counts.values())
    names = list(class_names or [])
    per_class = {(names[c] if c < len(names) else str(c)): n for c, n in sorted(counts.items())}
    areas = [b.w * b.h for s in samples for b in s.boxes]
    sizes = Counter((s.width, s.height) for s in samples if s.width)
    groups = Counter(s.group for s in samples)
    dupes = near_duplicate_clusters(samples)
    imbalance = (max(counts.values()) / max(min(counts.values()), 1)) if counts else None
    out = {
        "images": len(samples), "labeled_images": len(labeled), "unlabeled_images": len(samples) - len(labeled),
        "images_with_boxes": len(with_boxes), "empty_label_files": len(labeled) - len(with_boxes), "boxes": n_boxes,
        "annotation_coverage": round(len(labeled) / len(samples), 3) if samples else 0.0,
        "classes": per_class, "class_imbalance_ratio": round(imbalance, 1) if imbalance else None,
        "boxes_per_image": {"mean": round(n_boxes / max(len(with_boxes), 1), 1), "max": max((len(s.boxes) for s in samples), default=0)},
        "box_area_fraction": {"median": round(statistics.median(areas), 4) if areas else None, "p5": round(float(np.percentile(areas, 5)), 5) if areas else None},
        "image_sizes": {f"{w}x{h}": n for (w, h), n in sizes.most_common(8)},
        "recording_sessions": {"count": len(groups), "images_per_session": dict(groups.most_common(12))},
        "near_duplicate_clusters": len(dupes), "images_in_duplicate_clusters": sum(len(c) for c in dupes),
        "blurry_images(laplacian_var<30)": sum(1 for s in samples if s.sharpness is not None and s.sharpness < 30),
        "dark_images(mean<40)": sum(1 for s in samples if s.brightness is not None and s.brightness < 40),
        "label_problems": sum(len(s.problems) for s in samples),
        "files_with_problems": [str(s.image.name) for s in samples if s.problems][:20],
    }
    out["verdict"] = verdict(out)
    return out


MIN_IMAGES_TOTAL = 300
MIN_INSTANCES_PER_CLASS = 100
MIN_SESSIONS = 5


def verdict(a: Dict) -> Dict:
    """Is this enough to train and TRUST a model? Conservative, and explicit about what is missing."""
    missing = []
    if a["images_with_boxes"] < MIN_IMAGES_TOTAL:
        missing.append(f"only {a['images_with_boxes']} labeled images with boxes (need >= {MIN_IMAGES_TOTAL} for a first-stage product model)")
    low = {c: n for c, n in a["classes"].items() if n < MIN_INSTANCES_PER_CLASS}
    if not a["classes"]:
        missing.append("no annotated boxes at all")
    elif low:
        missing.append(f"classes with < {MIN_INSTANCES_PER_CLASS} instances: {low}")
    if a["recording_sessions"]["count"] < MIN_SESSIONS:
        missing.append(f"only {a['recording_sessions']['count']} recording sessions (need >= {MIN_SESSIONS} so train/val/test can be split without leakage)")
    if a["label_problems"]:
        missing.append(f"{a['label_problems']} label problems to fix first")
    return {"trainable": not missing, "missing": missing}


# ----------------------------------------------------------------------------- split
def split_by_group(samples: Sequence[Sample], ratios: Tuple[float, float, float] = (0.7, 0.15, 0.15), seed: int = 0) -> Dict[str, List[Sample]]:
    """Whole recording sessions go to ONE split (near-identical frames of a session never straddle train and test).
    Near-duplicate clusters that span groups are merged into one unit as well."""
    unit_of: Dict[int, int] = {}
    groups: Dict[str, List[int]] = defaultdict(list)
    for i, s in enumerate(samples):
        groups[s.group].append(i)
    parent = {g: g for g in groups}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for cl in near_duplicate_clusters(samples):
        gs = {samples[i].group for i in cl}
        first = next(iter(gs))
        for g in gs:
            parent[find(g)] = find(first)
    units: Dict[str, List[int]] = defaultdict(list)
    for g, idxs in groups.items():
        units[find(g)].extend(idxs)
    order = sorted(units, key=lambda u: -len(units[u]))
    rnd = random.Random(seed)
    rnd.shuffle(order)
    order.sort(key=lambda u: -len(units[u]))  # largest first, ties keep the shuffled order
    total = len(samples)
    target = {"train": ratios[0] * total, "val": ratios[1] * total, "test": ratios[2] * total}
    out: Dict[str, List[Sample]] = {"train": [], "val": [], "test": []}
    for u in order:
        # assign each unit to the split furthest below its target (greedy bin filling)
        name = max(out, key=lambda k: target[k] - len(out[k]))
        out[name].extend(samples[i] for i in units[u])
    return out


def check_leakage(splits: Dict[str, List[Sample]], max_distance: int = 4) -> Dict:
    """Independent verification: no group and no near-duplicate image pair across splits."""
    group_leaks = []
    names = list(splits)
    for a_i, a in enumerate(names):
        for b in names[a_i + 1:]:
            shared = {s.group for s in splits[a]} & {s.group for s in splits[b]}
            if shared:
                group_leaks.append({"splits": [a, b], "groups": sorted(shared)})
    dup_pairs = 0
    for a_i, a in enumerate(names):
        for b in names[a_i + 1:]:
            for x in splits[a]:
                for y in splits[b]:
                    if x.phash is not None and y.phash is not None and hamming(x.phash, y.phash) <= max_distance:
                        dup_pairs += 1
    return {"group_leaks": group_leaks, "near_duplicate_pairs_across_splits": dup_pairs, "clean": not group_leaks and dup_pairs == 0}


def write_yolo_split(splits: Dict[str, List[Sample]], out: Path, class_names: Sequence[str]) -> Dict:
    import shutil

    manifest: Dict = {"classes": list(class_names), "splits": {}}
    for name, items in splits.items():
        (out / "images" / name).mkdir(parents=True, exist_ok=True)
        (out / "labels" / name).mkdir(parents=True, exist_ok=True)
        rows = []
        for s in items:
            dst_img = out / "images" / name / s.image.name
            shutil.copy2(s.image, dst_img)
            lab = out / "labels" / name / (s.image.stem + ".txt")
            lab.write_text("".join(f"{b.cls} {b.cx:.6f} {b.cy:.6f} {b.w:.6f} {b.h:.6f}\n" for b in s.boxes))
            rows.append({"image": s.image.name, "group": s.group, "boxes": len(s.boxes), "sha256": hashlib.sha256(dst_img.read_bytes()).hexdigest()})
        manifest["splits"][name] = rows
    yaml = f"path: {out.resolve().as_posix()}\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n" + "".join(f"  {i}: {n}\n" for i, n in enumerate(class_names))
    (out / "data.yaml").write_text(yaml)
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    return manifest


# ----------------------------------------------------------------------------- synthetic fixture (TOOLING TESTS ONLY)
def make_synthetic_fixture(root: Path, sessions: int = 6, per_session: int = 12, classes: Sequence[str] = ("bottle", "box"), size: int = 320,
                           seed: int = 0) -> Path:
    """Colored rectangles on a grey 'shelf'. Exists ONLY to exercise the data/training tooling end to end - a model trained on it
    is meaningless for products and must never be registered."""
    rnd = random.Random(seed)
    colors = [(40, 40, 200), (200, 120, 30), (30, 160, 60), (160, 30, 160)]
    (root / "images").mkdir(parents=True, exist_ok=True)
    (root / "labels").mkdir(parents=True, exist_ok=True)
    for s in range(sessions):
        base = np.full((size, size, 3), 110 + 8 * s, np.uint8)
        layout = [(rnd.randrange(len(classes)), rnd.randint(10, size - 60), rnd.randint(10, size - 90), rnd.randint(25, 45), rnd.randint(50, 80)) for _ in range(rnd.randint(3, 6))]
        for f in range(per_session):
            img = base.copy()
            lines = []
            for c, x, y, w, h in layout:
                jx, jy = rnd.randint(-3, 3), rnd.randint(-3, 3)
                x0, y0 = max(0, min(size - w, x + jx)), max(0, min(size - h, y + jy))
                cv2.rectangle(img, (x0, y0), (x0 + w, y0 + h), colors[c % len(colors)], -1)
                lines.append(f"{c} {(x0 + w / 2) / size:.6f} {(y0 + h / 2) / size:.6f} {w / size:.6f} {h / size:.6f}")
            img = cv2.add(img, rnd.randint(0, 8) * np.ones_like(img))
            name = f"sess{s:02d}_{f:03d}"
            cv2.imwrite(str(root / "images" / f"{name}.jpg"), img)
            (root / "labels" / f"{name}.txt").write_text("\n".join(lines) + "\n")
    return root
