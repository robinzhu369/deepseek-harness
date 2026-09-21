"""Environment-configured ASGI entry point for the modeling Demo service."""

from __future__ import annotations

import os
from pathlib import Path

from .api import create_app
from .config import ServiceConfig


def _integer(name: str, default: int) -> int:
    """Read one positive integer environment variable."""
    value = int(os.environ.get(name, str(default)))
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def _float(name: str, default: float) -> float:
    """Read one positive floating-point environment variable."""
    value = float(os.environ.get(name, str(default)))
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


root = Path(os.environ.get("MODELING_API_ROOT", ".artifacts/modeling-demo/runtime/service"))
skill_root_value = os.environ.get("MODELING_RUNTIME_SKILL_DIR")
config = ServiceConfig(
    root=root,
    max_upload_bytes=_integer("MODELING_API_MAX_UPLOAD_BYTES", 100 * 1024 * 1024),
    upload_chunk_bytes=_integer("MODELING_API_UPLOAD_CHUNK_BYTES", 1024 * 1024),
    preview_limit=_integer("MODELING_API_PREVIEW_LIMIT", 20),
    worker_timeout_seconds=_float("MODELING_API_WORKER_TIMEOUT_SECONDS", 1800),
    cancel_grace_seconds=_float("MODELING_API_CANCEL_GRACE_SECONDS", 2),
    runtime_skill_dir=None if skill_root_value is None else Path(skill_root_value),
)

app = create_app(config)
