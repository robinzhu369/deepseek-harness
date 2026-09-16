/** PostgreSQL authority for workflow versions, attempts, result publication and cursors. */
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { Pool, type PoolClient } from 'pg'
import { compile, affected, digest, DomainError, Manifest, Workflow, operators, type ArtifactRef, type Node } from './contracts.ts'

import { TaskCreate, TaskRun, Rerun, executionScope, type Scope } from './task-contracts.ts'
import { PlanProposal, ProposalDecision, validateProposalRoles } from './proposals.ts'

type Actor = { project_id: string; actor_id: string }
export type Worker = { owner: string; projects: string[] }
export type Claim = { job_id: string; run_id: string; project_id: string; node_id: string; attempt_no: number; fencing_token: string; owner: string; spec: Node; inputs: Record<string, ArtifactRef>; seed: number; recipe?: Record<string, unknown> }
export type Config = { lease_ms: number; max_attempts: number; max_running_jobs: number; runtime?: {environment_digest:string;policy_version:string} }
type Verify = (claim: Claim, manifest: Manifest) => Promise<void>
/** All callers supply trusted identity from their transport, never model arguments. */
export class DataAgentService {
  constructor(readonly pool: Pool, readonly config: Config, private verifyObjects: Verify, private checksum?: (key:string)=>Promise<{digest:string;bytes:number}>) {
    if (!Number.isInteger(config.lease_ms) || config.lease_ms < 100 || !Number.isInteger(config.max_attempts) || config.max_attempts < 1 || !Number.isInteger(config.max_running_jobs) || config.max_running_jobs < 1) throw new DomainError('CONFIG')
  }
  private async tx<T>(body: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect()
    try { await db.query('BEGIN'); const result = await body(db); await db.query('COMMIT'); return result }
    catch (error) { await db.query('ROLLBACK'); throw error }
    finally { db.release() }
  }
  private async authorize(db: PoolClient, actor: Actor, write = false) {
    const row = (await db.query('SELECT role FROM data_agent.members WHERE project_id=$1 AND actor_id=$2', [actor.project_id, actor.actor_id])).rows[0]
    if (!row || (write && row.role === 'viewer')) throw new DomainError('FORBIDDEN')
  }
  private async audit(db: PoolClient, actor: Actor, action: string, body: unknown) {
    await db.query('INSERT INTO data_agent.audit(project_id,actor_id,action,body) VALUES($1,$2,$3,$4)', [actor.project_id, actor.actor_id, action, body])
  }
  async saveWorkflow(actor: Actor, id: string, expected: number, raw: unknown) {
    return this.tx(db => this.saveWorkflowIn(db, actor, id, expected, raw))
  }
  private async saveWorkflowIn(db: PoolClient, actor: Actor, id: string, expected: number, raw: unknown) {
    const compiled = compile(raw)
    if (compiled.workflow.project_id !== actor.project_id) throw new DomainError('FORBIDDEN')

      await this.authorize(db, actor, true)
      // A project lock also serializes concurrent first creation of the same draft.
      await db.query('SELECT id FROM data_agent.projects WHERE id=$1 FOR NO KEY UPDATE', [actor.project_id])
      const previous = (await db.query('SELECT revision FROM data_agent.workflows WHERE project_id=$1 AND id=$2 FOR UPDATE', [actor.project_id,id])).rows[0]
      if ((previous?.revision ?? 0) !== expected) throw new DomainError('VERSION_CONFLICT')
      const revision = expected + 1
      await db.query('INSERT INTO data_agent.workflows VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id,id) DO UPDATE SET revision=$3,body=$4,digest=$5', [actor.project_id,id,revision,compiled.workflow,compiled.digest])
      await db.query('INSERT INTO data_agent.workflow_versions VALUES($1,$2,$3,$4,$5)', [actor.project_id,id,revision,compiled.workflow,compiled.digest])
      await this.audit(db, actor, 'workflow.save', { id, revision, digest: compiled.digest })
      return { revision, digest: compiled.digest }
  }

  async approve(actor: Actor, workflowId: string, revision: number, maxRemovedFraction: number) {
    return this.tx(db => this.approveIn(db, actor, workflowId, revision, maxRemovedFraction))
  }
  private async approveIn(db: PoolClient, actor: Actor, workflowId: string, revision: number, maxRemovedFraction: number) {
    if (!Number.isFinite(maxRemovedFraction) || maxRemovedFraction < 0 || maxRemovedFraction > 1) throw new DomainError('INVALID_APPROVAL')

      await this.authorize(db, actor, true)
      const row = (await db.query('SELECT * FROM data_agent.workflows WHERE project_id=$1 AND id=$2 AND revision=$3 FOR UPDATE',[actor.project_id,workflowId,revision])).rows[0]
      if (!row) throw new DomainError('VERSION_CONFLICT')
      const approval = (await db.query('INSERT INTO data_agent.approvals(id,project_id,actor_id,semantic_digest,max_removed_fraction) VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id,actor_id,semantic_digest,max_removed_fraction) DO UPDATE SET semantic_digest=EXCLUDED.semantic_digest RETURNING id',[randomUUID(),actor.project_id,actor.actor_id,row.digest,maxRemovedFraction])).rows[0]
      await this.audit(db,actor,'workflow.approve',{workflowId,revision,approval_id:approval.id})
      return approval.id as string
  }

  async submit(actor: Actor, request: { workflow_id: string; revision: number; session_id: string; idempotency_key: string; approval_id?: string }) {
    return this.tx(db => this.submitIn(db, actor, request))
  }
  private async submitIn(db: PoolClient, actor: Actor, request: { workflow_id: string; revision: number; session_id: string; idempotency_key: string; approval_id?: string }) {
    if (!request.idempotency_key || !request.session_id) throw new DomainError('INVALID_REQUEST')

      await this.authorize(db, actor, true)
      await db.query('SELECT id FROM data_agent.projects WHERE id=$1 FOR NO KEY UPDATE',[actor.project_id])
      const hash = digest(request)
      const prior = (await db.query('SELECT id,request_digest FROM data_agent.runs WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3',[actor.project_id,actor.actor_id,request.idempotency_key])).rows[0]
      if (prior) { if(prior.request_digest !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT'); return { run_id: prior.id as string, status: 'submitted' as const } }
      const version = (await db.query('SELECT * FROM data_agent.workflows WHERE project_id=$1 AND id=$2 AND revision=$3 FOR UPDATE',[actor.project_id,request.workflow_id,request.revision])).rows[0]
      if (!version) throw new DomainError('VERSION_CONFLICT')
      const compiled = compile(version.body)
      let limit = 0
      if (compiled.workflow.nodes.some(node => operators[node.operator].approval)) {
        const approval = (await db.query('SELECT * FROM data_agent.approvals WHERE id=$1 AND project_id=$2 AND semantic_digest=$3',[request.approval_id,actor.project_id,compiled.digest])).rows[0]
        if (!approval) throw new DomainError('MISSING_APPROVAL')
        limit = approval.max_removed_fraction
      }
      for (const node of compiled.workflow.nodes) for (const ref of Object.values(node.inputs)) {
        if ('artifact_id' in ref) {
          const artifact = await this.artifact(db, actor.project_id, ref)
          if (node.operator === 'fit' && (artifact.metadata.partition !== 'train' || artifact.metadata.preview === true)) throw new DomainError('FIT_SCOPE')
        }
      }
      const id = randomUUID()
      const skillLocks=(await db.query('SELECT i.id,i.skill_id,i.version,i.digest,i.input,i.runtime,v.snapshot FROM data_agent.skill_invocations i JOIN data_agent.skill_versions v ON v.project_id=i.project_id AND v.skill_id=i.skill_id AND v.version=i.version WHERE i.project_id=$1 AND i.session_id=$2',[actor.project_id,request.session_id])).rows
      const snapshot = { ...compiled.workflow, skill_locks:skillLocks, workflow_id:request.workflow_id, revision:request.revision, semantic_digest:compiled.digest, approval_id:request.approval_id ?? null }
      await db.query("INSERT INTO data_agent.runs(id,project_id,session_id,actor_id,idempotency_key,request_digest,snapshot,status,max_removed_fraction) VALUES($1,$2,$3,$4,$5,$6,$7,'queued',$8)",[id,actor.project_id,request.session_id,actor.actor_id,request.idempotency_key,hash,snapshot,limit])
      for (const node of compiled.workflow.nodes) await db.query("INSERT INTO data_agent.jobs(id,run_id,node_id,spec,status) VALUES($1,$2,$3,$4,'pending')",[randomUUID(),id,node.id,node])
      await this.event(db,id,'run.submitted')
      await this.audit(db,actor,'run.submit',{run_id:id})
      return { run_id:id, status:'submitted' as const }
  }

  /** Save conversation and canvas proposals through the same optimistic workflow revision. */
  async propose(actor: Actor, raw: unknown) {
    const proposal = PlanProposal.parse(raw), compiled = compile(proposal.workflow)
    if (compiled.workflow.project_id !== actor.project_id) throw new DomainError('FORBIDDEN')
    return this.tx(async db => {
      await this.authorize(db, actor, true)
      await db.query('SELECT id FROM data_agent.projects WHERE id=$1 FOR NO KEY UPDATE', [actor.project_id])
      if (proposal.session_id) {
        const session = (await db.query("SELECT 1 FROM data_agent.harness_sessions WHERE id=$1 AND project_id=$2 AND actor_id=$3 AND status='ready'", [proposal.session_id, actor.project_id, actor.actor_id])).rowCount
        if (!session) throw new DomainError('FORBIDDEN')
      }
      const previous = (await db.query('SELECT body FROM data_agent.workflows WHERE project_id=$1 AND id=$2', [actor.project_id, proposal.workflow_id])).rows[0]
      const inputs = new Map<string, ArtifactRef>(),inputRoles=new Map<string,Record<string,string>>()
      for (const node of compiled.workflow.nodes) for (const ref of Object.values(node.inputs)) if ('artifact_id' in ref) {
        const artifact=await this.artifact(db, actor.project_id, ref)
        if(artifact.metadata.roles)inputRoles.set(ref.artifact_id,artifact.metadata.roles)
        inputs.set(digest(ref), ref)
      }
      validateProposalRoles(compiled.workflow,compiled.order,inputRoles)
      for (const evidence of proposal.evidence) {
        if(evidence.ref.project_id!==actor.project_id)throw new DomainError('FORBIDDEN')
        const record=await this.artifact(db, actor.project_id, evidence.ref)
        if(record.metadata.preview===true && evidence.scope!=='sample')throw new DomainError('EVIDENCE_SCOPE')
        if(evidence.ref.kind==='DatasetRef') {
          if(!inputs.has(digest(evidence.ref)))throw new DomainError('EVIDENCE_INPUT_MISMATCH')
        } else if(evidence.ref.kind==='ReportRef') {
          const run=(await db.query('SELECT snapshot FROM data_agent.runs WHERE project_id=$1 AND id=$2',[actor.project_id,record.run_id])).rows[0]
          const sources=new Set<string>()
          for(const node of run?.snapshot?.nodes ?? [])for(const ref of Object.values(node.inputs) as ArtifactRef[])if('artifact_id' in ref)sources.add(digest(ref))
          if(!evidence.inputs.every(ref=>sources.has(digest(ref))))throw new DomainError('EVIDENCE_INPUT_MISMATCH')
        } else throw new DomainError('EVIDENCE_TYPE')
        if (!evidence.inputs.every(ref => inputs.has(digest(ref)))) throw new DomainError('EVIDENCE_INPUT_MISMATCH')
      }
      const confirmations = compiled.workflow.nodes.filter(node => operators[node.operator].approval).map(node => ({node_id: node.id, operator: node.operator, parameters: node.params, parameters_digest: digest(node.params), inputs: node.inputs}))
      if (confirmations.length && !proposal.evidence.length) throw new DomainError('EVIDENCE_REQUIRED')
      if(confirmations.some(item=>!proposal.expected_impact.some(impact=>impact.node_id===item.node_id)))throw new DomainError('IMPACT_REQUIRED')
      if (proposal.expected_impact.some(item => !compiled.workflow.nodes.some(node => node.id === item.node_id))) throw new DomainError('IMPACT_NODE')
      const saved = await this.saveWorkflowIn(db, actor, proposal.workflow_id, proposal.expected_revision, compiled.workflow)
      const oldNodes = new Map<string, Node>((previous?.body?.nodes ?? []).map((node: Node) => [node.id, node]))
      const changes = compiled.workflow.nodes.filter(node => digest(node) !== digest(oldNodes.get(node.id) ?? null)).map(node => ({node_id: node.id, before: oldNodes.get(node.id) ?? null, after: node}))
      const removed = [...oldNodes.keys()].filter(id => !compiled.workflow.nodes.some(node => node.id === id))
      const body = {...proposal, input_versions: [...inputs.values()], confirmations, changes, affected_nodes: previous?affected(previous.body,compiled.workflow):compiled.order, removed_nodes: removed, policy_version: compiled.workflow.policy_version, environment_digest: compiled.workflow.environment_digest}
      const id = randomUUID(), hash = digest({body, ...saved})
      await db.query("INSERT INTO data_agent.proposals(id,project_id,actor_id,workflow_id,revision,semantic_digest,digest,body,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending')", [id,actor.project_id,actor.actor_id,proposal.workflow_id,saved.revision,saved.digest,hash,body])
      await this.audit(db,actor,'proposal.create',{proposal_id:id,revision:saved.revision,digest:hash})
      return {proposal_id:id,revision:saved.revision,digest:hash,status:'proposed',body}
    })
  }
  /** Read immutable proposal details and whether the current draft still matches. */
  async proposal(actor: Actor, id: string) {
    return this.tx(async db => {
      await this.authorize(db,actor)
      const row=(await db.query('SELECT p.*,w.revision <> p.revision OR w.digest <> p.semantic_digest AS stale FROM data_agent.proposals p JOIN data_agent.workflows w ON w.project_id=p.project_id AND w.id=p.workflow_id WHERE p.project_id=$1 AND p.id=$2',[actor.project_id,id])).rows[0]
      if(!row) throw new DomainError('PROPOSAL_NOT_FOUND')
      return {...row,decisions:(await db.query('SELECT actor_id,body,created_at FROM data_agent.proposal_decisions WHERE proposal_id=$1 ORDER BY created_at',[id])).rows}
    })
  }
  /** Only the authenticated product transport invokes decisions; agents receive no approval tool. */
  async decideProposal(actor: Actor, id: string, raw: unknown) {
    const decision=ProposalDecision.parse(raw)
    return this.tx(async db => {
      await this.authorize(db,actor,true)
      await db.query('SELECT id FROM data_agent.projects WHERE id=$1 FOR NO KEY UPDATE',[actor.project_id])
      const row=(await db.query('SELECT * FROM data_agent.proposals WHERE project_id=$1 AND id=$2 FOR UPDATE',[actor.project_id,id])).rows[0]
      if(!row) throw new DomainError('PROPOSAL_NOT_FOUND')
      if(row.digest!==decision.digest) throw new DomainError('VERSION_CONFLICT')
      const prior=(await db.query('SELECT body FROM data_agent.proposal_decisions WHERE proposal_id=$1',[id])).rows[0]
      if(prior) {if(digest(prior.body)!==digest(decision)) throw new DomainError('DECISION_CONFLICT');return {status:row.status}}
      const current=(await db.query('SELECT revision,digest FROM data_agent.workflows WHERE project_id=$1 AND id=$2 FOR UPDATE',[actor.project_id,row.workflow_id])).rows[0]
      if(current.revision!==row.revision || current.digest!==row.semantic_digest) throw new DomainError('VERSION_CONFLICT')
      let approval: string|null=null
      if(decision.action==='approve') {
        if(row.body.unmet_prerequisites.length) throw new DomainError('PREREQUISITES_UNMET')
        for(const ref of [...row.body.input_versions,...row.body.evidence.map((item:{ref:ArtifactRef})=>item.ref)]) await this.artifact(db,actor.project_id,ref)
        approval=await this.approveIn(db,actor,row.workflow_id,row.revision,decision.max_removed_fraction)
      }
      const status=decision.action==='approve'?'approved':'rejected'
      await db.query('INSERT INTO data_agent.proposal_decisions(proposal_id,actor_id,body) VALUES($1,$2,$3)',[id,actor.actor_id,decision])
      await db.query('UPDATE data_agent.proposals SET status=$2,approval_id=$3 WHERE id=$1',[id,status,approval])
      await this.audit(db,actor,'proposal.'+decision.action,{proposal_id:id,...decision})
      return {status}
    })
  }
  /** Freeze exactly the approved revision, preserving normal Run request idempotency. */
  async submitProposal(actor: Actor, id: string, idempotencyKey: string) {
    return this.tx(async db => {
      await this.authorize(db,actor,true)
      await db.query('SELECT id FROM data_agent.projects WHERE id=$1 FOR NO KEY UPDATE',[actor.project_id])
      const row=(await db.query('SELECT * FROM data_agent.proposals WHERE project_id=$1 AND id=$2 FOR UPDATE',[actor.project_id,id])).rows[0]
      if(!row || row.status!=='approved') throw new DomainError('MISSING_APPROVAL')
      return this.submitIn(db,actor,{workflow_id:row.workflow_id,revision:row.revision,session_id:row.body.session_id ?? id,idempotency_key:idempotencyKey,approval_id:row.approval_id})
    })
  }
  /** Start the upload phase from an already published, full-data dataset. */
  async createTask(actor:Actor,raw:unknown){
    const request=TaskCreate.parse(raw)
    return this.tx(async db=>{
      await this.authorize(db,actor,true)
      await db.query('SELECT id FROM data_agent.projects WHERE id=$1 FOR NO KEY UPDATE',[actor.project_id])
      const prior=(await db.query('SELECT id,request_digest FROM data_agent.business_tasks WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3',[actor.project_id,actor.actor_id,request.idempotency_key])).rows[0]
      if(prior){if(prior.request_digest!==digest(request))throw new DomainError('IDEMPOTENCY_CONFLICT');return {task_id:prior.id as string}}
      if(request.dataset.project_id!==actor.project_id)throw new DomainError('FORBIDDEN')
      const input=await this.artifact(db,actor.project_id,request.dataset)
      if(input.metadata.preview===true)throw new DomainError('FULL_DATA_REQUIRED')
      const id=randomUUID()
      await db.query('INSERT INTO data_agent.business_tasks(id,project_id,actor_id,name,goal,dataset,idempotency_key,request_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,actor.project_id,actor.actor_id,request.name,request.goal,request.dataset,request.idempotency_key,digest(request)])
      await this.audit(db,actor,'task.create',{task_id:id,dataset:request.dataset})
      return {task_id:id}
    })
  }
  private async taskIn(db:PoolClient,actor:Actor,id:string){
    await this.authorize(db,actor,true)
    await db.query('SELECT id FROM data_agent.projects WHERE id=$1 FOR NO KEY UPDATE',[actor.project_id])
    const task=(await db.query('SELECT * FROM data_agent.business_tasks WHERE project_id=$1 AND id=$2 FOR UPDATE',[actor.project_id,id])).rows[0]
    if(!task)throw new DomainError('TASK_NOT_FOUND')
    return task
  }
  private async lineage(db:PoolClient,taskId:string,tip:string|null){
    const chain:{id:string;previous_run_id:string|null;stage:string;status:string;snapshot:Record<string,unknown>}[]=[]
    const seen=new Set<string>()
    while(tip){
      if(seen.has(tip))throw new DomainError('LINEAGE_CYCLE');seen.add(tip)
      const run=(await db.query('SELECT id,previous_run_id,stage,status,snapshot FROM data_agent.runs WHERE business_task_id=$1 AND id=$2',[taskId,tip])).rows[0]
      if(!run)throw new DomainError('LINEAGE_MISMATCH')
      chain.unshift(run);tip=run.previous_run_id
    }
    return chain
  }
  /** Hash input and output bytes before cache admission; missing objects are cache misses. */
  private async cacheObjects(actor:Actor,source:string|null,reuse:boolean){
    const verified=new Set<string>()
    if(!source||!reuse||!this.checksum)return verified
    const objects=await this.tx(async db=>{
      await this.authorize(db,actor,true)
      const run=(await db.query('SELECT snapshot FROM data_agent.runs WHERE id=$1 AND project_id=$2',[source,actor.project_id])).rows[0]
      if(!run)throw new DomainError('RUN_NOT_FOUND')
      const ids=compile(Workflow.strip().parse(run.snapshot)).workflow.nodes.flatMap(node=>Object.values(node.inputs).flatMap(ref=>'artifact_id' in ref?[ref.artifact_id]:[]))
      return (await db.query(`SELECT DISTINCT a.* FROM data_agent.artifacts a LEFT JOIN data_agent.job_outputs o ON o.artifact_id=a.id LEFT JOIN data_agent.jobs j ON j.id=o.job_id WHERE a.project_id=$1 AND a.deleted_at IS NULL AND (j.run_id=$2 OR a.id=ANY($3))`,[actor.project_id,source,ids])).rows
    })
    for(const object of objects){
      let actual:{digest:string;bytes:number}
      try{actual=await this.checksum(object.object_key)}catch{continue /* Unreadable or retained-away cache objects require recomputation. */}
      if(actual.digest===object.digest&&actual.bytes===Number(object.bytes))verified.add(digest(object))
    }
    return verified
  }
  /** Attach a new approved phase or freeze a historical Run without invoking a Skill. */
  async submitTask(actor:Actor,taskId:string,raw:unknown){
    const request=TaskRun.parse(raw)
    const verified=await this.cacheObjects(actor,request.source_run_id,request.reuse)
    return this.taskSubmission(actor,taskId,request,verified,false)
  }
  /** Replay the original plan, inputs and Skill locks; selection remains explicit. */
  async rerun(actor:Actor,runId:string,raw:unknown){
    const request=Rerun.parse(raw)
    const source=await this.tx(async db=>{
      await this.authorize(db,actor,true)
      const row=(await db.query('SELECT * FROM data_agent.runs WHERE project_id=$1 AND id=$2',[actor.project_id,runId])).rows[0]
      if(!row||!row.business_task_id)throw new DomainError('TASK_RUN_REQUIRED');return row
    })
    const verified=await this.cacheObjects(actor,runId,request.reuse)
    return this.taskSubmission(actor,source.business_task_id,{...request,proposal_id:runId,source_run_id:runId,previous_run_id:source.previous_run_id,stage:source.stage},verified,true)
  }
  private async taskSubmission(actor:Actor,taskId:string,request:import('zod').z.infer<typeof TaskRun>,verified:Set<string>,frozen:boolean){
    return this.tx(async db=>{
      const task=await this.taskIn(db,actor,taskId),hash=digest({taskId,request,frozen})
      const prior=(await db.query('SELECT id,request_digest FROM data_agent.runs WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3',[actor.project_id,actor.actor_id,request.idempotency_key])).rows[0]
      if(prior){if(prior.request_digest!==hash)throw new DomainError('IDEMPOTENCY_CONFLICT');return {run_id:prior.id as string}}
      if(task.cancel_requested)throw new DomainError('TASK_CANCELLED')
      if(task.revision!==request.expected_revision)throw new DomainError('VERSION_CONFLICT')
      const chain=await this.lineage(db,taskId,request.previous_run_id),previous=chain.at(-1)
      const stages=['analysis','processing','features'],index=stages.indexOf(request.stage)
      if(chain.some(run=>run.status!=='succeeded'||(run.snapshot.execution_scope as Scope|undefined)?.kind==='through'))throw new DomainError('PREVIOUS_RUN_INCOMPLETE')
      if(previous?(index<stages.indexOf(previous.stage)||index>stages.indexOf(previous.stage)+1):index!==0)throw new DomainError('STAGE_ORDER')
      if(previous&&stages.indexOf(previous.stage)<index){
        const required=previous.stage==='analysis'?'ReportRef':'DatasetRef'
        const published=(await db.query('SELECT 1 FROM data_agent.job_outputs o JOIN data_agent.jobs j ON j.id=o.job_id JOIN data_agent.artifacts a ON a.id=o.artifact_id WHERE j.run_id=ANY($1) AND a.kind=$2 AND a.deleted_at IS NULL LIMIT 1',[chain.filter(run=>run.stage===previous.stage).map(run=>run.id),required])).rowCount
        if(!published)throw new DomainError('STAGE_OUTPUT_REQUIRED')
      }
      const source=request.source_run_id?(await db.query('SELECT * FROM data_agent.runs WHERE id=$1 AND business_task_id=$2 FOR SHARE',[request.source_run_id,taskId])).rows[0]:undefined
      if(request.source_run_id&&(!source||source.stage!==request.stage||source.previous_run_id!==request.previous_run_id))throw new DomainError('LINEAGE_MISMATCH')
      let runId:string,snapshot:Record<string,unknown>
      if(frozen){
        const compiled=compile(Workflow.strip().parse(source.snapshot))
        if(!this.config.runtime||compiled.workflow.environment_digest!==this.config.runtime.environment_digest||compiled.workflow.policy_version!==this.config.runtime.policy_version)throw new DomainError('RUNTIME_INCOMPATIBLE')
        if(compiled.workflow.nodes.some(node=>operators[node.operator].approval)){
          const approval=(await db.query('SELECT 1 FROM data_agent.approvals WHERE id=$1 AND project_id=$2 AND semantic_digest=$3',[source.snapshot.approval_id,actor.project_id,compiled.digest])).rowCount
          if(!approval)throw new DomainError('MISSING_APPROVAL')
        }
        for(const node of compiled.workflow.nodes)for(const ref of Object.values(node.inputs))if('artifact_id' in ref)await this.artifact(db,actor.project_id,ref)
        runId=randomUUID();snapshot={...source.snapshot,frozen_replay:true}
        await db.query("INSERT INTO data_agent.runs(id,project_id,session_id,actor_id,idempotency_key,request_digest,snapshot,status,max_removed_fraction) VALUES($1,$2,$3,$4,$5,$6,$7,'queued',$8)",[runId,actor.project_id,source.session_id,actor.actor_id,request.idempotency_key,hash,snapshot,source.max_removed_fraction])
        for(const node of compiled.workflow.nodes)await db.query("INSERT INTO data_agent.jobs(id,run_id,node_id,spec,status) VALUES($1,$2,$3,$4,'pending')",[randomUUID(),runId,node.id,node])
      }else{
        const proposal=(await db.query('SELECT * FROM data_agent.proposals WHERE id=$1 AND project_id=$2',[request.proposal_id,actor.project_id])).rows[0]
        if(!proposal||proposal.status!=='approved')throw new DomainError('MISSING_APPROVAL')
        const result=await this.submitIn(db,actor,{workflow_id:proposal.workflow_id,revision:proposal.revision,session_id:proposal.body.session_id??proposal.id,idempotency_key:request.idempotency_key,approval_id:proposal.approval_id})
        runId=result.run_id;snapshot=(await db.query('SELECT snapshot FROM data_agent.runs WHERE id=$1',[runId])).rows[0].snapshot
      }
      const compiled=compile(Workflow.strip().parse(snapshot)),range=executionScope(compiled.workflow,request.scope)
      if(!this.config.runtime||compiled.workflow.policy_version!==this.config.runtime.policy_version||compiled.workflow.environment_digest!==this.config.runtime.environment_digest)throw new DomainError('RUNTIME_INCOMPATIBLE')
      const allowed=new Set<string>([task.dataset.artifact_id])
      const ancestors=(await db.query('SELECT o.artifact_id FROM data_agent.job_outputs o JOIN data_agent.jobs j ON j.id=o.job_id WHERE j.run_id=ANY($1)',[chain.map(run=>run.id)])).rows
      for(const row of ancestors)allowed.add(row.artifact_id)
      for(const node of compiled.workflow.nodes)for(const ref of Object.values(node.inputs))if('artifact_id' in ref&&!allowed.has(ref.artifact_id))throw new DomainError('LINEAGE_INPUT')
      snapshot={...snapshot,execution_scope:request.scope,reuse_requested:request.reuse,business_task_id:taskId,previous_run_id:request.previous_run_id,source_run_id:request.source_run_id,stage:request.stage}
      await db.query('UPDATE data_agent.runs SET snapshot=$2,request_digest=$3,business_task_id=$4,previous_run_id=$5,source_run_id=$6,stage=$7 WHERE id=$1',[runId,snapshot,hash,taskId,request.previous_run_id,request.source_run_id,request.stage])
      await db.query("UPDATE data_agent.jobs SET status='not_selected' WHERE run_id=$1 AND NOT(node_id=ANY($2))",[runId,[...range.selected]])
      const invalid=source?new Set(affected(Workflow.strip().parse(source.snapshot),compiled.workflow)):new Set(compiled.order)
      const reused=new Set<string>()
      const limit=(await db.query('SELECT max_removed_fraction FROM data_agent.runs WHERE id=$1',[runId])).rows[0].max_removed_fraction
      for(const nodeId of compiled.order){
        if(!request.reuse||!source||!range.selected.has(nodeId)||range.forced.has(nodeId)||invalid.has(nodeId))continue
        const node=compiled.workflow.nodes.find(node=>node.id===nodeId)!
        if(node.operator==='export'&&source.snapshot.semantic_digest!==compiled.digest)continue
        if(Object.values(node.inputs).some(ref=>'node_id' in ref&&!reused.has(ref.node_id)))continue
        const old=(await db.query("SELECT * FROM data_agent.jobs WHERE run_id=$1 AND node_id=$2 AND status='succeeded'",[source.id,nodeId])).rows[0]
        if(!old)continue
        const inputs=await this.inputs(db,source,node);if(!inputs)continue
        const inputObjects=await Promise.all(Object.values(inputs).map(ref=>this.artifact(db,actor.project_id,ref)))
        if(inputObjects.some(object=>!verified.has(digest(object))))continue
        const metadata=Object.fromEntries(Object.keys(inputs).map((port,index)=>[port,inputObjects[index].metadata]))
        const key=this.computeKey(compiled.workflow,node,inputs,metadata)
        if(old.compute_key!==key)continue
        const outputs=(await db.query('SELECT a.* FROM data_agent.artifacts a JOIN data_agent.job_outputs o ON o.artifact_id=a.id WHERE o.job_id=$1 AND a.deleted_at IS NULL',[old.id])).rows
        if(outputs.length!==Object.keys(operators[node.operator].outputs).length||outputs.some(object=>!verified.has(digest(object))))continue
        const impacts=(await db.query('SELECT manifest FROM data_agent.attempts WHERE job_id=ANY($1) AND status=\'succeeded\'',[outputs.map(object=>object.job_id)])).rows
        if(!impacts.length||impacts.some(row=>Manifest.parse(row.manifest).impact.removed_fraction>limit))continue
        const job=(await db.query("UPDATE data_agent.jobs SET status='succeeded',reused_from_job_id=$3,compute_key=$4 WHERE run_id=$1 AND node_id=$2 RETURNING id",[runId,nodeId,old.id,key])).rows[0]
        for(const object of outputs)await db.query('INSERT INTO data_agent.job_outputs VALUES($1,$2,$3)',[job.id,object.output_port,object.id])
        reused.add(nodeId)
      }
      await this.aggregate(db,runId);await this.event(db,runId,frozen?'run.rerun':'task.run')
      await db.query('UPDATE data_agent.business_tasks SET revision=revision+1,selected_run_id=CASE WHEN $2 THEN $3 ELSE selected_run_id END WHERE id=$1',[taskId,request.select,runId])
      await this.audit(db,actor,frozen?'task.rerun':'task.submit',{task_id:taskId,run_id:runId,request,reused_nodes:[...reused]})
      return {run_id:runId}
    })
  }
  /** Select a historical tip with optimistic concurrency; branches do not select themselves. */
  async selectTask(actor:Actor,taskId:string,runId:string,revision:number){
    return this.tx(async db=>{
      const task=await this.taskIn(db,actor,taskId)
      if(task.cancel_requested)throw new DomainError('TASK_CANCELLED')
      if(task.revision!==revision)throw new DomainError('VERSION_CONFLICT')
      await this.lineage(db,taskId,runId)
      await db.query('UPDATE data_agent.business_tasks SET selected_run_id=$2,revision=revision+1 WHERE id=$1',[taskId,runId])
      await this.audit(db,actor,'task.select',{task_id:taskId,run_id:runId});return {revision:revision+1}
    })
  }
  /** Pause scheduling at node boundaries; active attempts may still publish. */
  async pause(actor:Actor,runId:string,paused:boolean){
    return this.tx(async db=>{
      await this.authorize(db,actor,true)
      const run=(await db.query('SELECT * FROM data_agent.runs WHERE project_id=$1 AND id=$2 FOR UPDATE',[actor.project_id,runId])).rows[0]
      if(!run)throw new DomainError('RUN_NOT_FOUND')
      if(!['queued','running','waiting_approval'].includes(run.status))throw new DomainError('RUN_TERMINAL')
      await db.query('UPDATE data_agent.runs SET paused=$2 WHERE id=$1',[runId,paused]);await this.event(db,runId,paused?'run.paused':'run.resumed')
      await this.audit(db,actor,paused?'run.pause':'run.resume',{run_id:runId});return {paused}
    })
  }
  /** Cancel all active branches and prevent later phase submissions, retaining published artifacts. */
  async cancelTask(actor:Actor,taskId:string){
    return this.tx(async db=>{
      const task=await this.taskIn(db,actor,taskId)
      if(task.cancel_requested)return {status:'cancel_requested'}
      await db.query('UPDATE data_agent.business_tasks SET cancel_requested=true,revision=revision+1 WHERE id=$1',[taskId])
      const runs=(await db.query("SELECT id FROM data_agent.runs WHERE business_task_id=$1 AND (status NOT IN ('succeeded','failed','cancelled') OR EXISTS(SELECT 1 FROM data_agent.jobs j WHERE j.run_id=data_agent.runs.id AND j.status IN ('running','cancel_requested'))) ORDER BY id FOR UPDATE",[taskId])).rows
      for(const run of runs){
        await db.query("UPDATE data_agent.jobs SET status=CASE WHEN status IN ('running','cancel_requested') THEN 'cancel_requested' ELSE 'cancelled' END WHERE run_id=$1 AND status NOT IN ('succeeded','failed','cancelled','not_selected')",[run.id])
        await this.aggregate(db,run.id);await this.event(db,run.id,'task.cancel')
      }
      await this.audit(db,actor,'task.cancel',{task_id:taskId});return {status:'cancel_requested'}
    })
  }
  /** Consistent database projection; its cursor vector supports reconnect without trusting model text. */
  async taskSnapshot(actor:Actor,taskId:string){
    return this.tx(async db=>{
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
      await this.authorize(db,actor)
      const task=(await db.query('SELECT * FROM data_agent.business_tasks WHERE id=$1 AND project_id=$2',[taskId,actor.project_id])).rows[0]
      if(!task)throw new DomainError('TASK_NOT_FOUND')
      const runs=(await db.query('SELECT id,previous_run_id,source_run_id,stage,status,paused,cursor::text,snapshot->\'execution_scope\' AS scope FROM data_agent.runs WHERE business_task_id=$1 ORDER BY created_at,id',[taskId])).rows
      const chain=await this.lineage(db,taskId,task.selected_run_id)
      const exports=(await db.query("SELECT DISTINCT a.id,a.kind,a.digest,a.metadata FROM data_agent.artifacts a JOIN data_agent.job_outputs o ON o.artifact_id=a.id JOIN data_agent.jobs j ON j.id=o.job_id WHERE j.run_id=$1 AND j.status='succeeded' AND j.spec->>'operator'='export' AND a.kind='ExportRef' AND a.deleted_at IS NULL AND a.metadata->>'status'='ready_for_training_contract'",[task.selected_run_id])).rows
      const complete=chain.every(run=>run.status==='succeeded'&&(run.snapshot.execution_scope as Scope|undefined)?.kind!=='through')&&['analysis','processing','features'].every(stage=>chain.some(run=>run.stage===stage))&&exports.length>0
      const active=Boolean((await db.query("SELECT 1 FROM data_agent.jobs j JOIN data_agent.runs r ON r.id=j.run_id WHERE r.business_task_id=$1 AND j.status IN ('running','cancel_requested') LIMIT 1",[taskId])).rowCount)
      const status=task.cancel_requested?(active?'cancel_requested':'cancelled'):complete?'completed':chain.some(run=>run.status==='failed')?'failed':chain.some(run=>run.status==='cancelled')?'cancelled':chain.some(run=>run.status!=='succeeded')?'running':'awaiting_next_stage'
      return {task_id:taskId,name:task.name,goal:task.goal,dataset:task.dataset,status,revision:task.revision,selected_run_id:task.selected_run_id,active_lineage:chain.map(run=>run.id),final_export_refs:complete?exports:[],runs,cursor:{revision:task.revision,runs:Object.fromEntries(runs.map(run=>[run.id,run.cursor]))}}
    })
  }
  private async artifact(db: PoolClient, project: string, ref: ArtifactRef) {
    const artifact = (await db.query('SELECT * FROM data_agent.artifacts WHERE id=$1 AND project_id=$2 AND digest=$3 AND kind=$4 AND deleted_at IS NULL FOR SHARE',[ref.artifact_id,project,ref.digest,ref.kind])).rows[0]
    if (!artifact) throw new DomainError('INPUT_NOT_READY')
    return artifact
  }
  private async inputs(db: PoolClient, run: {id:string;project_id:string}, spec: Node): Promise<Record<string,ArtifactRef> | null> {
    const result: Record<string,ArtifactRef> = {}
    for(const [port,ref] of Object.entries(spec.inputs)) {
      if ('artifact_id' in ref) { await this.artifact(db,run.project_id,ref); result[port]=ref }
      else {
        const row=(await db.query('SELECT a.* FROM data_agent.artifacts a JOIN data_agent.job_outputs o ON o.artifact_id=a.id JOIN data_agent.jobs j ON o.job_id=j.id WHERE j.run_id=$1 AND j.node_id=$2 AND o.output_port=$3 AND a.deleted_at IS NULL AND j.status=\'succeeded\'',[run.id,ref.node_id,ref.output_port])).rows[0]
        if(!row) return null
        result[port]={artifact_id:row.id,project_id:run.project_id,kind:row.kind,digest:row.digest}
      }
    }
    return result
  }
  private computeKey(snapshot:Workflow,node:Node,inputs:Record<string,ArtifactRef>,metadata:Record<string,unknown>){
    return digest({operator:node.operator,operator_version:node.operator_version,params:node.params,inputs,metadata,seed:snapshot.seed,policy_version:snapshot.policy_version,environment_digest:snapshot.environment_digest})
  }
  /** Acquire under the same Run lock used by cancellation, events and publication. */
  async acquire(worker: Worker): Promise<Claim|null> {
    if (!worker.owner || !worker.projects.length) throw new DomainError('FORBIDDEN')
    return this.tx(async db=>{
      await db.query("SELECT pg_advisory_xact_lock(hashtext('data_agent.acquire'))")
      const active=(await db.query("SELECT count(*)::int AS count FROM data_agent.jobs WHERE status IN ('running','cancel_requested')")).rows[0].count
      if(active>=this.config.max_running_jobs) return null
      const runs=(await db.query("SELECT * FROM data_agent.runs WHERE project_id=ANY($1) AND NOT paused AND status IN ('queued','running','waiting_approval') ORDER BY created_at FOR UPDATE SKIP LOCKED",[worker.projects])).rows
      for(const run of runs) {
        const jobs=(await db.query("SELECT * FROM data_agent.jobs WHERE run_id=$1 AND status IN ('pending','queued') ORDER BY id FOR UPDATE",[run.id])).rows
        for(const job of jobs) {
          const inputs=await this.inputs(db,run,job.spec)
          if(!inputs) continue
          if(job.spec.operator==='fit') {
            const input=await this.artifact(db,run.project_id,inputs.train)
            if(input.metadata.partition!=='train' || input.metadata.preview===true) throw new DomainError('FIT_SCOPE')
          }
          const inputMetadata:Record<string,unknown>={}
          for(const [port,ref] of Object.entries(inputs))inputMetadata[port]=(await this.artifact(db,run.project_id,ref)).metadata
          await db.query('UPDATE data_agent.jobs SET compute_key=$2 WHERE id=$1',[job.id,this.computeKey(run.snapshot,job.spec,inputs,inputMetadata)])
          const updated=(await db.query("UPDATE data_agent.jobs SET status='running',attempt_no=attempt_no+1,fencing_token=fencing_token+1,owner=$2,lease_until=clock_timestamp()+($3 * interval '1 millisecond') WHERE id=$1 RETURNING *",[job.id,worker.owner,this.config.lease_ms])).rows[0]
          await db.query("INSERT INTO data_agent.attempts(job_id,attempt_no,fencing_token,owner,status) VALUES($1,$2,$3,$4,'running')",[job.id,updated.attempt_no,updated.fencing_token,worker.owner])
          await db.query("UPDATE data_agent.runs SET status='running' WHERE id=$1",[run.id])
          await this.event(db,run.id,'node.running')
          return {job_id:job.id,run_id:run.id,project_id:run.project_id,node_id:job.node_id,attempt_no:updated.attempt_no,fencing_token:String(updated.fencing_token),owner:worker.owner,spec:job.spec,inputs,seed:run.snapshot.seed,recipe:run.snapshot}
        }
      }
      return null
    })
  }
  /** Issue one opaque credential; only the digest is persisted. Caller is a trusted Worker adapter.
   * @param claim - acquired attempt identity.
   * @returns the credential delivered once over the authenticated internal transport.
   */
  async issueCredential(claim: Claim): Promise<string> {
    return this.tx(async db=>{
      const {job,attempt}=await this.lockClaim(db,claim);this.checkLive(job,claim)
      if(attempt.credential_hash) throw new DomainError('CREDENTIAL_ALREADY_ISSUED')
      const token=randomBytes(32).toString('base64url')
      const hash=createHash('sha256').update(token).digest('hex')
      await db.query('UPDATE data_agent.attempts SET credential_hash=$3 WHERE job_id=$1 AND attempt_no=$2',[claim.job_id,claim.attempt_no,hash])
      return token
    })
  }
  /** Recover identity from an opaque token, including old attempts eligible only for receipt replay.
   * @param token - bearer credential from the Worker transport.
   * @returns the canonical persisted attempt identity.
   */
  async authenticateAttempt(token: string): Promise<Claim> {
    if(!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new DomainError('FORBIDDEN')
    const hash=createHash('sha256').update(token).digest('hex')
    const row=(await this.pool.query(`SELECT a.attempt_no,a.fencing_token,a.owner,j.id AS job_id,j.node_id,j.spec,r.id AS run_id,r.project_id,r.snapshot
      FROM data_agent.attempts a JOIN data_agent.jobs j ON a.job_id=j.id JOIN data_agent.runs r ON j.run_id=r.id WHERE a.credential_hash=$1`,[hash])).rows[0]
    if(!row) throw new DomainError('FORBIDDEN')
    return {job_id:row.job_id,run_id:row.run_id,project_id:row.project_id,node_id:row.node_id,attempt_no:row.attempt_no,fencing_token:String(row.fencing_token),owner:row.owner,spec:row.spec,inputs:{},seed:row.snapshot.seed,recipe:row.snapshot}
  }
  private async lockClaim(db: PoolClient, claim: Claim) {
    const run=(await db.query('SELECT * FROM data_agent.runs WHERE id=$1 AND project_id=$2 FOR UPDATE',[claim.run_id,claim.project_id])).rows[0]
    const job=(await db.query('SELECT *,(lease_until>clock_timestamp()) AS live FROM data_agent.jobs WHERE id=$1 AND run_id=$2 FOR UPDATE',[claim.job_id,claim.run_id])).rows[0]
    const attempt=(await db.query('SELECT * FROM data_agent.attempts WHERE job_id=$1 AND attempt_no=$2 AND fencing_token=$3 AND owner=$4',[claim.job_id,claim.attempt_no,claim.fencing_token,claim.owner])).rows[0]
    if (!run || !job || !attempt) throw new DomainError('STALE_ATTEMPT')
    return {run,job,attempt}
  }
  private checkLive(job: {live:boolean;status:string;fencing_token:string}, claim: Claim) {
    if(!job.live || job.status!=='running' || String(job.fencing_token)!==claim.fencing_token) throw new DomainError('STALE_ATTEMPT')
  }
  async heartbeat(claim: Claim) {
    return this.tx(async db=>{
      const {job}=await this.lockClaim(db,claim)
      if(job.status==='cancel_requested' && String(job.fencing_token)===claim.fencing_token) return {cancel_requested:true}
      this.checkLive(job,claim)
      await db.query("UPDATE data_agent.jobs SET lease_until=clock_timestamp()+($2 * interval '1 millisecond') WHERE id=$1",[job.id,this.config.lease_ms])
      return {cancel_requested:false}
    })
  }
  async commit(claim: Claim, raw: unknown) {
    const manifest=Manifest.parse(raw)
    const hash=digest(manifest)
    // Verification happens before short publication transactions; no object-store I/O holds locks.
    // Replays read their persisted receipt first, even after object retention has changed.
    const replay=await this.tx(async db=>{
      const {attempt}=await this.lockClaim(db,claim)
      if(attempt.manifest_digest && attempt.manifest_digest!==hash) throw new DomainError('IDEMPOTENCY_CONFLICT')
      return attempt.receipt
    })
    if(replay) return replay
    await this.verifyObjects(claim,manifest)
    return this.tx(async db=>{
      const {run,job,attempt}=await this.lockClaim(db,claim)
      if(attempt.manifest_digest) {
        if(attempt.manifest_digest!==hash) throw new DomainError('IDEMPOTENCY_CONFLICT')
        return attempt.receipt
      }
      this.checkLive(job,claim)
      if(run.status==='cancel_requested' || run.status==='cancelled') throw new DomainError('CANCELLED')
      const expected=operators[job.spec.operator].outputs
      if(digest(Object.keys(expected).sort())!==digest(Object.keys(manifest.outputs).sort())) throw new DomainError('OUTPUT_PORTS')
      for(const [port,output] of Object.entries(manifest.outputs)) if(output.kind!==expected[port] || output.metadata.preview===true) throw new DomainError('OUTPUT_TYPE')
      const waiting=manifest.impact.removed_fraction>run.max_removed_fraction
      const receipt={run_id:run.id,job_id:job.id,manifest_digest:hash,status:waiting?'waiting_approval':'published'}
      await db.query('UPDATE data_agent.attempts SET manifest_digest=$3,manifest=$4,receipt=$5,status=$6 WHERE job_id=$1 AND attempt_no=$2',[job.id,claim.attempt_no,hash,manifest,receipt,waiting?'computed_waiting_approval':'succeeded'])
      if(waiting) await db.query("UPDATE data_agent.jobs SET status='computed_waiting_approval',lease_until=NULL WHERE id=$1",[job.id])
      else await this.publish(db,run,job,manifest)
      await this.aggregate(db,run.id)
      await this.event(db,run.id,waiting?'node.waiting_approval':'node.published')
      return receipt
    })
  }
  private async publish(db: PoolClient, run: {id:string;project_id:string}, job: {id:string}, manifest: Manifest) {
    for(const [port,output] of Object.entries(manifest.outputs)) {const id=randomUUID();await db.query('INSERT INTO data_agent.artifacts(id,project_id,run_id,job_id,output_port,kind,digest,object_key,bytes,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,run.project_id,run.id,job.id,port,output.kind,output.digest,output.object_key,output.bytes,output.metadata]);await db.query('INSERT INTO data_agent.job_outputs VALUES($1,$2,$3)',[job.id,port,id])}
    await db.query("UPDATE data_agent.jobs SET status='succeeded',lease_until=NULL WHERE id=$1",[job.id])
  }
  /** Review actual impact without exposing unpublished object paths or granting downstream access. */
  async candidate(actor: Actor, runId: string, jobId: string) {
    return this.tx(async db=>{
      await this.authorize(db,actor)
      const row=(await db.query(`SELECT r.snapshot,r.max_removed_fraction,j.status,a.manifest_digest,a.manifest FROM data_agent.runs r JOIN data_agent.jobs j ON j.run_id=r.id JOIN data_agent.attempts a ON a.job_id=j.id AND a.attempt_no=j.attempt_no WHERE r.project_id=$1 AND r.id=$2 AND j.id=$3`,[actor.project_id,runId,jobId])).rows[0]
      if(!row || row.status!=='computed_waiting_approval')throw new DomainError('CANDIDATE_STALE')
      const manifest=Manifest.parse(row.manifest)
      return {run_id:runId,job_id:jobId,status:'waiting_approval',manifest_digest:row.manifest_digest,snapshot:row.snapshot,approved_removed_fraction:row.max_removed_fraction,actual_impact:manifest.impact,outputs:Object.fromEntries(Object.entries(manifest.outputs).map(([port,value])=>[port,{kind:value.kind,digest:value.digest,bytes:value.bytes,metadata:value.metadata}]))}
    })
  }
  /** Refusal retains diagnostics, revokes publication and stops dependent scheduling. */
  async rejectCandidate(actor: Actor, runId: string, jobId: string, hash: string, reason: string) {
    if(!reason.trim() || reason.length>4000)throw new DomainError('INVALID_REQUEST')
    return this.tx(async db=>{
      await this.authorize(db,actor,true)
      const run=(await db.query('SELECT * FROM data_agent.runs WHERE id=$1 AND project_id=$2 FOR UPDATE',[runId,actor.project_id])).rows[0]
      if(!run)throw new DomainError('FORBIDDEN')
      const job=(await db.query('SELECT * FROM data_agent.jobs WHERE id=$1 AND run_id=$2 FOR UPDATE',[jobId,runId])).rows[0]
      const attempt=job && (await db.query('SELECT * FROM data_agent.attempts WHERE job_id=$1 AND attempt_no=$2',[jobId,job.attempt_no])).rows[0]
      if(!attempt || attempt.manifest_digest!==hash)throw new DomainError('CANDIDATE_STALE')
      if(attempt.status==='rejected')return {status:'rejected'}
      if(job.status!=='computed_waiting_approval' || ['cancelled','cancel_requested','failed'].includes(run.status))throw new DomainError('CANDIDATE_STALE')
      await db.query("UPDATE data_agent.attempts SET status='rejected' WHERE job_id=$1 AND attempt_no=$2",[jobId,job.attempt_no])
      await db.query("UPDATE data_agent.jobs SET status='failed',error_code='CANDIDATE_REJECTED' WHERE id=$1",[jobId])
      await this.audit(db,actor,'candidate.reject',{run_id:runId,job_id:jobId,manifest_digest:hash,reason})
      await this.aggregate(db,runId);await this.event(db,runId,'node.rejected')
      return {status:'rejected'}
    })
  }
  async approveCandidate(actor: Actor, runId: string, jobId: string, hash: string, reason = 'Confirmed actual impact') {
    const candidate=await this.tx(async db=>{
      await this.authorize(db,actor,true)
      const row=(await db.query(`SELECT r.id AS run_id,r.project_id,r.snapshot,j.id AS job_id,j.node_id,j.spec,j.status,a.attempt_no,a.fencing_token,a.owner,a.manifest,a.manifest_digest FROM data_agent.runs r JOIN data_agent.jobs j ON j.run_id=r.id JOIN data_agent.attempts a ON a.job_id=j.id AND a.attempt_no=j.attempt_no WHERE r.project_id=$1 AND r.id=$2 AND j.id=$3`,[actor.project_id,runId,jobId])).rows[0]
      if(!row || row.manifest_digest!==hash)throw new DomainError('CANDIDATE_STALE')
      return row
    })
    if(candidate.status==='computed_waiting_approval')await this.verifyObjects({job_id:jobId,run_id:runId,project_id:actor.project_id,node_id:candidate.node_id,attempt_no:candidate.attempt_no,fencing_token:String(candidate.fencing_token),owner:candidate.owner,spec:candidate.spec,inputs:{},seed:candidate.snapshot.seed},Manifest.parse(candidate.manifest))
    return this.tx(async db=>{
      await this.authorize(db,actor,true)
      const run=(await db.query('SELECT * FROM data_agent.runs WHERE id=$1 AND project_id=$2 FOR UPDATE',[runId,actor.project_id])).rows[0]
      if(!run) throw new DomainError('FORBIDDEN')
      const job=(await db.query('SELECT * FROM data_agent.jobs WHERE id=$1 AND run_id=$2 FOR UPDATE',[jobId,runId])).rows[0]
      if(!job) throw new DomainError('CANDIDATE_STALE')
      const attempt=(await db.query('SELECT * FROM data_agent.attempts WHERE job_id=$1 AND attempt_no=$2',[jobId,job.attempt_no])).rows[0]
      if(!attempt || attempt.manifest_digest!==hash) throw new DomainError('CANDIDATE_STALE')
      if(job.status==='succeeded') return {status:'published'}
      if(job.status!=='computed_waiting_approval' || ['cancelled','cancel_requested','failed'].includes(run.status)) throw new DomainError('CANDIDATE_STALE')
      // A changed current draft requires a fresh proposal instead of approval on obsolete intent.
      const current=(await db.query('SELECT digest FROM data_agent.workflows WHERE project_id=$1 AND id=$2 FOR SHARE',[actor.project_id,run.snapshot.workflow_id])).rows[0]
      if(!run.snapshot.frozen_replay && (!current || current.digest!==run.snapshot.semantic_digest)) throw new DomainError('VERSION_CONFLICT')
      for(const node of compile(Workflow.strip().parse(run.snapshot)).workflow.nodes)for(const ref of Object.values(node.inputs))if('artifact_id' in ref)await this.artifact(db,actor.project_id,ref)
      await this.publish(db,run,job,Manifest.parse(attempt.manifest))
      await db.query("UPDATE data_agent.attempts SET status='succeeded' WHERE job_id=$1 AND attempt_no=$2",[jobId,job.attempt_no])
      await this.audit(db,actor,'candidate.approve',{run_id:runId,job_id:jobId,manifest_digest:hash,reason})
      await this.aggregate(db,runId); await this.event(db,runId,'node.published')
      return {status:'published'}
    })
  }
  async cancel(actor: Actor, runId: string) {
    return this.tx(async db=>{
      await this.authorize(db,actor,true)
      const run=(await db.query('SELECT * FROM data_agent.runs WHERE id=$1 AND project_id=$2 FOR UPDATE',[runId,actor.project_id])).rows[0]
      if(!run) throw new DomainError('FORBIDDEN')
      if(['succeeded','cancelled','failed'].includes(run.status)) return {status:run.status}
      await db.query("UPDATE data_agent.jobs SET status=CASE WHEN status IN ('running','cancel_requested') THEN 'cancel_requested' ELSE 'cancelled' END,lease_until=CASE WHEN status IN ('running','cancel_requested') THEN lease_until ELSE NULL END WHERE run_id=$1 AND status NOT IN ('succeeded','failed','cancelled','not_selected')",[runId])
      await db.query("UPDATE data_agent.runs SET status='cancel_requested' WHERE id=$1",[runId])
      await this.aggregate(db,runId); await this.event(db,runId,'run.cancel')
      await this.audit(db,actor,'run.cancel',{run_id:runId})
      return (await db.query('SELECT status FROM data_agent.runs WHERE id=$1',[runId])).rows[0]
    })
  }
  async acknowledgeCancel(claim: Claim) {
    return this.tx(async db=>{
      const {job}=await this.lockClaim(db,claim)
      if(String(job.fencing_token)!==claim.fencing_token || !['cancel_requested','cancelled'].includes(job.status)) throw new DomainError('STALE_ATTEMPT')
      await db.query("UPDATE data_agent.jobs SET status='cancelled',lease_until=NULL WHERE id=$1",[job.id])
      await db.query("UPDATE data_agent.attempts SET status='cancelled' WHERE job_id=$1 AND attempt_no=$2",[job.id,claim.attempt_no])
      await this.aggregate(db,claim.run_id); await this.event(db,claim.run_id,'node.cancelled')
    })
  }
  /** Resolve only the input objects frozen for the current live attempt. */
  async workerInputs(claim: Claim) {
    return this.tx(async db=>{
      const {run,job}=await this.lockClaim(db,claim)
      this.checkLive(job,claim)
      const refs=await this.inputs(db,run,job.spec)
      if(!refs) throw new DomainError('INPUT_NOT_READY')
      const result: Record<string,{object_key:string;digest:string;kind:string;metadata:Record<string,unknown>}>={}
      for(const [port,ref] of Object.entries(refs)) {
        const value=await this.artifact(db,run.project_id,ref)
        result[port]={object_key:value.object_key,digest:value.digest,kind:value.kind,metadata:value.metadata}
      }
      return result
    })
  }
  async reportProgress(claim: Claim, processed: number, total?: number) {
    if(!Number.isSafeInteger(processed) || processed<0 || (total!==undefined && (!Number.isSafeInteger(total) || total<processed))) throw new DomainError('INVALID_PROGRESS')
    return this.tx(async db=>{
      const {job}=await this.lockClaim(db,claim);this.checkLive(job,claim)
      if(job.progress && processed<job.progress.processed) throw new DomainError('PROGRESS_REGRESSION')
      await db.query('UPDATE data_agent.jobs SET progress=$2 WHERE id=$1',[job.id,{processed,...(total===undefined?{}:{total})}])
      await this.event(db,claim.run_id,'node.progress')
    })
  }
  async fail(claim: Claim, code: string) {
    // Errors reaching durable state are stable codes, never raw subprocess output or credentials.
    if(!/^[A-Z_]{1,80}$/.test(code)) throw new DomainError('INVALID_ERROR_CODE')
    return this.tx(async db=>{
      const {job}=await this.lockClaim(db,claim);this.checkLive(job,claim)
      await db.query("UPDATE data_agent.jobs SET status='failed',error_code=$2,lease_until=NULL WHERE id=$1",[job.id,code])
      await db.query("UPDATE data_agent.attempts SET status='failed' WHERE job_id=$1 AND attempt_no=$2",[job.id,claim.attempt_no])
      await this.aggregate(db,claim.run_id);await this.event(db,claim.run_id,'node.failed')
    })
  }
  async recover() {
    return this.tx(async db=>{
      const runs=(await db.query("SELECT * FROM data_agent.runs WHERE status IN ('running','cancel_requested') FOR UPDATE SKIP LOCKED")).rows
      let count=0
      for(const run of runs) {
        const jobs=(await db.query("SELECT * FROM data_agent.jobs WHERE run_id=$1 AND status IN ('running','cancel_requested') AND lease_until<=clock_timestamp() FOR UPDATE",[run.id])).rows
        for(const job of jobs) {
          // Expiry fences the worker. Cancellation remains pending until an executor confirms exit.
          // A missing heartbeat alone is not evidence that computation has stopped.
          if(job.status==='cancel_requested') continue
          await db.query("UPDATE data_agent.attempts SET status='interrupted' WHERE job_id=$1 AND attempt_no=$2",[job.id,job.attempt_no])
          await db.query("UPDATE data_agent.jobs SET status=$2,lease_until=NULL,error_code='LEASE_EXPIRED',fencing_token=fencing_token+1 WHERE id=$1",[job.id,job.attempt_no<this.config.max_attempts?'queued':'failed'])
          count++
        }
        if(jobs.some(job=>job.status==='running')) { await this.aggregate(db,run.id); await this.event(db,run.id,'run.recovered') }
      }
      return count
    })
  }
  private async aggregate(db: PoolClient, runId: string) {
    const states=(await db.query("SELECT status FROM data_agent.jobs WHERE run_id=$1 AND status<>'not_selected'",[runId])).rows.map(row=>row.status)
    const status=states.every(s=>s==='succeeded')?'succeeded':states.includes('failed')?'failed':states.includes('cancel_requested')?'cancel_requested':states.includes('cancelled')?'cancelled':states.includes('running')?'running':states.includes('computed_waiting_approval')?'waiting_approval':'queued'
    if(status==='failed') await db.query("UPDATE data_agent.jobs SET status=CASE WHEN status='running' THEN 'cancel_requested' ELSE 'cancelled' END WHERE run_id=$1 AND status IN ('pending','queued','running')",[runId])
    await db.query('UPDATE data_agent.runs SET status=$2 WHERE id=$1',[runId,status])
  }
  private async event(db: PoolClient, runId: string, type: string) {
    const run=(await db.query('UPDATE data_agent.runs SET cursor=cursor+1 WHERE id=$1 RETURNING project_id,session_id,cursor,status',[runId])).rows[0]
    await db.query('INSERT INTO data_agent.events(run_id,cursor,body) VALUES($1,$2,$3)',[runId,run.cursor,{...run,run_id:runId,type}])
  }
  async snapshot(actor: Actor, runId: string) {
    return this.tx(async db=>{
      await this.authorize(db,actor)
      const run=(await db.query('SELECT * FROM data_agent.runs WHERE id=$1 AND project_id=$2 FOR SHARE',[runId,actor.project_id])).rows[0]
      if(!run) throw new DomainError('FORBIDDEN')
      const nodes=(await db.query('SELECT id AS job_id,node_id,status,attempt_no,progress,error_code,reused_from_job_id FROM data_agent.jobs WHERE run_id=$1 ORDER BY node_id',[runId])).rows
      const artifacts=(await db.query('SELECT a.id,a.kind,a.digest,a.bytes,a.metadata,o.output_port,j.node_id FROM data_agent.artifacts a JOIN data_agent.job_outputs o ON o.artifact_id=a.id JOIN data_agent.jobs j ON j.id=o.job_id WHERE j.run_id=$1 AND a.deleted_at IS NULL',[runId])).rows
      return {run_id:run.id,session_id:run.session_id,status:run.status,paused:run.paused,business_task_id:run.business_task_id,previous_run_id:run.previous_run_id,source_run_id:run.source_run_id,stage:run.stage,scope:run.snapshot.execution_scope??{kind:'all'},cursor:String(run.cursor),nodes,artifacts}
    })
  }
  async events(actor: Actor, runId: string, after: string) {
    if(!/^\d+$/.test(after)) throw new DomainError('INVALID_CURSOR')
    return this.tx(async db=>{
      await this.authorize(db,actor)
      const run=(await db.query('SELECT id FROM data_agent.runs WHERE id=$1 AND project_id=$2',[runId,actor.project_id])).rows[0]
      if(!run) throw new DomainError('FORBIDDEN')
      return (await db.query('SELECT cursor::text,body FROM data_agent.events WHERE run_id=$1 AND cursor>$2 ORDER BY cursor LIMIT 1000',[runId,after])).rows
    })
  }
}
