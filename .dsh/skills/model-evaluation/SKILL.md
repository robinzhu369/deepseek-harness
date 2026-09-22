---
name: model-evaluation
description: Evaluate trained model performance with task-appropriate metrics, confusion-matrix and threshold analysis, then produce interpretable diagnostics and recommendations.
metadata:
  version: 0.2.0-demo
---

# Model evaluation

## Goal

Evaluate a trained model from actual run results and provide a concise, interpretable assessment. Never invent a metric or claim that proposed work has executed.

## Workflow

1. Confirm the task type is binary classification and that this Skill follows `model-training` in `TaskContext.skillSequence`.
2. During proposal, reuse `profileEvidence`, interpret `skillConfigs.model-evaluation.metrics: auto` and `threshold: 0.5`, and record the selected metric set under `decisions.model-evaluation`. Do not read a Run that does not exist.
3. After human confirmation and execution, use `modeling_get_run_status` when completion is uncertain, then read the succeeded run with `modeling_get_run_result`.
4. Check the reported class balance when available.
5. Interpret ROC-AUC, average precision / PR-AUC, F1, precision, and recall for the task.
6. Interpret the confusion matrix using the reported label order.
7. Explain the current threshold and its false-positive and false-negative implications.
8. Compare validation and test metrics when both are available; report a material gap as potential generalization risk.
9. Ground diagnostics and recommendations in the returned evaluation result.
10. State what cannot be concluded when data or metrics are missing, then self-check.

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

You may use only `modeling_propose_plan`, `modeling_get_run_status`, and `modeling_get_run_result`.
