/** Focused model setup and task model selection, backed by Harness providers. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Surface } from './face.ts'
import type { ModelDraft, ModelSettings } from './model-settings.ts'
import { z } from 'zod'
import css from './workbench.module.css'
const empty: ModelDraft = {
  id: 'workbench-local',
  name: '',
  baseURL: 'http://127.0.0.1:11434/v1',
  model: 'qwen3.5:9b',
  format: 'openai',
  reasoning: 'off',
  contextWindow: 32768,
  maxTokens: 4096,
  timeoutMs: 120000,
}
/** Manage shared profiles without returning saved secrets to the browser.
 * @param p - Workbench callbacks and copy.
 * @returns Model configuration dialog content.
 */
export function ModelConfiguration(p: Surface) {
  const [state, setState] = useState<ModelSettings>(),
    [draft, setDraft] = useState<ModelDraft>(() => ({
      ...empty, name: p.t('modelLocal'),
      id: 'workbench-' + randomUUID().slice(0, 8),
    })),
    [key, setKey] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [saved, setSaved] = useState(false),
    [editing, setEditing] = useState(''),
    [template, setTemplate] = useState('local'),
    [confirmDelete, setConfirmDelete] = useState(false)
  const load = async () => {
    const next = await p.models.load()
    setState(next)
    return next
  }
  useEffect(() => {
    let active = true
    void p.models.load().then(
      (value) => {
        if (active) setState(value)
      },
      () => {
        if (active) setError(p.t('modelLoadFailed'))
      },
    )
    return () => {
      active = false
    }
  }, [p.models, p.t])
  const change = <K extends keyof ModelDraft>(field: K, value: ModelDraft[K]) => {
    setDraft(d => ({ ...d, [field]: value }))
    setSaved(false)
    setNotice('')
  }
  const act = async (work: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await work()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'MODEL_REQUEST_FAILED')
    } finally {
      setBusy(false)
    }
  }
  const reset = () => {
    setEditing('')
    setDraft({ ...empty, name: p.t('modelLocal'), id: 'workbench-' + randomUUID().slice(0, 8) })
    setTemplate('local')
    setKey('')
    setSaved(false)
    setConfirmDelete(false)
    setNotice('')
    setError('')
  }
  const test = async () => {
    const result = await p.models.test(draft.id, draft.model)
    setNotice(`${p.t(result.ok ? 'modelTestOk' : 'modelTestFailed')} · ${result.code} · ${result.durationMs} ms`)
  }
  const save = async (andTest: boolean) => {
    if (!state) return
    try {
      await p.models.save(draft, !editing && template === 'local' && !key.trim() ? 'ollama' : key, state)
      setKey('')
      setSaved(true)
      setEditing(draft.id)
      setNotice(p.t('modelSavedNotice'))
    } finally { await load() }
    if (andTest) await test()
  }
  const incomplete = !draft.name.trim() || !draft.baseURL.trim() || !draft.model.trim()
  return (
    <section className={css.stack}>
      <p className={css.subtitle}>{p.t('modelQuickHint')}</p>
      <div className={css.modelPicker}>
        <label>
          {p.t('modelSaved')}
          <select
            disabled={busy}
            value={editing}
            onChange={(e) => {
              setConfirmDelete(false)
              setError('')
              const row = state?.rows.find(r => r.id === e.target.value)
              if (row) {
                const { configured: _, ...value } = row
                setEditing(row.id)
                setDraft(value)
                setKey('')
                setSaved(true)
                setNotice('')
              } else {
                reset()
              }
            }}
          >
            <option value="">{p.t('modelNew')}</option>
            {state?.rows.map(row => (
              <option key={row.id} value={row.id}>
                {row.name} · {row.model} · {p.t(row.configured ? 'modelKeySet' : 'modelKeyMissing')}
              </option>
            ))}
          </select>
        </label>
        <Button disabled={busy || !state?.writable} onClick={reset}>{p.t('modelNew')}</Button>
      </div>
      <fieldset disabled={busy || !state?.writable} className={css.modelForm}>
        {!editing && <label>
          {p.t('modelTemplate')}
          <select
            value={template}
            onChange={(e) => {
              const kind = e.target.value
              setTemplate(kind)
              if (!kind) return
              setEditing('')
              const suffix = randomUUID().slice(0, 8)
              setDraft(
                kind === 'local'
                  ? {
                    ...empty, name: p.t('modelLocal'),
                    id: state?.rows.some(row => row.id === empty.id)
                      ? 'workbench-local-' + suffix
                      : empty.id,
                  }
                  : {
                    ...empty,
                    id: 'workbench-' + kind + '-' + suffix,
                    name: kind === 'deepseek' ? 'DeepSeek' : 'API Relay',
                    baseURL: kind === 'deepseek' ? 'https://api.deepseek.com' : '',
                    model: kind === 'deepseek' ? 'deepseek-v4-flash' : '',
                    format: kind === 'deepseek' ? 'deepseek' : 'openai',
                    reasoning: 'default',
                    contextWindow: 131072,
                  },
              )
              setKey(kind === 'local' ? 'ollama' : '')
              setSaved(false)
              setNotice('')
            }}
          >
            <option value="">{p.t('choose')}</option>
            <option value="deepseek">{p.t('modelOfficial')}</option>
            <option value="relay">{p.t('modelRelay')}</option>
            <option value="local">{p.t('modelLocal')}</option>
          </select>
        </label>}
        {(['name', 'baseURL', 'model'] as const).map(field => (
          <label key={field}>
            {p.t(
              ({ name: 'modelName', id: 'modelRoute', baseURL: 'modelBaseURL', model: 'modelId' } as const)[
                field
              ],
            )}
            <Input
              value={draft[field]}
              onChange={(e) => {
                change(field, e.target.value)
              }}
            />
          </label>
        ))}
        <label>
          {p.t('modelApiKey')}
          <Input
            type="password"
            autoComplete="new-password"
            value={key}
            placeholder={p.t('modelKeyHint')}
            onChange={(e) => {
              setKey(e.target.value)
              setSaved(false)
            }}
          />
        </label>
        <small>{p.t(!editing && template === 'local' ? 'modelLocalAutoKey' : 'modelKeyHint')}</small>
        <details>
          <summary>{p.t('modelParameters')}</summary>
          <div className={css.stack}>
            <label>{p.t('modelRoute')}<Input aria-label={p.t('modelRoute')} value={draft.id} disabled={editing !== ''} onChange={(e) => { change('id', e.target.value) }} /><small>{p.t('modelAutoIdHint')}</small></label>
            <label>
              {p.t('modelFormat')}
              <select
                value={draft.format}
                onChange={(e) => {
                  change('format', e.target.value as ModelDraft['format'])
                }}
              >
                <option value="openai">{p.t('modelOpenAIFormat')}</option>
                <option value="deepseek">{p.t('modelDeepSeekFormat')}</option>
              </select>
            </label>
            <label>
              {p.t('modelThinking')}
              <select
                value={draft.reasoning}
                onChange={(e) => {
                  change('reasoning', e.target.value as ModelDraft['reasoning'])
                }}
              >
                {(['default', 'off', 'low', 'medium', 'high', 'max'] as const)
                  .filter(level => !(draft.format === 'deepseek' && level === 'medium'))
                  .map(level => (
                    <option key={level} value={level}>
                      {p.t(`thinking_${level}` as const)}
                    </option>
                  ))}
              </select>
            </label>
            {(['contextWindow', 'maxTokens', 'timeoutMs'] as const).map(field => (
              <label key={field}>
                {p.t(field)}
                <Input
                  type="number"
                  value={draft[field]}
                  onChange={(e) => {
                    change(field, Number(e.target.value))
                  }}
                />
              </label>
            ))}
          </div>
        </details>
        <div className={css.modelActions}>
          <Button className={css.primaryAction} variant="primary" disabled={incomplete} onClick={() => void act(() => save(true))}>{p.t(busy ? 'busy' : 'modelSaveAndTest')}</Button>
          <Button disabled={incomplete} onClick={() => void act(() => save(false))}>{p.t('modelSave')}</Button>
          <Button disabled={!saved} onClick={() => void act(test)}>{p.t('modelTest')}</Button>
          {editing && <Button className={css.dangerButton} onClick={() => { setConfirmDelete(true) }}>{p.t('modelDelete')}</Button>}
        </div>
        {confirmDelete && <div className={css.modelDeleteConfirm} role="group" aria-label={p.t('modelDelete')}>
          <strong>{p.t('modelDelete')} · {state?.rows.find(row => row.id === editing)?.name}</strong>
          <p>{p.t('modelDeleteHint')}</p>
          <div className={css.row}>
            <Button onClick={() => void act(async () => {
              if (!state) return
              let next = state
              try { await p.models.remove(editing, state) } finally { next = await load() }
              if (next.rows.some(row => row.id === editing)) throw new Error(p.t('modelDeleteManaged'))
              reset()
              setNotice(p.t('modelDeleted'))
            })}>{p.t('confirmDelete')}</Button>
            <Button onClick={() => { setConfirmDelete(false) }}>{p.t('dismissEdit')}</Button>
          </div>
        </div>}
      </fieldset>
      <small>{p.t('modelTestHint')}</small>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className={css.error}>
          {error}
        </p>
      )}
    </section>
  )
}
/** Choose a registered model for the next task; existing sessions keep their route.
 * @param p - Workbench and controlled selection.
 * @returns Task model selector.
 */
export function ModelChoice(
  p: Surface & {
    value: { provider: string; model: string } | undefined
    onChange: (value: { provider: string; model: string } | undefined) => void
  },
) {
  const view = p.useStore(v => v),
    [rows, setRows] = useState<{ provider: string; model: string; name: string }[]>([]),
    [error, setError] = useState('')
  useEffect(() => {
    if (!view.project || view.manager === 'models') return
    let active = true
    void p.read('/v1/data/' + view.project + '/models').then(
      (raw) => {
        if (active) {
          const next = z.array(z.object({ provider: z.string(), model: z.string(), name: z.string() })).parse(raw)
          setRows(next)
          if (p.value && !next.some(row => row.provider === p.value?.provider && row.model === p.value.model)) p.onChange(undefined)
          setError('')
        }
      },
      () => {
        if (active) setError(p.t('modelLoadFailed'))
      },
    )
    return () => {
      active = false
    }
  }, [view.project, view.manager, p.read, p.t, p.value, p.onChange])
  return (
    <label>
      {p.t('modelSelection')}
      <select
        value={p.value ? JSON.stringify(p.value) : ''}
        onChange={(e) => {
          p.onChange(
            e.target.value ? (JSON.parse(e.target.value) as { provider: string; model: string }) : undefined,
          )
        }}
      >
        <option value="">{p.t('modelDeploymentDefault')}</option>
        {rows.map(row => (
          <option
            key={row.provider + ':' + row.model}
            value={JSON.stringify({ provider: row.provider, model: row.model })}
          >
            {row.name} · {row.provider}
          </option>
        ))}
      </select>
      <small>{p.t('modelSelectionHint')}</small>
      {error && <small role="alert">{error}</small>}
    </label>
  )
}
