import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
/** Bounded data, Skill and template managers share authenticated domain commands. */
import { useState } from 'react'
import { z } from 'zod'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Surface } from './face.ts'
import { Workflow, type Run } from './types.ts'
import { Action } from './surfaces.tsx'
import { exportJson } from './Canvas.tsx'
import css from './workbench.module.css'
import { csvColumns } from './import-columns.ts'
/** Data imports retain their original parse options and field-role mappings. */
export function DataManager(p: Surface & { uploadOnly?: boolean }) {
  const view = p.useStore(value => value),
    domain = p.useDomain(value => value),
    base = '/v1/data/' + view.project
  const [file, setFile] = useState<File>(),
    [id, setId] = useState(''),
    [target, setTarget] = useState(''),
    [identifier, setIdentifier] = useState(''),
    [queued, setQueued] = useState(''),
    [bytes, setBytes] = useState(0),
    [options, setOptions] = useState(
      '{"options":{"format":"csv","encoding":"utf-8","delimiter":",","has_header":true},"roles":{}}',
    ),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(0),
    [columns, setColumns] = useState(''),
    [offset, setOffset] = useState(0),
    [previewRun, setPreviewRun] = useState(''),
    [preview, setPreview] = useState<unknown>()
  const path =
    base + '/datasets?search=' + encodeURIComponent(search) + '&offset=' + String(page * 20) + '&limit=20'
  const rows = z
    .array(
      z
        .object({
          id: z.string(),
          filename: z.string(),
          status: z.string(),
          dataset_id: z.string().nullable(),
          error_code: z.string().nullable().optional(),
          metadata: z.json().nullable(),
        })
        .loose(),
    )
    .parse(domain.cache[path] ?? [])
  return (
    <div className={css.stack}>
      <section className={css.card}>
        <h3>{p.t('upload')}</h3>
        <input
          type="file"
          aria-label={p.t('upload')}
          onChange={(event) => {
            const selected = event.target.files?.[0]
            setFile(selected)
            setId('')
            setBytes(0)
            setQueued('')
            setTarget('')
            setIdentifier('')
            setOptions(
              JSON.stringify({
                options: selected?.name.toLowerCase().endsWith('.parquet')
                  ? { format: 'parquet' }
                  : { format: 'csv', encoding: 'utf-8', delimiter: ',', has_header: true },
                roles: {},
              }),
            )
          }}
        />
        <small>{p.t('importHint')}</small>
        <div className={css.twoColumns}>
          <label>
            {p.t('targetColumn')}
            <Input value={target} onChange={(event) =>{  setTarget(event.target.value) }} />
          </label>
          <label>
            {p.t('idColumn')}
            <Input value={identifier} onChange={(event) =>{  setIdentifier(event.target.value) }} />
          </label>
        </div>
        <Action
          primary
          t={p.t}
          disabled={!file || !!queued || (!!target.trim() && target.trim() === identifier.trim())}
          run={async () => {
            if (!file) return
            const parsed = z
              .object({ options: z.record(z.string(), z.json()), roles: z.record(z.string(), z.string()) })
              .parse(JSON.parse(options))
            let roles = { ...parsed.roles }
            if (parsed.options.format === 'csv' && parsed.options.has_header === true) {
              const prefix = await file.slice(0, 65536).arrayBuffer()
              const headers = csvColumns(
                new TextDecoder(z.string().parse(parsed.options.encoding ?? 'utf-8'), { fatal: true }).decode(prefix, { stream:file.size > 65536 }),
                z.string().parse(parsed.options.delimiter ?? ','),
                file.size <= 65536,
              )
              if (
                [target.trim(), identifier.trim(), ...Object.keys(roles)].some(
                  column => column && !headers.includes(column),
                )
              )
                throw new Error(p.t('unknownColumn'))
              roles = { ...Object.fromEntries(headers.map(column => [column, 'feature'])), ...roles }
            }
            if (!Object.keys(roles).length) throw new Error(p.t('rolesRequired'))
            roles = {
              ...roles,
              ...(target.trim() ? { [target.trim()]: 'target' } : {}),
              ...(identifier.trim() ? { [identifier.trim()]: 'entity_id' } : {}),
            }
            const upload = await p.upload(file, id, setBytes)
            setId(upload)
            const imported = z
              .object({ id: z.string() })
              .parse(await p.command(base + '/uploads/' + upload + '/import', { ...parsed, roles }))
            setQueued(imported.id)
            await p.read(path)
            await p.read(base + '/datasets')
          }}
        >
          {p.t('uploadAndImport')}
        </Action>
        {file && bytes > 0 && <progress aria-label={p.t('uploadProgress')} value={bytes} max={file.size} />}
        {queued && (
          <p role="status" className={css.statusNote}>
            {p.t(
              rows.find(row => row.id === queued)?.status === 'ready'
                ? 'dataReady'
                : rows.find(row => row.id === queued)?.status === 'failed'
                  ? 'dataFailed'
                  : 'importQueued',
            )}
          </p>
        )}
        <details className={css.advanced}>
          <summary>{p.t('advancedUpload')}</summary>
          <Input
            aria-label={p.t('uploadId')}
            placeholder={p.t('uploadId')}
            value={id}
            onChange={(event) => {
              setId(event.target.value)
            }}
          />
          <small>{p.t('uploadHint')}</small>
          <Action
            t={p.t}
            disabled={!file}
            run={async () => {
              if (file) setId(await p.upload(file, id, setBytes))
            }}
          >
            {p.t('upload')}
          </Action>
          <small>
            {p.t('uploadProgress')}: {bytes}
            {file ? ' / ' + String(file.size) : ''}
          </small>
          {file && <progress value={bytes} max={file.size} />}
          <label>
            {p.t('importOptions')}
            <textarea
              value={options}
              onChange={(event) => {
                setOptions(event.target.value)
              }}
            />
          </label>
          <Action
            t={p.t}
            disabled={!id}
            run={async () => {
              await p.command(base + '/uploads/' + id + '/import', JSON.parse(options))
              await p.read(path)
            }}
          >
            {p.t('importData')}
          </Action>
        </details>
      </section>
      {!p.uploadOnly && <>
        <div className={css.row}>
          <Input
            aria-label={p.t('searchData')}
            placeholder={p.t('searchData')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(0)
            }}
          />
          <Action t={p.t} run={() => p.read(path)}>
            {p.t('refresh')}
          </Action>
          <Button
            disabled={!page}
            onClick={() => {
              setPage(page - 1)
            }}
          >
            {p.t('previous')}
          </Button>
          <Button
            disabled={rows.length < 20}
            onClick={() => {
              setPage(page + 1)
            }}
          >
            {p.t('more')}
          </Button>
        </div>
        <details className={css.advanced}>
          <summary>{p.t('preview')}</summary>
          <div className={css.row}>
            <Input
              aria-label={p.t('columns')}
              placeholder={p.t('columns')}
              value={columns}
              onChange={(event) => {
                setColumns(event.target.value)
              }}
            />
            <label>
              {p.t('offset')}
              <Input
                type="number"
                min={0}
                value={offset}
                onChange={(event) => {
                  setOffset(Number(event.target.value))
                }}
              />
            </label>
          </div>
          <small>{p.t('previewLimit')}</small>
        </details>
        {!rows.length && <p className={css.empty}>{p.t('dataEmpty')}</p>}
        {rows.map(row => (
          <section className={css.card} key={row.id}>
            <strong>{row.filename}</strong>
            <span className={css.badge}>
              {p.t(
                row.status === 'ready' ? 'dataReady' : row.status === 'failed' ? 'dataFailed' : 'dataImporting',
              )}
            </span>
            {row.status === 'failed' && (
              <p role="alert" className={css.error}>
                {row.error_code ?? p.t('dataFailed')}
              </p>
            )}
            {row.status === 'ready' && row.dataset_id && (
              <Button
                onClick={() => {
                  if (row.dataset_id) p.actions.dataset(row.dataset_id)
                  p.actions.session('')
                  void p.refresh()
                }}
              >
                {p.t('useDataset')}
              </Button>
            )}
            <details>
              <summary>{p.t('raw')}</summary>
              <pre>{JSON.stringify(row, null, 2)}</pre>
            </details>
            {row.dataset_id && (
              <div className={css.row}>
                <Action
                  t={p.t}
                  disabled={!columns.trim()}
                  run={async () => {
                    const result = z.object({ run_id: z.string() }).parse(
                      await p.command(base + '/artifacts/' + String(row.dataset_id) + '/preview', {
                        offset,
                        limit: 200,
                        columns: columns
                          .split(',')
                          .map(value => value.trim())
                          .filter(Boolean),
                      }),
                    )
                    setPreviewRun(result.run_id)
                    setPreview(undefined)
                  }}
                >
                  {p.t('preview')}
                </Action>
                <Action
                  t={p.t}
                  run={() =>
                    p.download(base + '/artifacts/' + String(row.dataset_id) + '/download', row.filename)
                  }
                >
                  {p.t('download')}
                </Action>
                <Action
                  t={p.t}
                  run={() => p.command(base + '/artifacts/' + String(row.dataset_id) + '/archive', {})}
                >
                  {p.t('archive')}
                </Action>
              </div>
            )}
          </section>
        ))}
        {previewRun && (
          <section className={css.card}>
            <span>
              {p.t('previewRun')}: {previewRun}
            </span>
            <Action
              t={p.t}
              run={async () => {
                const run = (await p.read(base + '/runs/' + previewRun)) as Run
                const report = run.artifacts.find(value => value.kind === 'ReportRef')
                setPreview(report ? await p.read(base + '/artifacts/' + report.id + '/report') : run)
              }}
            >
              {p.t('refresh')}
            </Action>
            <PreviewTable value={preview} />
            {preview !== undefined && <small>{p.t('previewResult')}</small>}
          </section>
        )}
      </>}
    </div>
  )
}
/** Lifecycle operations retain backend version checks and mandatory release evaluation gates. */
export function SkillManager(p: Surface) {
  const view = p.useStore(value => value),
    domain = p.useDomain(value => value),
    base = '/v1/data/' + view.project
  const [id, setId] = useState(''),
    [version, setVersion] = useState(''),
    [parent, setParent] = useState(''),
    [revision, setRevision] = useState(0),
    [evaluation, setEvaluation] = useState(''),
    [reason, setReason] = useState(''),
    [pack, setPack] = useState(''),
    [result, setResult] = useState<unknown>(),
    [left, setLeft] = useState<unknown>(),
    [right, setRight] = useState<unknown>()
  const rows = z
    .array(z.object({ id: z.string(), revision: z.number(), default_version: z.string().nullable() }).loose())
    .parse(domain.cache[base + '/skills'] ?? [])
  const invoke = async (action: string, body: unknown) => {
    setResult(await p.command(base + '/skills/' + id + '/' + action, body))
    await p.read(base + '/skills/' + id)
  }
  return (
    <div className={css.stack}>
      <Action t={p.t} run={() => p.read(base + '/skills')}>
        {p.t('refresh')}
      </Action>
      {rows.map(row => (
        <Button
          key={row.id}
          variant="ghost"
          onClick={() => {
            setId(row.id)
            setRevision(row.revision)
            void p.read(base + '/skills/' + row.id).catch(() => {
              /* The model retains the read error. */
            })
          }}
        >
          {row.id} · {row.default_version ?? '—'}
        </Button>
      ))}
      <p>{p.t('noReleased')}</p>
      <div className={css.row}>
        <Input
          aria-label={p.t('skillId')}
          placeholder={p.t('skillId')}
          value={id}
          onChange={(event) => {
            setId(event.target.value)
          }}
        />
        <label>
          {p.t('revision')}
          <Input
            type="number"
            min={0}
            value={revision}
            onChange={(event) => {
              setRevision(Number(event.target.value))
            }}
          />
        </label>
      </div>
      <label>
        {p.t('skillPackage')}
        <textarea
          value={pack}
          onChange={(event) => {
            setPack(event.target.value)
          }}
        />
      </label>
      <Action
        t={p.t}
        disabled={!id || !pack}
        run={() => invoke('draft', { revision, package: z.json().parse(JSON.parse(pack)) })}
      >
        {p.t('draft')}
      </Action>
      <Input
        aria-label={p.t('reason')}
        placeholder={p.t('reason')}
        value={reason}
        onChange={(event) => {
          setReason(event.target.value)
        }}
      />
      <Input
        aria-label={p.t('parent')}
        placeholder={p.t('parent')}
        value={parent}
        onChange={(event) => {
          setParent(event.target.value)
        }}
      />
      <Action
        t={p.t}
        disabled={!id || !reason}
        run={() => invoke('candidate', { revision, reason, parent: parent || null })}
      >
        {p.t('candidate')}
      </Action>
      <Input
        aria-label={p.t('version')}
        placeholder={p.t('version')}
        value={version}
        onChange={(event) => {
          setVersion(event.target.value)
        }}
      />
      <Input
        aria-label={p.t('evaluation')}
        placeholder={p.t('evaluation')}
        value={evaluation}
        onChange={(event) => {
          setEvaluation(event.target.value)
        }}
      />
      <div className={css.row}>
        {(['evaluate', 'publish', 'default', 'retire'] as const).map(action => (
          <Action
            key={action}
            t={p.t}
            disabled={!id || !version || (action === 'publish' && !evaluation)}
            run={() =>
              invoke(action, { version, ...(action === 'publish' ? { evaluation_id: evaluation } : {}) })
            }
          >
            {p.t(action === 'default' ? 'defaultVersion' : action)}
          </Action>
        ))}
      </div>
      <div className={css.row}>
        <Action
          t={p.t}
          disabled={!id || !version}
          run={async () => {
            setLeft(await p.read(base + '/skills/' + id + '/versions/' + version))
          }}
        >
          {p.t('compareLeft')}
        </Action>
        <Action
          t={p.t}
          disabled={!id || !version}
          run={async () => {
            setRight(await p.read(base + '/skills/' + id + '/versions/' + version))
          }}
        >
          {p.t('compareRight')}
        </Action>
      </div>
      <div className={css.compare}>
        <pre>{JSON.stringify(left, null, 2)}</pre>
        <pre>{JSON.stringify(right, null, 2)}</pre>
      </div>
      <details open>
        <summary>{p.t('result')}</summary>
        <pre>{JSON.stringify(result ?? domain.cache[base + '/skills/' + id], null, 2)}</pre>
      </details>
    </div>
  )
}
/** Templates create independent drafts and never import approval state. */
export function TemplateManager(p: Surface) {
  const view = p.useStore(value => value),
    domain = p.useDomain(value => value),
    path = '/v1/data/' + view.project + '/templates'
  const rows = z
    .array(z.object({ id: z.string(), name: z.string(), revision: z.number(), body: Workflow }))
    .parse(domain.cache[path] ?? [])
  return (
    <div className={css.stack}>
      <Action t={p.t} run={() => p.read(path)}>
        {p.t('refresh')}
      </Action>
      {rows.map(row => (
        <section className={css.card} key={row.id}>
          <strong>{row.name}</strong>
          <small>
            {p.t('revision')}: {row.revision}
          </small>
          <div className={css.row}>
            <Button
              disabled={!view.session}
              onClick={() => {
                p.actions.draft(view.session, {
                  workflow: row.body,
                  workflowId: randomUUID(),
                  revision: 0,
                  selectedNode: null,
                })
                p.actions.tab('flow')
                p.actions.manager(null)
              }}
            >
              {p.t('loadTemplate')}
            </Button>
            <Button
              onClick={() => {
                exportJson(row.body, row.name + '.json')
              }}
            >
              {p.t('downloadJson')}
            </Button>
          </div>
        </section>
      ))}
    </div>
  )
}

function PreviewTable({ value }: { value: unknown }) {
  const parsed = z
    .object({
      columns: z.array(z.string()),
      rows: z.array(z.record(z.string(), z.json())),
      offset: z.number(),
      total: z.number(),
    })
    .safeParse(value)
  if (!parsed.success) return <pre>{JSON.stringify(value, null, 2)}</pre>
  return (
    <div className={css.tableScroll}>
      <table>
        <thead>
          <tr>
            {parsed.data.columns.map(column => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {parsed.data.rows.map((row, index) => (
            <tr key={parsed.data.offset + index}>
              {parsed.data.columns.map(column => (
                <td key={column}>
                  {typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
