---
name: feature-engineering
description: Select bounded numeric and categorical features for the deterministic modeling pipeline without target leakage.
metadata:
  version: 0.1.0-demo
---

# Feature engineering

Derive candidate features only from the dataset profile. The target column and unique record ID must never enter the feature list. Respect the pipeline's category-cardinality and total-feature limits; do not propose free-form generated code or an unknown operator.

Call out time ordering, repeated entities, post-outcome columns, and proxy leakage when the profile supports that concern. Ask the user when the profile cannot resolve a material ambiguity.

You may use only `modeling_get_dataset_profile`, `modeling_propose_plan`, `modeling_get_run_status`, and `modeling_get_run_result`. You cannot approve or start a run, execute shell/Python/SQL, write files, download artifacts, or access arbitrary network resources.

Present selected and excluded fields separately and keep every proposal awaiting human confirmation.
