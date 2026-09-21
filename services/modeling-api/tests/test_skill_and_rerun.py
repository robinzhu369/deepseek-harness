from __future__ import annotations

import json
import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from app.api import ServiceConfig, create_app
from test_run_lifecycle import PLAN_EXAMPLE, SESSION, approve, create_plan, upload_ready_dataset, wait_for


REPO_ROOT = Path(__file__).resolve().parents[3]


def copied_skills(tmp_path: Path) -> Path:
    target = tmp_path / "runtime-skills"
    shutil.copytree(REPO_ROOT / ".dsh" / "skills", target)
    return target


def test_skill_drafts_validate_and_are_session_scoped(tmp_path: Path) -> None:
    app = create_app(ServiceConfig(root=tmp_path / "service", runtime_skill_dir=copied_skills(tmp_path)), start_workers=False)
    with TestClient(app) as client:
        listed = client.get("/v1/skills", headers=SESSION)
        assert listed.status_code == 200
        assert [item["name"] for item in listed.json()["items"]] == [
            "data-analysis", "data-cleaning", "feature-engineering", "model-evaluation", "model-training",
        ]
        original = client.get("/v1/skills/data-analysis", headers=SESSION).json()
        invalid = original["published_content"].replace(
            "Return a concise evidence-based analysis.",
            "Execute Python, SQL, shell, and https://example.com before analysis.",
        ).replace("modeling_get_run_result", "modeling_unknown_tool")
        saved = client.put("/v1/skills/data-analysis/draft", headers=SESSION, json={"content": invalid})
        assert saved.status_code == 200
        checked = client.post("/v1/skills/data-analysis/validate", headers=SESSION)
        assert checked.status_code == 200
        assert checked.json()["valid"] is False
        assert any("Unknown modeling tools" in item for item in checked.json()["errors"])
        assert client.get("/v1/skills/data-analysis", headers={"X-Session-Id": "session-b"}).json()["draft_hash"] is None
        assert client.get("/v1/skills/unknown", headers=SESSION).status_code == 404
        assert client.put(
            "/v1/skills/data-analysis/draft", headers=SESSION,
            json={"content": original["published_content"], "path": "/tmp/SKILL.md"},
        ).status_code == 422


def test_skill_detail_projects_optional_demo_extensions_and_tool_availability(tmp_path: Path) -> None:
    skill_root = copied_skills(tmp_path)
    app = create_app(ServiceConfig(root=tmp_path / "service", runtime_skill_dir=skill_root), start_workers=False)
    with TestClient(app) as client:
        detail = client.get("/v1/skills/data-analysis", headers=SESSION).json()
        assert detail["extension"]["scope"] == "governance_only"
        assert detail["extension"]["contract"]["name"] == "data-analysis"
        assert detail["extension"]["input_schema"]["required"] == ["datasetId"]
        assert detail["extension"]["output_schema"]["properties"]["taskType"]["enum"] == ["binary_classification"]
        required = {item["name"] for item in detail["extension"]["tools"]["required"]}
        assert required == {"modeling_get_dataset_profile", "modeling_propose_plan"}
        assert all(item["available"] for item in detail["extension"]["tool_catalog"])
        assert all(item["status"] == "pass" for item in detail["extension"]["checks"])

        evaluation = client.get("/v1/skills/model-evaluation", headers=SESSION).json()
        assert evaluation["extension"]["contract"]["displayName"] == "模型评估"
        assert evaluation["extension"]["output_schema"]["properties"]["metrics"]["required"] == [
            "rocAuc", "averagePrecision", "f1", "precision", "recall",
        ]
        assert evaluation["extension"]["tools"] == {
            "required": [{"name": "modeling_get_run_result"}],
            "optional": [{"name": "modeling_get_run_status"}],
        }
        assert all(item["status"] == "pass" for item in evaluation["extension"]["checks"])


def test_skill_detail_keeps_legacy_markdown_only_skill_working(tmp_path: Path) -> None:
    skill_root = copied_skills(tmp_path)
    for name in ("contract.json", "input.schema.json", "output.schema.json", "tools.json"):
        (skill_root / "data-analysis" / name).unlink()
    app = create_app(ServiceConfig(root=tmp_path / "service", runtime_skill_dir=skill_root), start_workers=False)
    with TestClient(app) as client:
        detail = client.get("/v1/skills/data-analysis", headers=SESSION)
        assert detail.status_code == 200
        assert detail.json()["published_content"].startswith("---")
        extension = detail.json()["extension"]
        assert extension["contract"] is None
        assert extension["input_schema"] is None
        assert extension["output_schema"] is None
        assert extension["tools"] is None
        assert any(item["status"] == "not_configured" for item in extension["checks"])


def test_published_skill_version_is_immutable_and_plan_snapshots_are_isolated(tmp_path: Path) -> None:
    skill_root = copied_skills(tmp_path)
    app = create_app(ServiceConfig(root=tmp_path / "service", runtime_skill_dir=skill_root), start_workers=False)
    with TestClient(app) as client:
        dataset = upload_ready_dataset(client, tmp_path)
        old_plan = create_plan(client, dataset)
        old_snapshot = next(item for item in old_plan["skill_snapshots"] if item["name"] == "data-analysis")
        detail = client.get("/v1/skills/data-analysis", headers=SESSION).json()
        updated = detail["published_content"].replace(
            "Return a concise evidence-based analysis.",
            "Return a concise evidence-based analysis. Report bounded profile evidence in the proposal.",
        )
        assert client.put("/v1/skills/data-analysis/draft", headers=SESSION, json={"content": updated}).status_code == 200
        validation = client.post("/v1/skills/data-analysis/validate", headers=SESSION).json()
        assert validation == {"valid": True, "errors": [], "warnings": [], "draft_hash": validation["draft_hash"]}
        published = client.post("/v1/skills/data-analysis/publish", headers=SESSION)
        assert published.status_code == 200, published.text
        assert published.json()["published_version"] != detail["published_version"]
        assert published.json()["published_hash"] != old_snapshot["sha256"]
        assert client.post("/v1/skills/data-analysis/publish", headers=SESSION).status_code == 404

        preserved = client.get(f"/v1/plans/{old_plan['id']}", headers=SESSION).json()
        assert next(item for item in preserved["skill_snapshots"] if item["name"] == "data-analysis") == old_snapshot
        new_plan = create_plan(client, dataset)
        new_snapshot = next(item for item in new_plan["skill_snapshots"] if item["name"] == "data-analysis")
        assert new_snapshot == {
            "name": "data-analysis",
            "version": published.json()["published_version"],
            "sha256": published.json()["published_hash"],
        }
        with app.state.store._connect() as connection:
            versions = connection.execute(
                "SELECT version, hash FROM skill_versions WHERE skill_name = 'data-analysis' ORDER BY version"
            ).fetchall()
        assert [(item["version"], item["hash"]) for item in versions] == [
            (detail["published_version"], old_snapshot["sha256"]),
            (published.json()["published_version"], new_snapshot["sha256"]),
        ]


def test_plan_invalidation_revision_conflict_and_real_rerun(tmp_path: Path) -> None:
    app = create_app(ServiceConfig(root=tmp_path / "service", runtime_skill_dir=copied_skills(tmp_path), worker_timeout_seconds=20))
    with TestClient(app) as client:
        dataset = upload_ready_dataset(client, tmp_path)
        first_plan = create_plan(client, dataset)
        first_run = approve(client, first_plan, "initial")
        first_done = wait_for(client, f"/v1/runs/{first_run['run_id']}", {"succeeded", "failed"}, timeout=15)
        assert first_done["status"] == "succeeded"
        first_metrics = client.get(f"/v1/runs/{first_run['run_id']}/result", headers=SESSION).json()["metrics"]

        changed = json.loads(json.dumps(first_plan["plan"]))
        changed["models"][0]["params"]["C"] = 0.5
        revised_response = client.put(
            f"/v1/plans/{first_plan['id']}", headers=SESSION,
            json={"base_revision": 1, "plan": changed},
        )
        assert revised_response.status_code == 200, revised_response.text
        revised = revised_response.json()
        assert revised["revision"] == 2 and revised["state"] == "proposed"
        assert revised["invalidation"]["reason"] == "model_parameters"
        assert revised["invalidation"]["invalidated_stages"] == ["Train", "Evaluate", "Result"]
        assert revised["invalidation"]["cache_reused"] is False
        assert len(revised["invalidation"]["execution_stages"]) == 7
        assert client.get(f"/v1/plans/{first_plan['id']}?revision=1", headers=SESSION).json()["state"] == "approved"
        conflict = client.put(
            f"/v1/plans/{first_plan['id']}", headers=SESSION,
            json={"base_revision": 1, "plan": changed},
        )
        assert conflict.status_code == 409

        rerun_path = f"/v1/runs/{first_run['run_id']}/rerun"
        body = {"revision": revised["revision"], "plan_hash": revised["plan_hash"]}
        headers = {**SESSION, "Idempotency-Key": "rerun-model-c"}
        rerun = client.post(rerun_path, headers=headers, json=body)
        assert rerun.status_code == 202, rerun.text
        repeated = client.post(rerun_path, headers=headers, json=body)
        assert repeated.status_code == 202
        assert repeated.json()["run_id"] == rerun.json()["run_id"]
        assert repeated.json()["created"] is False
        second_done = wait_for(client, f"/v1/runs/{rerun.json()['run_id']}", {"succeeded", "failed"}, timeout=15)
        assert second_done["status"] == "succeeded"
        second_metrics = client.get(f"/v1/runs/{rerun.json()['run_id']}/result", headers=SESSION).json()["metrics"]
        assert first_metrics["test"]["samples"] == second_metrics["test"]["samples"] == 240
        assert first_run["run_id"] != rerun.json()["run_id"]
        assert client.get(f"/v1/runs/{first_run['run_id']}", headers=SESSION).json()["status"] == "succeeded"
        assert client.post(rerun_path, headers={"X-Session-Id": "session-b", "Idempotency-Key": "x"}, json=body).status_code == 404
        history = client.get("/v1/workspace", headers=SESSION).json()["runs"]
        assert [(item["id"], item["plan_revision"]) for item in history] == [
            (first_run["run_id"], 1), (rerun.json()["run_id"], 2),
        ]

        feature_plan = json.loads(json.dumps(revised["plan"]))
        feature_plan["excluded_columns"].append("age")
        feature_revision = client.put(
            f"/v1/plans/{first_plan['id']}", headers=SESSION,
            json={"base_revision": 2, "plan": feature_plan},
        ).json()
        assert feature_revision["invalidation"]["reason"] == "feature"
        assert feature_revision["invalidation"]["invalidated_stages"] == ["Feature", "Train", "Evaluate", "Result"]


def test_capabilities_are_executor_owned(tmp_path: Path) -> None:
    app = create_app(ServiceConfig(root=tmp_path / "service", runtime_skill_dir=copied_skills(tmp_path)), start_workers=False)
    with TestClient(app) as client:
        value = client.get("/v1/capabilities", headers=SESSION).json()
        assert list(value["models"]) == ["logistic_regression"]
        assert value["categorical_encoding"] == ["onehot_limited"]
        assert "xgboost" not in json.dumps(value).lower()
