/** Multipart upload state and immutable imports; computation remains in the Worker queue. */
import { randomBytes,randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { z } from 'zod'
import { Repository,type Actor } from './repository.ts'
import { LocalStore } from './local-store.ts'
import { compile,digest,DomainError,ImportOptions } from './contracts.ts'
import { Pool,type PoolClient } from 'pg'
export type CatalogConfig={max_upload_bytes:number;part_bytes:number;upload_ttl_ms:number;upload_cleanup_grace_ms:number;environment_digest:string}
export class Catalog extends Repository {
  constructor(pool:Pool,readonly store:LocalStore,readonly config:CatalogConfig){super(pool)}
  private async upload(db:PoolClient,actor:Actor,id:string,write=false) {
    await this.authorize(db,actor,write?'write':'read')
    const row=(await db.query('SELECT *,(expires_at>clock_timestamp()) AS live FROM data_agent.uploads WHERE project_id=$1 AND id=$2 FOR UPDATE',[actor.project_id,id])).rows[0]
    if(!row) throw new DomainError('UPLOAD_NOT_FOUND')
    return row
  }
  async init(actor:Actor,raw:unknown) {
    const request=z.object({filename:z.string().min(1).max(256),bytes:z.number().int().positive().max(this.config.max_upload_bytes),digest:z.string().regex(/^[a-f0-9]{64}$/),idempotency_key:z.string().min(1).max(128)}).strict().parse(raw)
    return this.tx(async db=>{
      await this.authorize(db,actor,'write');await db.query('SELECT id FROM data_agent.projects WHERE id=$1 FOR UPDATE',[actor.project_id])
      const previous=(await db.query('SELECT * FROM data_agent.uploads WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3',[actor.project_id,actor.actor_id,request.idempotency_key])).rows[0]
      if(previous){if(previous.request_digest!==digest(request)) throw new DomainError('IDEMPOTENCY_CONFLICT');return previous}
      const result=(await db.query("INSERT INTO data_agent.uploads(id,project_id,actor_id,idempotency_key,request_digest,filename,bytes,digest,part_bytes,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'uploading',clock_timestamp()+$10*interval '1 millisecond') RETURNING *",[randomUUID(),actor.project_id,actor.actor_id,request.idempotency_key,digest(request),request.filename,request.bytes,request.digest,this.config.part_bytes,this.config.upload_ttl_ms])).rows[0]
      await this.audit(db,actor,'upload.init',{upload_id:result.id});return result
    })
  }
  async status(actor:Actor,id:string) {
    return this.tx(async db=>{const upload=await this.upload(db,actor,id);return {...upload,parts:(await db.query('SELECT number,bytes,digest FROM data_agent.upload_parts WHERE upload_id=$1 ORDER BY number',[id])).rows}})
  }
  async grant(actor:Actor,id:string,number:number,sha:string) {
    if(!Number.isInteger(number) || number<1 || !/^[a-f0-9]{64}$/.test(sha)) throw new DomainError('PART_INVALID')
    return this.tx(async db=>{
      const upload=await this.upload(db,actor,id,true)
      if(upload.status!=='uploading' || !upload.live) throw new DomainError('UPLOAD_CLOSED')
      const bytes=Math.min(upload.part_bytes,Number(upload.bytes)-(number-1)*upload.part_bytes)
      if(bytes<=0) throw new DomainError('PART_INVALID')
      const ticket=randomBytes(32).toString('base64url')
      await db.query('INSERT INTO data_agent.upload_grants VALUES($1,$2,$3,$4) ON CONFLICT(upload_id,number) DO UPDATE SET token_hash=$3,digest=$4',[id,number,digest(ticket),sha])
      return {ticket,number,bytes,digest:sha}
    })
  }
  async part(actor:Actor,id:string,number:number,ticket:string,chunks:AsyncIterable<Uint8Array>) {
    const expected=await this.tx(async db=>{
      const upload=await this.upload(db,actor,id,true)
      const grant=(await db.query('SELECT * FROM data_agent.upload_grants WHERE upload_id=$1 AND number=$2 AND token_hash=$3',[id,number,digest(ticket)])).rows[0]
      if(upload.status!=='uploading' || !upload.live || !grant) throw new DomainError('UPLOAD_CLOSED')
      return {digest:grant.digest as string,bytes:Math.min(upload.part_bytes,Number(upload.bytes)-(number-1)*upload.part_bytes)}
    })
    const key=`${actor.project_id}/uploads/${id}/parts/${number}-${expected.digest}`
    const object=await this.store.put(key,chunks,expected)
    await this.tx(async db=>{
      const upload=await this.upload(db,actor,id,true)
      if(upload.status!=='uploading' || !upload.live || !(await db.query('SELECT 1 FROM data_agent.upload_grants WHERE upload_id=$1 AND number=$2 AND token_hash=$3 AND digest=$4',[id,number,digest(ticket),expected.digest])).rowCount) throw new DomainError('UPLOAD_CLOSED')
      await db.query('INSERT INTO data_agent.upload_parts VALUES($1,$2,$3,$4,$5) ON CONFLICT(upload_id,number) DO UPDATE SET bytes=$3,digest=$4,object_key=$5',[id,number,object.bytes,object.digest,key])
    })
    return {number,bytes:object.bytes,digest:object.digest}
  }
  async complete(actor:Actor,id:string) {
    const plan=await this.tx(async db=>{
      const upload=await this.upload(db,actor,id,true)
      if(upload.status==='uploaded') return {upload,parts:[]}
      if(!['uploading','completing'].includes(upload.status) || !upload.live) throw new DomainError('UPLOAD_CLOSED')
      const parts=(await db.query('SELECT * FROM data_agent.upload_parts WHERE upload_id=$1 ORDER BY number',[id])).rows
      if(parts.length!==Math.ceil(Number(upload.bytes)/upload.part_bytes) || parts.some((p,i)=>p.number!==i+1) || parts.reduce((sum,p)=>sum+Number(p.bytes),0)!==Number(upload.bytes)) throw new DomainError('PARTS_INCOMPLETE')
      await db.query("UPDATE data_agent.uploads SET status='completing' WHERE id=$1",[id]);return {upload,parts}
    })
    if(plan.upload.status==='uploaded') return plan.upload
    const store=this.store
    async function* bytes(){for(const part of plan.parts) yield* createReadStream(await store.path(part.object_key))}
    try {
      const object=await store.put(`${actor.project_id}/uploads/${id}/original`,bytes(),{bytes:Number(plan.upload.bytes),digest:plan.upload.digest})
      return await this.tx(async db=>{
        const current=await this.upload(db,actor,id,true)
        if(current.status==='uploaded') return current
        if(current.status!=='completing') throw new DomainError('UPLOAD_CLOSED')
        await db.query("INSERT INTO data_agent.artifacts(id,project_id,kind,digest,object_key,bytes,metadata) VALUES($1,$2,'RawFileRef',$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING",[id,actor.project_id,object.digest,object.object_key,object.bytes,{filename:current.filename}])
        await this.audit(db,actor,'upload.complete',{upload_id:id})
        return (await db.query("UPDATE data_agent.uploads SET status='uploaded',object_key=$2 WHERE id=$1 RETURNING *",[id,object.object_key])).rows[0]
      })
    }catch(error){await this.tx(async db=>{await this.upload(db,actor,id,true);await db.query("UPDATE data_agent.uploads SET status='failed',error_code='UPLOAD_VERIFY_FAILED' WHERE id=$1 AND status='completing'",[id])});throw error}
  }
  async retry(actor:Actor,id:string) {
    return this.tx(async db=>{const upload=await this.upload(db,actor,id,true);if(upload.status!=='failed' || !upload.live)throw new DomainError('UPLOAD_CLOSED');await db.query("UPDATE data_agent.uploads SET status='uploading',error_code=NULL WHERE id=$1",[id]);await this.audit(db,actor,'upload.retry',{upload_id:id})})
  }
  async expire() {
    const expired=await this.tx(async db=>{
      const rows=(await db.query("SELECT id,project_id FROM data_agent.uploads WHERE status IN ('uploading','completing','failed') AND expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED")).rows
      for(const row of rows){await db.query("UPDATE data_agent.uploads SET status='aborted',error_code='UPLOAD_EXPIRED' WHERE id=$1",[row.id]);await this.audit(db,{project_id:row.project_id,actor_id:'system:retention'},'upload.expire',{upload_id:row.id})}
      return rows.length
    })
    const garbage=(await this.pool.query("SELECT u.id,u.project_id FROM data_agent.uploads u WHERE status='aborted' AND expires_at<clock_timestamp()-$1*interval '1 millisecond' AND (cleaned_at IS NULL OR cleaned_at<clock_timestamp()-$1*interval '1 millisecond') AND NOT EXISTS(SELECT 1 FROM data_agent.artifacts a WHERE a.project_id=u.project_id AND (a.id=u.id OR starts_with(a.object_key,u.project_id||'/uploads/'||u.id||'/'))) ORDER BY expires_at LIMIT 100",[this.config.upload_cleanup_grace_ms])).rows
    for(const row of garbage){await this.store.purgeUpload(row.project_id,row.id);await this.pool.query('UPDATE data_agent.uploads SET cleaned_at=clock_timestamp() WHERE id=$1',[row.id])}
    return {expired,cleaned:garbage.length}
  }
  async abort(actor:Actor,id:string) {
    return this.tx(async db=>{const upload=await this.upload(db,actor,id,true);if(upload.status==='uploaded') throw new DomainError('UPLOAD_IMMUTABLE');await db.query("UPDATE data_agent.uploads SET status='aborted' WHERE id=$1",[id]);await this.audit(db,actor,'upload.abort',{upload_id:id})})
  }
  async import(actor:Actor,uploadId:string,raw:unknown) {
    const value=z.object({options:ImportOptions,roles:z.record(z.string(),z.enum(['feature','target','entity_id','record_id','event_time','prediction_time','ignore']))}).strict().parse(raw)
    const id=digest({uploadId,...value})
    return this.tx(async db=>{
      await this.authorize(db,actor,'write');await db.query('SELECT id FROM data_agent.projects WHERE id=$1 FOR UPDATE',[actor.project_id])
      const prior=(await db.query('SELECT * FROM data_agent.imports WHERE project_id=$1 AND id=$2',[actor.project_id,id])).rows[0]
      if(prior) return prior
      const upload=await this.upload(db,actor,uploadId,true)
      if(upload.status!=='uploaded' || !(await db.query('SELECT 1 FROM data_agent.artifacts WHERE id=$1 AND deleted_at IS NULL',[uploadId])).rowCount) throw new DomainError('UPLOAD_NOT_READY')
      const workflowId='import-'+id
      const compiled=compile({schema_version:'1',project_id:actor.project_id,policy_version:'import-v1',seed:0,environment_digest:this.config.environment_digest,nodes:[{id:'import',operator:'import',operator_version:'1',params:{...value,max_bytes:this.config.max_upload_bytes},inputs:{file:{kind:'RawFileRef',project_id:actor.project_id,artifact_id:uploadId,digest:upload.digest}}}]})
      const runId=randomUUID(),snapshot={...compiled.workflow,workflow_id:workflowId,revision:1,semantic_digest:compiled.digest,approval_id:null}
      await db.query('INSERT INTO data_agent.workflows VALUES($1,$2,1,$3,$4)',[actor.project_id,workflowId,compiled.workflow,compiled.digest])
      await db.query('INSERT INTO data_agent.workflow_versions VALUES($1,$2,1,$3,$4)',[actor.project_id,workflowId,compiled.workflow,compiled.digest])
      await db.query("INSERT INTO data_agent.runs(id,project_id,session_id,actor_id,idempotency_key,request_digest,snapshot,status,max_removed_fraction,cursor) VALUES($1,$2,'data-center',$3,$4,$4,$5,'queued',0,1)",[runId,actor.project_id,actor.actor_id,workflowId,snapshot])
      await db.query("INSERT INTO data_agent.jobs(id,run_id,node_id,spec,status) VALUES($1,$2,'import',$3,'pending')",[randomUUID(),runId,compiled.workflow.nodes[0]])
      await db.query('INSERT INTO data_agent.events(run_id,cursor,body) VALUES($1,1,$2)',[runId,{run_id:runId,project_id:actor.project_id,session_id:'data-center',cursor:1,status:'queued',type:'run.submitted'}])
      await db.query('INSERT INTO data_agent.imports(id,project_id,upload_id,options,roles,run_id) VALUES($1,$2,$3,$4,$5,$6)',[id,actor.project_id,uploadId,value.options,value.roles,runId])
      await this.audit(db,actor,'import.submit',{import_id:id,run_id:runId})
      return {id,run_id:runId,status:'importing'}
    })
  }
  async list(actor:Actor,search:string,offset:number,limit:number) {
    if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100||search.length>256) throw new DomainError('PAGE_INVALID')
    return this.tx(async db=>{await this.authorize(db,actor);return (await db.query(`SELECT i.*,u.filename,r.status AS run_status,CASE WHEN r.status='succeeded' THEN 'ready' WHEN r.status IN ('failed','cancelled') THEN 'failed' ELSE 'importing' END AS status,a.id AS dataset_id,a.digest AS dataset_digest,a.metadata FROM data_agent.imports i JOIN data_agent.uploads u ON u.id=i.upload_id JOIN data_agent.runs r ON r.id=i.run_id LEFT JOIN data_agent.artifacts a ON a.run_id=r.id AND a.output_port='data' AND a.deleted_at IS NULL WHERE i.project_id=$1 AND strpos(lower(u.filename),lower($2))>0 ORDER BY i.created_at DESC,i.id OFFSET $3 LIMIT $4`,[actor.project_id,search,offset,limit])).rows})
  }
  async artifact(actor:Actor,id:string) {
    return this.tx(async db=>{await this.authorize(db,actor);const row=(await db.query('SELECT * FROM data_agent.artifacts WHERE project_id=$1 AND id=$2 AND deleted_at IS NULL',[actor.project_id,id])).rows[0];if(!row) throw new DomainError('ARTIFACT_NOT_FOUND');return row})
  }
  async preview(actor:Actor,artifactId:string,raw:unknown) {
    const params=z.object({offset:z.number().int().nonnegative(),limit:z.number().int().min(1).max(200),columns:z.array(z.string().min(1)).min(1).max(100)}).strict().parse(raw)
    return this.tx(async db=>{
      await this.authorize(db,actor);await db.query('SELECT id FROM data_agent.projects WHERE id=$1 FOR UPDATE',[actor.project_id])
      const artifact=(await db.query("SELECT * FROM data_agent.artifacts WHERE project_id=$1 AND id=$2 AND kind='DatasetRef' AND deleted_at IS NULL",[actor.project_id,artifactId])).rows[0]
      if(!artifact) throw new DomainError('ARTIFACT_NOT_FOUND')
      const key='preview-'+digest({artifactId,params})
      const prior=(await db.query('SELECT id FROM data_agent.runs WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3',[actor.project_id,actor.actor_id,key])).rows[0]
      if(prior)return {run_id:prior.id,status:'submitted'}
      const compiled=compile({schema_version:'1',project_id:actor.project_id,policy_version:'preview-v1',seed:0,environment_digest:this.config.environment_digest,nodes:[{id:'preview',operator:'preview',operator_version:'1',params,inputs:{data:{kind:'DatasetRef',project_id:actor.project_id,artifact_id:artifactId,digest:artifact.digest}}}]})
      const runId=randomUUID()
      await db.query("INSERT INTO data_agent.runs(id,project_id,session_id,actor_id,idempotency_key,request_digest,snapshot,status,max_removed_fraction,cursor) VALUES($1,$2,'data-center',$3,$4,$4,$5,'queued',0,1)",[runId,actor.project_id,actor.actor_id,key,{...compiled.workflow,semantic_digest:compiled.digest}])
      await db.query("INSERT INTO data_agent.jobs(id,run_id,node_id,spec,status) VALUES($1,$2,'preview',$3,'pending')",[randomUUID(),runId,compiled.workflow.nodes[0]])
      await db.query('INSERT INTO data_agent.events(run_id,cursor,body) VALUES($1,1,$2)',[runId,{run_id:runId,project_id:actor.project_id,session_id:'data-center',cursor:1,status:'queued',type:'run.submitted'}])
      await this.audit(db,actor,'dataset.preview',{artifact_id:artifactId,run_id:runId});return {run_id:runId,status:'submitted'}
    })
  }
  async discard(actor:Actor,id:string) {
    return this.tx(async db=>{
      await this.authorize(db,actor,'write');await db.query('SELECT id FROM data_agent.projects WHERE id=$1 FOR UPDATE',[actor.project_id])
      const artifact=(await db.query('SELECT * FROM data_agent.artifacts WHERE project_id=$1 AND id=$2 FOR UPDATE',[actor.project_id,id])).rows[0]
      if(!artifact)throw new DomainError('ARTIFACT_NOT_FOUND')
      if(artifact.deleted_at)return {deleted:true}
      // Historical runs and archived artifacts retain their bytes; no physical deletion here.
      const refs=(await db.query("SELECT 1 FROM data_agent.runs WHERE project_id=$1 AND jsonb_path_exists(snapshot,'$.nodes[*].inputs.* ? (@.artifact_id == $id)',jsonb_build_object('id',$2::text)) LIMIT 1",[actor.project_id,id])).rowCount
      const tasks=(await db.query("SELECT 1 FROM data_agent.business_tasks WHERE project_id=$1 AND dataset->>'artifact_id'=$2 LIMIT 1",[actor.project_id,id])).rowCount
      if(artifact.archived || artifact.run_id || refs || tasks)throw new DomainError('ARTIFACT_REFERENCED')
      await db.query('UPDATE data_agent.artifacts SET deleted_at=clock_timestamp() WHERE id=$1',[id]);await this.audit(db,actor,'artifact.discard',{id});return {deleted:true}
    })
  }
  async archive(actor:Actor,id:string) {
    return this.tx(async db=>{await this.authorize(db,actor,'write');const row=(await db.query('UPDATE data_agent.artifacts SET archived=true WHERE project_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id',[actor.project_id,id])).rows[0];if(!row) throw new DomainError('ARTIFACT_NOT_FOUND');await this.audit(db,actor,'artifact.archive',{id})})
  }
}
