from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from app.contracts import (
    ApprovalRequest,
    ModelingContractError,
    PlanRecord,
    PlanState,
    TaskContext,
    canonical_plan_hash,
    plan_invalidation,
    validate_approval,
    validate_plan_payload,
    validate_run_transition,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
EXAMPLE = REPO_ROOT / "docs/modeling-demo/contracts/examples/valid-classification-plan.json"
SCHEMA = REPO_ROOT / "docs/modeling-demo/contracts/modeling-plan.schema.json"


def valid_payload() -> dict[str, object]:
    payload = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    payload["assumptions"] = {"samples_independent": True}
    return payload


def valid_task_context() -> dict[str, object]:
    return {
        "schemaVersion": "1.0",
        "datasetId": "ds_example",
        "target": "label",
        "taskType": "binary_classification",
        "skillSequence": [
            "data-analysis", "data-cleaning", "feature-engineering", "model-training", "model-evaluation",
        ],
        "skillConfigs": {
            "data-cleaning": {"missingStrategy": "auto", "outlierStrategy": "auto"},
            "feature-engineering": {
                "featureGeneration": True, "featureSelection": True, "selectionMethod": "auto", "topK": 100,
            },
            "model-training": {"algorithm": "logistic_regression"},
            "model-evaluation": {"metrics": "auto", "threshold": 0.5},
        },
        "profileEvidence": {"datasetSha256": "a" * 64, "rowCount": 100, "target": "label"},
        "decisions": {
            "data-analysis": {"targetConfirmed": True},
            "data-cleaning": {"numericMissing": "median"},
            "feature-engineering": {"generated": []},
            "model-training": {"algorithm": "logistic_regression"},
            "model-evaluation": {"metrics": ["roc_auc", "f1"]},
        },
    }


def assert_contract_error(code: str, payload: dict[str, object]) -> None:
    with pytest.raises(ModelingContractError) as caught:
        validate_plan_payload(
            payload,
            columns={"record_id", "age", "income", "region", "label"},
            label_values={0, 1},
            expected_dataset_sha256="a" * 64,
        )
    assert caught.value.code == code


def test_json_schema_and_pydantic_require_the_same_top_level_fields() -> None:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    payload = valid_payload()
    Draft202012Validator(schema).validate(payload)
    from app.contracts import ModelingPlan

    required_model_fields = {name for name, field in ModelingPlan.model_fields.items() if field.is_required()}
    assert set(schema["required"]) == required_model_fields


def test_accepts_task_context_and_preserves_camel_case_extension_fields() -> None:
    payload = valid_payload()
    payload["task_context"] = valid_task_context()
    plan = validate_plan_payload(
        payload,
        columns={"record_id", "age", "income", "region", "label"},
        label_values={0, 1},
        expected_dataset_sha256="a" * 64,
    )
    dumped = plan.model_dump(mode="json", by_alias=True)
    assert dumped["task_context"]["skillSequence"][-1] == "model-evaluation"
    assert dumped["task_context"]["skillConfigs"]["model-training"]["algorithm"] == "logistic_regression"


def test_rejects_profile_evidence_for_a_different_target() -> None:
    payload = valid_payload()
    context = valid_task_context()
    context["profileEvidence"]["target"] = "outcome"
    payload["task_context"] = context
    assert_contract_error("INVALID_PLAN", payload)


@pytest.mark.parametrize(
    ("sequence", "decisions"),
    [
        (["model-training", "data-analysis"], ["model-training", "data-analysis"]),
        (["data-analysis", "model-evaluation"], ["data-analysis", "model-evaluation"]),
        (["data-analysis", "model-evaluation", "model-training"], ["data-analysis", "model-evaluation", "model-training"]),
        (["data-analysis", "model-training", "model-training"], ["data-analysis", "model-training"]),
    ],
)
def test_rejects_invalid_skill_sequences(sequence: list[str], decisions: list[str]) -> None:
    payload = valid_payload()
    context = valid_task_context()
    context["skillSequence"] = sequence
    context["decisions"] = {name: {} for name in decisions}
    payload["task_context"] = context
    assert_contract_error("INVALID_PLAN", payload)


def test_rejects_worker_unsupported_algorithm_but_keeps_future_task_types_structural() -> None:
    context = valid_task_context()
    context["taskType"] = "regression"
    assert TaskContext.model_validate(context).task_type == "regression"

    payload = valid_payload()
    context = valid_task_context()
    context["skillConfigs"]["model-training"]["algorithm"] = "lightgbm"
    context["decisions"]["model-training"]["algorithm"] = "lightgbm"
    payload["task_context"] = context
    assert_contract_error("UNSUPPORTED_ALGORITHM", payload)


def test_task_context_change_invalidates_the_full_pipeline_and_hash() -> None:
    baseline = valid_payload()
    baseline["task_context"] = valid_task_context()
    changed = copy.deepcopy(baseline)
    changed["task_context"]["skillConfigs"]["data-cleaning"]["missingStrategy"] = "median"
    invalidation = plan_invalidation(baseline, changed)
    assert invalidation["reason"] == "skill_orchestration"
    assert invalidation["invalidated_stages"] == ["Validate", "Split", "Preprocess", "Feature", "Train", "Evaluate", "Result"]

    first = validate_plan_payload(baseline, columns={"record_id", "age", "income", "region", "label"}, label_values={0, 1}, expected_dataset_sha256="a" * 64)
    changed["task_context"]["decisions"]["data-cleaning"] = {"numericMissing": "median"}
    second = validate_plan_payload(changed, columns={"record_id", "age", "income", "region", "label"}, label_values={0, 1}, expected_dataset_sha256="a" * 64)
    assert canonical_plan_hash(first) != canonical_plan_hash(second)


def test_rejects_unknown_top_level_field() -> None:
    payload = valid_payload()
    payload["code"] = "print('not allowed')"
    assert_contract_error("INVALID_PLAN", payload)


def test_rejects_unknown_column() -> None:
    payload = valid_payload()
    payload["excluded_columns"] = ["record_id", "missing_column"]
    assert_contract_error("UNKNOWN_COLUMN", payload)


def test_rejects_target_leakage() -> None:
    payload = valid_payload()
    payload["excluded_columns"] = ["record_id", "label"]
    assert_contract_error("TARGET_LEAKAGE", payload)


def test_rejects_target_as_a_date_feature() -> None:
    payload = valid_payload()
    feature_engineering = copy.deepcopy(payload["feature_engineering"])
    assert isinstance(feature_engineering, dict)
    feature_engineering["date_features"] = {
        "enabled": True,
        "columns": ["label"],
        "components": ["month"],
    }
    payload["feature_engineering"] = feature_engineering
    assert_contract_error("TARGET_LEAKAGE", payload)


def test_rejects_date_features_before_execution() -> None:
    payload = valid_payload()
    feature_engineering = copy.deepcopy(payload["feature_engineering"])
    assert isinstance(feature_engineering, dict)
    feature_engineering["date_features"] = {
        "enabled": True,
        "columns": ["age"],
        "components": ["month"],
    }
    payload["feature_engineering"] = feature_engineering
    assert_contract_error("UNKNOWN_OPERATOR", payload)


def test_rejects_invalid_split_ratios() -> None:
    payload = valid_payload()
    payload["split"] = {
        "method": "stratified_random",
        "train_ratio": 0.7,
        "validation_ratio": 0.2,
        "test_ratio": 0.2,
        "seed": 42,
    }
    assert_contract_error("INVALID_SPLIT", payload)


def test_rejects_unknown_operator() -> None:
    payload = valid_payload()
    preprocessing = copy.deepcopy(payload["preprocessing"])
    assert isinstance(preprocessing, dict)
    preprocessing["categorical_encoding"] = "target_encoding"
    payload["preprocessing"] = preprocessing
    assert_contract_error("UNKNOWN_OPERATOR", payload)


def test_rejects_illegal_model_parameters() -> None:
    payload = valid_payload()
    payload["models"] = [{"name": "logistic_regression", "params": {"C": 0, "max_iter": 20}}]
    assert_contract_error("INVALID_MODEL_PARAMETERS", payload)


def test_rejects_unconfirmed_independence_assumption() -> None:
    payload = valid_payload()
    payload["assumptions"] = {"samples_independent": False}
    assert_contract_error("UNSUPPORTED_SPLIT_ASSUMPTION", payload)


def test_plan_invalidation_rules_cover_each_edit_surface() -> None:
    baseline = valid_payload()
    cases = [
        ("models", [{"name": "logistic_regression", "params": {"C": 0.5, "max_iter": 500}}], "model_parameters", ["Train", "Evaluate", "Result"]),
        ("feature_engineering", {"date_features": {"enabled": True, "columns": ["age"], "components": ["month"]}}, "feature", ["Feature", "Train", "Evaluate", "Result"]),
        ("preprocessing", {"numeric_missing": "mean", "categorical_missing_value": "missing", "categorical_encoding": "onehot_limited", "scale_numeric": True, "onehot_max_categories": 16}, "cleaning", ["Preprocess", "Feature", "Train", "Evaluate", "Result"]),
        ("split", {"method": "stratified_random", "train_ratio": 0.7, "validation_ratio": 0.15, "test_ratio": 0.15, "seed": 42}, "split", ["Split", "Preprocess", "Feature", "Train", "Evaluate", "Result"]),
        ("target", "region", "target_or_dataset", ["Validate", "Split", "Preprocess", "Feature", "Train", "Evaluate", "Result"]),
        ("dataset_id", "ds_changed", "target_or_dataset", ["Validate", "Split", "Preprocess", "Feature", "Train", "Evaluate", "Result"]),
        ("limits", {"max_train_seconds": 30, "max_run_seconds": 60, "max_output_features": 500}, "resource_limits", ["Validate", "Split", "Preprocess", "Feature", "Train", "Evaluate", "Result"]),
    ]
    for field, changed_value, reason, stages in cases:
        changed = copy.deepcopy(baseline)
        changed[field] = changed_value
        invalidation = plan_invalidation(baseline, changed)
        assert invalidation["reason"] == reason
        assert invalidation["invalidated_stages"] == stages
        assert invalidation["execution_stages"] == ["Validate", "Split", "Preprocess", "Feature", "Train", "Evaluate", "Result"]
        assert invalidation["cache_reused"] is False


def test_rejects_approval_fields_in_candidate_plan() -> None:
    payload = valid_payload()
    payload["approved"] = True
    assert_contract_error("INVALID_PLAN", payload)


def test_approval_requires_current_revision_and_hash() -> None:
    plan = validate_plan_payload(
        valid_payload(),
        columns={"record_id", "age", "income", "region", "label"},
        label_values={0, 1},
        expected_dataset_sha256="a" * 64,
    )
    record = PlanRecord(
        id="plan_example",
        revision=2,
        state=PlanState.PROPOSED,
        plan=plan,
        plan_hash=canonical_plan_hash(plan),
    )

    with pytest.raises(ModelingContractError, match="revision") as revision_error:
        validate_approval(record, ApprovalRequest(revision=1, plan_hash=record.plan_hash))
    assert revision_error.value.code == "PLAN_REVISION_CONFLICT"

    with pytest.raises(ModelingContractError, match="hash") as hash_error:
        validate_approval(record, ApprovalRequest(revision=2, plan_hash="0" * 64))
    assert hash_error.value.code == "PLAN_HASH_MISMATCH"


def test_run_state_transitions_are_closed() -> None:
    assert validate_run_transition("queued", "running") == "running"
    assert validate_run_transition("running", "succeeded") == "succeeded"
    with pytest.raises(ModelingContractError) as caught:
        validate_run_transition("succeeded", "running")
    assert caught.value.code == "INVALID_STATE_TRANSITION"
