/** Execute immutable model proposals locally; never retry, replace or contact a model. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { compile, digest } from '../src/contracts.ts'
import { checkQualityPlan } from '../src/quality-evaluation.ts'
import { SkillResult } from '../src/skill-contracts.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
test(
  'T13: real-model historical plans execute with independent data oracles; failed attempts stay failed',
  { timeout: 180000 },
  async () => {
    const original = JSON.parse(
      await readFile(join(root, 'evals/data-agent/skill-quality-real.json'), 'utf8'),
    )
    const sessions = join(root, 'evals/data-agent/skill-quality-real-sessions')
    const inputs = new Map<string, Parameters<typeof checkQualityPlan>[3]>()
    for (const file of (await readdir(sessions, { recursive: true })).filter((file) =>
      file.endsWith('.jsonl'),
    )) {
      for (const line of (await readFile(join(sessions, file), 'utf8')).trim().split('\n')) {
        const event = JSON.parse(line)
        if (event.type !== 'user/message') continue
        const text = event.data.content?.find((block: { type: string }) => block.type === 'text')?.text
        if (!text?.startsWith('{"evaluation"')) continue
        const payload = JSON.parse(text)
        inputs.set(digest(payload.input), payload.input)
      }
    }
    const observations: {
      skill_id: string
      session_id: string
      variant: string
      repetition: number
      input_digest: string
      blocking_failures: string[]
      execution: { passed: boolean; metrics: Record<string, number> } | null
    }[] = []
    for (const [id, evaluation] of Object.entries(original) as [
      string,
      { report: { cases: { lane: string; trace: string }[] } },
    ][]) {
      for (const item of evaluation.report.cases.filter((item) => item.lane === 'planning')) {
        for (const observation of JSON.parse(item.trace)) {
          const input = inputs.get(observation.input_digest)
          assert.ok(input)
          const runtime = {
            harness_commit: 'recorded',
            model_id: 'deepseek-v4-flash',
            model_snapshot: null,
            ...input.workflow_template,
            parameters: {},
          }
          const blocked = observation.timed_out
            ? ['MODEL_TIMEOUT']
            : !observation.submitted
              ? ['NO_RESULT']
              : checkQualityPlan(id, observation.result, runtime, input)
          let execution = null
          if (!blocked.length) {
            const parsed = SkillResult.parse(observation.result)
            if (parsed.status === 'proposed') {
              const compiled = compile(parsed.workflow)
              execution = JSON.parse(
                execFileSync(
                  process.env.DATA_AGENT_TEST_PYTHON ?? 'python3',
                  [join(root, 'services/data-worker/evaluate_plan.py')],
                  {
                    input: JSON.stringify({
                      skill_id: id,
                      input,
                      workflow: compiled.workflow,
                      order: compiled.order,
                    }),
                    encoding: 'utf8',
                    timeout: 15000,
                    maxBuffer: 65536,
                    env: { PATH: '/usr/bin:/bin', POLARS_MAX_THREADS: '1', PYTHONDONTWRITEBYTECODE: '1' },
                  },
                ),
              )
              if (!execution.passed) blocked.push('PLANNING_EXECUTION_FAILED')
            }
          }
          observations.push({
            skill_id: id,
            session_id: observation.session_id,
            variant: observation.variant,
            repetition: observation.repetition,
            input_digest: observation.input_digest,
            blocking_failures: blocked,
            execution,
          })
        }
      }
    }
    const count = (variant: string) =>
      observations.filter((o) => o.variant === variant && !o.blocking_failures.length).length
    const summary = {
      total: observations.length,
      candidate_passes: count('candidate'),
      baseline_passes: count('baseline'),
      executed_plans: observations.filter((o) => o.execution).length,
      execution_failures: observations.filter((o) => o.execution && !o.execution.passed).length,
      release_eligible: false,
    }
    assert.equal(summary.total, 72)
    assert.equal(summary.candidate_passes, 30)
    assert.equal(summary.baseline_passes, 28)
    assert.equal(summary.execution_failures, 0)
    assert.ok(summary.executed_plans > 30)
    const report = {
      local_only: true,
      source: 'skill-quality-real.json',
      mode: 'historical-replay-not-fresh-heldout',
      summary,
      observations,
    }
    if (process.env.DATA_AGENT_WRITE_EXECUTION === '1')
      await writeFile(
        join(root, 'evals/data-agent/t13-executed-quality.json'),
        JSON.stringify(report, null, 2) + '\n',
      )
  },
)
