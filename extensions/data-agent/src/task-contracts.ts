/** Task lineage and explicit execution scopes; historical runs are never rewritten. */
import { z } from 'zod'
import { ArtifactRef, Id, DomainError, type Workflow } from './contracts.ts'
export const Stage=z.enum(['analysis','processing','features'])
export const Scope=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('all')}).strict(),
  z.object({kind:z.literal('through'),node_id:Id}).strict(),
  z.object({kind:z.literal('from'),node_id:Id}).strict(),
])
export const TaskCreate=z.object({name:z.string().min(1).max(256),goal:z.string().min(1).max(4000),dataset:ArtifactRef.extend({kind:z.literal('DatasetRef')}),idempotency_key:Id}).strict()
export const TaskRun=z.object({proposal_id:Id,stage:Stage,previous_run_id:Id.nullable(),source_run_id:Id.nullable(),scope:Scope,reuse:z.boolean(),select:z.boolean(),expected_revision:z.number().int().nonnegative(),idempotency_key:Id}).strict()
export const Rerun=z.object({scope:Scope,reuse:z.boolean(),select:z.boolean(),expected_revision:z.number().int().nonnegative(),idempotency_key:Id}).strict()
export type Scope=z.infer<typeof Scope>
/** Select dependency-complete execution and the nodes explicitly forced by from-node reruns.
 * @param workflow - Compiler-validated graph.
 * @param scope - User-selected execution range.
 * @returns Required nodes and forced recomputation nodes.
 */
export function executionScope(workflow:Workflow,scope:Scope){
  const dependencies=new Map(workflow.nodes.map(node=>[node.id,Object.values(node.inputs).flatMap(ref=>'node_id' in ref?[ref.node_id]:[])]))
  if(scope.kind!=='all'&&!dependencies.has(scope.node_id))throw new DomainError('NODE_NOT_FOUND')
  const selected=new Set<string>(),forced=new Set<string>()
  const ancestors=(id:string)=>{if(selected.has(id))return;selected.add(id);for(const dep of dependencies.get(id)!)ancestors(dep)}
  if(scope.kind==='all')for(const id of dependencies.keys())selected.add(id)
  else if(scope.kind==='through')ancestors(scope.node_id)
  else{
    forced.add(scope.node_id)
    let size=-1
    while(size!==forced.size){size=forced.size;for(const [id,deps] of dependencies)if(deps.some(dep=>forced.has(dep)))forced.add(id)}
    for(const id of forced)ancestors(id)
  }
  return {selected,forced}
}
