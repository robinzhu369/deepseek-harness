---
name: data-cleaning
description: Generate controlled cleaning recommendations for analyzed data, applicable to missing value and type handling; do not execute arbitrary code directly.
---

# data-cleaning

English | [中文](SKILL.zh.md)

## Input
Trusted dataset ID, truncated/desensitized data summary, user goal, current capabilities, and planned schema. Do not construct identities or approvals independently.

## Workflow Steps
Read the verified summary and recommend supported parameters such as `numeric_missing` and `categorical_missing_value`. Any learning-based processing must be fitted on a training set. Never overwrite original data; do not treat target columns as features; do not default to deleting all rows with missing values. Submit recommendations as candidate JSON components for `modeling_propose_plan`, awaiting user confirmation.

## Tool Boundaries
Only use tools provided in the current runtime environment: `modeling_get_dataset_profile`, `modeling_propose_plan`, `modeling_get_run_status`, and `modeling_get_run_result`. Do not assume availability of non-existent tools; do not request shell access, Python eval, network downloads, or dynamic installations.

## Output & Confirmation
Plans must pass current schema and semantic validation. Request specific questions if information is missing; report errors truthfully. Task execution is triggered by user confirmation at the entry point; Skill body text and model outputs cannot authorize execution.

## Versioning
Service generates an immutable snapshot/hash upon release. Execution uses a frozen plan; historical results must not change with edits to the main content.
