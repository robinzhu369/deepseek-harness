from __future__ import annotations

import io
import json
import os
import sys
import time
from pathlib import Path
from typing import Callable

import pytest
from fastapi.testclient import TestClient

from app.api import ServiceConfig, create_app
from app.pipeline import generate_synthetic_csv


SESSION_ID = "session_runs"
SESSION = {"X-Session-Id": SESSION_ID}
REPO_ROOT = Path(__file__).resolve().parents[3]
PLAN_EXAMPLE = REPO_ROOT / "docs/modeling-demo/contracts/examples/valid-classification-plan.json"


def wait_for(client: TestClient, path: str, statuses: set[str], timeout: float = 8) -> dict[str, object]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        response = client.get(path, headers=SESSION)
        assert response.status_code == 200, response.text
        payload = response.json()
        if payload["status"] in statuses:
            return payload
        time.sleep(0.01)
    raise AssertionError(f"{path} did not reach {statuses}")


def upload_ready_dataset(client: TestClient, tmp_path: Path) -> dict[str, object]:
    source = tmp_path / "synthetic-source.csv"
    if not source.exists():
        generate_synthetic_csv(source, rows=1200, seed=20260920)
    content = source.read_bytes()
    uploaded = client.post("/v1/datasets", headers=SESSION, files={"file": ("synthetic.csv", io.BytesIO(content), "text/csv")})
    assert uploaded.status_code == 202, uploaded.text
    dataset_id = uploaded.json()["dataset_id"]
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        dataset = client.get(f"/v1/datasets/{dataset_id}", headers=SESSION).json()
        if dataset["state"] == "ready":
            return dataset
        time.sleep(0.01)
    raise AssertionError("profile did not complete")


def create_plan(client: TestClient, dataset: dict[str, object]) -> dict[str, object]:
    plan = json.loads(PLAN_EXAMPLE.read_text(encoding="utf-8"))
    plan["dataset_id"] = dataset["id"]
    plan["dataset_sha256"] = dataset["sha256"]
    plan["assumptions"] = {"samples_independent": True}
    response = client.post("/v1/plans", headers=SESSION, json=plan)
    assert response.status_code == 201, response.text
    return response.json()


def approve(client: TestClient, plan: dict[str, object], key: str = "idem-1") -> dict[str, object]:
    response = client.post(
        f"/v1/plans/{plan['id']}/approve-and-run",
        headers={**SESSION, "Idempotency-Key": key},
        json={"revision": plan["revision"], "plan_hash": plan["plan_hash"]},
    )
    assert response.status_code == 202, response.text
    return response.json()


def blocking_worker(tmp_path: Path, *, exit_code: int = 0) -> Callable[[str, Path], list[str]]:
    script = tmp_path / f"worker-{exit_code}.py"
    script.write_text(
        "import json, os, signal, sys, time\n"
        "print(json.dumps({'type':'run.started','node_id':None,'payload':{'pid':os.getpid()}}), flush=True)\n"
        "print(json.dumps({'type':'node.started','node_id':'pipeline','payload':{}}), flush=True)\n"
        "time.sleep(60)\n"
        f"raise SystemExit({exit_code})\n",
        encoding="utf-8",
    )
    return lambda _run_id, _input_path: [sys.executable, str(script)]


def node_failure_worker(tmp_path: Path) -> Callable[[str, Path], list[str]]:
    script = tmp_path / "worker-node-failure.py"
    script.write_text(
        "import json, os\n"
        "print(json.dumps({'type':'run.started','node_id':None,'payload':{'pid':os.getpid()}}), flush=True)\n"
        "print(json.dumps({'type':'node.started','node_id':'pipeline','payload':{}}), flush=True)\n"
        "print(json.dumps({'type':'node.failed','node_id':'pipeline','payload':{'duration_ms':1,'error':{'code':'PIPELINE_REJECTED','message':'The pipeline rejected its input.'}}}), flush=True)\n"
        "raise SystemExit(1)\n",
        encoding="utf-8",
    )
    return lambda _run_id, _input_path: [sys.executable, str(script)]


def test_plan_revision_idempotency_real_worker_and_artifact_authorization(tmp_path: Path) -> None:
    app = create_app(ServiceConfig(root=tmp_path, worker_timeout_seconds=20))
    with TestClient(app) as client:
        dataset = upload_ready_dataset(client, tmp_path)
        plan = create_plan(client, dataset)
        assert plan["revision"] == 1
        assert plan["state"] == "proposed"
        conflict = client.put(f"/v1/plans/{plan['id']}", headers=SESSION, json={"base_revision": 0, "plan": plan["plan"]})
        assert conflict.status_code == 409
        missing_key = client.post(
            f"/v1/plans/{plan['id']}/approve-and-run",
            headers=SESSION,
            json={"revision": 1, "plan_hash": plan["plan_hash"]},
        )
        assert missing_key.status_code == 422
        first = approve(client, plan)
        repeated = approve(client, plan)
        assert repeated["run_id"] == first["run_id"]
        different = client.post(
            f"/v1/plans/{plan['id']}/approve-and-run",
            headers={**SESSION, "Idempotency-Key": "idem-1"},
            json={"revision": 99, "plan_hash": plan["plan_hash"]},
        )
        assert different.status_code == 409
        run = wait_for(client, f"/v1/runs/{first['run_id']}", {"succeeded", "failed"}, timeout=15)
        assert run["status"] == "succeeded", run
        assert any(event["type"] == "node.completed" for event in run["events"])
        result = client.get(f"/v1/runs/{first['run_id']}/result", headers=SESSION)
        assert result.status_code == 200
        assert result.json()["metrics"]["test"]["samples"] == 240
        assert 0 <= result.json()["metrics"]["test"]["precision"] <= 1
        assert 0 <= result.json()["metrics"]["test"]["recall"] <= 1
        assert result.json()["diagnostics"]
        assert result.json()["recommendations"]
        artifacts = result.json()["artifacts"]
        assert artifacts
        artifact_id = next(item["id"] for item in artifacts if item["kind"] == "metrics")
        download = client.get(f"/v1/artifacts/{artifact_id}/download", headers=SESSION)
        assert download.status_code == 200
        assert json.loads(download.content)["test"]["samples"] == 240
        assert client.get(f"/v1/artifacts/{artifact_id}/download", headers={"X-Session-Id": "other"}).status_code == 404
        workspace = client.get("/v1/workspace", headers=SESSION)
        assert workspace.status_code == 200
        restored = workspace.json()
        assert restored["dataset"]["dataset_id"] == dataset["id"]
        assert restored["dataset"]["profile"]["row_count"] == 1200
        assert restored["plan"]["id"] == plan["id"]
        assert restored["run"]["id"] == first["run_id"]
        assert restored["result"]["metrics"] == result.json()["metrics"]
        assert restored["result"]["diagnostics"] == result.json()["diagnostics"]
        assert restored["result"]["recommendations"] == result.json()["recommendations"]
        restored_artifacts = restored["result"]["artifacts"]
        assert {item["file_name"] for item in restored_artifacts} >= {"metrics.json", "train.parquet", "validation.parquet", "test.parquet"}
        assert {item["directory"] for item in restored_artifacts} == {f"runs/{first['run_id']}"}
        assert "session_id" not in json.dumps(restored)
        assert "worker_pid" not in json.dumps(restored)
        assert "storage_key" not in json.dumps(restored)
        refreshed = client.get(f"/v1/runs/{first['run_id']}", headers=SESSION).json()
        assert refreshed["revision"] == run["revision"]


def test_cancel_terminates_the_owned_process(tmp_path: Path) -> None:
    app = create_app(ServiceConfig(root=tmp_path), worker_command_factory=blocking_worker(tmp_path))
    with TestClient(app) as client:
        plan = create_plan(client, upload_ready_dataset(client, tmp_path))
        run = approve(client, plan, "cancel-key")
        running = wait_for(client, f"/v1/runs/{run['run_id']}", {"running"})
        worker_pid = running["worker_pid"]
        assert isinstance(worker_pid, int)
        cancelled = client.post(f"/v1/runs/{run['run_id']}/cancel", headers=SESSION)
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "cancelled"
        terminal = wait_for(client, f"/v1/runs/{run['run_id']}", {"cancelled"})
        assert terminal["worker_pid"] is None
        assert all(node["status"] != "succeeded" for node in terminal["nodes"])
        assert [event["type"] for event in terminal["events"]][-2:] == ["run.cancelling", "run.cancelled"]
        assert terminal["artifacts"] == []
        assert client.post(f"/v1/runs/{run['run_id']}/cancel", headers=SESSION).json()["status"] == "cancelled"
        with pytest.raises(ProcessLookupError):
            os.kill(worker_pid, 0)


def test_workspace_refresh_restores_proposed_queued_and_running_without_new_runs(tmp_path: Path) -> None:
    app = create_app(
        ServiceConfig(root=tmp_path), worker_command_factory=blocking_worker(tmp_path), start_workers=False,
    )
    with TestClient(app) as client:
        plan = create_plan(client, upload_ready_dataset(client, tmp_path))
        proposed = client.get("/v1/workspace", headers=SESSION).json()
        assert proposed["plan"]["state"] == "proposed"
        assert proposed["run"] is None and proposed["runs"] == []

        run = approve(client, plan, "refresh-key")
        for _index in range(3):
            queued = client.get("/v1/workspace", headers=SESSION).json()
            assert queued["run"]["status"] == "queued"
            assert queued["run"]["id"] == run["run_id"]
            assert len(queued["runs"]) == 1

        app.state.runs.schedule(run["run_id"])
        wait_for(client, f"/v1/runs/{run['run_id']}", {"running"})
        for _index in range(3):
            running = client.get("/v1/workspace", headers=SESSION).json()
            assert running["run"]["status"] == "running"
            assert len(running["runs"]) == 1
        client.post(f"/v1/runs/{run['run_id']}/cancel", headers=SESSION)


def test_timeout_and_single_concurrency(tmp_path: Path) -> None:
    app = create_app(
        ServiceConfig(root=tmp_path, worker_timeout_seconds=0.2),
        worker_command_factory=blocking_worker(tmp_path),
    )
    with TestClient(app) as client:
        dataset = upload_ready_dataset(client, tmp_path)
        first_plan = create_plan(client, dataset)
        first = approve(client, first_plan, "timeout-key")
        second_plan = create_plan(client, dataset)
        capacity = client.post(
            f"/v1/plans/{second_plan['id']}/approve-and-run",
            headers={**SESSION, "Idempotency-Key": "capacity-key"},
            json={"revision": second_plan["revision"], "plan_hash": second_plan["plan_hash"]},
        )
        assert capacity.status_code == 429
        failed = wait_for(client, f"/v1/runs/{first['run_id']}", {"failed"})
        assert failed["error"]["code"] == "RUN_TIMEOUT"
        assert failed["worker_pid"] is None


def test_worker_node_failure_is_exposed_as_the_run_error(tmp_path: Path) -> None:
    app = create_app(
        ServiceConfig(root=tmp_path),
        worker_command_factory=node_failure_worker(tmp_path),
    )
    with TestClient(app) as client:
        plan = create_plan(client, upload_ready_dataset(client, tmp_path))
        created = approve(client, plan, "node-failure-key")
        failed = wait_for(client, f"/v1/runs/{created['run_id']}", {"failed"})

        assert failed["error"] == {
            "code": "PIPELINE_REJECTED",
            "message": "The pipeline rejected its input.",
        }
        workspace = client.get("/v1/workspace", headers=SESSION).json()
        assert workspace["run"]["error"] == failed["error"]


def test_startup_marks_orphaned_runs_interrupted(tmp_path: Path) -> None:
    first_app = create_app(ServiceConfig(root=tmp_path), start_workers=False)
    with TestClient(first_app):
        first_app.state.store.insert_test_run("run_orphan", SESSION_ID, "running")
        first_app.state.store.insert_test_run("run_cancelling", SESSION_ID, "cancelling")
    second_app = create_app(ServiceConfig(root=tmp_path), start_workers=False)
    with TestClient(second_app) as client:
        first = client.get("/v1/runs/run_orphan", headers=SESSION).json()
        second = client.get("/v1/runs/run_cancelling", headers=SESSION).json()
        assert first["status"] == second["status"] == "interrupted"


def test_plan_records_host_skill_snapshots_without_starting_a_run(tmp_path: Path) -> None:
    app = create_app(ServiceConfig(root=tmp_path), start_workers=False)
    snapshots = [
        {"name": name, "version": "0.1.0-demo", "sha256": character * 64}
        for name, character in zip(
            ["data-analysis", "data-cleaning", "feature-engineering", "model-training", "model-evaluation"],
            "abcde",
        )
    ]
    with TestClient(app) as client:
        dataset = upload_ready_dataset(client, tmp_path)
        payload = json.loads(PLAN_EXAMPLE.read_text(encoding="utf-8"))
        payload["dataset_id"] = dataset["id"]
        payload["dataset_sha256"] = dataset["sha256"]
        payload["assumptions"] = {"samples_independent": True}
        response = client.post(
            "/v1/plans",
            headers={**SESSION, "X-Modeling-Skill-Snapshots": json.dumps(snapshots)},
            json=payload,
        )
        assert response.status_code == 201, response.text
        assert response.json()["skill_snapshots"] == snapshots
        assert response.json()["state"] == "proposed"
        with app.state.store._connect() as connection:
            assert connection.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 0


def test_plan_rejects_invalid_host_skill_snapshots(tmp_path: Path) -> None:
    app = create_app(ServiceConfig(root=tmp_path), start_workers=False)
    with TestClient(app) as client:
        dataset = upload_ready_dataset(client, tmp_path)
        payload = json.loads(PLAN_EXAMPLE.read_text(encoding="utf-8"))
        payload["dataset_id"] = dataset["id"]
        payload["dataset_sha256"] = dataset["sha256"]
        payload["assumptions"] = {"samples_independent": True}
        response = client.post(
            "/v1/plans",
            headers={**SESSION, "X-Modeling-Skill-Snapshots": '[{"name":"data-analysis"}]'},
            json=payload,
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "INVALID_SKILL_SNAPSHOTS"
        too_many = [
            {"name": f"skill-{index}", "version": "0.1.0", "sha256": "a" * 64}
            for index in range(6)
        ]
        response = client.post(
            "/v1/plans",
            headers={**SESSION, "X-Modeling-Skill-Snapshots": json.dumps(too_many)},
            json=payload,
        )
        assert response.status_code == 422
        assert response.json()["error"]["message"] == "Skill snapshots must be a list of at most five entries."


def test_dataset_and_run_reads_are_session_scoped(tmp_path: Path) -> None:
    app = create_app(ServiceConfig(root=tmp_path), start_workers=False)
    with TestClient(app) as client:
        dataset = upload_ready_dataset(client, tmp_path)
        assert client.get(
            f"/v1/datasets/{dataset['id']}/profile", headers={"X-Session-Id": "session-b"},
        ).status_code == 404
        plan = create_plan(client, dataset)
        run = approve(client, plan, "session-scope-key")
        assert client.get(
            f"/v1/runs/{run['run_id']}", headers={"X-Session-Id": "session-b"},
        ).status_code == 404
        other = client.get("/v1/workspace", headers={"X-Session-Id": "session-b"})
        assert other.status_code == 200
        assert other.json() == {"dataset": None, "plan": None, "run": None, "result": None, "runs": []}
