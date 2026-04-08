from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent

load_dotenv(PROJECT_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env", override=False)


def _resolve_path(raw_value: str, base_dir: Path) -> Path:
    candidate = Path(raw_value)
    if candidate.is_absolute():
        return candidate
    return (base_dir / candidate).resolve()


def _split_csv(raw_value: str | None, default: list[str]) -> list[str]:
    if not raw_value:
        return default
    values = [item.strip() for item in raw_value.split(",")]
    return [item for item in values if item]


class Settings:
    def __init__(self) -> None:
        self.app_name = os.getenv("APP_NAME", "Smart SVG Tool")
        self.environment = os.getenv("ENVIRONMENT", "development")
        self.database_url = os.getenv(
            "DATABASE_URL",
            f"sqlite:///{(BACKEND_DIR / 'smart_svg.db').as_posix()}",
        )

        self.secret_key = os.getenv("JWT_SECRET_KEY", "change-this-secret")
        self.jwt_algorithm = os.getenv("JWT_ALGORITHM", "HS256")
        self.access_token_expire_minutes = int(
            os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "120")
        )

        self.sam_model_type = os.getenv("SAM_MODEL_TYPE", "vit_b")
        self.sam_device = os.getenv("SAM_DEVICE", "auto")
        self.sam_checkpoint_path = _resolve_path(
            os.getenv("SAM_CHECKPOINT_PATH", "./weights/sam_vit_b_01ec64.pth"),
            BACKEND_DIR,
        )

        self.runtime_dir = _resolve_path(
            os.getenv("RUNTIME_DIR", "./runtime"),
            BACKEND_DIR,
        )
        self.frontend_dist_dir = _resolve_path(
            os.getenv("FRONTEND_DIST_DIR", "../frontend/out"),
            BACKEND_DIR,
        )
        self.serve_frontend = (
            os.getenv("SERVE_FRONTEND", "true").strip().lower() == "true"
        )

        self.task_ttl_hours = int(os.getenv("TASK_TTL_HOURS", "6"))
        self.max_upload_mb = int(os.getenv("MAX_UPLOAD_MB", "20"))
        self.max_image_side = int(os.getenv("MAX_IMAGE_SIDE", "4096"))

        self.cors_origins = _split_csv(os.getenv("CORS_ORIGINS"), ["*"])
        self.log_level = os.getenv("LOG_LEVEL", "INFO").upper()


settings = Settings()
