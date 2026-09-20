/** Browser-safe modeling records mirrored by the Python Pydantic models. */

export const MODELING_SCHEMA_VERSION = '1.0' as const
export const MODEL_NAMES = ['logistic_regression'] as const
export const SPLIT_METHODS = ['random', 'stratified_random'] as const
export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelling', 'cancelled', 'interrupted'] as const
export const NODE_STATUSES = ['pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled', 'interrupted', 'blocked'] as const

/** JSON scalar supported as a binary classification label. */
export type ScalarLabel = string | number | boolean

/** Deterministic split parameters. */
export interface SplitSpec {
  readonly method: typeof SPLIT_METHODS[number]
  readonly train_ratio: number
  readonly validation_ratio: number
  readonly test_ratio: number
  readonly seed: number
}

/** Whitelisted preprocessing parameters. */
export interface PreprocessingSpec {
  readonly numeric_missing: 'median' | 'constant'
  readonly numeric_constant: number
  readonly scale_numeric: boolean
  readonly categorical_missing_value: string
  readonly categorical_encoding: 'onehot_limited'
  readonly onehot_max_categories: number
}

/** Whitelisted date feature parameters. */
export interface DateFeatureSpec {
  readonly enabled: boolean
  readonly columns: readonly string[]
  readonly components: readonly ('month' | 'dayofweek')[]
}

/** Feature engineering parameters. */
export interface FeatureEngineeringSpec {
  readonly date_features: DateFeatureSpec
}

/** P0 logistic regression parameters. */
export interface ModelSpec {
  readonly name: typeof MODEL_NAMES[number]
  readonly params: {
    readonly C: number
    readonly max_iter: number
  }
}

/** Resource limits accepted by the service. */
export interface ResourceLimits {
  readonly max_train_seconds: number
  readonly max_run_seconds: number
  readonly max_output_features: number
}

/** Candidate plan without approval or execution authority. */
export interface ModelingPlan {
  readonly schema_version: typeof MODELING_SCHEMA_VERSION
  readonly dataset_id: string
  readonly dataset_sha256: string
  readonly mode: 'prepare_dataset' | 'binary_classification'
  readonly target: string | null
  readonly positive_label: ScalarLabel | null
  readonly excluded_columns: readonly string[]
  readonly split: SplitSpec
  readonly preprocessing: PreprocessingSpec
  readonly feature_engineering: FeatureEngineeringSpec
  readonly models: readonly ModelSpec[]
  readonly limits: ResourceLimits
  readonly assumptions: { readonly samples_independent: boolean }
}

/** One immutable plan revision. */
export interface PlanRecord {
  readonly id: string
  readonly revision: number
  readonly state: 'draft' | 'proposed' | 'approved' | 'superseded'
  readonly plan: ModelingPlan
  readonly plan_hash: string
}

/** Human-originated approval reference. */
export interface ApprovalRequest {
  readonly revision: number
  readonly plan_hash: string
}

/** Dataset metadata returned across the Host boundary. */
export interface DatasetRecord {
  readonly id: string
  readonly session_id: string
  readonly original_name: string
  readonly sha256: string
  readonly size_bytes: number
  readonly storage_key: string
  readonly state: 'uploaded' | 'profiling' | 'ready' | 'error'
}

/** One node in a run snapshot. */
export interface NodeRecord {
  readonly id: string
  readonly status: typeof NODE_STATUSES[number]
  readonly duration_ms: number | null
}

/** Completed artifact metadata without a host filesystem path. */
export interface ArtifactRecord {
  readonly id: string
  readonly run_id: string
  readonly kind: string
  readonly storage_key: string
  readonly sha256: string
  readonly size_bytes: number
  readonly media_type: string
  readonly completed: boolean
}

/** Persisted run snapshot. */
export interface RunRecord {
  readonly id: string
  readonly session_id: string
  readonly plan_id: string
  readonly plan_revision: number
  readonly status: typeof RUN_STATUSES[number]
  readonly revision: number
  readonly nodes: readonly NodeRecord[]
  readonly artifacts: readonly ArtifactRecord[]
}
