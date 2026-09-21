/** Demo-focused Skill detail with governance metadata and existing Draft controls. */
import { useEffect, useMemo, useState } from 'react'
import {
  Button, IconCheckOutline16, IconDataOutline16, IconEditOutline16, IconSparkle16, Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelingKey } from './locales.ts'
import type { ModelingClientModel, ModelingClientSnapshot, ModelingSkillDetail } from './model.ts'
import css from './Navigation.module.css'

type Tab = 'contract' | 'schema' | 'tools' | 'evals'

/** Existing Session model and locale inputs for the Skill Center detail view. */
export interface SkillCenterProps extends PropsLocale<'modeling'> {
  readonly model: ModelingClientModel
  readonly state: ModelingClientSnapshot
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function valueText(value: unknown, empty: string): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return empty
}

function ContractTab({ detail, t }: { detail: ModelingSkillDetail } & PropsLocale<'modeling'>) {
  const contract = detail.extension.contract
  if (contract === null) return <div className={css.emptyState}><strong>{t('skills.contractEmpty')}</strong><p>{t('skills.extensionHint')}</p></div>
  const fields = [
    ['skills.skillName', contract.name], ['skills.displayName', contract.displayName], ['skills.version', contract.version],
    ['skills.stage', contract.stage],
    ['skills.modelInvocable', contract.modelInvocable === true ? t('skills.yes') : t('skills.no')],
    ['skills.userInvocable', contract.userInvocable === true ? t('skills.yes') : t('skills.no')],
  ] as const
  return <div className={css.tabStack}>
    <section className={css.detailCard}><h4>{t('skills.basicInformation')}</h4><dl className={css.detailGrid}>{fields.map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{valueText(value, t('unknown'))}</dd></div>)}</dl><p>{valueText(contract.description, t('unknown'))}</p></section>
    <section className={css.detailCard}><h4>{t('skills.conditions')}</h4><div className={css.twoColumns}><div><strong>{t('skills.preconditions')}</strong><ul>{strings(contract.preconditions).map(item => <li key={item}><code>{item}</code></li>)}</ul></div><div><strong>{t('skills.postconditions')}</strong><ul>{strings(contract.postconditions).map(item => <li key={item}><code>{item}</code></li>)}</ul></div></div></section>
  </div>
}

interface SchemaRow {
  readonly path: string
  readonly type: string
  readonly required: boolean
  readonly description: string
  readonly detail: string
}

function schemaRows(schema: Record<string, unknown> | null, prefix = '$'): SchemaRow[] {
  if (schema === null) return []
  const properties = schema.properties
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) return []
  const required = new Set(strings(schema.required))
  return Object.entries(properties as Record<string, unknown>).flatMap(([name, raw]) => {
    const field = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
    const type = Array.isArray(field.type) ? field.type.join(' | ') : valueText(field.type, field.enum === undefined ? '—' : 'enum')
    const detail = Array.isArray(field.enum) ? field.enum.join(', ')
      : field.default === undefined ? '—' : `default: ${JSON.stringify(field.default)}`
    const row = { path: `${prefix}.${name}`, type, required: required.has(name), description: valueText(field.description, '—'), detail }
    return [row, ...schemaRows(field, row.path)]
  })
}

function SchemaTable({ title, schema, t }: { title: string; schema: Record<string, unknown> | null } & PropsLocale<'modeling'>) {
  const rows = useMemo(() => schemaRows(schema), [schema])
  return <section className={css.detailCard}><h4>{title}</h4>{schema === null
    ? <div className={css.emptyState}><strong>{t('skills.schemaEmpty')}</strong></div>
    : <div className={css.tableScroll}><table className={css.schemaTable}><thead><tr><th>{t('skills.field')}</th><th>{t('skills.type')}</th><th>{t('skills.required')}</th><th>{t('skills.description')}</th><th>{t('skills.constraints')}</th></tr></thead><tbody>{rows.map(row => <tr key={row.path}><td><code>{row.path}</code></td><td>{row.type}</td><td>{row.required ? t('skills.yes') : t('skills.no')}</td><td>{row.description}</td><td>{row.detail}</td></tr>)}</tbody></table></div>}</section>
}

function SchemaTab({ detail, t }: { detail: ModelingSkillDetail } & PropsLocale<'modeling'>) {
  return <div className={css.tabStack}><SchemaTable title={t('skills.inputSchema')} schema={detail.extension.inputSchema} t={t} /><SchemaTable title={t('skills.outputSchema')} schema={detail.extension.outputSchema} t={t} /></div>
}

function toolNames(policy: Record<string, unknown> | null, kind: 'required' | 'optional'): readonly string[] {
  const entries = policy?.[kind]
  if (!Array.isArray(entries)) return []
  return entries.flatMap(item => item !== null && typeof item === 'object' && !Array.isArray(item) && typeof (item as Record<string, unknown>).name === 'string' ? [(item as { name: string }).name] : [])
}

function ToolsTab({ detail, t }: { detail: ModelingSkillDetail } & PropsLocale<'modeling'>) {
  const required = new Set(toolNames(detail.extension.tools, 'required'))
  const optional = new Set(toolNames(detail.extension.tools, 'optional'))
  const declared = detail.extension.toolCatalog.filter(tool => required.has(tool.name) || optional.has(tool.name))
  if (detail.extension.tools === null) return <div className={css.emptyState}><strong>{t('skills.toolsEmpty')}</strong><p>{t('skills.extensionHint')}</p></div>
  return <div className={css.tabStack}><p className={css.scopeNote}><Tag tone="info">{t('skills.metadata')}</Tag>{t('skills.toolScope')}</p>{(['required', 'optional'] as const).map(kind => <section className={css.detailCard} key={kind}><h4>{t(kind === 'required' ? 'skills.requiredTools' : 'skills.optionalTools')}</h4><div className={css.toolList}>{declared.filter(tool => (kind === 'required' ? required : optional).has(tool.name)).map(tool => <article key={tool.name}><div><code>{tool.name}</code><p>{t(`skills.tool.${tool.name}` as ModelingKey)}</p></div><Tag tone={tool.available ? 'success' : 'danger'}>{tool.available ? t('skills.available') : t('skills.unavailable')}</Tag></article>)}</div></section>)}</div>
}

function EvalsTab({ detail, t }: { detail: ModelingSkillDetail } & PropsLocale<'modeling'>) {
  const passed = detail.extension.checks.filter(check => check.status === 'pass').length
  const checkLabel = (id: string, label: string): string => id === 'tool-availability' ? t('skills.checkToolAvailabilityLabel') : label
  const checkMessage = (id: string, status: string): string => {
    if (status === 'fail') return t('skills.checkFailed')
    if (status === 'not_configured') return t('skills.checkNotConfigured')
    if (id === 'instructions') return t('skills.checkInstructions')
    if (id === 'tool-availability') return t('skills.checkToolsAvailable')
    return t('skills.checkConfigured')
  }
  return <div className={css.tabStack}>
    <p className={css.scopeNote}><Tag tone="info">{t('skills.checks')}</Tag>{t('skills.evalScope')}</p>
    <section className={css.evalSummary}><div><strong>{passed}</strong><span>{t('skills.passed')}</span></div><div><strong>{detail.extension.checks.length - passed}</strong><span>{t('skills.attention')}</span></div><div><strong>{detail.extension.checks.length}</strong><span>{t('skills.total')}</span></div></section>
    <section className={css.detailCard}><h4>{t('skills.configurationChecks')}</h4><div className={css.checkList}>{detail.extension.checks.map(check => <article key={check.id}><Tag tone={check.status === 'pass' ? 'success' : check.status === 'fail' ? 'danger' : 'warning'}>{t(check.status === 'pass' ? 'skills.checkPass' : check.status === 'fail' ? 'skills.checkFail' : 'skills.checkUnavailable')}</Tag><div><strong>{checkLabel(check.id, check.label)}</strong><p>{checkMessage(check.id, check.status)}</p></div></article>)}</div></section>
  </div>
}

/** Render one selected Skill without changing its Harness runtime behavior. */
export function SkillCenter({ model, state, t }: SkillCenterProps) {
  const [draft, setDraft] = useState('')
  const [tab, setTab] = useState<Tab>('contract')
  const detail = state.skillDetail
  useEffect(() => { if (detail !== null) setDraft(detail.draft_content ?? detail.published_content) }, [detail])
  if (detail === null) return null
  const content = tab === 'contract' ? <ContractTab detail={detail} t={t} />
    : tab === 'schema' ? <SchemaTab detail={detail} t={t} />
      : tab === 'tools' ? <ToolsTab detail={detail} t={t} /> : <EvalsTab detail={detail} t={t} />
  return <section className={css.editorPanel}>
    <div className={css.editorHead}><div><h3>{detail.name}</h3><span>{detail.published_version}</span></div><div className={css.headerBadges}><Tag tone={detail.draft_hash === null ? 'success' : 'warning'}>{detail.draft_hash === null ? t('skills.published') : t('skills.draft')}</Tag><Tag tone="info">{t('skills.metadata')}</Tag></div></div>
    <details className={css.instructions}><summary><IconDataOutline16 />{t('skills.instructions')}</summary><textarea value={draft} aria-label={t('skills.markdown')} onChange={(event) => { setDraft(event.target.value) }} />
      {detail.validation !== null && <div className={css.validation}><strong>{detail.validation.valid === true ? t('skills.validationPass') : t('skills.validationFail')}</strong><pre>{JSON.stringify(detail.validation, null, 2)}</pre></div>}
      <div className={css.actions}><Button size="sm" variant="outline" icon={<IconEditOutline16 />} disabled={state.skillBusy} onClick={() => { void model.saveSkillDraft(detail.name, draft) }}>{t('skills.saveDraft')}</Button><Button size="sm" variant="outline" icon={<IconCheckOutline16 />} disabled={state.skillBusy || detail.draft_hash === null} onClick={() => { void model.validateSkill(detail.name) }}>{t('skills.validate')}</Button><Button size="sm" variant="primary" icon={<IconSparkle16 />} disabled={state.skillBusy || detail.validation?.valid !== true} onClick={() => { void model.publishSkill(detail.name) }}>{t('skills.publish')}</Button></div>
    </details>
    <nav className={css.tabs} aria-label={t('skills.detailTabs')}>{(['contract', 'schema', 'tools', 'evals'] as const).map(name => <button type="button" key={name} aria-selected={tab === name} onClick={() => { setTab(name) }}>{t(`skills.tab.${name}`)}</button>)}</nav>
    <div className={css.tabContent}>{content}</div>
  </section>
}
