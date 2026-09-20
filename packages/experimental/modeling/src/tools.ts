/** Four bounded model-facing tools for the ModelX preset. */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { ModelingGatewayError, type ModelingGateway } from './index.ts'
import type { ModelingJson, ModelingSkillSnapshot } from './types.ts'

export const name = 'modeling-tools'
export const inject = ['modeling', 'tools']
const SKILL_NAMES = ['data-analysis', 'data-cleaning', 'feature-engineering', 'model-training'] as const
const PRIVATE_KEYS = new Set(['session_id', 'storage_key', 'worker_pid', 'dataset_path', 'path'])
type ToolResult = Record<string, ModelingJson>

/** Runtime Skill root used exclusively by this preset. */
export interface Config { runtimeSkillDir: string }
export const Config: z<Config> = z.object({ runtimeSkillDir: z.string().required() })

function caller(agent: Agent | undefined, tool: string): string {
  if (agent === undefined) throw new Error(`${tool} requires a live Agent`)
  return String(agent.id)
}

function publicValue(value: ModelingJson): ModelingJson {
  if (Array.isArray(value)) return value.map(publicValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !PRIVATE_KEYS.has(key))
        .map(([key, item]) => [key, publicValue(item)]),
    )
  }
  return value
}

function profileSummary(value: ModelingJson): ToolResult {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new Error('dataset profile must be an object')
  const columns = Array.isArray(value.columns) ? value.columns : []
  const targetCandidates = columns.flatMap((item) => {
    if (item === null || Array.isArray(item) || typeof item !== 'object' || typeof item.name !== 'string') return []
    const cardinality = item.categorical !== null && typeof item.categorical === 'object'
      && !Array.isArray(item.categorical) && typeof item.categorical.cardinality === 'number'
      ? item.categorical.cardinality : undefined
    return /^(label|target|outcome|default|fraud|churn)$/i.test(item.name) || cardinality === 2 ? [item.name] : []
  })
  const missingSummary = columns.flatMap((item) => {
    if (item === null || Array.isArray(item) || typeof item !== 'object'
      || typeof item.name !== 'string' || typeof item.missing_ratio !== 'number') return []
    return [{ column: item.name, missing_ratio: item.missing_ratio }]
  })
  const warnings = targetCandidates.length === 1
    ? []
    : [targetCandidates.length === 0 ? 'No binary target candidate was identified.' : 'Multiple target candidates require confirmation.']
  return {
    row_count: value.row_count ?? null,
    column_count: value.column_count ?? null,
    columns,
    missing_summary: missingSummary,
    target_candidates: targetCandidates,
    computation_scope: value.computation_scope ?? null,
    warnings,
  }
}

function result(value: ToolResult, maxBytes: number): ToolResult {
  const sanitized = publicValue(value)
  if (Buffer.byteLength(JSON.stringify(sanitized), 'utf8') > maxBytes) {
    return { ok: false, error: { code: 'RESULT_TOO_LARGE', message: 'The bounded modeling result exceeded the configured limit.', retryable: false } }
  }
  if (sanitized === null || Array.isArray(sanitized) || typeof sanitized !== 'object') throw new Error('tool result must be an object')
  return sanitized
}

function failure(error: unknown): ToolResult {
  if (error instanceof ModelingGatewayError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        ...error.details === undefined ? {} : { details: error.details },
      },
    }
  }
  return { ok: false, error: { code: 'MODELING_TOOL_FAILED', message: error instanceof Error ? error.message : String(error), retryable: false } }
}

async function snapshots(root: string): Promise<ModelingSkillSnapshot[]> {
  return await Promise.all(SKILL_NAMES.map(async (name) => {
    const content = await readFile(join(root, name, 'SKILL.md'), 'utf8')
    const match = /^\s{2}version:\s*([^\s]+)\s*$/m.exec(content)
    if (match?.[1] === undefined) throw new Error(`runtime Skill ${name} lacks metadata.version`)
    return { name, version: match[1], sha256: createHash('sha256').update(content).digest('hex') }
  }))
}

const output = {
  schema: { type: 'object', additionalProperties: true } as const,
  render: (_args: unknown, value: ToolResult) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

/** Create the exact model-visible tool set; exported for permission and isolation tests. */
export function createModelingTools(
  gateway: ModelingGateway,
  skillSnapshots: readonly ModelingSkillSnapshot[] | (() => Promise<ModelingSkillSnapshot[]>),
): ToolDefinition[] {
  return [
    defineTool({
      name: 'modeling_get_dataset_profile',
      description: 'Read a bounded aggregate profile for one dataset owned by this session.',
      parameters: { dataset_id: { type: 'string', required: true } }, output,
      async execute(args, exec) {
        try {
          const profile = await gateway.getDatasetProfile(caller(exec.agent, 'modeling_get_dataset_profile'), args.dataset_id, exec.signal)
          return result({ ok: true, profile: profileSummary(profile) }, gateway.maxToolResultBytes)
        }
        catch (error) { return failure(error) }
      },
    }),
    defineTool({
      name: 'modeling_propose_plan',
      description: 'Validate and persist a plan proposal. This never approves or starts a run.',
      parameters: { plan: { type: 'json', required: true } }, output,
      async execute(args, exec) {
        try {
          const currentSnapshots = typeof skillSnapshots === 'function' ? await skillSnapshots() : skillSnapshots
          const plan = await gateway.proposePlan(caller(exec.agent, 'modeling_propose_plan'), args.plan, currentSnapshots, exec.signal)
          return result({ ok: true, plan, needs_confirmation: true }, gateway.maxToolResultBytes)
        } catch (error) { return failure(error) }
      },
    }),
    defineTool({
      name: 'modeling_get_run_status',
      description: 'Read current state and bounded node events for one run owned by this session.',
      parameters: { run_id: { type: 'string', required: true } }, output,
      async execute(args, exec) {
        try { return result({ ok: true, run: await gateway.getRunStatus(caller(exec.agent, 'modeling_get_run_status'), args.run_id, exec.signal) }, gateway.maxToolResultBytes) }
        catch (error) { return failure(error) }
      },
    }),
    defineTool({
      name: 'modeling_get_run_result',
      description: 'Read metrics, manifest summary, and completed artifact metadata for one succeeded run owned by this session.',
      parameters: { run_id: { type: 'string', required: true } }, output,
      async execute(args, exec) {
        try { return result({ ok: true, result: await gateway.getRunResult(caller(exec.agent, 'modeling_get_run_result'), args.run_id, exec.signal) }, gateway.maxToolResultBytes) }
        catch (error) { return failure(error) }
      },
    }),
  ]
}

/** Register the four tools after pinning the runtime Skill snapshots. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await snapshots(config.runtimeSkillDir)
  for (const tool of createModelingTools(ctx.modeling, () => snapshots(config.runtimeSkillDir))) ctx.effect(() => ctx.tools.register(tool))
}
