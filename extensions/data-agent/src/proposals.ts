/** Persisted, reviewable proposal envelope shared by conversation and product clients. */
import { z } from 'zod'
import { ArtifactRef, Digest, Id, Workflow, DomainError } from './contracts.ts'
const text=z.string().min(1).max(4000)
/** Metrics are attributed to published evidence; estimates must identify their sample scope. */
export const PlanProposal=z.object({
  workflow_id:Id, expected_revision:z.number().int().nonnegative(), session_id:Id.nullable(),
  goal:text, workflow:Workflow,
  evidence:z.array(z.object({ref:ArtifactRef,inputs:z.array(ArtifactRef).min(1),scope:z.enum(['sample','full']),description:text}).strict()).max(200),
  expected_impact:z.array(z.object({node_id:Id,description:text,basis:z.enum(['sample','full','unknown'])}).strict()).max(200),
  unmet_prerequisites:z.array(text).max(100),
}).strict()
/** Human decisions bind the complete envelope, including its immutable workflow and evidence. */
export const ProposalDecision=z.discriminatedUnion('action',[
  z.object({action:z.literal('approve'),digest:Digest,max_removed_fraction:z.number().min(0).max(1),reason:text}).strict(),
  z.object({action:z.literal('reject'),digest:Digest,reason:text}).strict(),
])

/** Reject changes to known protected fields before saving a draft; the Worker also checks actual data.
 * @param workflow - Compiled workflow with validated operator parameters.
 * @param order - Compiler-produced topological order.
 * @param inputRoles - Published dataset roles keyed by artifact ID.
 */
export function validateProposalRoles(workflow:z.infer<typeof Workflow>,order:string[],inputRoles:Map<string,Record<string,string>>) {
  const rolesByNode=new Map<string,Record<string,string>>()
  for(const id of order){
    const node=workflow.nodes.find(node=>node.id===id)!,input=node.inputs.data??node.inputs.train
    const roles={...(input?('artifact_id' in input?inputRoles.get(input.artifact_id):rolesByNode.get(input.node_id)):undefined)}
    const requireFeature=(column:string,allowTime=false)=>{
      if(Object.hasOwn(roles,column)&&roles[column]!=='feature'&&!(allowTime&&['event_time','prediction_time'].includes(roles[column])))throw new DomainError('PROTECTED_FIELD')
    }
    if(['replace_missing','cast_numeric','fill_constant','normalize','fit'].includes(node.operator))for(const column of node.params.columns as string[])requireFeature(column)
    if(['map_categories','bounds'].includes(node.operator))requireFeature(node.params.column as string)
    if(node.operator==='derive'){
      requireFeature(node.params.left as string,['year','month','day','weekday','days_since'].includes(node.params.method as string))
      if(typeof node.params.right==='string')requireFeature(node.params.right)
    }
    if(node.operator==='derive'||node.operator==='bounds'&&node.params.action==='flag'){
      const output=node.params.output as string
      if(Object.hasOwn(roles,output)||output.startsWith('__'))throw new DomainError('FEATURE_COLLISION')
      roles[output]='feature'
    }
    if(node.operator==='select'){
      const columns=node.params.columns as string[]
      if(Object.entries(roles).some(([name,role])=>['target','entity_id','record_id','event_time','prediction_time'].includes(role)&&!columns.includes(name)))throw new DomainError('PROTECTED_FIELD')
      for(const name of Object.keys(roles))if(!columns.includes(name))delete roles[name]
    }
    if(node.operator==='import')Object.assign(roles,node.params.roles)
    rolesByNode.set(id,roles)
  }
}
