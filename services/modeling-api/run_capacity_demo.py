"""Run the reproducible T13 one-million-row capacity verification."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import platform
import resource
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl

from app.config import ServiceConfig
from app.database import ModelingStore
from app.datasets import DatasetService


ROWS = 1_000_000
NUMERIC_COLUMNS = 96
SEED = 20260921
SESSION_ID = "t13-capacity"


class LocalUpload:
    """Expose a local file through the bounded upload stream interface."""

    def __init__(self, path: Path) -> None:
        self.filename = path.name
        self._stream = path.open("rb")

    async def read(self, size: int = -1) -> bytes:
        """Read the next upload chunk."""
        return self._stream.read(size)

    def close(self) -> None:
        """Close the source stream."""
        self._stream.close()


def peak_rss_bytes() -> int:
    """Return process peak RSS using the current platform's ru_maxrss unit."""
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(value if sys.platform == "darwin" else value * 1024)


def sha256_file(path: Path) -> str:
    """Hash a file without loading it into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def timed(stages: dict[str, dict[str, Any]], name: str, operation: Any) -> Any:
    """Measure one synchronous capacity stage."""
    started = time.perf_counter()
    value = operation()
    stages[name] = {"elapsed_seconds": time.perf_counter() - started, "peak_rss_bytes": peak_rss_bytes()}
    return value


def generate_csv(path: Path) -> None:
    """Generate exactly 1,000,000 rows and 100 columns in bounded batches."""
    rng = np.random.default_rng(SEED)
    numeric_names = [f"feature_{index:03d}" for index in range(NUMERIC_COLUMNS)]
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as stream:
        for start in range(0, ROWS, 5_000):
            size = min(5_000, ROWS - start)
            values = rng.integers(0, 1_000, size=(size, NUMERIC_COLUMNS), dtype=np.int32)
            row_numbers = np.arange(start, start + size)
            regions = np.array(["north", "south", "east", "west"], dtype=object)[row_numbers % 4]
            channels = np.array(["web", "mobile", "branch"], dtype=object)[row_numbers % 3]
            regions = regions.astype(object)
            channels = channels.astype(object)
            regions[row_numbers % 97 == 0] = None
            channels[row_numbers % 211 == 0] = None
            labels = ((values[:, 0] + values[:, 1] + row_numbers) % 11 == 0).astype(np.int8)
            columns: dict[str, Any] = {"record_id": [f"capacity_{number:07d}" for number in row_numbers]}
            columns.update({name: values[:, index] for index, name in enumerate(numeric_names)})
            columns["region"] = regions.tolist()
            columns["channel"] = channels.tolist()
            columns["label"] = labels
            pl.DataFrame(columns).write_csv(stream, include_header=start == 0)


async def ingest_and_profile(root: Path, csv_path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """Use the production ingestion and profiling services for the capacity file."""
    config = ServiceConfig(
        root=root,
        max_upload_bytes=2 * 1024 * 1024 * 1024,
        upload_chunk_bytes=4 * 1024 * 1024,
        preview_limit=20,
    )
    store = ModelingStore(config.database_path)
    store.initialize()
    service = DatasetService(config, store)
    upload = LocalUpload(csv_path)
    try:
        dataset = await service.ingest(SESSION_ID, upload)
        while True:
            current = store.get_dataset(str(dataset["id"]), SESSION_ID)
            if current is None:
                raise RuntimeError("capacity dataset disappeared during profiling")
            if current["state"] == "ready":
                return current, dict(current["profile"])
            if current["state"] == "error":
                raise RuntimeError(f"capacity profile failed: {current['error']}")
            await asyncio.sleep(0.25)
    finally:
        upload.close()
        service.shutdown()


def prepare_data(csv_path: Path, output_dir: Path) -> dict[str, Any]:
    """Fit train-only cleaning values and export deterministic prepared splits."""
    numeric_names = [f"feature_{index:03d}" for index in range(NUMERIC_COLUMNS)]
    lazy = pl.scan_csv(csv_path, infer_schema_length=10_000)
    bucket = pl.col("record_id").str.slice(9).cast(pl.Int64) % 10
    train = lazy.filter(bucket < 8)
    medians_row = train.select([pl.col(name).median().alias(name) for name in numeric_names]).collect().row(0, named=True)
    vocabularies = {
        name: train.select(pl.col(name).fill_null("__MISSING__").unique().sort()).collect().get_column(name).to_list()
        for name in ("region", "channel")
    }
    numeric = [pl.col(name).fill_null(medians_row[name]).cast(pl.Float64).alias(name) for name in numeric_names]
    categories = [
        (pl.col(name).fill_null("__MISSING__") == value).cast(pl.UInt8).alias(f"{name}={value}")
        for name, values in vocabularies.items()
        for value in values
    ]
    prepared = lazy.select([pl.col("record_id"), *numeric, *categories, pl.col("label")])
    output_dir.mkdir(parents=True, exist_ok=True)
    split_filters = {
        "train": pl.col("record_id").str.slice(9).cast(pl.Int64) % 10 < 8,
        "validation": pl.col("record_id").str.slice(9).cast(pl.Int64) % 10 == 8,
        "test": pl.col("record_id").str.slice(9).cast(pl.Int64) % 10 == 9,
    }
    split_counts: dict[str, int] = {}
    for name, predicate in split_filters.items():
        destination = output_dir / f"{name}.parquet"
        frame = prepared.filter(predicate).drop("record_id")
        frame.sink_parquet(destination)
        split_counts[name] = int(pl.scan_parquet(destination).select(pl.len()).collect().item())
    manifest = {
        "schema_version": "1.0",
        "seed": SEED,
        "source_rows": ROWS,
        "source_columns": 100,
        "split_counts": split_counts,
        "numeric_imputation": "median fitted on train only",
        "categorical_vocabulary": vocabularies,
        "feature_count": NUMERIC_COLUMNS + sum(len(values) for values in vocabularies.values()),
        "outputs": {
            path.name: {"size_bytes": path.stat().st_size, "sha256": sha256_file(path)}
            for path in sorted(output_dir.glob("*.parquet"))
        },
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return manifest


def main() -> None:
    """Execute the capacity test and write structured evidence."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    root.mkdir(parents=True, exist_ok=False)
    stages: dict[str, dict[str, Any]] = {}
    csv_path = root / "capacity-1m-x-100.csv"
    started = time.perf_counter()
    try:
        timed(stages, "generate", lambda: generate_csv(csv_path))
        ingest_started = time.perf_counter()
        dataset, profile = asyncio.run(ingest_and_profile(root / "service", csv_path))
        stages["upload_and_profile"] = {
            "elapsed_seconds": time.perf_counter() - ingest_started,
            "peak_rss_bytes": peak_rss_bytes(),
        }
        manifest = timed(stages, "clean_feature_prepare", lambda: prepare_data(csv_path, root / "prepared"))
        evidence = {
            "status": "PASS",
            "seed": SEED,
            "rows": ROWS,
            "columns": 100,
            "dataset_id": dataset["id"],
            "dataset_sha256": dataset["sha256"],
            "file_size_bytes": csv_path.stat().st_size,
            "profile": {
                "row_count": profile["row_count"],
                "column_count": profile["column_count"],
                "computation_scope": profile["computation_scope"],
            },
            "manifest": manifest,
            "stages": stages,
            "total_elapsed_seconds": time.perf_counter() - started,
            "peak_rss_bytes": peak_rss_bytes(),
            "peak_rss_method": "resource.getrusage(RUSAGE_SELF).ru_maxrss; bytes on macOS",
            "environment": {
                "os": platform.platform(),
                "machine": platform.machine(),
                "python": platform.python_version(),
                "polars": pl.__version__,
                "cpu_count": __import__("os").cpu_count(),
            },
            "training": "NOT_RUN; full model training is not required by the T13 capacity gate",
        }
    except Exception as error:
        evidence = {
            "status": "FAIL",
            "seed": SEED,
            "rows": ROWS,
            "columns": 100,
            "stages": stages,
            "failed_stage": next((name for name in ("generate", "upload_and_profile", "clean_feature_prepare") if name not in stages), "unknown"),
            "error": f"{type(error).__name__}: {error}",
            "total_elapsed_seconds": time.perf_counter() - started,
            "peak_rss_bytes": peak_rss_bytes(),
        }
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    args.evidence.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2, sort_keys=True))
    if evidence["status"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
