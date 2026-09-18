/** Connectivity probes run through the same agent and provider pipeline as tasks. */
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId, TurnEndReason } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ModelProbeResult } from './types.ts'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'model-connectivity': { kind: 'model-connectivity'; form: 'data' }
  }
}
/** Send a synthetic, tool-free message and retain the normal session audit log.
 * @param ctx - Host with the existing agents and session services.
 * @param provider - Configured provider route.
 * @param model - Model identifier on that route.
 * @param signal - Caller, controller-lifecycle and deadline cancellation.
 * @returns Safe status only; provider bodies and credential material are never returned.
 */
export async function probeModel(
  ctx: Context,
  provider: string,
  model: string,
  signal: AbortSignal,
): Promise<ModelProbeResult> {
  const start = Date.now()
  let sessionId = ''
  const result: { text: boolean; end?: TurnEndReason } = { text: false }
  try {
    const agents = ctx.get('agents'),
      sessions = ctx.get('sessions'),
      llm = ctx.get('llm')
    if (!agents || !sessions || !llm)
      return { ok: false, code: 'MODEL_SERVICES_UNAVAILABLE', durationMs: Date.now() - start, sessionId }
    await llm.resolveModelInfo(provider, model, signal)
    const handle = await agents.create({
      sessionId: brandString<SessionId>(randomUUID()),
      signal,
      agentOptions: { provider, model },
      setup: async (agentCtx) => {
        await agentCtx.plugin({
          name: 'data-agent-connectivity-probe',
          inject: ['tools', 'systemPrompt'],
          apply(scoped: Context) {
            scoped.on('session/event', (_session, event) => {
              if (event.type === 'assistant/message')
                result.text ||= event.data.message.content.some(
                  block => block.type === 'text' && block.text.trim().length > 0,
                )
              if (event.type === 'turn/end') result.end = event.data.reason
            })
            scoped.tools.restrict({ allow: [] })
            scoped.systemPrompt.section({
              name: 'data-agent:connectivity',
              order: 0,
              complete: true,
              text: 'This is a model connectivity test. Reply with OK only. Do not call tools.',
            })
            scoped.systemPrompt.suppressRuntimeContext()
          },
        })
      },
    })
    sessionId = String(handle.agent.session.id)
    const cancel = () => {
      handle.agent.cancel({ kind: 'user' })
    }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      signal.throwIfAborted()
      handle.agent.followup(
        createUserMessage({
          content: [{ type: 'text', text: 'Connectivity test. Reply OK.' }],
          source: { kind: 'model-connectivity', form: 'data' },
        }),
      )
      await handle.agent.whenIdle()
      await sessions.flush(handle.agent.session)
      const failure = result.end?.kind === 'error' ? result.end.error : undefined
      const known =
        failure?.code === 'AUTH' || failure?.status === 401 || failure?.status === 403
          ? 'MODEL_AUTHENTICATION_FAILED'
          : failure?.status === 404
            ? 'MODEL_ENDPOINT_OR_ID_NOT_FOUND'
            : failure?.code === 'RATE_LIMIT' || failure?.status === 429
              ? 'MODEL_RATE_LIMITED'
              : failure?.code === 'INVALID_REQUEST' || failure?.status === 400
                ? 'MODEL_PARAMETERS_REJECTED'
                : 'MODEL_NO_SUCCESSFUL_RESPONSE'
      const ok = !signal.aborted && result.text && result.end?.kind === 'completed'
      return {
        ok,
        code: ok ? 'MODEL_RESPONSE_RECEIVED' : signal.aborted ? 'MODEL_TEST_CANCELLED_OR_TIMEOUT' : known,
        durationMs: Date.now() - start,
        sessionId,
      }
    } finally {
      signal.removeEventListener('abort', cancel)
      await handle.dispose()
    }
  } catch {
    // SDK errors may contain endpoint bodies or secrets. Normal session events retain request diagnostics.
    return {
      ok: false,
      code: signal.aborted ? 'MODEL_TEST_CANCELLED_OR_TIMEOUT' : 'MODEL_CONNECTION_FAILED',
      durationMs: Date.now() - start,
      sessionId,
    }
  }
}
