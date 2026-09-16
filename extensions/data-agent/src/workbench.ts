/** Authenticated, paginated workbench projections and versioned template persistence. */
import {z} from 'zod'
import {Repository,type Actor} from './repository.ts'
import {compile,DomainError,Id} from './contracts.ts'
const Page=z.object({search:z.string().max(256),offset:z.number().int().nonnegative(),limit:z.number().int().min(1).max(100)})
/** Workbench metadata shares project authorization with execution; it never grants approval. */
export class Workbench extends Repository {
  /** List only the caller's sessions, with stable ordering and bounded pages. */
  async sessions(actor:Actor,raw:unknown){
    const page=Page.parse(raw)
    return this.tx(async db=>{await this.authorize(db,actor);return (await db.query(`SELECT id,title,input,business_task_id,status,created_at,updated_at FROM data_agent.harness_sessions WHERE project_id=$1 AND actor_id=$2 AND ($3='' OR strpos(lower(title),lower($3))>0) ORDER BY updated_at DESC,id LIMIT $4 OFFSET $5`,[actor.project_id,actor.actor_id,page.search,page.limit,page.offset])).rows})
  }
  /** Rename session metadata without modifying its conversation history. */
  async rename(actor:Actor,id:string,raw:unknown){
    const {title}=z.object({title:z.string().trim().min(1).max(256)}).strict().parse(raw)
    return this.tx(async db=>{await this.authorize(db,actor,'write');const result=await db.query('UPDATE data_agent.harness_sessions SET title=$4,updated_at=clock_timestamp() WHERE project_id=$1 AND actor_id=$2 AND id=$3 RETURNING id,title',[actor.project_id,actor.actor_id,id,title]);if(!result.rowCount)throw new DomainError('SESSION_FORBIDDEN');return result.rows[0]})
  }
  /** Read current workflow or a retained immutable revision. */
  async workflow(actor:Actor,id:string,revision?:number){
    if(revision!==undefined)z.number().int().positive().parse(revision)
    return this.tx(async db=>{await this.authorize(db,actor);const result=revision===undefined?await db.query('SELECT * FROM data_agent.workflows WHERE project_id=$1 AND id=$2',[actor.project_id,id]):await db.query('SELECT * FROM data_agent.workflow_versions WHERE project_id=$1 AND workflow_id=$2 AND revision=$3',[actor.project_id,id,revision]);if(!result.rowCount)throw new DomainError('WORKFLOW_NOT_FOUND');return result.rows[0]})
  }
  /** Session-scoped navigation never includes another owner's private conversation. */
  async navigation(actor:Actor,id:string){
    return this.tx(async db=>{await this.authorize(db,actor);if(!(await db.query('SELECT 1 FROM data_agent.harness_sessions WHERE id=$1 AND project_id=$2 AND actor_id=$3',[id,actor.project_id,actor.actor_id])).rowCount)throw new DomainError('SESSION_FORBIDDEN');return {runs:(await db.query('SELECT id,stage,status,cursor::text,previous_run_id,source_run_id,created_at,snapshot FROM data_agent.runs WHERE project_id=$1 AND session_id=$2 ORDER BY created_at DESC,id LIMIT 200',[actor.project_id,id])).rows,proposals:(await db.query("SELECT id,workflow_id,revision,status,digest,body FROM data_agent.proposals WHERE project_id=$1 AND body->>'session_id'=$2 ORDER BY created_at DESC,id LIMIT 200",[actor.project_id,id])).rows}})
  }
  /** List project Skill identities without loading their full instruction packages. */
  async skills(actor:Actor,raw:unknown){const page=Page.parse(raw);return this.tx(async db=>{await this.authorize(db,actor);return (await db.query("SELECT d.id,d.revision,d.default_version,COALESCE(v.snapshot->'manifest',d.draft->'manifest') AS manifest,v.status,(SELECT jsonb_build_object('version',e.version,'status',e.status,'created_at',e.created_at) FROM data_agent.skill_evaluations e WHERE e.project_id=d.project_id AND e.skill_id=d.id ORDER BY e.created_at DESC,e.id LIMIT 1) AS evaluation FROM data_agent.skill_definitions d LEFT JOIN data_agent.skill_versions v ON v.project_id=d.project_id AND v.skill_id=d.id AND v.version=d.default_version WHERE d.project_id=$1 AND ($2='' OR strpos(lower(d.id),lower($2))>0) ORDER BY d.id LIMIT $3 OFFSET $4",[actor.project_id,page.search,page.limit,page.offset])).rows})}
  /** Read one immutable package for a version comparison. */
  async skillVersion(actor:Actor,id:string,version:string){return this.tx(async db=>{await this.authorize(db,actor);const row=(await db.query('SELECT version,digest,status,snapshot FROM data_agent.skill_versions WHERE project_id=$1 AND skill_id=$2 AND version=$3',[actor.project_id,id,version])).rows[0];if(!row)throw new DomainError('SKILL_VERSION_NOT_FOUND');return row})}
  /** Return template metadata and bodies for an explicitly requested page. */
  async templates(actor:Actor,raw:unknown){const page=Page.parse(raw);return this.tx(async db=>{await this.authorize(db,actor);return (await db.query("SELECT * FROM data_agent.workflow_templates WHERE project_id=$1 AND ($2='' OR strpos(lower(name),lower($2))>0) ORDER BY updated_at DESC,id LIMIT $3 OFFSET $4",[actor.project_id,page.search,page.limit,page.offset])).rows})}
  /** Save a compiled template with optimistic concurrency; templates carry no execution approval. */
  async saveTemplate(actor:Actor,id:string,raw:unknown){
    Id.parse(id);const value=z.object({name:z.string().trim().min(1).max(256),expected_revision:z.number().int().nonnegative(),workflow:z.unknown()}).strict().parse(raw),compiled=compile(value.workflow)
    if(compiled.workflow.project_id!==actor.project_id)throw new DomainError('FORBIDDEN')
    return this.tx(async db=>{await this.authorize(db,actor,'write');await db.query('SELECT id FROM data_agent.projects WHERE id=$1 FOR NO KEY UPDATE',[actor.project_id]);const prior=(await db.query('SELECT revision FROM data_agent.workflow_templates WHERE project_id=$1 AND id=$2 FOR UPDATE',[actor.project_id,id])).rows[0];if((prior?.revision??0)!==value.expected_revision)throw new DomainError('VERSION_CONFLICT');const revision=value.expected_revision+1;await db.query('INSERT INTO data_agent.workflow_templates(project_id,id,name,revision,body,actor_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id,id) DO UPDATE SET name=$3,revision=$4,body=$5,actor_id=$6,updated_at=clock_timestamp()',[actor.project_id,id,value.name,revision,compiled.workflow,actor.actor_id]);await this.audit(db,actor,'template.save',{id,revision,digest:compiled.digest});return {id,revision}})
  }
}
