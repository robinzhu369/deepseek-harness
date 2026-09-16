/** Immutable Skill package validation; publishing requires separate evaluation and authorization. */
import { z } from 'zod'
import { Id, Digest, ArtifactRef, digest, DomainError } from './contracts.ts'
export const SkillManifest = z.object({
  id:z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), version:z.string().regex(/^\d+\.\d+\.\d+$/),
  description:z.string().min(1).max(1000), input_schema:z.literal('contracts/input.schema.json'),
  output_schema:z.literal('contracts/output.schema.json'), required_tools:z.array(Id),
  operator_dependencies:z.record(Id,z.literal('1')), evaluation_suite:Id,
}).strict()
export const SkillInput=z.object({project_id:Id,dataset:ArtifactRef.extend({kind:z.literal('DatasetRef')}),workflow_revision:z.number().int().nonnegative(),goal:z.string().min(1).max(8000),fit_scope:z.enum(['train','undefined']),policy_version:Id}).strict()
export const SkillResult=z.discriminatedUnion('status',[
  z.object({status:z.literal('proposed'),workflow:z.json(),evidence:z.array(z.object({metric:Id,value:z.number().finite(),scope:z.enum(['full_exact','full_approximate','sample']),report:ArtifactRef}).strict()),needs_confirmation:z.array(z.string())}).strict(),
  z.object({status:z.literal('needs_review'),reasons:z.array(z.string()).min(1)}).strict(),
  z.object({status:z.literal('submitted'),run_id:Id}).strict(),
  z.object({status:z.literal('executed'),artifacts:z.array(ArtifactRef).min(1)}).strict(),
  z.object({status:z.literal('failed'),code:Id}).strict(),
])
export type SkillPackage={manifest:z.infer<typeof SkillManifest>;files:Record<string,string>;digest:string}
/** Validate an already-extracted text package; archive extraction must separately reject links. */
export function validatePackage(raw: unknown, files: Record<string,string>, allowedTools: Set<string>, registeredOperators: Set<string>):SkillPackage {
  if(Object.keys(files).length>64 || Object.values(files).reduce((sum,value)=>sum+Buffer.byteLength(value),0)>4*1024*1024) throw new DomainError('SKILL_RESOURCE_LIMIT')
  const manifest=SkillManifest.parse(raw)
  for(const tool of manifest.required_tools) if(!allowedTools.has(tool)) throw new DomainError('SKILL_TOOL_DENIED')
  for(const operator of Object.keys(manifest.operator_dependencies)) if(!registeredOperators.has(operator)) throw new DomainError('SKILL_OPERATOR_MISSING')
  for(const [path,content] of Object.entries(files)) {
    if(!/^(SKILL\.md|references\/[a-zA-Z0-9_.-]+\.md|contracts\/(input|output)\.schema\.json)$/.test(path)) throw new DomainError('SKILL_RESOURCE_PATH')
    if(Buffer.byteLength(content)>1024*1024) throw new DomainError('SKILL_RESOURCE_LIMIT')
  }
  for(const path of ['SKILL.md',manifest.input_schema,manifest.output_schema]) if(!files[path]) throw new DomainError('SKILL_RESOURCE_MISSING')
  for(const path of [manifest.input_schema,manifest.output_schema]) {
    const schema=JSON.parse(files[path])
    if(schema.$schema!=='https://json-schema.org/draft/2020-12/schema' || !['object',undefined].includes(schema.type)) throw new DomainError('SKILL_SCHEMA')
    const scan=(value:unknown)=>{
      if(!value || typeof value!=='object') return
      for(const [key,item] of Object.entries(value)) {
        if(key==='$ref' && (typeof item!=='string' || !item.startsWith('#'))) throw new DomainError('SKILL_REMOTE_REFERENCE')
        scan(item)
      }
    }
    scan(schema)
  }
  const snapshot=structuredClone({manifest,files})
  return {...snapshot,digest:digest(snapshot)}
}
/** Claiming execution cannot invent published artifact references. */
export async function validateSkillResult(raw: unknown, project: string, lookup: (ref:z.infer<typeof ArtifactRef>)=>Promise<boolean>) {
  const result=SkillResult.parse(raw)
  const refs=result.status==='executed'?result.artifacts:result.status==='proposed'?result.evidence.map(item=>item.report):[]
  for(const ref of refs) if(ref.project_id!==project || !await lookup(ref)) throw new DomainError('SKILL_ARTIFACT_UNAVAILABLE')
  return result
}
export const SkillLock=z.object({id:Id,version:z.string(),digest:Digest,project_id:Id}).strict()
