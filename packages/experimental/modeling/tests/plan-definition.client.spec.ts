import { describe, expect, it } from 'vitest'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationViewDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { modelingPlanDefinition } from '../src/client/plan-definition.ts'

type PlanNode = ChatNode<'modeling-plan'>
const view: ConversationViewDefinition<PlanNode, readonly PlanNode[]> = {
  target: 'chat', create: () => ({ empty: [], replace: value => value.nodes, apply: value => value.upserts }),
}

function event(seq: number, type: string, data: unknown): { type: 'event'; event: SessionEvent } {
  return { type: 'event', event: { seq, type, time: seq, data, ...(type === 'tool/result' ? { surfaceOp: 'append' } : {}) } as SessionEvent }
}

function proposal(seq: number, revision: number, ok = true) {
  const callId = `proposal-${revision}`
  return [
    event(seq, 'tool/call', { turn: 1, step: revision, callId, name: 'modeling_propose_plan', arguments: '{}' }),
    event(seq + 1, 'tool/result', { turn: 1, step: revision, message: {
      source: { kind: 'tool', callId }, content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: JSON.stringify({
        ok, plan: { id: 'plan-1', revision, plan_hash: `hash-${revision}`, state: 'proposed', plan: { target: 'fraud' } },
      }) }] }],
    } }),
  ]
}

describe('modeling conversation proposals', () => {
  it('replays immutable revisions as visible Session cards at their original call positions', () => {
    const assembler = new ConversationNodeAssembler(
      { entries: () => [modelingPlanDefinition], fallbackEntry: () => undefined }, { entries: () => [view] },
    )
    assembler.replaceWindow([
      event(1, 'turn/start', { turn: 1 }), event(2, 'step/start', { turn: 1, step: 1 }),
      ...proposal(3, 1), ...proposal(5, 2), ...proposal(7, 3, false),
    ], false)
    assembler.activateTarget('chat')
    const nodes = assembler.snapshot('chat') as readonly PlanNode[]
    expect(nodes).toMatchSnapshot()
    expect(nodes.map(node => ({ anchor: node.anchorSeq, location: node.location.kind, revision: node.data.revision,
      hash: node.data.plan_hash, visibility: node.visibility }))).toEqual([
      { anchor: 3, location: 'session', revision: 1, hash: 'hash-1', visibility: 'visible' },
      { anchor: 5, location: 'session', revision: 2, hash: 'hash-2', visibility: 'visible' },
    ])
  })
})
