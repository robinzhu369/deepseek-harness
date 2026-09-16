/** Capacity measurements through the real dsh Web profile, HTTP and isolated remote Worker. */
import { expect } from 'vitest'
import type { newEnglishPage } from '../../../apps/web/tests/support.ts'
import { readFile, writeFile, stat, readdir, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { ArtifactRef, Workflow } from '../src/contracts.ts'
type Page = Awaited<ReturnType<typeof newEnglishPage>>
const exec = promisify(execFile)
const percentile = (items: number[], p: number) =>
  [...items].sort((a, b) => a - b)[Math.ceil(items.length * p) - 1]
async function directoryBytes(path: string): Promise<number> {
  let bytes = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) bytes += await directoryBytes(child)
    else if (entry.isFile()) bytes += (await stat(child)).size
  }
  return bytes
}
/** Run a frozen capacity workload and retain metrics separately from temporary full data.
 * @param page - Isolated browser page.
 * @param temp - Private test directory.
 * @param root - Repository root.
 * @param port - Domain HTTP listener.
 * @param token - Synthetic test identity.
 * @param url - Authenticated Web URL.
 * @param configPath - Versioned capacity configuration.
 */
export async function workbenchCapacity(
  page: Page,
  temp: string,
  root: string,
  port: number,
  token: string,
  url: string,
  configPath: string,
) {
  const config = JSON.parse(await readFile(configPath, 'utf8')),
    python = process.env.DATA_AGENT_TEST_PYTHON!,
    scripts = join(root, 'evals/data-agent/t14'),
    evidence = join(scripts, 'runs', randomUUID()),
    started = performance.now()
  await mkdir(evidence, { recursive: true })
  const summary: { [key: string]: unknown } = {
    configuration: config,
    run_directory: evidence,
    configuration_sha256: createHash('sha256')
      .update(await readFile(configPath))
      .digest('hex'),
    model_planning_seconds: null,
    model: 'scripted',
    human_wait_measured: false,
    release_ready: false,
    status: 'running',
  }
  const times: Record<string, number> = {},
    nodes: unknown[] = [],
    latencies: { path: string; method: string; seconds: number; under_load: boolean }[] = [],
    disk: number[] = []
  let underLoad = false,
    job = 0,
    previewSource: string | undefined,
    activeRun: string | undefined
  const api = async (path: string, body?: unknown) => {
    const start = performance.now(),
      load = underLoad
    const response = await fetch(`http://127.0.0.1:${port}/v1/data/workbench-test` + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const value = await response.json()
    latencies.push({
      path,
      method: body === undefined ? 'GET' : 'POST',
      seconds: (performance.now() - start) / 1000,
      under_load: load,
    })
    expect(response.ok, JSON.stringify(value)).toBe(true)
    return value
  }
  const workerConfig = join(temp, 'capacity-worker.json')
  await writeFile(
    workerConfig,
    JSON.stringify({
      endpoint: `http://127.0.0.1:${port}`,
      root: join(temp, 'worker'),
      image: process.env.DATA_AGENT_TEST_IMAGE,
      instance_id: 't14-capacity',
      docker: '/usr/local/bin/docker',
      docker_home: process.env.HOME,
      credential_env: 'WORKER_TOKEN',
      http_timeout_seconds: 90,
      docker_timeout_seconds: config.worker_transfer_seconds,
      heartbeat_seconds: 2,
      poll_seconds: 0.2,
      execution_seconds: config.worker_execution_seconds,
      input_bytes: config.worker_input_bytes,
      output_bytes: config.worker_output_bytes,
      temporary_bytes: config.worker_temporary_bytes,
      manifest_bytes: 4194304,
      memory_bytes: config.worker_memory_bytes,
      pids: 128,
      cpus: config.worker_cpus,
      polars_threads: config.worker_cpus,
      max_columns: config.worker_max_columns,
    }),
  )
  const worker = async () => {
    const report = join(evidence, `node-${String(job++).padStart(2, '0')}.json`)
    underLoad = true
    let pending = true
    const probing = (async () => {
      while (pending) {
        await api('/datasets')
        if (previewSource)
          await api('/artifacts/' + previewSource + '/preview', {
            offset: 0,
            limit: 100,
            columns: ['entity_id', 'target', 'x0', 'c0'],
          })
        await delay(config.control_sample_ms)
      }
    })()
    const start = performance.now()
    try {
      const result = await exec(
        python,
        [
          join(scripts, 'worker_probe.py'),
          '--config',
          workerConfig,
          '--report',
          report,
          '--sample-seconds',
          String(config.sampling_seconds),
        ],
        {
          timeout: (config.worker_execution_seconds + config.worker_transfer_seconds * 3) * 1000,
          maxBuffer: 4194304,
          env: { PATH: '/usr/bin:/bin', WORKER_TOKEN: 'synthetic-workbench-worker-credential' },
        },
      )
      expect(JSON.parse(result.stdout)?.status, result.stderr).toBe('published')
    } finally {
      pending = false
      await probing
      underLoad = false
      times.worker_wall = (times.worker_wall ?? 0) + (performance.now() - start) / 1000
      const metric = JSON.parse(await readFile(report, 'utf8'))
      nodes.push(metric)
      disk.push(await directoryBytes(temp))
      await writeFile(
        join(evidence, 'progress.json'),
        JSON.stringify({ nodes, latencies, disk }, null, 2) + '\n',
      )
    }
  }
  try {
    const file = join(temp, 'million.parquet')
    await exec(python, [join(scripts, 'generate.py'), '--config', configPath, '--output', file], {
      maxBuffer: 4194304,
      timeout: 180000,
      env: { PATH: '/usr/bin:/bin', POLARS_MAX_THREADS: String(config.worker_cpus) },
    })
    const input = JSON.parse(await readFile(join(temp, 'million.json'), 'utf8'))
    summary.input = input
    await writeFile(join(evidence, 'input.json'), JSON.stringify(input, null, 2) + '\n')
    await page.goto(url)
    await page.getByLabel('Workbench credential').fill(token)
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.getByLabel('Project', { exact: true }).selectOption('workbench-test')
    await page.getByRole('button', { name: 'Data center', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Upload file', { exact: true }).setInputFiles(file)
    let start = performance.now()
    await dialog
      .locator('button')
      .filter({ hasText: /^Upload file$/ })
      .click()
    await expect
      .poll(() => dialog.getByLabel('Upload ID (resume)', { exact: true }).inputValue(), { timeout: 180000 })
      .not.toBe('')
    times.upload = (performance.now() - start) / 1000
    const uploadId = await dialog.getByLabel('Upload ID (resume)', { exact: true }).inputValue()
    const uploaded = await api('/uploads/' + uploadId)
    expect(uploaded.status).toBe('uploaded')
    await dialog
      .getByRole('textbox', { name: 'Parsing options and field roles', exact: true })
      .fill(JSON.stringify({ options: { format: 'parquet' }, roles: input.roles }))
    await dialog.getByRole('button', { name: 'Submit import', exact: true }).click()
    await expect
      .poll(async () => (await api('/datasets')).some((r: { status: string }) => r.status === 'importing'))
      .toBe(true)
    await worker()
    const dataset = (await api('/datasets'))[0]
    expect(dataset.status).toBe('ready')
    expect(dataset.metadata.rows).toBe(config.rows)
    let source: ArtifactRef = {
      kind: 'DatasetRef',
      project_id: 'workbench-test',
      artifact_id: dataset.dataset_id,
      digest: dataset.dataset_digest,
    }
    start = performance.now()
    const preview = await api('/artifacts/' + source.artifact_id + '/preview', {
      offset: 0,
      limit: 100,
      columns: ['entity_id', 'target', 'x0', 'c0'],
    })
    await worker()
    times.preview_materialization = (performance.now() - start) / 1000
    const previewReport = (await api('/runs/' + preview.run_id)).artifacts.find(
      (r: { kind: string }) => r.kind === 'ReportRef',
    )
    const previewTimes = []
    for (let i = 0; i < config.latency_samples; i++) {
      start = performance.now()
      const value = await api('/artifacts/' + previewReport.id + '/report')
      previewTimes.push((performance.now() - start) / 1000)
      expect(value.rows.length).toBe(100)
      expect(value.total).toBe(config.rows)
    }
    summary.cached_preview_p95_seconds = percentile(previewTimes, 0.95)
    previewSource = source.artifact_id
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'New session', exact: true }).click()
    await page.getByRole('main').getByRole('button', { name: 'Refresh', exact: true }).last().click()
    await page.getByRole('combobox', { name: 'Dataset', exact: true }).selectOption(source.artifact_id)
    await page.getByRole('textbox', { name: 'Task purpose', exact: true }).fill('T14 million-row training')
    await page.getByRole('main').getByRole('button', { name: 'Create', exact: true }).click()
    await page.getByLabel('Message this session').waitFor()
    const session = (await api('/sessions')).find(
        (s: { input: { goal: string } }) => s.input.goal === 'T14 million-row training',
      ),
      taskId = session.business_task_id
    const numbers = Array.from({ length: config.numeric_columns }, (_, i) => 'x' + i),
      categories = Array.from({ length: config.category_columns }, (_, i) => 'c' + i)
    for (const stage of ['analysis', 'processing', 'features'] as const) {
      const graph: Workflow['nodes'] = []
      const add = (
        id: string,
        operator: string,
        params: Workflow['nodes'][number]['params'],
        inputs: Workflow['nodes'][number]['inputs'],
      ) => graph.push({ id, operator, operator_version: '1', params, inputs })
      if (stage === 'analysis') add('inspect', 'inspect', {}, { data: source })
      if (stage === 'processing') {
        add('clip', 'bounds', { column: 'x0', lower: 0, upper: 1001, action: 'clip' }, { data: source })
        add(
          'normalize',
          'normalize',
          { columns: categories, trim: true, case: 'preserve' },
          { data: { node_id: 'clip', output_port: 'data' } },
        )
      }
      if (stage === 'features') {
        add(
          'split',
          'split',
          { method: 'entity', column: 'entity_id', train_fraction: 0.6, validation_fraction: 0.2 },
          { data: source },
        )
        let parts = Object.fromEntries(
          ['train', 'validation', 'test'].map((p) => [p, { node_id: 'split', output_port: p }]),
        )
        for (const [method, columns] of [
          ['median', numbers],
          ['standard', numbers],
          ['onehot', categories],
        ] as const) {
          add(
            'fit_' + method,
            'fit',
            { method, columns, fit_scope: 'train', max_categories: 16, unknown: 'ignore' },
            { train: parts.train },
          )
          for (const part of ['train', 'validation', 'test'])
            add(
              method + '_' + part,
              'transform',
              {},
              { data: parts[part], transformer: { node_id: 'fit_' + method, output_port: 'transformer' } },
            )
          parts = Object.fromEntries(
            ['train', 'validation', 'test'].map((p) => [
              p,
              { node_id: method + '_' + p, output_port: 'data' },
            ]),
          )
        }
        add(
          'export',
          'export',
          {
            feature_columns: [
              ...numbers,
              ...categories.flatMap((c) =>
                Array.from({ length: config.category_cardinality }, (_, i) => c + '__category_' + i),
              ),
            ],
            target: 'target',
            allow_null: false,
            purpose: 'supervised',
          },
          parts,
        )
      }
      const proposal = {
        workflow_id: 'capacity-' + stage,
        expected_revision: 0,
        goal: 'T14 ' + stage,
        workflow: {
          schema_version: '1',
          project_id: 'workbench-test',
          environment_digest: 'a'.repeat(64),
          policy_version: 'policy1',
          seed: config.seed,
          nodes: graph,
        },
        evidence: [
          { ref: source, inputs: [source], scope: 'full', description: 'Published synthetic full dataset' },
        ],
        expected_impact: graph.map((n) => ({
          node_id: n.id,
          description: 'Frozen capacity operation',
          basis: 'full',
        })),
        unmet_prerequisites: [],
      }
      start = performance.now()
      await page.getByLabel('Message this session').fill('TEST_CAPACITY_PROPOSE ' + JSON.stringify(proposal))
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      const card = page
        .getByTestId('proposal-card')
        .filter({ has: page.getByText('T14 ' + stage, { exact: true }) })
      await card.waitFor({ timeout: 120000 })
      times.scripted_harness = (times.scripted_harness ?? 0) + (performance.now() - start) / 1000
      start = performance.now()
      await card.getByLabel('Decision reason', { exact: true }).fill('Synthetic fixed capacity scenario')
      await card.getByRole('combobox', { name: 'Business stages', exact: true }).selectOption(stage)
      await card.getByRole('button', { name: 'Approve', exact: true }).click()
      await card.getByRole('button', { name: 'Submit run', exact: true }).click()
      times.automated_approval = (times.automated_approval ?? 0) + (performance.now() - start) / 1000
      await expect
        .poll(async () => (await api('/tasks/' + taskId)).runs.length)
        .toBe(stage === 'analysis' ? 1 : stage === 'processing' ? 2 : 3)
      activeRun = (await api('/tasks/' + taskId)).selected_run_id
      for (const _node of graph) await worker()
      const task = await api('/tasks/' + taskId),
        run = await api('/runs/' + task.selected_run_id)
      expect(run.status).toBe('succeeded')
      if (stage === 'analysis') {
        const report = await api(
          '/artifacts/' + run.artifacts.find((a: { kind: string }) => a.kind === 'ReportRef').id + '/report',
        )
        expect(report.rows).toBe(config.rows)
        for (const column of numbers) expect(report.fields[column].nulls).toBe(input.nulls[column])
      }
      if (stage === 'processing') {
        const data =
          run.artifacts.find(
            (a: { kind: string; node_id: string }) => a.kind === 'DatasetRef' && a.node_id === 'normalize',
          ) ?? run.artifacts.filter((a: { kind: string }) => a.kind === 'DatasetRef').at(-1)
        // Published output node identity is checked independently through the database projection.
        const candidates = run.artifacts.filter(
          (a: { kind: string; metadata: { operations?: unknown[] } }) =>
            a.kind === 'DatasetRef' && a.metadata.operations?.length === 2,
        )
        expect(candidates.length).toBe(1)
        source = { ...source, artifact_id: candidates[0].id, digest: candidates[0].digest }
        expect(data).toBeTruthy()
      }
    }
    const task = await api('/tasks/' + taskId)
    expect(task.status).toBe('completed')
    await page.getByRole('button', { name: 'Task status', exact: true }).click()
    await page.getByText('ExportRef', { exact: true }).waitFor({ timeout: 30000 })
    const card = page
        .locator('section')
        .filter({ has: page.getByText('ExportRef', { exact: true }) })
        .last(),
      downloadEvent = page.waitForEvent('download', { timeout: 180000 })
    start = performance.now()
    await card.getByRole('button', { name: 'Download', exact: true }).click()
    const download = await downloadEvent,
      bundle = join(temp, 'training.zip')
    await download.saveAs(bundle)
    times.download = (performance.now() - start) / 1000
    summary.export_bytes = (await stat(bundle)).size
    const verification = await exec(
      python,
      [join(scripts, 'verify_bundle.py'), '--bundle', bundle, '--config', configPath],
      {
        timeout: 180000,
        maxBuffer: 4194304,
        env: { PATH: '/usr/bin:/bin', POLARS_MAX_THREADS: String(config.worker_cpus) },
      },
    )
    summary.reconciliation = JSON.parse(verification.stdout)
    await page.screenshot({ path: join(root, 'implementation/t14-workbench.png'), fullPage: true })
    const control = latencies.filter((x) => x.under_load).map((x) => x.seconds)
    expect(control.length).toBeGreaterThanOrEqual(20)
    expect(percentile(control, 0.95)).toBeLessThanOrEqual(config.control_p95_seconds)
    expect(Number(summary.cached_preview_p95_seconds)).toBeLessThanOrEqual(config.preview_p95_seconds)
    const compute = nodes.reduce<number>(
      (sum, node) => sum + Number((node as { compute_seconds: number }).compute_seconds),
      0,
    )
    summary.compute_seconds = compute
    const submissions = latencies.filter((x) => x.under_load && x.method === 'POST').map((x) => x.seconds)
    expect(submissions.length).toBeGreaterThanOrEqual(config.latency_samples)
    summary.idempotent_submission_p95_seconds = percentile(submissions, 0.95)
    expect(Number(summary.idempotent_submission_p95_seconds)).toBeLessThanOrEqual(config.control_p95_seconds)
    expect(compute).toBeLessThanOrEqual(config.compute_target_seconds)
    expect(nodes.every((node) => Number((node as { memory_peak_bytes: number }).memory_peak_bytes) > 0)).toBe(
      true,
    )
    summary.status = 'passed'
  } catch (error) {
    summary.status = 'failed'
    summary.error = error instanceof Error ? error.message : String(error)
    if (activeRun) summary.failed_run = await api('/runs/' + activeRun)
    throw error
  } finally {
    summary.timings_seconds = { ...times, total_wall: (performance.now() - started) / 1000 }
    summary.nodes = nodes
    summary.control_samples = latencies
    const loaded = latencies.filter((x) => x.under_load).map((x) => x.seconds)
    summary.control_p95_seconds = loaded.length ? percentile(loaded, 0.95) : null
    summary.host_directory_observed_peak_bytes = Math.max(0, ...disk)
    summary.host_directory_samples = disk
    summary.worker_image = process.env.DATA_AGENT_TEST_IMAGE
    summary.data_artifacts_retained = false
    await page.screenshot({ path: join(evidence, 'workbench.png'), fullPage: true })
    await writeFile(join(evidence, 'result.json'), JSON.stringify(summary, null, 2) + '\n')
    await writeFile(
      join(scripts, 'latest.json'),
      JSON.stringify({ run_directory: evidence, status: summary.status, rows: config.rows }, null, 2) + '\n',
    )
  }
}
