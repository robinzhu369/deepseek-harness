/** Cold local installation behind TLS Nginx with OS-denied public egress and a synthetic model. */
import { it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:net'
import https from 'node:https'
import { setTimeout as delay } from 'node:timers/promises'
import { Pool } from 'pg'
import { chromium, newEnglishPage } from '../../../apps/web/tests/support.ts'
import { workbenchFixture } from './workbench-fixture.ts'
import { workbenchExecution } from './workbench-execution.ts'
const exec = promisify(execFile)

it.skipIf(!process.env.DATA_AGENT_OFFLINE_ROOT)(
  'offline installed Web completes a task through strict TLS ingress and preserves recoverable state',
  async () => {
    const release = resolve(process.env.DATA_AGENT_OFFLINE_ROOT!),
      root = join(release, 'app'),
      docker = '/usr/local/bin/docker'
    const recovery = process.env.DATA_AGENT_RECOVERY_STATE
    const state = recovery ? resolve(recovery) : await mkdtemp(join(tmpdir(), 'data-agent-offline-')),
      objects = join(state, 'objects'),
      home = join(state, 'harness'),
      evidence = join(state, 'evidence')
    for (const path of [objects, home, join(evidence, 'evals/data-agent'), join(evidence, 'implementation')])
      await mkdir(path, { recursive: true })
    const savedEnv = process.env.DATA_AGENT_T13
    process.env.DATA_AGENT_T13 = '1'
    const reservation = createServer()
    await new Promise<void>((r) => reservation.listen(0, '127.0.0.1', r))
    const a = reservation.address()
    if (!a || typeof a === 'string') throw Error('PORT')
    const port = a.port
    await new Promise<void>((r) => reservation.close(() => r()))
    let fixture
    try {
      fixture = await workbenchFixture(objects, port, !recovery)
    } finally {
      if (savedEnv === undefined) delete process.env.DATA_AGENT_T13
      else process.env.DATA_AGENT_T13 = savedEnv
    }
    const pool = new Pool({ connectionString: process.env.DATA_AGENT_TEST_DATABASE_URL })
    try {
      if (!recovery) await pool.query("DELETE FROM data_agent.artifacts WHERE id='workbench-input'")
    } finally {
      await pool.end()
    }
    const images = JSON.parse(await readFile(join(release, 'manifest.json'), 'utf8')).images
    const python = join(state, 'evaluate-python'),
      node = join(release, 'runtime/node'),
      socket = 'unix://' + join(homedir(), '.docker/run/docker.sock')
    // Evaluations use the delivered Python image, without host pip packages or filesystem mounts.
    await writeFile(
      python,
      `#!${node}\nconst {spawnSync}=require('node:child_process');const {basename}=require('node:path');const name=basename(process.argv[2]||'');if(!['evaluate_quality.py','evaluate_plan.py'].includes(name))process.exit(2);const r=spawnSync(${JSON.stringify(docker)},['--host',${JSON.stringify(socket)},'run','--rm','-i','--pull=never','--network=none','--read-only','--memory=536870912','--cpus=1','--pids-limit=128','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=67108864,mode=1777','--entrypoint','python',${JSON.stringify(images.worker.id)},'/app/services/data-worker/'+name],{stdio:'inherit',env:{PATH:'/usr/bin:/bin'}});process.exit(r.status??1);\n`,
      { mode: 0o700 },
    )
    fixture.config.quality_evaluation!.python = python
    fixture.config.quality_evaluation!.frozen_timeout_ms = 30000
    const overlay = join(state, 'web.patch.yml')
    await writeFile(
      overlay,
      (await readFile(join(root, 'deploy/data-agent/workbench.source.patch.yml'), 'utf8')).replaceAll(
        "'../../",
        "'" + root + '/',
      ) +
        `\n- id: llm-deepseek\n  disabled: true\n- insert:\n    - id: scripted-model\n      name: '${join(root, 'extensions/data-agent/tests/harness-model.fixture.ts')}'\n`,
    )
    const child = spawn(
      '/usr/bin/sandbox-exec',
      [
        '-D',
        'DOCKER_SOCKET=' + join(homedir(), '.docker/run/docker.sock'),
        '-f',
        join(root, 'deploy/data-agent/offline/loopback-only.sb'),
        node,
        '--import',
        'tsx/esm',
        'apps/cli/src/bin.ts',
        '--profile',
        'web',
        '--patch',
        overlay,
        '--patch',
        join(root, 'deploy/data-agent/offline/offline.patch.yml'),
        '--no-open',
        '--port',
        '0',
      ],
      {
        cwd: root,
        env: {
          PATH: '/usr/bin:/bin',
          HOME: home,
          DSH_HOME: home,
          DSH_AGENTS_HOME: join(home, 'agents'),
          DSH_TELEMETRY_MODE: 'DISABLED',
          DSH_TELEMETRY_DISABLED: '1',
          DATA_AGENT_TEST_DATABASE_URL: process.env.DATA_AGENT_TEST_DATABASE_URL,
          DATA_AGENT_HOST_CONFIG: JSON.stringify(fixture.config),
          DATA_AGENT_DOMAIN_ENDPOINT: `http://127.0.0.1:${port}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    await writeFile(join(state, 'app.pid'), String(child.pid))
    let output = ''
    child.stdout.on('data', (c) => {
      output += String(c)
    })
    child.stderr.on('data', (c) => {
      output += String(c)
    })
    const exited = new Promise<void>((r) => child.once('close', () => r()))
    const network = 't15-' + randomUUID(),
      proxy = 't15-nginx-' + randomUUID(),
      violations: string[] = [],
      requests: string[] = [],
      sockets: string[] = []
    let createdNetwork = false,
      createdProxy = false,
      browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
    const report: Record<string, unknown> = {
      state,
      release,
      model: 'scripted',
      release_ready: false,
      status: 'running',
    }
    try {
      let url: string | undefined
      for (let i = 0; i < 240; i++) {
        url = output.match(/dsh web: (http:\/\/[^\s]+)/)?.[1]
        if (url) break
        if (child.exitCode !== null) throw Error(output)
        await delay(250)
      }
      if (!url) throw Error('APP_START_TIMEOUT:' + output)
      const proxyConfig = join(state, 'proxy')
      await mkdir(proxyConfig, { recursive: true })
      const cert = join(proxyConfig, 'cert.pem'),
        key = join(proxyConfig, 'key.pem')
      await exec('/usr/bin/openssl', [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
        '-keyout',
        key,
        '-out',
        cert,
      ])
      const pub = await exec('/usr/bin/openssl', ['x509', '-in', cert, '-pubkey', '-noout'])
      const pubPath = join(proxyConfig, 'public.pem')
      await writeFile(pubPath, pub.stdout)
      const der = await exec('/usr/bin/openssl', ['pkey', '-pubin', '-in', pubPath, '-outform', 'DER'], {
        encoding: 'buffer',
      })
      const spki = createHash('sha256').update(der.stdout).digest('base64')
      const nginx = join(proxyConfig, 'nginx.conf'),
        appPort = new URL(url).port
      await writeFile(
        nginx,
        `pid /tmp/nginx.pid;\nerror_log /dev/stderr info;\nevents {worker_connections 128;}\nhttp {access_log /dev/stdout;client_body_temp_path /tmp/client;proxy_temp_path /tmp/proxy;fastcgi_temp_path /tmp/fastcgi;uwsgi_temp_path /tmp/uwsgi;scgi_temp_path /tmp/scgi;map $http_upgrade $connection_upgrade {default upgrade;'' close;}server {listen 443 ssl;ssl_certificate /config/cert.pem;ssl_certificate_key /config/key.pem;ssl_protocols TLSv1.2 TLSv1.3;client_max_body_size 64m;location / {proxy_pass http://host.docker.internal:${appPort};proxy_http_version 1.1;proxy_set_header Host $http_host;proxy_set_header Upgrade $http_upgrade;proxy_set_header Connection $connection_upgrade;proxy_request_buffering off;proxy_buffering off;proxy_read_timeout 300s;}}}\n`,
      )
      await exec(docker, ['network', 'create', network])
      createdNetwork = true
      await exec(docker, [
        'run',
        '-d',
        '--name',
        proxy,
        '--pull=never',
        '--network',
        network,
        '--add-host=host.docker.internal:host-gateway',
        '--read-only',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,nodev,size=16777216',
        '--mount',
        `type=bind,src=${proxyConfig},dst=/config,readonly`,
        '-p',
        '127.0.0.1::443',
        images.nginx.id,
        '-c',
        '/config/nginx.conf',
      ])
      createdProxy = true
      const mapped = (await exec(docker, ['port', proxy, '443/tcp'])).stdout.trim(),
        proxyPort = mapped.split(':').at(-1)!,
        target = new URL(url)
      target.host = 'localhost:' + proxyPort
      target.protocol = 'https:'
      const ca = await readFile(cert)
      const tlsCheck = (trusted: boolean) =>
        new Promise<number>((resolve, reject) => {
          const request = https.get(
            target,
            { ...(trusted ? { ca } : {}), rejectUnauthorized: true },
            (response) => {
              response.resume()
              resolve(response.statusCode!)
            },
          )
          request.setTimeout(15000, () => request.destroy(Error('TLS_TIMEOUT')))
          request.on('error', reject)
        })
      await expect.poll(() => tlsCheck(true), { timeout: 30000 }).toBeLessThan(400)
      await expect(tlsCheck(false)).rejects.toMatchObject({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
      browser = await chromium.launch({
        headless: true,
        channel: process.env.DATA_AGENT_BROWSER_CHANNEL ?? 'msedge',
        args: ['--ignore-certificate-errors-spki-list=' + spki],
      })
      const page = await newEnglishPage(browser)
      await page.route('**/*', async (route) => {
        const address = new URL(route.request().url())
        if (['http:', 'https:'].includes(address.protocol) && address.host !== target.host) {
          violations.push(address.origin)
          await route.abort()
          return
        }
        requests.push(address.pathname)
        await route.continue()
      })
      page.on('websocket', (ws) => {
        sockets.push(ws.url())
        if (new URL(ws.url()).host !== target.host) violations.push(ws.url())
      })
      await page.goto(target.href)
      await page.getByLabel('Workbench credential').fill(fixture.token)
      await page.getByRole('button', { name: 'Connect', exact: true }).click()
      await page.getByLabel('Project', { exact: true }).selectOption('workbench-test')
      if (recovery) {
        const pool = new Pool({ connectionString: process.env.DATA_AGENT_TEST_DATABASE_URL })
        try {
          const artifacts = (await pool.query('SELECT * FROM data_agent.artifacts')).rows
          expect(artifacts.length).toBeGreaterThan(0)
          let bytes = 0
          for (const artifact of artifacts) {
            const content = await readFile(join(objects, artifact.object_key))
            expect(createHash('sha256').update(content).digest('hex')).toBe(artifact.digest)
            expect(content.length).toBe(Number(artifact.bytes))
            bytes += content.length
          }
          const sessions = await fetch(`http://127.0.0.1:${port}/v1/data/workbench-test/sessions`, {
            headers: { authorization: 'Bearer ' + fixture.token },
          }).then((r) => r.json())
          const session = sessions.find(
            (s: { input: { goal: string } }) => s.input.goal === 'T13 training contract',
          )
          expect(session).toBeTruthy()
          const task = await fetch(
            `http://127.0.0.1:${port}/v1/data/workbench-test/tasks/${session.business_task_id}`,
            { headers: { authorization: 'Bearer ' + fixture.token } },
          ).then((r) => r.json())
          expect(task.status).toBe('completed')
          const bundle = artifacts.find((a) => a.kind === 'ExportRef')
          const response = await fetch(
            `http://127.0.0.1:${port}/v1/data/workbench-test/artifacts/${bundle.id}/download`,
            { headers: { authorization: 'Bearer ' + fixture.token } },
          )
          expect(response.status).toBe(200)
          expect(
            createHash('sha256')
              .update(Buffer.from(await response.arrayBuffer()))
              .digest('hex'),
          ).toBe(bundle.digest)
          expect((await pool.query('SELECT count(*) FROM data_agent.skill_releases')).rows[0].count).toBe('0')
          expect(
            (await pool.query("SELECT count(*) FROM data_agent.jobs WHERE status='running'")).rows[0].count,
          ).toBe('0')
          expect((await pool.query('SELECT count(*) FROM data_agent.artifacts')).rows[0].count).toBe(
            String(artifacts.length),
          )
          report.restored_artifacts = artifacts.length
          report.restored_bytes = bytes
          report.task_status = task.status
          report.export_download_verified = true
          report.no_duplicate_publication = true
          await page.screenshot({
            path: join(evidence, 'implementation/restored-workbench.png'),
            fullPage: true,
          })
        } finally {
          await pool.end()
        }
      } else await workbenchExecution(page, state, root, port, fixture.token, evidence)
      expect(violations).toEqual([])
      report.status = 'passed'
      report.browser_external_requests = violations
      report.request_count = requests.length
      report.websocket_count = sockets.length
      report.tls_untrusted_rejected = true
      report.tls_pinned_trusted = true
      report.proxy = 'nginx'
      report.application_egress = 'kernel-loopback-only'
      report.proxy_network = 'docker-bridge-static-upstream; egress firewall not validated'
      report.quality_python = 'delivered-worker-image'
    } catch (error) {
      report.status = 'failed'
      report.error = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      if (browser) await browser.close()
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 10000)
      await exited
      clearTimeout(timer)
      await unlink(join(state, 'app.pid'))
      if (createdProxy) {
        const nginxOutput = await exec(docker, ['logs', proxy])
        report.nginx_logs = (nginxOutput.stdout + nginxOutput.stderr).replace(
          /([?&]token=)[^\s&"]+/g,
          '$1[REDACTED]',
        )
        await exec(docker, ['rm', '-f', proxy])
      }
      if (createdNetwork) await exec(docker, ['network', 'rm', network])
      await writeFile(
        resolve(`evals/data-agent/t15/${recovery ? 'restored' : 'offline'}-browser-result.json`),
        JSON.stringify(report, null, 2) + '\n',
      )
      await writeFile(join(state, 'app.log'), output.replace(/([?&]token=)[^\s&]+/g, '$1[REDACTED]'))
    }
  },
  600000,
)
