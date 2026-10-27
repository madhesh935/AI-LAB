"""Source validation and credential redaction - import-light (no OpenCV) so the API can use it too."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable, Optional, Tuple
from urllib.parse import urlsplit

_CRED = re.compile(r"(?P<scheme>[a-z][a-z0-9+.-]*://)(?P<user>[^/@\s:]*)(?::(?P<pw>[^/@\s]*))?@", re.I)


def redact(text: Optional[str]) -> Optional[str]:
    """Strip user:password@ from any URL inside `text`."""
    if text is None:
        return None
    return _CRED.sub(lambda m: f"{m.group('scheme')}***:***@", text)


class SourceError(Exception):
    """Carries a stable machine-readable code plus a credential-free message."""

    def __init__(self, code: str, message: str, fatal: bool = False):
        super().__init__(message)
        self.code, self.message, self.fatal = code, message, fatal


def _check_url(ref: str, schemes: Tuple[str, ...]) -> None:
    try:
        parts = urlsplit(ref)
    except ValueError as exc:
        raise SourceError("INVALID_SOURCE", f"Malformed URL ({exc})", fatal=True) from None
    if parts.scheme.lower() not in schemes or not parts.hostname:
        raise SourceError("INVALID_SOURCE", f"URL must look like {schemes[0]}://host[:port]/path", fatal=True)


def resolve_file(ref: str, roots: Iterable[Path]) -> Path:
    path = Path(ref)
    if not path.is_absolute():
        for root in roots:
            cand = (root / ref).resolve()
            if cand.exists():
                path = cand
                break
        else:
            path = (list(roots)[0] / ref).resolve()
    path = path.resolve()
    if not any(_is_within(path, root.resolve()) for root in roots):
        raise SourceError("INVALID_SOURCE", "Video file is outside the allowed media folders", fatal=True)
    if not path.is_file():
        raise SourceError("SOURCE_NOT_FOUND", f"Video file not found: {path.name}", fatal=True)
    return path


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def validate_source(source_type: str, ref: Optional[str], media_roots: Iterable[Path]) -> None:
    """Cheap, non-network validation used before any open attempt."""
    if source_type == "unconfigured" or not ref:
        raise SourceError("NOT_CONFIGURED", "No camera source configured", fatal=True)
    if source_type == "usb":
        if not str(ref).strip().isdigit():
            raise SourceError("INVALID_SOURCE", "USB source must be a device index such as 0", fatal=True)
    elif source_type == "rtsp":
        _check_url(ref, ("rtsp", "rtsps"))
    elif source_type == "http":
        _check_url(ref, ("http", "https"))
    elif source_type == "file":
        resolve_file(ref, list(media_roots))
    else:
        raise SourceError("INVALID_SOURCE", f"Unsupported source type '{source_type}'", fatal=True)
