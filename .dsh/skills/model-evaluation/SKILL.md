---
name: model-evaluation
description: Evaluate trained model performance with task-appropriate metrics, confusion-matrix and threshold analysis, then produce interpretable diagnostics and recommendations.
metadata:
  version: 0.1.0-demo
---

# Model evaluation

## Goal

Evaluate a trained model from actual run results and provide a concise, interpretable assessment. Never invent a metric or claim that proposed work has executed.

## Workflow

1. Confirm the task type is binary classification.
2. Use `modeling_get_run_status` when completion is uncertain, then read the succeeded run with `modeling_get_run_result`.
3. Check the reported class balance when available.
4. Interpret ROC-AUC, average precision / PR-AUC, F1, precision, and recall for the task.
5. Interpret the confusion matrix using the reported label order.
6. Explain the current threshold and its false-positive and false-negative implications.
7. Compare validation and test metrics when both are available; report a material gap as potential generalization risk.
8. Ground diagnostics and recommendations in the returned evaluation result.
9. State what cannot be concluded when data or metrics are missing.
10. Self-check before the final response.

## Guardrails

- Do not use accuracy as the only judgment for a class-imbalanced task.
- Do not call a model good solely because ROC-AUC is high.
- Do not invent unavailable metrics or infer values from prose.
- Do not retrain, tune parameters, modify the threshold, or repeatedly optimize against the test split.
- Do not add model ranking, AutoML, SHAP, or complex model search.
- A lower threshold may reduce missed positives; a higher threshold may reduce false alarms. Recommend validation and reevaluation only, never apply the change.
- You cannot approve or start a run, execute shell commands, write files, or access arbitrary network resources.

## Self-check

Before responding, confirm that the task type is known, metrics match the task, class imbalance was considered, the confusion matrix and threshold were interpreted, and every conclusion is supported by the actual result.

You may use only `modeling_get_run_status` and `modeling_get_run_result`.
