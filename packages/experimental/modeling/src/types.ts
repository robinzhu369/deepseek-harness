/** One immutable runtime Skill identity recorded with a proposed plan. */
export interface ModelingSkillSnapshot {
  readonly name: string
  readonly version: string
  readonly sha256: string
}

/** Human-originated request to approve an exact plan revision. */
export interface ApproveAndRunRequest {
  readonly planId: string
  readonly revision: number
  readonly planHash: string
  readonly idempotencyKey: string
}

/** Created or replayed run identity returned to the application. */
export interface ApproveAndRunResult {
  readonly run_id: string
  readonly created: boolean
}

/** Human-originated rerun of a newer revision from a terminal source Run. */
export interface RerunRequest extends ApproveAndRunRequest {
  readonly sourceRunId: string
}

/** Session-private runtime Skill Draft content. */
export interface SkillDraftRequest {
  readonly name: string
  readonly content: string
}

/** Optimistic browser edit of one proposed plan revision. */
export interface UpdatePlanRequest {
  readonly planId: string
  readonly baseRevision: number
  readonly plan: ModelingJson
}

/** User-requested Skill orchestration change that the Agent must regenerate. */
export interface RegeneratePlanRequest extends UpdatePlanRequest {}

/** JSON values accepted by the private modeling API. */
export type ModelingJson = null | boolean | number | string | ModelingJson[] | { [key: string]: ModelingJson }
