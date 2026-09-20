"""Trusted subprocess entry point for one deterministic modeling run."""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any

from .contracts import ModelingContractError
from .pipeline import run_pipeline


def emit(event_type: str, node_id: str | None, payload: dict[str, Any]) -> None:
    """Write one structured lifecycle event for the owning service."""
    print(json.dumps({"type": event_type, "node_id": node_id, "payload": payload}, separators=(",", ":")), flush=True)


def main() -> int:
    """Run the fixed pipeline from a service-created input document."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    started = time.monotonic()
    emit("run.started", None, {"pid": os.getpid()})
    emit("node.started", "pipeline", {})
    try:
        result = run_pipeline(Path(payload["dataset_path"]), payload["plan"], Path(payload["output_dir"]))
    except Exception as error:
        code = error.code if isinstance(error, ModelingContractError) else "PIPELINE_FAILED"
        failure = {"code": code, "message": str(error)}
        emit("node.failed", "pipeline", {"duration_ms": int((time.monotonic() - started) * 1000), "error": failure})
        return 1
    emit(
        "node.completed",
        "pipeline",
        {"duration_ms": int((time.monotonic() - started) * 1000), "split_counts": result.split_counts},
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
