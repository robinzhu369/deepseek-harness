import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ApproveAndRunRequest, RerunRequest } from '../src/types.ts'
import { ModelingClientModel, parseWorkspace, type ModelingRemote } from '../src/client/model.ts'

const sessionId = 'session-ui' as SessionId

function workspace(revision: number, status: 'running' | 'succeeded' = 'running'): string {
  return JSON.stringify({
    dataset: { dataset_id: 'dataset-1', original_name: 'sample.csv', size_bytes: 128, state: 'ready', profile: { row_count: 12 }, error: null },
    plan: { id: 'plan-1', revision: 2, plan_hash: 'hash-2', state: 'proposed', plan: { target: 'label' }, invalidation: null },
    run: { id: 'run-1', revision, plan_revision: 1, created_at: '2026-09-20T00:00:00Z', status, nodes: [{}], events: [{}], error: null },
    result: status === 'succeeded' ? { metrics: { test: { roc_auc: 0.7 } }, feature_summary: {}, artifacts: [], warnings: [] } : null,
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
    approveAndRun: vi.fn(async () => ({ run_id: 'run-1', created: true })),
    rerun: vi.fn(async () => ({ run_id: 'run-2', created: true })),
    cancelRun: vi.fn(async () => '{}'),
    ...overrides,
  }
}

describe('ModelingClientModel', () => {
  it('validates the bounded workspace response', () => {
    expect(parseWorkspace(workspace(3)).run?.revision).toBe(3)
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
})
