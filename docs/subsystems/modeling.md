# Modeling

English | [中文](modeling.zh.md)

The experimental Modeling subsystem connects a dedicated Agent and the Web Client to the deterministic modeling API. Model-facing tools can inspect data, propose validated plans, and read run results; only the application-facing Remote methods can approve a plan or request a rerun.

## Ownership

| Owner | Responsibility |
|---|---|
| [Modeling package](../../packages/experimental/modeling/README.md) | Host adapter, bounded tools, approval Remote, Client state, and workbench UI |
| [Modeling API](../../services/modeling-api/README.md) | Dataset profiling, plan validation, execution, persistence, and artifact access |

## Runtime model

`ctx.modeling` sends the live Session identity with every private API request. The four model-facing tools derive that identity from the calling Agent and never expose approval. The Client uses Session-scoped state for plan revisions, polling, results, and artifact downloads.

Runtime Skills are loaded from an explicit root and hashed before a plan proposal records their snapshots. The Modeling preset masks inherited general-purpose tools, so the Agent cannot gain shell, filesystem mutation, arbitrary HTTP, SQL, or Python execution through this subsystem.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmodeling--modelinggateway"></a>

### `ctx.modeling` — `ModelingGateway`

Host-only HTTP client. Session identity always comes from the live Agent.

```ts cordis-catalog
/**
 * Restore the latest bounded Dataset, Plan, Run, and Result for the live Session.
 * @param agent - Live Agent whose Session owns the workspace.
 * @param signal - Cancels the private API request.
 * @returns Serialized workspace state for the Remote client.
 */
@Remote('workspace') async workspace(agent: Agent, signal: AbortSignal): Promise<string>

/**
 * Read executor-owned choices used by the controlled plan form.
 * @param agent - Live Agent whose Session scopes the request.
 * @param signal - Cancels the private API request.
 * @returns Serialized executor capabilities for the Remote client.
 */
@Remote('capabilities') async capabilities(agent: Agent, signal: AbortSignal): Promise<string>

/**
 * List the five runtime Skills with only this Session's Draft metadata.
 * @param agent - Live Agent whose Session owns any Draft metadata.
 * @param signal - Cancels the private API request.
 * @returns Serialized runtime Skill summaries for the Remote client.
 */
@Remote('skills') async skills(agent: Agent, signal: AbortSignal): Promise<string>

/**
 * Read one published runtime Skill and this Session's optional Draft.
 * @param agent - Live Agent whose Session owns the optional Draft.
 * @param name - Runtime Skill name.
 * @param signal - Cancels the private API request.
 * @returns Serialized runtime Skill detail for the Remote client.
 */
@Remote('skill') async skill(agent: Agent, name: string, signal: AbortSignal): Promise<string>

/**
 * Save one Session-private runtime Skill Draft.
 * @param agent - Live Agent whose Session owns the Draft.
 * @param request - Runtime Skill name and complete Draft content.
 * @param signal - Cancels the private API request.
 * @returns Serialized saved Draft metadata.
 */
@Remote('saveSkillDraft') async saveSkillDraft(agent: Agent, request: SkillDraftRequest, signal: AbortSignal): Promise<string>

/**
 * Validate one Session-private runtime Skill Draft.
 * @param agent - Live Agent whose Session owns the Draft.
 * @param name - Runtime Skill name.
 * @param signal - Cancels the private API request.
 * @returns Serialized validation result.
 */
@Remote('validateSkill') async validateSkill(agent: Agent, name: string, signal: AbortSignal): Promise<string>

/**
 * Publish one validated immutable runtime Skill version from the application path.
 * @param agent - Live Agent whose Session owns the validated Draft.
 * @param name - Runtime Skill name.
 * @param signal - Cancels the private API request.
 * @returns Serialized immutable version metadata.
 */
@Remote('publishSkill') async publishSkill(agent: Agent, name: string, signal: AbortSignal): Promise<string>

/**
 * Update a proposed plan through optimistic revision control.
 * @param agent - Live Agent whose Session owns the plan.
 * @param request - Exact base revision and replacement plan.
 * @param signal - Cancels the private API request.
 * @returns Serialized proposed revision.
 */
@Remote('updatePlan') async updatePlan(agent: Agent, request: UpdatePlanRequest, signal: AbortSignal): Promise<string>

/**
 * Queue an Agent turn that regenerates decisions and a new plan revision.
 * @param agent - Live Agent that receives the follow-up input.
 * @param request - Exact base revision and user-edited Skill preferences.
 * @param signal - Rejects an already-cancelled request before queueing input.
 * @returns Serialized acknowledgement after the follow-up is queued.
 */
@Remote('regeneratePlan') regeneratePlan(agent: Agent, request: RegeneratePlanRequest, signal: AbortSignal): Promise<string>

/**
 * Cancel the active Session-owned run through the application path.
 * @param agent - Live Agent whose Session owns the Run.
 * @param runId - Run identifier returned by the Modeling API.
 * @param signal - Cancels the private API request.
 * @returns Serialized cancellation state.
 */
@Remote('cancelRun') async cancelRun(agent: Agent, runId: string, signal: AbortSignal): Promise<string>

/**
 * Read one Session-owned dataset profile.
 * @param sessionId - Trusted Session identity.
 * @param datasetId - Dataset identifier returned by registration.
 * @param signal - Optional request cancellation signal.
 * @returns Bounded aggregate profile from the Modeling API.
 */
getDatasetProfile(sessionId: string, datasetId: string, signal?: AbortSignal): Promise<ModelingJson>

/**
 * Stream one durable CSV attachment into the Session-owned dataset registry and wait for its profile.
 * @param sessionId - Trusted Session identity.
 * @param file - Durable attachment metadata, including the expected digest and byte count.
 * @param data - Attachment byte stream consumed once by the upload.
 * @param signal - Optional cancellation signal combined with the request timeout.
 * @returns Ready dataset metadata after digest verification and profiling.
 */
async registerDataset( sessionId: string, file: FileAttachmentRef, data: AsyncIterable<Uint8Array>, signal?: AbortSignal, ): Promise<ModelingJson>

/**
 * Persist one validated proposal with exact runtime Skill snapshots.
 * @param sessionId - Trusted Session identity.
 * @param plan - Candidate plan validated by the Modeling API.
 * @param snapshots - Immutable runtime Skill identities attached to the proposal.
 * @param signal - Optional request cancellation signal.
 * @returns Persisted proposed plan.
 */
proposePlan( sessionId: string, plan: ModelingJson, snapshots: readonly ModelingSkillSnapshot[], signal?: AbortSignal, ): Promise<ModelingJson>

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
revisePlan( sessionId: string, planId: string, baseRevision: number, plan: ModelingJson, snapshots: readonly ModelingSkillSnapshot[], signal?: AbortSignal, ): Promise<ModelingJson>

/**
 * Read one Session-owned Run without changing it.
 * @param sessionId - Trusted Session identity.
 * @param runId - Run identifier returned by approval.
 * @param signal - Optional request cancellation signal.
 * @returns Current Run state and bounded node events.
 */
getRunStatus(sessionId: string, runId: string, signal?: AbortSignal): Promise<ModelingJson>

/**
 * Read one completed Session-owned Run result.
 * @param sessionId - Trusted Session identity.
 * @param runId - Succeeded Run identifier.
 * @param signal - Optional request cancellation signal.
 * @returns Metrics, diagnostics, and completed artifact metadata.
 */
getRunResult(sessionId: string, runId: string, signal?: AbortSignal): Promise<ModelingJson>

/**
 * Approve an exact plan revision from the application Remote path; this is not a model tool.
 * @param agent - Live Agent whose Session owns the plan and receives the new Run identity.
 * @param request - Exact revision, hash, and idempotency key approved by the user.
 * @param signal - Cancels the private API request.
 * @returns Created or replayed Run identity.
 */
@Remote('approveAndRun') approveAndRun(agent: Agent, request: ApproveAndRunRequest, signal: AbortSignal): Promise<ApproveAndRunResult>

/**
 * Approve a newer revision and create a distinct Run from a terminal source; this is not a model tool.
 * @param agent - Live Agent whose Session owns both Runs and receives the new Run identity.
 * @param request - Source Run, exact revision, hash, and idempotency key approved by the user.
 * @param signal - Cancels the private API request.
 * @returns Created or replayed Run identity.
 */
@Remote('rerun') rerun(agent: Agent, request: RerunRequest, signal: AbortSignal): Promise<ApproveAndRunResult>
```

Types: [Agent](core.md) · [FileAttachmentRef](attachment.md)

Source: [`packages/experimental/modeling/src/index.ts`](../../packages/experimental/modeling/src/index.ts)
<!-- END GENERATED cordis-surface -->
