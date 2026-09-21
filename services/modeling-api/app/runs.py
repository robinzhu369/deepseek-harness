"""Independent process execution, cancellation, timeout, and artifact publication."""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import signal
import subprocess
import sys
import threading
from pathlib import Path
from typing import Callable, TextIO

from .config import ServiceConfig
from .contracts import ModelingContractError
from .database import ModelingStore


WorkerCommandFactory = Callable[[str, Path], list[str]]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _artifact_kind(path: Path) -> str:
    return {
        "manifest.json": "manifest",
        "metrics.json": "metrics",
        "feature_manifest.json": "feature_manifest",
        "split_manifest.json": "split_manifest",
        "pipeline.joblib": "model",
        "preprocessor.joblib": "preprocessor",
        "report.md": "report",
    }.get(path.name, "prepared_data" if path.suffix in {".parquet", ".npz"} else "run_metadata")


class RunService:
    """Own child processes and reconcile their output with SQLite state."""

    def __init__(self, config: ServiceConfig, store: ModelingStore, command_factory: WorkerCommandFactory | None = None) -> None:
        self.config = config
        self.store = store
        self.command_factory = command_factory or self._default_command
        self._processes: dict[str, subprocess.Popen[str]] = {}
        self._threads: dict[str, threading.Thread] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _default_command(_run_id: str, input_path: Path) -> list[str]:
        return [sys.executable, "-m", "app.worker", "--input", str(input_path)]

    def schedule(self, run_id: str) -> None:
        """Start a monitor thread; the HTTP request never trains inline."""
        thread = threading.Thread(target=self._execute, args=(run_id,), name=f"modeling-run-{run_id}", daemon=True)
        with self._lock:
            self._threads[run_id] = thread
        thread.start()

    def _execute(self, run_id: str) -> None:
        stderr_path: Path | None = None
        process: subprocess.Popen[str] | None = None
        try:
            worker_input = self.store.worker_input(run_id)
            work_dir = self.config.root / "work" / run_id
            work_dir.mkdir(parents=True, exist_ok=False)
            output_dir = self.config.root / "runs" / run_id
            input_path = work_dir / "input.json"
            input_path.write_text(json.dumps({
                "run_id": run_id,
                "dataset_path": str((self.config.root / worker_input["dataset_storage_key"]).resolve()),
                "output_dir": str(output_dir.resolve()),
                "plan": worker_input["plan"],
            }, ensure_ascii=False, sort_keys=True), encoding="utf-8")
            stderr_path = work_dir / "stderr.log"
            environment = {
                key: value for key, value in os.environ.items()
                if not any(fragment in key.upper() for fragment in ("KEY", "SECRET", "TOKEN", "PASSWORD"))
            }
            environment["PYTHONUNBUFFERED"] = "1"
            service_root = Path(__file__).resolve().parents[1]
            with stderr_path.open("w", encoding="utf-8") as stderr:
                with self._lock:
                    current = self.store.get_run(run_id, str(worker_input["session_id"]))
                    if current is None or current["status"] != "queued":
                        return
                    process = subprocess.Popen(
                        self.command_factory(run_id, input_path),
                        cwd=service_root,
                        env=environment,
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.PIPE,
                        stderr=stderr,
                        text=True,
                        start_new_session=os.name != "nt",
                    )
                    self._processes[run_id] = process
                self.store.set_worker_pid(run_id, process.pid)
                reader = threading.Thread(target=self._read_events, args=(run_id, process.stdout), daemon=True)
                reader.start()
                try:
                    plan_timeout = float(worker_input["plan"]["limits"]["max_run_seconds"])
                    return_code = process.wait(timeout=min(self.config.worker_timeout_seconds, plan_timeout))
                    reader.join(timeout=2)
                except subprocess.TimeoutExpired:
                    self._terminate(process)
                    reader.join(timeout=2)
                    self.store.finish_run(run_id, "failed", error={"code": "RUN_TIMEOUT", "message": "The modeling worker exceeded its time limit."})
                    return
            run = self._get_unscoped_run(run_id)
            if run is None or run["status"] in {"cancelling", "cancelled"}:
                self.store.finish_run(run_id, "cancelled")
                return
            if return_code != 0:
                node_error = next(
                    (node.get("error") for node in reversed(run["nodes"]) if isinstance(node.get("error"), dict)),
                    None,
                )
                if node_error is not None:
                    failure = node_error
                else:
                    message = "The modeling worker exited unsuccessfully."
                    if stderr_path.exists():
                        detail = stderr_path.read_text(encoding="utf-8", errors="replace")[-4000:].strip()
                        if detail:
                            message = detail
                    failure = {"code": "WORKER_FAILED", "message": message}
                self.store.finish_run(run_id, "failed", error=failure)
                return
            manifest_path = output_dir / "manifest.json"
            metrics_path = output_dir / "metrics.json"
            if not manifest_path.is_file() or not metrics_path.is_file():
                self.store.finish_run(run_id, "failed", error={"code": "INCOMPLETE_OUTPUT", "message": "The worker did not publish complete output."})
                return
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
            feature_manifest = json.loads((output_dir / "feature_manifest.json").read_text(encoding="utf-8"))
            feature_summary = {
                "numeric_features": feature_manifest["numeric_features"],
                "categorical_features": feature_manifest["categorical_features"],
                "excluded_columns": feature_manifest["excluded_columns"],
                "output_feature_count": len(feature_manifest["output_features"]),
            }
            expected = {item["path"]: item for item in manifest.get("artifacts", [])}
            files = sorted(path for path in output_dir.iterdir() if path.is_file())
            artifacts: list[dict[str, object]] = []
            for path in files:
                digest = _sha256(path)
                if path.name != "manifest.json":
                    item = expected.get(path.name)
                    if item is None or item.get("sha256") != digest or item.get("size_bytes") != path.stat().st_size:
                        raise ModelingContractError("ARTIFACT_HASH_MISMATCH", f"Artifact verification failed for {path.name}.")
                artifacts.append({
                    "kind": _artifact_kind(path),
                    "storage_key": path.relative_to(self.config.root).as_posix(),
                    "sha256": digest,
                    "size_bytes": path.stat().st_size,
                    "media_type": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                })
            session_id = str(worker_input["session_id"])
            created = self.store.complete_run_with_artifacts(
                run_id, session_id, artifacts,
                {
                    "metrics": metrics,
                    "diagnostics": metrics.get("diagnostics", []),
                    "recommendations": metrics.get("recommendations", []),
                    "manifest": manifest,
                    "feature_summary": feature_summary,
                },
            )
            if created is None:
                self.store.finish_run(run_id, "cancelled")
        except Exception as error:
            code = error.code if isinstance(error, ModelingContractError) else "WORKER_SUPERVISOR_FAILED"
            self.store.finish_run(run_id, "failed", error={"code": code, "message": str(error)})
        finally:
            with self._lock:
                self._processes.pop(run_id, None)
                self._threads.pop(run_id, None)

    def _read_events(self, run_id: str, stream: TextIO | None) -> None:
        if stream is None:
            return
        for line in stream:
            try:
                event = json.loads(line)
                self.store.record_event(run_id, str(event["type"]), event.get("node_id"), event.get("payload") or {})
            except (KeyError, TypeError, json.JSONDecodeError):
                self.store.record_event(run_id, "worker.output.invalid", None, {"line": line[:500]})

    def _get_unscoped_run(self, run_id: str) -> dict[str, object] | None:
        worker_input = self.store.worker_input(run_id)
        return self.store.get_run(run_id, str(worker_input["session_id"]))

    def _terminate(self, process: subprocess.Popen[str]) -> None:
        if process.poll() is not None:
            return
        if os.name != "nt":
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
        try:
            process.wait(timeout=self.config.cancel_grace_seconds)
        except subprocess.TimeoutExpired:
            if os.name != "nt":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
            process.wait(timeout=self.config.cancel_grace_seconds)

    def cancel(self, run_id: str, session_id: str) -> dict[str, object]:
        """Persist cancellation intent, terminate the owned process, and await exit."""
        state = self.store.request_cancel(run_id, session_id)
        if state["status"] == "cancelling":
            with self._lock:
                process = self._processes.get(run_id)
            if process is not None:
                self._terminate(process)
            self.store.finish_run(run_id, "cancelled")
        value = self.store.get_run(run_id, session_id)
        assert value is not None
        return value

    def shutdown(self) -> None:
        """Terminate owned children and wait briefly for monitor reconciliation."""
        with self._lock:
            processes = list(self._processes.values())
            threads = list(self._threads.values())
        for process in processes:
            self._terminate(process)
        for thread in threads:
            thread.join(timeout=self.config.cancel_grace_seconds + 2)
