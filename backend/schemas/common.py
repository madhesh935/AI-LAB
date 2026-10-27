"""Shared Pydantic base: camelCase JSON on the wire (matches the TypeScript contracts)."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Generic, List, Literal, Optional, TypeVar

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

DataState = Literal["available", "empty", "unavailable"]


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
        str_strip_whitespace=True,
    )


class Meta(ApiModel):
    """Tells the client whether numbers are real observations or simply absent.

    'unavailable' = no inference pipeline has reported data for this module yet.
    'empty'       = the module is connected but there is nothing in the range.
    """

    data_state: DataState = "unavailable"
    last_observation_at: Optional[datetime] = None
    sources: List[str] = []
    note: Optional[str] = None


class Ok(ApiModel):
    success: bool = True
    message: Optional[str] = None


T = TypeVar("T")


class ListResponse(ApiModel, Generic[T]):
    items: List[T]
    total: int
    meta: Optional[Meta] = None
