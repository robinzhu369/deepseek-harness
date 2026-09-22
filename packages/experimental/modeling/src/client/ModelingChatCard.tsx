/** Chat proposal cards share one Session's live modeling projection. */
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ModelingWorkspace } from './ModelingWorkspace.tsx'
import type { ModelingClientModel } from './model.ts'
import css from './ModelingWorkspace.module.css'

/** Session-scoped business access supplied by the plugin. */
export interface ModelingChatInjected {
  readonly model: ModelingClientModel
  readonly artifactUrl: (id: string) => string
}

/** Render an exact historical proposal or its matching live task.
 * @param props - Durable proposal, Session model, and localized copy.
 * @returns The proposal card with execution controls only for the current revision.
 */
export function ModelingChatCard(props: PropsRuntime<'conversation.chat.node', 'modeling-plan'> & PropsLocale<'modeling'> & ModelingChatInjected) {
  const { model, node, t, artifactUrl } = props
  const source = useMemo(() => ({
    subscribe: (listener: () => void) => model.source.subscribe(listener), getSnapshot: () => model.source.getSnapshot(),
  }), [model])
  const state = useSyncExternalStore(source.subscribe, source.getSnapshot)
  useEffect(() => { model.activate(); void model.refresh(); return () => { model.deactivate() } }, [model, node.data.revision])
  const actions = useMemo(() => ({
    approve: () => model.approve(node.data), cancel: () => model.cancel(), refresh: () => model.refresh(),
    updatePlan: model.regeneratePlan.bind(model), regeneratePlan: model.regeneratePlan.bind(model),
    activate: () => {}, deactivate: () => {},
  }), [model, node.data])
  const current = state.plan?.id === node.data.id && state.plan.revision === node.data.revision
    && state.plan.plan_hash === node.data.plan_hash
  if (!current) return <details className={css.historicalCard}>
    <summary>{t('plan.title')} · {t('plan.revisionShort')}{node.data.revision} · {t(state.phase === 'loading' ? 'loading' : 'chat.history')}</summary>
    <dl className={css.planGrid}><div><dt>{t('plan.target')}</dt><dd>{typeof node.data.plan.target === 'string' ? node.data.plan.target : '—'}</dd></div><div><dt>{t('plan.task')}</dt><dd>{typeof node.data.plan.mode === 'string' ? node.data.plan.mode : '—'}</dd></div></dl>
    <pre>{JSON.stringify(node.data.plan, null, 2)}</pre>
  </details>
  return <ModelingWorkspace {...actions} compact preview={false} artifactUrl={artifactUrl}
    t={t} useModelingState={selector => selector(state)} />
}
