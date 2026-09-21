/** React-free Session-scoped modeling state, commands, and polling policy. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ApproveAndRunRequest, ApproveAndRunResult, ModelingJson, RerunRequest, SkillDraftRequest, UpdatePlanRequest } from '../types.ts'

export type ModelingRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelling' | 'cancelled' | 'interrupted'

export interface ModelingDatasetView {
  readonly dataset_id: string
  readonly original_name: string
  readonly size_bytes: number
  readonly state: string
  readonly profile: Record<string, unknown> | null
  readonly error: Record<string, unknown> | null
}

export interface ModelingPlanView {
  readonly id: string
  readonly revision: number
  readonly plan_hash: string
  readonly state: string
  readonly plan: Record<string, unknown>
  readonly invalidation: Record<string, unknown> | null
}

export interface ModelingRunView {
  readonly id: string
  readonly status: ModelingRunStatus
  readonly revision: number
  readonly plan_revision: number
  readonly created_at: string
  readonly nodes: readonly Record<string, unknown>[]
  readonly events: readonly Record<string, unknown>[]
  readonly error: Record<string, unknown> | null
}

export interface ModelingRunHistoryView {
  readonly id: string
  readonly plan_revision: number
  readonly status: ModelingRunStatus
  readonly created_at: string
  readonly completed_at: string | null
  readonly rerun_of: string | null
  readonly metrics: Record<string, unknown> | null
}

export interface ModelingSkillView {
  readonly name: string
  readonly description: string
  readonly published_version: string
  readonly published_hash: string
  readonly draft_hash: string | null
  readonly draft_status: string
  readonly updated_at: string
}

export interface ModelingSkillDetail extends ModelingSkillView {
  readonly published_content: string
  readonly draft_content: string | null
  readonly validation: Record<string, unknown> | null
  readonly extension: ModelingSkillExtension
}

export interface ModelingSkillExtension {
  readonly contract: Record<string, unknown> | null
  readonly inputSchema: Record<string, unknown> | null
  readonly outputSchema: Record<string, unknown> | null
  readonly tools: Record<string, unknown> | null
  readonly toolCatalog: readonly ModelingToolCatalogItem[]
  readonly checks: readonly ModelingSkillCheck[]
  readonly scope: 'governance_only'
}

export interface ModelingToolCatalogItem {
  readonly name: string
  readonly description: string
  readonly available: boolean
  readonly declared: boolean
}

export interface ModelingSkillCheck {
  readonly id: string
  readonly label: string
  readonly status: 'pass' | 'fail' | 'not_configured'
  readonly message: string
}

export interface ModelingResultView {
  readonly metrics: Record<string, unknown> | null
  readonly diagnostics: readonly Record<string, unknown>[]
  readonly recommendations: readonly Record<string, unknown>[]
  readonly feature_summary: Record<string, unknown> | null
  readonly artifacts: readonly Record<string, unknown>[]
  readonly warnings: readonly string[]
}

export interface ModelingWorkspaceValue {
  readonly dataset: ModelingDatasetView | null
  readonly plan: ModelingPlanView | null
  readonly run: ModelingRunView | null
  readonly result: ModelingResultView | null
  readonly runs: readonly ModelingRunHistoryView[]
  readonly capabilities: Record<string, unknown> | null
  readonly skills: readonly ModelingSkillView[]
  readonly skillDetail: ModelingSkillDetail | null
}

export interface ModelingClientSnapshot extends ModelingWorkspaceValue {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly mode: 'live' | 'fixture'
  readonly confirming: boolean
  readonly skillBusy: boolean
  readonly error?: { readonly message: string; readonly code?: string; readonly requestId?: string }
}

function clientError(error: unknown): NonNullable<ModelingClientSnapshot['error']> {
  const source = record(error)
  const details = record(source?.details)
  const message = error instanceof Error ? error.message : typeof source?.message === 'string' ? source.message : String(error)
  const code = typeof source?.code === 'string' ? source.code : typeof details?.code === 'string' ? details.code : undefined
  const requestId = typeof source?.requestId === 'string' ? source.requestId : typeof details?.request_id === 'string' ? details.request_id : undefined
  return { message, ...(code === undefined ? {} : { code }), ...(requestId === undefined ? {} : { requestId }) }
}

export interface ModelingRemote {
  workspace(sessionId: SessionId, signal: AbortSignal): Promise<string>
  capabilities(sessionId: SessionId, signal: AbortSignal): Promise<string>
  skills(sessionId: SessionId, signal: AbortSignal): Promise<string>
  skill(sessionId: SessionId, name: string, signal: AbortSignal): Promise<string>
  saveSkillDraft(sessionId: SessionId, request: SkillDraftRequest, signal: AbortSignal): Promise<string>
  validateSkill(sessionId: SessionId, name: string, signal: AbortSignal): Promise<string>
  publishSkill(sessionId: SessionId, name: string, signal: AbortSignal): Promise<string>
  updatePlan(sessionId: SessionId, request: UpdatePlanRequest, signal: AbortSignal): Promise<string>
  approveAndRun(sessionId: SessionId, request: ApproveAndRunRequest, signal: AbortSignal): Promise<ApproveAndRunResult>
  rerun(sessionId: SessionId, request: RerunRequest, signal: AbortSignal): Promise<ApproveAndRunResult>
  cancelRun(sessionId: SessionId, runId: string, signal: AbortSignal): Promise<string>
}

const TERMINAL = new Set<ModelingRunStatus>(['succeeded', 'failed', 'cancelled', 'interrupted'])
const EMPTY: ModelingWorkspaceValue = {
  dataset: null, plan: null, run: null, result: null, runs: [], capabilities: null, skills: [], skillDetail: null,
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`Modeling response lacks ${name}.`)
  return value
}

function integer(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`Modeling response lacks ${name}.`)
  return value
}

function records(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.map(record).filter((item): item is Record<string, unknown> => item !== null)
}

/** Validate the bounded Host projection before it becomes browser state. */
export function parseWorkspace(source: string): ModelingWorkspaceValue {
  const root = record(JSON.parse(source))
  if (root === null) throw new Error('Modeling workspace response must be an object.')
  const datasetValue = record(root.dataset)
  const planValue = record(root.plan)
  const runValue = record(root.run)
  const resultValue = record(root.result)
  const dataset = datasetValue === null ? null : {
    dataset_id: text(datasetValue.dataset_id, 'dataset_id'),
    original_name: text(datasetValue.original_name, 'original_name'),
    size_bytes: integer(datasetValue.size_bytes, 'size_bytes'),
    state: text(datasetValue.state, 'dataset state'),
    profile: record(datasetValue.profile),
    error: record(datasetValue.error),
  }
  const plan = planValue === null ? null : {
    id: text(planValue.id, 'plan id'),
    revision: integer(planValue.revision, 'plan revision'),
    plan_hash: text(planValue.plan_hash, 'plan hash'),
    state: text(planValue.state, 'plan state'),
    plan: record(planValue.plan) ?? {},
    invalidation: record(planValue.invalidation),
  }
  const status = runValue === null ? undefined : text(runValue.status, 'run status') as ModelingRunStatus
  if (status !== undefined && !['queued', 'running', 'succeeded', 'failed', 'cancelling', 'cancelled', 'interrupted'].includes(status)) {
    throw new Error(`Unknown modeling run status: ${status}`)
  }
  const run = runValue === null || status === undefined ? null : {
    id: text(runValue.id, 'run id'), status, revision: integer(runValue.revision, 'run revision'),
    plan_revision: integer(runValue.plan_revision, 'run plan revision'),
    created_at: text(runValue.created_at, 'run created_at'),
    nodes: records(runValue.nodes),
    events: records(runValue.events),
    error: record(runValue.error),
  }
  const result = resultValue === null ? null : {
    metrics: record(resultValue.metrics),
    diagnostics: records(resultValue.diagnostics),
    recommendations: records(resultValue.recommendations),
    feature_summary: record(resultValue.feature_summary),
    artifacts: records(resultValue.artifacts),
    warnings: Array.isArray(resultValue.warnings) ? resultValue.warnings.filter((item): item is string => typeof item === 'string') : [],
  }
  const runs = records(root.runs).map(item => ({
    id: text(item.id, 'history run id'),
    plan_revision: integer(item.plan_revision, 'history plan revision'),
    status: text(item.status, 'history run status') as ModelingRunStatus,
    created_at: text(item.created_at, 'history created_at'),
    completed_at: typeof item.completed_at === 'string' ? item.completed_at : null,
    rerun_of: typeof item.rerun_of === 'string' ? item.rerun_of : null,
    metrics: record(item.metrics),
  }))
  return { dataset, plan, run, result, runs, capabilities: null, skills: [], skillDetail: null }
}

function parseSkills(source: string): readonly ModelingSkillView[] {
  const root = record(JSON.parse(source))
  return records(root?.items).map(item => ({
    name: text(item.name, 'Skill name'), description: text(item.description, 'Skill description'),
    published_version: text(item.published_version, 'Skill version'), published_hash: text(item.published_hash, 'Skill hash'),
    draft_hash: typeof item.draft_hash === 'string' ? item.draft_hash : null,
    draft_status: text(item.draft_status, 'Skill Draft status'), updated_at: text(item.updated_at, 'Skill updated_at'),
  }))
}

function parseSkillDetail(source: string): ModelingSkillDetail {
  const item = record(JSON.parse(source))
  if (item === null) throw new Error('Skill detail response must be an object.')
  const extension = record(item.extension)
  if (extension === null || extension.scope !== 'governance_only') throw new Error('Skill detail response lacks extension metadata.')
  const catalog = records(extension.tool_catalog).map(tool => ({
    name: text(tool.name, 'Tool name'), description: text(tool.description, 'Tool description'),
    available: tool.available === true, declared: tool.declared === true,
  }))
  const checks = records(extension.checks).map((check) => {
    const status = text(check.status, 'Skill check status')
    if (!['pass', 'fail', 'not_configured'].includes(status)) throw new Error(`Unknown Skill check status: ${status}`)
    return { id: text(check.id, 'Skill check id'), label: text(check.label, 'Skill check label'),
      status: status as ModelingSkillCheck['status'], message: text(check.message, 'Skill check message') }
  })
  return {
    name: text(item.name, 'Skill name'), description: text(item.description, 'Skill description'),
    published_version: text(item.published_version, 'Skill version'), published_hash: text(item.published_hash, 'Skill hash'),
    draft_hash: typeof item.draft_hash === 'string' ? item.draft_hash : null,
    draft_status: text(item.draft_status, 'Skill Draft status'), updated_at: text(item.updated_at, 'Skill updated_at'),
    published_content: text(item.published_content, 'published content'),
    draft_content: typeof item.draft_content === 'string' ? item.draft_content : null,
    validation: record(item.validation),
    extension: {
      contract: record(extension.contract), inputSchema: record(extension.input_schema),
      outputSchema: record(extension.output_schema), tools: record(extension.tools),
      toolCatalog: catalog, checks, scope: 'governance_only',
    },
  }
}

/** Own one Session's latest backend projection and exactly one polling loop. */
export class ModelingClientModel {
  private snapshot: ModelingClientSnapshot = { ...EMPTY, phase: 'loading', mode: 'live', confirming: false, skillBusy: false }
  private readonly listeners = new Set<() => void>()
  private request: AbortController | undefined
  private timer: ReturnType<typeof globalThis.setTimeout> | undefined
  private disposed = false
  private active = false
  private hidden = typeof document !== 'undefined' && document.hidden

  readonly source: ObservableSnapshot<ModelingClientSnapshot> = {
    getSnapshot: () => this.snapshot,
    subscribe: (listener) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } },
  }

  constructor(private readonly sessionId: SessionId, private readonly remote: ModelingRemote) {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.visibility)
  }

  /** Activate polling while this Session's workbench is mounted. */
  activate(): void {
    if (this.active || this.disposed) return
    this.active = true
    void this.refresh()
  }

  /** Abort and stop polling when another Session or View replaces this one. */
  deactivate(): void {
    this.active = false
    this.request?.abort()
    globalThis.clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Begin or refresh the Session projection without creating work. */
  async refresh(): Promise<void> {
    if (this.disposed || !this.active) return
    this.request?.abort()
    const request = new AbortController()
    this.request = request
    try {
      const [workspace, capabilities, skills] = await Promise.all([
        this.remote.workspace(this.sessionId, request.signal),
        this.remote.capabilities(this.sessionId, request.signal),
        this.remote.skills(this.sessionId, request.signal),
      ])
      const parsed = parseWorkspace(workspace)
      const next = {
        ...parsed,
        capabilities: record(JSON.parse(capabilities)),
        skills: parseSkills(skills),
        skillDetail: this.snapshot.skillDetail,
      }
      if (request.signal.aborted || this.request !== request) return
      const currentRevision = this.snapshot.run?.revision ?? -1
      if (next.run !== null && next.run.revision < currentRevision) return
      this.publish({ ...next, phase: 'ready', mode: 'live', confirming: false, skillBusy: false })
      this.schedule(next.run)
    } catch (error) {
      if (request.signal.aborted) return
      this.publish({ ...this.snapshot, phase: 'error', confirming: false, skillBusy: false, error: clientError(error) })
    }
  }

  /** Approve the exact visible revision once; repeated gestures reuse one idempotency key. */
  async approve(): Promise<void> {
    const plan = this.snapshot.plan
    if (plan === null || plan.state !== 'proposed' || this.snapshot.confirming) return
    const { error: _error, ...current } = this.snapshot
    this.publish({ ...current, confirming: true })
    const idempotencyKey = `ui:${this.sessionId}:${plan.id}:${plan.revision}:${plan.plan_hash}`
    const request = new AbortController()
    try {
      const source = [...this.snapshot.runs].reverse().find(item => TERMINAL.has(item.status) && item.plan_revision < plan.revision)
      if (source === undefined) {
        await this.remote.approveAndRun(this.sessionId, {
          planId: plan.id, revision: plan.revision, planHash: plan.plan_hash, idempotencyKey,
        }, request.signal)
      } else {
        await this.remote.rerun(this.sessionId, {
          sourceRunId: source.id, planId: plan.id, revision: plan.revision, planHash: plan.plan_hash,
          idempotencyKey: `ui:rerun:${this.sessionId}:${source.id}:${plan.revision}:${plan.plan_hash}`,
        }, request.signal)
      }
      await this.refresh()
    } catch (error) {
      this.publish({ ...this.snapshot, confirming: false, skillBusy: false, phase: 'error', error: clientError(error) })
    }
  }

  /** Save an edited plan against the exact visible revision. */
  async updatePlan(plan: ModelingJson): Promise<void> {
    const current = this.snapshot.plan
    if (current === null || !['proposed', 'approved'].includes(current.state)) return
    const request = new AbortController()
    await this.remote.updatePlan(this.sessionId, {
      planId: current.id, baseRevision: current.revision, plan,
    }, request.signal)
    await this.refresh()
  }

  /** Open one Skill detail without exposing filesystem coordinates. */
  async selectSkill(name: string): Promise<void> {
    this.publish({ ...this.snapshot, skillBusy: true })
    try {
      const detail = parseSkillDetail(await this.remote.skill(this.sessionId, name, new AbortController().signal))
      this.publish({ ...this.snapshot, skillDetail: detail, skillBusy: false })
    } catch (error) {
      this.publish({ ...this.snapshot, skillBusy: false, phase: 'error', error: clientError(error) })
    }
  }

  /** Save one Session-private Skill Draft. */
  async saveSkillDraft(name: string, content: string): Promise<void> {
    this.publish({ ...this.snapshot, skillBusy: true })
    try {
      const detail = parseSkillDetail(await this.remote.saveSkillDraft(this.sessionId, { name, content }, new AbortController().signal))
      this.publish({ ...this.snapshot, skillDetail: detail, skillBusy: false })
      await this.refresh()
    } catch (error) { this.publish({ ...this.snapshot, skillBusy: false, phase: 'error', error: clientError(error) }) }
  }

  /** Validate the selected Draft without publishing it. */
  async validateSkill(name: string): Promise<void> {
    this.publish({ ...this.snapshot, skillBusy: true })
    try {
      await this.remote.validateSkill(this.sessionId, name, new AbortController().signal)
      await this.selectSkill(name)
    } catch (error) { this.publish({ ...this.snapshot, skillBusy: false, phase: 'error', error: clientError(error) }) }
  }

  /** Publish one validated immutable Skill version. */
  async publishSkill(name: string): Promise<void> {
    this.publish({ ...this.snapshot, skillBusy: true })
    try {
      const detail = parseSkillDetail(await this.remote.publishSkill(this.sessionId, name, new AbortController().signal))
      this.publish({ ...this.snapshot, skillDetail: detail, skillBusy: false })
      await this.refresh()
    } catch (error) { this.publish({ ...this.snapshot, skillBusy: false, phase: 'error', error: clientError(error) }) }
  }

  /** Cancel only the currently visible non-terminal run. */
  async cancel(): Promise<void> {
    const run = this.snapshot.run
    if (run === null || TERMINAL.has(run.status)) return
    await this.remote.cancelRun(this.sessionId, run.id, new AbortController().signal)
    await this.refresh()
  }

  /** Stop requests and polling when the Session scope leaves the UI. */
  dispose(): void {
    this.disposed = true
    this.request?.abort()
    globalThis.clearTimeout(this.timer)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.visibility)
    this.listeners.clear()
  }

  private readonly visibility = (): void => {
    this.hidden = document.hidden
    if (this.snapshot.run !== null && !TERMINAL.has(this.snapshot.run.status)) this.schedule(this.snapshot.run)
  }

  private schedule(run: ModelingRunView | null): void {
    globalThis.clearTimeout(this.timer)
    this.timer = undefined
    if (run === null || TERMINAL.has(run.status) || this.disposed || !this.active) return
    this.timer = globalThis.setTimeout(() => { void this.refresh() }, this.hidden ? 4000 : 800)
  }

  private publish(next: ModelingClientSnapshot): void {
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }
}
