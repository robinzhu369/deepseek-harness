/** Real browser → settings/credentials → Harness → compatible provider wire regression. */
import { createServer } from 'node:http'
import { expect } from 'vitest'
import type { newEnglishPage } from '../../../apps/web/tests/support.ts'
import {readFile,writeFile} from 'node:fs/promises'
type Page = Awaited<ReturnType<typeof newEnglishPage>>
/** Exercise shared model configuration before domain sign-in using only synthetic credentials.
 * @param page - Authenticated Harness carrier showing the logged-out workbench.
 */
export async function workbenchModels(page: Page) {
  const requests: Record<string, unknown>[] = []
  let status = 200
  const server = createServer(async (req, res) => {
    const parts: Buffer[] = []
    for await (const part of req) parts.push(Buffer.from(part as Uint8Array))
    requests.push(JSON.parse(Buffer.concat(parts).toString()) as Record<string, unknown>)
    if (status !== 200) {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          error: { message: 'upstream-echoes-synthetic-secret', type: 'authentication_error' },
        }),
      )
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const chunk of [
      {
        id: 'probe',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }],
      },
      {
        id: 'probe',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 },
      },
    ])
      res.write('data: ' + JSON.stringify(chunk) + '\n\n')
    res.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('MODEL_TEST_PORT')
  try {
    await page.getByRole('button', { name: 'Model configuration', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Model configuration' })
    await dialog.getByRole('combobox', { name: 'Configuration template', exact: true }).selectOption('relay')
    await dialog
      .getByRole('textbox', { name: 'Base URL', exact: true })
      .fill(`http://127.0.0.1:${address.port}/v1`)
    await dialog.getByText('Model parameters', {exact:true}).click()
    await dialog
      .getByRole('textbox', { name: 'Configuration ID (workbench- prefix)', exact: true })
      .fill('workbench-wire-test')
    await dialog.getByRole('textbox', { name: 'Model ID', exact: true }).fill('synthetic-model')
    await dialog.getByRole('textbox', { name: 'API Key', exact: true }).fill('synthetic-key')
    await dialog.getByRole('button', { name: 'Save and test', exact: true }).click()
    await expect
      .poll(() => dialog.getByRole('button', { name: 'Test connection', exact: true }).isEnabled())
      .toBe(true)
    expect(await dialog.getByRole('textbox', { name: 'API Key', exact: true }).inputValue()).toBe('')
    const snapshot=(await dialog.ariaSnapshot()).replaceAll(`http://127.0.0.1:${address.port}/v1`,'<endpoint>').replace(/ · \d+ ms/g,' · <duration> ms')+'\n'
    const golden=new URL('./model-settings.expected.txt',import.meta.url)
    if(process.env.DSH_SNAPSHOT==='refresh')await writeFile(golden,snapshot)
    else expect(snapshot).toBe(await readFile(golden,'utf8'))
    for (const [format, effort] of [
      ['openai', 'off'],
      ['deepseek', 'high'],
    ] as const) {
      await dialog.getByRole('combobox', { name: 'Reasoning protocol', exact: true }).selectOption(format)
      await dialog.getByRole('combobox', { name: 'Reasoning effort', exact: true }).selectOption(effort)
      await dialog.getByRole('button', { name: 'Save configuration', exact: true }).click()
      await expect
        .poll(() => dialog.getByRole('button', { name: 'Test connection', exact: true }).isEnabled())
        .toBe(true)
      await dialog.getByRole('button', { name: 'Test connection', exact: true }).click()
      await dialog.getByRole('status').filter({ hasText: 'MODEL_RESPONSE_RECEIVED' }).waitFor()
      expect(requests.at(-1)).toMatchObject({ model: 'synthetic-model' })
      expect(requests.at(-1)?.max_tokens ?? requests.at(-1)?.max_completion_tokens).toBe(4096)
      if (format === 'openai') expect(requests.at(-1)).toMatchObject({ reasoning_effort: 'none' })
      else expect(requests.at(-1)).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'high' })
    }
    status = 401
    await dialog.getByRole('button', { name: 'Test connection', exact: true }).click()
    await dialog.getByRole('status').waitFor()
    expect(await dialog.getByRole('status').innerText()).toContain('MODEL_AUTHENTICATION_FAILED')
    expect(await dialog.innerText()).not.toContain('upstream-echoes-synthetic-secret')
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Model configuration', exact: true }).click()
    await dialog
      .getByRole('combobox', { name: 'Saved models', exact: true })
      .selectOption('workbench-wire-test')
    expect(await dialog.getByRole('textbox', { name: 'API Key', exact: true }).inputValue()).toBe('')
    await dialog.getByRole('button', {name:'Delete configuration',exact:true}).click()
    await dialog.getByRole('button', {name:'Cancel',exact:true}).click()
    expect(await dialog.getByRole('combobox',{name:'Saved models',exact:true}).inputValue()).toBe('workbench-wire-test')
    await dialog.getByRole('button', {name:'Delete configuration',exact:true}).click()
    await dialog.getByRole('button', {name:'Confirm deletion',exact:true}).click()
    await dialog.getByRole('status').filter({hasText:'Configuration deleted.'}).waitFor()
    expect(await dialog.getByRole('combobox',{name:'Saved models',exact:true}).inputValue()).toBe('')
    expect(await dialog.getByRole('combobox',{name:'Saved models',exact:true}).locator('option').allTextContents()).not.toContain('API Relay · synthetic-model · Key configured')
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
