// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { DatasetMount } from '../src/client/DatasetMount.tsx'
import { zh } from '../src/client/locales.ts'
import type { Surface } from '../src/client/face.ts'

it('keeps selection local until confirmed and prevents mounting unfinished imports', async () => {
  vi.useFakeTimers()
  const dataset = vi.fn(), manager = vi.fn()
  const props = {
    t: (key: keyof typeof zh) => zh[key],
    useStore: () => ({ project: 'demo', dataset: '' }),
    read: vi.fn().mockResolvedValue([
      { id: 'one', filename: 'fraud.csv', dataset_id: 'ready-data', status: 'ready' },
      { id: 'two', filename: 'pending.csv', dataset_id: null, status: 'importing' },
    ]), actions: { dataset, manager },
  } as unknown as Surface
  const host = document.createElement('div')
  document.body.replaceChildren(host)
  const root = createRoot(host)
  const button = (text: string) => Array.from(host.querySelectorAll('button')).find(value => value.textContent?.includes(text))!
  try {
    await act(async () => { root.render(createElement(DatasetMount, props)) })
    expect(button(zh.mountConfirm).disabled).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(button('pending.csv').disabled).toBe(true)
    await act(async () => { button('fraud.csv').click() })
    expect(button('fraud.csv').getAttribute('aria-pressed')).toBe('true')
    expect(dataset).not.toHaveBeenCalled()
    await act(async () => { button(zh.dismissEdit).click() })
    expect(manager).toHaveBeenCalledWith(null)
    expect(dataset).not.toHaveBeenCalled()
    await act(async () => { button(zh.mountConfirm).click() })
    expect(dataset).toHaveBeenCalledWith('ready-data')
    expect(Array.from(host.querySelectorAll('button')).map(value => value.textContent)).toMatchInlineSnapshot(`
      [
        "上传新数据",
        "fraud.csv可用于分析",
        "pending.csv正在准备数据",
        "上一页",
        "下一页",
        "取消",
        "确认挂载",
      ]
    `)
  } finally {
    await act(async () => { root.unmount() })
    vi.useRealTimers()
  }
})
