"""Customer PWA API inputs. Read-only queries are GETs (cacheable offline, not counted as writes); ids arrive as comma lists."""

from __future__ import annotations

import re
from typing import List, Literal, Optional, Tuple

from pydantic import Field

from core.errors import AppError
from schemas.common import ApiModel

_ID = re.compile(r"^[A-Za-z0-9._:\-]{1,120}$")


def parse_ids(raw: Optional[str], limit: int = 60, what: str = "productIds") -> List[str]:
    """'a,b,c' -> ['a', 'b', 'c'] (deduplicated, order kept). Anything that is not a plain id is rejected, never interpolated."""
    ids = [s.strip() for s in (raw or "").split(",") if s.strip()]
    if len(ids) > limit:
        raise AppError(f"At most {limit} {what} are allowed")
    bad = [s for s in ids if not _ID.match(s)]
    if bad:
        raise AppError(f"Invalid {what}: {bad[0][:40]}")
    return list(dict.fromkeys(ids))


def parse_lines(raw: Optional[str], limit: int = 100) -> List[Tuple[str, int]]:
    """'p1:2,p2:1' -> [('p1', 2), ('p2', 1)] with quantity 1..99 (a missing quantity means 1)."""
    out: List[Tuple[str, int]] = []
    seen = set()
    for part in [s.strip() for s in (raw or "").split(",") if s.strip()][:limit + 1]:
        pid, _, qty = part.partition(":")
        if not _ID.match(pid):
            raise AppError(f"Invalid product id: {pid[:40]}")
        try:
            q = int(qty) if qty else 1
        except ValueError:
            raise AppError(f"Invalid quantity for {pid}") from None
        if not 1 <= q <= 99:
            raise AppError("Quantity must be between 1 and 99")
        if pid not in seen:
            seen.add(pid)
            out.append((pid, q))
    if len(out) > limit:
        raise AppError(f"At most {limit} cart lines are allowed")
    return out


class CustomerChatTurn(ApiModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=2000)


class CustomerChatRequest(ApiModel):
    store_id: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=500)
    history: List[CustomerChatTurn] = Field(default_factory=list, max_length=12)
    cart_product_ids: List[str] = Field(default_factory=list, max_length=60)
    start_node_id: Optional[str] = Field(default=None, max_length=120)
