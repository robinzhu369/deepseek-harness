"""Configuration for the private modeling API."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ServiceConfig:
    """Validated deployment limits for one modeling API instance."""

    root: Path
    max_upload_bytes: int = 100 * 1024 * 1024
    upload_chunk_bytes: int = 1024 * 1024
    preview_limit: int = 20
    worker_timeout_seconds: float = 1800
    cancel_grace_seconds: float = 2
    runtime_skill_dir: Path | None = None
    max_skill_bytes: int = 64 * 1024

    def __post_init__(self) -> None:
        object.__setattr__(self, "root", self.root.resolve())
        skill_dir = self.runtime_skill_dir
        if skill_dir is None:
            skill_dir = Path(__file__).resolve().parents[3] / ".dsh" / "skills"
        object.__setattr__(self, "runtime_skill_dir", skill_dir.resolve())
        if self.max_upload_bytes <= 0:
            raise ValueError("max_upload_bytes must be positive")
        if self.upload_chunk_bytes <= 0:
            raise ValueError("upload_chunk_bytes must be positive")
        if not 1 <= self.preview_limit <= 100:
            raise ValueError("preview_limit must be between 1 and 100")
        if self.worker_timeout_seconds <= 0:
            raise ValueError("worker_timeout_seconds must be positive")
        if self.cancel_grace_seconds <= 0:
            raise ValueError("cancel_grace_seconds must be positive")
        if self.max_skill_bytes < 1024:
            raise ValueError("max_skill_bytes must be at least 1024")

    @property
    def database_path(self) -> Path:
        """Return the SQLite path owned by this service root."""
        return self.root / "modeling.sqlite3"
