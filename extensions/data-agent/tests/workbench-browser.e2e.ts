/** Real Loader + Web carrier + PostgreSQL regression for the optional data workbench. */
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { newEnglishPage, chromium } from '../../../apps/web/tests/support.ts'
import { workbenchFixture } from './workbench-fixture.ts'

it.skipIf(!process.env.DATA_AGENT_TEST_DATABASE_URL)(
  'data workbench: three columns, immutable history, editable draft, template and restored selection',
  async () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url)),
      temp = await mkdtemp(join(tmpdir(), 'data-workbench-'))
    const reservation = createServer()
    await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve))
    const address = reservation.address()
    if (!address || typeof address === 'string') throw new Error('PORT')
    const port = address.port
    await new Promise<void>((resolve) =>
      reservation.close(() => {
        resolve()
      }),
    )
    const fixture = await workbenchFixture(temp, port)
    process.env.DATA_AGENT_TEST_DATABASE_URL ??=
      'postgres://postgres:local-test-only@127.0.0.1:55439/data_agent_test'
    process.env.DATA_AGENT_HOST_CONFIG = JSON.stringify(fixture.config)
    process.env.DATA_AGENT_DOMAIN_ENDPOINT = 'http://127.0.0.1:' + String(port)
    const capacity=process.env.DATA_AGENT_CAPACITY_CONFIG?JSON.parse(await readFile(process.env.DATA_AGENT_CAPACITY_CONFIG,'utf8')):null
    if(capacity){
      Object.assign(fixture.config,{max_upload_bytes:capacity.host_upload_bytes,max_object_bytes:capacity.host_object_bytes,part_bytes:capacity.part_bytes,request_timeout_ms:120000,lease_ms:120000,upload_cleanup_grace_ms:1800000})
    }
    const overlay = join(temp, 'web.patch.yml'),
      source = await readFile(join(root, 'deploy/data-agent/workbench.source.patch.yml'), 'utf8')
    await writeFile(overlay, source.replaceAll("'../../", "'" + root).replace("maxUploadBytes: 67108864", "maxUploadBytes: "+String(fixture.config.max_upload_bytes)))
    await writeFile(
      overlay,
      (await readFile(overlay, 'utf8')) +
        `\n- id: llm-deepseek\n  disabled: true\n- insert:\n    - id: scripted-model\n      name: '${join(root, 'extensions/data-agent/tests/harness-model.fixture.ts')}'\n`,
    )
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx/esm',
        'apps/cli/src/bin.ts',
        '--profile',
        'web',
        '--patch',
        overlay,
        '--no-open',
        '--port',
        '0',
      ],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          HOME: temp,
          DSH_HOME: temp,
          DSH_AGENTS_HOME: join(temp, 'agents'),
          DSH_TELEMETRY_DISABLED: '1',
          DATA_AGENT_TEST_DATABASE_URL: process.env.DATA_AGENT_TEST_DATABASE_URL,
          DATA_AGENT_HOST_CONFIG: JSON.stringify(fixture.config),
          DATA_AGENT_DOMAIN_ENDPOINT: `http://127.0.0.1:${port}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += String(chunk)
    })
    const done = new Promise<void>((resolve) => {
      child.once('close', () => {
        resolve()
      })
    })
    let authenticatedUrl: string | undefined
    for (let attempt = 0; attempt < 120; attempt++) {
      authenticatedUrl = output.match(/dsh web: (http:\/\/[^\s]+)/)?.[1]
      if (authenticatedUrl) break
      if (child.exitCode !== null) throw new Error(output)
      await delay(250)
    }
    if (!authenticatedUrl) {
      child.kill('SIGTERM')
      await done
      throw new Error('Web startup timeout: ' + output)
    }
    const browser = await chromium
        .launch({
          headless: true,
          ...(process.env.DATA_AGENT_BROWSER_CHANNEL
            ? { channel: process.env.DATA_AGENT_BROWSER_CHANNEL }
            : {}),
        })
        .catch(async (error: unknown) => {
          child.kill('SIGTERM')
          await done
          await rm(temp, { recursive: true, force: true })
          throw error
        }),
      page = await newEnglishPage(browser)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    try {
      page.setDefaultTimeout(15000)
      const domain = async (path: string, body: unknown) => {
        const response = await fetch(`http://127.0.0.1:${port}/v1/data/workbench-test${path}`, {
          method: 'POST',
          headers: { authorization: 'Bearer ' + fixture.token, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const result = await response.json()
        expect(response.ok, JSON.stringify(result)).toBe(true)
        return result
      }
      if(capacity){
        const {workbenchCapacity}=await import('./workbench-capacity.ts')
        await workbenchCapacity(page,temp,root,port,fixture.token,authenticatedUrl,process.env.DATA_AGENT_CAPACITY_CONFIG!)
        return
      }
      const session = await domain('/sessions', { input: fixture.input, skills: [] })
      await domain('/sessions/' + session.session_id + '/rename', { title: 'Synthetic analysis' })
      await page.goto(authenticatedUrl)
      await page.getByLabel('Workbench credential').fill(fixture.token)
      await page.getByRole('button', { name: 'Connect', exact: true }).click()
      await page.getByLabel('Project', { exact: true }).selectOption('workbench-test')
      await page.getByRole('button', { name: /Synthetic analysis/ }).click()
      await page.getByLabel('Message this session').fill('TEST_WORKBENCH')
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      await page
        .getByText('The tool result is recorded; queued work is not yet completed.', { exact: true })
        .waitFor()
      await page.getByRole('button', { name: 'Workflow', exact: true }).click()
      await page.getByText('Historical run is read-only; copy to a draft to edit').waitFor()
      await page.getByText('inspect · inspect', { exact: true }).waitFor()
      const columns = await Promise.all(
        ['data-sidebar', 'data-conversation', 'data-rightbar'].map((id) =>
          page.getByTestId(id).boundingBox(),
        ),
      )
      expect(columns.every((column) => column && column.width > 150)).toBe(true)
      expect(columns[0]!.x + columns[0]!.width).toBeLessThanOrEqual(columns[1]!.x + 2)
      expect(columns[1]!.x + columns[1]!.width).toBeLessThanOrEqual(columns[2]!.x + 2)
      await page.getByRole('button', { name: 'Copy to new draft', exact: true }).click()
      await page.getByRole('button', { name: 'Save revision', exact: true }).click()
      await page.getByText('Revision: 1', { exact: true }).waitFor()
      await page.getByLabel('Template name', { exact: true }).fill('Browser verified template')
      await page.getByRole('button', { name: 'Save template', exact: true }).click()
      await page.getByRole('button', { name: 'Templates', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: 'Refresh', exact: true }).click()
      await dialog.getByText('Browser verified template', { exact: true }).waitFor()
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await page.getByText('Revision: 1', { exact: true }).waitFor()
      await page.getByLabel('Select run', { exact: true }).selectOption({ index: 1 })
      const pinnedRun = await page.getByLabel('Select run', { exact: true }).inputValue()
      await page.getByText('Historical run is read-only; copy to a draft to edit').waitFor()
      expect(await page.getByRole('button', { name: 'Save revision', exact: true }).isVisible()).toBe(false)
      await page.getByRole('button', { name: 'Return to saved draft', exact: true }).click()
      await page.getByText('Revision: 1', { exact: true }).waitFor()
      await page.getByLabel('Template name', { exact: true }).fill('')
      const snapshot = async () =>
        (await page.getByTestId('data-rightbar').ariaSnapshot())
          .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/g, '<id>')
          .replace(/· [a-f0-9]{8}/g, '· <run>') + '\n'
      const golden = join(root, 'extensions/data-agent/tests/workbench.expected.txt')
      if (process.env.DSH_SNAPSHOT === 'refresh') await writeFile(golden, await snapshot())
      else await expect.poll(snapshot).toBe(await readFile(golden, 'utf8'))
      await page.screenshot({ path: join(root, 'implementation/t12-workbench.png'), fullPage: true })
      await page.getByLabel('Task purpose', { exact: true }).fill('Review inspection')
      await page.getByRole('button', { name: 'Create review proposal', exact: true }).click()
      await page.getByText('Revision: 2', { exact: true }).waitFor()
      const proposal = page.getByTestId('proposal-card')
      await proposal.getByLabel('Decision reason', { exact: true }).fill('Reviewed synthetic inspection')
      await proposal.getByRole('button', { name: 'Approve', exact: true }).click()
      await proposal.getByRole('button', { name: 'Submit run', exact: true }).click()
      await expect
        .poll(() => page.getByLabel('Select run', { exact: true }).locator('option').count())
        .toBe(3)
      expect(await page.getByLabel('Select run', { exact: true }).inputValue()).toBe(pinnedRun)
      await expect
        .poll(() => proposal.getByRole('button', { name: 'Submit run', exact: true }).isDisabled())
        .toBe(true)
      const drag = await page.locator('[data-side=rightbar]').boundingBox()
      expect(drag).not.toBeNull()
      const widthBefore = (await page.getByTestId('data-rightbar').boundingBox())!.width
      await page.mouse.move(drag!.x + drag!.width / 2, drag!.y + 100)
      await page.mouse.down()
      await page.mouse.move(drag!.x + drag!.width / 2 + 60, drag!.y + 100, { steps: 6 })
      await page.mouse.up()
      await expect
        .poll(async () => (await page.getByTestId('data-rightbar').boundingBox())!.width)
        .toBeLessThan(widthBefore - 30)
      const savedWidth = (await page.getByTestId('data-rightbar').boundingBox())!.width
      await page.getByRole('button', { name: 'Save column widths', exact: true }).click()
      await page.context().setOffline(true)
      await page.getByText('Pending sync · Last snapshot retained', { exact: true }).waitFor()
      await page.context().setOffline(false)
      await page.getByText('Synced', { exact: true }).waitFor()

      await page.reload()
      await page.getByLabel('Workbench credential').waitFor()
      expect(await page.getByTestId('data-rightbar').innerText()).toBe('')
      await page.getByLabel('Workbench credential').fill(fixture.token)
      await page.getByRole('button', { name: 'Connect', exact: true }).click()
      await page.getByText('Revision: 2', { exact: true }).waitFor()
      await expect.poll(() => page.getByLabel('Project', { exact: true }).inputValue()).toBe('workbench-test')
      await expect
        .poll(async () =>
          Math.abs((await page.getByTestId('data-rightbar').boundingBox())!.width - savedWidth),
        )
        .toBeLessThan(2)
      if (process.env.DATA_AGENT_T13 === '1') {
        const { workbenchExecution } = await import('./workbench-execution.ts')
        await workbenchExecution(page, temp, root, port, fixture.token)
      }
      expect(errors).toEqual([])
    } finally {
      await page.screenshot({ path: join(root, 'implementation/t12-browser-last.png') })
      await writeFile('/tmp/t12-browser-console.json', JSON.stringify(errors))
      await writeFile('/tmp/t12-web-host.log', output)
      await page
        .locator('details')
        .evaluateAll((elements) => elements.forEach((element) => element.setAttribute('open', '')))
      await writeFile('/tmp/t12-browser-aria.txt', await page.locator('body').ariaSnapshot())
      await browser.close()
      child.kill('SIGTERM')
      await done
      await rm(temp, { recursive: true, force: true })
      delete process.env.DATA_AGENT_HOST_CONFIG
      delete process.env.DATA_AGENT_DOMAIN_ENDPOINT
    }
  },
  2400000,
)
