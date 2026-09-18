/** Shared JSON validation for persisted workflows and worker messages. */
import { createHash } from 'node:crypto'
import { z } from 'zod'

export const Id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/)
export const Digest = z.string().regex(/^[a-f0-9]{64}$/)
export const ArtifactKind = z.enum(['RawFileRef', 'DatasetRef', 'TransformerRef', 'ReportRef', 'SplitMapRef', 'ExportRef'])
export const ArtifactRef = z.object({ kind: ArtifactKind, project_id: Id, artifact_id: Id, digest: Digest }).strict()
export const InputRef = z.union([
  ArtifactRef,
  z.object({ node_id: Id, output_port: Id }).strict(),
])
export const Node = z.object({
  id: Id,
  operator: Id,
  operator_version: z.literal('1'),
  params: z.record(z.string(), z.json()),
  inputs: z.record(Id, InputRef),
}).strict()
export const Workflow = z.object({
  schema_version: z.literal('1'),
  project_id: Id,
  nodes: z.array(Node).min(1).max(200),
  policy_version: Id,
  seed: z.number().int().nonnegative(),
  environment_digest: Digest,
  layout: z.record(Id, z.object({ x: z.number().finite(), y: z.number().finite() })).optional(),
}).strict()
export type Workflow = z.infer<typeof Workflow>
export type Node = z.infer<typeof Node>
export type ArtifactRef = z.infer<typeof ArtifactRef>
export type PortKind = z.infer<typeof ArtifactKind>
export type Operator = { inputs: Record<string, PortKind>; outputs: Record<string, PortKind>; params: z.ZodType; approval: boolean }
const Column = z.string().min(1).max(256)
/** Input parse options validated identically by the host and Python importer. */
export const ImportOptions=z.union([
  z.object({format:z.literal('parquet')}).strict(),
  z.object({
    format:z.literal('csv'),encoding:z.enum(['utf-8','utf-8-sig','gb18030','utf-16','utf-16-le','utf-16-be']).optional(),
    delimiter:z.string().length(1).optional(),has_header:z.boolean().optional(),columns:z.array(Column).min(1).optional(),
    null_values:z.array(z.string()).optional(),bad_rows:z.enum(['error','quarantine']).optional(),
    types:z.record(Column,z.union([
      z.enum(['string','int64','float64','date','boolean']),
      z.object({type:z.literal('decimal'),precision:z.number().int().min(1).max(28),scale:z.number().int().min(0).max(28),rounding:z.enum(['half_even','half_up','down'])}).strict(),
      z.object({type:z.literal('datetime'),format:z.string().min(1),timezone:z.string().min(1)}).strict(),
    ])).optional(),
  }).strict(),
])

const columns = z.array(Column).min(1)
const empty = z.object({}).strict()
const scalar = z.union([z.string(), z.number().finite(), z.boolean()])
const stateless = (params: z.ZodType, removes = false): Operator => ({
  inputs: { data: 'DatasetRef' },
  outputs: removes ? { data: 'DatasetRef', report: 'ReportRef', removed: 'SplitMapRef' } : { data: 'DatasetRef', report: 'ReportRef' },
  params, approval: true,
})
/** Closed registry: a Skill cannot grant arbitrary code execution. */
export const operators: Record<string, Operator> = {
  import: {inputs:{file:'RawFileRef'},outputs:{data:'DatasetRef',report:'ReportRef'},approval:false,
    params:z.object({options:ImportOptions.refine(o=>o.format!=='csv' || o.bad_rows!=='quarantine','Quarantine requires a separate confirmed import'),roles:z.record(Column,z.enum(['feature','target','entity_id','record_id','event_time','prediction_time','ignore'])),max_bytes:z.number().int().positive()}).strict()},
  preview: {inputs:{data:'DatasetRef'},outputs:{report:'ReportRef'},approval:false,
    params:z.object({offset:z.number().int().nonnegative(),limit:z.number().int().min(1).max(200),columns:z.array(Column).min(1).max(100)}).strict()},
  replace_missing: stateless(z.object({columns,tokens:z.array(z.string()).min(1).max(100)}).strict()),
  cast_numeric: stateless(z.object({columns,dtype:z.enum(['Int64','Float64'])}).strict()),
  fill_constant: stateless(z.object({ columns, value: scalar }).strict()),
  normalize: stateless(z.object({ columns, trim: z.boolean(), case: z.enum(['preserve','lower','upper']) }).strict()),
  map_categories: stateless(z.object({ column: Column, mapping: z.record(z.string(),z.string()), unmatched:z.enum(['preserve','unknown']),unknown_value:z.string() }).strict()),
  deduplicate: stateless(z.object({keys:columns,order_by:z.array(Column),descending:z.boolean(),keep:z.enum(['first','last'])}).strict(),true),
  filter_rows: stateless(z.object({condition:z.union([
    z.object({column:Column,comparison:z.enum(['is_null','is_not_null'])}).strict(),
    z.object({column:Column,comparison:z.enum(['eq','ne','gt','gte','lt','lte']),value:scalar}).strict(),
  ]),keep_null:z.boolean()}).strict(),true),
  bounds: stateless(z.discriminatedUnion('action',[
    z.object({column:Column,lower:z.number().finite(),upper:z.number().finite(),action:z.literal('clip')}).strict(),
    z.object({column:Column,lower:z.number().finite(),upper:z.number().finite(),action:z.literal('flag'),output:Column}).strict(),
  ])),
  derive: stateless(z.union([
    z.object({left:Column,output:Column,method:z.enum(['missing','year','month','day','weekday'])}).strict(),
    z.object({left:Column,output:Column,method:z.literal('days_since'),reference_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).strict(),
    z.object({left:Column,output:Column,method:z.literal('log1p'),invalid:z.enum(['error','null'])}).strict(),
    z.object({left:Column,right:Column,output:Column,method:z.enum(['add','subtract','multiply','divide']),invalid:z.enum(['error','null'])}).strict(),
  ])),
  inspect: { inputs: { data: 'DatasetRef' }, outputs: { report: 'ReportRef' }, params: empty, approval: false },
  split: { inputs: { data: 'DatasetRef' }, outputs: { train: 'DatasetRef', validation: 'DatasetRef', test: 'DatasetRef', mapping: 'SplitMapRef' }, params: z.object({ method: z.enum(['random', 'entity', 'time', 'stratified']), column: Column.optional(), train_fraction: z.number().gt(0).lt(1), validation_fraction: z.number().gte(0).lt(1), boundaries: z.array(z.string()).length(2).optional() }).strict(), approval: true },
  fit: { inputs: { train: 'DatasetRef' }, outputs: { transformer: 'TransformerRef' }, params: z.object({ method: z.enum(['mean', 'median', 'mode', 'quantile_clip', 'standard', 'minmax', 'onehot']), columns, fit_scope: z.literal('train'), max_categories: z.number().int().positive(), unknown: z.enum(['ignore', 'error']),lower_quantile:z.number().min(0).max(1).optional(),upper_quantile:z.number().min(0).max(1).optional() }).strict(), approval: true },
  transform: { inputs: { data: 'DatasetRef', transformer: 'TransformerRef' }, outputs: { data: 'DatasetRef' }, params: empty, approval: false },
  select: { inputs: { data: 'DatasetRef' }, outputs: { data: 'DatasetRef', report: 'ReportRef' }, params: z.object({ columns }).strict(), approval: true },
  export: {inputs:{train:'DatasetRef',validation:'DatasetRef',test:'DatasetRef'},outputs:{bundle:'ExportRef',report:'ReportRef'},params:z.object({feature_columns:columns,target:Column.optional(),allow_null:z.boolean(),purpose:z.enum(['supervised','unsupervised','inference'])}).strict(),approval:false},
  quality: { inputs: { data: 'DatasetRef' }, outputs: { report: 'ReportRef' }, params: z.object({ feature_columns: columns, target: Column.optional(), allow_null: z.boolean(), purpose: z.enum(['supervised', 'unsupervised', 'inference']) }).strict(), approval: false },
}
export class DomainError extends Error {
  constructor(public code: string, message: string = code) { super(message) }
}
/** Canonical identity ignores JSON key insertion order, never array order. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const result = JSON.stringify(value)
    if (result === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new DomainError('INVALID_JSON')
    return result
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  const object = value as Record<string, unknown>
  return '{' + Object.keys(object).sort().map(key => JSON.stringify(key) + ':' + canonical(object[key])).join(',') + '}'
}
export function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex') }
/** Validate references and return deterministic topological order. */
export function compile(raw: unknown): { workflow: Workflow; order: string[]; digest: string } {
  const workflow = Workflow.parse(raw)
  const nodes = new Map(workflow.nodes.map(node => [node.id, node]))
  if (nodes.size !== workflow.nodes.length) throw new DomainError('DUPLICATE_NODE')
  for (const node of workflow.nodes) {
    const spec = operators[node.operator]
    if (!spec) throw new DomainError('UNSUPPORTED_OPERATOR')
    spec.params.parse(node.params)
    if (node.operator === 'fit' && node.params.method === 'quantile_clip') {
      const lower=node.params.lower_quantile,upper=node.params.upper_quantile
      if(typeof lower!=='number' || typeof upper!=='number' || lower>=upper) throw new DomainError('QUANTILE_RANGE')
    }
    if (node.operator === 'split') {
      const p = node.params
      if (Number(p.train_fraction) + Number(p.validation_fraction) >= 1) throw new DomainError('INVALID_SPLIT')
      if ((p.method === 'entity' || p.method === 'time' || p.method === 'stratified') && !p.column) throw new DomainError('INVALID_SPLIT')
      if (p.method === 'time' && (!Array.isArray(p.boundaries) || String(p.boundaries[0]) >= String(p.boundaries[1]))) throw new DomainError('INVALID_SPLIT')
    }
    if (canonical(Object.keys(spec.inputs).sort()) !== canonical(Object.keys(node.inputs).sort())) throw new DomainError('INPUT_PORTS')
    for (const [port, ref] of Object.entries(node.inputs)) {
      if ('artifact_id' in ref) {
        if (ref.project_id !== workflow.project_id) throw new DomainError('FORBIDDEN')
        if (ref.kind !== spec.inputs[port]) throw new DomainError('PORT_TYPE')
      } else {
        const source = nodes.get(ref.node_id)
        if (!source) throw new DomainError('DANGLING_INPUT')
        if (operators[source.operator]?.outputs[ref.output_port] !== spec.inputs[port]) throw new DomainError('PORT_TYPE')
        if (node.operator === 'fit' && (source.operator !== 'split' || ref.output_port !== 'train')) {
          // Transformed train inputs are permitted only when their data ancestry is train.
          const seen = new Set<string>()
          function isTrain(input: z.infer<typeof InputRef>): boolean {
            if (!('node_id' in input) || seen.has(input.node_id)) return false
            seen.add(input.node_id)
            const parent = nodes.get(input.node_id)
            if (parent?.operator === 'split') return input.output_port === 'train'
            return parent?.operator === 'transform' && input.output_port === 'data' && isTrain(parent.inputs.data)
          }
          if (!isTrain(ref)) throw new DomainError('FIT_SCOPE')
        }
      }
    }
  }
  const order: string[] = []
  const active = new Set<string>()
  const done = new Set<string>()
  function visit(id: string) {
    if (active.has(id)) throw new DomainError('CYCLE')
    if (done.has(id)) return
    active.add(id)
    for (const ref of Object.values(nodes.get(id)!.inputs)) if ('node_id' in ref) visit(ref.node_id)
    active.delete(id); done.add(id); order.push(id)
  }
  for (const id of [...nodes.keys()].sort()) visit(id)
  const { layout: _layout, ...semantic } = workflow
  return { workflow, order, digest: digest({ ...semantic, nodes: [...workflow.nodes].sort((a, b) => a.id.localeCompare(b.id)) }) }
}
/** Changed nodes and all descendants require fresh execution; layout is excluded. */
export function affected(before: Workflow, after: Workflow): string[] {
  compile(before); compile(after)
  const old = new Map(before.nodes.map(node => [node.id, digest(node)]))
  const global = before.environment_digest !== after.environment_digest || before.policy_version !== after.policy_version || before.seed !== after.seed
  const changed = new Set(after.nodes.filter(node => global || old.get(node.id) !== digest(node)).map(node => node.id))
  let size = -1
  while (size !== changed.size) {
    size = changed.size
    for (const node of after.nodes) if (Object.values(node.inputs).some(ref => 'node_id' in ref && changed.has(ref.node_id))) changed.add(node.id)
  }
  return [...changed].sort()
}
export const Manifest = z.object({
  outputs: z.record(Id, z.object({ kind: ArtifactKind, object_key: z.string().min(1).max(1024), digest: Digest, bytes: z.number().int().nonnegative(), metadata: z.record(z.string(), z.json()) }).strict()),
  impact: z.object({ removed_fraction: z.number().min(0).max(1) }).strict(),
}).strict()
export type Manifest = z.infer<typeof Manifest>
