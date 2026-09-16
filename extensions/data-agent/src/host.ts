/** Cordis-owned internal Worker listener; launch through a dsh source profile. */
import type { Context } from '@deepseek-ai/cordis'
import { createServer } from 'node:http'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { Pool } from 'pg'
import { z } from 'zod'
import { DataAgentService } from './service.ts'
import { LocalStore } from './local-store.ts'
import { createWorkerHandler } from './worker-http.ts'
import { Catalog } from './catalog.ts'
import { Skills,SkillRuntimeSchema } from './skills.ts'
import { QualityConfig,QualityEvaluator } from './quality-evaluation.ts'
import { HarnessSessions } from './harness.ts'
import { createDomainHandler } from './domain-http.ts'

/** Deployment parameters; credentials are read from the named environment variable. */
export const Config = z.object({
  database_env: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
  storage_root: z.string().refine(isAbsolute),
  host: z.literal('127.0.0.1'),
  port: z.number().int().min(1).max(65535),
  trusted_hosts: z.array(z.string().min(1)).min(1),
  max_body_bytes: z.number().int().positive(),
  max_object_bytes: z.number().int().positive(),
  request_timeout_ms: z.number().int().positive(),
  shutdown_grace_ms: z.number().int().positive(),
  database_timeout_ms: z.number().int().positive(),
  database_pool_size: z.number().int().positive(),
  lease_ms: z.number().int().min(100),
  max_attempts: z.number().int().positive(),
  max_running_jobs: z.number().int().positive(),
  recovery_interval_ms: z.number().int().positive(),
  max_upload_bytes:z.number().int().positive(), part_bytes:z.number().int().positive(), upload_ttl_ms:z.number().int().positive(),upload_cleanup_grace_ms:z.number().int().positive(),
  environment_digest:z.string().regex(/^[a-f0-9]{64}$/),
  harness:z.object({provider:z.string().min(1),max_result_bytes:z.number().int().positive(),max_context_bytes:z.number().int().positive(),runtime:SkillRuntimeSchema}).strict().nullable().default(null),
  quality_evaluation:QualityConfig.nullable().default(null),
  skill_allowed_tools:z.array(z.enum(['inspect_dataset','propose_workflow_patch'])),
  allowed_origins:z.array(z.string().url()),
  user_accounts:z.array(z.object({actor_id:z.string().min(1),credential_sha256:z.string().regex(/^[a-f0-9]{64}$/),can_create_projects:z.boolean()}).strict()),
  accounts: z.array(z.object({
    owner: z.string().min(1), projects: z.array(z.string().min(1)).min(1),
    credential_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()).min(1),
}).strict().refine(config=>config.upload_cleanup_grace_ms>=2*config.request_timeout_ms,'Upload cleanup must outlive in-flight requests').refine(config=>!config.harness || config.harness.runtime.environment_digest===config.environment_digest,'Harness and Worker environment digests must match')

/** Stable plugin name for source-profile overlays. */
export const name = 'data-agent-host'

/** Mount a loopback listener and stop all owned work before returning from disposal.
 * @param ctx - Cordis plugin lifecycle owner.
 * @param raw - Explicit deployment configuration, validated before opening resources.
 * @returns Resolves when the listener and recovery loop are registered; rejects failed startup.
 */
export async function apply(ctx: Context, raw: z.infer<typeof Config>) {
  const config = Config.parse(raw)
  const connectionString = process.env[config.database_env]
  if (!connectionString) throw new Error('DATA_AGENT_DATABASE_ENV_MISSING')
  await ctx.effect(async function* () {
    if (!(await stat(config.storage_root)).isDirectory()) throw new Error('DATA_AGENT_STORAGE_ROOT')
    const pool = new Pool({ connectionString, max: config.database_pool_size,
      connectionTimeoutMillis: config.database_timeout_ms,
      statement_timeout: config.database_timeout_ms,
      idle_in_transaction_session_timeout: config.database_timeout_ms,
    })
    // Driver errors can contain connection details; only stable codes reach logs.
    pool.on('error', () => ctx.logger.error('DATA_AGENT_DATABASE_CONNECTION_ERROR'))
    yield () => pool.end()
    const version = await pool.query('SELECT max(version) AS version FROM data_agent.schema_versions')
      .then(result => result.rows[0]?.version, () => { throw new Error('DATA_AGENT_DATABASE_STARTUP') })
    if (version !== 8) throw new Error('DATA_AGENT_SCHEMA_VERSION')
    const store = new LocalStore(config.storage_root)
    const service = new DataAgentService(pool, {...config,runtime:config.harness?.runtime}, (claim, manifest) => store.verify(claim, manifest), key=>store.checksum(key))
    const handler = createWorkerHandler(service, config, {store,max_object_bytes:config.max_object_bytes})
    const catalog=new Catalog(pool,store,config)
    if(config.quality_evaluation && !config.harness)throw new Error('DATA_AGENT_EVALUATION_HARNESS_REQUIRED')
    const quality=config.quality_evaluation && config.harness?new QualityEvaluator(ctx,config.harness.provider,config.quality_evaluation):undefined
    if(quality)yield ()=>quality.dispose()
    const skills=new Skills(pool,new Set(config.skill_allowed_tools),quality?.suites??{},config.harness?.runtime??null,quality?.evaluate)
    if(config.harness && ['agents','tools','skills','sessions'].some(name=>!ctx.get(name)))throw new Error('DATA_AGENT_HARNESS_SERVICES')
    const harness=config.harness?new HarnessSessions(ctx,catalog,skills,service,config.harness):undefined
    if(harness)yield ()=>harness.dispose()
    const domainHandler=createDomainHandler(catalog,service,{accounts:config.user_accounts,allowed_origins:config.allowed_origins,max_body_bytes:config.max_body_bytes},skills,harness)
    const active = new Set<Promise<void>>()
    const server = createServer({connectionsCheckingInterval:config.request_timeout_ms},(req, res) => {
      if (!config.trusted_hosts.includes(req.headers.host ?? '')) {
        res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end('{"error":"FORBIDDEN"}')
        return
      }
      const work = (req.url?.startsWith('/v1/data/')?domainHandler:handler)(req, res).catch(() => { res.destroy() })
      active.add(work)
      void work.finally(() => active.delete(work))
    })
    server.requestTimeout = config.request_timeout_ms
    server.headersTimeout = config.request_timeout_ms
    server.setTimeout(config.request_timeout_ms, socket => socket.destroy())
    let recovery: Promise<void> = Promise.resolve()
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopping = false
    const recover = () => {
      recovery = service.recover().then(()=>catalog.expire()).then(() => {}, () => {
        ctx.logger.error('DATA_AGENT_RECOVERY_ERROR')
      }).finally(() => {
        if (!stopping) timer = setTimeout(recover, config.recovery_interval_ms)
      })
    }
    yield async () => {
      stopping = true
      if(quality)await quality.dispose()
      clearTimeout(timer)
      if (server.listening) {
        const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        const deadline = setTimeout(() => server.closeAllConnections(), config.shutdown_grace_ms)
        try { await closed } finally { clearTimeout(deadline) }
      }
      if(harness)await harness.dispose()
      await Promise.allSettled(active)
      await recovery
    }
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(config.port, config.host, () => { server.off('error', reject); resolve() })
    })
    server.on('error', () => ctx.logger.error('DATA_AGENT_LISTENER_ERROR'))
    recover()
    ctx.logger.info('DATA_AGENT_HOST_READY')
  }, 'data-agent-host')
}
