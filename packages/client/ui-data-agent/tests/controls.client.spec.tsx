// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Action, Rightbar, Conversation } from '../src/client/surfaces.tsx'
import { zh } from '../src/client/locales.ts'
import type { Surface } from '../src/client/face.ts'

const t: Surface['t'] = key => zh[key]

describe('workbench control accessibility', () => {
  it('keeps an icon-only action named, discoverable and disabled when unavailable', () => {
    document.body.innerHTML = renderToStaticMarkup(createElement(Action, {
      t, icon: createElement('svg'), label: zh.send, disabled: true,
      primary: true, run: async () => {}, children: zh.send,
    }))
    const button = document.querySelector('button')!
    expect(button.getAttribute('aria-label')).toBe(zh.send)
    expect(button.title).toBe(zh.send)
    expect(button.disabled).toBe(true)
    expect(button.querySelector('[aria-hidden="true"] svg')).not.toBeNull()
  })

  it('exposes the selected monitor section and localized names for compact actions', () => {
    const props = {
      t, width: 360, canShow: true,
      useStore: () => ({ project: '', session: '', monitorOpen: true, tab: 'status', selectedRuns: {} }),
      useDomain: () => ({ authenticated: true, cache: {} }),
    } as unknown as ComponentProps<typeof Rightbar>
    document.body.innerHTML = renderToStaticMarkup(createElement(Rightbar, props))
    const controls = Array.from(document.querySelectorAll('button')).map(button => ({
      name: button.getAttribute('aria-label') ?? button.textContent,
      pressed: button.getAttribute('aria-pressed'),
      icon: !!button.querySelector('svg'),
    }))
    expect(controls).toMatchInlineSnapshot(`
      [
        {
          "icon": true,
          "name": "保存列宽",
          "pressed": null,
        },
        {
          "icon": true,
          "name": "收起监控",
          "pressed": null,
        },
        {
          "icon": true,
          "name": "代码",
          "pressed": "false",
        },
        {
          "icon": true,
          "name": "产物",
          "pressed": "true",
        },
        {
          "icon": true,
          "name": "上下文",
          "pressed": "false",
        },
      ]
    `)
  })
})


describe('task landing page', () => {
  it('fills a suggested goal without submitting, and still requires a ready dataset', async () => {
    const command = vi.fn(), read = vi.fn().mockResolvedValue([])
    const props = {
      t,
      useStore: () => ({ project: 'demo', session: '', dataset: '', manager: null }),
      useDomain: () => ({ authenticated: true, online: true, errors: {}, cache: {
        '/v1/data/demo/workbench': { role: 'editor', runtime: { policy_version: '1' } },
      } }),
      monitor: vi.fn(), command, read,
    } as unknown as Surface
    const host = document.createElement('div')
    document.body.replaceChildren(host)
    const root = createRoot(host)
    try {
      await act(async () => { root.render(createElement(Conversation, props)) })
      const suggestion = Array.from(host.querySelectorAll('button')).find(button => button.textContent === zh.qualitySuggestion)!
      await act(async () => { suggestion.click() })
      const input = host.querySelector('textarea')!
      expect(input.value).toBe(zh.qualityPrompt)
      expect(document.activeElement).toBe(input)
      expect(command).not.toHaveBeenCalled()
      expect(host.querySelector<HTMLButtonElement>(`button[aria-label="${zh.startTask}"]`)!.disabled).toBe(true)
      expect(Array.from(host.querySelectorAll('summary')).map(node => node.textContent)).toEqual([zh.generateGoal, zh.advanced])
      expect({
        title: host.querySelector('h1')?.textContent,
        placeholder: input.placeholder,
        suggestions: Array.from(host.querySelectorAll(`[aria-label="${zh.suggestedTasks}"] button`)).map(button => button.textContent),
      }).toMatchInlineSnapshot(`
        {
          "placeholder": "说说你的目标，让数据开始工作。",
          "suggestions": [
            "检查数据质量，发现缺失与异常",
            "清洗数据，为建模做好准备",
            "探索字段，制定特征处理方案",
          ],
          "title": "你的数据分析，从这里开始",
        }
      `)
    } finally {
      await act(async () => { root.unmount() })
    }
  })
})
