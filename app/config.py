"""Runtime settings, read from environment variables (and a local .env file)."""

import logging
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

log = logging.getLogger(__name__)


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _path(name: str, default: Path) -> Path:
    value = os.getenv(name)
    path = Path(value) if value else default
    return path if path.is_absolute() else (BASE_DIR / path).resolve()


@dataclass(frozen=True)
class Settings:
    env: str = field(default_factory=lambda: os.getenv("APP_ENV", "development"))
    secret_key: str = field(default_factory=lambda: os.getenv("SECRET_KEY", ""))
    audio_dir: Path = field(default_factory=lambda: _path("AUDIO_DIR", BASE_DIR.parent / "audio-library"))
    database_path: Path = field(default_factory=lambda: _path("DATABASE_PATH", BASE_DIR / "data" / "app.db"))
    frontend_dist: Path = field(
        default_factory=lambda: _path("FRONTEND_DIST", BASE_DIR.parent / "lossless-stream-frontend" / "dist")
    )
    cors_origins: list[str] = field(
        default_factory=lambda: [
            o.strip()
            for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
            if o.strip()
        ]
    )
    allow_registration: bool = field(default_factory=lambda: _bool("ALLOW_REGISTRATION", True))
    access_token_ttl: int = field(default_factory=lambda: int(os.getenv("ACCESS_TOKEN_TTL", str(7 * 24 * 3600))))
    stream_token_ttl: int = field(default_factory=lambda: int(os.getenv("STREAM_TOKEN_TTL", str(6 * 3600))))
    max_upload_mb: int = field(default_factory=lambda: int(os.getenv("MAX_UPLOAD_MB", "2048")))
    scan_on_startup: bool = field(default_factory=lambda: _bool("SCAN_ON_STARTUP", True))

    @property
    def is_production(self) -> bool:
        return self.env.lower() == "production"


def load_settings() -> Settings:
    settings = Settings()
    if not settings.secret_key:
        if settings.is_production:
            raise RuntimeError("SECRET_KEY must be set when APP_ENV=production")
        log.warning("SECRET_KEY not set; using a random key (sessions reset on every restart)")
        object.__setattr__(settings, "secret_key", secrets.token_urlsafe(48))
    return settings
