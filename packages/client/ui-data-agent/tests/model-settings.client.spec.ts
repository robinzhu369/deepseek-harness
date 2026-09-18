/** Saved model configuration never exposes key values or bypasses revision fencing. */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  createModelSettingsOperations,
  modelProfile,
  validateModelDraft,
  type ModelDraft,
} from '../src/client/model-settings.ts'
const draft: ModelDraft = {
  id: 'workbench-local',
  name: 'Local',
  baseURL: 'http://127.0.0.1:11434/v1/',
  model: 'qwen3.5:9b',
  format: 'openai',
  reasoning: 'off',
  contextWindow: 32768,
  maxTokens: 4096,
  timeoutMs: 120000,
}
function fixture() {
  const mutate = vi.fn().mockResolvedValue({ ok: true, value: {} }),
    set = vi.fn().mockResolvedValue({ ok: true })
  const ctx = {
    remote: {
      settings: {
        describe: vi
          .fn()
          .mockResolvedValue({
            ok: true,
            value: {
              writable: true,
              namespaces: [
                {
                  ns: 'llm-pi-ai',
                  revision: 7,
                  value: { providers: { 'workbench-local': modelProfile(draft) } },
                },
              ],
            },
          }),
        mutate,
      },
      credentials: {
        describe: vi
          .fn()
          .mockResolvedValue({
            ok: true,
            value: { WORKBENCH_LOCAL_API_KEY: { configured: true, writable: true } },
          }),
        set,
      },
    },
  } as unknown as Context
  return { api: createModelSettingsOperations(ctx), mutate, set }
}
describe('workbench model settings', () => {
  it('deletes only a listed workbench profile with the viewed revision, preserving credentials', async () => {
    const { api, mutate, set } = fixture(), state = await api.load()
    await api.remove('workbench-local', state)
    expect(mutate).toHaveBeenCalledWith('llm-pi-ai', [{ op:'unset',path:['providers','workbench-local'] }], 7)
    expect(set).not.toHaveBeenCalled()
    await expect(api.remove('deepseek-official',state)).rejects.toThrow('MODEL_CONFIGURATION_NOT_EDITABLE')
    await expect(api.remove('workbench-unknown',state)).rejects.toThrow('MODEL_CONFIGURATION_NOT_EDITABLE')
    await expect(api.remove('workbench-local',{ ...state,writable:false })).rejects.toThrow('MODEL_CONFIGURATION_NOT_EDITABLE')
    mutate.mockResolvedValue({ ok:false,error:{ code:'settings/conflict' } })
    await expect(api.remove('workbench-local',state)).rejects.toThrow('settings/conflict')
  })
  it('maps off separately for DeepSeek and OpenAI/Ollama', () => {
    expect(modelProfile(draft).models[0]?.reasoningEfforts).toMatchObject({ off: 'none' })
    expect(modelProfile({ ...draft, format: 'deepseek' }).models[0]?.reasoningEfforts).toMatchObject({
      off: null,
    })
    expect(modelProfile({ ...draft, reasoning: 'default' })).not.toHaveProperty('reasoning')
  })
  it('rejects credentials in URLs, malformed routes and impossible token budgets', () => {
    for (const patch of [
      { baseURL: 'https://key:secret@api.example/v1' },
      { baseURL: 'file:///etc/passwd' },
      { baseURL: 'https://api.example?key=secret' },
      { id: '__proto__' },
      { maxTokens: 32768 },
      { timeoutMs: 0 },
      { format: 'deepseek', reasoning: 'medium' },
    ])
      expect(() => validateModelDraft({ ...draft, ...patch } as ModelDraft)).toThrow()
    expect(validateModelDraft(draft).baseURL).toBe('http://127.0.0.1:11434/v1')
  })
  it('reads only key status; blank edits preserve secrets and writes carry the viewed revision', async () => {
    const { api, mutate, set } = fixture(),
      state = await api.load()
    expect(state.rows[0]).toMatchObject({ configured: true, model: 'qwen3.5:9b' })
    expect(state.rows[0]).not.toHaveProperty('apiKey')
    await api.save(draft, '', state)
    expect(set).not.toHaveBeenCalled()
    expect(mutate.mock.calls[0]?.[2]).toBe(7)
  })
  it('never writes a new key when the settings revision conflicts', async () => {
    const { api, mutate, set } = fixture(),
      state = await api.load()
    mutate.mockResolvedValue({ ok: false, error: { code: 'settings/conflict' } })
    await expect(api.save(draft, 'synthetic-key', state)).rejects.toThrow('settings/conflict')
    expect(set).not.toHaveBeenCalled()
  })
  it('keeps key literals outside settings and refuses malformed header values', async () => {
    const { api, mutate, set } = fixture(),
      state = await api.load()
    await api.save(draft, 'synthetic-key', state)
    expect(JSON.stringify(mutate.mock.calls)).not.toContain('synthetic-key')
    expect(set).toHaveBeenCalledWith('WORKBENCH_LOCAL_API_KEY', 'synthetic-key')
    await expect(api.save(draft, 'API_KEY=secret', state)).rejects.toThrow('MODEL_API_KEY_INVALID')
  })
})
