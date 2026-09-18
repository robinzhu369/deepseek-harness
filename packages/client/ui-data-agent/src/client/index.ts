import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
/** Opt-in three-column workbench registered into Harness layout slots. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { z } from 'zod'
import { createModelSettingsOperations } from './model-settings.ts'
import { DataModel } from './model.ts'
import { createDataViewStore } from './view-store.ts'
import { Sessions, Registry, Navigation, Run, Task } from './types.ts'
import { Sidebar, Conversation, Rightbar, Manager } from './surfaces.tsx'
import { zh, en, type DataKey } from './locales.ts'
import type { Face } from './face.ts'
import flowCss from '@xyflow/react/dist/style.css?inline'
export { createDataViewStore } from './view-store.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    dataAgent: DataKey
  }
}
export const inject = [
  'slots',
  'locale',
  'layout',
  'remote',
  'remote.dataAgent',
  'remote.settings',
  'remote.credentials',
  'remote.llm',
]
/** Mount one account-scoped model and shared view store; dispose polling and credentials together. */
export async function apply(ctx: Context): Promise<void> {
  const response = await ctx.remote.dataAgent.configuration()
  if (!response.ok) throw new Error(response.error.message)
  const config = response.value
  if (
    !Number.isInteger(config.pollIntervalMs) ||
    config.pollIntervalMs < 1000 ||
    !Number.isSafeInteger(config.maxUploadBytes) ||
    config.maxUploadBytes < 1
  )
    throw new Error('DATA_AGENT_UI_CONFIG')
  ctx.effect(() => ctx.locale.register('dataAgent', { zh, en }), 'data-agent: dictionaries')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = flowCss
    document.head.append(style)
    return () => {
      style.remove()
    }
  }, 'data-agent: flow styles')
  ctx.effect(() => {
    const model = new DataModel(async (...args) => {
      const result = await ctx.remote.dataAgent.request(...args)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    })
    const connectionChanged = () => {
      model.setOnline(navigator.onLine)
    }
    connectionChanged()
    window.addEventListener('online', connectionChanged)
    window.addEventListener('offline', connectionChanged)
    const handle = createDataViewStore(),
      instance = handle.create(),
      store = { ...handle, create: () => instance }
    let stopped = false,
      refreshing: Promise<void> | undefined
    const read = (path: string) => model.query(path, z.json())
    const refresh = (): Promise<void> => {
      if (refreshing) return refreshing
      refreshing = (async () => {
        if (!model.getSnapshot().authenticated) return
        await read('/v1/data/projects')
        const view = instance.getSnapshot()
        if (!view.project) return
        const base = '/v1/data/' + view.project
        const requests: Promise<unknown>[] = [
          model.query(base + '/workbench', Registry),
          model.query(base + '/sessions', Sessions),
          read(base + '/skills'),
          read(base + '/datasets'),
          ...(view.manager === 'data' ? [read(base + '/datasets?search=&offset=0&limit=20')] : []),
        ]
        if (view.session) {
          requests.push(
            model.query(base + '/sessions/' + view.session + '/navigation', Navigation),
            model.history(view.project, view.session),
          )
          const nav = model.getSnapshot().cache[base + '/sessions/' + view.session + '/navigation'] as
            | z.infer<typeof Navigation>
            | undefined
          const id = view.selectedRuns[view.session] || nav?.runs[0]?.id
          if (id) requests.push(model.query(base + '/runs/' + id, Run))
          const sessions = model.getSnapshot().cache[base + '/sessions'] as
            | z.infer<typeof Sessions>
            | undefined
          const task = sessions?.find(session => session.id === view.session)?.business_task_id
          if (task) requests.push(model.query(base + '/tasks/' + task, Task))
        }
        await Promise.allSettled(requests)
      })().finally(() => {
        refreshing = undefined
      })
      return refreshing
    }
    const face: Face = {
      toggleSidebar: () =>{  ctx.layout.toggleSidebar() },
      monitor: (open) => {
        instance.actions.monitor(open)
        if (open) ctx.layout.openRightbar(
          window.innerWidth >= 800, window.innerWidth < 800,
          instance.getSnapshot().savedColumns ?? { sidebar: 260, rightbar: 360 },
        )
        else ctx.layout.closeRightbar()
      },
      models: createModelSettingsOperations(ctx),
      hooks: { domain: model },
      saveColumns: (width) => {
        instance.actions.saveColumns(width)
      },
      login: async (credential) => {
        const actor = await model.login(credential)
        instance.actions.actor(actor)
        await refresh()
      },
      logout: () => {
        model.logout()
        instance.actions.clear()
      },
      refresh: () =>
        refresh().catch(() => {
          /* Model errors keep the last snapshot visibly unsynced. */
        }),
      read,
      command: async (path, body) => {
        const before = instance.getSnapshot()
        const value = await model.command(path, body)
        const after = instance.getSnapshot()
        if (
          before.actor !== after.actor ||
          before.project !== after.project ||
          before.session !== after.session
        )
          throw new Error('SELECTION_CHANGED')
        return value
      },
      download: async (path, filename) => {
        const actor = model.getSnapshot().actor
        const response = await model.bytes(path),
          url = URL.createObjectURL(await response.blob())
        try {
          if (actor !== model.getSnapshot().actor) throw new Error('ACCOUNT_CHANGED')
          const link = document.createElement('a')
          link.href = url
          link.download = filename
          link.click()
        } finally {
          URL.revokeObjectURL(url)
        }
      },
      upload: async (file, id, onProgress) => {
        if (file.size > config.maxUploadBytes) throw new Error('UPLOAD_LIMIT')
        const project = instance.getSnapshot().project,
          base = '/v1/data/' + project + '/uploads'
        const sha = async (blob: Blob) =>
          Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
            byte => byte.toString(16).padStart(2, '0'),
          ).join('')
        const digest = await sha(file)
        const schema = z.object({
          id: z.string(),
          digest: z.string(),
          part_bytes: z.number(),
          status: z.string(),
          parts: z.array(z.object({ number: z.number(), digest: z.string() })).optional(),
        })
        const upload = schema.parse(
          id
            ? await read(base + '/' + id)
            : await model.command(base, {
              filename: file.name,
              bytes: file.size,
              digest,
              idempotency_key: randomUUID(),
            }),
        )
        if (upload.digest !== digest) throw new Error('UPLOAD_FILE_MISMATCH')
        let bytes = 0
        if (upload.status !== 'uploaded')
          for (let start = 0, number = 1; start < file.size; start += upload.part_bytes, number++) {
            if (instance.getSnapshot().project !== project) throw new Error('PROJECT_CHANGED')
            const part = file.slice(start, start + upload.part_bytes),
              partDigest = await sha(part)
            if (!upload.parts?.some(value => value.number === number && value.digest === partDigest)) {
              const grant = z
                .object({ ticket: z.string() })
                .parse(await model.command(base + '/' + upload.id + '/grant', { number, digest: partDigest }))
              await model.bytes(base + '/' + upload.id + '/parts/' + String(number), part, grant.ticket)
            }
            bytes += part.size
            onProgress(bytes)
          }
        if (upload.status !== 'uploaded') await model.command(base + '/' + upload.id + '/complete', {})
        return upload.id
      },
    }
    const options = { locale: 'dataAgent' as const, store, inject: () => face }
    const disposers = [ctx.slots.register({ ...options, name: 'main', key: 'data-agent' }, Conversation)]
    ctx.slots.inject('sidebar', () =>
      ctx.slots.register({ ...options, name: 'sidebar', priority: -10 }, Sidebar),
    )
    ctx.slots.inject('rightbar', () =>
      ctx.slots.register({ ...options, name: 'rightbar', priority: -10 }, Rightbar),
    )
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register({ ...options, name: 'shell.overlay', id: 'data-agent-manager' }, Manager),
    )
    ctx.layout.selectPanel('data-agent' as MainPanelId)
    const savedColumns = instance.getSnapshot().savedColumns
    instance.actions.monitor(false)
    ctx.layout.openRightbar(true, false, savedColumns ?? { sidebar: 260, rightbar: 360 })
    ctx.layout.closeRightbar()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        await refresh()
      } catch {
        /* Read errors are retained by the model for the offline indicator. */
      } finally {
        if (!stopped)
          timer = setTimeout(() => {
            void poll()
          }, config.pollIntervalMs)
      }
    }
    void poll()
    return async () => {
      window.removeEventListener('online', connectionChanged)
      window.removeEventListener('offline', connectionChanged)
      stopped = true
      clearTimeout(timer)
      model.dispose()
      for (const dispose of disposers) dispose()
      await refreshing?.catch(() => {
        /* Aborted reads already stopped. */
      })
    }
  }, 'data-agent: workbench')
}
