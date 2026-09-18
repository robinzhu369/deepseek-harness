/** Probe success requires a completed model response and all handles are disposed. */
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { probeModel } from '../src/model-probe.ts'
function fixture(events: unknown[]) {
  const dispose = vi.fn(),
    followup = vi.fn<(value: unknown) => void>(),
    flush = vi.fn(),
    cancel = vi.fn()
  let observer: ((session: unknown, event: unknown) => void) | undefined
  const tools = { restrict: vi.fn() },
    systemPrompt = { section: vi.fn(), suppressRuntimeContext: vi.fn() }
  const scoped = {
    tools,
    systemPrompt,
    on: (_name: string, fn: typeof observer) => {
      observer = fn
    },
  }
  const create = vi.fn(async (options: import('@deepseek-ai/dsh-agent').CreateAgentOptions) => {
    await options.setup?.(
      {
        plugin: async (p: { apply: (ctx: unknown) => void }) => {
          p.apply(scoped)
        },
      } as unknown as Context,
      {} as import('@deepseek-ai/dsh-agent').Agent,
    )
    return {
      dispose,
      agent: {
        session: { id: 'probe-session' },
        followup,
        whenIdle: async () => {
          for (const event of events) observer?.({}, event)
        },
        cancel,
      },
    }
  })
  const services = { llm: { resolveModelInfo: async () => ({}) }, agents: { create }, sessions: { flush } }
  const ctx = { get: (name: keyof typeof services) => services[name] } as unknown as Context
  return { ctx, dispose, followup, flush, create, cancel, tools }
}
it('uses only a synthetic prompt, logs it and disposes the completed test', async () => {
  const f = fixture([
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'OK' }] } } },
    { type: 'turn/end', data: { reason: { kind: 'completed' } } },
  ])
  expect(await probeModel(f.ctx, 'route', 'model', new AbortController().signal)).toMatchObject({
    ok: true,
    code: 'MODEL_RESPONSE_RECEIVED',
    sessionId: 'probe-session',
  })
  expect(f.followup.mock.calls[0]?.[0]).toMatchObject({
    content: [{ type: 'text', text: 'Connectivity test. Reply OK.' }],
  })
  expect(f.flush).toHaveBeenCalledOnce()
  expect(f.dispose).toHaveBeenCalledOnce()
  expect(f.tools.restrict).toHaveBeenCalledWith({ allow: [] })
})
it('does not call an error response successful and never returns upstream error text', async () => {
  const f = fixture([
    {
      type: 'turn/end',
      data: {
        reason: { kind: 'error', error: { status: 401, message: 'secret-provider-key', code: 'AUTH' } },
      },
    },
  ])
  const value = await probeModel(f.ctx, 'route', 'model', new AbortController().signal)
  expect(value).toMatchObject({ ok: false, code: 'MODEL_AUTHENTICATION_FAILED' })
  expect(JSON.stringify(value)).not.toContain('secret-provider-key')
  expect(f.dispose).toHaveBeenCalledOnce()
})
it('rejects cancellation without queuing a prompt and disposes the created handle', async () => {
  const f = fixture([]),
    signal = AbortSignal.abort()
  expect(await probeModel(f.ctx, 'route', 'model', signal)).toMatchObject({
    ok: false,
    code: 'MODEL_TEST_CANCELLED_OR_TIMEOUT',
  })
  expect(f.followup).not.toHaveBeenCalled()
  expect(f.dispose).toHaveBeenCalledOnce()
})
