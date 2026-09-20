import type { ModelingPlan } from './modeling.ts'

/** Compile-time fixture that pins the TypeScript face to the JSON/Pydantic fields. */
export const classificationPlanFixture = {
  schema_version: '1.0',
  dataset_id: 'ds_example',
  dataset_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  mode: 'binary_classification',
  target: 'label',
  positive_label: 1,
  excluded_columns: ['record_id'],
  split: { method: 'stratified_random', train_ratio: 0.6, validation_ratio: 0.2, test_ratio: 0.2, seed: 42 },
  preprocessing: {
    numeric_missing: 'median',
    numeric_constant: 0,
    scale_numeric: true,
    categorical_missing_value: '__MISSING__',
    categorical_encoding: 'onehot_limited',
    onehot_max_categories: 32,
  },
  feature_engineering: { date_features: { enabled: false, columns: [], components: ['month', 'dayofweek'] } },
  models: [{ name: 'logistic_regression', params: { C: 1, max_iter: 500 } }],
  limits: { max_train_seconds: 120, max_run_seconds: 600, max_output_features: 10000 },
  assumptions: { samples_independent: true },
} as const satisfies ModelingPlan
