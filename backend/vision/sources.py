"""Opening camera sources (USB, RTSP, HTTP/MJPEG, local video file) with explicit error codes.

source_ref (device index / URL with credentials / file path) is server-side only. Anything that
is logged or reported goes through redact() first.
"""

from __future__ import annotations

import os
import sys
import threading
from typing import Dict, Iterable, Optional, Tuple

import cv2
import numpy as np

from vision.source_validation import SourceError, redact, resolve_file, validate_source  # noqa: F401  (re-exported)

OPEN_TIMEOUT_MS = 6000
READ_TIMEOUT_MS = 6000


class _UsbDevice:
    """One physical webcam, read by ONE thread. A webcam can only be opened once, so every camera entry that points at the same device
    index shares this reader (each gets the same frames; their analytics differ by the zones/lines configured per camera)."""

    def __init__(self, index: int):
        backend = cv2.CAP_DSHOW if sys.platform == "win32" else cv2.CAP_ANY
        self.index = index
        self.cap = cv2.VideoCapture(index, backend)
        if not self.cap.isOpened():
            self.cap.release()
            raise SourceError("DEVICE_NOT_FOUND", f"No camera device at index {index} (missing, busy or no permission)")
        exposure = os.environ.get("RETAILEDGE_USB_EXPOSURE", "auto").strip().lower()
        if exposure not in ("", "auto"):  # opt-in: a fixed short exposure (e.g. -5 = 1/32 s) gives 30 fps and far less motion blur, but needs a bright room
            try:
                self.cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.25)
                self.cap.set(cv2.CAP_PROP_EXPOSURE, float(exposure))
            except ValueError:
                pass
        self.refs = 0
        self.cond = threading.Condition()
        self.seq = 0
        self.frame: Optional[np.ndarray] = None
        self.failed = False
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._run, name=f"usb-{index}", daemon=True)
        self.thread.start()

    def _run(self) -> None:
        bad = 0
        while not self.stop.is_set():
            ok, img = self.cap.read()
            if not ok or img is None:
                bad += 1
                if bad >= 50:
                    with self.cond:
                        self.failed = True
                        self.cond.notify_all()
                    return
                self.stop.wait(0.04)
                continue
            bad = 0
            with self.cond:
                self.frame, self.seq = img, self.seq + 1
                self.cond.notify_all()

    def close(self) -> None:
        self.stop.set()
        if self.thread.is_alive() and self.thread is not threading.current_thread():
            self.thread.join(3.0)
        self.cap.release()


_USB: Dict[int, _UsbDevice] = {}
_USB_LOCK = threading.Lock()


class SharedUsbCapture:
    """cv2.VideoCapture look-alike handed to each CameraWorker that uses a shared webcam."""

    def __init__(self, index: int):
        self.index = index
        self._last = 0
        self._open = True
        with _USB_LOCK:
            dev = _USB.get(index)
            if dev is None or dev.failed:
                if dev is not None:
                    dev.close()
                dev = _USB[index] = _UsbDevice(index)
            dev.refs += 1
            self._dev = dev

    def isOpened(self) -> bool:
        return self._open and not self._dev.failed

    def read(self) -> Tuple[bool, Optional[np.ndarray]]:
        dev = self._dev
        with dev.cond:
            if dev.seq == self._last and not dev.failed:
                dev.cond.wait(1.0)
            if dev.failed or dev.frame is None or dev.seq == self._last:
                return False, None
            self._last = dev.seq
            return True, dev.frame

    def get(self, _prop: int) -> float:
        return 0.0

    def set(self, _prop: int, _value: float) -> bool:
        return False

    def release(self) -> None:
        if not self._open:
            return
        self._open = False
        with _USB_LOCK:
            self._dev.refs -= 1
            if self._dev.refs <= 0:
                self._dev.close()  # last user: free the webcam for other programs
                if _USB.get(self.index) is self._dev:
                    _USB.pop(self.index, None)


def open_capture(source_type: str, ref: str, media_roots: Iterable[Path]) -> cv2.VideoCapture:
    """Open and verify a source. Raises SourceError; never returns an unopened capture."""
    roots = list(media_roots)
    validate_source(source_type, ref, roots)
    params = [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, OPEN_TIMEOUT_MS, cv2.CAP_PROP_READ_TIMEOUT_MSEC, READ_TIMEOUT_MS]
    if source_type == "usb":
        return SharedUsbCapture(int(str(ref).strip()))
    elif source_type == "file":
        cap = cv2.VideoCapture(str(resolve_file(ref, roots)))
        if not cap.isOpened():
            cap.release()
            raise SourceError("SOURCE_UNREADABLE", "Video file could not be decoded", fatal=True)
    else:  # rtsp / http
        if source_type == "rtsp":
            os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
        cap = cv2.VideoCapture(ref, cv2.CAP_FFMPEG, params)
        if not cap.isOpened():
            cap.release()
            raise SourceError("CONNECT_FAILED", "Could not connect to the camera stream")
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:  # noqa: BLE001
        pass
    return cap
