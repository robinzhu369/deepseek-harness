/** Pure presentation for the Session-scoped modeling workbench. */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button, fileSizeText, IconCheckOutline16, IconDataOutline16, IconDownloadOutline16, IconEditOutline16,
  IconChevronDownOutline14, IconChevronUpOutline14, IconLoadingOutline16, IconPlayOutline16, IconRefreshOutline16,
  IconStopFill16, IconWarningOutline16,
  Modal, StateDot, Tag, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelingJson } from '../types.ts'
import { modelingFixture, type ModelingFixtureName } from './fixtures.ts'
import type { ModelingClientSnapshot } from './model.ts'
import type { ModelingKey } from './locales.ts'
import css from './ModelingWorkspace.module.css'

export interface ModelingWorkspaceInjected {
  readonly preview: boolean
  readonly fixture?: ModelingFixtureName
  readonly approve: () => Promise<void>
  readonly cancel: () => Promise<void>
  readonly refresh: () => Promise<void>
  readonly updatePlan: (plan: ModelingJson) => Promise<void>
  readonly regeneratePlan: (plan: ModelingJson) => Promise<void>
  readonly artifactUrl: (artifactId: string) => string
  readonly activate: () => void
  readonly deactivate: () => void
  readonly hooks: { readonly modelingState: { getSnapshot(): ModelingClientSnapshot; subscribe(listener: () => void): () => void } }
}

export type ModelingWorkspaceProps = InjectFace<ModelingWorkspaceInjected> & PropsLocale<'modeling'> & { readonly compact?: boolean }

function value(source: unknown, fallback = '—'): string {
  if (source === null || source === undefined || source === '') return fallback
  if (typeof source === 'string' || typeof source === 'number' || typeof source === 'boolean') return String(source)
  return JSON.stringify(source)
}

function metric(metrics: Record<string, unknown> | null, key: string): unknown {
  const test = metrics?.test
  return test !== null && typeof test === 'object' && !Array.isArray(test) ? (test as Record<string, unknown>)[key] : undefined
}

function metricValue(metrics: Record<string, unknown> | null, key: string): string {
  const source = metric(metrics, key)
  if (typeof source !== 'number') return value(source)
  if (key === 'samples') return source.toLocaleString()
  return source.toFixed(4).replace(/\.?0+$/, '')
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

const SKILLS = ['data-analysis', 'data-cleaning', 'feature-engineering', 'model-training', 'model-evaluation'] as const
type SkillId = typeof SKILLS[number]

function defaultTaskContext(plan: Record<string, unknown>, profile: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return {
    schemaVersion: '1.0', datasetId: value(plan.dataset_id, ''), target: plan.target ?? null,
    taskType: value(plan.mode, 'binary_classification'), skillSequence: [...SKILLS],
    skillConfigs: {
      'data-cleaning': { missingStrategy: 'auto', outlierStrategy: 'auto' },
      'feature-engineering': { featureGeneration: true, featureSelection: true, selectionMethod: 'auto', topK: 100 },
      'model-training': { algorithm: value(object(first(plan.models)).name, 'logistic_regression') },
      'model-evaluation': { metrics: 'auto', threshold: 0.5 },
    },
    profileEvidence: {
      datasetSha256: value(plan.dataset_sha256, ''), rowCount: typeof profile?.row_count === 'number' ? profile.row_count : 0,
      target: plan.target ?? null,
    },
    decisions: {},
  }
}

function skillSequence(plan: Record<string, unknown>): SkillId[] {
  return strings(object(plan.task_context).skillSequence).filter((name): name is SkillId => SKILLS.includes(name as SkillId))
}

function validateSkillSequence(sequence: readonly SkillId[], t: (key: ModelingKey) => string): string {
  if (sequence[0] !== 'data-analysis') return t('plan.skills.analysisFirst')
  if (!sequence.includes('model-training')) return t('plan.skills.trainingRequired')
  const evaluation = sequence.indexOf('model-evaluation')
  if (evaluation >= 0 && evaluation < sequence.indexOf('model-training')) return t('plan.skills.evaluationAfterTraining')
  return ''
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return <label className={css.formField}><span>{label}</span>{children}</label>
}

function ReadonlyField({ label, children }: { label: string; children: ReactNode }) {
  return <div className={css.readonlyField}><span>{label}</span><strong>{children}</strong></div>
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

function Fact({ label, children, detail }: { label: string; children: ReactNode; detail?: string }) {
  return <div className={css.fact}><span>{label}</span><strong title={detail}>{children}</strong></div>
}

function statusLabel(status: string, t: (key: ModelingKey) => string): string {
  return ({ pending: t('run.pending'), blocked: t('run.blocked'), queued: t('run.pending'), running: t('run.running'), cancelling: t('run.running'), succeeded: t('run.succeeded'), failed: t('run.failed'), cancelled: t('run.cancelled'), interrupted: t('run.blocked') } as Record<string, string>)[status] ?? status
}

function evaluationMessage(item: Record<string, unknown>, kind: 'diagnostic' | 'recommendation', t: (key: ModelingKey) => string): string {
  const code = typeof item.code === 'string' ? item.code : ''
  const key = `result.${kind}.${code}` as ModelingKey
  return code === '' ? t('unknown') : t(key)
}

export function ModelingWorkspace(props: ModelingWorkspaceProps) {
  const { useModelingState, preview, fixture = 'succeeded', approve, cancel, refresh, updatePlan, regeneratePlan, artifactUrl, activate, deactivate, t } = props
  const live = useModelingState(snapshot => snapshot)
  useEffect(() => { activate(); return deactivate }, [activate, deactivate])
  const loaded = preview ? modelingFixture(fixture) : live
  const state = props.compact && loaded.run !== null && loaded.run.plan_revision !== loaded.plan?.revision
    ? { ...loaded, run: null, result: null } : loaded
  const [editing, setEditing] = useState(false)
  const [details, setDetails] = useState(false)
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null)
  const [editError, setEditError] = useState('')
  const [skillDirty, setSkillDirty] = useState(false)
  const [configuredSkill, setConfiguredSkill] = useState<SkillId | null>(null)
  const [draggedSkill, setDraggedSkill] = useState<SkillId | null>(null)
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
  const diagnostics = state.result?.diagnostics ?? []
  const recommendations = state.result?.recommendations ?? []
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
  const modelOptions = Array.isArray(capabilities.model_options) ? capabilities.model_options.map(object) : []
  const openEditor = () => {
    const next = JSON.parse(JSON.stringify(plan ?? {})) as Record<string, unknown>
    const missingContext = Object.keys(object(next.task_context)).length === 0
    if (missingContext) next.task_context = defaultTaskContext(next, profile)
    setDraft(next); setSkillDirty(missingContext); setConfiguredSkill(null); setEditError(''); setEditing(true)
  }
  const mutateDraft = (change: (next: Record<string, unknown>) => void) => {
    if (draft === null) return
    const next = JSON.parse(JSON.stringify(draft)) as Record<string, unknown>
    change(next)
    setDraft(next)
  }
  const mutateSkills = (change: (context: Record<string, unknown>) => void) => {
    mutateDraft((next) => {
      const context = object(next.task_context)
      change(context)
      context.decisions = {}
    })
    setSkillDirty(true)
    setEditError('')
  }
  const moveSkill = (name: SkillId, offset: -1 | 1) => {
    mutateSkills((context) => {
      const sequence = skillSequence({ task_context: context })
      const index = sequence.indexOf(name)
      const destination = index + offset
      if (index < 0 || destination < 0 || destination >= sequence.length) return
      ;[sequence[index], sequence[destination]] = [sequence[destination] as SkillId, sequence[index] as SkillId]
      context.skillSequence = sequence
    })
  }
  const toggleSkill = (name: SkillId, enabled: boolean) => {
    mutateSkills((context) => {
      const current = skillSequence({ task_context: context }).filter(item => item !== name)
      if (!enabled) { context.skillSequence = current; return }
      const desired = SKILLS.indexOf(name)
      const insertion = current.findIndex(item => SKILLS.indexOf(item) > desired)
      current.splice(insertion < 0 ? current.length : insertion, 0, name)
      context.skillSequence = current
    })
  }
  const dropSkill = (target: SkillId) => {
    if (draggedSkill === null || draggedSkill === target) return
    mutateSkills((context) => {
      const sequence = skillSequence({ task_context: context })
      const from = sequence.indexOf(draggedSkill)
      const to = sequence.indexOf(target)
      if (from < 0 || to < 0) return
      sequence.splice(from, 1)
      sequence.splice(to, 0, draggedSkill)
      context.skillSequence = sequence
    })
    setDraggedSkill(null)
  }
  const save = async () => {
    try {
      if (draft === null) return
      const sequenceError = validateSkillSequence(skillSequence(draft), t)
      if (sequenceError !== '') { setEditError(sequenceError); return }
      if (skillDirty) await regeneratePlan(draft as ModelingJson)
      else await updatePlan(draft as ModelingJson)
      setEditing(false)
    } catch (error) { setEditError(error instanceof Error ? error.message : String(error)) }
  }
  const visibleWarnings = useMemo(() => {
    const warnings = [...(state.result?.warnings ?? [])]
    if (f1 === 0 && !preview) warnings.push(t('result.noPositive'))
    return warnings
  }, [f1, preview, state.result?.warnings, t])
  const draftSequence = draft === null ? [] : skillSequence(draft)
  const displayedSkills = [...draftSequence, ...SKILLS.filter(name => !draftSequence.includes(name))]
  const draftConfigs = object(object(draft?.task_context).skillConfigs)
  const supportedSkillConfig = object(capabilities.skill_config)
  const dateFeaturesEnabled = object(object(draft?.feature_engineering).date_features).enabled === true
  const dateFeaturesSupported = capabilities.date_features_supported === true

  if (state.phase === 'loading') return <div className={css.centerState}><IconLoadingOutline16 /><span>{t('loading')}</span></div>
  if (state.phase === 'error' && state.dataset === null) return (
    <div className={css.errorCard}><IconWarningOutline16 /><div><strong>{t('error.title')}</strong><p>{state.error?.message}</p><p>{t('error.next')}</p></div><Button size="sm" variant="outline" icon={<IconRefreshOutline16 />} onClick={() => void refresh()}>{t('action.refresh')}</Button></div>
  )
  if (state.dataset === null) return <div className={css.centerState}><IconDataOutline16 /><div><strong>{t('empty.title')}</strong><p>{t('empty.body')}</p></div></div>

  return (
    <section className={`${css.workspace} ${props.compact ? css.inlineWorkspace : ''} ${props.compact && !details ? css.compactWorkspace : ''}`} aria-label={t('view.title')}>
      {props.compact && <div className={css.inlineHeader}><strong>{state.dataset.original_name}</strong><Button size="sm" variant="ghost" icon={<IconChevronDownOutline14 />} onClick={() => { setDetails(!details) }}>{t(details ? 'chat.hideDetails' : 'chat.details')}</Button></div>}
      {props.compact && state.run !== null && <div className={css.inlineHeader}><Tag tone={state.run.status === 'failed' ? 'danger' : 'info'}>{statusLabel(state.run.status, t)}</Tag><span>{state.run.nodes.map(node => `${t(node.id === 'artifacts' ? 'artifact.title' : 'chat.computation')}: ${statusLabel(value(node.status), t)}`).join(' · ')}</span></div>}
      <div className={css.topbar}>
        <div><h2>{t('view.title')}</h2><span className={css.subtitle}>{state.dataset.original_name}</span></div>
        <div className={css.topActions}><Tag tone={preview ? 'warning' : 'success'}>{t(preview ? 'preview.badge' : 'live.badge')}</Tag><Tooltip label={t('action.refresh')} side="bottom"><button className={css.iconButton} aria-label={t('action.refresh')} onClick={() => void refresh()}><IconRefreshOutline16 /></button></Tooltip></div>
      </div>
      {operationalError && <div className={css.errorCard}><IconWarningOutline16 /><div><strong>{t('error.operation')}</strong><p>{state.error?.message ?? value(state.dataset.error?.message ?? state.run?.error?.message)}</p><p>{[errorCode === undefined ? '' : `code=${errorCode}`, requestId === undefined ? '' : `request_id=${requestId}`, state.run === null ? '' : `run_id=${state.run.id}`].filter(Boolean).join(' · ')}</p><p>{t('error.next')}</p></div>{state.plan !== null && terminal && !preview && <Button size="sm" variant="outline" icon={<IconEditOutline16 />} onClick={openEditor}>{t('error.revisePlan')}</Button>}</div>}
      <div className={css.mainColumn}>
        <article className={css.card}>
          <CardTitle icon={<IconPlayOutline16 />} title={t('process.pipeline')} trailing={state.run !== null && <Tag tone={terminal ? state.run.status === 'succeeded' ? 'success' : 'danger' : 'info'}>{statusLabel(state.run.status, t)}</Tag>} />
          <div className={css.pipeline}>
            {stages.map((label, index) => <div className={css.pipelineStage} key={label}><span className={css.stageMarker}><StateDot state={stageState} /></span><span>{label}</span>{state.run?.status === 'succeeded' && <small>{index < stages.length - 1 ? '✓' : t('run.done')}</small>}</div>)}
          </div>
        </article>
        <article className={css.card}>
          <CardTitle icon={<IconPlayOutline16 />} title={t('plan.title')} trailing={<Tag tone={state.plan?.state === 'proposed' ? 'warning' : 'success'}>{state.plan === null ? t('unknown') : <>{state.plan.state} · {t('plan.revisionShort')}{state.plan.revision}</>}</Tag>} />
          {props.compact && <p className={css.skillSummary}>{skillSequence(plan ?? {}).map(name => t(`skill.${name}`)).join(' → ')}</p>}
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
        {state.result !== null && <article className={css.card}>
          <CardTitle icon={<IconCheckOutline16 />} title={t('result.title')} trailing={<Tag tone="success">{t('run.succeeded')}</Tag>} />
          <div className={css.metrics}>
            <Fact label={t('result.auc')} detail={value(metric(metrics, 'roc_auc'))}>{metricValue(metrics, 'roc_auc')}</Fact><Fact label={t('result.ap')} detail={value(metric(metrics, 'average_precision'))}>{metricValue(metrics, 'average_precision')}</Fact><Fact label={t('result.f1')} detail={value(f1)}>{metricValue(metrics, 'f1')}</Fact><Fact label={t('result.precision')} detail={value(metric(metrics, 'precision'))}>{metricValue(metrics, 'precision')}</Fact><Fact label={t('result.recall')} detail={value(metric(metrics, 'recall'))}>{metricValue(metrics, 'recall')}</Fact><Fact label={t('result.samples')} detail={value(metric(metrics, 'samples'))}>{metricValue(metrics, 'samples')}</Fact><Fact label={t('result.threshold')} detail={value(metric(metrics, 'threshold'))}>{metricValue(metrics, 'threshold')}</Fact>
          </div>
          <div className={css.matrix}><span>{t('result.matrix')}</span><code>{value(metric(metrics, 'confusion_matrix'))}</code></div>
          <div className={css.evaluationGrid}>
            <section><h3>{t('result.diagnostics')}</h3><ul>{diagnostics.map((item, index) => <li key={`${String(item.code)}-${index}`}>{evaluationMessage(item, 'diagnostic', t)}</li>)}</ul></section>
            <section><h3>{t('result.recommendations')}</h3><ul>{recommendations.map((item, index) => <li key={`${String(item.code)}-${index}`}>{evaluationMessage(item, 'recommendation', t)}</li>)}</ul></section>
          </div>
          {visibleWarnings.map(warning => (
            <div className={css.warning} key={warning}><IconWarningOutline16 /><span>{warning}</span></div>
          ))}
          <div className={css.actions}><Button size="sm" variant="outline" icon={<IconEditOutline16 />} disabled={preview} onClick={openEditor}>{t('result.adjustRerun')}</Button></div>
        </article>}
        <article className={css.card}>
          <CardTitle icon={<IconPlayOutline16 />} title={t('process.title')} />
          <div className={css.processGrid}>
            <section className={css.processSection}>
              <h3>{t('process.history')}</h3>
              {state.run !== null && !terminal && <Button size="sm" variant="outline" icon={<IconStopFill16 />} onClick={() => void cancel()}>{t('action.cancelRun')}</Button>}
              <div className={css.runHistory}>{state.runs.map((item, index) => <div className={css.runHistoryItem} key={item.id}><strong>{t('run.number')} #{index + 1}</strong><span>{t('plan.revisionShort')}{item.plan_revision} · {statusLabel(item.status, t)}</span><small>{item.created_at}</small></div>)}</div>
            </section>
            <section className={css.processSection}>
              <h3>{t('artifact.title')}</h3>
              <div className={css.artifacts}>{artifacts.map((item) => {
                const id = typeof item.id === 'string' ? item.id : ''
                const kind = value(item.kind)
                return id === '' ? null : <a className={css.artifact} href={artifactUrl(id)} key={id} download><IconDownloadOutline16 /><span>{kind}</span></a>
              })}{artifacts.length === 0 && <span className={css.muted}>{t('artifact.unavailable')}</span>}</div>
            </section>
          </div>
        </article>
      </div>
      <Modal className={css.planDialog ?? ''} contentClassName={css.planDialogContent ?? ''} open={editing} onClose={() => { setEditing(false) }} title={t('plan.dialog.title')} closeLabel={t('close')} description={t('plan.dialog.description')} footer={<><Button variant="ghost" onClick={() => { setEditing(false) }}>{t('action.cancel')}</Button><Button variant="primary" icon={<IconCheckOutline16 />} onClick={() => void save()}>{t(skillDirty || props.compact ? 'action.regenerate' : 'action.save')}</Button></>}>
        {draft !== null && <div className={css.planEditor}>
          <ol className={css.planStepper} aria-label={t('plan.dialog.pipeline')}>
            {stages.slice(0, 6).map((label, index) => <li key={label}><span>{index + 1}</span><strong>{label}</strong></li>)}
          </ol>

          <section className={css.editorSection}>
            <div className={css.sectionHeading}><div><h3>{t('plan.skills.title')}</h3><p>{t('plan.skills.description')}</p></div><Tag tone={skillDirty ? 'warning' : 'success'}>{t(skillDirty ? 'plan.skills.pending' : 'plan.skills.current')}</Tag></div>
            <div className={css.skillSequence}>
              {displayedSkills.map((name) => {
                const enabled = draftSequence.includes(name)
                const required = name === 'data-analysis' || name === 'model-training'
                const index = draftSequence.indexOf(name)
                const configurable = name !== 'data-analysis'
                return <div className={`${css.skillRow} ${enabled ? '' : css.skillDisabled}`} key={name} draggable={enabled} onDragStart={() => { setDraggedSkill(name) }} onDragOver={(event) => { if (enabled) event.preventDefault() }} onDrop={() => { dropSkill(name) }}>
                  <span className={css.dragHandle} aria-hidden="true">⋮⋮</span>
                  <label className={css.skillToggle}><input type="checkbox" checked={enabled} disabled={required} onChange={(event) => { toggleSkill(name, event.target.checked) }} /><span>{t(`skill.${name}`)}</span></label>
                  <small>{required ? t('plan.skills.required') : t('plan.skills.optional')}</small>
                  <div className={css.skillActions}>
                    {enabled && <><button type="button" aria-label={t('plan.skills.moveUp')} disabled={index <= 0} onClick={() => { moveSkill(name, -1) }}><IconChevronUpOutline14 /></button><button type="button" aria-label={t('plan.skills.moveDown')} disabled={index < 0 || index >= draftSequence.length - 1} onClick={() => { moveSkill(name, 1) }}><IconChevronDownOutline14 /></button></>}
                    {configurable && <Button size="sm" variant="ghost" onClick={() => { setConfiguredSkill(configuredSkill === name ? null : name) }}>{t('plan.skills.configure')}</Button>}
                  </div>
                  {configuredSkill === name && <div className={css.skillConfig}>
                    {name === 'data-cleaning' && <div className={css.formGrid}>
                      <FormField label={t('plan.skills.missingStrategy')}><select value={value(object(draftConfigs['data-cleaning']).missingStrategy, 'auto')} onChange={(event) => { mutateSkills((context) => { object(object(context.skillConfigs)['data-cleaning']).missingStrategy = event.target.value }) }}>{['auto', 'mean', 'median', 'mode', 'keep'].map(option => <option value={option} disabled={!strings(supportedSkillConfig.missing_strategy).includes(option)} key={option}>{t(`plan.option.${option}` as ModelingKey)}{strings(supportedSkillConfig.missing_strategy).includes(option) ? '' : ` · ${t('plan.skills.unsupported')}`}</option>)}</select></FormField>
                      <FormField label={t('plan.skills.outlierStrategy')}><select value={value(object(draftConfigs['data-cleaning']).outlierStrategy, 'auto')} onChange={(event) => { mutateSkills((context) => { object(object(context.skillConfigs)['data-cleaning']).outlierStrategy = event.target.value }) }}>{['auto', 'keep', 'iqr', 'mad', 'winsorize'].map(option => <option value={option} disabled={!strings(supportedSkillConfig.outlier_strategy).includes(option)} key={option}>{t(`plan.option.${option}` as ModelingKey)}{strings(supportedSkillConfig.outlier_strategy).includes(option) ? '' : ` · ${t('plan.skills.unsupported')}`}</option>)}</select></FormField>
                    </div>}
                    {name === 'feature-engineering' && <div className={css.formGrid}>
                      <label className={css.featureToggle}><input type="checkbox" checked={object(draftConfigs['feature-engineering']).featureGeneration === true} onChange={(event) => { mutateSkills((context) => { object(object(context.skillConfigs)['feature-engineering']).featureGeneration = event.target.checked }) }} /><span>{t('plan.skills.featureGeneration')}</span></label>
                      <label className={css.featureToggle}><input type="checkbox" checked={object(draftConfigs['feature-engineering']).featureSelection === true} onChange={(event) => { mutateSkills((context) => { object(object(context.skillConfigs)['feature-engineering']).featureSelection = event.target.checked }) }} /><span>{t('plan.skills.featureSelection')}</span></label>
                      <FormField label={t('plan.skills.selectionMethod')}><select value={value(object(draftConfigs['feature-engineering']).selectionMethod, 'auto')} onChange={(event) => { mutateSkills((context) => { object(object(context.skillConfigs)['feature-engineering']).selectionMethod = event.target.value }) }}>{['auto', 'mutual_information', 'variance', 'correlation'].map(option => <option key={option} value={option}>{t(`plan.option.${option}` as ModelingKey)}</option>)}</select></FormField>
                      <FormField label={t('plan.skills.topK')}><input type="number" min="1" max="10000" value={Number(object(draftConfigs['feature-engineering']).topK)} onChange={(event) => { mutateSkills((context) => { object(object(context.skillConfigs)['feature-engineering']).topK = Number(event.target.value) }) }} /></FormField>
                    </div>}
                    {name === 'model-training' && <FormField label={t('plan.algorithm')}><select value={value(object(draftConfigs['model-training']).algorithm, 'logistic_regression')} onChange={(event) => { mutateSkills((context) => { object(object(context.skillConfigs)['model-training']).algorithm = event.target.value }) }}>{modelOptions.map(option => <option value={value(option.name, '')} disabled={option.supported !== true} key={value(option.name, '')}>{value(option.name)}{option.supported === true ? '' : ` · ${t('plan.skills.unsupported')}`}</option>)}</select></FormField>}
                    {name === 'model-evaluation' && <div className={css.formGrid}><ReadonlyField label={t('plan.skills.metrics')}>{value(object(draftConfigs['model-evaluation']).metrics)}</ReadonlyField><ReadonlyField label={t('result.threshold')}>{value(object(draftConfigs['model-evaluation']).threshold)}</ReadonlyField></div>}
                  </div>}
                </div>
              })}
            </div>
            <p className={css.skillHint}>{t('plan.skills.regenerateHint')}</p>
          </section>

          <section className={css.editorSection}>
            <h3>{t('plan.section.basic')}</h3>
            <div className={css.basicGrid}>
              <FormField label={t('plan.target')}><select value={value(draft.target, '')} onChange={(event) => {
                mutateDraft((next) => {
                  next.target = event.target.value
                  const context = object(next.task_context)
                  context.target = event.target.value
                  object(context.profileEvidence).target = event.target.value
                  context.decisions = {}
                })
                setSkillDirty(true)
              }}>{columns.map(name => <option value={name} key={name}>{name}</option>)}</select></FormField>
              <ReadonlyField label={t('plan.task')}>{value(draft.mode ?? draft.task_type, t('task.binary'))}</ReadonlyField>
              <ReadonlyField label={t('plan.dataset')}>{state.dataset.original_name}</ReadonlyField>
              <ReadonlyField label={t('plan.currentRevision')}>{state.plan === null ? t('unknown') : `${t('plan.revisionShort')}${state.plan.revision}`}</ReadonlyField>
            </div>
          </section>

          <section className={css.editorSection}>
            <h3>{t('plan.section.data')}</h3>
            <details className={css.choiceDisclosure}><summary><span>{t('plan.exclude')}</span><span className={css.chipRow}>{strings(draft.excluded_columns).length === 0 ? <em>{t('plan.noneSelected')}</em> : strings(draft.excluded_columns).map(name => <span className={css.chip} title={name} key={name}>{name}</span>)}</span></summary><div className={css.optionGrid}>{columns.filter(name => name !== draft.target).map(name => <label className={css.check} key={name}><input type="checkbox" checked={strings(draft.excluded_columns).includes(name)} onChange={(event) => {
              mutateDraft((next) => {
                const current = new Set(strings(next.excluded_columns))
                if (event.target.checked) current.add(name)
                else current.delete(name)
                next.excluded_columns = [...current]
              })
            }} /><span title={name}>{name}</span></label>)}</div></details>
          </section>

          <section className={css.editorSection}>
            <h3>{t('plan.section.split')}</h3>
            <div className={css.formGrid}>{(['train_ratio', 'validation_ratio', 'test_ratio'] as const).map(key => <FormField label={t(`plan.${key}`)} key={key}><input type="number" min="0.01" max="0.98" step="0.01" value={Number(object(draft.split)[key])} onChange={(event) => { mutateDraft((next) => { object(next.split)[key] = Number(event.target.value) }) }} /></FormField>)}</div>
          </section>

          <section className={css.editorSection}>
            <h3>{t('plan.section.preprocessing')}</h3>
            <div className={css.formGrid}>
              <FormField label={t('plan.missing')}><select value={value(object(draft.preprocessing).numeric_missing, '')} onChange={(event) => { mutateDraft((next) => { object(next.preprocessing).numeric_missing = event.target.value }) }}>{strings(capabilities.numeric_missing).map(item => <option key={item}>{item}</option>)}</select></FormField>
              <FormField label={t('plan.categoricalMissing')}><input value={value(object(draft.preprocessing).categorical_missing_value, '')} onChange={(event) => { mutateDraft((next) => { object(next.preprocessing).categorical_missing_value = event.target.value }) }} /></FormField>
              <FormField label={t('plan.encoding')}><select value={value(object(draft.preprocessing).categorical_encoding, '')} onChange={(event) => { mutateDraft((next) => { object(next.preprocessing).categorical_encoding = event.target.value }) }}>{strings(capabilities.categorical_encoding).map(item => <option key={item}>{item}</option>)}</select></FormField>
            </div>
          </section>

          <section className={css.editorSection}>
            <h3>{t('plan.section.features')}</h3>
            <label className={css.featureToggle}><input type="checkbox" checked={dateFeaturesEnabled} disabled={!dateFeaturesSupported && !dateFeaturesEnabled} onChange={(event) => {
              if (event.target.checked && !dateFeaturesSupported) return
              mutateDraft((next) => { object(object(next.feature_engineering).date_features).enabled = event.target.checked })
            }} /><span>{t('plan.dateEnabled')}{!dateFeaturesSupported && <> · {t('plan.dateUnsupported')}</>}</span></label>
            <div className={css.featureGrid}>
              <details className={css.choiceDisclosure}><summary><span>{t('plan.dateColumns')}</span><span className={css.chipRow}>{strings(object(object(draft.feature_engineering).date_features).columns).length === 0 ? <em>{t('plan.noneSelected')}</em> : strings(object(object(draft.feature_engineering).date_features).columns).map(name => <span className={css.chip} title={name} key={name}>{name}</span>)}</span></summary><div className={css.optionGrid}>{columns.filter(name => name !== draft.target).map(name => <label className={css.check} key={name}><input type="checkbox" checked={strings(object(object(draft.feature_engineering).date_features).columns).includes(name)} onChange={(event) => {
                mutateDraft((next) => {
                  const dates = object(object(next.feature_engineering).date_features)
                  const current = new Set(strings(dates.columns))
                  if (event.target.checked) current.add(name)
                  else current.delete(name)
                  dates.columns = [...current]
                })
              }} /><span title={name}>{name}</span></label>)}</div></details>
              <details className={css.choiceDisclosure}><summary><span>{t('plan.dateComponents')}</span><span className={css.chipRow}>{strings(object(object(draft.feature_engineering).date_features).components).length === 0 ? <em>{t('plan.noneSelected')}</em> : strings(object(object(draft.feature_engineering).date_features).components).map(name => <span className={css.chip} key={name}>{name}</span>)}</span></summary><div className={css.optionGrid}>{strings(capabilities.date_components).map(component => <label className={css.check} key={component}><input type="checkbox" checked={strings(object(object(draft.feature_engineering).date_features).components).includes(component)} onChange={(event) => {
                mutateDraft((next) => {
                  const dates = object(object(next.feature_engineering).date_features)
                  const current = new Set(strings(dates.components))
                  if (event.target.checked) current.add(component)
                  else current.delete(component)
                  dates.components = [...current]
                })
              }} /><span>{component}</span></label>)}</div></details>
            </div>
          </section>

          <section className={css.editorSection}>
            <h3>{t('plan.section.model')}</h3>
            <div className={css.formGrid}>
              <ReadonlyField label={t('plan.algorithm')}>{value(object(first(draft.models)).name ?? object(draft.model).type)}</ReadonlyField>
              <FormField label={t('plan.logisticC')}><input type="number" min={Number(cBounds.min)} max={Number(cBounds.max)} step="0.1" value={Number(object(object(first(draft.models)).params).C)} onChange={(event) => { mutateDraft((next) => { object(object(first(next.models)).params).C = Number(event.target.value) }) }} /></FormField>
              <FormField label="max_iter"><input type="number" min={Number(iterationBounds.min)} max={Number(iterationBounds.max)} step="50" value={Number(object(object(first(draft.models)).params).max_iter)} onChange={(event) => { mutateDraft((next) => { object(object(first(next.models)).params).max_iter = Number(event.target.value) }) }} /></FormField>
            </div>
          </section>

          <section className={css.editorSection}>
            <h3>{t('plan.section.limits')}</h3>
            <div className={css.formGrid}>{(['max_train_seconds', 'max_run_seconds', 'max_output_features'] as const).map((key) => { const bounds = object(object(capabilities.limits)[key]); return <FormField label={key} key={key}><input type="number" min={Number(bounds.min)} max={Number(bounds.max)} value={Number(object(draft.limits)[key])} onChange={(event) => { mutateDraft((next) => { object(next.limits)[key] = Number(event.target.value) }) }} /></FormField> })}</div>
          </section>
        </div>}{editError !== '' && <p className={css.editError} role="alert">{editError}</p>}
      </Modal>
    </section>
  )
}
