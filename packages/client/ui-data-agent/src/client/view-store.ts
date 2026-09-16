/** View choices and editable drafts survive remounts; server facts live in the model. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { Workflow } from './types.ts'
type Draft = {
  evidence?: unknown[]
  workflow: Workflow
  workflowId: string
  revision: number
  selectedNode: string | null
}
type View = {
  sidebarWidth: number
  savedColumns: { sidebar: number; rightbar: number } | null
  actor: string
  project: string
  session: string
  canvasModes: Record<string, 'draft' | 'run'>
  selectedRuns: Record<string, string>
  drafts: Record<string, Draft>
  tab: 'status' | 'flow'
  manager: 'data' | 'skills' | 'templates' | null
}
type Actions = {
  sidebarWidth: (d: View, width: number) => void
  saveColumns: (d: View, rightbar: number) => void
  actor: (d: View, actor: string) => void
  project: (d: View, id: string) => void
  session: (d: View, id: string) => void
  run: (d: View, session: string, id: string) => void
  tab: (d: View, tab: View['tab']) => void
  manager: (d: View, manager: View['manager']) => void
  draft: (d: View, session: string, draft: Draft) => void
  clear: (d: View) => void
}
/** Create one store per plugin instance.
 * @returns Shared view-store registration handle.
 */
export function createDataViewStore(): EngineStoreHandle<View, Actions> {
  return defineStore({
    init: (): View => ({
      sidebarWidth: 280,
      savedColumns: null,
      actor: '',
      project: '',
      session: '',
      canvasModes: {},
      selectedRuns: {},
      drafts: {},
      tab: 'status',
      manager: null,
    }),
    persist: 'dsh.data-agent.view.v1',
    actions: {
      sidebarWidth: (d, width: number) => {
        d.sidebarWidth = width
      },
      saveColumns: (d, rightbar: number) => {
        d.savedColumns = { sidebar: d.sidebarWidth, rightbar }
      },
      actor: (d, actor: string) => {
        if (d.actor !== actor) {
          d.project = ''
          d.session = ''
          d.canvasModes = {}
          d.selectedRuns = {}
          d.drafts = {}
          d.manager = null
        }
        d.actor = actor
      },
      project: (d, id: string) => {
        d.project = id
        d.session = ''
      },
      session: (d, id: string) => {
        d.session = id
        d.manager = null
      },
      run: (d, session: string, id: string) => {
        d.selectedRuns[session] = id
        d.canvasModes[session] = 'run'
      },
      tab: (d, tab: View['tab']) => {
        d.tab = tab
      },
      manager: (d, manager: View['manager']) => {
        d.manager = manager
      },
      draft: (d, session: string, draft: Draft) => {
        d.drafts[session] = draft
        d.canvasModes[session] = 'draft'
      },
      clear: (d) => {
        d.project = ''
        d.session = ''
        d.canvasModes = {}
        d.selectedRuns = {}
        d.drafts = {}
        d.manager = null
      },
    },
  })
}
