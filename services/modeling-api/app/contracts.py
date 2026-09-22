"""Validated modeling records shared by the API and deterministic worker."""

from __future__ import annotations

import hashlib
import json
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


Sha256 = str
ScalarLabel = str | int | float | bool


class ModelingContractError(ValueError):
    """A stable modeling error that callers may map to the documented error body."""

    def __init__(self, code: str, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


class StrictModel(BaseModel):
    """Base model that rejects fields outside the versioned JSON contract."""

    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


SkillId = Literal[
    "data-analysis",
    "data-cleaning",
    "feature-engineering",
    "model-training",
    "model-evaluation",
]


class DataCleaningSkillConfig(StrictModel):
    """User preferences interpreted by the data-cleaning Skill."""

    missing_strategy: Literal["auto", "mean", "median", "mode", "keep"] = Field(alias="missingStrategy")
    outlier_strategy: Literal["auto", "keep", "iqr", "mad", "winsorize"] = Field(alias="outlierStrategy")


class FeatureEngineeringSkillConfig(StrictModel):
    """User preferences interpreted by the feature-engineering Skill."""

    feature_generation: bool = Field(alias="featureGeneration")
    feature_selection: bool = Field(alias="featureSelection")
    selection_method: Literal["auto", "mutual_information", "variance", "correlation"] = Field(alias="selectionMethod")
    top_k: int = Field(alias="topK", ge=1, le=10_000)


class ModelTrainingSkillConfig(StrictModel):
    """Requested training algorithm before executor capability validation."""

    algorithm: Literal["logistic_regression", "lightgbm", "xgboost"]


class ModelEvaluationSkillConfig(StrictModel):
    """Evaluation preferences supported by the deterministic worker."""

    metrics: Literal["auto"]
    threshold: float = Field(ge=0, le=1)


class SkillConfigs(StrictModel):
    """Preferences for configurable runtime Skills, independent of enablement."""

    data_cleaning: DataCleaningSkillConfig = Field(alias="data-cleaning")
    feature_engineering: FeatureEngineeringSkillConfig = Field(alias="feature-engineering")
    model_training: ModelTrainingSkillConfig = Field(alias="model-training")
    model_evaluation: ModelEvaluationSkillConfig = Field(alias="model-evaluation")


class ProfileEvidence(StrictModel):
    """Identity of the dataset profile reused by downstream Skills."""

    dataset_sha256: str = Field(alias="datasetSha256", pattern=r"^[a-f0-9]{64}$")
    row_count: int = Field(alias="rowCount", ge=0)
    target: str | None


class TaskContext(StrictModel):
    """Lightweight Skill orchestration state persisted with a plan revision."""

    schema_version: Literal["1.0"] = Field(alias="schemaVersion")
    dataset_id: str = Field(alias="datasetId", pattern=r"^ds_[A-Za-z0-9_-]+$")
    target: str | None
    task_type: Literal["prepare_dataset", "binary_classification", "regression", "time_series"] = Field(alias="taskType")
    skill_sequence: list[SkillId] = Field(alias="skillSequence", min_length=2, max_length=5)
    skill_configs: SkillConfigs = Field(alias="skillConfigs")
    profile_evidence: ProfileEvidence = Field(alias="profileEvidence")
    decisions: dict[SkillId, dict[str, Any]]

    @model_validator(mode="after")
    def validate_sequence(self) -> "TaskContext":
        """Enforce the minimal linear ordering and decision completeness rules."""
        sequence = self.skill_sequence
        if len(sequence) != len(set(sequence)):
            raise ValueError("skillSequence cannot contain duplicate Skills")
        if sequence[0] != "data-analysis":
            raise ValueError("data-analysis must be the first Skill")
        if "model-training" not in sequence:
            raise ValueError("model-training must be enabled")
        if "model-evaluation" in sequence and sequence.index("model-evaluation") < sequence.index("model-training"):
            raise ValueError("model-evaluation must follow model-training")
        if set(self.decisions) != set(sequence):
            raise ValueError("decisions must contain exactly the enabled Skills")
        return self


class SplitSpec(StrictModel):
    """Deterministic train, validation, and test split parameters."""

    method: Literal["random", "stratified_random"]
    train_ratio: float = Field(gt=0, lt=1)
    validation_ratio: float = Field(gt=0, lt=1)
    test_ratio: float = Field(gt=0, lt=1)
    seed: int = Field(ge=0, le=2_147_483_647)


class PreprocessingSpec(StrictModel):
    """Whitelisted preprocessing operations and their bounds."""

    numeric_missing: Literal["median", "constant"]
    numeric_constant: float
    scale_numeric: bool
    categorical_missing_value: str = Field(min_length=1, max_length=64)
    categorical_encoding: Literal["onehot_limited"]
    onehot_max_categories: int = Field(ge=2, le=256)


class DateFeatureSpec(StrictModel):
    """Whitelisted date-derived features."""

    enabled: bool
    columns: list[str]
    components: list[Literal["month", "dayofweek"]] = Field(min_length=1)


class FeatureEngineeringSpec(StrictModel):
    """Feature engineering configuration."""

    date_features: DateFeatureSpec


class LogisticRegressionParams(StrictModel):
    """Bounded logistic regression parameters."""

    C: float = Field(gt=0, le=100)
    max_iter: int = Field(ge=50, le=1000)


class ModelSpec(StrictModel):
    """The single model supported by the P0 pipeline."""

    name: Literal["logistic_regression"]
    params: LogisticRegressionParams


class ResourceLimits(StrictModel):
    """Caller-visible limits capped by the service."""

    max_train_seconds: int = Field(ge=10, le=300)
    max_run_seconds: int = Field(ge=30, le=1800)
    max_output_features: int = Field(ge=10, le=10000)


class DataAssumptions(StrictModel):
    """User-confirmed assumptions required by the P0 random split."""

    samples_independent: bool


class ModelingPlan(StrictModel):
    """A candidate plan that never carries approval or execution authority."""

    schema_version: Literal["1.0"]
    dataset_id: str = Field(pattern=r"^ds_[A-Za-z0-9_-]+$")
    dataset_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    mode: Literal["prepare_dataset", "binary_classification"]
    target: str | None
    positive_label: ScalarLabel | None
    excluded_columns: list[str]
    split: SplitSpec
    preprocessing: PreprocessingSpec
    feature_engineering: FeatureEngineeringSpec
    models: list[ModelSpec] = Field(max_length=1)
    limits: ResourceLimits
    assumptions: DataAssumptions
    task_context: TaskContext | None = None

    @model_validator(mode="after")
    def validate_mode(self) -> "ModelingPlan":
        """Enforce mode-dependent fields that JSON field constraints cannot express."""
        if self.mode == "binary_classification":
            if self.target is None or self.target == "":
                raise ValueError("binary classification requires a target")
            if self.positive_label is None:
                raise ValueError("binary classification requires positive_label")
            if self.split.method != "stratified_random":
                raise ValueError("binary classification requires stratified_random")
            if len(self.models) != 1:
                raise ValueError("binary classification requires one model")
        elif self.models:
            raise ValueError("prepare_dataset does not accept models")
        if self.target is None:
            if self.positive_label is not None or self.split.method != "random":
                raise ValueError("an unlabeled plan requires a random split and null positive_label")
        if self.task_context is not None:
            context = self.task_context
            if context.dataset_id != self.dataset_id or context.target != self.target or context.task_type != self.mode:
                raise ValueError("task_context identity must match the plan")
            if context.profile_evidence.dataset_sha256 != self.dataset_sha256:
                raise ValueError("task_context profile evidence must match the plan dataset")
            if context.profile_evidence.target != self.target:
                raise ValueError("task_context profile evidence target must match the plan")
        return self


class DatasetState(str, Enum):
    """Dataset lifecycle states."""

    UPLOADED = "uploaded"
    PROFILING = "profiling"
    READY = "ready"
    ERROR = "error"


class PlanState(str, Enum):
    """Immutable plan revision lifecycle states."""

    DRAFT = "draft"
    PROPOSED = "proposed"
    APPROVED = "approved"
    SUPERSEDED = "superseded"


class RunStatus(str, Enum):
    """Run lifecycle states."""

    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLING = "cancelling"
    CANCELLED = "cancelled"
    INTERRUPTED = "interrupted"


class NodeStatus(str, Enum):
    """Node lifecycle states exposed to clients."""

    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"
    CANCELLED = "cancelled"
    INTERRUPTED = "interrupted"
    BLOCKED = "blocked"


class DatasetRecord(StrictModel):
    """Dataset metadata owned by the modeling service."""

    id: str
    session_id: str
    original_name: str
    sha256: str
    size_bytes: int = Field(ge=0)
    storage_key: str
    state: DatasetState


class PlanRecord(StrictModel):
    """One immutable plan revision and its content hash."""

    id: str
    revision: int = Field(ge=1)
    state: PlanState
    plan: ModelingPlan
    plan_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class ApprovalRequest(StrictModel):
    """A human-originated approval reference, never a model tool argument."""

    revision: int = Field(ge=1)
    plan_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class NodeRecord(StrictModel):
    """One persisted node state within a run."""

    id: str
    status: NodeStatus
    duration_ms: int | None = Field(default=None, ge=0)


class ArtifactRecord(StrictModel):
    """A completed artifact identified without exposing a host path."""

    id: str
    run_id: str
    kind: str
    storage_key: str
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    size_bytes: int = Field(ge=0)
    media_type: str
    completed: bool


class RunRecord(StrictModel):
    """A persisted modeling run snapshot."""

    id: str
    session_id: str
    plan_id: str
    plan_revision: int = Field(ge=1)
    status: RunStatus
    revision: int = Field(ge=1)
    nodes: list[NodeRecord]
    artifacts: list[ArtifactRecord]


RUN_TRANSITIONS: dict[RunStatus, frozenset[RunStatus]] = {
    RunStatus.QUEUED: frozenset({RunStatus.RUNNING, RunStatus.CANCELLED}),
    RunStatus.RUNNING: frozenset({RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLING, RunStatus.INTERRUPTED}),
    RunStatus.CANCELLING: frozenset({RunStatus.CANCELLED, RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.INTERRUPTED}),
    RunStatus.SUCCEEDED: frozenset(),
    RunStatus.FAILED: frozenset(),
    RunStatus.CANCELLED: frozenset(),
    RunStatus.INTERRUPTED: frozenset(),
}

PIPELINE_STAGES = ("Validate", "Split", "Preprocess", "Feature", "Train", "Evaluate", "Result")


def plan_invalidation(previous: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    """Describe semantic downstream invalidation while reporting the uncached execution scope honestly."""
    if previous.get("task_context") != current.get("task_context"):
        requested = list(PIPELINE_STAGES)
        reason = "skill_orchestration"
    elif previous.get("dataset_id") != current.get("dataset_id") or previous.get("target") != current.get("target"):
        requested = list(PIPELINE_STAGES)
        reason = "target_or_dataset"
    elif previous.get("split") != current.get("split"):
        requested = list(PIPELINE_STAGES[1:])
        reason = "split"
    elif previous.get("preprocessing") != current.get("preprocessing"):
        requested = list(PIPELINE_STAGES[2:])
        reason = "cleaning"
    elif previous.get("feature_engineering") != current.get("feature_engineering") or previous.get("excluded_columns") != current.get("excluded_columns"):
        requested = list(PIPELINE_STAGES[3:])
        reason = "feature"
    elif previous.get("models") != current.get("models"):
        requested = list(PIPELINE_STAGES[4:])
        reason = "model_parameters"
    elif previous.get("limits") != current.get("limits"):
        requested = list(PIPELINE_STAGES)
        reason = "resource_limits"
    else:
        requested = []
        reason = "none"
    return {
        "reason": reason,
        "invalidated_stages": requested,
        "execution_stages": list(PIPELINE_STAGES),
        "cache_reused": False,
        "note": "The current worker has no safe stage cache and recomputes the full pipeline.",
    }


def canonical_plan_hash(plan: ModelingPlan) -> Sha256:
    """Return the SHA-256 digest of the plan's canonical JSON representation."""
    encoded = json.dumps(plan.model_dump(mode="json", by_alias=True), ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _validation_code(error: ValidationError) -> str:
    locations = [tuple(item["loc"]) for item in error.errors()]
    if any("categorical_encoding" in location or "date_features" in location for location in locations):
        return "UNKNOWN_OPERATOR"
    if any("models" in location for location in locations):
        return "INVALID_MODEL_PARAMETERS"
    return "INVALID_PLAN"


def validate_plan_payload(
    payload: dict[str, Any],
    *,
    columns: set[str],
    label_values: set[ScalarLabel],
    expected_dataset_sha256: str,
) -> ModelingPlan:
    """Parse a candidate plan and enforce dataset-dependent semantic rules."""
    try:
        plan = ModelingPlan.model_validate(payload)
    except ValidationError as error:
        raise ModelingContractError(_validation_code(error), "Plan validation failed.", details={"errors": error.errors(include_url=False)}) from error
    if plan.dataset_sha256 != expected_dataset_sha256:
        raise ModelingContractError("DATASET_VERSION_CONFLICT", "The dataset hash does not match the selected dataset.")
    if plan.task_context is not None:
        algorithm = plan.task_context.skill_configs.model_training.algorithm
        if algorithm != "logistic_regression":
            raise ModelingContractError(
                "UNSUPPORTED_ALGORITHM",
                f"The deterministic worker does not support {algorithm}.",
                details={"algorithm": algorithm, "supported": ["logistic_regression"]},
            )
        if plan.mode == "binary_classification" and plan.models[0].name != algorithm:
            raise ModelingContractError("INVALID_TASK_CONTEXT", "The TaskContext algorithm does not match the executable plan.")
        if plan.task_context.skill_configs.model_evaluation.threshold != 0.5:
            raise ModelingContractError("UNSUPPORTED_EVALUATION_THRESHOLD", "The deterministic worker currently evaluates threshold 0.5 only.")
    unknown = sorted(set(plan.excluded_columns) - columns)
    if plan.target is not None and plan.target not in columns:
        unknown.append(plan.target)
    unknown.extend(column for column in plan.feature_engineering.date_features.columns if column not in columns)
    if unknown:
        raise ModelingContractError("UNKNOWN_COLUMN", "The plan references columns that do not exist.", details={"columns": sorted(set(unknown))})
    if plan.target is not None and (
        plan.target in plan.excluded_columns
        or plan.target in plan.feature_engineering.date_features.columns
    ):
        raise ModelingContractError("TARGET_LEAKAGE", "The target cannot appear in excluded or feature columns.")
    if plan.feature_engineering.date_features.enabled:
        raise ModelingContractError(
            "UNKNOWN_OPERATOR",
            "The current deterministic Worker does not support date-derived features. Disable date_features and create a new plan revision.",
        )
    if abs(plan.split.train_ratio + plan.split.validation_ratio + plan.split.test_ratio - 1.0) > 1e-9:
        raise ModelingContractError("INVALID_SPLIT", "Train, validation, and test ratios must sum to 1.")
    if not plan.assumptions.samples_independent:
        raise ModelingContractError("UNSUPPORTED_SPLIT_ASSUMPTION", "P0 random splitting requires independently sampled rows.")
    if plan.mode == "binary_classification":
        if len(label_values) != 2 or None in label_values:
            raise ModelingContractError("INVALID_LABELS", "Binary classification requires exactly two non-null labels.")
        if plan.positive_label not in label_values:
            raise ModelingContractError("INVALID_POSITIVE_LABEL", "positive_label is not present in the dataset labels.")
    return plan


def validate_approval(record: PlanRecord, request: ApprovalRequest) -> PlanRecord:
    """Validate a human approval reference without starting or persisting a run."""
    if record.state != PlanState.PROPOSED:
        raise ModelingContractError("INVALID_PLAN_STATE", "Only a proposed plan can be approved.")
    if request.revision != record.revision:
        raise ModelingContractError("PLAN_REVISION_CONFLICT", "The approval revision is not current.")
    if request.plan_hash != record.plan_hash:
        raise ModelingContractError("PLAN_HASH_MISMATCH", "The approval hash does not match the current plan.")
    return record


def validate_run_transition(current: str | RunStatus, requested: str | RunStatus) -> str:
    """Return an allowed next status or raise a stable transition error."""
    try:
        current_status = RunStatus(current)
        requested_status = RunStatus(requested)
    except ValueError as error:
        raise ModelingContractError("INVALID_STATE", "Unknown run status.") from error
    if requested_status not in RUN_TRANSITIONS[current_status]:
        raise ModelingContractError(
            "INVALID_STATE_TRANSITION",
            f"Run status cannot move from {current_status.value} to {requested_status.value}.",
        )
    return requested_status.value
