"""
Centralised environment configuration.

All settings can be overridden with RETAILEDGE_* environment variables or a
backend/.env file (see .env.example).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="RETAILEDGE_",
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "RetailEdge AI Backend"
    app_version: str = "1.0.0"
    environment: str = "development"

    # ---- Storage -------------------------------------------------------
    # The database path is always absolute and derived from the data
    # directory, never from the process working directory.
    data_dir: Path = BACKEND_DIR / "data"
    db_filename: str = "retailedge.db"
    sqlite_busy_timeout_ms: int = 5000
    backup_retention: int = 10
    # Apply pending Alembic migrations on startup (a backup is taken first when the DB already exists).
    auto_migrate: bool = True

    # ---- Network -------------------------------------------------------
    # There is NO authentication. Bind to loopback unless a controlled LAN is
    # explicitly enabled with RETAILEDGE_ALLOW_LAN=true.
    host: str = "127.0.0.1"
    port: int = 8000
    allow_lan: bool = False
    cors_origins: List[str] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    # LAN demo only (allow_lan=true): remote clients must come from one of these networks AND call only the Staff/Customer PWA allowlist (core/network.py).
    lan_allowed_cidrs: List[str] = Field(default_factory=lambda: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "fe80::/10", "fd00::/8"])

    # ---- Safety limits for mutating requests (no auth, so keep them bounded)
    mutation_rate_limit_per_minute: int = 240
    max_request_body_bytes: int = 256 * 1024

    # ---- Vision worker (Phase 2) --------------------------------------
    # The worker is a SEPARATE process (python -m vision). It serves MJPEG video and posts
    # detection metadata to this API over loopback. source refs / RTSP credentials never leave it.
    vision_worker_host: str = "127.0.0.1"
    vision_worker_port: int = 8100
    vision_public_url: str = "http://127.0.0.1:8100"  # what browsers use to reach the video gateway
    api_internal_url: str = "http://127.0.0.1:8000"  # what the worker uses to reach this API
    vision_inference_fps: float = 30.0  # per-camera inference sampling cap
    vision_stream_fps: float = 15.0  # 4 live canvases decode every frame in the browser; 30 fps saturated the CPU and made the page stall
    vision_stream_width: int = 960
    vision_jpeg_quality: int = 70
    vision_torch_threads: int = 0  # CPU inference threads; 0 = number of physical cores
    vision_max_viewers_per_camera: int = 12
    vision_event_hz: float = 10.0  # camera.frame metadata events per camera per second (max)
    vision_stats_persist_seconds: float = 10.0  # DB write cadence for live camera stats
    # ---- Analytics / event engine (Phase 3) ----------------------------
    analytics_queue_persist_seconds: float = 15.0  # queue_observations write cadence per counter (also on congestion change)
    analytics_forecast_persist_seconds: float = 60.0
    analytics_shelf_persist_seconds: float = 60.0  # shelf_observations cadence (also on every confirmed status change)
    alert_hold_seconds: float = 20.0  # a queue condition must persist this long before an alert is raised
    alert_clear_seconds: float = 60.0  # ...and be gone this long before it auto-resolves
    alert_reopen_cooldown_seconds: float = 300.0
    occupancy_stale_minutes: float = 15.0
    media_dir: Path = BACKEND_DIR / "data" / "media"  # extra allowed root for local video files

    # ---- Store Copilot (Phase 5) ---------------------------------------
    # The LLM is hosted by OpenRouter. The API key stays server-side (backend/.env or the environment); the browser never sees it.
    # NOTE: the prompt carries the store data the tools return, so it is sent to OpenRouter and the model provider behind it.
    openrouter_api_key: str = Field(default="", validation_alias=AliasChoices("RETAILEDGE_OPENROUTER_API_KEY", "OPENROUTER_API_KEY"))
    openrouter_base_url: str = Field(default="https://openrouter.ai/api/v1", validation_alias=AliasChoices("RETAILEDGE_OPENROUTER_BASE_URL", "OPENROUTER_BASE_URL"))
    groq_api_key: str = Field(default="", validation_alias=AliasChoices("RETAILEDGE_GROQ_API_KEY", "GROQ_API_KEY"))
    groq_base_url: str = Field(default="https://api.groq.com/openai/v1", validation_alias=AliasChoices("RETAILEDGE_GROQ_BASE_URL", "GROQ_BASE_URL"))
    openrouter_free_model: str = "nvidia/nemotron-3.5-lightning:free"  # last link of the Groq chain
    groq_fallback_models: List[str] = Field(default_factory=lambda: ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"])  # each Groq model has its own ~8k tokens/min free budget
    copilot_model: str = Field(default="nvidia/nemotron-3.5-lightning:free", validation_alias=AliasChoices("RETAILEDGE_COPILOT_MODEL", "COPILOT_MODEL"))
    # Free models are shared and get rate-limited (429) or withdrawn; OpenRouter tries these in order when the primary fails. Free = no cost, but the daily request cap is small.
    copilot_fallback_models: List[str] = Field(default_factory=lambda: ["nvidia/nemotron-3-ultra-550b-a55b:free", "poolside/laguna-s-2.1:free"])  # OpenRouter allows at most 3 models per request
    copilot_provider: str = "openrouter"  # openrouter | groq | none (none = deterministic tools only)
    copilot_timeout_seconds: float = 120.0  # whole-request budget per model call
    copilot_connect_timeout_seconds: float = 5.0
    copilot_max_output_tokens: int = 700
    copilot_temperature: float = 0.1
    copilot_think: bool = False  # reasoning off for models that support it: much lower latency, tool calls unaffected
    copilot_tools_enabled: bool = True
    copilot_max_tool_iterations: int = 4
    copilot_max_tool_calls_per_turn: int = 4
    copilot_tool_timeout_seconds: float = 8.0
    copilot_history_messages: int = 8  # prior turns sent to the model (content only, never CCTV or raw rows)
    copilot_rate_limit_per_minute: int = 20  # costly AI requests per minute (whole API, no auth => global)

    # ---- Logging -------------------------------------------------------
    log_level: str = "INFO"
    log_json: bool = True

    @field_validator("data_dir", mode="before")
    @classmethod
    def _absolute_data_dir(cls, value) -> Path:
        path = Path(value)
        if not path.is_absolute():
            path = (BACKEND_DIR / path)
        return path.resolve()

    @property
    def db_path(self) -> Path:
        return self.data_dir / self.db_filename

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.db_path.as_posix()}"

    @property
    def backup_dir(self) -> Path:
        return self.data_dir / "backups"

    def assert_safe_bind(self) -> None:
        if self.host not in LOOPBACK_HOSTS and not self.allow_lan:
            raise RuntimeError(
                f"Refusing to bind to non-loopback host '{self.host}'. The API has no "
                "authentication; set RETAILEDGE_ALLOW_LAN=true to expose it on a "
                "controlled LAN."
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()
