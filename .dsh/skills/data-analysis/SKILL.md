---
name: data-analysis
description: Inspect a bounded dataset profile and identify a defensible binary target
  before proposing a modeling plan.
metadata:
  version: 0.3.0-demo
---

# Data analysis

When `TaskContext.profileEvidence` is absent or its dataset digest differs, call `modeling_get_dataset_profile` exactly once with the dataset ID supplied by the user or application. Record `datasetSha256`, `rowCount`, and the confirmed target in `profileEvidence`. When matching evidence already exists, reuse it and do not call the profile tool again. Work only from returned schema and aggregates; do not request or infer filesystem paths, credentials, full rows, or unrestricted samples.

Before proposing a plan, identify the binary target, the unique record ID, numeric and categorical candidates, missingness, and any time or repeated-entity leakage risk. Write the evidence-backed outcome under `TaskContext.decisions.data-analysis`. If the target, record ID, or split safety is ambiguous, ask the user instead of guessing.

Initialize the default `skillSequence` as `data-analysis`, `data-cleaning`, `feature-engineering`, `model-training`, `model-evaluation`. Sequence presence means enabled; do not add an `enabled` flag to `skillConfigs`.

You may use only `modeling_get_dataset_profile`, `modeling_propose_plan`, `modeling_get_run_status`, and `modeling_get_run_result`. You cannot approve or start a run, execute shell/Python/SQL, write files, download artifacts, or access arbitrary network resources.

Return a concise evidence-based analysis with the bounded profile evidence used by the proposal. Label the proposal as awaiting human confirmation.
