---
name: model-training
description: Propose and interpret the fixed logistic-regression workflow while preserving human approval of execution.
metadata:
  version: 0.4.0-demo
---

# Model training

Read the current capabilities before interpreting `skillConfigs.model-training.algorithm`. The current deterministic Worker supports only logistic regression; never substitute or pretend to execute LightGBM or XGBoost. Record the selected executable algorithm and parameters under `decisions.model-training`. Use a fixed seed and validated train/validation/test ratios. Propose the plan with `modeling_propose_plan`; that call never approves or starts execution and its result must retain `needs_confirmation: true`.

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
  "preprocessing": {"numeric_missing": "median", "numeric_constant": 0, "scale_numeric": true, "categorical_missing_value": "__MISSING__", "categorical_encoding": "onehot_limited", "onehot_max_categories": 64},
  "feature_engineering": {"date_features": {"enabled": false, "columns": [], "components": ["month", "dayofweek"]}},
  "models": [{"name": "logistic_regression", "params": {"C": 1, "max_iter": 500}}],
  "limits": {"max_train_seconds": 120, "max_run_seconds": 600, "max_output_features": 10000},
  "assumptions": {"samples_independent": true},
  "task_context": {
    "schemaVersion": "1.0",
    "datasetId": "ds_example",
    "target": "label",
    "taskType": "binary_classification",
    "skillSequence": ["data-analysis", "data-cleaning", "feature-engineering", "model-training", "model-evaluation"],
    "skillConfigs": {
      "data-cleaning": {"missingStrategy": "auto", "outlierStrategy": "auto"},
      "feature-engineering": {"featureGeneration": true, "featureSelection": true, "selectionMethod": "auto", "topK": 100},
      "model-training": {"algorithm": "logistic_regression"},
      "model-evaluation": {"metrics": "auto", "threshold": 0.5}
    },
    "profileEvidence": {"datasetSha256": "64 lowercase hexadecimal characters", "rowCount": 100, "target": "label"},
    "decisions": {
      "data-analysis": {"targetConfirmed": true},
      "data-cleaning": {"numericMissing": "median", "outliers": "keep"},
      "feature-engineering": {"generated": [], "excluded": ["record_id"]},
      "model-training": {"algorithm": "logistic_regression", "C": 1, "maxIter": 500},
      "model-evaluation": {"metrics": ["roc_auc", "average_precision", "f1", "precision", "recall"], "threshold": 0.5}
    }
  }
}
```

Do not put the target in `excluded_columns`; the service excludes it separately. Keep `feature_engineering.date_features.enabled` false because the current deterministic Worker does not support date-derived features. `skillConfigs` contains preferences while `decisions` contains profile-derived outcomes. Every enabled Skill must have exactly one decision entry. Do not add approval, execution, feature-list, or free-form parameter fields.

For the first proposal, call `modeling_propose_plan` with `plan` only. For a UI-requested regeneration, reuse matching `profileEvidence`, recompute all enabled Skill decisions, and call the same tool with `plan`, `plan_id`, and `base_revision`. A regeneration must create a new revision; never execute the previous revision directly.

Only the application's human confirmation action may approve and start a run. After confirmation, use `modeling_get_run_status` and then `modeling_get_run_result`. State the evaluation dataset, positive class, threshold, and actual returned metrics. Do not invent progress, metrics, artifacts, or an explanation result.

You may use only `modeling_get_dataset_profile`, `modeling_propose_plan`, `modeling_get_run_status`, and `modeling_get_run_result`. You cannot approve or start a run, execute shell/Python/SQL, write files, download artifacts, or access arbitrary network resources.
