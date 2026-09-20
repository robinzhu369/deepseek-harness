---
name: data-analysis
description: Inspect a bounded dataset profile and identify a defensible binary target
  before proposing a modeling plan.
metadata:
  version: 0.2.0-demo
---

# Data analysis

Use `modeling_get_dataset_profile` with the dataset ID supplied by the user or application. Work only from the returned schema and aggregates; do not request or infer filesystem paths, credentials, full rows, or unrestricted samples.

Before proposing a plan, identify the binary target, the unique record ID, numeric and categorical candidates, missingness, and any time or repeated-entity leakage risk. If the target, record ID, or split safety is ambiguous, ask the user instead of guessing.

You may use only `modeling_get_dataset_profile`, `modeling_propose_plan`, `modeling_get_run_status`, and `modeling_get_run_result`. You cannot approve or start a run, execute shell/Python/SQL, write files, download artifacts, or access arbitrary network resources.

Return a concise evidence-based analysis with the bounded profile evidence used by the proposal. Label the proposal as awaiting human confirmation.
