/** React-free domain projection: generation-fenced reads and authoritative session/run facts. */
import { z } from 'zod'
import { History, type History as HistoryValue } from './types.ts'
type Json = z.infer<ReturnType<typeof z.json>>
type Wire = (
  credential: string,
  method: 'GET' | 'POST',
  path: string,
  body: string,
  signal: AbortSignal,
) => Promise<{ status: number; body: string }>
type Snapshot = {
  online: boolean
  authenticated: boolean
  actor: string
  cache: Record<string, unknown>
  errors: Record<string, string>
  pending: string[]
}
/** One plugin-owned model; credentials stay in memory and never enter persisted view state. */
export class DataModel {
  private snapshot: Snapshot = {
    online: true,
    authenticated: false,
    actor: '',
    cache: {},
    errors: {},
    pending: [],
  }
  private readonly listeners = new Set<() => void>()
  private readonly generations = new Map<string, number>()
  private readonly writes = new Map<string, Promise<Json>>()
  private readonly abort = new AbortController()
  private credential = ''
  private epoch = 0
  constructor(private readonly wire: Wire) {}
  /** Return the stable snapshot consumed by framework selector hooks. @returns Current domain facts. */
  getSnapshot = (): Snapshot => this.snapshot
  /** Subscribe to domain snapshot replacement. @param listener - Framework listener. @returns Unsubscribe callback. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish(patch: Partial<Snapshot>) {
    if (this.abort.signal.aborted) return
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }
  private pending(key: string, active: boolean) {
    this.publish({
      pending: active
        ? [...new Set([...this.snapshot.pending, key])]
        : this.snapshot.pending.filter(value => value !== key),
    })
  }
  /** Project browser connectivity into the domain view.
   * @param online - Whether the browser network is available.
   */
  setOnline(online: boolean): void {
    this.publish({ online })
  }
  private async request(method: 'GET' | 'POST', path: string, body: unknown): Promise<Json> {
    this.abort.signal.throwIfAborted()
    if (!this.snapshot.online) throw new Error('OFFLINE')
    const epoch = this.epoch
    const result = await this.wire(
      this.credential,
      method,
      path,
      method === 'POST' ? JSON.stringify(body) : '',
      this.abort.signal,
    )
    this.abort.signal.throwIfAborted()
    if (epoch !== this.epoch) throw new Error('ACCOUNT_CHANGED')
    const value = z.json().parse(JSON.parse(result.body))
    if (result.status >= 400) {
      const error = z.object({ error: z.string() }).safeParse(value)
      throw new Error(error.success ? error.data.error : 'REQUEST_FAILED')
    }
    return value
  }
  /** Validate an in-memory credential and fence previous account reads.
   * @param credential - Domain access credential.
   * @returns Verified account identity.
   */
  async login(credential: string): Promise<string> {
    const epoch = ++this.epoch
    this.writes.clear()
    this.credential = credential
    this.publish({ authenticated: false, actor: '', cache: {}, errors: {}, pending: [] })
    const account = await this.query(
      '/v1/data/account',
      z.object({ actor_id: z.string(), can_create_projects: z.boolean() }),
    )
    this.abort.signal.throwIfAborted()
    if (epoch !== this.epoch) throw new Error('ACCOUNT_CHANGED')
    this.publish({ authenticated: true, actor: account.actor_id })
    return account.actor_id
  }
  /** Clear credential and all account-scoped cached facts. */
  logout(): void {
    this.epoch++
    this.writes.clear()
    this.credential = ''
    this.publish({ authenticated: false, actor: '', cache: {}, errors: {}, pending: [] })
  }
  /** Read and validate a resource, publishing only its newest request generation.
   * @param path - Domain URL path.
   * @param schema - Expected response parser.
   * @returns Validated response.
   */
  async query<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const epoch = this.epoch,
      generation = (this.generations.get(path) ?? 0) + 1
    this.generations.set(path, generation)
    this.pending(path, true)
    try {
      const value = schema.parse(await this.request('GET', path, null))
      if (epoch === this.epoch && this.generations.get(path) === generation)
        this.publish({
          cache: { ...this.snapshot.cache, [path]: value },
          errors: { ...this.snapshot.errors, [path]: '' },
        })
      return value
    } catch (error) {
      if (epoch === this.epoch && this.generations.get(path) === generation)
        this.publish({
          errors: {
            ...this.snapshot.errors,
            [path]: error instanceof Error ? error.message : 'REQUEST_FAILED',
          },
        })
      throw error
    } finally {
      if (epoch === this.epoch && this.generations.get(path) === generation) this.pending(path, false)
    }
  }
  /** Deduplicate identical in-flight writes without automatically retrying them.
   * @param path - Domain command path.
   * @param body - JSON request.
   * @returns Accepted command result.
   */
  command(path: string, body: unknown): Promise<Json> {
    const key = path + '\n' + JSON.stringify(body),
      prior = this.writes.get(key)
    if (prior) return prior
    const epoch = this.epoch
    this.pending(path, true)
    const work = this.request('POST', path, body)
      .then(
        (value) => {
          if (epoch === this.epoch) this.publish({ errors: { ...this.snapshot.errors, [path]: '' } })
          return value
        },
        (error: unknown) => {
          if (epoch === this.epoch)
            this.publish({
              errors: {
                ...this.snapshot.errors,
                [path]: error instanceof Error ? error.message : 'REQUEST_FAILED',
              },
            })
          throw error
        },
      )
      .finally(() => {
        if (this.writes.get(key) === work) this.writes.delete(key)
        if (epoch === this.epoch) this.pending(path, false)
      })
    this.writes.set(key, work)
    return work
  }
  /** Merge an exclusive cursor page without mixing sessions or rewinding history.
   * @param project - Authorized project identity.
   * @param id - Owned session identity.
   */
  async history(project: string, id: string): Promise<void> {
    const key = `/v1/data/${project}/sessions/${id}/history`,
      previous = this.snapshot.cache[key] as HistoryValue | undefined,
      epoch = this.epoch
    const page = await this.query(`${key}?after=${previous?.cursor ?? -1}&limit=100`, History)
    if (epoch !== this.epoch) return
    const current = this.snapshot.cache[key] as HistoryValue | undefined
    if (page.cursor < (current?.cursor ?? -1)) return
    const events = new Map((current?.events ?? []).map(event => [event.seq, event]))
    for (const event of page.events) events.set(event.seq, event)
    this.publish({
      cache: {
        ...this.snapshot.cache,
        [key]: { ...page, events: [...events.values()].sort((a, b) => a.seq - b.seq) },
      },
    })
  }
  /** Binary routes share the Harness authenticated carrier while retaining domain identity.
   * @param path - Upload-part or artifact-download path.
   * @param body - Optional upload part.
   * @param ticket - Single-part authorization ticket.
   * @returns Authenticated transfer response.
   */
  async bytes(path: string, body?: Blob, ticket?: string): Promise<Response> {
    const epoch = this.epoch
    const headers: Record<string, string> = { 'x-data-agent-credential': this.credential }
    if (ticket) headers['x-upload-ticket'] = ticket
    const result = await fetch('/api/data-agent/bytes?path=' + encodeURIComponent(path), {
      method: body ? 'POST' : 'GET',
      headers,
      ...(body ? { body } : {}),
      signal: this.abort.signal,
      credentials: 'same-origin',
    })
    this.abort.signal.throwIfAborted()
    if (epoch !== this.epoch) throw new Error('ACCOUNT_CHANGED')
    if (!result.ok) throw new Error('TRANSFER_FAILED')
    return result
  }
  /** Abort pending transport and clear credentials and listeners. */
  dispose(): void {
    this.abort.abort()
    this.credential = ''
    this.listeners.clear()
    this.writes.clear()
  }
}
