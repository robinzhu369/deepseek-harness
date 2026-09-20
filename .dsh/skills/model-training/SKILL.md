---
name: model-training
description: Propose and interpret the fixed logistic-regression workflow while preserving human approval of execution.
metadata:
  version: 0.1.0-demo
---

# Model training

The only supported estimator is logistic regression with the documented parameter whitelist. Use a fixed seed and the validated train/validation/test ratios. Propose the plan with `modeling_propose_plan`; that call never approves or starts execution and its result must retain `needs_confirmation: true`.

Pass `modeling_propose_plan` a `plan` object with exactly this structure; replace only dataset identifiers and profile-derived target/exclusions while keeping operators within these values:

```json
{
  "schema_version": "1.0",
  "dataset_id": "ds_example",
  "dataset_sha256": "64 lowercase hexadecimal characters",
  "mode": "binary_classification",
  "target": "label",
  "positive_label": 1,
  "excluded_columns": ["record_id"],
  "split": {"method": "stratified_random", "train_ratio": 0.6, "validation_ratio": 0.2, "test_ratio": 0.2, "seed": 42},
  "preprocessing": {"numeric_missing": "median", "numeric_constant": 0, "scale_numeric": true, "categorical_missing_value": "__MISSING__", "categorical_encoding": "onehot_limited", "onehot_max_categories": 32},
  "feature_engineering": {"date_features": {"enabled": false, "columns": [], "components": ["month", "dayofweek"]}},
  "models": [{"name": "logistic_regression", "params": {"C": 1, "max_iter": 500}}],
  "limits": {"max_train_seconds": 120, "max_run_seconds": 600, "max_output_features": 10000},
  "assumptions": {"samples_independent": true}
}
```

Do not put the target in `excluded_columns`; the service excludes it separately. Do not add approval, execution, feature-list, or free-form parameter fields.

Only the application's human confirmation action may approve and start a run. After confirmation, use `modeling_get_run_status` and then `modeling_get_run_result`. State the evaluation dataset, positive class, threshold, and actual returned metrics. Do not invent progress, metrics, artifacts, or an explanation result.

You may use only `modeling_get_dataset_profile`, `modeling_propose_plan`, `modeling_get_run_status`, and `modeling_get_run_result`. You cannot approve or start a run, execute shell/Python/SQL, write files, download artifacts, or access arbitrary network resources.
