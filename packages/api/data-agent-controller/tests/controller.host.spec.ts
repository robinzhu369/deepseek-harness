/** Transport-boundary regressions; the external domain HTTP listener is the only stub. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Controller from '../src/index.ts'
const credential = 'synthetic-workbench-credential'
const signal = () => new AbortController().signal
async function setup() {
  const ctx = new Context()
  let binary: ((request: Request) => Promise<Response>) | undefined
  ctx.reflect.provide('typert', {})
  ctx.reflect.provide('connection', {
    fetch: {
      register: (route: { fetch: (request: Request) => Promise<Response> }) => {
        binary = route.fetch
      },
    },
  })
  const fiber = ctx.plugin(Controller, {
    endpoint: 'http://127.0.0.1:12345',
    timeoutMs: 10000,
    maxBodyBytes: 64,
    maxResultBytes: 64,
    pollIntervalMs: 2000,
    maxUploadBytes: 1024,
  })
  await fiber
  return {
    ctx,
    service: ctx.dataAgentController,
    binary: (request: Request) => {
      if (!binary) throw new Error('MISSING_ROUTE')
      return binary(request)
    },
  }
}
afterEach(() => vi.unstubAllGlobals())
describe('data workbench domain carrier', () => {
  it('rejects escaping paths and oversized commands before contacting the listener', async () => {
    const { ctx, service } = await setup(),
      fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    try {
      for (const path of [
        'https://outside.invalid/v1/data/p',
        '/v1/data/../../../admin',
        '/v1/data/p#hidden',
      ])
        await expect(service.request(credential, 'GET', path, '', signal())).rejects.toThrow(
          'DATA_AGENT_PATH',
        )
      await expect(
        service.request(credential, 'POST', '/v1/data/p', 'x'.repeat(65), signal()),
      ).rejects.toThrow('DATA_AGENT_REQUEST_LIMIT')
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })
  it('preserves domain refusal and bounds streamed responses', async () => {
    const { ctx, service } = await setup()
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{"error":"FORBIDDEN"}', { status: 403 }))
        .mockResolvedValueOnce(new Response('x'.repeat(65))),
    )
    try {
      expect(await service.request(credential, 'GET', '/v1/data/p', '', signal())).toEqual({
        status: 403,
        body: '{"error":"FORBIDDEN"}',
      })
      await expect(service.request(credential, 'GET', '/v1/data/p', '', signal())).rejects.toThrow(
        'DATA_AGENT_RESULT_LIMIT',
      )
    } finally {
      await ctx.fiber.dispose()
    }
  })
  it('aborts pending forwarding when its owner is disposed', async () => {
    const { ctx, service } = await setup()
    vi.stubGlobal(
      'fetch',
      (_url: URL, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener(
            'abort',
            () => {
              reject(new Error('ABORTED'))
            },
            { once: true },
          ),
        ),
    )
    const work = service.request(credential, 'GET', '/v1/data/p', '', signal()),
      rejected = expect(work).rejects.toThrow()
    await ctx.fiber.dispose()
    await rejected
  })
  it('forwards only the binary route, ticket and range headers', async () => {
    const { ctx, binary } = await setup(),
      fetcher = vi.fn().mockResolvedValue(
        new Response('bytes', {
          status: 206,
          headers: { 'content-range': 'bytes 0-4/10', 'set-cookie': 'secret=x' },
        }),
      )
    vi.stubGlobal('fetch', fetcher)
    try {
      expect(
        (await binary(new Request('http://carrier/api/data-agent/bytes?path=/v1/data/p/runs/r'))).status,
      ).toBe(400)
      const response = await binary(
        new Request('http://carrier/api/data-agent/bytes?path=/v1/data/p/artifacts/a/download', {
          headers: { 'x-data-agent-credential': credential, range: 'bytes=0-4', cookie: 'untrusted=x' },
        }),
      )
      expect(response.status).toBe(206)
      expect(response.headers.get('set-cookie')).toBeNull()
      const options = fetcher.mock.calls[0]![1] as RequestInit
      expect(new Headers(options.headers).get('authorization')).toBe('Bearer ' + credential)
      expect(new Headers(options.headers).get('range')).toBe('bytes=0-4')
      expect(new Headers(options.headers).get('cookie')).toBeNull()
      expect(options.redirect).toBe('error')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
