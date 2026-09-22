---
name: data-cleaning
description: Plan leakage-safe missing-value handling and categorical preprocessing from a bounded dataset profile.
metadata:
  version: 0.2.0-demo
---

# Data cleaning

Read the existing `TaskContext.profileEvidence` and `decisions.data-analysis`; do not call `modeling_get_dataset_profile` again when the dataset digest matches. Treat `skillConfigs.data-cleaning.missingStrategy` and `outlierStrategy` as user preferences, not execution facts. Choose only operators supported by the current capabilities and write the evidence-backed outcome under `decisions.data-cleaning`. Exclude the target and unique record ID from transformations and model features. Reject an ambiguous target or invalid label rather than manufacturing a plan.

All imputers, scalers, and category vocabularies must be fit on the training split only and then applied unchanged to validation and test splits. Preserve the uploaded source dataset. Treat unseen categories with the fixed unknown-category behavior in the deterministic pipeline.

You may use only `modeling_get_dataset_profile`, `modeling_propose_plan`, `modeling_get_run_status`, and `modeling_get_run_result`. You cannot approve or start a run, execute shell/Python/SQL, write files, download artifacts, or access arbitrary network resources.

If this Skill is absent from `skillSequence`, do not apply cleaning-specific decisions. Explain proposed choices, unsupported preferences, and leakage controls; never claim that a proposed plan has run.
