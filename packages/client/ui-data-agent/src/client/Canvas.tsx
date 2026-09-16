import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
/** Controlled React Flow graph: historical snapshots never receive draft mutations. */
import { useState } from 'react'
import { z } from 'zod'
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type NodeProps,
  type Node,
  type Connection,
} from '@xyflow/react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Surface } from './face.ts'
import { Workflow, type Registry, type Navigation, type Session } from './types.ts'
import { validGraph } from './graph.ts'
import { Action } from './surfaces.tsx'
import css from './workbench.module.css'
type OperatorNode = Node<{ label: string; inputs: string[]; outputs: string[] }, 'operator'>
function Operator({ data }: NodeProps<OperatorNode>) {
  return (
    <div className={css.flowNode}>
      <strong>{data.label}</strong>
      <div className={css.ports}>
        <div>
          {data.inputs.map((port, index) => (
            <div key={port}>
              <Handle type="target" id={port} position={Position.Left} style={{ top: 44 + index * 23 }} />
              {port}
            </div>
          ))}
        </div>
        <div>
          {data.outputs.map((port, index) => (
            <div key={port}>
              {port}
              <Handle type="source" id={port} position={Position.Right} style={{ top: 44 + index * 23 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
const nodeTypes = { operator: Operator }
/** Export portable JSON without embedding approval or execution state. */
export function exportJson(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}
/** Flow editor and parameter form share the right column. */
export function Canvas(
  p: Surface & { run: Navigation['runs'][number] | undefined; registry: Registry | undefined },
) {
  const view = p.useStore(value => value),
    draft = view.canvasModes[view.session] === 'run' ? undefined : view.drafts[view.session],
    workflow = draft?.workflow ?? p.run?.snapshot
  const [operator, setOperator] = useState(''),
    [error, setError] = useState(''),
    [goal, setGoal] = useState(''),
    [template, setTemplate] = useState(''),
    [evidence, setEvidence] = useState(JSON.stringify(draft?.evidence ?? [], null, 2))
  const writable = !!draft && p.registry?.role !== 'viewer',
    base = '/v1/data/' + view.project
  const update = (next: Workflow) => {
    if (!draft || !writable) return
    if (p.registry && !validGraph(next, p.registry)) {
      setError(p.t('invalidGraph'))
      return
    }
    setError('')
    p.actions.draft(view.session, { ...draft, workflow: next })
  }
  const create = (flow: Workflow) => {
    if (flow.project_id !== view.project) throw new Error('PROJECT_MISMATCH')
    if (p.registry && !validGraph(flow, p.registry)) throw new Error('INVALID_GRAPH')
    p.actions.draft(view.session, {
      workflow: flow,
      workflowId: randomUUID(),
      revision: 0,
      selectedNode: null,
    })
  }
  const connect = (connection: Connection) => {
    if (!workflow || !connection.sourceHandle || !connection.targetHandle) return
    const { sourceHandle, targetHandle } = connection
    update({
      ...workflow,
      nodes: workflow.nodes.map(node =>
        node.id === connection.target
          ? {
            ...node,
            inputs: {
              ...node.inputs,
              [targetHandle]: { node_id: connection.source, output_port: sourceHandle },
            },
          }
          : node,
      ),
    })
  }
  const selected = draft?.workflow.nodes.find(node => node.id === draft.selectedNode)
  return (
    <div className={css.canvasPanel}>
      <SkillStages {...p} />
      {!draft && view.drafts[view.session] && (
        <Button
          onClick={() => {
            const saved = view.drafts[view.session]
            if (saved) p.actions.draft(view.session, saved)
          }}
        >
          {p.t('returnDraft')}
        </Button>
      )}
      <small>{p.t(draft ? 'dirty' : 'immutable')}</small>
      <div className={css.row}>
        <Button
          disabled={!view.session || !p.registry?.runtime}
          onClick={() => {
            if (!p.registry?.runtime) return
            create({
              schema_version: '1',
              project_id: view.project,
              nodes: [],
              environment_digest: p.registry.runtime.environment_digest,
              policy_version: p.registry.runtime.policy_version,
              seed: 0,
            })
          }}
        >
          {p.t('blankDraft')}
        </Button>
        <Button
          disabled={!p.run}
          onClick={() => {
            if (p.run) create(Workflow.parse(p.run.snapshot))
          }}
        >
          {p.t('copyDraft')}
        </Button>
      </div>
      <div className={css.row}>
        <label className={css.file}>
          {p.t('importFlow')}
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file)
                void file
                  .text()
                  .then((text) => {
                    create(Workflow.parse(JSON.parse(text)))
                  })
                  .catch((value: unknown) => {
                    setError(value instanceof Error ? value.message : 'INVALID_JSON')
                  })
            }}
          />
        </label>
        <Button
          disabled={!workflow}
          onClick={() => {
            exportJson(workflow, 'workflow.json')
          }}
        >
          {p.t('exportFlow')}
        </Button>
      </div>
      {error && (
        <p role="alert" className={css.error}>
          {error}
        </p>
      )}
      {workflow ? (
        <>
          <div className={css.canvas} data-testid="workflow-canvas">
            <ReactFlow<OperatorNode>
              nodeTypes={nodeTypes}
              nodes={workflow.nodes.map((node, index) => ({
                id: node.id,
                type: 'operator',
                position: workflow.layout?.[node.id] ?? {
                  x: (index % 2) * 260,
                  y: Math.floor(index / 2) * 155,
                },
                data: {
                  label: node.id + ' · ' + node.operator,
                  inputs: Object.keys(p.registry?.operators[node.operator]?.inputs ?? {}),
                  outputs: Object.keys(p.registry?.operators[node.operator]?.outputs ?? {}),
                },
              }))}
              edges={workflow.nodes.flatMap(node =>
                Object.entries(node.inputs).flatMap(([port, input]) =>
                  'node_id' in input
                    ? [
                      {
                        id: node.id + ':' + port,
                        source: input.node_id,
                        sourceHandle: input.output_port,
                        target: node.id,
                        targetHandle: port,
                      },
                    ]
                    : [],
                ),
              )}
              nodesDraggable={writable}
              nodesConnectable={writable}
              edgesReconnectable={false}
              deleteKeyCode={null}
              onConnect={connect}
              onNodeClick={(_event, node) => {
                if (draft) p.actions.draft(view.session, { ...draft, selectedNode: node.id })
              }}
              onNodesChange={(changes) => {
                if (!writable) return
                const positions = changes.flatMap(change =>
                  change.type === 'position' && change.position
                    ? [[change.id, change.position] as const]
                    : [],
                )
                if (positions.length)
                  update({ ...workflow, layout: { ...workflow.layout, ...Object.fromEntries(positions) } })
              }}
              onNodeDragStop={(_event, node) => {
                update({ ...workflow, layout: { ...workflow.layout, [node.id]: node.position } })
              }}
              onEdgeClick={(_event, edge) => {
                if (!writable) return
                const next = structuredClone(workflow)
                const target = next.nodes.find(node => node.id === edge.target)
                if (target && edge.targetHandle)
                  target.inputs = Object.fromEntries(
                    Object.entries(target.inputs).filter(([port]) => port !== edge.targetHandle),
                  )
                update(next)
              }}
              fitViewOptions={{ maxZoom: 1 }}
              fitView
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          {writable && (
            <>
              <div className={css.row}>
                <select
                  aria-label={p.t('operator')}
                  value={operator}
                  onChange={(event) => {
                    setOperator(event.target.value)
                  }}
                >
                  <option value="">{p.t('choose')}</option>
                  {Object.keys(p.registry?.operators ?? {}).map(id => (
                    <option key={id}>{id}</option>
                  ))}
                </select>
                <Button
                  disabled={!operator}
                  onClick={() => {
                    update({
                      ...workflow,
                      nodes: [
                        ...workflow.nodes,
                        {
                          id: operator + '-' + randomUUID().slice(0, 8),
                          operator,
                          operator_version: '1',
                          params: {},
                          inputs: {},
                        },
                      ],
                    })
                  }}
                >
                  {p.t('addNode')}
                </Button>
              </div>
              {selected && (
                <NodeEditor
                  key={selected.id + ':' + draft.workflowId}
                  {...p}
                  node={selected}
                  save={(node) => {
                    update({
                      ...workflow,
                      nodes: workflow.nodes.map(value => (value.id === node.id ? node : value)),
                    })
                  }}
                  remove={() => {
                    update({
                      ...workflow,
                      nodes: workflow.nodes
                        .filter(value => value.id !== selected.id)
                        .map(value => ({
                          ...value,
                          inputs: Object.fromEntries(
                            Object.entries(value.inputs).filter(
                              ([, input]) => !('node_id' in input) || input.node_id !== selected.id,
                            ),
                          ),
                        })),
                    })
                  }}
                />
              )}
              <div className={css.row}>
                <Action
                  t={p.t}
                  run={async () => {
                    const result = await p.command(base + '/workflows/' + draft.workflowId, {
                      expected_revision: draft.revision,
                      workflow,
                    })
                    const parsed = z.object({ revision: z.number() }).parse(result)
                    p.actions.draft(view.session, { ...draft, revision: parsed.revision })
                  }}
                >
                  {p.t('save')}
                </Action>
                <small>
                  {p.t('revision')}: {draft.revision}
                </small>
              </div>
              <Input
                aria-label={p.t('goal')}
                placeholder={p.t('goal')}
                value={goal}
                onChange={(event) => {
                  setGoal(event.target.value)
                }}
              />
              <label>
                {p.t('proposalEvidence')}
                <textarea
                  value={evidence}
                  onChange={(event) => {
                    setEvidence(event.target.value)
                  }}
                />
              </label>
              <small>{p.t('evidenceNote')}</small>
              <Action
                t={p.t}
                disabled={!goal.trim()}
                run={async () => {
                  await p.command(base + '/proposals', {
                    workflow_id: draft.workflowId,
                    expected_revision: draft.revision,
                    session_id: view.session,
                    goal,
                    workflow,
                    evidence: z.array(z.json()).parse(JSON.parse(evidence)),
                    expected_impact: workflow.nodes.map(node => ({
                      node_id: node.id,
                      description: goal,
                      basis: 'unknown',
                    })),
                    unmet_prerequisites: [],
                  })
                  const saved = await p.read(base + '/workflows/' + draft.workflowId)

                  p.actions.draft(view.session, {
                    ...draft,
                    revision: z.object({ revision: z.number() }).parse(saved).revision,
                  })
                  await p.refresh()
                }}
              >
                {p.t('propose')}
              </Action>
              <Input
                aria-label={p.t('templateName')}
                placeholder={p.t('templateName')}
                value={template}
                onChange={(event) => {
                  setTemplate(event.target.value)
                }}
              />
              <Action
                t={p.t}
                disabled={!template.trim()}
                run={() =>
                  p.command(base + '/templates/' + randomUUID(), {
                    name: template,
                    expected_revision: 0,
                    workflow,
                  })
                }
              >
                {p.t('saveTemplate')}
              </Action>
            </>
          )}
        </>
      ) : (
        <div className={css.empty}>{p.t('noDraft')}</div>
      )}
    </div>
  )
}
function NodeEditor(
  p: Surface & {
    node: Workflow['nodes'][number]
    save: (node: Workflow['nodes'][number]) => void
    remove: () => void
  },
) {
  const [params, setParams] = useState(JSON.stringify(p.node.params, null, 2)),
    [inputs, setInputs] = useState(JSON.stringify(p.node.inputs, null, 2)),
    [error, setError] = useState('')
  return (
    <section className={css.card}>
      <strong>{p.node.id}</strong>
      <small>{p.t('nodeParametersHint')}</small>
      <label>
        {p.t('parameters')}
        <textarea
          value={params}
          onChange={(event) => {
            setParams(event.target.value)
          }}
        />
      </label>
      <label>
        {p.t('inputs')}
        <textarea
          value={inputs}
          onChange={(event) => {
            setInputs(event.target.value)
          }}
        />
      </label>
      <Button
        onClick={() => {
          try {
            p.save(
              Workflow.shape.nodes.element.parse({
                ...p.node,
                params: z.json().parse(JSON.parse(params)),
                inputs: z.json().parse(JSON.parse(inputs)),
              }),
            )
            setError('')
          } catch (value) {
            setError(value instanceof Error ? value.message : 'INVALID_JSON')
          }
        }}
      >
        {p.t('save')}
      </Button>
      <Button onClick={p.remove}>{p.t('deleteNode')}</Button>
      {error && (
        <small role="alert" className={css.error}>
          {error}
        </small>
      )}
    </section>
  )
}

function SkillStages(p: Surface) {
  const view = p.useStore(value => value),
    domain = p.useDomain(value => value),
    base = '/v1/data/' + view.project
  const rows = z
    .array(
      z.object({
        id: z.string(),
        default_version: z.string().nullable(),
        status: z.string().nullable(),
        evaluation: z.object({ version: z.string(), status: z.string() }).nullable(),
      }),
    )
    .parse(domain.cache[base + '/skills'] ?? [])
  const ids = [
    ...new Set(['data-analysis', 'data-cleaning', 'feature-engineering', ...rows.map(row => row.id)]),
  ]
  return (
    <details className={css.card}>
      <summary>{p.t('skillStages')}</summary>
      <p>{p.t('skillStageNote')}</p>
      {ids.map(id => (
        <SkillStage
          key={id}
          {...p}
          id={id}
          version={rows.find(row => row.id === id)?.default_version ?? null}
          status={rows.find(row => row.id === id)?.status ?? null}
          evaluation={rows.find(row => row.id === id)?.evaluation ?? null}
        />
      ))}
    </details>
  )
}
function SkillStage(
  p: Surface & {
    id: string
    version: string | null
    status: string | null
    evaluation: { version: string; status: string } | null
  },
) {
  const view = p.useStore(value => value),
    domain = p.useDomain(value => value),
    base = '/v1/data/' + view.project
  const session = ((domain.cache[base + '/sessions'] ?? []) as Session[]).find(
    row => row.id === view.session,
  )
  const [version, setVersion] = useState('')
  return (
    <section className={css.card}>
      <strong>{p.id}</strong>
      <small>
        {p.version ?? p.t('noReleased')} · {p.status ?? '—'}
      </small>
      <small>
        {p.t('evaluation')}: {p.evaluation ? `${p.evaluation.version} · ${p.evaluation.status}` : '—'}
      </small>
      <Input
        aria-label={p.t('version') + ' ' + p.id}
        placeholder={p.version ?? p.t('version')}
        value={version}
        onChange={(event) => {
          setVersion(event.target.value)
        }}
      />
      <Action
        t={p.t}
        disabled={!session || !(version || p.version)}
        run={async () => {
          if (!session) throw new Error('SESSION_REQUIRED')
          const created = z.object({ session_id: z.string() }).parse(
            await p.command(base + '/sessions', {
              business_task_id: session.business_task_id,
              input: { ...session.input, workflow_revision: 0 },
              skills: [{ id: p.id, version: version || p.version }],
            }),
          )
          p.actions.session(created.session_id)
          await p.refresh()
          await p.command(base + '/sessions/' + created.session_id + '/messages', {
            text: p.t('skillPlanPrompt') + ' ' + p.id,
          })
          await p.refresh()
        }}
      >
        {p.t('planSkill')}
      </Action>
    </section>
  )
}
