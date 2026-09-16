/** Race regressions for account and resource selection in the workbench. */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { DataModel } from '../src/client/model.ts'
import { validGraph } from '../src/client/graph.ts'
import type { Registry, Workflow } from '../src/client/types.ts'
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const response = (body: unknown) => ({ status: 200, body: JSON.stringify(body) })
describe('data workbench model', () => {
  it('discards a previous account login that finishes after a new account', async () => {
    const first = deferred<ReturnType<typeof response>>(),
      model = new DataModel(async credential =>
        credential === 'first' ? first.promise : response({ actor_id: 'second', can_create_projects: false }),
      )
    const old = model.login('first')
    const rejected = expect(old).rejects.toThrow('ACCOUNT_CHANGED')
    await model.login('second')
    first.resolve(response({ actor_id: 'first', can_create_projects: false }))
    await rejected
    expect(model.getSnapshot().actor).toBe('second')
    model.dispose()
  })
  it('fences stale reads without deleting the newer resource snapshot', async () => {
    const first = deferred<ReturnType<typeof response>>()
    let count = 0
    const model = new DataModel(async () => (++count === 1 ? first.promise : response({ revision: 2 })))
    const old = model.query('/run', z.object({ revision: z.number() }))
    await model.query('/run', z.object({ revision: z.number() }))
    first.resolve(response({ revision: 1 }))
    await old
    expect(model.getSnapshot().cache['/run']).toEqual({ revision: 2 })
    model.dispose()
  })
  it('deduplicates in-flight writes and retains visible failures', async () => {
    const next = deferred<ReturnType<typeof response>>()
    let count = 0
    const model = new DataModel(async () => {
      count++
      return next.promise
    })
    const one = model.command('/decision', { digest: 'a' }),
      two = model.command('/decision', { digest: 'a' })
    expect(one).toBe(two)
    next.resolve({ status: 409, body: JSON.stringify({ error: 'VERSION_CONFLICT' }) })
    await expect(one).rejects.toThrow('VERSION_CONFLICT')
    expect(count).toBe(1)
    expect(model.getSnapshot().errors['/decision']).toBe('VERSION_CONFLICT')
    model.dispose()
  })
  it('rejects a late accepted response after the workbench owner is disposed', async () => {
    const next = deferred<ReturnType<typeof response>>()
    const model = new DataModel(async () => next.promise)
    const work = model.command('/decision', { digest: 'a' })
    const rejected = expect(work).rejects.toThrow()
    model.dispose()
    next.resolve(response({ accepted: true }))
    await rejected
    expect(model.getSnapshot().cache).toEqual({})
  })
  it('checks typed ports, missing nodes and cycles while permitting incomplete drafts', () => {
    const registry: Registry = {
      role: 'owner',
      runtime: null,
      operators: {
        inspect: {
          inputs: { data: 'DatasetRef' },
          outputs: { report: 'ReportRef' },
          params: {},
          approval: false,
        },
        process: {
          inputs: { data: 'DatasetRef' },
          outputs: { data: 'DatasetRef' },
          params: {},
          approval: true,
        },
      },
    }
    const flow: Workflow = {
      schema_version: '1',
      project_id: 'p',
      environment_digest: 'a'.repeat(64),
      policy_version: 'p',
      seed: 0,
      nodes: [
        { id: 'a', operator: 'process', operator_version: '1', params: {}, inputs: {} },
        {
          id: 'b',
          operator: 'process',
          operator_version: '1',
          params: {},
          inputs: { data: { node_id: 'a', output_port: 'data' } },
        },
      ],
    }
    expect(validGraph(flow, registry)).toBe(true)
    flow.nodes[0]!.inputs = { data: { node_id: 'b', output_port: 'data' } }
    expect(validGraph(flow, registry)).toBe(false)
    flow.nodes[0]!.inputs = {}
    flow.nodes[0]!.operator = 'inspect'
    expect(validGraph(flow, registry)).toBe(false)
    flow.nodes.pop()
    flow.nodes[0]!.inputs = { data: { node_id: 'missing', output_port: 'data' } }
    expect(validGraph(flow, registry)).toBe(false)
  })
})
