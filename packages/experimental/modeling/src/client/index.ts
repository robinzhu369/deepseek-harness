/** Browser entry for the ModelX workspace view and its Session-scoped Client model. */
import modelingRemote from '@deepseek-ai/dsh-experimental-modeling/remote'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { ModelingChatCard, type ModelingChatInjected } from './ModelingChatCard.tsx'
import { modelingPlanDefinition } from './plan-definition.ts'
import { DataIcon, DataPanel, RunsIcon, RunsPanel, SkillsIcon, SkillsPanel, WorkspaceIcon } from './Navigation.tsx'
import { en, NS, zh, type ModelingKey } from './locales.ts'
import { ModelingClientModel, type ModelingRemote } from './model.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** ModelX workbench, cards, status, and navigation copy. */
    modeling: ModelingKey
  }
}

export const inject = ['remote', 'slots', 'locale', 'theme', 'uiConversation']

function registerUi(ctx: ClientContext): () => void {
  const models = new Map<SessionId, ModelingClientModel>()
  const generated = ctx.remote.modeling
  const unwrap = <Value>(result: RemoteResult<Value>): Value => {
    if (result.ok) return result.value
    throw Object.assign(new Error(result.error.message), { code: result.error.code, details: result.error.details })
  }
  const remote: ModelingRemote = {
    workspace: async (sessionId, signal) => unwrap(await generated.workspace(sessionId, signal)),
    capabilities: async (sessionId, signal) => unwrap(await generated.capabilities(sessionId, signal)),
    skills: async (sessionId, signal) => unwrap(await generated.skills(sessionId, signal)),
    skill: async (sessionId, name, signal) => unwrap(await generated.skill(sessionId, name, signal)),
    saveSkillDraft: async (sessionId, request, signal) => unwrap(await generated.saveSkillDraft(sessionId, request, signal)),
    validateSkill: async (sessionId, name, signal) => unwrap(await generated.validateSkill(sessionId, name, signal)),
    publishSkill: async (sessionId, name, signal) => unwrap(await generated.publishSkill(sessionId, name, signal)),
    updatePlan: async (sessionId, request, signal) => unwrap(await generated.updatePlan(sessionId, request, signal)),
    regeneratePlan: async (sessionId, request, signal) => unwrap(await generated.regeneratePlan(sessionId, request, signal)),
    approveAndRun: async (sessionId, request, signal) => unwrap(await generated.approveAndRun(sessionId, request, signal)),
    rerun: async (sessionId, request, signal) => unwrap(await generated.rerun(sessionId, request, signal)),
    cancelRun: async (sessionId, runId, signal) => unwrap(await generated.cancelRun(sessionId, runId, signal)),
  }
  const modelFor = (sessionId: SessionId): ModelingClientModel => {
    let model = models.get(sessionId)
    if (model === undefined) {
      model = new ModelingClientModel(sessionId, remote)
      models.set(sessionId, model)
    }
    return model
  }
  const disposers: Array<() => void> = []
  disposers.push(ctx.locale.register(NS, { zh, en }))
  disposers.push(ctx.theme.overrideTokens('@deepseek-ai/dsh-experimental-modeling', {
    '--dsw-alias-brand-primary': { light: '#0F4C9E', dark: '#4C8ED9' },
    '--dsw-alias-bg-base': { light: '#F5F7FB', dark: '#15171B' },
    '--dsw-alias-bg-layer-1': { light: '#FFFFFF', dark: '#1D2026' },
    '--dsw-alias-border-l2': { light: '#E2E8F0', dark: '#343A46' },
    '--dsw-specific-sidebar-fill': { light: '#F8FAFD', dark: '#191C22' },
  }))
  const t = ctx.locale.bind(NS)
  ctx.uiConversation.events.register(modelingPlanDefinition)
  disposers.push(ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'modeling-plan', locale: NS,
    inject: (sessionId: SessionId): ModelingChatInjected => ({
      model: modelFor(sessionId),
      artifactUrl: id => `/api/modeling.artifact?sessionId=${encodeURIComponent(sessionId)}&artifactId=${encodeURIComponent(id)}`,
    }),
  }, ModelingChatCard)))
  const nav = [
    ['conversation', -30, 'nav.workspace', WorkspaceIcon],
    ['modeling-data', -20, 'nav.data', DataIcon],
    ['modeling-skills', -10, 'nav.skills', SkillsIcon],
    ['modeling-runs', 0, 'nav.runs', RunsIcon],
  ] as const
  for (const [id, order, label, Icon] of nav) {
    disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist', id, order, label: () => t(label), locale: NS,
    }, Icon)))
  }
  disposers.push(ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'modeling-data', locale: NS }, DataPanel)))
  disposers.push(ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'modeling-skills', locale: NS, inject: () => ({ modelFor }),
  }, SkillsPanel)))
  disposers.push(ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'modeling-runs', locale: NS, inject: () => ({ modelFor }),
  }, RunsPanel)))
  return () => {
    for (const model of models.values()) model.dispose()
    for (const dispose of disposers.reverse()) dispose()
  }
}

/** Mount generated Remote descriptors before activating the browser UI. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(modelingRemote)
  const ui = ctx.inject(['remote.modeling', 'slots', 'locale', 'theme', 'uiConversation'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}

export type { ModelingClientSnapshot, ModelingWorkspaceValue } from './model.ts'
