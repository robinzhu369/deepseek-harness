/** Centralized, visibly marked UI-only preview data for visual review. */
import type { ModelingClientSnapshot } from './model.ts'

export type ModelingFixtureName = 'empty' | 'proposed' | 'running' | 'succeeded' | 'failed'

const BASE: ModelingClientSnapshot = {
  phase: 'ready', mode: 'fixture', confirming: false, skillBusy: false,
  dataset: {
    dataset_id: 'preview_dataset', original_name: 'modeling_preview.csv', size_bytes: 169_700, state: 'ready',
    profile: { row_count: 1200, column_count: 8, target: 'label', computation_scope: 'complete_dataset' }, error: null,
  },
  plan: {
    id: 'preview_plan', revision: 1, plan_hash: 'preview-only', state: 'approved',
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
        samples: 240, positive_label: 1, threshold: 0.5, roc_auc: 0.701,
        average_precision: 0.182, f1: 0, precision: 0, recall: 0, positive_rate: 0.0875,
        confusion_matrix: [[219, 0], [21, 0]],
      },
    },
    diagnostics: [{ code: 'class_imbalance' }, { code: 'low_recall' }, { code: 'low_precision' }],
    recommendations: [{ code: 'consider_lower_threshold' }, { code: 'consider_higher_threshold' }],
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

/** Return one coherent UI-only lifecycle state without starting backend work. */
export function modelingFixture(name: ModelingFixtureName): ModelingClientSnapshot {
  if (name === 'empty') return { ...BASE, dataset: null, plan: null, run: null, result: null, runs: [] }
  if (name === 'proposed') return { ...BASE, plan: BASE.plan === null ? null : { ...BASE.plan, state: 'proposed' }, run: null, result: null, runs: [] }
  if (name === 'running') {
    const run = BASE.run === null ? null : { ...BASE.run, status: 'running' as const, nodes: [{ name: 'preprocess', status: 'running' }], events: [{ type: 'node_started', node: 'preprocess' }] }
    return { ...BASE, run, result: null, runs: run === null ? [] : [{ id: run.id, plan_revision: 1, status: 'running', created_at: run.created_at, completed_at: null, rerun_of: null, metrics: null }] }
  }
  if (name === 'failed') {
    const run = BASE.run === null ? null : { ...BASE.run, status: 'failed' as const, error: { code: 'PIPELINE_FAILED', message: 'UI preview / fixture：用于检查错误详情和恢复提示。', request_id: 'preview-request' } }
    return { ...BASE, run, result: null, runs: run === null ? [] : [{ id: run.id, plan_revision: 1, status: 'failed', created_at: run.created_at, completed_at: '2026-09-20T00:00:02Z', rerun_of: null, metrics: null }] }
  }
  return BASE
}
