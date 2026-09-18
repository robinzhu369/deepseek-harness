/** Real browser actions, domain HTTP and disposable Docker Workers share one training task. */
import { expect } from 'vitest'
import type { newEnglishPage } from '../../../apps/web/tests/support.ts'
type Page = Awaited<ReturnType<typeof newEnglishPage>>
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Workflow, ArtifactRef } from '../src/contracts.ts'

/** Exercise upload, approval, three stages, export download and cached rerun.
 * @param page - Authenticated workbench page.
 * @param temp - Private fixture directory.
 * @param root - Repository root.
 * @param port - Disposable domain listener.
 * @param token - Synthetic user credential.
 * @param evidenceRoot - Output root for this run; defaults to the repository.
 */
export async function workbenchExecution(
  page: Page,
  temp: string,
  root: string,
  port: number,
  token: string,
  evidenceRoot = root,
) {
  const endpoint = `http://127.0.0.1:${port}`,
    base = endpoint + '/v1/data/workbench-test'
  const api = async (path: string, body?: unknown) => {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const value = await response.json()
    expect(response.ok, JSON.stringify(value)).toBe(true)
    return value
  }
  // T12's queued inspector fixtures have intentionally synthetic object references.
  for (const session of await api('/sessions')) {
    for (const run of (await api('/sessions/' + session.id + '/navigation')).runs)
      await api('/runs/' + run.id + '/cancel', {})
  }
  const configPath = join(temp, 't13-worker.json')
  await writeFile(
    configPath,
    JSON.stringify({
      endpoint,
      root: join(temp, 'remote-worker'),
      image: process.env.DATA_AGENT_TEST_IMAGE,
      instance_id: 't13-browser',
      docker: '/usr/local/bin/docker',
      docker_home: process.env.HOME,
      credential_env: 'WORKER_TOKEN',
      http_timeout_seconds: 10,
      docker_timeout_seconds: 30,
      heartbeat_seconds: 0.2,
      poll_seconds: 0.1,
      execution_seconds: 30,
      input_bytes: 4194304,
      output_bytes: 4194304,
      temporary_bytes: 8000000,
      manifest_bytes: 100000,
      memory_bytes: 536870912,
      pids: 64,
      cpus: 1,
      polars_threads: 1,
      max_columns: 100,
    }),
  )
  const worker = async () => {
    const result = await promisify(execFile)(
      process.env.DATA_AGENT_TEST_PYTHON ?? 'python3',
      ['-B', join(root, 'services/data-worker/remote.py'), '--config', configPath, '--once'],
      {
        timeout: 60000,
        maxBuffer: 100000,
        env: { PATH: '/usr/bin:/bin', WORKER_TOKEN: 'synthetic-workbench-worker-credential' },
      },
    )
    expect(JSON.parse(result.stdout).status, result.stderr).toBe('published')
  }
  await page.getByRole('button', { name: 'Data center', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const csv =
    'id,income,target\n' +
    Array.from({ length: 200 }, (_, i) => `${String(i).padStart(5, '0')},${i % 7 ? i : ''},${i % 2}`).join(
      '\n',
    )
  await dialog
    .getByLabel('Upload file', { exact: true })
    .setInputFiles({ name: 't13-training.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await dialog.getByText('Advanced parsing and resume', {exact:true}).click()
  await dialog.getByLabel('Target column (optional)',{exact:true}).fill('target')
  await dialog.getByLabel('Identifier column (optional)',{exact:true}).fill('id')
  await dialog.getByRole('textbox', { name: 'Parsing options and field roles', exact: true }).fill(
    JSON.stringify({
      options: {
        format: 'csv',
        encoding: 'utf-8',
        delimiter: ',',
        has_header: true,
        null_values: [''],
        types: { income: 'float64', target: 'int64' },
      },
      roles: {},
    }),
  )
  await dialog.getByRole('button', { name: 'Upload and parse', exact: true }).click()
  await expect
    .poll(async () => (await api('/datasets')).some((row: { status: string }) => row.status === 'importing'))
    .toBe(true)
  await worker()
  await dialog.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect.poll(() => dialog.getByRole('status').innerText()).toBe('Ready for analysis')
  const dataset = (await api('/datasets')).find(
    (row: { filename: string }) => row.filename === 't13-training.csv',
  )
  let source: ArtifactRef = {
    kind: 'DatasetRef',
    project_id: 'workbench-test',
    artifact_id: dataset.dataset_id,
    digest: dataset.dataset_digest,
  }
  await dialog.locator('summary').filter({hasText:/^Preview$/}).click()
  await dialog.getByLabel('Preview columns (comma separated)', { exact: true }).fill('id,income,target')
  await dialog.getByRole('button', { name: 'Preview', exact: true }).click()
  await dialog.getByText(/Preview run ID:/).waitFor()
  await worker()
  await dialog.getByRole('button', { name: 'Refresh', exact: true }).last().click()
  await dialog.getByRole('cell', { name: '00000', exact: true }).waitFor()
  await dialog.getByRole('button', { name: 'Create a task with this data', exact: true }).click()
  await page.getByRole('button', { name: 'New session', exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Refresh', exact: true }).last().click()
  await expect.poll(() => page.getByRole('combobox', { name: 'Dataset', exact: true }).inputValue()).toBe(dataset.dataset_id)
  await page.getByRole('textbox', { name: 'Task purpose', exact: true }).fill('T13 training contract')
  await page.getByRole('main').getByRole('button', { name: 'Create analysis task', exact: true }).click()
  await page.getByLabel('Message this session').waitFor()
  const session = (await api('/sessions')).find(
    (item: { input: { goal: string } }) => item.input.goal === 'T13 training contract',
  )
  const taskId = session.business_task_id
  expect(taskId).toBeTruthy()
  const states = []
  for (const stage of ['analysis', 'processing', 'features'] as const) {
    const nodes: Workflow['nodes'] =
      stage === 'analysis'
        ? [
            {
              id: 'inspect',
              operator: 'inspect',
              operator_version: '1',
              params: {},
              inputs: { data: source },
            },
          ]
        : stage === 'processing'
          ? [
              {
                id: 'fill',
                operator: 'fill_constant',
                operator_version: '1',
                params: { columns: ['income'], value: -1 },
                inputs: { data: source },
              },
            ]
          : [
              {
                id: 'split',
                operator: 'split',
                operator_version: '1',
                params: { method: 'random', train_fraction: 0.6, validation_fraction: 0.2 },
                inputs: { data: source },
              },
              {
                id: 'export',
                operator: 'export',
                operator_version: '1',
                params: {
                  feature_columns: ['income'],
                  target: 'target',
                  purpose: 'supervised',
                  allow_null: false,
                },
                inputs: Object.fromEntries(
                  ['train', 'validation', 'test'].map((port) => [
                    port,
                    { node_id: 'split', output_port: port },
                  ]),
                ),
              },
            ]
    const workflow = {
      schema_version: '1',
      project_id: 'workbench-test',
      environment_digest: 'a'.repeat(64),
      policy_version: 'policy1',
      seed: 42,
      nodes,
    }
    await page.getByRole('button', { name: 'Workflow', exact: true }).click()
    await page.getByLabel('Import workflow JSON', { exact: true }).setInputFiles({
      name: stage + '.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(workflow)),
    })
    await page.getByText(nodes[0].id + ' · ' + nodes[0].operator, { exact: true }).waitFor()
    await page.getByRole('textbox', { name: 'Task purpose', exact: true }).fill('T13 ' + stage)
    await page
      .getByRole('textbox', { name: 'Proposal evidence JSON', exact: true })
      .fill(
        JSON.stringify([
          { ref: source, inputs: [source], scope: 'full', description: 'Published synthetic input' },
        ]),
      )
    await page.getByRole('button', { name: 'Create review proposal', exact: true }).click()
    const card = page
      .getByTestId('proposal-card')
      .filter({ has: page.getByText('T13 ' + stage, { exact: true }) })
    await card.getByLabel('Decision reason', { exact: true }).fill('Reviewed synthetic ' + stage)
    await card.getByRole('combobox', { name: 'Business stages', exact: true }).selectOption(stage)
    await card.getByRole('button', { name: 'Approve', exact: true }).click()
    await card.getByRole('button', { name: 'Submit run', exact: true }).click()
    await expect.poll(async () => (await api('/tasks/' + taskId)).runs.length).toBe(states.length + 1)
    for (const _node of nodes) await worker()
    const task = await api('/tasks/' + taskId)
    const run = await api('/runs/' + task.selected_run_id)
    expect(run.status).toBe('succeeded')
    states.push({ stage, status: task.status })
    if (stage === 'processing') {
      const data = run.artifacts.find((artifact: { kind: string }) => artifact.kind === 'DatasetRef')
      source = { ...source, artifact_id: data.id, digest: data.digest }
    }
  }
  expect(states).toEqual([
    { stage: 'analysis', status: 'awaiting_next_stage' },
    { stage: 'processing', status: 'awaiting_next_stage' },
    { stage: 'features', status: 'completed' },
  ])
  await page.getByRole('button', { name: 'Task status', exact: true }).click()
  await page.getByText('ExportRef', { exact: true }).waitFor()
  const exportCard = page
    .locator('section')
    .filter({ has: page.getByText('ExportRef', { exact: true }) })
    .last()
  const downloading = page.waitForEvent('download')
  await exportCard.getByRole('button', { name: 'Download', exact: true }).click()
  const download = await downloading,
    bundlePath = join(temp, 'training.zip')
  await download.saveAs(bundlePath)
  const checked = await promisify(execFile)(process.env.DATA_AGENT_TEST_PYTHON ?? 'python3', [
    '-c',
    "import zipfile,json,hashlib,sys; z=zipfile.ZipFile(sys.argv[1]);m=json.loads(z.read('manifest.json'));assert all(hashlib.sha256(z.read(k)).hexdigest()==v['sha256'] for k,v in m['files'].items());print(m['status'])",
    bundlePath,
  ])
  expect(checked.stdout.trim()).toBe('ready_for_training_contract')
  const task = await api('/tasks/' + taskId)
  const replay = await api('/runs/' + task.selected_run_id + '/rerun', {
    scope: { kind: 'all' },
    reuse: true,
    select: true,
    expected_revision: task.revision,
    idempotency_key: 't13-replay',
  })
  const rerun = await api('/runs/' + replay.run_id)
  expect(rerun.status).toBe('succeeded')
  expect(rerun.nodes.every((node: { reused_from_job_id: string | null }) => node.reused_from_job_id)).toBe(
    true,
  )
  // Web's ambient coding persona must not enter quality-evaluation Agents.
  const manifest = JSON.parse(
    await readFile(join(root, 'skill-packages/data-analysis/skill.manifest.json'), 'utf8'),
  )
  const files = Object.fromEntries(
    await Promise.all(
      ['SKILL.md', 'contracts/input.schema.json', 'contracts/output.schema.json'].map(async (path) => [
        path,
        await readFile(join(root, 'skill-packages/data-analysis', path), 'utf8'),
      ]),
    ),
  )
  await api('/skills/data-analysis/draft', { revision: 0, package: { manifest, files } })
  await api('/skills/data-analysis/candidate', {
    revision: 1,
    reason: 'Synthetic Web composition test',
    parent: null,
  })
  const evaluation = await api('/skills/data-analysis/evaluate', { version: manifest.version })
  expect(evaluation.status).toBe('passed')
  const publication = await fetch(base + '/skills/data-analysis/publish', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ version: manifest.version, evaluation_id: evaluation.id }),
  })
  expect(publication.status).toBe(409)
  expect((await publication.json()).error).toBe('BUSINESS_EVALUATION_REQUIRED')
  await writeFile(
    join(evidenceRoot, 'evals/data-agent/t13-browser-result.json'),
    JSON.stringify(
      {
        model: 'scripted',
        transport: 'real-dsh-web-http',
        worker: 'remote-docker',
        upload_rows: 200,
        preview_leading_zero: '00000',
        stages: states,
        export_checksum_verified: true,
        cached_rerun: rerun.status,
        release_eligible: false,
        web_quality_sessions: 18,
        synthetic_publication_blocked: true,
      },
      null,
      2,
    ) + '\n',
  )
  await page.getByRole('main').getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByText('ExportRef', { exact: true }).waitFor()
  await page.getByText(/Task revision: 4 · completed/).waitFor()
  await page.screenshot({ path: join(evidenceRoot, 'implementation/t13-workbench.png'), fullPage: true })
  expect((await readFile(bundlePath)).length).toBeGreaterThan(100)
}
