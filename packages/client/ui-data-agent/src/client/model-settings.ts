/** Workbench model profiles use the existing settings and write-only credential services. */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { z } from 'zod'
const Profile = z.object({
  displayName: z.string().optional(),
  baseURL: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  reasoning: z.string().optional(),
  timeoutMs: z.number().optional(),
  compat: z.object({ thinkingFormat: z.string().optional() }).optional(),
  models: z
    .array(
      z.object({ id: z.string(), contextWindow: z.number().optional(), maxTokens: z.number().optional() }),
    )
    .optional(),
})
/** One explicitly named model route, with no credential value in reads. */
export type ModelDraft = {
  id: string
  name: string
  baseURL: string
  model: string
  format: 'openai' | 'deepseek'
  reasoning: 'default' | 'off' | 'low' | 'medium' | 'high' | 'max'
  contextWindow: number
  maxTokens: number
  timeoutMs: number
}
/** Joined editable profiles and optimistic concurrency revision. */
export type ModelSettings = {
  namespace: SettingsNamespaceView
  writable: boolean
  rows: (ModelDraft & { configured: boolean })[]
}
/** Operations injected into the configuration dialog; secrets are only accepted by save. */
export interface ModelSettingsOperations {
  load(): Promise<ModelSettings>
  save(draft: ModelDraft, key: string, state: ModelSettings): Promise<void>
  remove(id: string, state: ModelSettings): Promise<void>
  test(
    provider: string,
    model: string,
  ): Promise<{ ok: boolean; code: string; durationMs: number; sessionId: string }>
}
/** Validate endpoint and numeric fields before invoking any mutation.
 * @param draft - Visible form values.
 * @returns Validated draft.
 */
export function validateModelDraft(draft: ModelDraft): ModelDraft {
  const value = z
    .object({
      id: z.string().regex(/^workbench-[a-z0-9][a-z0-9-]{0,47}$/),
      name: z.string().trim().min(1).max(120),
      baseURL: z.url(),
      model: z.string().trim().min(1).max(200),
      format: z.enum(['openai', 'deepseek']),
      reasoning: z.enum(['default', 'off', 'low', 'medium', 'high', 'max']),
      contextWindow: z.number().int().min(1024),
      maxTokens: z.number().int().positive(),
      timeoutMs: z.number().int().min(1000).max(600000),
    })
    .strict()
    .parse(draft)
  const url = new URL(value.baseURL)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    value.maxTokens >= value.contextWindow
  )
    throw new Error('MODEL_CONFIGURATION_INVALID')
  if (value.format === 'deepseek' && value.reasoning === 'medium')
    throw new Error('MODEL_REASONING_UNSUPPORTED')
  return { ...value, baseURL: value.baseURL.replace(/\/+$/, '') }
}
/** Build one pi-ai profile; omission preserves provider defaults for reasoning.
 * @param draft - Validated form values.
 * @returns Non-secret provider settings.
 */
export function modelProfile(draft: ModelDraft) {
  return {
    displayName: draft.name,
    baseURL: draft.baseURL,
    api: 'openai-completions',
    apiKeyEnv: draft.id.replaceAll('-', '_').toUpperCase() + '_API_KEY',
    timeoutMs: draft.timeoutMs,
    streamIdleTimeoutMs: draft.timeoutMs,
    retryPolicy: { mode: 'normal', maxRetries: 0 },
    compat: {
      thinkingFormat: draft.format,
      ...(draft.format === 'deepseek' ? { maxTokensField: 'max_tokens' } : {}),
    },
    ...(draft.reasoning === 'default' ? {} : { reasoning: draft.reasoning }),
    models: [
      {
        id: draft.model,
        name: draft.name,
        contextWindow: draft.contextWindow,
        maxTokens: draft.maxTokens,
        reasoningEfforts:
          draft.reasoning === 'default'
            ? false
            : draft.format === 'deepseek'
              ? { off: null, low: 'low', high: 'high', max: 'max' }
              : { off: 'none', low: 'low', medium: 'medium', high: 'high', max: 'max' },
      },
    ],
  }
}
/** Bind the workbench editor to the existing Harness configuration APIs.
 * @param ctx - Owning client plugin with declared Remote dependencies.
 * @returns Write-only credential and revision-fenced settings operations.
 */
export function createModelSettingsOperations(ctx: Context): ModelSettingsOperations {
  return {
    async load() {
      const result = await ctx.remote.settings.describe()
      if (!result.ok) throw new Error(result.error.message)
      const namespace = result.value.namespaces.find(n => n.ns === 'llm-pi-ai')
      if (!namespace) throw new Error('MODEL_ADAPTER_NOT_MOUNTED')
      const providers = z
        .object({ providers: z.record(z.string(), Profile).default({}) })
        .parse(namespace.value).providers
      const rows = await Promise.all(
        Object.entries(providers)
          .filter(([id]) => id.startsWith('workbench-'))
          .map(async ([id, p]) => {
            const info = p.apiKeyEnv ? await ctx.remote.credentials.describe([p.apiKeyEnv]) : undefined
            return {
              id,
              name: p.displayName ?? id,
              baseURL: p.baseURL ?? '',
              model: p.models?.[0]?.id ?? '',
              format: p.compat?.thinkingFormat === 'deepseek' ? ('deepseek' as const) : ('openai' as const),
              reasoning: (p.reasoning ?? 'default') as ModelDraft['reasoning'],
              contextWindow: p.models?.[0]?.contextWindow ?? 32768,
              maxTokens: p.models?.[0]?.maxTokens ?? 4096,
              timeoutMs: p.timeoutMs ?? 120000,
              configured: !!(info?.ok && p.apiKeyEnv && info.value[p.apiKeyEnv]?.configured),
            }
          }),
      )
      return { namespace, writable: result.value.writable, rows }
    },
    async save(raw, key, state) {
      const draft = validateModelDraft(raw),
        profile = modelProfile(draft)
      const literal = key.trim()
      if (
        literal &&
        (!/^[\x21-\x7e]+$/.test(literal) ||
          /^[A-Za-z_][A-Za-z0-9_]*=/.test(literal) ||
          /^['"]|['"]$/.test(literal))
      )
        throw new Error('MODEL_API_KEY_INVALID')
      if (!literal && !state.rows.find(row => row.id === draft.id)?.configured)
        throw new Error('MODEL_API_KEY_REQUIRED')
      const ops: SettingsPathOpView[] = Object.entries(profile).map(([name, value]) => ({
        op: 'set',
        path: ['providers', draft.id, name],
        value,
      }))
      if (draft.reasoning === 'default') ops.push({ op: 'unset', path: ['providers', draft.id, 'reasoning'] })
      const result = await ctx.remote.settings.mutate('llm-pi-ai', ops, state.namespace.revision)
      if (!result.ok) throw new Error(result.error.code)
      if (literal) {
        const credential = await ctx.remote.credentials.set(profile.apiKeyEnv, literal)
        if (!credential.ok) throw new Error('MODEL_SAVED_CREDENTIAL_WRITE_FAILED')
      }
    },
    async remove(id, state) {
      if (!state.writable || !/^workbench-[a-z0-9][a-z0-9-]{0,47}$/.test(id) || !state.rows.some(row => row.id === id))
        throw new Error('MODEL_CONFIGURATION_NOT_EDITABLE')
      const result = await ctx.remote.settings.mutate('llm-pi-ai', [{ op: 'unset', path: ['providers', id] }], state.namespace.revision)
      if (!result.ok) throw new Error(result.error.code)
    },
    async test(provider, model) {
      const result = await ctx.remote.dataAgent.testModel(provider, model)
      if (!result.ok) throw new Error(result.error.code)
      return result.value
    },
  }
}
