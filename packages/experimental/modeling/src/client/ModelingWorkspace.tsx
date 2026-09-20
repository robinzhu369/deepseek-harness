/** Pure presentation for the Session-scoped three-column modeling workbench. */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button, fileSizeText, IconCheckOutline16, IconDataOutline16, IconDownloadOutline16, IconEditOutline16,
  IconLoadingOutline16, IconPlayOutline16, IconRefreshOutline16, IconStopFill16, IconWarningOutline16,
  Modal, StateDot, Tag, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelingJson } from '../types.ts'
import { MODELING_UI_FIXTURE } from './fixtures.ts'
import type { ModelingClientSnapshot } from './model.ts'
import type { ModelingKey } from './locales.ts'
import css from './ModelingWorkspace.module.css'

export interface ModelingWorkspaceInjected {
  readonly preview: boolean
  readonly approve: () => Promise<void>
  readonly cancel: () => Promise<void>
  readonly refresh: () => Promise<void>
  readonly updatePlan: (plan: ModelingJson) => Promise<void>
  readonly artifactUrl: (artifactId: string) => string
  readonly activate: () => void
  readonly deactivate: () => void
  readonly hooks: { readonly modelingState: { getSnapshot(): ModelingClientSnapshot; subscribe(listener: () => void): () => void } }
}

export type ModelingWorkspaceProps = PropsRuntime<'conversation.view'> & InjectFace<ModelingWorkspaceInjected> & PropsLocale<'modeling'>

function value(source: unknown, fallback = '—'): string {
  if (source === null || source === undefined || source === '') return fallback
  if (typeof source === 'string' || typeof source === 'number' || typeof source === 'boolean') return String(source)
  return JSON.stringify(source)
}

function metric(metrics: Record<string, unknown> | null, key: string): unknown {
  const test = metrics?.test
  return test !== null && typeof test === 'object' && !Array.isArray(test) ? (test as Record<string, unknown>)[key] : undefined
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return <label className={css.formField}><span>{label}</span>{children}</label>
}

function missingSummary(profile: Record<string, unknown> | null | undefined, fallback: string): string {
  if (!Array.isArray(profile?.columns)) return value(profile?.missing_ratio ?? profile?.missing, fallback)
  const missing = profile.columns.flatMap((column) => {
    if (column === null || typeof column !== 'object' || Array.isArray(column)) return []
    const item = column as Record<string, unknown>
    return typeof item.name === 'string' && typeof item.missing_ratio === 'number' && item.missing_ratio > 0
      ? [`${item.name} ${(item.missing_ratio * 100).toFixed(1)}%`]
      : []
  })
  return missing.length === 0 ? fallback : missing.join(', ')
}

function CardTitle({ icon, title, trailing }: { icon: ReactNode; title: string; trailing?: ReactNode }) {
  return <header className={css.cardHeader}><span className={css.cardTitle}>{icon}<strong>{title}</strong></span>{trailing}</header>
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className={css.fact}><span>{label}</span><strong>{children}</strong></div>
}

function statusLabel(status: string, t: (key: ModelingKey) => string): string {
  return ({ queued: t('run.pending'), running: t('run.running'), cancelling: t('run.running'), succeeded: t('run.succeeded'), failed: t('run.failed'), cancelled: t('run.cancelled'), interrupted: t('run.blocked') } as Record<string, string>)[status] ?? status
}

export function ModelingWorkspace(props: ModelingWorkspaceProps) {
  const { useModelingState, preview, approve, cancel, refresh, updatePlan, artifactUrl, activate, deactivate, t } = props
  const live = useModelingState(snapshot => snapshot)
  useEffect(() => { activate(); return deactivate }, [activate, deactivate])
  const state = preview ? MODELING_UI_FIXTURE : live
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const [editError, setEditError] = useState('')
  const profile = state.dataset?.profile
  const plan = state.plan?.plan
  const preprocessing = plan !== undefined && typeof plan.preprocessing === 'object' ? plan.preprocessing as Record<string, unknown> : null
  const split = plan !== undefined && typeof plan.split === 'object' ? plan.split as Record<string, unknown> : null
  const modelValue: unknown = Array.isArray(plan?.models) ? plan.models[0] : plan?.model
  const model = modelValue !== null && typeof modelValue === 'object' && !Array.isArray(modelValue) ? modelValue as Record<string, unknown> : null
  const parametersValue = model?.params ?? model?.parameters
  const parameters = parametersValue !== null && typeof parametersValue === 'object' ? parametersValue as Record<string, unknown> : null
  const metrics = state.result?.metrics ?? null
  const f1 = metric(metrics, 'f1')
  const artifacts = state.result?.artifacts ?? []
  const stages = [t('stage.validate'), t('stage.split'), t('stage.preprocess'), t('stage.features'), t('stage.train'), t('stage.evaluate'), t('stage.export')]
  const terminal = state.run !== null && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(state.run.status)
  const stageState = state.run?.status === 'succeeded' ? 'done' : state.run?.status === 'failed' ? 'error' : state.run === null ? 'idle' : 'ongoing'
  const target = plan?.target ?? profile?.target
  const excluded = Array.isArray(plan?.excluded_columns) ? plan.excluded_columns.join(', ') : t('unknown')
  const featureCount = state.result?.feature_summary?.output_feature_count ?? (typeof profile?.column_count === 'number' ? Math.max(0, profile.column_count - 2) : undefined)
  const errorCode = state.error?.code
    ?? (typeof state.dataset?.error?.code === 'string' ? state.dataset.error.code : undefined)
    ?? (typeof state.run?.error?.code === 'string' ? state.run.error.code : undefined)
  const requestId = state.error?.requestId
    ?? (typeof state.dataset?.error?.request_id === 'string' ? state.dataset.error.request_id : undefined)
    ?? (typeof state.run?.error?.request_id === 'string' ? state.run.error.request_id : undefined)
  const operationalError = state.phase === 'error' || state.dataset?.state === 'error'
    || (state.run !== null && ['failed', 'cancelled', 'interrupted'].includes(state.run.status))
  const columns = (Array.isArray(profile?.schema) ? profile.schema : Array.isArray(profile?.columns) ? profile.columns : [])
    .flatMap(item => typeof object(item).name === 'string' ? [String(object(item).name)] : [])
  const capabilities = state.capabilities ?? {}
  const logisticCapabilities = object(object(capabilities.models).logistic_regression)
  const cBounds = object(logisticCapabilities.C)
  const iterationBounds = object(logisticCapabilities.max_iter)
  const openEditor = () => { setDraft(JSON.parse(JSON.stringify(plan ?? {})) as Record<string, unknown>); setEditError(''); setEditing(true) }
  const mutateDraft = (change: (next: Record<string, unknown>) => void) => {
    if (draft === null) return
    const next = JSON.parse(JSON.stringify(draft)) as Record<string, unknown>
    change(next)
    setDraft(next)
  }
  const save = async () => {
    try {
      if (draft === null) return
      await updatePlan(draft as ModelingJson)
      setEditing(false)
    } catch (error) { setEditError(error instanceof Error ? error.message : String(error)) }
  }
  const visibleWarnings = useMemo(() => {
    const warnings = [...(state.result?.warnings ?? [])]
    if (f1 === 0 && !preview) warnings.push(t('result.noPositive'))
    return warnings
  }, [f1, preview, state.result?.warnings, t])

  if (state.phase === 'loading') return <div className={css.centerState}><IconLoadingOutline16 /><span>{t('loading')}</span></div>
  if (state.phase === 'error' && state.dataset === null) return (
    <div className={css.errorCard}><IconWarningOutline16 /><div><strong>{t('error.title')}</strong><p>{state.error?.message}</p><p>{t('error.next')}</p></div><Button size="sm" variant="outline" icon={<IconRefreshOutline16 />} onClick={() => void refresh()}>{t('action.refresh')}</Button></div>
  )
  if (state.dataset === null) return <div className={css.centerState}><IconDataOutline16 /><div><strong>{t('empty.title')}</strong><p>{t('empty.body')}</p></div></div>

  return (
    <section className={css.workspace} aria-label={t('view.title')}>
      <div className={css.topbar}>
        <div><h2>{t('view.title')}</h2><span className={css.subtitle}>{state.dataset.original_name}</span></div>
        <div className={css.topActions}><Tag tone={preview ? 'warning' : 'success'}>{t(preview ? 'preview.badge' : 'live.badge')}</Tag><Tooltip label={t('action.refresh')} side="bottom"><button className={css.iconButton} aria-label={t('action.refresh')} onClick={() => void refresh()}><IconRefreshOutline16 /></button></Tooltip></div>
      </div>
      {operationalError && <div className={css.errorCard}><IconWarningOutline16 /><div><strong>{t('error.operation')}</strong><p>{state.error?.message ?? value(state.dataset.error?.message ?? state.run?.error?.message)}</p><p>{[errorCode === undefined ? '' : `code=${errorCode}`, requestId === undefined ? '' : `request_id=${requestId}`, state.run === null ? '' : `run_id=${state.run.id}`].filter(Boolean).join(' · ')}</p></div></div>}
      <div className={css.columns}>
        <div className={css.mainColumn}>
          <article className={css.card}>
            <CardTitle icon={<IconDataOutline16 />} title={t('dataset.title')} trailing={<Tag tone="info">{state.dataset.state}</Tag>} />
            <div className={css.factGrid}>
              <Fact label={t('dataset.rows')}>{value(profile?.row_count)}</Fact><Fact label={t('dataset.columns')}>{value(profile?.column_count)}</Fact>
              <Fact label={t('dataset.features')}>{value(featureCount)}</Fact><Fact label={t('dataset.size')}>{fileSizeText(state.dataset.size_bytes)}</Fact>
              <Fact label={t('dataset.format')}>{t('format.csv')}</Fact><Fact label={t('dataset.target')}>{value(target)}</Fact>
            </div>
            <div className={css.metaLine}><span>{t('dataset.scope')}</span><code>{value(profile?.computation_scope)}</code></div>
            <div className={css.metaLine}><span>{t('dataset.missing')}</span><code>{missingSummary(profile, t('dataset.noMissing'))}</code></div>
          </article>
          <article className={css.card}>
            <CardTitle icon={<IconPlayOutline16 />} title={t('plan.title')} trailing={<Tag tone={state.plan?.state === 'proposed' ? 'warning' : 'success'}>{state.plan === null ? t('unknown') : <>{state.plan.state} · {t('plan.revisionShort')}{state.plan.revision}</>}</Tag>} />
            <dl className={css.planGrid}>
              <div><dt>{t('plan.task')}</dt><dd>{value(plan?.mode ?? plan?.task_type, t('task.binary'))}</dd></div><div><dt>{t('plan.target')}</dt><dd>{value(target)}</dd></div>
              <div><dt>{t('plan.exclude')}</dt><dd>{excluded}</dd></div><div><dt>{t('plan.missing')}</dt><dd>{value(preprocessing?.numeric_missing ?? preprocessing?.numeric_strategy)}</dd></div>
              <div><dt>{t('plan.encoding')}</dt><dd>{value(preprocessing?.categorical_encoding)}</dd></div><div><dt>{t('plan.split')}</dt><dd>{split === null ? t('unknown') : `${value(split.train_ratio ?? split.train)} / ${value(split.validation_ratio ?? split.validation)} / ${value(split.test_ratio ?? split.test)}`}</dd></div>
              <div><dt>{t('plan.model')}</dt><dd>{value(model?.name ?? model?.type)}</dd></div><div><dt>{t('plan.parameters')}</dt><dd>{value(parameters)}</dd></div>
            </dl>
            {state.plan !== null && <><div className={css.metaLine}><span>{t('plan.id')}</span><code>{state.plan.id}</code></div><div className={css.metaLine}><span>{t('plan.hash')}</span><code>{state.plan.plan_hash}</code></div></>}
            {state.plan?.invalidation !== null && state.plan?.invalidation !== undefined && <div className={css.invalidation}><strong>{t('plan.invalidation')}</strong><span>{strings(state.plan.invalidation.invalidated_stages).join(' → ') || t('plan.noChange')}</span><small>{value(state.plan.invalidation.note)}</small></div>}
            <div className={css.actions}>
              <Button size="sm" variant="outline" icon={<IconEditOutline16 />} disabled={state.plan === null || preview || (state.run !== null && !terminal)} onClick={openEditor}>{t('plan.edit')}</Button>
              <Button size="sm" variant="primary" icon={<IconPlayOutline16 />} disabled={state.plan?.state !== 'proposed' || state.confirming || preview} onClick={() => void approve()}>{state.confirming ? t('plan.confirming') : state.runs.length > 0 ? t('plan.confirmRerun') : state.plan?.state === 'proposed' ? t('plan.confirm') : t('plan.approved')}</Button>
            </div>
          </article>
          {state.result !== null && <article className={css.card}>
            <CardTitle icon={<IconCheckOutline16 />} title={t('result.title')} trailing={<Tag tone="success">{t('run.succeeded')}</Tag>} />
            <div className={css.metrics}>
              <Fact label={t('result.auc')}>{value(metric(metrics, 'roc_auc'))}</Fact><Fact label={t('result.ap')}>{value(metric(metrics, 'average_precision'))}</Fact><Fact label={t('result.f1')}>{value(f1)}</Fact><Fact label={t('result.samples')}>{value(metric(metrics, 'samples'))}</Fact><Fact label={t('result.threshold')}>{value(metric(metrics, 'threshold'))}</Fact>
            </div>
            <div className={css.matrix}><span>{t('result.matrix')}</span><code>{value(metric(metrics, 'confusion_matrix'))}</code></div>
            {visibleWarnings.map(warning => (
              <div className={css.warning} key={warning}><IconWarningOutline16 /><span>{warning}</span></div>
            ))}
            <div className={css.actions}><Button size="sm" variant="outline" icon={<IconEditOutline16 />} disabled={preview} onClick={openEditor}>{t('result.adjustRerun')}</Button></div>
          </article>}
        </div>
        <aside className={css.sideColumn}>
          <section className={css.sideSection}><h3>{t('skills.title')}</h3>{[t('skill.analysis'), t('skill.cleaning'), t('skill.features'), t('skill.training')].map(label => <div className={css.skill} key={label}><IconCheckOutline16 /><span>{label}</span></div>)}</section>
          <section className={css.sideSection}><div className={css.sideHeading}><h3>{t('run.title')}</h3>{state.run !== null && <Tag tone={terminal ? state.run.status === 'succeeded' ? 'success' : 'danger' : 'info'}>{statusLabel(state.run.status, t)}</Tag>}</div><div className={css.timeline}>{stages.map((label, index) => <div className={css.timelineRow} key={label}><StateDot state={stageState} /><span>{label}</span>{state.run?.status === 'succeeded' && <small>{index < stages.length - 1 ? '✓' : t('run.done')}</small>}</div>)}</div>{state.run !== null && !terminal && <Button size="sm" variant="outline" icon={<IconStopFill16 />} onClick={() => void cancel()}>{t('action.cancelRun')}</Button>}<div className={css.runHistory}>{state.runs.map((item, index) => <div className={css.runHistoryItem} key={item.id}><strong>{t('run.number')} #{index + 1}</strong><span>{t('plan.revisionShort')}{item.plan_revision} · {statusLabel(item.status, t)}</span><small>{item.created_at}</small></div>)}</div></section>
          <section className={css.sideSection}><h3>{t('artifact.title')}</h3><div className={css.artifacts}>{artifacts.map((item) => {
            const id = typeof item.id === 'string' ? item.id : ''
            const kind = value(item.kind)
            return id === '' ? null : <a className={css.artifact} href={artifactUrl(id)} key={id} download><IconDownloadOutline16 /><span>{kind}</span></a>
          })}{artifacts.length === 0 && <span className={css.muted}>{t('artifact.unavailable')}</span>}</div></section>
        </aside>
      </div>
      <Modal open={editing} onClose={() => { setEditing(false) }} title={t('plan.dialog.title')} closeLabel={t('close')} description={t('plan.dialog.description')} footer={<><Button variant="ghost" onClick={() => { setEditing(false) }}>{t('action.cancel')}</Button><Button variant="primary" icon={<IconCheckOutline16 />} onClick={() => void save()}>{t('action.save')}</Button></>}>
        {draft !== null && <div className={css.planForm}>
          <FormField label={t('plan.target')}><select value={value(draft.target, '')} onChange={(event) => {
            mutateDraft((next) => { next.target = event.target.value })
          }}>{columns.map(name => <option value={name} key={name}>{name}</option>)}</select></FormField>
          <fieldset className={css.formGroup}><legend>{t('plan.exclude')}</legend>{columns.filter(name => name !== draft.target).map(name => <label className={css.check} key={name}><input type="checkbox" checked={strings(draft.excluded_columns).includes(name)} onChange={(event) => {
            mutateDraft((next) => {
              const current = new Set(strings(next.excluded_columns))
              if (event.target.checked) current.add(name)
              else current.delete(name)
              next.excluded_columns = [...current]
            })
          }} />{name}</label>)}</fieldset>
          <FormField label={t('plan.missing')}><select value={value(object(draft.preprocessing).numeric_missing, '')} onChange={(event) => { mutateDraft((next) => { object(next.preprocessing).numeric_missing = event.target.value }) }}>{strings(capabilities.numeric_missing).map(item => <option key={item}>{item}</option>)}</select></FormField>
          <FormField label={t('plan.categoricalMissing')}><input value={value(object(draft.preprocessing).categorical_missing_value, '')} onChange={(event) => { mutateDraft((next) => { object(next.preprocessing).categorical_missing_value = event.target.value }) }} /></FormField>
          <FormField label={t('plan.encoding')}><select value={value(object(draft.preprocessing).categorical_encoding, '')} onChange={(event) => { mutateDraft((next) => { object(next.preprocessing).categorical_encoding = event.target.value }) }}>{strings(capabilities.categorical_encoding).map(item => <option key={item}>{item}</option>)}</select></FormField>
          <fieldset className={css.formGroup}><legend>{t('plan.dateFeatures')}</legend>
            <label className={css.check}><input type="checkbox" checked={object(object(draft.feature_engineering).date_features).enabled === true} onChange={(event) => {
              mutateDraft((next) => { object(object(next.feature_engineering).date_features).enabled = event.target.checked })
            }} />{t('plan.dateEnabled')}</label>
            {columns.filter(name => name !== draft.target).map(name => <label className={css.check} key={name}><input type="checkbox" checked={strings(object(object(draft.feature_engineering).date_features).columns).includes(name)} onChange={(event) => {
              mutateDraft((next) => {
                const dates = object(object(next.feature_engineering).date_features)
                const current = new Set(strings(dates.columns))
                if (event.target.checked) current.add(name)
                else current.delete(name)
                dates.columns = [...current]
              })
            }} />{name}</label>)}
            {strings(capabilities.date_components).map(component => <label className={css.check} key={component}><input type="checkbox" checked={strings(object(object(draft.feature_engineering).date_features).components).includes(component)} onChange={(event) => {
              mutateDraft((next) => {
                const dates = object(object(next.feature_engineering).date_features)
                const current = new Set(strings(dates.components))
                if (event.target.checked) current.add(component)
                else current.delete(component)
                dates.components = [...current]
              })
            }} />{component}</label>)}
          </fieldset>
          {(['train_ratio', 'validation_ratio', 'test_ratio'] as const).map(key => <FormField label={t(`plan.${key}`)} key={key}><input type="number" min="0.01" max="0.98" step="0.01" value={Number(object(draft.split)[key])} onChange={(event) => { mutateDraft((next) => { object(next.split)[key] = Number(event.target.value) }) }} /></FormField>)}
          <FormField label={t('plan.logisticC')}><input type="number" min={Number(cBounds.min)} max={Number(cBounds.max)} step="0.1" value={Number(object(object(first(draft.models)).params).C)} onChange={(event) => { mutateDraft((next) => { object(object(first(next.models)).params).C = Number(event.target.value) }) }} /></FormField>
          <FormField label="max_iter"><input type="number" min={Number(iterationBounds.min)} max={Number(iterationBounds.max)} step="50" value={Number(object(object(first(draft.models)).params).max_iter)} onChange={(event) => { mutateDraft((next) => { object(object(first(next.models)).params).max_iter = Number(event.target.value) }) }} /></FormField>
          {(['max_train_seconds', 'max_run_seconds', 'max_output_features'] as const).map((key) => { const bounds = object(object(capabilities.limits)[key]); return <FormField label={key} key={key}><input type="number" min={Number(bounds.min)} max={Number(bounds.max)} value={Number(object(draft.limits)[key])} onChange={(event) => { mutateDraft((next) => { object(next.limits)[key] = Number(event.target.value) }) }} /></FormField> })}
        </div>}{editError !== '' && <p className={css.editError}>{editError}</p>}
      </Modal>
    </section>
  )
}
