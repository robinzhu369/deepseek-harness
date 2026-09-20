"""SQLite persistence for datasets, immutable plans, runs, events, and artifacts."""

from __future__ import annotations

import json
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .contracts import ModelingContractError, plan_invalidation


def utc_now() -> str:
    """Return a UTC ISO-8601 timestamp."""
    return datetime.now(timezone.utc).isoformat()


class ModelingStore:
    """Open short-lived SQLite connections around atomic domain operations."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """Run one immediate transaction and roll it back on failure."""
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        """Create the monotonic schema used by T04 and T05."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS schema_meta (
                  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                  version INTEGER NOT NULL
                );
                INSERT OR IGNORE INTO schema_meta(singleton, version) VALUES (1, 1);
                CREATE TABLE IF NOT EXISTS datasets (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL,
                  original_name TEXT NOT NULL,
                  sha256 TEXT NOT NULL,
                  size_bytes INTEGER NOT NULL,
                  storage_key TEXT NOT NULL UNIQUE,
                  state TEXT NOT NULL,
                  profile_json TEXT,
                  error_json TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  UNIQUE(session_id, sha256)
                );
                CREATE TABLE IF NOT EXISTS plans (
                  id TEXT NOT NULL,
                  revision INTEGER NOT NULL,
                  session_id TEXT NOT NULL,
                  dataset_id TEXT NOT NULL,
                  dataset_sha256 TEXT NOT NULL,
                  plan_json TEXT NOT NULL,
                  plan_hash TEXT NOT NULL,
                  skill_snapshots_json TEXT NOT NULL DEFAULT '[]',
                  invalidation_json TEXT,
                  state TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  PRIMARY KEY(id, revision),
                  FOREIGN KEY(dataset_id) REFERENCES datasets(id)
                );
                CREATE TABLE IF NOT EXISTS runs (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL,
                  plan_id TEXT,
                  plan_revision INTEGER,
                  status TEXT NOT NULL,
                  revision INTEGER NOT NULL,
                  result_json TEXT,
                  error_json TEXT,
                  worker_pid INTEGER,
                  rerun_of TEXT,
                  created_at TEXT NOT NULL,
                  started_at TEXT,
                  completed_at TEXT,
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS run_nodes (
                  run_id TEXT NOT NULL,
                  node_id TEXT NOT NULL,
                  status TEXT NOT NULL,
                  duration_ms INTEGER,
                  error_json TEXT,
                  PRIMARY KEY(run_id, node_id),
                  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS run_events (
                  run_id TEXT NOT NULL,
                  seq INTEGER NOT NULL,
                  node_id TEXT,
                  type TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  occurred_at TEXT NOT NULL,
                  PRIMARY KEY(run_id, seq),
                  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS artifacts (
                  id TEXT PRIMARY KEY,
                  session_id TEXT NOT NULL,
                  run_id TEXT NOT NULL,
                  kind TEXT NOT NULL,
                  storage_key TEXT NOT NULL UNIQUE,
                  sha256 TEXT NOT NULL,
                  size_bytes INTEGER NOT NULL,
                  media_type TEXT NOT NULL,
                  completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
                  created_at TEXT NOT NULL,
                  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS idempotency (
                  session_id TEXT NOT NULL,
                  operation TEXT NOT NULL,
                  key TEXT NOT NULL,
                  request_hash TEXT NOT NULL,
                  run_id TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  PRIMARY KEY(session_id, operation, key),
                  FOREIGN KEY(run_id) REFERENCES runs(id)
                );
                CREATE TABLE IF NOT EXISTS skills (
                  name TEXT PRIMARY KEY,
                  description TEXT NOT NULL,
                  active_version TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS skill_versions (
                  skill_name TEXT NOT NULL,
                  version TEXT NOT NULL,
                  content TEXT NOT NULL,
                  hash TEXT NOT NULL,
                  published_at TEXT NOT NULL,
                  PRIMARY KEY(skill_name, version),
                  UNIQUE(skill_name, hash),
                  FOREIGN KEY(skill_name) REFERENCES skills(name)
                );
                CREATE TABLE IF NOT EXISTS skill_drafts (
                  session_id TEXT NOT NULL,
                  skill_name TEXT NOT NULL,
                  content TEXT NOT NULL,
                  hash TEXT NOT NULL,
                  validation_json TEXT,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY(session_id, skill_name),
                  FOREIGN KEY(skill_name) REFERENCES skills(name)
                );
                """
            )
            columns = {row[1] for row in connection.execute("PRAGMA table_info(plans)").fetchall()}
            if "skill_snapshots_json" not in columns:
                connection.execute("ALTER TABLE plans ADD COLUMN skill_snapshots_json TEXT NOT NULL DEFAULT '[]'")
            if "invalidation_json" not in columns:
                connection.execute("ALTER TABLE plans ADD COLUMN invalidation_json TEXT")
            run_columns = {row[1] for row in connection.execute("PRAGMA table_info(runs)").fetchall()}
            if "rerun_of" not in run_columns:
                connection.execute("ALTER TABLE runs ADD COLUMN rerun_of TEXT")
            connection.execute("UPDATE schema_meta SET version = 4 WHERE singleton = 1 AND version < 4")

    @staticmethod
    def _json(value: Any) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

    @staticmethod
    def _loads(value: str | None) -> Any:
        return None if value is None else json.loads(value)

    def get_dataset(self, dataset_id: str, session_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM datasets WHERE id = ? AND session_id = ?",
                (dataset_id, session_id),
            ).fetchone()
        return None if row is None else self._dataset(row)

    def find_dataset_by_hash(self, session_id: str, sha256: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM datasets WHERE session_id = ? AND sha256 = ?",
                (session_id, sha256),
            ).fetchone()
        return None if row is None else self._dataset(row)

    def create_dataset(self, value: dict[str, Any]) -> None:
        now = utc_now()
        with self.transaction() as connection:
            connection.execute(
                """INSERT INTO datasets(id, session_id, original_name, sha256, size_bytes, storage_key, state, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, 'uploaded', ?, ?)""",
                (
                    value["id"], value["session_id"], value["original_name"], value["sha256"],
                    value["size_bytes"], value["storage_key"], now, now,
                ),
            )

    def list_datasets(self, session_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM datasets WHERE session_id = ? ORDER BY created_at DESC",
                (session_id,),
            ).fetchall()
        return [self._dataset(row) for row in rows]

    def list_profile_recovery(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM datasets WHERE state IN ('uploaded', 'profiling') ORDER BY created_at",
            ).fetchall()
        return [self._dataset(row) for row in rows]

    def set_dataset_profiling(self, dataset_id: str) -> None:
        with self.transaction() as connection:
            connection.execute(
                "UPDATE datasets SET state = 'profiling', error_json = NULL, updated_at = ? WHERE id = ?",
                (utc_now(), dataset_id),
            )

    def finish_dataset_profile(self, dataset_id: str, profile: dict[str, Any]) -> None:
        with self.transaction() as connection:
            connection.execute(
                "UPDATE datasets SET state = 'ready', profile_json = ?, error_json = NULL, updated_at = ? WHERE id = ?",
                (self._json(profile), utc_now(), dataset_id),
            )

    def fail_dataset_profile(self, dataset_id: str, error: dict[str, Any]) -> None:
        with self.transaction() as connection:
            connection.execute(
                "UPDATE datasets SET state = 'error', error_json = ?, updated_at = ? WHERE id = ?",
                (self._json(error), utc_now(), dataset_id),
            )

    def _dataset(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"], "session_id": row["session_id"], "original_name": row["original_name"],
            "sha256": row["sha256"], "size_bytes": row["size_bytes"], "storage_key": row["storage_key"],
            "state": row["state"], "profile": self._loads(row["profile_json"]), "error": self._loads(row["error_json"]),
            "created_at": row["created_at"], "updated_at": row["updated_at"],
        }

    def create_plan(
        self,
        session_id: str,
        dataset_id: str,
        dataset_sha256: str,
        plan: dict[str, Any],
        plan_hash: str,
        skill_snapshots: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        plan_id = f"plan_{uuid.uuid4().hex}"
        with self.transaction() as connection:
            connection.execute(
                """INSERT INTO plans(id, revision, session_id, dataset_id, dataset_sha256, plan_json, plan_hash, skill_snapshots_json, invalidation_json, state, created_at)
                   VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?)""",
                (plan_id, session_id, dataset_id, dataset_sha256, self._json(plan), plan_hash, self._json(skill_snapshots or []), self._json({
                    "reason": "new_plan", "invalidated_stages": ["Validate", "Split", "Preprocess", "Feature", "Train", "Evaluate", "Result"],
                    "execution_stages": ["Validate", "Split", "Preprocess", "Feature", "Train", "Evaluate", "Result"],
                    "cache_reused": False, "note": "A new plan executes the full pipeline.",
                }), utc_now()),
            )
        value = self.get_plan(plan_id, session_id, 1)
        assert value is not None
        return value

    def get_plan(self, plan_id: str, session_id: str, revision: int | None = None) -> dict[str, Any] | None:
        query = "SELECT * FROM plans WHERE id = ? AND session_id = ?"
        params: list[Any] = [plan_id, session_id]
        if revision is None:
            query += " ORDER BY revision DESC LIMIT 1"
        else:
            query += " AND revision = ?"
            params.append(revision)
        with self._connect() as connection:
            row = connection.execute(query, params).fetchone()
        return None if row is None else self._plan(row)

    def latest_plan(self, session_id: str) -> dict[str, Any] | None:
        """Return the newest plan revision owned by one Session."""
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM plans WHERE session_id = ? ORDER BY created_at DESC, revision DESC LIMIT 1",
                (session_id,),
            ).fetchone()
        return None if row is None else self._plan(row)

    def update_plan(
        self,
        plan_id: str,
        session_id: str,
        base_revision: int,
        dataset_id: str,
        dataset_sha256: str,
        plan: dict[str, Any],
        plan_hash: str,
        skill_snapshots: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        with self.transaction() as connection:
            current = connection.execute(
                "SELECT * FROM plans WHERE id = ? AND session_id = ? ORDER BY revision DESC LIMIT 1",
                (plan_id, session_id),
            ).fetchone()
            if current is None:
                raise ModelingContractError("PLAN_NOT_FOUND", "Plan not found.")
            if current["revision"] != base_revision:
                raise ModelingContractError("PLAN_REVISION_CONFLICT", "The plan revision is not current.")
            if current["state"] not in {"approved", "proposed"}:
                raise ModelingContractError("INVALID_PLAN_STATE", "Only the current proposed or approved plan can be revised.")
            if current["state"] == "proposed":
                connection.execute(
                    "UPDATE plans SET state = 'superseded' WHERE id = ? AND revision = ?",
                    (plan_id, base_revision),
                )
            revision = base_revision + 1
            invalidation = plan_invalidation(self._loads(current["plan_json"]), plan)
            snapshots = self._loads(current["skill_snapshots_json"]) if skill_snapshots is None else skill_snapshots
            connection.execute(
                """INSERT INTO plans(id, revision, session_id, dataset_id, dataset_sha256, plan_json, plan_hash, skill_snapshots_json, invalidation_json, state, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?)""",
                (plan_id, revision, session_id, dataset_id, dataset_sha256, self._json(plan), plan_hash, self._json(snapshots), self._json(invalidation), utc_now()),
            )
        value = self.get_plan(plan_id, session_id, revision)
        assert value is not None
        return value

    def _plan(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"], "revision": row["revision"], "session_id": row["session_id"],
            "dataset_id": row["dataset_id"], "dataset_sha256": row["dataset_sha256"],
            "plan": self._loads(row["plan_json"]), "plan_hash": row["plan_hash"],
            "skill_snapshots": self._loads(row["skill_snapshots_json"]),
            "invalidation": self._loads(row["invalidation_json"]),
            "state": row["state"], "created_at": row["created_at"],
        }

    def approve_and_create_run(
        self,
        *,
        plan_id: str,
        session_id: str,
        revision: int,
        plan_hash: str,
        idempotency_key: str,
        request_hash: str,
        rerun_of: str | None = None,
    ) -> tuple[str, bool]:
        operation = f"rerun:{rerun_of}" if rerun_of is not None else f"approve-and-run:{plan_id}"
        with self.transaction() as connection:
            prior = connection.execute(
                "SELECT request_hash, run_id FROM idempotency WHERE session_id = ? AND operation = ? AND key = ?",
                (session_id, operation, idempotency_key),
            ).fetchone()
            if prior is not None:
                if prior["request_hash"] != request_hash:
                    raise ModelingContractError("IDEMPOTENCY_CONFLICT", "The idempotency key was used with a different request.")
                return str(prior["run_id"]), False
            plan = connection.execute(
                "SELECT * FROM plans WHERE id = ? AND revision = ? AND session_id = ?",
                (plan_id, revision, session_id),
            ).fetchone()
            if plan is None:
                raise ModelingContractError("PLAN_NOT_FOUND", "Plan revision not found.")
            if rerun_of is not None:
                source = connection.execute(
                    "SELECT plan_id, plan_revision, status FROM runs WHERE id = ? AND session_id = ?",
                    (rerun_of, session_id),
                ).fetchone()
                if source is None:
                    raise ModelingContractError("RUN_NOT_FOUND", "Source Run not found.")
                if source["plan_id"] != plan_id or source["status"] not in {"succeeded", "failed", "cancelled", "interrupted"}:
                    raise ModelingContractError("INVALID_RERUN_SOURCE", "Rerun requires a terminal Run from the same plan lineage.")
                if revision <= source["plan_revision"]:
                    raise ModelingContractError("INVALID_PLAN_STATE", "Rerun requires a newer Plan revision.")
            if plan["state"] != "proposed":
                raise ModelingContractError("INVALID_PLAN_STATE", "Only a proposed plan can be approved.")
            if plan["plan_hash"] != plan_hash:
                raise ModelingContractError("PLAN_HASH_MISMATCH", "The approval hash does not match the plan.")
            dataset = connection.execute(
                "SELECT sha256, state FROM datasets WHERE id = ? AND session_id = ?",
                (plan["dataset_id"], session_id),
            ).fetchone()
            if dataset is None or dataset["state"] != "ready" or dataset["sha256"] != plan["dataset_sha256"]:
                raise ModelingContractError("DATASET_VERSION_CONFLICT", "The approved plan no longer matches a ready dataset.")
            active = connection.execute(
                "SELECT id FROM runs WHERE status IN ('queued', 'running', 'cancelling') LIMIT 1",
            ).fetchone()
            if active is not None:
                raise ModelingContractError("RUN_CAPACITY", "The single modeling worker is busy.")
            run_id = f"run_{uuid.uuid4().hex}"
            now = utc_now()
            connection.execute(
                "UPDATE plans SET state = 'approved' WHERE id = ? AND revision = ?",
                (plan_id, revision),
            )
            connection.execute(
                """INSERT INTO runs(id, session_id, plan_id, plan_revision, status, revision, rerun_of, created_at, updated_at)
                   VALUES (?, ?, ?, ?, 'queued', 1, ?, ?, ?)""",
                (run_id, session_id, plan_id, revision, rerun_of, now, now),
            )
            connection.executemany(
                "INSERT INTO run_nodes(run_id, node_id, status) VALUES (?, ?, 'pending')",
                ((run_id, "pipeline"), (run_id, "artifacts")),
            )
            connection.execute(
                "INSERT INTO run_events(run_id, seq, node_id, type, payload_json, occurred_at) VALUES (?, 1, NULL, 'run.queued', '{}', ?)",
                (run_id, now),
            )
            connection.execute(
                "INSERT INTO idempotency(session_id, operation, key, request_hash, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (session_id, operation, idempotency_key, request_hash, run_id, now),
            )
            return run_id, True

    def worker_input(self, run_id: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                """SELECT r.id, r.session_id, p.plan_json, d.storage_key
                   FROM runs r
                   JOIN plans p ON p.id = r.plan_id AND p.revision = r.plan_revision
                   JOIN datasets d ON d.id = p.dataset_id
                   WHERE r.id = ?""",
                (run_id,),
            ).fetchone()
        if row is None:
            raise ModelingContractError("RUN_NOT_FOUND", "Run not found.")
        return {"run_id": row["id"], "session_id": row["session_id"], "plan": self._loads(row["plan_json"]), "dataset_storage_key": row["storage_key"]}

    def set_worker_pid(self, run_id: str, pid: int) -> None:
        with self.transaction() as connection:
            connection.execute("UPDATE runs SET worker_pid = ?, updated_at = ? WHERE id = ?", (pid, utc_now(), run_id))

    def record_event(self, run_id: str, event_type: str, node_id: str | None, payload: dict[str, Any]) -> None:
        with self.transaction() as connection:
            row = connection.execute("SELECT status FROM runs WHERE id = ?", (run_id,)).fetchone()
            if row is None or row["status"] in {"succeeded", "failed", "cancelled", "interrupted"}:
                return
            seq = connection.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM run_events WHERE run_id = ?", (run_id,)).fetchone()[0]
            now = utc_now()
            connection.execute(
                "INSERT INTO run_events(run_id, seq, node_id, type, payload_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?)",
                (run_id, seq, node_id, event_type, self._json(payload), now),
            )
            if event_type == "run.started" and row["status"] == "queued":
                connection.execute("UPDATE runs SET status = 'running', revision = revision + 1, started_at = ?, updated_at = ? WHERE id = ?", (now, now, run_id))
            elif node_id is not None and event_type in {"node.started", "node.completed", "node.failed"}:
                status = {"node.started": "running", "node.completed": "succeeded", "node.failed": "failed"}[event_type]
                connection.execute(
                    "UPDATE run_nodes SET status = ?, duration_ms = ?, error_json = ? WHERE run_id = ? AND node_id = ?",
                    (status, payload.get("duration_ms"), self._json(payload.get("error")) if payload.get("error") else None, run_id, node_id),
                )
                connection.execute("UPDATE runs SET revision = revision + 1, updated_at = ? WHERE id = ?", (now, run_id))

    def complete_run_with_artifacts(
        self,
        run_id: str,
        session_id: str,
        artifacts: list[dict[str, Any]],
        result: dict[str, Any],
    ) -> list[dict[str, Any]] | None:
        """Atomically publish verified artifacts and the succeeded run state."""
        created: list[dict[str, Any]] = []
        with self.transaction() as connection:
            run = connection.execute("SELECT status FROM runs WHERE id = ? AND session_id = ?", (run_id, session_id)).fetchone()
            if run is None or run["status"] != "running":
                return None
            for artifact in artifacts:
                artifact_id = f"art_{uuid.uuid4().hex}"
                now = utc_now()
                connection.execute(
                    """INSERT INTO artifacts(id, session_id, run_id, kind, storage_key, sha256, size_bytes, media_type, completed, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)""",
                    (artifact_id, session_id, run_id, artifact["kind"], artifact["storage_key"], artifact["sha256"], artifact["size_bytes"], artifact["media_type"], now),
                )
                seq = connection.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM run_events WHERE run_id = ?", (run_id,)).fetchone()[0]
                connection.execute(
                    "INSERT INTO run_events(run_id, seq, node_id, type, payload_json, occurred_at) VALUES (?, ?, 'artifacts', 'artifact.created', ?, ?)",
                    (run_id, seq, self._json({"artifact_id": artifact_id, "kind": artifact["kind"]}), now),
                )
                created.append({"id": artifact_id, **artifact, "completed": True})
            connection.execute("UPDATE run_nodes SET status = 'succeeded' WHERE run_id = ? AND node_id = 'artifacts'", (run_id,))
            now = utc_now()
            completed_result = {**result, "artifact_ids": [item["id"] for item in created]}
            connection.execute(
                "UPDATE runs SET status = 'succeeded', revision = revision + 1, result_json = ?, worker_pid = NULL, completed_at = ?, updated_at = ? WHERE id = ?",
                (self._json(completed_result), now, now, run_id),
            )
            seq = connection.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM run_events WHERE run_id = ?", (run_id,)).fetchone()[0]
            connection.execute(
                "INSERT INTO run_events(run_id, seq, node_id, type, payload_json, occurred_at) VALUES (?, ?, NULL, 'run.completed', '{}', ?)",
                (run_id, seq, now),
            )
        return created

    def finish_run(self, run_id: str, status: str, *, result: dict[str, Any] | None = None, error: dict[str, Any] | None = None) -> None:
        with self.transaction() as connection:
            current = connection.execute("SELECT status FROM runs WHERE id = ?", (run_id,)).fetchone()
            if current is None or current["status"] in {"succeeded", "failed", "cancelled", "interrupted"}:
                return
            now = utc_now()
            connection.execute(
                """UPDATE runs SET status = ?, revision = revision + 1, result_json = ?, error_json = ?, worker_pid = NULL,
                   completed_at = ?, updated_at = ? WHERE id = ?""",
                (status, self._json(result) if result is not None else None, self._json(error) if error is not None else None, now, now, run_id),
            )
            if status != "succeeded":
                connection.execute(
                    "UPDATE run_nodes SET status = CASE WHEN status = 'running' THEN ? ELSE 'blocked' END WHERE run_id = ? AND status IN ('pending', 'running')",
                    ("cancelled" if status == "cancelled" else "failed", run_id),
                )
            seq = connection.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM run_events WHERE run_id = ?", (run_id,)).fetchone()[0]
            event_type = {"succeeded": "run.completed", "cancelled": "run.cancelled", "interrupted": "run.interrupted"}.get(status, "run.failed")
            connection.execute(
                "INSERT INTO run_events(run_id, seq, node_id, type, payload_json, occurred_at) VALUES (?, ?, NULL, ?, ?, ?)",
                (run_id, seq, event_type, self._json({"error": error} if error else {}), now),
            )

    def request_cancel(self, run_id: str, session_id: str) -> dict[str, Any]:
        with self.transaction() as connection:
            row = connection.execute("SELECT status FROM runs WHERE id = ? AND session_id = ?", (run_id, session_id)).fetchone()
            if row is None:
                raise ModelingContractError("RUN_NOT_FOUND", "Run not found.")
            if row["status"] in {"succeeded", "failed", "cancelled", "interrupted"}:
                pass
            elif row["status"] == "queued":
                now = utc_now()
                connection.execute("UPDATE runs SET status = 'cancelled', revision = revision + 1, worker_pid = NULL, completed_at = ?, updated_at = ? WHERE id = ?", (now, now, run_id))
                connection.execute("UPDATE run_nodes SET status = 'blocked' WHERE run_id = ? AND status = 'pending'", (run_id,))
                seq = connection.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM run_events WHERE run_id = ?", (run_id,)).fetchone()[0]
                connection.execute(
                    "INSERT INTO run_events(run_id, seq, node_id, type, payload_json, occurred_at) VALUES (?, ?, NULL, 'run.cancelled', '{}', ?)",
                    (run_id, seq, now),
                )
            else:
                connection.execute("UPDATE runs SET status = 'cancelling', revision = revision + 1, updated_at = ? WHERE id = ?", (utc_now(), run_id))
        value = self.get_run(run_id, session_id)
        assert value is not None
        return value

    def get_run(self, run_id: str, session_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM runs WHERE id = ? AND session_id = ?", (run_id, session_id)).fetchone()
            if row is None:
                return None
            nodes = connection.execute("SELECT * FROM run_nodes WHERE run_id = ? ORDER BY rowid", (run_id,)).fetchall()
            events = connection.execute("SELECT * FROM run_events WHERE run_id = ? ORDER BY seq", (run_id,)).fetchall()
            artifacts = connection.execute(
                "SELECT * FROM artifacts WHERE run_id = ? AND session_id = ? AND completed = 1 ORDER BY created_at",
                (run_id, session_id),
            ).fetchall()
        return {
            "id": row["id"], "session_id": row["session_id"], "plan_id": row["plan_id"],
            "plan_revision": row["plan_revision"], "status": row["status"], "revision": row["revision"],
            "rerun_of": row["rerun_of"],
            "worker_pid": row["worker_pid"], "result": self._loads(row["result_json"]), "error": self._loads(row["error_json"]),
            "created_at": row["created_at"], "started_at": row["started_at"], "completed_at": row["completed_at"],
            "nodes": [
                {"id": item["node_id"], "status": item["status"], "duration_ms": item["duration_ms"], "error": self._loads(item["error_json"])}
                for item in nodes
            ],
            "events": [
                {"seq": item["seq"], "node_id": item["node_id"], "type": item["type"], "payload": self._loads(item["payload_json"]), "occurred_at": item["occurred_at"]}
                for item in events
            ],
            "artifacts": [
                {key: value for key, value in self._artifact(item).items() if key != "storage_key"}
                for item in artifacts
            ],
        }

    def latest_run(self, session_id: str) -> dict[str, Any] | None:
        """Return the newest run with its nodes and events for one Session."""
        with self._connect() as connection:
            row = connection.execute(
                "SELECT id FROM runs WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
                (session_id,),
            ).fetchone()
        return None if row is None else self.get_run(str(row["id"]), session_id)

    def list_runs(self, session_id: str) -> list[dict[str, Any]]:
        """Return every preserved Run in creation order for one Session."""
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT id FROM runs WHERE session_id = ? ORDER BY created_at",
                (session_id,),
            ).fetchall()
        return [value for row in rows if (value := self.get_run(str(row["id"]), session_id)) is not None]

    def seed_skill(self, name: str, description: str, version: str, content: str, sha256: str) -> None:
        """Insert the configured initial version without changing an existing active version."""
        now = utc_now()
        with self.transaction() as connection:
            connection.execute(
                "INSERT OR IGNORE INTO skills(name, description, active_version, updated_at) VALUES (?, ?, ?, ?)",
                (name, description, version, now),
            )
            connection.execute(
                "INSERT OR IGNORE INTO skill_versions(skill_name, version, content, hash, published_at) VALUES (?, ?, ?, ?, ?)",
                (name, version, content, sha256, now),
            )

    def active_skill_snapshots(self) -> list[dict[str, str]]:
        """Return exact identities for all active published runtime Skills."""
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT s.name, s.active_version, v.hash FROM skills s
                   JOIN skill_versions v ON v.skill_name = s.name AND v.version = s.active_version ORDER BY s.name"""
            ).fetchall()
        return [{"name": row["name"], "version": row["active_version"], "sha256": row["hash"]} for row in rows]

    def list_skills(self, session_id: str) -> list[dict[str, Any]]:
        """List active Skills merged with only the caller Session's Draft metadata."""
        with self._connect() as connection:
            rows = connection.execute(
                """SELECT s.*, v.hash AS published_hash, d.hash AS draft_hash, d.updated_at AS draft_updated_at
                   FROM skills s JOIN skill_versions v ON v.skill_name = s.name AND v.version = s.active_version
                   LEFT JOIN skill_drafts d ON d.skill_name = s.name AND d.session_id = ? ORDER BY s.name""",
                (session_id,),
            ).fetchall()
        return [{
            "name": row["name"], "description": row["description"], "active_version": row["active_version"],
            "published_version": row["active_version"], "published_hash": row["published_hash"],
            "draft_hash": row["draft_hash"], "draft_status": "draft" if row["draft_hash"] else "published",
            "updated_at": row["draft_updated_at"] or row["updated_at"],
        } for row in rows]

    def get_skill(self, name: str, session_id: str) -> dict[str, Any] | None:
        """Return active content and the caller Session's optional Draft."""
        with self._connect() as connection:
            row = connection.execute(
                """SELECT s.*, v.content AS published_content, v.hash AS published_hash, v.published_at,
                          d.content AS draft_content, d.hash AS draft_hash, d.validation_json, d.updated_at AS draft_updated_at
                   FROM skills s JOIN skill_versions v ON v.skill_name = s.name AND v.version = s.active_version
                   LEFT JOIN skill_drafts d ON d.skill_name = s.name AND d.session_id = ? WHERE s.name = ?""",
                (session_id, name),
            ).fetchone()
        if row is None:
            return None
        return {
            "name": row["name"], "description": row["description"], "active_version": row["active_version"],
            "published_version": row["active_version"], "published_hash": row["published_hash"],
            "published_content": row["published_content"], "published_at": row["published_at"],
            "draft_hash": row["draft_hash"], "draft_content": row["draft_content"],
            "draft_status": "draft" if row["draft_hash"] else "published",
            "validation": self._loads(row["validation_json"]),
            "updated_at": row["draft_updated_at"] or row["updated_at"],
        }

    def save_skill_draft(self, name: str, session_id: str, content: str, sha256: str) -> dict[str, Any]:
        """Upsert one Session-private Draft and clear its prior validation result."""
        now = utc_now()
        with self.transaction() as connection:
            if connection.execute("SELECT 1 FROM skills WHERE name = ?", (name,)).fetchone() is None:
                raise ModelingContractError("SKILL_NOT_FOUND", "Skill not found.")
            connection.execute(
                """INSERT INTO skill_drafts(session_id, skill_name, content, hash, validation_json, updated_at)
                   VALUES (?, ?, ?, ?, NULL, ?)
                   ON CONFLICT(session_id, skill_name) DO UPDATE SET content=excluded.content, hash=excluded.hash,
                   validation_json=NULL, updated_at=excluded.updated_at""",
                (session_id, name, content, sha256, now),
            )
        value = self.get_skill(name, session_id)
        assert value is not None
        return value

    def get_skill_draft(self, name: str, session_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM skill_drafts WHERE skill_name = ? AND session_id = ?", (name, session_id),
            ).fetchone()
        return None if row is None else {"content": row["content"], "hash": row["hash"], "validation": self._loads(row["validation_json"])}

    def set_skill_validation(self, name: str, session_id: str, result: dict[str, Any]) -> None:
        with self.transaction() as connection:
            connection.execute(
                "UPDATE skill_drafts SET validation_json = ?, updated_at = ? WHERE skill_name = ? AND session_id = ?",
                (self._json(result), utc_now(), name, session_id),
            )

    def next_skill_version(self, name: str) -> str:
        """Return the next major demo version while preserving a suffix such as -demo."""
        with self._connect() as connection:
            row = connection.execute("SELECT active_version FROM skills WHERE name = ?", (name,)).fetchone()
        if row is None:
            raise ModelingContractError("SKILL_NOT_FOUND", "Skill not found.")
        current = str(row["active_version"])
        match = re.match(r"^(\d+)\.(\d+)\.(\d+)(.*)$", current)
        return f"{match.group(1)}.{int(match.group(2)) + 1}.0{match.group(4)}" if match else f"{current}.2"

    def publish_skill(self, name: str, session_id: str, version: str, content: str, sha256: str, description: str) -> None:
        """Insert one immutable version, activate it, and consume only the publisher's Draft."""
        now = utc_now()
        with self.transaction() as connection:
            try:
                connection.execute(
                    "INSERT INTO skill_versions(skill_name, version, content, hash, published_at) VALUES (?, ?, ?, ?, ?)",
                    (name, version, content, sha256, now),
                )
            except sqlite3.IntegrityError as error:
                raise ModelingContractError("SKILL_VERSION_CONFLICT", "Published Skill versions are immutable.") from error
            connection.execute(
                "UPDATE skills SET description = ?, active_version = ?, updated_at = ? WHERE name = ?",
                (description, version, now, name),
            )
            connection.execute("DELETE FROM skill_drafts WHERE skill_name = ? AND session_id = ?", (name, session_id))

    def get_run_result(self, run_id: str, session_id: str) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
        run = self.get_run(run_id, session_id)
        if run is None:
            return None
        with self._connect() as connection:
            rows = connection.execute("SELECT * FROM artifacts WHERE run_id = ? AND session_id = ? AND completed = 1 ORDER BY created_at", (run_id, session_id)).fetchall()
        return run, [self._artifact(row) for row in rows]

    def get_artifact(self, artifact_id: str, session_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM artifacts WHERE id = ? AND session_id = ? AND completed = 1", (artifact_id, session_id)).fetchone()
        return None if row is None else self._artifact(row)

    def _artifact(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"], "run_id": row["run_id"], "kind": row["kind"], "storage_key": row["storage_key"],
            "sha256": row["sha256"], "size_bytes": row["size_bytes"], "media_type": row["media_type"],
            "completed": bool(row["completed"]), "created_at": row["created_at"],
        }

    def mark_orphaned_runs_interrupted(self) -> int:
        with self.transaction() as connection:
            rows = connection.execute("SELECT id FROM runs WHERE status IN ('running', 'cancelling')").fetchall()
            now = utc_now()
            for row in rows:
                connection.execute(
                    "UPDATE runs SET status = 'interrupted', revision = revision + 1, worker_pid = NULL, error_json = ?, completed_at = ?, updated_at = ? WHERE id = ?",
                    (self._json({"code": "SERVICE_RESTART", "message": "The service restarted before the worker completed."}), now, now, row["id"]),
                )
                connection.execute("UPDATE run_nodes SET status = 'interrupted' WHERE run_id = ? AND status = 'running'", (row["id"],))
                connection.execute("UPDATE run_nodes SET status = 'blocked' WHERE run_id = ? AND status = 'pending'", (row["id"],))
                seq = connection.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM run_events WHERE run_id = ?", (row["id"],)).fetchone()[0]
                connection.execute(
                    "INSERT INTO run_events(run_id, seq, node_id, type, payload_json, occurred_at) VALUES (?, ?, NULL, 'run.interrupted', ?, ?)",
                    (row["id"], seq, self._json({"error": {"code": "SERVICE_RESTART", "message": "The service restarted before the worker completed."}}), now),
                )
            return len(rows)

    def insert_test_run(self, run_id: str, session_id: str, status: str) -> None:
        """Insert a lifecycle fixture without manufacturing an application endpoint."""
        now = utc_now()
        with self.transaction() as connection:
            connection.execute(
                "INSERT INTO runs(id, session_id, status, revision, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
                (run_id, session_id, status, now, now),
            )
