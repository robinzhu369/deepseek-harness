import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ApproveAndRunRequest, RerunRequest } from '../src/types.ts'
import { modelingFixture } from '../src/client/fixtures.ts'
import { ModelingClientModel, parseWorkspace, type ModelingRemote } from '../src/client/model.ts'

const sessionId = 'session-ui' as SessionId

function workspace(revision: number, status: 'running' | 'succeeded' | 'interrupted' = 'running'): string {
  return JSON.stringify({
    dataset: { dataset_id: 'dataset-1', original_name: 'sample.csv', size_bytes: 128, state: 'ready', profile: { row_count: 12 }, error: null },
    plan: { id: 'plan-1', revision: 2, plan_hash: 'hash-2', state: 'proposed', plan: { target: 'label' }, invalidation: null },
    run: { id: 'run-1', revision, plan_revision: 1, created_at: '2026-09-20T00:00:00Z', status, nodes: [{}], events: [{}], error: null },
    result: status === 'succeeded' ? {
      metrics: { test: { roc_auc: 0.7, precision: 0.6, recall: 0.5 } },
      diagnostics: [{ code: 'low_recall' }], recommendations: [{ code: 'consider_lower_threshold' }],
      feature_summary: {}, artifacts: [], warnings: [],
    } : null,
    runs: [],
  })
}

function rerunWorkspace(): string {
  const parsed = JSON.parse(workspace(5, 'succeeded')) as Record<string, unknown>
  parsed.runs = [{
    id: 'run-1', plan_revision: 1, status: 'succeeded', created_at: '2026-09-20T00:00:00Z',
    completed_at: '2026-09-20T00:00:01Z', rerun_of: null, metrics: { test: { roc_auc: 0.7 } },
  }]
  return JSON.stringify(parsed)
}

function remote(overrides: Partial<ModelingRemote> = {}): ModelingRemote {
  return {
    workspace: vi.fn(async () => workspace(1)),
    capabilities: vi.fn(async () => '{}'),
    skills: vi.fn(async () => '{"items":[]}'),
    skill: vi.fn(async () => '{}'),
    saveSkillDraft: vi.fn(async () => '{}'),
    validateSkill: vi.fn(async () => '{}'),
    publishSkill: vi.fn(async () => '{}'),
    updatePlan: vi.fn(async () => '{}'),
    regeneratePlan: vi.fn(async () => '{"queued":true}'),
    approveAndRun: vi.fn(async () => ({ run_id: 'run-1', created: true })),
    rerun: vi.fn(async () => ({ run_id: 'run-2', created: true })),
    cancelRun: vi.fn(async () => '{}'),
    ...overrides,
  }
}

describe('ModelingClientModel', () => {
  it('accepts a new run whose revision starts below the previous run', async () => {
    let response = workspace(9, 'succeeded')
    const model = new ModelingClientModel(sessionId, remote({ workspace: vi.fn(async () => response) }))
    try {
      model.activate()
      await model.refresh()
      response = workspace(1).replace('"id":"run-1"', '"id":"run-2"')
      await model.refresh()
      expect(model.source.getSnapshot().run).toMatchObject({ id: 'run-2', revision: 1 })
    } finally { model.dispose() }
  })

  it('does not approve a revision from a stale conversation card', async () => {
    const approveAndRun = vi.fn(async () => ({ run_id: 'run-1', created: true }))
    const api = remote({ approveAndRun })
    const model = new ModelingClientModel(sessionId, api)
    try {
      model.activate()
      await model.refresh()
      await model.approve({ id: 'plan-1', revision: 1, plan_hash: 'hash-1' })
      expect(approveAndRun).not.toHaveBeenCalled()
      await model.approve({ id: 'plan-1', revision: 2, plan_hash: 'hash-2' })
      expect(approveAndRun).toHaveBeenCalledOnce()
    } finally { model.dispose() }
  })

  it('keeps the shared projection active until the last card unmounts', async () => {
    const readWorkspace = vi.fn(async () => workspace(1))
    const api = remote({ workspace: readWorkspace })
    const model = new ModelingClientModel(sessionId, api)
    try {
      model.activate()
      model.activate()
      await model.refresh()
      model.deactivate()
      const before = readWorkspace.mock.calls.length
      await model.refresh()
      expect(readWorkspace).toHaveBeenCalledTimes(before + 1)
      model.deactivate()
      await model.refresh()
      expect(readWorkspace).toHaveBeenCalledTimes(before + 1)
    } finally { model.dispose() }
  })
  it('queues Skill regeneration against the exact visible plan revision', async () => {
    const regeneratePlan = vi.fn(async () => '{"queued":true}')
    const model = new ModelingClientModel(sessionId, remote({ regeneratePlan }))
    model.activate()
    await vi.waitFor(() => { expect(model.source.getSnapshot().plan?.id).toBe('plan-1') })
    await model.regeneratePlan({ task_context: { skillSequence: ['data-analysis', 'model-training'] } })
    expect(regeneratePlan).toHaveBeenCalledWith(sessionId, {
      planId: 'plan-1', baseRevision: 2,
      plan: { task_context: { skillSequence: ['data-analysis', 'model-training'] } },
    }, expect.any(AbortSignal))
    model.dispose()
  })

  it('keeps visual-review fixtures coherent and visibly isolated from live mode', () => {
    expect(modelingFixture('empty')).toMatchObject({ mode: 'fixture', dataset: null, run: null })
    expect(modelingFixture('proposed')).toMatchObject({ mode: 'fixture', plan: { state: 'proposed' }, run: null, result: null })
    expect(modelingFixture('running')).toMatchObject({ mode: 'fixture', plan: { state: 'approved' }, run: { status: 'running' }, result: null })
    expect(modelingFixture('succeeded')).toMatchObject({ mode: 'fixture', run: { status: 'succeeded' }, result: { metrics: { test: { f1: 0 } } } })
    expect(modelingFixture('failed')).toMatchObject({ mode: 'fixture', run: { status: 'failed', error: { code: 'PIPELINE_FAILED' } }, result: null })
  })

  it('validates the bounded workspace response', () => {
    expect(parseWorkspace(workspace(3)).run?.revision).toBe(3)
    expect(parseWorkspace(workspace(3, 'succeeded')).result).toMatchObject({
      diagnostics: [{ code: 'low_recall' }], recommendations: [{ code: 'consider_lower_threshold' }],
    })
    expect(() => parseWorkspace(JSON.stringify({ run: { id: 'run-1', revision: 1, status: 'invented' } }))).toThrow('Unknown modeling run status')
  })

  it('ignores a stale run revision and stops polling at a terminal state', async () => {
    vi.useFakeTimers()
    const calls = vi.fn()
      .mockResolvedValueOnce(workspace(4, 'running'))
      .mockResolvedValueOnce(workspace(3, 'running'))
      .mockResolvedValueOnce(workspace(5, 'succeeded'))
    const model = new ModelingClientModel(sessionId, remote({ workspace: calls }))
    model.activate()
    await vi.waitFor(() => { expect(model.source.getSnapshot().run?.revision).toBe(4) })
    await model.refresh()
    expect(model.source.getSnapshot().run?.revision).toBe(4)
    await model.refresh()
    expect(model.source.getSnapshot().run?.status).toBe('succeeded')
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls).toHaveBeenCalledTimes(3)
    model.dispose()
    vi.useRealTimers()
  })

  it('restores an interrupted run as a terminal state without polling again', async () => {
    vi.useFakeTimers()
    const calls = vi.fn(async () => workspace(6, 'interrupted'))
    const model = new ModelingClientModel(sessionId, remote({ workspace: calls }))
    model.activate()
    await vi.advanceTimersByTimeAsync(0)
    expect(model.source.getSnapshot().run?.status).toBe('interrupted')
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls).toHaveBeenCalledTimes(1)
    model.dispose()
    vi.useRealTimers()
  })

  it('coalesces a double confirmation into one idempotent approval', async () => {
    let resolveApproval: (() => void) | undefined
    const approve = vi.fn((
      _sessionId: SessionId, _request: ApproveAndRunRequest, _signal: AbortSignal,
    ) => new Promise<{ run_id: string; created: boolean }>((resolve) => {
      resolveApproval = () => { resolve({ run_id: 'run-1', created: true }) }
    }))
    const model = new ModelingClientModel(sessionId, remote({ workspace: vi.fn(async () => workspace(1)), approveAndRun: approve }))
    model.activate()
    await vi.waitFor(() => { expect(model.source.getSnapshot().phase).toBe('ready') })
    const first = model.approve()
    const second = model.approve()
    expect(approve).toHaveBeenCalledTimes(1)
    expect(approve.mock.calls[0]?.[1].idempotencyKey).toBe('ui:session-ui:plan-1:2:hash-2')
    resolveApproval?.()
    await Promise.all([first, second])
    model.dispose()
  })

  it('coalesces a double rerun confirmation and preserves the source run identity', async () => {
    let resolveRerun: (() => void) | undefined
    const rerun = vi.fn((
      _sessionId: SessionId, _request: RerunRequest, _signal: AbortSignal,
    ) => new Promise<{ run_id: string; created: boolean }>((resolve) => {
      resolveRerun = () => { resolve({ run_id: 'run-2', created: true }) }
    }))
    const approveAndRun = vi.fn(async () => ({ run_id: 'unexpected', created: true }))
    const model = new ModelingClientModel(sessionId, remote({
      workspace: vi.fn(async () => rerunWorkspace()), rerun, approveAndRun,
    }))
    model.activate()
    await vi.waitFor(() => { expect(model.source.getSnapshot().phase).toBe('ready') })
    const first = model.approve()
    const second = model.approve()
    expect(rerun).toHaveBeenCalledTimes(1)
    expect(approveAndRun).not.toHaveBeenCalled()
    expect(rerun.mock.calls[0]?.[1]).toMatchObject({
      sourceRunId: 'run-1', planId: 'plan-1', revision: 2, planHash: 'hash-2',
      idempotencyKey: 'ui:rerun:session-ui:run-1:2:hash-2',
    })
    resolveRerun?.()
    await Promise.all([first, second])
    model.dispose()
  })

  it('uses the slower polling cadence while the page is hidden', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('document', {
      hidden: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    const calls = vi.fn(async () => workspace(1))
    const model = new ModelingClientModel(sessionId, remote({ workspace: calls }))
    model.activate()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3999)
    expect(calls).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toHaveBeenCalledTimes(2)
    model.dispose()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('preserves structured error coordinates for the failure card', async () => {
    const failure = Object.assign(new Error('The plan revision is not current.'), {
      code: 'PLAN_REVISION_CONFLICT', details: { request_id: 'req-t11' },
    })
    const model = new ModelingClientModel(sessionId, remote({ workspace: vi.fn(async () => { throw failure }) }))
    model.activate()
    await vi.waitFor(() => { expect(model.source.getSnapshot().phase).toBe('error') })
    expect(model.source.getSnapshot().error).toEqual({
      message: 'The plan revision is not current.', code: 'PLAN_REVISION_CONFLICT', requestId: 'req-t11',
    })
    model.dispose()
  })

  it('does not publish a late response after the Session view deactivates', async () => {
    let resolveWorkspace: ((value: string) => void) | undefined
    const pending = new Promise<string>((resolve) => { resolveWorkspace = resolve })
    const model = new ModelingClientModel(sessionId, remote({ workspace: vi.fn(() => pending) }))
    model.activate()
    model.deactivate()
    resolveWorkspace?.(workspace(9, 'succeeded'))
    await pending
    await Promise.resolve()
    expect(model.source.getSnapshot().phase).toBe('loading')
    expect(model.source.getSnapshot().run).toBeNull()
    model.dispose()
  })
})
