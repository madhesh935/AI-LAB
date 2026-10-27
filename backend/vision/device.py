"""Hardware detection, device selection and live resource sampling (all values measured)."""

from __future__ import annotations

import logging
import os
import platform
import shutil
import subprocess
import threading
from typing import Any, Dict, Optional

import psutil

from vision.schemas import ResourceSample

log = logging.getLogger("retailedge.vision.device")


def _nvidia_smi(query: str) -> Optional[list[str]]:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    try:
        out = subprocess.run(
            [exe, f"--query-gpu={query}", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5, check=True,
        ).stdout.strip().splitlines()
        return [line.strip() for line in out[0].split(",")] if out else None
    except Exception:  # noqa: BLE001
        return None


def detect_hardware() -> Dict[str, Any]:
    """Facts about this machine; never installs or changes anything."""
    info: Dict[str, Any] = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "cpu": platform.processor() or None,
        "cpu_cores_physical": psutil.cpu_count(logical=False),
        "cpu_cores_logical": psutil.cpu_count(logical=True),
        "ram_total_gb": round(psutil.virtual_memory().total / 2**30, 1),
        "ffmpeg_binary": shutil.which("ffmpeg"),
        "mediamtx_binary": shutil.which("mediamtx"),
    }
    gpu = _nvidia_smi("name,memory.total,driver_version")
    info["nvidia_gpu"] = {"name": gpu[0], "memory_mb": float(gpu[1]), "driver": gpu[2]} if gpu else None

    try:
        import cv2

        build = cv2.getBuildInformation()
        info["opencv"] = {"version": cv2.__version__, "ffmpeg": "FFMPEG:                      YES" in build}
    except Exception as exc:  # noqa: BLE001
        info["opencv"] = {"error": str(exc)}

    try:
        import torch

        info["torch"] = {
            "version": torch.__version__,
            "cuda_build": torch.version.cuda,
            "cuda_available": torch.cuda.is_available(),
            "device_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        }
    except Exception as exc:  # noqa: BLE001
        info["torch"] = {"error": str(exc)}
    return info


def select_device(preference: str = "auto") -> str:
    """'auto' -> first CUDA GPU when PyTorch can actually use it, else CPU.

    A GPU that exists but whose PyTorch build has no CUDA is NOT usable, so we fall back
    to CPU and say why in the log instead of pretending."""
    pref = (preference or "auto").lower()
    try:
        import torch

        cuda_ok = torch.cuda.is_available()
    except Exception:  # noqa: BLE001
        cuda_ok = False
    if pref == "cpu":
        return "cpu"
    if pref.startswith("cuda") or pref == "auto":
        if cuda_ok:
            return "cuda:0" if pref in ("auto", "cuda") else pref
        if pref != "auto":
            log.warning("CUDA requested but unavailable; falling back to CPU")
        elif _nvidia_smi("name"):
            log.warning("NVIDIA GPU present but this PyTorch build has no CUDA; using CPU")
    return "cpu"


class ResourceSampler(threading.Thread):
    """Samples this process' CPU/RSS and (when present) GPU utilisation every few seconds."""

    def __init__(self, interval: float = 2.0):
        super().__init__(daemon=True, name="resource-sampler")
        self.interval = interval
        self._proc = psutil.Process(os.getpid())
        self._halt = threading.Event()
        self._latest = ResourceSample()
        self._lock = threading.Lock()

    def run(self) -> None:
        self._proc.cpu_percent(None)
        psutil.cpu_percent(None)
        while not self._halt.wait(self.interval):
            gpu = _nvidia_smi("name,utilization.gpu,memory.used,memory.total")
            sample = ResourceSample(
                process_cpu_percent=round(self._proc.cpu_percent(None) / (psutil.cpu_count() or 1), 1),
                process_rss_mb=round(self._proc.memory_info().rss / 2**20, 1),
                system_cpu_percent=psutil.cpu_percent(None),
            )
            if gpu:
                sample.gpu_name = gpu[0]
                sample.gpu_util_percent = float(gpu[1])
                sample.gpu_mem_used_mb = float(gpu[2])
                sample.gpu_mem_total_mb = float(gpu[3])
            with self._lock:
                self._latest = sample

    def latest(self) -> ResourceSample:
        with self._lock:
            return self._latest.model_copy()

    def stop(self) -> None:
        self._halt.set()
