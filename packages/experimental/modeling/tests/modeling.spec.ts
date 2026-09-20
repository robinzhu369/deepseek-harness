import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { readdir, readFile } from 'node:fs/promises'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { ModelingGatewayError, type ModelingGateway } from '../src/index.ts'
import { createModelingTools } from '../src/tools.ts'
import type { ModelingJson, ModelingSkillSnapshot } from '../src/types.ts'

const signal = new AbortController().signal
const snapshots = ['data-analysis', 'data-cleaning', 'feature-engineering', 'model-training'].map(name => ({
  name, version: '0.1.0-demo', sha256: 'a'.repeat(64),
}))

function gateway(overrides: Partial<ModelingGateway> = {}): ModelingGateway {
  return {
    maxToolResultBytes: 4096,
    getDatasetProfile: async (sessionId: string) => ({ row_count: 12, session_id: sessionId, storage_key: '/private/data.csv' }),
    proposePlan: async (_sessionId: string, _plan: ModelingJson, skillSnapshots: readonly ModelingSkillSnapshot[]) => ({ id: 'plan_1', revision: 1, plan_hash: 'hash', skill_snapshots: skillSnapshots as never }),
    getRunStatus: async () => ({ id: 'run_1', status: 'running', worker_pid: 123 }),
    getRunResult: async () => ({ metrics: { roc_auc: 0.75 }, storage_key: '/private/result' }),
    ...overrides,
  } as unknown as ModelingGateway
}

async function mount(definitions: ToolDefinition[]): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  const agent = { id: 'session-a' as SessionId } as Agent
  await ctx.plugin(Object.assign((inner: Context) => {
    const scope = createScope(inner, agent)
    inner.tools.register({
      name: 'bash', description: 'unrestricted shell', parameters: {},
      output: { schema: { type: 'object', additionalProperties: true }, render: () => [] }, execute: async () => ({}),
    })
    for (const definition of definitions) scope.ctx.tools.register(definition)
    scope.ctx.tools.restrict({ allow: [] })
  }, { inject: ['tools', 'systemPrompt'] }))
  return { ctx, agent }
}

async function call(ctx: Context, agent: Agent, name: string, args: unknown): Promise<Record<string, unknown>> {
  const response = await ctx.tools.execute({ signal, agent, callId: ToolCallId(`call-${name}`), name, arguments: args })
  const first = response.content[0]
  if (first?.type !== 'text') throw new Error('expected text tool result')
  return JSON.parse(first.text) as Record<string, unknown>
}

describe('ModelX bounded tools', () => {
  it('loads only the four runtime business Skills from the isolated root', async () => {
    const root = new URL('../../../../.dsh/skills/', import.meta.url)
    const entries = (await readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
    expect(entries).toEqual(['data-analysis', 'data-cleaning', 'feature-engineering', 'model-training'])
    for (const name of entries) {
      const content = await readFile(new URL(`${name}/SKILL.md`, root), 'utf8')
      expect(content).toMatch(/version: 0\.[12]\.0-demo/)
      expect(content).not.toContain('modelx-demo-orchestrator')
    }
  })

  it('exposes exactly four domain tools and hides inherited shell access', async () => {
    const { ctx, agent } = await mount(createModelingTools(gateway(), snapshots))
    expect(ctx.tools.schemas(agent).map(item => item.name).sort()).toEqual([
      'modeling_get_dataset_profile', 'modeling_get_run_result',
      'modeling_get_run_status', 'modeling_propose_plan',
    ])
    expect(ctx.tools.get('bash', agent)).toBeUndefined()
    expect(ctx.tools.get('modeling_approve_and_run', agent)).toBeUndefined()
  })

  it('derives the session from the caller and removes private service fields', async () => {
    let observed = ''
    const fake = gateway({
      getDatasetProfile: async (sessionId) => {
        observed = sessionId
        return { row_count: 12, session_id: 'secret-session', path: '/private/data.csv' }
      },
    })
    const { ctx, agent } = await mount(createModelingTools(fake, snapshots))
    const value = await call(ctx, agent, 'modeling_get_dataset_profile', { dataset_id: 'dataset_1' })
    expect(observed).toBe('session-a')
    expect(JSON.stringify(value)).not.toContain('secret-session')
    expect(JSON.stringify(value)).not.toContain('/private/data.csv')
  })

  it('proposes with four Skill snapshots and cannot create a run', async () => {
    let observedSnapshots: readonly unknown[] = []
    let runStarts = 0
    const fake = gateway({
      proposePlan: async (_sessionId, _plan, received) => {
        observedSnapshots = received
        return { id: 'plan_1', revision: 1, plan_hash: 'hash', state: 'proposed' }
      },
      approveAndRun: async () => { runStarts += 1; return { run_id: 'run_1', created: true } },
    })
    const { ctx, agent } = await mount(createModelingTools(fake, snapshots))
    const value = await call(ctx, agent, 'modeling_propose_plan', { plan: { dataset_id: 'dataset_1' } })
    expect(value.needs_confirmation).toBe(true)
    expect(observedSnapshots).toHaveLength(4)
    expect(runStarts).toBe(0)
  })

  it('returns structured validation errors and enforces the UTF-8 result cap', async () => {
    const invalid = gateway({
      proposePlan: async () => {
        throw new ModelingGatewayError('UNKNOWN_OPERATOR', 'Unsupported operator.', 422, false, { field: 'categorical_encoding' })
      },
    })
    const first = await mount(createModelingTools(invalid, snapshots))
    expect(await call(first.ctx, first.agent, 'modeling_propose_plan', { plan: {} })).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN_OPERATOR', message: 'Unsupported operator.', retryable: false,
        details: { field: 'categorical_encoding' },
      },
    })

    const oversized = gateway({ maxToolResultBytes: 256, getRunResult: async () => ({ report: 'x'.repeat(1000) }) })
    const second = await mount(createModelingTools(oversized, snapshots))
    const value = await call(second.ctx, second.agent, 'modeling_get_run_result', { run_id: 'run_1' })
    expect((value.error as Record<string, unknown>).code).toBe('RESULT_TOO_LARGE')
  })
})
