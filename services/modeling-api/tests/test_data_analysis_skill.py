"""Validate authored quality-assessment examples, not live model performance."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, ValidationError

from app.skills import parse_skill


ROOT = Path(__file__).resolve().parents[3]
SKILL = ROOT / ".dsh/skills/data-analysis"
SCHEMA = json.loads((SKILL / "output.schema.json").read_text())
CASES = json.loads((Path(__file__).parent / "fixtures/data-analysis-evals.json").read_text())["cases"]


def test_quality_skill_passes_publisher_validation_and_matches_metadata() -> None:
    metadata, errors, _warnings = parse_skill((SKILL / "SKILL.md").read_text(), "data-analysis", 131_072)
    assert errors == []
    contract = json.loads((SKILL / "contract.json").read_text())
    assert metadata["metadata"]["version"] == contract["version"]
    assert "plan_proposed" not in contract["postconditions"]
    Draft202012Validator.check_schema(SCHEMA)


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_authored_assessments_accept_supported_and_blocked_outcomes(case: dict) -> None:
    Draft202012Validator(SCHEMA).validate(case["expectedAssessment"])
    assert case["behaviorChecks"]


@pytest.mark.parametrize(
    ("field", "value"),
    [("target", None), ("targetConfirmed", False), ("positiveLabel", None),
     ("independenceConfirmed", False), ("questions", ["Which target?"]),
     ("taskType", "regression"), ("approved", True)],
)
def test_ready_assessment_rejects_missing_confirmations_and_extra_authority(field: str, value: object) -> None:
    assessment = copy.deepcopy(CASES[0]["expectedAssessment"])
    assessment[field] = value
    with pytest.raises(ValidationError):
        Draft202012Validator(SCHEMA).validate(assessment)


def test_ready_assessment_cannot_hide_a_blocker() -> None:
    assessment = copy.deepcopy(CASES[0]["expectedAssessment"])
    assessment["findings"][0]["severity"] = "blocker"
    with pytest.raises(ValidationError):
        Draft202012Validator(SCHEMA).validate(assessment)


def test_findings_require_evidence_and_confirmation_requires_a_question() -> None:
    assessment = copy.deepcopy(CASES[0]["expectedAssessment"])
    assessment["findings"][0]["evidence"] = []
    with pytest.raises(ValidationError):
        Draft202012Validator(SCHEMA).validate(assessment)
    assessment = copy.deepcopy(CASES[2]["expectedAssessment"])
    assessment["questions"] = []
    with pytest.raises(ValidationError):
        Draft202012Validator(SCHEMA).validate(assessment)
