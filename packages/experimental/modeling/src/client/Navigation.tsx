/** ModelX navigation glyphs and Session-backed management panels. */
import { useEffect, useSyncExternalStore } from 'react'
import {
  Button, IconDataOutline16, IconDatabaseOutline16, IconEditOutline16,
  IconGaugeOutline16, IconRefreshOutline16, IconSkillOutline16, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelingClientModel, ModelingClientSnapshot } from './model.ts'
import type { ModelingKey } from './locales.ts'
import css from './Navigation.module.css'
import { SkillCenter } from './SkillCenter.tsx'

export type ModelingPanelKind = 'data' | 'skills' | 'runs'

const SKILL_ORDER = ['data-analysis', 'data-cleaning', 'feature-engineering', 'model-training', 'model-evaluation'] as const

export interface ModelingPanelInjected {
  readonly modelFor: (sessionId: SessionId) => ModelingClientModel
}

export function WorkspaceIcon({ size }: PropsRuntime<'sidebar.panellist'>) { return <IconDataOutline16 size={size} /> }
export function DataIcon({ size }: PropsRuntime<'sidebar.panellist'>) { return <IconDatabaseOutline16 size={size} /> }
export function SkillsIcon({ size }: PropsRuntime<'sidebar.panellist'>) { return <IconSkillOutline16 size={size} /> }
export function RunsIcon({ size }: PropsRuntime<'sidebar.panellist'>) { return <IconGaugeOutline16 size={size} /> }

interface SessionSnapshot {
  readonly byId: Record<string, {
    readonly id: SessionId
    readonly retainedBy: { readonly mainView?: number }
  }>
}

function currentSession(snapshot: SessionSnapshot): SessionId | undefined {
  return Object.values(snapshot.byId).find(item => (item.retainedBy.mainView ?? 0) > 0)?.id
}

function usePanelModel(props: PropsRuntime<'main'> & InjectFace<ModelingPanelInjected>): [ModelingClientModel | undefined, ModelingClientSnapshot | undefined] {
  const sessionId = props.useSessions(currentSession)
  const model = sessionId === undefined ? undefined : props.modelFor(sessionId)
  const state = useSyncExternalStore(
    listener => model?.source.subscribe(listener) ?? (() => {}),
    () => model?.source.getSnapshot(),
  )
  useEffect(() => {
    model?.activate()
    return () => { model?.deactivate() }
  }, [model])
  return [model, state]
}

function metricText(metrics: Record<string, unknown> | null, name: string): string {
  const test = metrics?.test
  if (test === null || typeof test !== 'object' || Array.isArray(test)) return '—'
  const metric = (test as Record<string, unknown>)[name]
  return typeof metric === 'number' || typeof metric === 'string' ? String(metric) : '—'
}

function EmptyPanel({ kind, t }: { kind: ModelingPanelKind } & PropsLocale<'modeling'>) {
  const Icon = kind === 'data' ? IconDatabaseOutline16 : kind === 'skills' ? IconSkillOutline16 : IconGaugeOutline16
  return <main className={css.panel}><div className={css.panelCard}><Icon size={24} /><h2>{t(`nav.${kind}`)}</h2><p>{t('panel.noSession')}</p></div></main>
}

export function DataPanel(props: PropsRuntime<'main'> & PropsLocale<'modeling'>) {
  return <main className={css.panel}><div className={css.panelCard}><IconDatabaseOutline16 size={24} /><h2>{props.t('nav.data')}</h2><p>{props.t('panel.data')}</p></div></main>
}

export function SkillsPanel(props: PropsRuntime<'main'> & PropsLocale<'modeling'> & InjectFace<ModelingPanelInjected>) {
  const [model, state] = usePanelModel(props)
  if (model === undefined || state === undefined) return <EmptyPanel kind="skills" t={props.t} />
  const skills = [...state.skills].sort((left, right) => (
    SKILL_ORDER.indexOf(left.name as typeof SKILL_ORDER[number])
    - SKILL_ORDER.indexOf(right.name as typeof SKILL_ORDER[number])
  ))
  return <main className={css.management}>
    <header className={css.header}><div><h2>{props.t('skills.center')}</h2><p>{props.t('skills.centerDescription')}</p></div><Button size="sm" variant="outline" icon={<IconRefreshOutline16 />} onClick={() => { void model.refresh() }}>{props.t('action.refresh')}</Button></header>
    <div className={css.skillGrid}>{skills.map(skill => <article className={css.skillCard} key={skill.name}>
      <div className={css.cardHead}><IconSkillOutline16 /><strong>{props.t(`skill.${skill.name}` as ModelingKey)}</strong><Tag tone={skill.draft_hash === null ? 'success' : 'warning'}>{skill.draft_hash === null ? props.t('skills.published') : props.t('skills.draft')}</Tag></div>
      <code>{skill.name}</code><p>{skill.description}</p>
      <dl><div><dt>{props.t('skills.version')}</dt><dd>{skill.published_version}</dd></div><div><dt>{props.t('skills.hash')}</dt><dd>{skill.published_hash.slice(0, 16)}…</dd></div><div><dt>{props.t('skills.updated')}</dt><dd>{skill.updated_at}</dd></div></dl>
      <div className={css.actions}><Button size="sm" variant="ghost" icon={<IconDataOutline16 />} onClick={() => { void model.selectSkill(skill.name) }}>{props.t('skills.view')}</Button><Button size="sm" variant="outline" icon={<IconEditOutline16 />} onClick={() => { void model.selectSkill(skill.name) }}>{props.t('skills.edit')}</Button></div>
    </article>)}</div>
    <SkillCenter model={model} state={state} t={props.t} />
  </main>
}

export function RunsPanel(props: PropsRuntime<'main'> & PropsLocale<'modeling'> & InjectFace<ModelingPanelInjected>) {
  const [, state] = usePanelModel(props)
  if (state === undefined) return <EmptyPanel kind="runs" t={props.t} />
  return <main className={css.management}>
    <header className={css.header}><div><h2>{props.t('nav.runs')}</h2><p>{props.t('panel.runs')}</p></div></header>
    <div className={css.runList}>{state.runs.map((run, index) => <article className={css.runCard} key={run.id}>
      <div><strong>{props.t('run.number')} #{index + 1}</strong><code>{run.id}</code></div>
      <Tag tone={run.status === 'succeeded' ? 'success' : run.status === 'running' ? 'info' : 'warning'}>{run.status}</Tag>
      <dl>
        <div><dt>{props.t('plan.revision')}</dt><dd>{run.plan_revision}</dd></div>
        <div><dt>{props.t('skills.updated')}</dt><dd>{run.created_at}</dd></div>
        <div><dt>{props.t('result.auc')}</dt><dd>{metricText(run.metrics, 'roc_auc')}</dd></div>
        <div><dt>{props.t('result.f1')}</dt><dd>{metricText(run.metrics, 'f1')}</dd></div>
      </dl>
    </article>)}</div>
  </main>
}
