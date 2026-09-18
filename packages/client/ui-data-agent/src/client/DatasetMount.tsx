/** Mounting is a draft choice until confirmed; existing task inputs remain immutable. */
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { Button, Input, IconDatabaseOutline16, IconSearchOutline16, IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Surface } from './face.ts'
import { DataManager } from './managers.tsx'
import css from './workbench.module.css'

const Datasets = z.array(z.object({
  id: z.string(), filename: z.string(), status: z.string(), dataset_id: z.string().nullable(),
}))

export function DatasetMount(p: Surface) {
  const view = p.useStore(value => value)
  const [search, setSearch] = useState(''), [page, setPage] = useState(0)
  const [selected, setSelected] = useState(view.dataset)
  const [uploading, setUploading] = useState(false)
  const [rows, setRows] = useState<z.infer<typeof Datasets>>([])
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const base = '/v1/data/' + view.project
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    const timer = setTimeout(() => {
      const path = base + '/datasets?search=' + encodeURIComponent(search) + '&offset=' + String(page * 20) + '&limit=20'
      void p.read(path)
        .then((value) => { if (active) { setRows(Datasets.parse(value)); setLoading(false) } })
        .catch((failure: unknown) => {
          if (active) { setError(failure instanceof Error ? failure.message : String(failure)); setLoading(false) }
        })
    }, 200)
    return () => { active = false; clearTimeout(timer) }
  }, [base, search, page, uploading, p.read])
  const chosen = rows.find(row => row.dataset_id === selected && row.status === 'ready')
  return <div className={css.mountBrowser}>
    {uploading ? <>
      <div className={css.mountToolbar}><Button onClick={() => { setUploading(false) }}>{p.t('mountBack')}</Button><small>{p.t('mountUploadHint')}</small></div>
      <DataManager {...p} uploadOnly />
    </> : <>
      <div className={css.mountToolbar}>
        <div className={css.mountSearch}><IconSearchOutline16 /><Input aria-label={p.t('searchData')} placeholder={p.t('mountSearch')} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} /></div>
        <Button variant="primary" className={css.primaryAction} icon={<IconPlusOutline16 />} onClick={() => { setUploading(true) }}>{p.t('mountUpload')}</Button>
      </div>
      <div className={css.mountBreadcrumb}><IconDatabaseOutline16 /><span>{p.t('mountProject')}</span><span>/</span><strong>{view.project}</strong></div>
      <div className={css.mountGrid} role="group" aria-label={p.t('mountChoose')} aria-busy={loading}>
        {loading ? <p className={css.empty} role="status">{p.t('mountLoading')}</p> : error ? <p className={css.error} role="alert">{error}</p> : !rows.length ? <p className={css.empty}>{p.t('mountEmpty')}</p> : rows.map(row => <button
          type="button" key={row.id} className={css.mountFile} aria-pressed={selected === row.dataset_id && !!selected}
          disabled={row.status !== 'ready' || !row.dataset_id} title={row.filename}
          onClick={() => { setSelected(row.dataset_id ?? '') }}>
          <span className={css.mountFileIcon} aria-hidden="true"><IconDatabaseOutline16 /></span>
          <strong>{row.filename}</strong>
          <small>{p.t(row.status === 'ready' ? 'dataReady' : row.status === 'failed' ? 'dataFailed' : 'dataImporting')}</small>
        </button>)}
      </div>
      <div className={css.mountPagination}><small>{p.t('mountCount')}: {loading ? '—' : rows.length}</small><Button disabled={!page || loading} onClick={() => { setPage(page - 1) }}>{p.t('previous')}</Button><span>{page + 1}</span><Button disabled={rows.length < 20 || loading} onClick={() => { setPage(page + 1) }}>{p.t('more')}</Button></div>
    </>}
    <div className={css.mountFooter}>
      <span title={chosen?.filename}>{chosen?.filename ?? p.t('mountNoSelection')}</span>
      <Button onClick={() => { p.actions.manager(null) }}>{p.t('dismissEdit')}</Button>
      <Button variant="primary" className={css.primaryAction} disabled={!chosen || loading || uploading || !!error} onClick={() => {
        if (!chosen?.dataset_id) return
        p.actions.dataset(chosen.dataset_id)
        p.actions.manager(null)
      }}>{p.t('mountConfirm')}</Button>
    </div>
  </div>
}
