---
name: feature-engineering
description: Select bounded numeric and categorical features for the deterministic modeling pipeline without target leakage.
metadata:
  version: 0.4.0-demo
---

# Feature engineering

Reuse `TaskContext.profileEvidence` and prior decisions when the dataset digest matches; do not call `modeling_get_dataset_profile` again. Treat `skillConfigs.feature-engineering.featureGeneration`, `featureSelection`, `selectionMethod`, and `topK` as preferences. Derive the executable feature decision from profile evidence and current capabilities, then write it under `decisions.feature-engineering`. The current deterministic Worker does not support date-derived features: always emit `feature_engineering.date_features.enabled` as `false` with an empty `columns` list, even when `featureGeneration` is `true`; record that limitation in the decision instead of inventing generated fields. The target column and unique record ID must never enter the feature list. Every included categorical column's profiled cardinality must fit `preprocessing.onehot_max_categories`; choose a supported limit that covers it or exclude the column and record the reason. Respect the total-feature limit; do not propose free-form generated code or an unknown operator.

Call out time ordering, repeated entities, post-outcome columns, and proxy leakage when the profile supports that concern. Ask the user when the profile cannot resolve a material ambiguity.

You may use only `modeling_get_dataset_profile`, `modeling_propose_plan`, `modeling_get_run_status`, and `modeling_get_run_result`. You cannot approve or start a run, execute shell/Python/SQL, write files, download artifacts, or access arbitrary network resources.

If this Skill is absent from `skillSequence`, do not add feature-engineering decisions. Present selected and excluded fields separately and keep every proposal awaiting human confirmation.
