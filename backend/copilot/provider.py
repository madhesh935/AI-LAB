"""LLM provider adapter. The chat frontend only ever talks to the backend, so providers can change without touching it.

Only OpenRouter and Groq (both OpenAI-compatible hosted APIs) are implemented. The API key is read from the server environment / backend/.env and never
leaves this process. Store data the tools return is sent to OpenRouter as part of the prompt - that is the trade-off of a hosted model.
Every capability reported here (tool support, context length) comes from the model catalogue / a real key check, not from assumptions.
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx

from core.config import Settings

READY, LOADING, DEGRADED, OFFLINE, NOT_CONFIGURED, ERROR = "READY", "LOADING", "DEGRADED", "OFFLINE", "NOT_CONFIGURED", "ERROR"


class ProviderError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


@dataclass
class ProviderStatus:
    state: str
    provider: str
    model: str
    endpoint: str
    detail: str
    models: List[str] = field(default_factory=list)
    model_installed: bool = False
    is_cloud: bool = False
    supports_tools: Optional[bool] = None
    supports_thinking: Optional[bool] = None
    context_length: Optional[int] = None
    loaded: bool = False
    probe_ms: Optional[float] = None

    def as_dict(self) -> Dict[str, Any]:
        return {
            "state": self.state, "provider": self.provider, "model": self.model, "endpoint": self.endpoint, "detail": self.detail,
            "installedModels": self.models, "modelInstalled": self.model_installed, "isCloudModel": self.is_cloud,
            "supportsTools": self.supports_tools, "supportsThinking": self.supports_thinking, "contextLength": self.context_length,
            "modelLoaded": self.loaded, "probeMs": self.probe_ms,
        }


@dataclass
class ChatResult:
    content: str
    tool_calls: List[Dict[str, Any]]
    stopped: bool = False
    model: str = ""
    total_ms: float = 0.0
    prompt_tokens: Optional[int] = None
    output_tokens: Optional[int] = None


class NullProvider:
    """Used when RETAILEDGE_COPILOT_PROVIDER=none: the Copilot answers from the database tools only."""

    def __init__(self, settings: Settings):
        self.settings = settings

    def status(self, force: bool = False) -> ProviderStatus:
        return ProviderStatus(NOT_CONFIGURED, "none", "-", "-", "No language model configured (RETAILEDGE_COPILOT_PROVIDER=none); answers come from deterministic database tools.")

    def chat(self, *_a, **_k) -> ChatResult:  # pragma: no cover - never reached, the engine checks status first
        raise ProviderError("NOT_CONFIGURED", "No language model is configured")


class OpenRouterProvider:
    name, label, key_env = "openrouter", "OpenRouter", "OPENROUTER_API_KEY"

    def __init__(self, settings: Settings, model: Optional[str] = None):
        self.settings = settings
        self.model = model or settings.copilot_model
        self.base = self._base_url().rstrip("/")
        self._cache: Optional[ProviderStatus] = None
        self._cache_at = 0.0
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ health
    def _base_url(self) -> str:
        return self.settings.openrouter_base_url

    def _key(self) -> str:
        return self.settings.openrouter_api_key

    def _extras(self, payload: Dict[str, Any]) -> None:
        """Provider-specific request fields (OpenRouter: reasoning switch and a model fallback chain)."""
        payload["reasoning"] = {"enabled": self.settings.copilot_think}
        if self.settings.copilot_fallback_models:
            payload["models"] = [self.model, *self.settings.copilot_fallback_models][:3]  # OpenRouter routes to the next one when a model is rate-limited or unavailable

    def _headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self._key()}", "HTTP-Referer": "http://localhost:5173", "X-Title": "RetailEdge AI Store Copilot"}

    def _client(self, read: float) -> httpx.Client:
        return httpx.Client(base_url=self.base, headers=self._headers(), timeout=httpx.Timeout(read, connect=self.settings.copilot_connect_timeout_seconds))

    def status(self, force: bool = False) -> ProviderStatus:
        with self._lock:
            ttl = 60 if (self._cache is not None and self._cache.state == READY) else 10
            if not force and self._cache is not None and time.monotonic() - self._cache_at < ttl:
                return self._cache
        st = self._probe()
        with self._lock:
            self._cache, self._cache_at = st, time.monotonic()
        return st

    def _probe(self) -> ProviderStatus:
        s = self.settings
        base = ProviderStatus(OFFLINE, self.name, self.model, self.base, "", is_cloud=True, model_installed=False)
        if not self._key().strip():
            base.state = NOT_CONFIGURED
            base.detail = f"No {self.label} API key. Set {self.key_env} in backend/.env (server-side only) and restart the API; answers come from database tools meanwhile."
            return base
        t0 = time.perf_counter()
        try:
            with self._client(6.0) as c:
                key = c.get("/key")  # authenticated, costs nothing, proves the key works
                base.probe_ms = round((time.perf_counter() - t0) * 1000, 1)
                if key.status_code in (401, 403):
                    base.state, base.detail = NOT_CONFIGURED, f"{self.label} rejected the API key (check {self.key_env})."
                    return base
                if key.status_code != 200:
                    base.detail = f"{self.label} answered {key.status_code} to the key check."
                    return base
                left = (key.json().get("data") or {}).get("limit_remaining")
                cat = c.get("/models", params={"supported_parameters": "tools"})  # public catalogue, filtered to tool-capable models
                ids = {m["id"]: m for m in (cat.json().get("data") or [])} if cat.status_code == 200 else {}
        except Exception as exc:  # noqa: BLE001
            base.detail = f"{self.label} is not reachable ({type(exc).__name__}); check the internet connection."
            return base
        base.models = []
        entry = ids.get(self.model) or next((ids[m] for m in s.copilot_fallback_models if m in ids), None)
        if ids and entry is None:
            base.state = NOT_CONFIGURED
            base.detail = f"Model '{self.model}' is not a tool-capable model on {self.label} (set RETAILEDGE_COPILOT_MODEL)."
            return base
        base.model_installed = True
        base.supports_tools = True if entry else None
        base.context_length = (entry or {}).get("context_length")
        if left is not None and float(left) <= 0:
            base.state, base.detail = DEGRADED, f"The {self.label} key has no credit left; the Copilot falls back to deterministic tools."
            return base
        base.state = READY
        base.detail = f"{self.label} key valid; model reachable."
        return base

    # ------------------------------------------------------------------ chat
    def chat(self, messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]], cancel: threading.Event, max_tokens: Optional[int] = None) -> ChatResult:
        s = self.settings
        st = self.status()
        if st.state in (OFFLINE, NOT_CONFIGURED, DEGRADED):
            raise ProviderError(st.state, st.detail)
        payload: Dict[str, Any] = {
            "model": self.model, "messages": messages, "stream": True, "stream_options": {"include_usage": True},
            "temperature": s.copilot_temperature, "max_tokens": max_tokens or s.copilot_max_output_tokens,
        }
        self._extras(payload)
        if tools and s.copilot_tools_enabled:
            payload["tools"] = tools
        t0 = time.perf_counter()
        used_model = ""
        content: List[str] = []
        partial: Dict[int, Dict[str, Any]] = {}
        usage: Dict[str, Any] = {}
        stopped = False
        try:
            with self._client(s.copilot_timeout_seconds) as c, c.stream("POST", "/chat/completions", json=payload) as resp:
                if resp.status_code != 200:
                    body = resp.read().decode("utf-8", "replace")[:300]
                    with self._lock:
                        self._cache = None
                    code = {401: "NOT_CONFIGURED", 402: "DEGRADED", 429: "RATE_LIMITED"}.get(resp.status_code, "HTTP_%s" % resp.status_code)
                    raise ProviderError(code, f"{self.label} answered {resp.status_code}: {body}")
                for line in resp.iter_lines():
                    if cancel.is_set():
                        stopped = True
                        break
                    if time.perf_counter() - t0 > s.copilot_timeout_seconds:
                        raise ProviderError("TIMEOUT", "The language model did not finish in time")
                    if not line or line.startswith(":") or not line.startswith("data:"):  # blank keep-alives and ': OPENROUTER PROCESSING' comments
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    if chunk.get("error"):
                        raise ProviderError("MODEL_ERROR", f"{self.label} reported: {str(chunk['error'].get('message', chunk['error']))[:300]}")
                    used_model = chunk.get("model") or used_model
                    if chunk.get("usage"):
                        usage = chunk["usage"]
                    for choice in chunk.get("choices") or []:
                        delta = choice.get("delta") or {}
                        if delta.get("content"):
                            content.append(delta["content"])
                        for tc in delta.get("tool_calls") or []:
                            p = partial.setdefault(int(tc.get("index", 0)), {"id": "", "name": "", "args": ""})
                            p["id"] = tc.get("id") or p["id"]
                            fn = tc.get("function") or {}
                            p["name"] = fn.get("name") or p["name"]
                            p["args"] += fn.get("arguments") or ""
        except httpx.TimeoutException as exc:
            raise ProviderError("TIMEOUT", "The language model did not answer in time") from exc
        except httpx.HTTPError as exc:
            with self._lock:
                self._cache = None
            raise ProviderError("OFFLINE", f"The language model could not be reached ({type(exc).__name__})") from exc
        calls: List[Dict[str, Any]] = []
        for _, p in sorted(partial.items()):
            try:
                args = json.loads(p["args"]) if p["args"].strip() else {}
            except ValueError:
                args = {}
            if p["name"]:
                calls.append({"id": p["id"] or f"call_{uuid.uuid4().hex[:12]}", "name": p["name"], "arguments": args if isinstance(args, dict) else {}})
        return ChatResult(
            content="".join(content).strip(), tool_calls=calls, stopped=stopped, model=used_model or self.model, total_ms=round((time.perf_counter() - t0) * 1000, 1),
            prompt_tokens=usage.get("prompt_tokens"), output_tokens=usage.get("completion_tokens"),
        )


class GroqProvider(OpenRouterProvider):
    """Groq's OpenAI-compatible API (fast hosted open models). Same wire protocol; no reasoning switch and no model-fallback chain."""

    name, label, key_env = "groq", "Groq", "GROQ_API_KEY"

    def _base_url(self) -> str:
        return self.settings.groq_base_url

    def _key(self) -> str:
        return self.settings.groq_api_key

    def _extras(self, payload: Dict[str, Any]) -> None:
        if self.model.startswith("openai/gpt-oss"):
            payload["reasoning_effort"] = "high" if self.settings.copilot_think else "low"  # gpt-oss always reasons; keep it short for latency

    def _headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self._key()}"}

    def _probe(self) -> ProviderStatus:
        s = self.settings
        base = ProviderStatus(OFFLINE, self.name, self.model, self.base, "", is_cloud=True)
        if not self._key().strip():
            base.state = NOT_CONFIGURED
            base.detail = f"No {self.label} API key. Set {self.key_env} in backend/.env (server-side only) and restart the API; answers come from database tools meanwhile."
            return base
        t0 = time.perf_counter()
        try:
            with self._client(6.0) as c:
                r = c.get("/models")  # authenticated model list: proves the key works and tells us whether the model exists
                base.probe_ms = round((time.perf_counter() - t0) * 1000, 1)
        except Exception as exc:  # noqa: BLE001
            base.detail = f"{self.label} is not reachable ({type(exc).__name__}); check the internet connection."
            return base
        if r.status_code in (401, 403):
            base.state, base.detail = NOT_CONFIGURED, f"{self.label} rejected the API key (check {self.key_env})."
            return base
        if r.status_code != 200:
            base.detail = f"{self.label} answered {r.status_code} to the key check."
            return base
        ids = {m["id"]: m for m in (r.json().get("data") or []) if m.get("active", True)}
        entry = ids.get(self.model)
        if entry is None:
            base.state, base.detail = NOT_CONFIGURED, f"Model '{self.model}' is not available on {self.label} (set RETAILEDGE_COPILOT_MODEL)."
            return base
        base.model_installed = True
        base.supports_tools = True  # Groq publishes no capability flag; the model is configured as a tool-calling one and a failing call is reported, not hidden
        base.context_length = entry.get("context_window")
        base.state, base.detail = READY, f"{self.label} key valid; model reachable."
        return base


# Errors after which the next provider in the chain is tried (a rate limit or an outage of one model must not take the Copilot down).
RETRYABLE = {"RATE_LIMITED", "OFFLINE", "TIMEOUT", "MODEL_ERROR", "DEGRADED"}


class ChainProvider:
    """Several models/providers in priority order. Groq's free tier allows ~8,000 tokens per minute PER MODEL, so a busy minute exhausts one model;
    the next one has its own budget. `status()` is the first READY link; `chat()` moves on when a link is rate-limited or down."""

    def __init__(self, links: List[Any]):
        self.links = links
        self._cool: Dict[int, float] = {}  # link index -> monotonic time until which it is skipped after a rate limit

    @property
    def last_model(self) -> str:
        return getattr(self, "_last", self.links[0].model)

    def status(self, force: bool = False) -> ProviderStatus:
        sts = [(link, link.status(force)) for link in self.links]
        for link, st in sts:
            if st.state == READY:
                st.detail += f" ({len(self.links)} models in the fallback chain)" if len(self.links) > 1 else ""
                return st
        return sts[0][1]

    def chat(self, messages: List[Dict[str, Any]], tools: Optional[List[Dict[str, Any]]], cancel: threading.Event, max_tokens: Optional[int] = None) -> ChatResult:
        last: Optional[ProviderError] = None
        for i, link in enumerate(self.links):
            if self._cool.get(i, 0.0) > time.monotonic() or link.status().state != READY:
                continue
            try:
                res = link.chat(messages, tools, cancel, max_tokens)
                self._last = link.model
                return res
            except ProviderError as exc:
                last = exc
                if exc.code == "RATE_LIMITED":
                    self._cool[i] = time.monotonic() + 20  # its per-minute token budget is spent; try the others first for a while
                if exc.code not in RETRYABLE and not exc.code.startswith("HTTP_5"):
                    raise
        raise last or ProviderError("NOT_CONFIGURED", self.links[0].status().detail)


def _make_single(kind: str, settings: Settings, model: Optional[str] = None):
    return GroqProvider(settings, model) if kind == "groq" else OpenRouterProvider(settings, model)


def make_provider(settings: Settings):
    kind = settings.copilot_provider
    if kind == "none":
        return NullProvider(settings)
    links = [_make_single(kind, settings)]
    if kind == "groq":
        links += [GroqProvider(settings, m) for m in settings.groq_fallback_models]
        if settings.openrouter_api_key.strip():
            links.append(OpenRouterProvider(settings, settings.openrouter_free_model))  # last resort: a free OpenRouter model (its own fallbacks apply)
    return links[0] if len(links) == 1 else ChainProvider(links)
