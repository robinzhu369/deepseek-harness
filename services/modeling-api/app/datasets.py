"""Bounded CSV ingestion and asynchronous dataset profiling."""

from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path, PurePath
from threading import Lock
from typing import Any, Protocol

import polars as pl

from .config import ServiceConfig
from .contracts import ModelingContractError
from .database import ModelingStore


class UploadStream(Protocol):
    """The bounded read operation required from an uploaded file."""

    filename: str | None

    async def read(self, size: int = -1) -> bytes:
        """Read at most ``size`` bytes."""


def _safe_name(value: str | None) -> str:
    normalized = (value or "dataset.csv").replace("\\", "/")
    name = PurePath(normalized).name.strip()
    return name[:255] or "dataset.csv"


def _looks_like_data(row: list[str]) -> bool:
    if not row:
        return True
    for value in row:
        text = value.strip()
        if not text:
            continue
        try:
            float(text)
        except ValueError:
            return False
    return True


def validate_csv_file(path: Path) -> list[str]:
    """Stream through a UTF-8 CSV and return its validated header."""
    if path.stat().st_size == 0:
        raise ModelingContractError("EMPTY_FILE", "The uploaded CSV is empty.")
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as stream:
            reader = csv.reader(stream, strict=True)
            try:
                header = next(reader)
            except StopIteration as error:
                raise ModelingContractError("EMPTY_FILE", "The uploaded CSV is empty.") from error
            if not header or _looks_like_data(header) or any(not item.strip() for item in header):
                raise ModelingContractError("MISSING_HEADER", "The CSV must have a non-empty header row.")
            if len(set(header)) != len(header):
                raise ModelingContractError("DUPLICATE_COLUMN", "The CSV header contains duplicate column names.")
            for line_number, row in enumerate(reader, start=2):
                if len(row) != len(header):
                    raise ModelingContractError(
                        "INVALID_CSV",
                        "A CSV row has a different field count from the header.",
                        details={"line": line_number, "expected": len(header), "actual": len(row)},
                    )
                if any("\x00" in value for value in row):
                    raise ModelingContractError("INVALID_CSV", "The CSV contains a NUL byte.", details={"line": line_number})
    except UnicodeDecodeError as error:
        raise ModelingContractError("INVALID_ENCODING", "The CSV must be valid UTF-8.") from error
    except csv.Error as error:
        raise ModelingContractError("INVALID_CSV", "The CSV syntax is invalid.") from error
    return header


def _json_value(value: Any) -> Any:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def build_profile(path: Path, preview_limit: int) -> dict[str, Any]:
    """Compute bounded summary statistics without materializing rows for a caller."""
    lazy = pl.scan_csv(path, infer_schema_length=10_000, try_parse_dates=False)
    schema = lazy.collect_schema()
    row_count = int(lazy.select(pl.len().alias("count")).collect().item())
    preview_frame = lazy.head(preview_limit).collect()
    columns: list[dict[str, Any]] = []
    numeric_types = {
        pl.Int8, pl.Int16, pl.Int32, pl.Int64, pl.UInt8, pl.UInt16, pl.UInt32, pl.UInt64,
        pl.Float32, pl.Float64,
    }
    for name, dtype in schema.items():
        summary = lazy.select(
            pl.col(name).null_count().alias("missing"),
            pl.col(name).n_unique().alias("cardinality"),
        ).collect().row(0, named=True)
        item: dict[str, Any] = {
            "name": name,
            "dtype": str(dtype),
            "missing_ratio": float(summary["missing"] / row_count) if row_count else 0.0,
        }
        if dtype in numeric_types:
            bounds = lazy.select(pl.col(name).min().alias("min"), pl.col(name).max().alias("max")).collect().row(0, named=True)
            item["numeric"] = {"min": _json_value(bounds["min"]), "max": _json_value(bounds["max"])}
        else:
            item["categorical"] = {"cardinality": int(summary["cardinality"])}
        columns.append(item)
    preview = [
        {name: _json_value(value) for name, value in row.items()}
        for row in preview_frame.to_dicts()
    ]
    return {
        "row_count": row_count,
        "column_count": len(schema),
        "schema": [{"name": name, "dtype": str(dtype)} for name, dtype in schema.items()],
        "columns": columns,
        "preview": preview,
        "computation_scope": {"kind": "full_dataset", "rows_scanned": row_count, "preview_rows": len(preview)},
    }


class DatasetService:
    """Own immutable dataset files and a bounded background profile pool."""

    def __init__(self, config: ServiceConfig, store: ModelingStore) -> None:
        self.config = config
        self.store = store
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="modeling-profile")
        self._futures: set[Future[None]] = set()
        self._lock = Lock()

    async def ingest(self, session_id: str, upload: UploadStream) -> dict[str, Any]:
        """Write one upload in bounded chunks, validate it, and enqueue profiling."""
        staging_dir = self.config.root / "uploads"
        staging_dir.mkdir(parents=True, exist_ok=True)
        staging = staging_dir / f".{uuid.uuid4().hex}.partial"
        digest = hashlib.sha256()
        size = 0
        try:
            with staging.open("xb") as stream:
                while True:
                    chunk = await upload.read(self.config.upload_chunk_bytes)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > self.config.max_upload_bytes:
                        raise ModelingContractError("UPLOAD_TOO_LARGE", "The upload exceeds the configured size limit.")
                    digest.update(chunk)
                    stream.write(chunk)
                stream.flush()
                os.fsync(stream.fileno())
            validate_csv_file(staging)
            sha256 = digest.hexdigest()
            existing = self.store.find_dataset_by_hash(session_id, sha256)
            if existing is not None:
                return {**existing, "profile_run_id": f"profile_{existing['id']}"}
            stable = hashlib.sha256(f"{session_id}\0{sha256}".encode()).hexdigest()[:24]
            dataset_id = f"ds_{stable}"
            directory = self.config.root / "datasets" / dataset_id
            directory.mkdir(parents=True, exist_ok=False)
            raw = directory / "raw.csv"
            os.replace(staging, raw)
            relative = raw.relative_to(self.config.root).as_posix()
            self.store.create_dataset({
                "id": dataset_id,
                "session_id": session_id,
                "original_name": _safe_name(upload.filename),
                "sha256": sha256,
                "size_bytes": size,
                "storage_key": relative,
            })
            dataset = self.store.get_dataset(dataset_id, session_id)
            assert dataset is not None
            self.schedule(dataset)
            return {**dataset, "profile_run_id": f"profile_{dataset_id}"}
        except FileExistsError:
            sha256 = digest.hexdigest()
            existing = self.store.find_dataset_by_hash(session_id, sha256)
            if existing is None:
                raise ModelingContractError("DATASET_CONFLICT", "The dataset storage key already exists.")
            return {**existing, "profile_run_id": f"profile_{existing['id']}"}
        finally:
            staging.unlink(missing_ok=True)

    def schedule(self, dataset: dict[str, Any]) -> None:
        """Queue a stored dataset for background profiling."""
        future = self._executor.submit(self._profile, dataset)
        with self._lock:
            self._futures.add(future)
        future.add_done_callback(self._discard)

    def _discard(self, future: Future[None]) -> None:
        with self._lock:
            self._futures.discard(future)

    def _profile(self, dataset: dict[str, Any]) -> None:
        dataset_id = str(dataset["id"])
        try:
            self.store.set_dataset_profiling(dataset_id)
            path = self.config.root / str(dataset["storage_key"])
            profile = build_profile(path, self.config.preview_limit)
            self.store.finish_dataset_profile(dataset_id, profile)
        except Exception as error:
            code = error.code if isinstance(error, ModelingContractError) else "PROFILE_FAILED"
            self.store.fail_dataset_profile(dataset_id, {"code": code, "message": str(error)})

    def recover(self) -> None:
        """Requeue profiles interrupted before service startup."""
        for dataset in self.store.list_profile_recovery():
            self.schedule(dataset)

    def preview(self, dataset: dict[str, Any], limit: int) -> list[dict[str, Any]]:
        """Read no more than the configured preview row count."""
        path = self.config.root / str(dataset["storage_key"])
        frame = pl.scan_csv(path, infer_schema_length=10_000).head(limit).collect()
        return [{name: _json_value(value) for name, value in row.items()} for row in frame.to_dicts()]

    def shutdown(self) -> None:
        """Wait for bounded profiling work before closing the service."""
        self._executor.shutdown(wait=True, cancel_futures=False)
