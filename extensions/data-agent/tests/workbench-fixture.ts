/** Synthetic database fixture for the real Web profile workbench regression. */
import { Pool } from 'pg'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
/** Seed only the disposable test database and return configuration for its domain plugin. */
export async function workbenchFixture(root: string, port: number, seed = true) {
  const url =
    process.env.DATA_AGENT_TEST_DATABASE_URL ??
    'postgres://postgres:local-test-only@127.0.0.1:55439/data_agent_test'
  if (!new URL(url).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_REQUIRED')
  const pool = new Pool({ connectionString: url }),
    actor = { project_id: 'workbench-test', actor_id: 'workbench-user' }
  try {
    const exists = (await pool.query("SELECT to_regclass('data_agent.schema_versions') AS name")).rows[0].name
    const current = exists
      ? (await pool.query('SELECT max(version) AS version FROM data_agent.schema_versions')).rows[0].version
      : 0
    for (const name of [
      '001_data_agent.sql',
      '002_attempt_credentials.sql',
      '003_data_catalog.sql',
      '004_skill_lifecycle.sql',
      '005_harness_sessions.sql',
      '006_proposals.sql',
      '007_business_tasks.sql',
      '008_workbench.sql',
    ])
      if (Number(name.slice(0, 3)) > current)
        await pool.query(
          await readFile(new URL('../../../database/migrations/' + name, import.meta.url), 'utf8'),
        )
    if (seed) {
      await pool.query('TRUNCATE data_agent.projects CASCADE')
      await pool.query(
        "INSERT INTO data_agent.projects VALUES($1,'Workbench fixture') ON CONFLICT DO NOTHING",
        [actor.project_id],
      )
      await pool.query("INSERT INTO data_agent.members VALUES($1,$2,'owner') ON CONFLICT DO NOTHING", [
        actor.project_id,
        actor.actor_id,
      ])
      await pool.query(
        "INSERT INTO data_agent.artifacts(id,project_id,kind,digest,object_key,bytes,metadata) VALUES('workbench-input',$1,'DatasetRef',$2,'synthetic',1,'{}') ON CONFLICT DO NOTHING",
        [actor.project_id, 'b'.repeat(64)],
      )
    }
    const input = {
      project_id: actor.project_id,
      dataset: {
        project_id: actor.project_id,
        artifact_id: 'workbench-input',
        kind: 'DatasetRef',
        digest: 'b'.repeat(64),
      },
      goal: 'Inspect synthetic training data',
      workflow_revision: 0,
      fit_scope: 'undefined',
      policy_version: 'policy1',
    }
    const runtime = {
      harness_commit: 'c291e7961a515f6d7af9304e7fd1d257929aef26',
      model_id: 'fixture',
      model_snapshot: null,
      environment_digest: 'a'.repeat(64),
      policy_version: 'policy1',
      parameters: {},
    }
    const token = 'synthetic-workbench-user-credential',
      worker = 'synthetic-workbench-worker-credential',
      sha = (value: string) => createHash('sha256').update(value).digest('hex')
    return {
      token,
      input,
      config: {
        quality_evaluation:
          process.env.DATA_AGENT_T13 === '1'
            ? {
                repetitions: 3,
                case_timeout_ms: 60000,
                python: process.env.DATA_AGENT_TEST_PYTHON ?? 'python3',
                frozen_timeout_ms: 15000,
                max_context_bytes: 131072,
                max_result_bytes: 65536,
                max_running_evaluations: 1,
              }
            : null,
        database_env: 'DATA_AGENT_TEST_DATABASE_URL',
        storage_root: root,
        host: '127.0.0.1',
        port,
        trusted_hosts: [`127.0.0.1:${port}`],
        max_body_bytes: 4194304,
        max_object_bytes: 4194304,
        request_timeout_ms: 30000,
        shutdown_grace_ms: 100,
        database_timeout_ms: 5000,
        database_pool_size: 4,
        lease_ms: 60000,
        max_attempts: 1,
        max_running_jobs: 1,
        recovery_interval_ms: 5000,
        max_upload_bytes: 67108864,
        part_bytes: 1048576,
        upload_ttl_ms: 3600000,
        upload_cleanup_grace_ms: 60000,
        environment_digest: 'a'.repeat(64),
        harness: {
          provider: 'data-agent-scripted',
          max_result_bytes: 1048576,
          max_context_bytes: 1048576,
          runtime,
        },
        skill_allowed_tools: ['inspect_dataset', 'propose_workflow_patch'],
        allowed_origins: [],
        user_accounts: [
          { actor_id: actor.actor_id, credential_sha256: sha(token), can_create_projects: true },
        ],
        accounts: [
          { owner: 'workbench-worker', projects: [actor.project_id], credential_sha256: sha(worker) },
        ],
      },
    }
  } finally {
    await pool.end()
  }
}
