/** Private Host adapter for the deterministic modeling service. */
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-client-connection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ApproveAndRunRequest, ApproveAndRunResult, ModelingJson, ModelingSkillSnapshot, RegeneratePlanRequest, RerunRequest, SkillDraftRequest, UpdatePlanRequest } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    modeling: ModelingGateway
  }
}

/** Deployment configuration for the private service connection and model-visible result cap. */
export interface Config {
  /** Absolute HTTP(S) origin of the private Modeling API. */
  baseUrl: string
  /** Positive timeout in milliseconds applied to each private API request. */
  requestTimeoutMs: number
  /** Minimum 256-byte cap for each model-visible modeling tool result. */
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

  /** Maximum UTF-8 bytes returned by one model-facing modeling tool call. */
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

  /**
   * Restore the latest bounded Dataset, Plan, Run, and Result for the live Session.
   * @param agent - Live Agent whose Session owns the workspace.
   * @param signal - Cancels the private API request.
   * @returns Serialized workspace state for the Remote client.
   */
  @Remote('workspace')
  async workspace(agent: Agent, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.request(String(agent.id), '/v1/workspace', { signal }))
  }

  /**
   * Read executor-owned choices used by the controlled plan form.
   * @param agent - Live Agent whose Session scopes the request.
   * @param signal - Cancels the private API request.
   * @returns Serialized executor capabilities for the Remote client.
   */
  @Remote('capabilities')
  async capabilities(agent: Agent, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.request(String(agent.id), '/v1/capabilities', { signal }))
  }

  /**
   * List the five runtime Skills with only this Session's Draft metadata.
   * @param agent - Live Agent whose Session owns any Draft metadata.
   * @param signal - Cancels the private API request.
   * @returns Serialized runtime Skill summaries for the Remote client.
   */
  @Remote('skills')
  async skills(agent: Agent, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.request(String(agent.id), '/v1/skills', { signal }))
  }

  /**
   * Read one published runtime Skill and this Session's optional Draft.
   * @param agent - Live Agent whose Session owns the optional Draft.
   * @param name - Runtime Skill name.
   * @param signal - Cancels the private API request.
   * @returns Serialized runtime Skill detail for the Remote client.
   */
  @Remote('skill')
  async skill(agent: Agent, name: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.request(String(agent.id), `/v1/skills/${encodeURIComponent(name)}`, { signal }))
  }

  /**
   * Save one Session-private runtime Skill Draft.
   * @param agent - Live Agent whose Session owns the Draft.
   * @param request - Runtime Skill name and complete Draft content.
   * @param signal - Cancels the private API request.
   * @returns Serialized saved Draft metadata.
   */
  @Remote('saveSkillDraft')
  async saveSkillDraft(agent: Agent, request: SkillDraftRequest, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.request(String(agent.id), `/v1/skills/${encodeURIComponent(request.name)}/draft`, {
      method: 'PUT', body: { content: request.content }, signal,
    }))
  }

  /**
   * Validate one Session-private runtime Skill Draft.
   * @param agent - Live Agent whose Session owns the Draft.
   * @param name - Runtime Skill name.
   * @param signal - Cancels the private API request.
   * @returns Serialized validation result.
   */
  @Remote('validateSkill')
  async validateSkill(agent: Agent, name: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.request(String(agent.id), `/v1/skills/${encodeURIComponent(name)}/validate`, {
      method: 'POST', signal,
    }))
  }

  /**
   * Publish one validated immutable runtime Skill version from the application path.
   * @param agent - Live Agent whose Session owns the validated Draft.
   * @param name - Runtime Skill name.
   * @param signal - Cancels the private API request.
   * @returns Serialized immutable version metadata.
   */
  @Remote('publishSkill')
  async publishSkill(agent: Agent, name: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.request(String(agent.id), `/v1/skills/${encodeURIComponent(name)}/publish`, {
      method: 'POST', signal,
    }))
  }

  /**
   * Update a proposed plan through optimistic revision control.
   * @param agent - Live Agent whose Session owns the plan.
   * @param request - Exact base revision and replacement plan.
   * @param signal - Cancels the private API request.
   * @returns Serialized proposed revision.
   */
  @Remote('updatePlan')
  async updatePlan(agent: Agent, request: UpdatePlanRequest, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.request(String(agent.id), `/v1/plans/${encodeURIComponent(request.planId)}`, {
      method: 'PUT', body: { base_revision: request.baseRevision, plan: request.plan }, signal,
    }))
  }

  /**
   * Queue an Agent turn that regenerates decisions and a new plan revision.
   * @param agent - Live Agent that receives the follow-up input.
   * @param request - Exact base revision and user-edited Skill preferences.
   * @param signal - Rejects an already-cancelled request before queueing input.
   * @returns Serialized acknowledgement after the follow-up is queued.
   */
  @Remote('regeneratePlan')
  regeneratePlan(agent: Agent, request: RegeneratePlanRequest, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw signal.reason
    const requestedPlan = JSON.stringify(request.plan)
    agent.followup(createUserMessage({
      source: { kind: 'user' },
      content: [{ type: 'text', text: [
        '请按我在建模方案界面提交的 Skill 顺序和偏好重新生成方案。',
        `现有 plan_id=${request.planId}，base_revision=${request.baseRevision}。`,
        '如果 datasetId 与 profileEvidence.datasetSha256 未变化，必须复用 TaskContext.profileEvidence，不要再次调用 modeling_get_dataset_profile。',
        '按 skillSequence 依次应用已启用的 Skill，根据真实数据画像生成新的 decisions；skillConfigs 只是偏好，不是执行结果。',
        '只能选择 /v1/capabilities 中 Worker 已支持的算法和操作。不要批准或执行方案。',
        '最后调用 modeling_propose_plan，并同时传入 plan、plan_id 和 base_revision，以创建新 revision 供我确认。',
        `界面提交的候选方案：${requestedPlan}`,
      ].join('\n') }],
    }))
    return Promise.resolve(JSON.stringify({ queued: true }))
  }

  /**
   * Cancel the active Session-owned run through the application path.
   * @param agent - Live Agent whose Session owns the Run.
   * @param runId - Run identifier returned by the Modeling API.
   * @param signal - Cancels the private API request.
   * @returns Serialized cancellation state.
   */
  @Remote('cancelRun')
  async cancelRun(agent: Agent, runId: string, signal: AbortSignal): Promise<string> {
    return JSON.stringify(await this.request(String(agent.id), `/v1/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST', signal,
    }))
  }

  /**
   * Read one Session-owned dataset profile.
   * @param sessionId - Trusted Session identity.
   * @param datasetId - Dataset identifier returned by registration.
   * @param signal - Optional request cancellation signal.
   * @returns Bounded aggregate profile from the Modeling API.
   */
  getDatasetProfile(sessionId: string, datasetId: string, signal?: AbortSignal): Promise<ModelingJson> {
    return this.request(sessionId, `/v1/datasets/${encodeURIComponent(datasetId)}/profile`, { ...signal === undefined ? {} : { signal } })
  }

  /**
   * Stream one durable CSV attachment into the Session-owned dataset registry and wait for its profile.
   * @param sessionId - Trusted Session identity.
   * @param file - Durable attachment metadata, including the expected digest and byte count.
   * @param data - Attachment byte stream consumed once by the upload.
   * @param signal - Optional cancellation signal combined with the request timeout.
   * @returns Ready dataset metadata after digest verification and profiling.
   */
  async registerDataset(
    sessionId: string,
    file: FileAttachmentRef,
    data: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<ModelingJson> {
    const operationSignal = signal === undefined
      ? AbortSignal.timeout(this.requestTimeoutMs)
      : AbortSignal.any([signal, AbortSignal.timeout(this.requestTimeoutMs)])
    const boundary = `dsh-modeling-${randomUUID()}`
    const fallbackName = file.name.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_') || 'dataset.csv'
    const disposition = `Content-Disposition: form-data; name="file"; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(file.name)}\r\n`
    const prefix = Buffer.from(`--${boundary}\r\n${disposition}Content-Type: text/csv\r\n\r\n`)
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`)
    const body = Readable.from((async function* (): AsyncIterable<Uint8Array> {
      yield prefix
      for await (const chunk of data) yield chunk
      yield suffix
    })())
    const uploaded = await this.send(sessionId, '/v1/datasets', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(prefix.byteLength + file.bytes + suffix.byteLength),
      },
      body: body as unknown as BodyInit,
      duplex: 'half',
      signal: operationSignal,
    })
    if (uploaded === null || Array.isArray(uploaded) || typeof uploaded !== 'object'
      || typeof uploaded.dataset_id !== 'string' || typeof uploaded.sha256 !== 'string') {
      throw new ModelingGatewayError('INVALID_MODELING_RESPONSE', 'Dataset registration returned an invalid response.', 502)
    }
    const expectedSha256 = String(file.attachmentId).replace(/^sha256:/u, '')
    if (uploaded.sha256 !== expectedSha256) {
      throw new ModelingGatewayError('DATASET_DIGEST_MISMATCH', 'Dataset registration returned a different digest.', 502)
    }
    while (uploaded.state !== 'ready') {
      if (uploaded.state === 'failed') {
        throw new ModelingGatewayError('DATASET_PROFILE_FAILED', 'Dataset profiling failed.', 422)
      }
      await new Promise<void>((resolve, reject) => {
        const aborted = (): void => {
          clearTimeout(timer)
          const reason: unknown = operationSignal.reason
          reject(reason instanceof Error ? reason : new Error('Dataset registration was aborted.'))
        }
        const timer = setTimeout(() => {
          operationSignal.removeEventListener('abort', aborted)
          resolve()
        }, 100)
        operationSignal.addEventListener('abort', aborted, { once: true })
      })
      const current = await this.request(sessionId, `/v1/datasets/${encodeURIComponent(uploaded.dataset_id)}`, {
        signal: operationSignal,
      })
      if (current === null || Array.isArray(current) || typeof current !== 'object') {
        throw new ModelingGatewayError('INVALID_MODELING_RESPONSE', 'Dataset status returned an invalid response.', 502)
      }
      Object.assign(uploaded, current)
    }
    return uploaded
  }

  /**
   * Persist one validated proposal with exact runtime Skill snapshots.
   * @param sessionId - Trusted Session identity.
   * @param plan - Candidate plan validated by the Modeling API.
   * @param snapshots - Immutable runtime Skill identities attached to the proposal.
   * @param signal - Optional request cancellation signal.
   * @returns Persisted proposed plan.
   */
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

  /**
   * Persist an Agent-regenerated proposal as the next optimistic revision.
   * @param sessionId - Trusted Session identity.
   * @param planId - Existing plan identifier.
   * @param baseRevision - Exact revision that the Agent regenerated.
   * @param plan - Replacement candidate plan.
   * @param snapshots - Immutable runtime Skill identities attached to the revision.
   * @param signal - Optional request cancellation signal.
   * @returns Persisted proposed revision.
   */
  revisePlan(
    sessionId: string,
    planId: string,
    baseRevision: number,
    plan: ModelingJson,
    snapshots: readonly ModelingSkillSnapshot[],
    signal?: AbortSignal,
  ): Promise<ModelingJson> {
    return this.request(sessionId, `/v1/plans/${encodeURIComponent(planId)}`, {
      method: 'PUT', body: { base_revision: baseRevision, plan }, ...signal === undefined ? {} : { signal },
      headers: { 'X-Modeling-Skill-Snapshots': JSON.stringify(snapshots) },
    })
  }

  /**
   * Read one Session-owned Run without changing it.
   * @param sessionId - Trusted Session identity.
   * @param runId - Run identifier returned by approval.
   * @param signal - Optional request cancellation signal.
   * @returns Current Run state and bounded node events.
   */
  getRunStatus(sessionId: string, runId: string, signal?: AbortSignal): Promise<ModelingJson> {
    return this.request(sessionId, `/v1/runs/${encodeURIComponent(runId)}`, { ...signal === undefined ? {} : { signal } })
  }

  /**
   * Read one completed Session-owned Run result.
   * @param sessionId - Trusted Session identity.
   * @param runId - Succeeded Run identifier.
   * @param signal - Optional request cancellation signal.
   * @returns Metrics, diagnostics, and completed artifact metadata.
   */
  getRunResult(sessionId: string, runId: string, signal?: AbortSignal): Promise<ModelingJson> {
    return this.request(sessionId, `/v1/runs/${encodeURIComponent(runId)}/result`, { ...signal === undefined ? {} : { signal } })
  }

  /**
   * Approve an exact plan revision from the application Remote path; this is not a model tool.
   * @param agent - Live Agent whose Session owns the plan and receives the new Run identity.
   * @param request - Exact revision, hash, and idempotency key approved by the user.
   * @param signal - Cancels the private API request.
   * @returns Created or replayed Run identity.
   */
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
      if (value.created) agent.inject(createUserMessage({
        source: { kind: 'plugin', plugin: 'modeling' },
        content: [{ type: 'text', text: JSON.stringify({ event: 'modeling_run_approved', plan_id: request.planId, revision: request.revision, plan_hash: request.planHash, run_id: value.run_id }) }],
      }))
      return { run_id: value.run_id, created: value.created }
    })
  }

  /**
   * Approve a newer revision and create a distinct Run from a terminal source; this is not a model tool.
   * @param agent - Live Agent whose Session owns both Runs and receives the new Run identity.
   * @param request - Source Run, exact revision, hash, and idempotency key approved by the user.
   * @param signal - Cancels the private API request.
   * @returns Created or replayed Run identity.
   */
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
      if (value.created) agent.inject(createUserMessage({
        source: { kind: 'plugin', plugin: 'modeling' },
        content: [{ type: 'text', text: JSON.stringify({ event: 'modeling_run_approved', plan_id: request.planId, revision: request.revision, plan_hash: request.planHash, run_id: value.run_id }) }],
      }))
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
    return this.send(sessionId, path, {
      method: options.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options.body === undefined ? {} : { body: JSON.stringify(options.body) },
      ...options.signal === undefined ? {} : { signal: options.signal },
    })
  }

  private async send(
    sessionId: string,
    path: string,
    options: RequestInit & { duplex?: 'half' },
  ): Promise<ModelingJson> {
    const timeout = AbortSignal.timeout(this.requestTimeoutMs)
    const signal = options.signal == null ? timeout : AbortSignal.any([options.signal, timeout])
    let response: Response
    try {
      const headers = new Headers(options.headers)
      headers.set('X-Session-Id', sessionId)
      response = await fetch(new URL(path, this.baseUrl), {
        ...options,
        headers,
        signal,
      })
    } catch (error) {
      throw new ModelingGatewayError('MODELING_API_UNAVAILABLE', error instanceof Error ? error.message : String(error), 503, true)
    }
    const value: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const item = value !== null && typeof value === 'object' && 'error' in value ? value.error : undefined
      const detail = item !== null && typeof item === 'object' ? item as Record<string, unknown> : {}
      const nested = detail.details !== null && typeof detail.details === 'object' && !Array.isArray(detail.details)
        ? detail.details as Record<string, ModelingJson> : {}
      const details: Record<string, ModelingJson> = {
        ...nested,
        ...typeof detail.request_id === 'string' ? { request_id: detail.request_id } : {},
      }
      throw new ModelingGatewayError(
        typeof detail.code === 'string' ? detail.code : 'MODELING_API_ERROR',
        typeof detail.message === 'string' ? detail.message : `Modeling API returned HTTP ${response.status}`,
        response.status,
        detail.retryable === true,
        Object.keys(details).length === 0 ? undefined : details,
      )
    }
    return value as ModelingJson
  }
}

export type * from './types.ts'
export default ModelingGateway
