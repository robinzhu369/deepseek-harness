/** Immutable candidates, controlled evaluations, releases and per-invocation Skill locks. */
import { randomUUID } from 'node:crypto'
import type { Pool,PoolClient } from 'pg'
import { z } from 'zod'
import { Repository,type Actor } from './repository.ts'
import { digest,DomainError,operators } from './contracts.ts'
import { validatePackage,SkillInput,type SkillPackage } from './skill-contracts.ts'
const version=z.string().regex(/^\d+\.\d+\.\d+$/)
const EvaluationReport=z.object({
  cases:z.array(z.object({id:z.string().min(1),group:z.enum(['development','regression','holdout']),lane:z.enum(['planning','frozen']),passed:z.boolean(),blocking_failures:z.array(z.string()),metrics:z.record(z.string(),z.number().finite()),trace:z.string().min(1)}).strict()).min(1),
  suitability:z.string().min(1),limitations:z.array(z.string()),cost:z.number().nonnegative().nullable(),duration_ms:z.number().nonnegative(),
}).strict()
export type EvaluationReport=z.infer<typeof EvaluationReport>
export type EvaluationSuite={digest:string;release_eligible?:boolean;cases:{id:string;group:'development'|'regression'|'holdout';lane:'planning'|'frozen'}[]}
/** Frozen deployment metadata attached to evaluations and invocations. */
export const SkillRuntimeSchema=z.object({harness_commit:z.string().min(1),model_id:z.string().min(1),model_snapshot:z.string().nullable(),environment_digest:z.string().regex(/^[a-f0-9]{64}$/),policy_version:z.string().min(1),parameters:z.record(z.string(),z.unknown())}).strict()
export type SkillRuntime=z.infer<typeof SkillRuntimeSchema>
/** Only a server-owned runner can produce publishable evidence; never supplied by HTTP callers. */
export type Evaluator=(snapshot:SkillPackage,suite:EvaluationSuite,runtime:SkillRuntime)=>Promise<EvaluationReport>
export class Skills extends Repository {
  constructor(pool:Pool,readonly allowedTools:Set<string>,readonly suites:Record<string,EvaluationSuite>,readonly runtime:SkillRuntime|null,readonly evaluator?:Evaluator){super(pool);this.allowedTools=new Set(allowedTools);this.suites=structuredClone(suites);this.runtime=structuredClone(runtime)}
  private async mutation(db:PoolClient,actor:Actor,release=false){await this.authorize(db,actor,release?'release':'write');await db.query('SELECT id FROM data_agent.projects WHERE id=$1 FOR UPDATE',[actor.project_id])}
  async draft(actor:Actor,id:string,expected:number,raw:unknown) {
    const value=z.object({manifest:z.unknown(),files:z.record(z.string(),z.string())}).strict().parse(raw)
    const snapshot=validatePackage(value.manifest,value.files,this.allowedTools,new Set(Object.keys(operators)))
    if(snapshot.manifest.id!==id) throw new DomainError('SKILL_ID')
    return this.tx(async db=>{
      await this.mutation(db,actor)
      const previous=(await db.query('SELECT revision FROM data_agent.skill_definitions WHERE project_id=$1 AND id=$2',[actor.project_id,id])).rows[0]
      if((previous?.revision??0)!==expected) throw new DomainError('VERSION_CONFLICT')
      await db.query('INSERT INTO data_agent.skill_definitions(project_id,id,revision,draft) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,id) DO UPDATE SET revision=$3,draft=$4',[actor.project_id,id,expected+1,snapshot])
      await this.audit(db,actor,'skill.draft',{id,revision:expected+1});return {revision:expected+1,digest:snapshot.digest}
    })
  }
  async candidate(actor:Actor,id:string,expected:number,reason:string,parent:string|null) {
    z.string().min(1).max(4000).parse(reason);if(parent)version.parse(parent)
    return this.tx(async db=>{
      await this.mutation(db,actor)
      const definition=(await db.query('SELECT * FROM data_agent.skill_definitions WHERE project_id=$1 AND id=$2',[actor.project_id,id])).rows[0]
      if(!definition || definition.revision!==expected) throw new DomainError('VERSION_CONFLICT')
      const snapshot=definition.draft as SkillPackage
      if(parent && !(await db.query('SELECT 1 FROM data_agent.skill_versions WHERE project_id=$1 AND skill_id=$2 AND version=$3',[actor.project_id,id,parent])).rowCount) throw new DomainError('PARENT_VERSION')
      const prior=(await db.query('SELECT * FROM data_agent.skill_versions WHERE project_id=$1 AND skill_id=$2 AND version=$3',[actor.project_id,id,snapshot.manifest.version])).rows[0]
      if(prior){if(prior.digest!==snapshot.digest)throw new DomainError('VERSION_IMMUTABLE');return prior}
      const row=(await db.query("INSERT INTO data_agent.skill_versions(project_id,skill_id,version,digest,snapshot,status,parent_version,reason,actor_id) VALUES($1,$2,$3,$4,$5,'candidate',$6,$7,$8) RETURNING *",[actor.project_id,id,snapshot.manifest.version,snapshot.digest,snapshot,parent,reason,actor.actor_id])).rows[0]
      await this.audit(db,actor,'skill.candidate',{id,version:row.version,digest:row.digest});return row
    })
  }
  async evaluate(actor:Actor,id:string,v:string) {
    if(!this.evaluator || !this.runtime) throw new DomainError('EVALUATOR_UNCONFIGURED')
    const plan=await this.tx(async db=>{
      await this.mutation(db,actor)
      const row=(await db.query("SELECT * FROM data_agent.skill_versions WHERE project_id=$1 AND skill_id=$2 AND version=$3 AND status='candidate'",[actor.project_id,id,v])).rows[0]
      if(!row) throw new DomainError('CANDIDATE_REQUIRED')
      const suite=this.suites[(row.snapshot as SkillPackage).manifest.evaluation_suite]
      if(!suite || !suite.cases.some(c=>c.group==='holdout') || !suite.cases.some(c=>c.group==='regression') || !suite.cases.some(c=>c.lane==='planning') || !suite.cases.some(c=>c.lane==='frozen') || new Set(suite.cases.map(c=>c.id)).size!==suite.cases.length) throw new DomainError('EVALUATION_SUITE')
      const evaluationId=randomUUID()
      await db.query("INSERT INTO data_agent.skill_evaluations(id,project_id,skill_id,version,digest,suite_digest,runtime_digest,status) VALUES($1,$2,$3,$4,$5,$6,$7,'running')",[evaluationId,actor.project_id,id,v,row.digest,suite.digest,digest(this.runtime)])
      return {row,suite,evaluationId}
    })
    try {
      const report=EvaluationReport.parse(await this.evaluator(structuredClone(plan.row.snapshot),structuredClone(plan.suite),structuredClone(this.runtime)))
      const cases=new Map(report.cases.map(c=>[c.id,c]))
      const passed=cases.size===report.cases.length && cases.size===plan.suite.cases.length && plan.suite.cases.every(expected=>{
        const actual=cases.get(expected.id);return actual?.passed && actual.group===expected.group && actual.lane===expected.lane && !actual.blocking_failures.length
      })
      await this.tx(async db=>{await this.authorize(db,actor,'write');await db.query('UPDATE data_agent.skill_evaluations SET status=$2,report=$3 WHERE id=$1',[plan.evaluationId,passed?'passed':'failed',report]);await this.audit(db,actor,'skill.evaluate',{evaluation_id:plan.evaluationId,passed})})
      return {id:plan.evaluationId,status:passed?'passed':'failed',package_digest:plan.row.digest,suite_digest:plan.suite.digest,runtime:this.runtime,report}
    }catch(error){await this.pool.query("UPDATE data_agent.skill_evaluations SET status='failed',report=$2 WHERE id=$1",[plan.evaluationId,{error:'EVALUATION_FAILED'}]);throw error}
  }
  async publish(actor:Actor,id:string,v:string,evaluationId:string) {
    return this.tx(async db=>{
      await this.mutation(db,actor,true)
      const row=(await db.query('SELECT * FROM data_agent.skill_versions WHERE project_id=$1 AND skill_id=$2 AND version=$3',[actor.project_id,id,v])).rows[0]
      if(!row || row.status==='retired') throw new DomainError('VERSION_UNAVAILABLE')
      if(row.status==='released') return {status:'released'}
      const suite=this.suites[(row.snapshot as SkillPackage).manifest.evaluation_suite]
      const evidence=(await db.query("SELECT * FROM data_agent.skill_evaluations WHERE id=$1 AND project_id=$2 AND skill_id=$3 AND version=$4 AND digest=$5 AND status='passed'",[evaluationId,actor.project_id,id,v,row.digest])).rows[0]
      if(suite?.release_eligible!==true)throw new DomainError('BUSINESS_EVALUATION_REQUIRED')
      if(!evidence || !suite || !this.runtime || evidence.suite_digest!==suite.digest || evidence.runtime_digest!==digest(this.runtime)) throw new DomainError('EVALUATION_REQUIRED')
      await db.query("UPDATE data_agent.skill_versions SET status='released' WHERE project_id=$1 AND skill_id=$2 AND version=$3",[actor.project_id,id,v])
      await db.query("INSERT INTO data_agent.skill_releases(project_id,skill_id,version,action,evaluation_id,actor_id) VALUES($1,$2,$3,'publish',$4,$5)",[actor.project_id,id,v,evaluationId,actor.actor_id])
      await this.audit(db,actor,'skill.publish',{id,version:v,evaluation_id:evaluationId});return {status:'released'}
    })
  }
  async selectDefault(actor:Actor,id:string,v:string) {
    return this.tx(async db=>{
      await this.mutation(db,actor,true)
      if(!(await db.query("SELECT 1 FROM data_agent.skill_versions WHERE project_id=$1 AND skill_id=$2 AND version=$3 AND status='released'",[actor.project_id,id,v])).rowCount) throw new DomainError('VERSION_UNAVAILABLE')
      await db.query('UPDATE data_agent.skill_definitions SET default_version=$3 WHERE project_id=$1 AND id=$2',[actor.project_id,id,v])
      await db.query("INSERT INTO data_agent.skill_releases(project_id,skill_id,version,action,actor_id) VALUES($1,$2,$3,'default',$4)",[actor.project_id,id,v,actor.actor_id]);await this.audit(db,actor,'skill.default',{id,version:v})
    })
  }
  async retire(actor:Actor,id:string,v:string) {
    return this.tx(async db=>{
      await this.mutation(db,actor,true)
      if(!(await db.query("UPDATE data_agent.skill_versions SET status='retired' WHERE project_id=$1 AND skill_id=$2 AND version=$3 RETURNING version",[actor.project_id,id,v])).rowCount) throw new DomainError('VERSION_UNAVAILABLE')
      await db.query('UPDATE data_agent.skill_definitions SET default_version=NULL WHERE project_id=$1 AND id=$2 AND default_version=$3',[actor.project_id,id,v])
      await db.query("INSERT INTO data_agent.skill_releases(project_id,skill_id,version,action,actor_id) VALUES($1,$2,$3,'retire',$4)",[actor.project_id,id,v,actor.actor_id]);await this.audit(db,actor,'skill.retire',{id,version:v})
      return (await db.query('SELECT id,session_id FROM data_agent.skill_invocations WHERE project_id=$1 AND skill_id=$2 AND version=$3',[actor.project_id,id,v])).rows
    })
  }
  async invoke(actor:Actor,id:string,v:string|null,sessionId:string,raw:unknown,runtime:SkillRuntime|null=this.runtime) {
    const input=SkillInput.parse(raw)
    if(input.project_id!==actor.project_id || input.dataset.project_id!==actor.project_id) throw new DomainError('FORBIDDEN')
    if(!runtime) throw new DomainError('RUNTIME_UNCONFIGURED')
    return this.tx(async db=>{
      await this.mutation(db,actor)
      const selected=v??(await db.query('SELECT default_version FROM data_agent.skill_definitions WHERE project_id=$1 AND id=$2',[actor.project_id,id])).rows[0]?.default_version
      const row=(await db.query("SELECT * FROM data_agent.skill_versions WHERE project_id=$1 AND skill_id=$2 AND version=$3 AND status='released'",[actor.project_id,id,selected])).rows[0]
      if(!row) throw new DomainError('VERSION_UNAVAILABLE')
      if(!(await db.query('SELECT 1 FROM data_agent.artifacts WHERE project_id=$1 AND id=$2 AND digest=$3 AND kind=$4 AND deleted_at IS NULL',[actor.project_id,input.dataset.artifact_id,input.dataset.digest,input.dataset.kind])).rowCount) throw new DomainError('INPUT_NOT_READY')
      const invocationId=randomUUID()
      await db.query('INSERT INTO data_agent.skill_invocations(id,project_id,skill_id,version,digest,actor_id,session_id,input,runtime) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[invocationId,actor.project_id,id,selected,row.digest,actor.actor_id,sessionId,input,runtime])
      await this.audit(db,actor,'skill.invoke',{invocation_id:invocationId,id,version:selected})
      return {invocation_id:invocationId,lock:{id,version:selected,digest:row.digest,project_id:actor.project_id},snapshot:row.snapshot}
    })
  }
  async load(actor:Actor,invocationId:string) {
    return this.tx(async db=>{await this.authorize(db,actor);const row=(await db.query('SELECT i.*,v.snapshot FROM data_agent.skill_invocations i JOIN data_agent.skill_versions v ON v.project_id=i.project_id AND v.skill_id=i.skill_id AND v.version=i.version AND v.digest=i.digest WHERE i.project_id=$1 AND i.id=$2',[actor.project_id,invocationId])).rows[0];if(!row)throw new DomainError('INVOCATION_NOT_FOUND');return row})
  }
  async list(actor:Actor,id:string) {
    return this.tx(async db=>{await this.authorize(db,actor);return {definition:(await db.query('SELECT * FROM data_agent.skill_definitions WHERE project_id=$1 AND id=$2',[actor.project_id,id])).rows[0],versions:(await db.query('SELECT version,digest,status,parent_version,reason,created_at FROM data_agent.skill_versions WHERE project_id=$1 AND skill_id=$2 ORDER BY created_at',[actor.project_id,id])).rows,evaluations:(await db.query('SELECT * FROM data_agent.skill_evaluations WHERE project_id=$1 AND skill_id=$2 ORDER BY created_at',[actor.project_id,id])).rows}})
  }
  async feedback(actor:Actor,invocationId:string,raw:unknown) {
    const body=z.object({kind:z.enum(['rejected','parameters_changed','failure','rerun','quality']),text:z.string().min(1).max(4000)}).strict().parse(raw)
    await this.load(actor,invocationId)
    await this.tx(async db=>{await this.authorize(db,actor,'write');await db.query('INSERT INTO data_agent.skill_feedback(id,invocation_id,actor_id,body) VALUES($1,$2,$3,$4)',[randomUUID(),invocationId,actor.actor_id,body])})
  }
}
