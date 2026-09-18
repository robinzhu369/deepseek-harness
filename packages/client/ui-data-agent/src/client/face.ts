/** Typed actions and observable input shared by the three registered surfaces. */
import type { PropsLocale, PropsStore, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSettingsOperations } from './model-settings.ts'
import type { DataModel } from './model.ts'
import type { createDataViewStore } from './view-store.ts'
/** Model subscriptions and account-scoped domain actions supplied by the plugin. */
export interface Face {
  hooks: { domain: Pick<DataModel, 'getSnapshot' | 'subscribe'> }
  models: ModelSettingsOperations
  toggleSidebar(): void
  monitor(open: boolean): void
  saveColumns(width: number): void
  login(credential: string): Promise<void>
  logout(): void
  refresh(): Promise<void>
  read(path: string): Promise<unknown>
  command(path: string, body: unknown): Promise<unknown>
  download(path: string, filename: string): Promise<void>
  upload(file: File, id: string, onProgress: (bytes: number) => void): Promise<string>
}
/** Framework-bound props shared by the three workbench columns. */
export type Surface = InjectFace<Face> &
  PropsStore<ReturnType<typeof createDataViewStore>> &
  PropsLocale<'dataAgent'>
