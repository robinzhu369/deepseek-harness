/** Optional Web Remote adapter for the authenticated Data Agent domain host. */
import { z } from 'zod'
import { probeModel } from './model-probe.ts'
import type { ModelProbeResult } from './types.ts'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-connection'

interface Config {
  /** Milliseconds between completed workbench snapshot reads. */
  pollIntervalMs: number
  /** Maximum file size the workbench buffers to hash an upload. */
  maxUploadBytes: number
  /** Exact loopback origin of the domain listener. */
  endpoint: string
  /** Maximum lifetime of one forwarded request in milliseconds. */
  timeoutMs: number
  /** Maximum bytes of a JSON command body. */
  maxBodyBytes: number
  /** Minimum accepted domain credential length. */
  credentialMinLength: number
  /** Maximum bytes of a JSON response. */
  maxResultBytes: number
}
import type { DomainResponse } from './types.ts'
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Data workbench Remote owner. */ dataAgentController: DataAgentController
  }
}
/** Proxy only the configured loopback domain service; it rechecks member identity for every request. */
export class DataAgentController extends TypertRemoteService {
  static inject = ['typert', 'connection']
  static Config = Schema.object({
    pollIntervalMs: Schema.number().min(1000).required(),
    maxUploadBytes: Schema.number().min(1).required(),
    endpoint: Schema.string().required(),
    timeoutMs: Schema.number().min(1).required(),
    maxBodyBytes: Schema.number().min(1).required(),
    credentialMinLength: Schema.number().min(6).max(200).default(20),
    maxResultBytes: Schema.number().min(1).required(),
  })
  private probing = false
  private readonly probes = new Set<Promise<ModelProbeResult>>()
  private readonly endpoint: URL
  private readonly lifecycle = new AbortController()
  /** @param ctx - Host services. @param config - Explicit domain routing and resource limits. */
  constructor(
    ctx: Context,
    private readonly config: Config,
  ) {
    super(ctx, 'dataAgentController', { namespace: 'dataAgent' })
    ctx.effect(
      () => async () => {
        this.lifecycle.abort()
        await Promise.allSettled(this.probes)
      },
      'data-agent: outbound lifetime',
    )
    this.endpoint = new URL(config.endpoint)
    if (
      this.endpoint.origin !== config.endpoint ||
      this.endpoint.protocol !== 'http:' ||
      this.endpoint.hostname !== '127.0.0.1'
    )
      throw new Error('DATA_AGENT_LOOPBACK_ENDPOINT')
    ctx.connection.fetch.register({
      path: '/api/data-agent/bytes',
      methods: ['GET', 'POST'],
      requestBody: 'streaming',
      fetch: request => this.bytes(request),
    })
  }
  /** Read non-secret browser resource limits from the deployment.
   * @returns Polling interval and maximum buffered upload size.
   */
  @Remote
  configuration(): Promise<{ pollIntervalMs: number; maxUploadBytes: number }> {
    return Promise.resolve({
      pollIntervalMs: this.config.pollIntervalMs,
      maxUploadBytes: this.config.maxUploadBytes,
    })
  }
  /** Test a saved provider using a synthetic message through the Harness loop.
   * @param provider - Registered provider identifier.
   * @param model - Configured model identifier.
   * @param signal - Browser cancellation.
   * @returns Redacted result and retained audit session identifier.
   */
  @Remote
  async testModel(provider: string, model: string, signal: AbortSignal): Promise<ModelProbeResult> {
    z.object({ provider: z.string().min(1).max(200), model: z.string().min(1).max(200) }).parse({
      provider,
      model,
    })
    if (this.probing) throw new Error('MODEL_TEST_BUSY')
    this.probing = true
    const work = probeModel(
      this.ctx,
      provider,
      model,
      AbortSignal.any([signal, this.lifecycle.signal, AbortSignal.timeout(this.config.timeoutMs)]),
    )
    this.probes.add(work)
    try {
      return await work
    } finally {
      this.probing = false
      this.probes.delete(work)
    }
  }
  private url(path: string) {
    if (!path.startsWith('/v1/data/') || path.includes('#') || path.includes('\\'))
      throw new Error('DATA_AGENT_PATH')
    const url = new URL(path, this.endpoint)
    if (url.origin !== this.endpoint.origin || !url.pathname.startsWith('/v1/data/'))
      throw new Error('DATA_AGENT_PATH')
    return url
  }
  private credential(value: string) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(value) || value.length < this.config.credentialMinLength) throw new Error('DATA_AGENT_CREDENTIAL')
    return 'Bearer ' + value
  }
  /** Forward one bounded JSON domain operation through the existing Remote carrier.
   * @param credential - User credential; never an actor ID or Worker credential.
   * @param method - Domain read or command.
   * @param path - Project-scoped domain path.
   * @param body - Serialized JSON for commands; empty for reads.
   * @param signal - Caller cancellation, independent of accepted data computation.
   * @returns Original HTTP status and bounded JSON response.
   */
  @Remote
  async request(
    credential: string,
    method: 'GET' | 'POST',
    path: string,
    body: string,
    signal: AbortSignal,
  ): Promise<DomainResponse> {
    if (Buffer.byteLength(body) > this.config.maxBodyBytes) throw new Error('DATA_AGENT_REQUEST_LIMIT')
    const response = await fetch(this.url(path), {
      method,
      headers: { authorization: this.credential(credential), 'content-type': 'application/json' },
      ...(method === 'POST' ? { body } : {}),
      redirect: 'error',
      signal: AbortSignal.any([this.lifecycle.signal, signal, AbortSignal.timeout(this.config.timeoutMs)]),
    })
    let size = 0
    const chunks: Uint8Array[] = []
    if (response.body)
      for await (const chunk of response.body) {
        size += chunk.byteLength
        if (size > this.config.maxResultBytes) throw new Error('DATA_AGENT_RESULT_LIMIT')
        chunks.push(chunk)
      }
    return { status: response.status, body: Buffer.concat(chunks).toString('utf8') }
  }
  private async bytes(request: Request): Promise<Response> {
    const url = new URL(request.url),
      path = url.searchParams.get('path') ?? '',
      upload = request.method === 'POST'
    const target = this.url(path)
    if (
      upload
        ? !/^\/v1\/data\/[\w-]+\/uploads\/[\w-]+\/parts\/\d+$/.test(target.pathname)
        : !/^\/v1\/data\/[\w-]+\/artifacts\/[\w-]+\/download$/.test(target.pathname)
    )
      return new Response('DATA_AGENT_PATH', { status: 400 })
    const headers = new Headers({
      authorization: this.credential(request.headers.get('x-data-agent-credential') ?? ''),
    })
    for (const key of ['range', 'content-length', 'x-upload-ticket']) {
      const value = request.headers.get(key)
      if (value) headers.set(key, value)
    }
    const result = await fetch(target, {
      method: upload ? 'PUT' : 'GET',
      headers,
      body: upload ? request.body : undefined,
      duplex: 'half',
      redirect: 'error',
      signal: AbortSignal.any([
        this.lifecycle.signal,
        request.signal,
        AbortSignal.timeout(this.config.timeoutMs),
      ]),
    } as RequestInit)
    const forwarded = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    for (const key of [
      'content-type',
      'content-length',
      'content-range',
      'content-disposition',
      'accept-ranges',
    ]) {
      const value = result.headers.get(key)
      if (value) forwarded.set(key, value)
    }
    return new Response(result.body, { status: result.status, headers: forwarded })
  }
}
export default DataAgentController
