/** Private Host adapter for the deterministic modeling service. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ApproveAndRunRequest, ApproveAndRunResult, ModelingJson, ModelingSkillSnapshot, RerunRequest, SkillDraftRequest, UpdatePlanRequest } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    modeling: ModelingGateway
  }
}

/** Deployment configuration for the private service connection and model-visible result cap. */
export interface Config {
  baseUrl: string
  requestTimeoutMs: number
  maxToolResultBytes: number
}

/** Structured failure preserved across the bounded tool adapter. */
export class ModelingGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable = false,
    readonly details?: ModelingJson,
  ) {
    super(message)
    this.name = 'ModelingGatewayError'
  }
}

/** Host-only HTTP client. Session identity always comes from the live Agent. */
export class ModelingGateway extends TypertRemoteService {
  static inject = ['connection']
  static Config: z<Config> = z.object({
    baseUrl: z.string().required(),
    requestTimeoutMs: z.number().required(),
    maxToolResultBytes: z.number().required(),
  })

  readonly maxToolResultBytes: number
  private readonly baseUrl: URL
  private readonly requestTimeoutMs: number

  constructor(ctx: Context, config: Config) {
    super(ctx, 'modeling')
    this.baseUrl = new URL(config.baseUrl)
    if (!['http:', 'https:'].includes(this.baseUrl.protocol)) throw new Error('modeling baseUrl must use HTTP or HTTPS')
    if (!Number.isSafeInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 1) throw new Error('requestTimeoutMs must be a positive integer')
    if (!Number.isSafeInteger(config.maxToolResultBytes) || config.maxToolResultBytes < 256) throw new Error('maxToolResultBytes must be at least 256')
    this.requestTimeoutMs = config.requestTimeoutMs
    this.maxToolResultBytes = config.maxToolResultBytes
    ctx.connection.fetch.register({
      path: '/api/modeling.artifact', methods: ['GET'], requestBody: 'buffered',
      fetch: request => this.artifactResponse(request),
    })
  }

  /** Restore the latest bounded Dataset, Plan, Run, and Result for the live Session. */
  @Remote('workspace')
  async workspace(agent: Agent, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.request(String(agent.id), '/v1/workspace', { signal }))
  }

  /** Read executor-owned choices used by the controlled plan form. */
  @Remote('capabilities')
  async capabilities(agent: Agent, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.request(String(agent.id), '/v1/capabilities', { signal }))
  }

  /** List the four runtime Skills with only this Session's Draft metadata. */
  @Remote('skills')
  async skills(agent: Agent, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.request(String(agent.id), '/v1/skills', { signal }))
  }

  /** Read one published runtime Skill and this Session's optional Draft. */
  @Remote('skill')
  async skill(agent: Agent, name: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.request(String(agent.id), `/v1/skills/${encodeURIComponent(name)}`, { signal }))
  }

  /** Save one Session-private runtime Skill Draft. */
  @Remote('saveSkillDraft')
  async saveSkillDraft(agent: Agent, request: SkillDraftRequest, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.request(String(agent.id), `/v1/skills/${encodeURIComponent(request.name)}/draft`, {
      method: 'PUT', body: { content: request.content }, signal,
    }))
  }

  /** Validate one Session-private runtime Skill Draft. */
  @Remote('validateSkill')
  async validateSkill(agent: Agent, name: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.request(String(agent.id), `/v1/skills/${encodeURIComponent(name)}/validate`, {
      method: 'POST', signal,
    }))
  }

  /** Publish one validated immutable runtime Skill version from the application path. */
  @Remote('publishSkill')
  async publishSkill(agent: Agent, name: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.request(String(agent.id), `/v1/skills/${encodeURIComponent(name)}/publish`, {
      method: 'POST', signal,
    }))
  }

  /** Update a proposed plan through optimistic revision control. */
  @Remote('updatePlan')
  async updatePlan(agent: Agent, request: UpdatePlanRequest, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.request(String(agent.id), `/v1/plans/${encodeURIComponent(request.planId)}`, {
      method: 'PUT', body: { base_revision: request.baseRevision, plan: request.plan }, signal,
    }))
  }

  /** Cancel the active Session-owned run through the application path. */
  @Remote('cancelRun')
  async cancelRun(agent: Agent, runId: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.request(String(agent.id), `/v1/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST', signal,
    }))
  }

  /** Read one session-owned dataset profile. */
  getDatasetProfile(sessionId: string, datasetId: string, signal?: AbortSignal): Promise<ModelingJson> {
    return this.request(sessionId, `/v1/datasets/${encodeURIComponent(datasetId)}/profile`, { ...signal === undefined ? {} : { signal } })
  }

  /** Persist one validated proposal with exact runtime Skill snapshots. */
  proposePlan(
    sessionId: string,
    plan: ModelingJson,
    snapshots: readonly ModelingSkillSnapshot[],
    signal?: AbortSignal,
  ): Promise<ModelingJson> {
    return this.request(sessionId, '/v1/plans', {
      method: 'POST', body: plan, ...signal === undefined ? {} : { signal },
      headers: { 'X-Modeling-Skill-Snapshots': JSON.stringify(snapshots) },
    })
  }

  /** Read one session-owned run without changing it. */
  getRunStatus(sessionId: string, runId: string, signal?: AbortSignal): Promise<ModelingJson> {
    return this.request(sessionId, `/v1/runs/${encodeURIComponent(runId)}`, { ...signal === undefined ? {} : { signal } })
  }

  /** Read one completed session-owned run result. */
  getRunResult(sessionId: string, runId: string, signal?: AbortSignal): Promise<ModelingJson> {
    return this.request(sessionId, `/v1/runs/${encodeURIComponent(runId)}/result`, { ...signal === undefined ? {} : { signal } })
  }

  /** Approve an exact plan revision from the application Remote path; this is not a model tool. */
  @Remote('approveAndRun')
  approveAndRun(agent: Agent, request: ApproveAndRunRequest, signal: AbortSignal): Promise<ApproveAndRunResult> {
    return this.request(String(agent.id), `/v1/plans/${encodeURIComponent(request.planId)}/approve-and-run`, {
      method: 'POST',
      body: { revision: request.revision, plan_hash: request.planHash },
      headers: { 'Idempotency-Key': request.idempotencyKey },
      signal,
    }).then((value) => {
      if (value === null || Array.isArray(value) || typeof value !== 'object'
        || typeof value.run_id !== 'string' || typeof value.created !== 'boolean') {
        throw new ModelingGatewayError('INVALID_MODELING_RESPONSE', 'Approval returned an invalid response.', 502)
      }
      return { run_id: value.run_id, created: value.created }
    })
  }

  /** Approve a newer revision and create a distinct Run from a terminal source; this is not a model tool. */
  @Remote('rerun')
  rerun(agent: Agent, request: RerunRequest, signal: AbortSignal): Promise<ApproveAndRunResult> {
    return this.request(String(agent.id), `/v1/runs/${encodeURIComponent(request.sourceRunId)}/rerun`, {
      method: 'POST', body: { revision: request.revision, plan_hash: request.planHash },
      headers: { 'Idempotency-Key': request.idempotencyKey }, signal,
    }).then((value) => {
      if (value === null || Array.isArray(value) || typeof value !== 'object'
        || typeof value.run_id !== 'string' || typeof value.created !== 'boolean') {
        throw new ModelingGatewayError('INVALID_MODELING_RESPONSE', 'Rerun returned an invalid response.', 502)
      }
      return { run_id: value.run_id, created: value.created }
    })
  }

  private async artifactResponse(request: Request): Promise<Response> {
    const query = new URL(request.url).searchParams
    const sessionId = query.get('sessionId')
    const artifactId = query.get('artifactId')
    if (!sessionId || !artifactId) return new Response('Invalid artifact coordinates.', { status: 400 })
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(this.requestTimeoutMs)])
    let response: Response
    try {
      response = await fetch(new URL(`/v1/artifacts/${encodeURIComponent(artifactId)}/download`, this.baseUrl), {
        headers: { 'X-Session-Id': sessionId }, signal, redirect: 'error',
      })
    } catch {
      return new Response('Artifact service unavailable.', { status: 503 })
    }
    if (!response.ok || response.body === null) return new Response('Artifact unavailable.', { status: response.status })
    const headers = new Headers({ 'cache-control': 'no-store' })
    for (const name of ['content-type', 'content-disposition', 'content-length']) {
      const value = response.headers.get(name)
      if (value !== null) headers.set(name, value)
    }
    return new Response(response.body, { status: 200, headers })
  }

  private async request(
    sessionId: string,
    path: string,
    options: { method?: string; body?: ModelingJson; headers?: Record<string, string>; signal?: AbortSignal },
  ): Promise<ModelingJson> {
    const timeout = AbortSignal.timeout(this.requestTimeoutMs)
    const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])
    let response: Response
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method: options.method ?? 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId, ...options.headers },
        ...options.body === undefined ? {} : { body: JSON.stringify(options.body) },
        signal,
      })
    } catch (error) {
      throw new ModelingGatewayError('MODELING_API_UNAVAILABLE', error instanceof Error ? error.message : String(error), 503, true)
    }
    const value: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const item = value !== null && typeof value === 'object' && 'error' in value ? value.error : undefined
      const detail = item !== null && typeof item === 'object' ? item as Record<string, unknown> : {}
      throw new ModelingGatewayError(
        typeof detail.code === 'string' ? detail.code : 'MODELING_API_ERROR',
        typeof detail.message === 'string' ? detail.message : `Modeling API returned HTTP ${response.status}`,
        response.status,
        detail.retryable === true,
        'details' in detail ? detail.details as ModelingJson : undefined,
      )
    }
    return value as ModelingJson
  }
}

export type * from './types.ts'
export default ModelingGateway
