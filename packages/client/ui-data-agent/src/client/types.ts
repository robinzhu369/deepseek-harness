/** Browser DTOs validate domain JSON before it enters the workbench model. */
import { z } from 'zod'
const Ref = z.object({
  artifact_id: z.string(),
  project_id: z.string(),
  kind: z.string(),
  digest: z.string(),
})
const Input = z.union([Ref, z.object({ node_id: z.string(), output_port: z.string() })])
/** Portable graph without execution authority. */
export const Workflow = z.object({
  schema_version: z.literal('1'),
  project_id: z.string(),
  nodes: z
    .array(
      z.object({
        id: z.string(),
        operator: z.string(),
        operator_version: z.literal('1'),
        params: z.record(z.string(), z.json()),
        inputs: z.record(z.string(), Input),
      }),
    )
    .max(200),
  environment_digest: z.string(),
  policy_version: z.string(),
  seed: z.number(),
  layout: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).optional(),
})
/** Portable graph without execution authority. */
export type Workflow = z.infer<typeof Workflow>
/** Immutable project artifact identity. */
export type ArtifactRef = z.infer<typeof Ref>
/** Bounded session navigation rows. */
export const Sessions = z.array(
  z.object({
    id: z.string(),
    title: z.string(),
    provider: z.string().optional(),
    model_id: z.string().optional(),
    input: z.object({ dataset: Ref, goal: z.string() }).loose(),
    business_task_id: z.string().nullable(),
    status: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  }),
)
/** One owner-scoped session navigation row. */
export type Session = z.infer<typeof Sessions>[number]
/** Operator ports and deployment runtime returned by the domain host. */
export const Registry = z.object({
  role: z.enum(['owner', 'editor', 'viewer']),
  runtime: z.object({ environment_digest: z.string(), policy_version: z.string() }).loose().nullable(),
  operators: z.record(
    z.string(),
    z.object({
      inputs: z.record(z.string(), z.string()),
      outputs: z.record(z.string(), z.string()),
      params: z.record(z.string(), z.json()),
      approval: z.boolean(),
    }),
  ),
})
/** Operator ports and deployment runtime returned by the domain host. */
export type Registry = z.infer<typeof Registry>
/** Authoritative execution snapshot with actual progress and published artifacts. */
export const Run = z.object({
  run_id: z.string(),
  session_id: z.string(),
  status: z.string(),
  paused: z.boolean(),
  cursor: z.string(),
  business_task_id: z.string().nullable(),
  previous_run_id: z.string().nullable(),
  source_run_id: z.string().nullable(),
  stage: z.string().nullable(),
  scope: z.object({ kind: z.string(), node_id: z.string().optional() }),
  nodes: z.array(
    z.object({
      job_id: z.string(),
      node_id: z.string(),
      status: z.string(),
      attempt_no: z.number(),
      progress: z.object({ processed: z.number(), total: z.number().optional() }).nullable(),
      error_code: z.string().nullable(),
      reused_from_job_id: z.string().nullable(),
    }),
  ),
  artifacts: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      digest: z.string(),
      bytes: z.union([z.string(), z.number()]),
      metadata: z.record(z.string(), z.json()),
      output_port: z.string(),
      node_id: z.string(),
    }),
  ),
})
/** Authoritative execution snapshot with actual progress and published artifacts. */
export type Run = z.infer<typeof Run>
/** Digest-bound proposal available for human review. */
export const Proposal = z
  .object({
    id: z.string(),
    workflow_id: z.string(),
    revision: z.number(),
    status: z.string(),
    digest: z.string(),
    body: z
      .object({
        goal: z.string(),
        workflow: Workflow,
        session_id: z.string().nullable(),
        evidence: z.array(z.json()),
        expected_impact: z.array(z.json()),
        unmet_prerequisites: z.array(z.string()),
      })
      .loose(),
  })
  .loose()
/** Digest-bound proposal available for human review. */
export type Proposal = z.infer<typeof Proposal>
/** Session-owned historical Runs and proposals. */
export const Navigation = z.object({
  runs: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      stage: z.string().nullable(),
      created_at: z.string(),
      snapshot: Workflow.loose(),
    }),
  ),
  proposals: z.array(Proposal),
})
/** Session-owned historical Runs and proposals. */
export type Navigation = z.infer<typeof Navigation>
/** Business-task lineage and its optimistic revision. */
export const Task = z.object({
  task_id: z.string(),
  name: z.string(),
  status: z.string(),
  revision: z.number(),
  selected_run_id: z.string().nullable(),
  active_lineage: z.array(z.string()),
  runs: z.array(z.object({ id: z.string(), stage: z.string(), status: z.string() })),
  final_export_refs: z.array(z.json()),
  cursor: z.json(),
})
/** Business-task lineage and its optimistic revision. */
export type Task = z.infer<typeof Task>
/** Cursor page of durable Harness events and separate live activity. */
export const History = z.object({
  session_id: z.string(),
  events: z.array(z.object({ seq: z.number(), type: z.string(), data: z.json() }).loose()),
  cursor: z.number(),
  has_more: z.boolean(),
  activity: z.enum(['working', 'idle']),
})
/** Cursor page of durable Harness events and separate live activity. */
export type History = z.infer<typeof History>
