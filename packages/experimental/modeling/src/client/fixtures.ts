/** Centralized, visibly marked UI-only preview data for T07. */
import type { ModelingClientSnapshot } from './model.ts'

export const MODELING_UI_FIXTURE: ModelingClientSnapshot = {
  phase: 'ready', mode: 'fixture', confirming: false, skillBusy: false,
  dataset: {
    dataset_id: 'preview_dataset', original_name: 'modeling_preview.csv', size_bytes: 169_700, state: 'ready',
    profile: { row_count: 1200, column_count: 8, target: 'label', computation_scope: 'complete_dataset' }, error: null,
  },
  plan: {
    id: 'preview_plan', revision: 1, plan_hash: 'preview-only', state: 'proposed',
    invalidation: null, plan: {
      task_type: 'binary_classification', target: 'label', excluded_columns: ['record_id'],
      preprocessing: { numeric_missing: 'median', categorical_missing: '__MISSING__', categorical_encoding: 'onehot_limited' },
      split: { train: 0.6, validation: 0.2, test: 0.2, random_seed: 42 },
      model: { type: 'logistic_regression', parameters: { C: 1, max_iter: 500 } },
    },
  },
  run: { id: 'preview_run', status: 'succeeded', revision: 5, plan_revision: 1, created_at: '2026-09-20T00:00:00Z', nodes: [], events: [], error: null },
  result: {
    metrics: {
      test: {
        samples: 240, positive_label: 1, threshold: 0.5, roc_auc: 0.701, average_precision: 0.182, f1: 0,
        confusion_matrix: [[219, 0], [21, 0]],
      },
    },
    feature_summary: { output_feature_count: 12 }, artifacts: [],
    warnings: ['UI preview / fixture：这些数值仅用于组件与响应式布局检查。'],
  },
  runs: [{
    id: 'preview_run', plan_revision: 1, status: 'succeeded', created_at: '2026-09-20T00:00:00Z',
    completed_at: '2026-09-20T00:00:02Z', rerun_of: null,
    metrics: { test: { roc_auc: 0.701, average_precision: 0.182, f1: 0 } },
  }],
  capabilities: null, skills: [], skillDetail: null,
}
