---
name: feature-engineering
description: Plan whitelist feature processing for single-table wide tables: restricted category encoding and optional date components; arbitrary SQL or complex detail aggregation is unsupported.
---

# feature-engineering

English | [中文](SKILL.zh.md)

## Input
Trusted dataset ID, truncated/desensitized data summary, user objectives, current capabilities, and planned schema. Do not construct identities or approvals independently.

## Workflow Steps
Verify business prediction timestamps against available fields. Exclude target variables, record IDs, and explicit post-event features; query for clarification on ambiguities. Set upper limits for category encoding with strategies for unknown categories; learn vocabularies only from the training set. Select date components strictly as declared in capabilities (month/dayofweek). Explicitly state limitations when transaction windows or multi-table aggregation are not implemented; do not output non-existent operators.

## Tool Boundaries
Only use tools provided by the current runtime environment: `modeling_get_dataset_profile`, `modeling_propose_plan`, `modeling_get_run_status`, and `modeling_get_run_result`. Do not assume availability of missing tools; do not request Shell access, Python eval, network downloads, or dynamic installations.

## Output & Confirmation
Plans must pass current schema and semantic validation. Raise specific questions for missing information and report errors truthfully. Task execution is triggered by user confirmation at the entry point; Skill body text and model outputs cannot be authorized for direct execution.

## Versioning
Service-generated immutable snapshots/hashes are produced upon release. Execution uses frozen plans; historical results must not change following edits to the main content.
