/** Modeling proposals anchored to their durable tool invocation. */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-tools/types'
import { parseWorkspace, type ModelingPlanView } from './model.ts'

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Immutable proposal returned by the Modeling API. */
    'modeling-plan': ModelingPlanView
  }
}

/** Fold a proposal result into a card at its originating call's position. */
export const modelingPlanDefinition: ConversationNodeDefinition<ModelingPlanView | null> = {
  kind: 'modeling-plan', target: 'chat',
  match: (event) => {
    if (event.type === 'tool/call' && event.data.name === 'modeling_propose_plan') return { id: String(event.data.callId), role: 'start' }
    if (event.type === 'tool/result' && event.surfaceOp === 'append') return { id: String(event.data.message.source.callId), role: 'update' }
    return null
  },
  start: () => null,
  update: (context, match) => {
    if (match.event.type !== 'tool/result') return context.state
    const content = match.event.data.message.content[0]
    if (content.isError) return context.state
    for (const block of content.content) {
      if (block.type !== 'text') continue
      try {
        const result: unknown = JSON.parse(block.text)
        if (result !== null && typeof result === 'object' && 'ok' in result && result.ok === true && 'plan' in result) {
          return parseWorkspace(JSON.stringify({ plan: result.plan })).plan
        }
      } catch (_error) {
        // Malformed tool output remains visible in the original tool transcript.
      }
    }
    return context.state
  },
  buildViewNode: context => context.start === undefined || context.state == null ? null : ({
    key: context.key, kind: 'modeling-plan', id: context.id, target: 'chat',
    // Human approval stays visible after the proposing Turn's tool details collapse.
    anchorSeq: context.start.event.seq, location: { kind: 'session' },
    visibility: 'visible', data: context.state,
  } satisfies ChatNode<'modeling-plan'>),
}
