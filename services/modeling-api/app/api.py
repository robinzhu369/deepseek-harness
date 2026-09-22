"""Private FastAPI surface for dataset and deterministic modeling lifecycles."""

from __future__ import annotations

import hashlib
import json
import uuid
from contextlib import asynccontextmanager
from typing import Any, Annotated

import polars as pl
from fastapi import Body, FastAPI, File, Header, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .config import ServiceConfig
from .contracts import ApprovalRequest, ModelingContractError, canonical_plan_hash, validate_plan_payload
from .database import ModelingStore
from .datasets import DatasetService
from .runs import RunService, WorkerCommandFactory
from .skills import SkillService, digest


SessionHeader = Annotated[str, Header(alias="X-Session-Id", min_length=1, max_length=128)]
SkillSnapshotsHeader = Annotated[str | None, Header(alias="X-Modeling-Skill-Snapshots", max_length=4096)]


def _skill_snapshots(value: str | None) -> list[dict[str, str]] | None:
    """Validate the Host-computed runtime Skill identities carried internally."""
    if value is None:
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as error:
        raise ModelingContractError("INVALID_SKILL_SNAPSHOTS", "Skill snapshots must be valid JSON.") from error
    if not isinstance(parsed, list) or len(parsed) > 5:
        raise ModelingContractError("INVALID_SKILL_SNAPSHOTS", "Skill snapshots must be a list of at most five entries.")
    snapshots: list[dict[str, str]] = []
    for item in parsed:
        if not isinstance(item, dict) or set(item) != {"name", "version", "sha256"}:
            raise ModelingContractError("INVALID_SKILL_SNAPSHOTS", "Each Skill snapshot requires only name, version, and sha256.")
        name, version, sha256 = item.get("name"), item.get("version"), item.get("sha256")
        if not isinstance(name, str) or not name or not isinstance(version, str) or not version:
            raise ModelingContractError("INVALID_SKILL_SNAPSHOTS", "Skill snapshot names and versions must be non-empty strings.")
        if not isinstance(sha256, str) or len(sha256) != 64 or any(character not in "0123456789abcdef" for character in sha256):
            raise ModelingContractError("INVALID_SKILL_SNAPSHOTS", "Skill snapshot sha256 values must be lowercase hexadecimal digests.")
        snapshots.append({"name": name, "version": version, "sha256": sha256})
    if len({item["name"] for item in snapshots}) != len(snapshots):
        raise ModelingContractError("INVALID_SKILL_SNAPSHOTS", "Skill snapshot names must be unique.")
    return snapshots


class PlanUpdateRequest(BaseModel):
    """An optimistic update over one immutable plan revision."""

    model_config = ConfigDict(extra="forbid")
    base_revision: int = Field(ge=0)
    plan: dict[str, Any]


class SkillDraftRequest(BaseModel):
    """Session-private Skill Draft content."""

    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1, max_length=131_072)


def _error_status(code: str) -> int:
    if code == "UPLOAD_TOO_LARGE":
        return 413
    if code.endswith("NOT_FOUND"):
        return 404
    if code == "RUN_CAPACITY":
        return 429
    if code in {
        "PLAN_REVISION_CONFLICT", "PLAN_HASH_MISMATCH", "INVALID_PLAN_STATE",
        "IDEMPOTENCY_CONFLICT", "DATASET_VERSION_CONFLICT", "DATASET_NOT_READY",
        "RUN_NOT_SUCCEEDED", "DATASET_CONFLICT", "SKILL_VERSION_CONFLICT",
        "INVALID_RERUN_SOURCE",
    }:
        return 409
    return 422


def _error_body(error: ModelingContractError) -> dict[str, Any]:
    return {
        "error": {
            "code": error.code,
            "message": error.message,
            "retryable": False,
            "details": error.details,
            "request_id": f"req_{uuid.uuid4().hex}",
        }
    }


def _public_dataset(dataset: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in dataset.items() if key not in {"session_id", "profile"}}


def create_app(
    config: ServiceConfig,
    *,
    worker_command_factory: WorkerCommandFactory | None = None,
    start_workers: bool = True,
) -> FastAPI:
    """Create one isolated modeling API with explicit storage and worker limits."""
    config.root.mkdir(parents=True, exist_ok=True)
    store = ModelingStore(config.database_path)
    store.initialize()
    skills = SkillService(config, store)
    skills.initialize()
    datasets = DatasetService(config, store)
    runs = RunService(config, store, worker_command_factory)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        store.mark_orphaned_runs_interrupted()
        datasets.recover()
        try:
            yield
        finally:
            runs.shutdown()
            datasets.shutdown()

    app = FastAPI(title="ModelX Modeling API", version="0.1.0", lifespan=lifespan)
    app.state.store = store
    app.state.datasets = datasets
    app.state.runs = runs
    app.state.skills = skills

    @app.exception_handler(ModelingContractError)
    async def contract_error(_request: Request, error: ModelingContractError) -> JSONResponse:
        return JSONResponse(status_code=_error_status(error.code), content=_error_body(error))

    @app.exception_handler(RequestValidationError)
    async def request_error(_request: Request, error: RequestValidationError) -> JSONResponse:
        wrapped = ModelingContractError("INVALID_REQUEST", "Request validation failed.", details={"errors": error.errors()})
        return JSONResponse(status_code=422, content=_error_body(wrapped))

    def require_dataset(dataset_id: str, session_id: str) -> dict[str, Any]:
        dataset = store.get_dataset(dataset_id, session_id)
        if dataset is None:
            raise ModelingContractError("DATASET_NOT_FOUND", "Dataset not found.")
        return dataset

    def validated_plan(payload: dict[str, Any], session_id: str):
        dataset_id = payload.get("dataset_id")
        if not isinstance(dataset_id, str):
            raise ModelingContractError("INVALID_PLAN", "A dataset_id is required.")
        dataset = require_dataset(dataset_id, session_id)
        if dataset["state"] != "ready" or dataset["profile"] is None:
            raise ModelingContractError("DATASET_NOT_READY", "The dataset profile is not ready.")
        target = payload.get("target")
        labels: set[Any] = set()
        if isinstance(target, str) and target in {item["name"] for item in dataset["profile"]["schema"]}:
            path = config.root / dataset["storage_key"]
            labels = set(pl.scan_csv(path).select(pl.col(target).drop_nulls().unique()).head(3).collect().get_column(target).to_list())
        return validate_plan_payload(
            payload,
            columns={item["name"] for item in dataset["profile"]["schema"]},
            label_values=labels,
            expected_dataset_sha256=dataset["sha256"],
        )

    @app.post("/v1/datasets", status_code=202)
    async def upload_dataset(session_id: SessionHeader, file: Annotated[UploadFile, File()]) -> dict[str, Any]:
        dataset = await datasets.ingest(session_id, file)
        return {**_public_dataset(dataset), "dataset_id": dataset["id"]}

    @app.get("/v1/datasets")
    async def list_datasets(session_id: SessionHeader) -> dict[str, Any]:
        return {"items": [_public_dataset(item) for item in store.list_datasets(session_id)]}

    @app.get("/v1/datasets/{dataset_id}")
    async def get_dataset(dataset_id: str, session_id: SessionHeader) -> dict[str, Any]:
        return _public_dataset(require_dataset(dataset_id, session_id))

    @app.get("/v1/datasets/{dataset_id}/profile")
    async def get_profile(dataset_id: str, session_id: SessionHeader) -> dict[str, Any]:
        dataset = require_dataset(dataset_id, session_id)
        if dataset["state"] != "ready" or dataset["profile"] is None:
            raise ModelingContractError("DATASET_NOT_READY", "The dataset profile is not ready.")
        return {
            "dataset_id": dataset["id"],
            "dataset_sha256": dataset["sha256"],
            **dataset["profile"],
        }

    @app.get("/v1/datasets/{dataset_id}/preview")
    async def get_preview(
        dataset_id: str,
        session_id: SessionHeader,
        limit: int = Query(default=20, ge=1, le=config.preview_limit),
    ) -> dict[str, Any]:
        dataset = require_dataset(dataset_id, session_id)
        if dataset["state"] != "ready":
            raise ModelingContractError("DATASET_NOT_READY", "The dataset profile is not ready.")
        return {"dataset_id": dataset_id, "limit": limit, "rows": datasets.preview(dataset, limit)}

    @app.get("/v1/workspace")
    async def get_workspace(session_id: SessionHeader) -> dict[str, Any]:
        """Return the bounded latest modeling state used to restore one browser Session."""
        dataset = next(iter(store.list_datasets(session_id)), None)
        plan = store.latest_plan(session_id)
        run = store.latest_run(session_id)
        public_dataset = None if dataset is None else {
            **{key: value for key, value in _public_dataset(dataset).items() if key != "storage_key"},
            "dataset_id": dataset["id"],
            "profile": dataset["profile"],
        }
        public_plan = None if plan is None else {
            key: value for key, value in plan.items() if key != "session_id"
        }
        public_run = None if run is None else {
            key: value for key, value in run.items()
            if key not in {"session_id", "worker_pid", "result"}
        }
        result = None
        if run is not None and run["status"] == "succeeded" and run["result"] is not None:
            result = {
                "metrics": run["result"].get("metrics"),
                "diagnostics": run["result"].get("diagnostics", []),
                "recommendations": run["result"].get("recommendations", []),
                "feature_summary": run["result"].get("feature_summary"),
                "artifacts": run["artifacts"],
                "warnings": run["result"].get("warnings", []),
            }
        history = []
        for item in store.list_runs(session_id):
            history.append({
                "id": item["id"], "plan_revision": item["plan_revision"], "status": item["status"],
                "created_at": item["created_at"], "completed_at": item["completed_at"],
                "rerun_of": item["rerun_of"],
                "metrics": None if item["result"] is None else item["result"].get("metrics"),
            })
        return {"dataset": public_dataset, "plan": public_plan, "run": public_run, "result": result, "runs": history}

    @app.get("/v1/capabilities")
    async def get_capabilities(_session_id: SessionHeader) -> dict[str, Any]:
        """Return the executor-owned plan choices used by the controlled form."""
        return {
            "models": {"logistic_regression": {"C": {"min": 0.000001, "max": 100}, "max_iter": {"min": 50, "max": 1000}}},
            "model_options": [
                {"name": "logistic_regression", "supported": True},
                {"name": "lightgbm", "supported": False},
                {"name": "xgboost", "supported": False},
            ],
            "skill_config": {
                "missing_strategy": ["auto", "median"],
                "outlier_strategy": ["auto", "keep"],
                "feature_generation": [True, False],
                "feature_selection": [True, False],
                "evaluation_metrics": ["auto"],
                "evaluation_threshold": [0.5],
            },
            "numeric_missing": ["median", "constant"],
            "categorical_encoding": ["onehot_limited"],
            "date_features_supported": False,
            "date_components": [],
            "split_methods": ["stratified_random"],
            "limits": {
                "max_train_seconds": {"min": 10, "max": 300},
                "max_run_seconds": {"min": 30, "max": 1800},
                "max_output_features": {"min": 10, "max": 10000},
                "onehot_max_categories": {"min": 2, "max": 256},
            },
        }

    @app.get("/v1/skills")
    async def list_skills(session_id: SessionHeader) -> dict[str, Any]:
        return {"items": store.list_skills(session_id)}

    @app.get("/v1/skills/{name}")
    async def get_skill(name: str, session_id: SessionHeader) -> dict[str, Any]:
        return skills.detail(name, session_id)

    @app.put("/v1/skills/{name}/draft")
    async def save_skill_draft(name: str, session_id: SessionHeader, request: SkillDraftRequest) -> dict[str, Any]:
        skills.require_name(name)
        store.save_skill_draft(name, session_id, request.content, digest(request.content))
        return skills.detail(name, session_id)

    @app.post("/v1/skills/{name}/validate")
    async def validate_skill(name: str, session_id: SessionHeader) -> dict[str, Any]:
        return skills.validate(name, session_id)

    @app.post("/v1/skills/{name}/publish")
    async def publish_skill(name: str, session_id: SessionHeader) -> dict[str, Any]:
        return skills.publish(name, session_id)

    @app.post("/v1/plans", status_code=201)
    async def create_plan(
        session_id: SessionHeader,
        payload: Annotated[dict[str, Any], Body()],
        skill_snapshots: SkillSnapshotsHeader = None,
    ) -> dict[str, Any]:
        plan = validated_plan(payload, session_id)
        return store.create_plan(
            session_id, plan.dataset_id, plan.dataset_sha256, plan.model_dump(mode="json", by_alias=True),
            canonical_plan_hash(plan), _skill_snapshots(skill_snapshots) or store.active_skill_snapshots(),
        )

    @app.put("/v1/plans/{plan_id}")
    async def update_plan(
        plan_id: str,
        session_id: SessionHeader,
        request: PlanUpdateRequest,
        skill_snapshots: SkillSnapshotsHeader = None,
    ) -> dict[str, Any]:
        plan = validated_plan(request.plan, session_id)
        return store.update_plan(
            plan_id, session_id, request.base_revision, plan.dataset_id, plan.dataset_sha256,
            plan.model_dump(mode="json", by_alias=True), canonical_plan_hash(plan), _skill_snapshots(skill_snapshots),
        )

    @app.get("/v1/plans/{plan_id}")
    async def get_plan(plan_id: str, session_id: SessionHeader, revision: int | None = Query(default=None, ge=1)) -> dict[str, Any]:
        plan = store.get_plan(plan_id, session_id, revision)
        if plan is None:
            raise ModelingContractError("PLAN_NOT_FOUND", "Plan not found.")
        return plan

    @app.post("/v1/plans/{plan_id}/approve-and-run", status_code=202)
    async def approve_and_run(
        plan_id: str,
        session_id: SessionHeader,
        request: ApprovalRequest,
        idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=200)],
    ) -> dict[str, Any]:
        request_hash = hashlib.sha256(json.dumps(request.model_dump(mode="json"), sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        run_id, created = store.approve_and_create_run(
            plan_id=plan_id,
            session_id=session_id,
            revision=request.revision,
            plan_hash=request.plan_hash,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
        )
        if created and start_workers:
            runs.schedule(run_id)
        return {"run_id": run_id, "created": created}

    @app.get("/v1/runs/{run_id}")
    async def get_run(run_id: str, session_id: SessionHeader) -> dict[str, Any]:
        run = store.get_run(run_id, session_id)
        if run is None:
            raise ModelingContractError("RUN_NOT_FOUND", "Run not found.")
        return run

    @app.post("/v1/runs/{run_id}/rerun", status_code=202)
    async def rerun(
        run_id: str,
        session_id: SessionHeader,
        request: ApprovalRequest,
        idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=200)],
    ) -> dict[str, Any]:
        source = store.get_run(run_id, session_id)
        if source is None:
            raise ModelingContractError("RUN_NOT_FOUND", "Source Run not found.")
        body = request.model_dump(mode="json")
        request_hash = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        next_run_id, created = store.approve_and_create_run(
            plan_id=source["plan_id"], session_id=session_id, revision=request.revision,
            plan_hash=request.plan_hash, idempotency_key=idempotency_key,
            request_hash=request_hash, rerun_of=run_id,
        )
        if created and start_workers:
            runs.schedule(next_run_id)
        return {"run_id": next_run_id, "created": created, "rerun_of": run_id}

    @app.post("/v1/runs/{run_id}/cancel")
    async def cancel_run(run_id: str, session_id: SessionHeader) -> dict[str, Any]:
        return runs.cancel(run_id, session_id)

    @app.get("/v1/runs/{run_id}/result")
    async def get_result(run_id: str, session_id: SessionHeader) -> dict[str, Any]:
        value = store.get_run_result(run_id, session_id)
        if value is None:
            raise ModelingContractError("RUN_NOT_FOUND", "Run not found.")
        run, artifacts = value
        if run["status"] != "succeeded" or run["result"] is None:
            raise ModelingContractError("RUN_NOT_SUCCEEDED", "Run results are available only after success.")
        return {**run["result"], "artifacts": artifacts}

    @app.get("/v1/artifacts/{artifact_id}/download")
    async def download_artifact(artifact_id: str, session_id: SessionHeader) -> FileResponse:
        artifact = store.get_artifact(artifact_id, session_id)
        if artifact is None:
            raise ModelingContractError("ARTIFACT_NOT_FOUND", "Artifact not found.")
        root = config.root.resolve()
        path = (root / artifact["storage_key"]).resolve()
        try:
            path.relative_to(root)
        except ValueError as error:
            raise ModelingContractError("ARTIFACT_NOT_FOUND", "Artifact not found.") from error
        if not path.is_file() or ".partial" in path.name:
            raise ModelingContractError("ARTIFACT_NOT_FOUND", "Artifact not found.")
        return FileResponse(path, media_type=artifact["media_type"], filename=path.name)

    return app


__all__ = ["ServiceConfig", "create_app"]
