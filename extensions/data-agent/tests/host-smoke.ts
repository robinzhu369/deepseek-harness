/** Real source-profile lifecycle regression, invoked after database migration tests. */
import assert from 'node:assert/strict'
import type { Pool } from 'pg'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, copyFile, writeFile, rm, readFile, cp } from 'node:fs/promises'
import { createServer, request } from 'node:http'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = fileURLToPath(new URL('../../../', import.meta.url))

/** Exercise the supported dsh launcher, authentication and awaited disposal.
 * @param databaseUrl - Disposable migrated PostgreSQL test database.
 * @param startupError - Expected fail-loud code when the database schema is incompatible.
 */
export async function hostSmoke(databaseUrl: string, startupError?: string, harnessPool?: Pool) {
  const home = await mkdtemp(join(tmpdir(), 'data-agent-host-'))
  const reservation = createServer()
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve))
  const address = reservation.address()
  assert.ok(address && typeof address !== 'string')
  const port = address.port
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  )
  const credential = 'synthetic-host-service-credential'
  const userToken = 'synthetic-harness-user-credential'
  const quality = Boolean(harnessPool) && process.env.DATA_AGENT_QUALITY_EVAL === '1'
  const config = {
    quality_evaluation: quality
      ? {
          repetitions: 3,
          case_timeout_ms: 60000,
          python: process.env.DATA_AGENT_TEST_PYTHON ?? '/opt/homebrew/opt/python@3.10/bin/python3.10',
          frozen_timeout_ms: 60000,
          max_context_bytes: 131072,
          max_result_bytes: 65536,
          max_running_evaluations: 1,
        }
      : null,
    harness: harnessPool
      ? {
          provider: process.env.DATA_AGENT_REAL_MODEL ? 'deepseek-official' : 'data-agent-scripted',
          max_context_bytes: 65536,
          max_result_bytes: 262144,
          runtime: {
            harness_commit: 'c291e7961a515f6d7af9304e7fd1d257929aef26',
            model_id: process.env.DATA_AGENT_REAL_MODEL ? 'deepseek-v4-flash' : 'fixture',
            model_snapshot: null,
            environment_digest: 'a'.repeat(64),
            policy_version: 'policy1',
            parameters: {
              thinking: 'disabled',
              max_tokens: 2048,
              environment_kind: 'synthetic-test-profile',
            },
          },
        }
      : null,
    database_env: 'DATA_AGENT_HOST_TEST_DATABASE',
    storage_root: home,
    host: '127.0.0.1',
    port,
    trusted_hosts: [`127.0.0.1:${port}`],
    max_upload_bytes: 1000000,
    part_bytes: 100000,
    upload_ttl_ms: 60000,
    upload_cleanup_grace_ms: quality ? 1200000 : process.env.DATA_AGENT_REAL_MODEL ? 120000 : 60000,
    environment_digest: 'a'.repeat(64),
    skill_allowed_tools: quality ? ['inspect_dataset', 'propose_workflow_patch'] : [],
    allowed_origins: [],
    user_accounts: harnessPool
      ? [
          {
            actor_id: 'alice',
            credential_sha256: createHash('sha256').update(userToken).digest('hex'),
            can_create_projects: false,
          },
        ]
      : [],
    max_body_bytes: 65536,
    max_object_bytes: 1048576,
    request_timeout_ms: quality ? 600000 : process.env.DATA_AGENT_REAL_MODEL ? 60000 : 2000,
    shutdown_grace_ms: 100,
    database_timeout_ms: 2000,
    database_pool_size: 2,
    lease_ms: 60000,
    max_attempts: 2,
    max_running_jobs: 1,
    recovery_interval_ms: 100,
    accounts: [
      {
        owner: 'host-smoke-worker',
        projects: ['host-smoke'],
        credential_sha256: createHash('sha256').update(credential).digest('hex'),
      },
    ],
  }
  const profile = join(home, 'profiles', 'data-agent-worker-host')
  await mkdir(profile, { recursive: true })
  await copyFile(join(root, 'deploy/data-agent/profile.package.json'), join(profile, 'package.json'))
  await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
  const harnessPatch = join(home, 'harness-test.patch.yml')
  await writeFile(
    harnessPatch,
    `- id: data-agent-deepseek\n  disabled: true\n- insert:\n    - id: scripted-model\n      name: '${join(root, 'extensions/data-agent/tests/harness-model.fixture.ts')}'\n`,
  )
  const launchArgs = [
    '--import',
    'tsx/esm',
    'apps/cli/src/bin.ts',
    '--profile',
    'data-agent-worker-host',
    '--patch',
    join(root, 'deploy/data-agent/cordis.source.patch.yml'),
    ...(harnessPool
      ? [
          '--patch',
          join(root, 'deploy/data-agent/harness.source.patch.yml'),
          ...(!process.env.DATA_AGENT_REAL_MODEL ? ['--patch', harnessPatch] : []),
        ]
      : []),
  ]
  const launchOptions = {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      HOME: home,
      DSH_HOME: home,
      DSH_AGENTS_HOME: join(home, 'agents'),
      DSH_TELEMETRY_DISABLED: '1',
      TSX_TSCONFIG_PATH: join(root, 'tsconfig.json'),
      DATA_AGENT_SESSION_ROOT: join(home, 'sessions'),
      ...(process.env.DATA_AGENT_REAL_MODEL
        ? { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL: 'https://api.deepseek.com' }
        : {}),
      DATA_AGENT_HOST_TEST_DATABASE: databaseUrl,
      DATA_AGENT_HOST_CONFIG: JSON.stringify(config),
    },
  } as const
  const child = spawn(process.execPath, launchArgs, launchOptions)
  let output = '',
    exited = false
  let lockedSession: string | undefined
  const done = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => {
      exited = true
      resolve(code)
    })
  })
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  child.stderr.on('data', (chunk) => {
    output += chunk
  })
  const post = (host: string, token = credential, origin?: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/v1/worker/acquire',
          headers: {
            host,
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            ...(origin ? { origin } : {}),
          },
        },
        (res) => {
          let body = ''
          res.on('data', (c) => {
            body += c
          })
          res.on('end', () => resolve({ status: res.statusCode!, body }))
        },
      )
      req.on('error', reject)
      req.end('{}')
    })
  let slow: Socket | undefined
  try {
    const deadline = Date.now() + 25000
    while (!output.includes('DATA_AGENT_HOST_READY') && !exited && Date.now() < deadline) await delay(50)
    if (startupError) {
      assert.ok(exited, `misconfigured dsh did not exit:\n${output}`)
      assert.notEqual(await done, 0)
      assert.ok(output.includes(startupError), output)
      assert.ok(!output.includes(databaseUrl))
      return
    }
    assert.ok(output.includes('DATA_AGENT_HOST_READY'), `dsh did not become ready:\n${output}`)
    assert.deepEqual(await post(`127.0.0.1:${port}`), { status: 200, body: '{"claim":null}' })
    assert.equal((await post('attacker.invalid')).status, 403)
    assert.equal((await post(`127.0.0.1:${port}`, 'invalid-service-credential')).status, 403)
    assert.equal((await post(`127.0.0.1:${port}`, credential, 'https://attacker.invalid')).status, 403)
    if (harnessPool) {
      const call = async (path: string, body: unknown) => {
        const response = await fetch(`http://127.0.0.1:${port}/v1/data/p/` + path, {
          method: 'POST',
          headers: { authorization: 'Bearer ' + userToken, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const value = await response.json()
        assert.ok(response.ok, JSON.stringify(value) + '\n' + output)
        return value as { session_id: string; events: { type: string; data: unknown }[] }
      }
      if (quality) {
        const reports: Record<string, unknown> = {}
        for (const id of [
          'data-analysis',
          'data-cleaning',
          'feature-engineering',
          'numeric-quality-review',
        ]) {
          const manifest = JSON.parse(
            await readFile(join(root, 'skill-packages', id, 'skill.manifest.json'), 'utf8'),
          )
          const files = Object.fromEntries(
            await Promise.all(
              ['SKILL.md', 'contracts/input.schema.json', 'contracts/output.schema.json'].map(
                async (path) => [path, await readFile(join(root, 'skill-packages', id, path), 'utf8')],
              ),
            ),
          )
          const revision =
            (
              await harnessPool.query(
                'SELECT revision FROM data_agent.skill_definitions WHERE project_id=$1 AND id=$2',
                ['p', id],
              )
            ).rows[0]?.revision ?? 0
          await call(`skills/${id}/draft`, { revision, package: { manifest, files } })
          await call(`skills/${id}/candidate`, {
            revision: revision + 1,
            reason: 'Synthetic quality comparison only',
            parent: null,
          })
          reports[id] = await call(`skills/${id}/evaluate`, { version: manifest.version })
          if (!process.env.DATA_AGENT_REAL_MODEL)
            assert.equal((reports[id] as { status: string }).status, 'passed')
          const localFiles = [
            'extensions/data-agent/src/quality-evaluation.ts',
            'extensions/data-agent/src/contracts.ts',
            'extensions/data-agent/src/skill-contracts.ts',
            'services/data-worker/engine.py',
            'services/data-worker/operators.py',
            'services/data-worker/evaluate_quality.py',
            'services/data-worker/evaluate_plan.py',
            'services/data-worker/importer.py',
          ]
          const localEvidence = Object.fromEntries(
            await Promise.all(
              localFiles.map(async (path) => [
                path,
                createHash('sha256')
                  .update(await readFile(join(root, path)))
                  .digest('hex'),
              ]),
            ),
          )
          await writeFile(
            join(
              root,
              process.env.DATA_AGENT_REAL_MODEL
                ? 'evals/data-agent/skill-quality-local-components.json'
                : 'evals/data-agent/t13-skill-quality-local-components.json',
            ),
            JSON.stringify({ local_only: true, sha256: localEvidence }, null, 2) + '\n',
          )
          const dest = join(
            root,
            'evals/data-agent',
            process.env.DATA_AGENT_REAL_MODEL ? 'skill-quality-real.json' : 't13-skill-quality-fixture.json',
          )
          await writeFile(dest, JSON.stringify(reports, null, 2) + '\n')
          const denied = await fetch(`http://127.0.0.1:${port}/v1/data/p/skills/${id}/publish`, {
            method: 'POST',
            headers: { authorization: 'Bearer ' + userToken, 'content-type': 'application/json' },
            body: JSON.stringify({
              version: manifest.version,
              evaluation_id: (reports[id] as { id: string }).id,
            }),
          })
          assert.equal(denied.status, 409)
          assert.equal(((await denied.json()) as { error: string }).error, 'BUSINESS_EVALUATION_REQUIRED')
        }
        if (!process.env.DATA_AGENT_REAL_MODEL) {
          const projection = Object.fromEntries(
            Object.entries(reports).map(([id, value]) => {
              const evaluation = value as {
                status: string
                report: { cases: { lane: string; trace: string }[] }
              }
              const observations = evaluation.report.cases
                .filter((item) => item.lane === 'planning')
                .flatMap((item) => JSON.parse(item.trace))
              return [
                id,
                {
                  status: evaluation.status,
                  sessions: observations.length,
                  executed_plans: observations.filter((item) => item.execution !== null).length,
                  failed_plans: observations.filter((item) => item.blocking_failures.length > 0).length,
                  release_eligible: false,
                },
              ]
            }),
          )
          assert.deepEqual(
            projection,
            JSON.parse(
              await readFile(join(root, 'extensions/data-agent/tests/quality.expected.json'), 'utf8'),
            ),
          )
        }
        await cp(
          join(home, 'sessions'),
          join(
            root,
            'evals/data-agent',
            process.env.DATA_AGENT_REAL_MODEL
              ? 'skill-quality-real-sessions'
              : 't13-skill-quality-fixture-sessions',
          ),
          { recursive: true },
        )
      }
      const input = {
        project_id: 'p',
        dataset: { kind: 'DatasetRef', project_id: 'p', artifact_id: 'input', digest: 'b'.repeat(64) },
        workflow_revision: 0,
        goal: 'Inspect synthetic data',
        fit_scope: 'undefined',
        policy_version: 'policy1',
      }
      const created = await call('sessions', { input, skills: [] })
      const prompt = process.env.DATA_AGENT_REAL_MODEL
        ? 'Call inspect_dataset exactly once with dataset_id input, then report that the returned run is submitted and not yet complete. Do not poll.'
        : 'TEST_INSPECT'
      const response = await call(`sessions/${created.session_id}/messages`, { text: prompt })
      const firstPage = (await (
        await fetch(
          `http://127.0.0.1:${port}/v1/data/p/sessions/${created.session_id}/history?after=-1&limit=1`,
          { headers: { authorization: 'Bearer ' + userToken } },
        )
      ).json()) as { events: { seq: number }[]; cursor: number; has_more: boolean }
      assert.equal(firstPage.events.length, 1)
      assert.equal(firstPage.events[0].seq, 0)
      assert.equal(firstPage.cursor, 0)
      assert.equal(firstPage.has_more, true)
      const secondPage = (await (
        await fetch(
          `http://127.0.0.1:${port}/v1/data/p/sessions/${created.session_id}/history?after=${firstPage.cursor}&limit=100`,
          { headers: { authorization: 'Bearer ' + userToken } },
        )
      ).json()) as { events: { seq: number }[]; cursor: number; activity: string }
      assert.equal(secondPage.events[0].seq, 1)
      assert.equal(secondPage.cursor, secondPage.events.at(-1)?.seq)
      assert.equal(secondPage.activity, 'idle')
      const logged = JSON.stringify(response.events)
      assert.ok(logged.includes('inspect_dataset'), logged)
      assert.ok(
        response.events.some((e) => e.type === 'tool/result'),
        logged,
      )
      const run = (
        await harnessPool.query('SELECT * FROM data_agent.runs WHERE session_id=$1', [created.session_id])
      ).rows[0]
      assert.ok(run, logged)
      assert.equal(run.actor_id, 'alice')
      assert.equal(run.project_id, 'p')
      assert.equal(run.status, 'queued')
      if (!process.env.DATA_AGENT_REAL_MODEL) {
        const denied = await call(`sessions/${created.session_id}/messages`, { text: 'TEST_FORBIDDEN' })
        assert.ok(JSON.stringify(denied.events).includes('DATASET_SCOPE'))
        const proposed = await call(`sessions/${created.session_id}/messages`, { text: 'TEST_PROPOSE' })
        assert.ok(JSON.stringify(proposed.events).includes('proposed'))
        assert.equal(
          (
            await harnessPool.query(
              "SELECT revision FROM data_agent.workflows WHERE project_id='p' AND id='test-proposal'",
            )
          ).rows[0].revision,
          1,
        )
        assert.equal(
          (
            await harnessPool.query('SELECT count(*) FROM data_agent.runs WHERE session_id=$1', [
              created.session_id,
            ])
          ).rows[0].count,
          '1',
        )
        const saved = (
          await harnessPool.query(
            "SELECT id,digest FROM data_agent.proposals WHERE project_id='p' AND workflow_id='test-proposal'",
          )
        ).rows[0]
        const review = await fetch(`http://127.0.0.1:${port}/v1/data/p/proposals/${saved.id}`, {
          headers: { authorization: 'Bearer ' + userToken },
        })
        assert.equal(review.status, 200)
        assert.equal(((await review.json()) as { stale: boolean }).stale, false)
        await call(`proposals/${saved.id}/decision`, {
          action: 'approve',
          digest: saved.digest,
          max_removed_fraction: 0,
          reason: 'User reviewed exact inspect proposal',
        })
        await call(`proposals/${saved.id}/submit`, { idempotency_key: 'human-approved-inspect' })
        assert.equal(
          (
            await harnessPool.query('SELECT count(*) FROM data_agent.runs WHERE session_id=$1', [
              created.session_id,
            ])
          ).rows[0].count,
          '2',
        )
      }
      if (!process.env.DATA_AGENT_REAL_MODEL && !quality) {
        const createdTask = (await call('tasks', {
          name: 'Task chain',
          goal: 'Verify frozen replay',
          dataset: input.dataset,
          idempotency_key: 'http-task',
        })) as unknown as { task_id: string }
        const scoped = await call('sessions', { input, skills: [], business_task_id: createdTask.task_id })
        await call(`sessions/${scoped.session_id}/messages`, { text: 'TEST_PROPOSE' })
        const proposal = (
          await harnessPool.query(
            "SELECT id,digest FROM data_agent.proposals WHERE workflow_id='task-proposal'",
          )
        ).rows[0]
        await call(`proposals/${proposal.id}/decision`, {
          action: 'approve',
          digest: proposal.digest,
          max_removed_fraction: 0,
          reason: 'Review task analysis',
        })
        const submitted = await call(`sessions/${scoped.session_id}/messages`, {
          text:
            'TEST_TASK_SUBMIT ' +
            JSON.stringify({
              proposal_id: proposal.id,
              stage: 'analysis',
              previous_run_id: null,
              source_run_id: null,
              scope: { kind: 'all' },
              reuse: false,
              select: true,
              expected_revision: 0,
              idempotency_key: 'tool-task-submit',
            }),
        })
        assert.ok(JSON.stringify(submitted.events).includes('run_id'))
        const run = (
          await harnessPool.query('SELECT id FROM data_agent.runs WHERE business_task_id=$1', [
            createdTask.task_id,
          ])
        ).rows[0]
        assert.ok(run)
        await call(`runs/${run.id}/pause`, {})
        await call(`runs/${run.id}/resume`, {})
        await call(`runs/${run.id}/rerun`, {
          scope: { kind: 'all' },
          reuse: false,
          select: false,
          expected_revision: 1,
          idempotency_key: 'http-replay',
        })
        const state = await call(`sessions/${scoped.session_id}/messages`, { text: 'TEST_TASK_STATUS' })
        assert.ok(JSON.stringify(state.events).includes('active_lineage'))
        const url = `http://127.0.0.1:${port}/v1/data/p/tasks/${createdTask.task_id}/follow`
        const snap = (await (
          await fetch(url, { headers: { authorization: 'Bearer ' + userToken } })
        ).json()) as { cursor: unknown; selected_run_id: string; changed: boolean; runs: unknown[] }
        assert.equal(snap.selected_run_id, run.id)
        assert.equal(snap.runs.length, 2)
        const unchanged = (await (
          await fetch(url + '?cursor=' + encodeURIComponent(JSON.stringify(snap.cursor)), {
            headers: { authorization: 'Bearer ' + userToken },
          })
        ).json()) as { changed: boolean }
        assert.equal(unchanged.changed, false)
        await call(`tasks/${createdTask.task_id}/cancel`, {})
        const cancelled = (await (
          await fetch(url, { headers: { authorization: 'Bearer ' + userToken } })
        ).json()) as { status: string; final_export_refs: unknown[]; runs: { status: string }[] }
        const projection = {
          status: cancelled.status,
          final_export_refs: cancelled.final_export_refs,
          run_statuses: cancelled.runs.map((r) => r.status),
          unchanged_follow: unchanged.changed,
          logged_tools: ['submit_task_run', 'get_task_snapshot'].filter((tool) =>
            JSON.stringify([...submitted.events, ...state.events]).includes(tool),
          ),
        }
        const expected = JSON.parse(
          await readFile(join(root, 'extensions/data-agent/tests/task-chain.expected.json'), 'utf8'),
        )
        assert.deepEqual(projection, expected)
      }
      await assert.rejects(call('sessions', { input: { ...input, project_id: 'q' }, skills: [] }))
      if (!process.env.DATA_AGENT_REAL_MODEL && !quality) {
        const selected = await call('sessions', {
          input,
          skills: [{ id: 'data-analysis', version: '2.0.0' }],
        })
        lockedSession = selected.session_id
        const loaded = await call(`sessions/${selected.session_id}/messages`, { text: 'TEST_SKILL' })
        assert.ok(JSON.stringify(loaded.events).includes('<skill_content'), JSON.stringify(loaded.events))
        await harnessPool.query(
          "UPDATE data_agent.skill_versions SET status='retired' WHERE project_id='p' AND skill_id='data-analysis' AND version='2.0.0'",
        )
        const locked = await call(`sessions/${selected.session_id}/messages`, { text: 'TEST_SKILL' })
        assert.ok(JSON.stringify(locked.events).includes('<skill_content'), JSON.stringify(locked.events))
        await assert.rejects(call('sessions', { input, skills: [{ id: 'data-analysis', version: '2.0.0' }] }))
      }
    }
    // An authenticated caller stalls midway through JSON. Shutdown must close it.
    slow = connect(port, '127.0.0.1')
    slow.on('error', () => {
      /* Shutdown may reset this deliberately incomplete request. */
    })
    await new Promise<void>((resolve) => slow!.once('connect', resolve))
    slow.write(
      `POST /v1/worker/acquire HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nAuthorization: Bearer ${credential}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`,
    )
    await delay(30)
    child.kill('SIGTERM')
    const shutdownDeadline = setTimeout(() => child.kill('SIGKILL'), 8000)
    let code: number | null
    try {
      code = await done
    } finally {
      clearTimeout(shutdownDeadline)
    }
    assert.equal(code, 0, output)
    await assert.rejects(post(`127.0.0.1:${port}`), /ECONNREFUSED/)
    assert.ok(!output.includes(databaseUrl), 'database credentials must not reach logs')
    if (lockedSession) {
      const restarted = spawn(process.execPath, launchArgs, launchOptions)
      let restartOutput = ''
      restarted.stdout.on('data', (chunk) => {
        restartOutput += chunk
      })
      restarted.stderr.on('data', (chunk) => {
        restartOutput += chunk
      })
      const restartDone = new Promise<number | null>((resolve, reject) => {
        restarted.once('error', reject)
        restarted.once('close', resolve)
      })
      try {
        const deadline = Date.now() + 25000
        while (
          !restartOutput.includes('DATA_AGENT_HOST_READY') &&
          restarted.exitCode === null &&
          Date.now() < deadline
        )
          await delay(50)
        assert.ok(restartOutput.includes('DATA_AGENT_HOST_READY'), restartOutput)
        const call = async (action: string, body: unknown) => {
          const res = await fetch(`http://127.0.0.1:${port}/v1/data/p/sessions/${lockedSession}/${action}`, {
            method: 'POST',
            headers: { authorization: 'Bearer ' + userToken, 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          const result = await res.json()
          assert.equal(res.status, 200, JSON.stringify(result) + '\n' + restartOutput)
          return result
        }
        await call('resume', {})
        const result = await call('messages', { text: 'TEST_SKILL' })
        assert.ok(JSON.stringify(result).includes('<skill_content'), JSON.stringify(result))
      } finally {
        restarted.kill('SIGTERM')
        const timer = setTimeout(() => restarted.kill('SIGKILL'), 8000)
        try {
          assert.equal(await restartDone, 0, restartOutput)
        } finally {
          clearTimeout(timer)
        }
      }
    }
  } finally {
    slow?.destroy()
    if (!exited) {
      child.kill('SIGKILL')
      await done
    }
    await rm(home, { recursive: true, force: true })
  }
}
