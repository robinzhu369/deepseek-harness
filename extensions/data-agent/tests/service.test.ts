import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { DataAgentService, type Claim } from '../src/service.ts'
import { Workbench } from '../src/workbench.ts'
import { fixture } from './fixtures.ts'
import type { Manifest } from '../src/contracts.ts'
const testUrl=process.env.DATA_AGENT_TEST_DATABASE_URL??'postgres://postgres:local-test-only@127.0.0.1:55439/data_agent_test'
if(!new URL(testUrl).pathname.endsWith('_test')) throw new Error('Refusing to reset a database without the _test suffix')
const pool=new Pool({connectionString:testUrl})
const actor={project_id:'p',actor_id:'alice'}
let verifications=0
const service=new DataAgentService(pool,{lease_ms:60000,max_attempts:2,max_running_jobs:1},async()=>{verifications++})
before(async()=>{
 const exists=(await pool.query("SELECT to_regclass('data_agent.schema_versions') AS table_name")).rows[0].table_name
 const current=exists?(await pool.query('SELECT max(version) AS version FROM data_agent.schema_versions')).rows[0].version:0
 for(const name of ['001_data_agent.sql','002_attempt_credentials.sql','003_data_catalog.sql','004_skill_lifecycle.sql','005_harness_sessions.sql','006_proposals.sql','007_business_tasks.sql','008_workbench.sql'])if(Number(name.slice(0,3))>current||name==='007_business_tasks.sql')await pool.query(await readFile(new URL('../../../database/migrations/'+name,import.meta.url),'utf8'))
})
beforeEach(async()=>{
  await pool.query('TRUNCATE data_agent.projects CASCADE')
  await pool.query("INSERT INTO data_agent.projects VALUES('p','Test'),('q','Other'); INSERT INTO data_agent.members VALUES('p','alice','owner'),('p','viewer','viewer'),('q','bob','owner')")
  await pool.query("INSERT INTO data_agent.artifacts(id,project_id,kind,digest,object_key,bytes,metadata) VALUES('input','p','DatasetRef',$1,'input',1,'{}')",['b'.repeat(64)])
  verifications=0
})
after(async()=>{await pool.end()})
async function submit(key='key') {
  await service.saveWorkflow(actor,'w',0,fixture())
  const approval_id=await service.approve(actor,'w',1,0.1)
  return service.submit(actor,{workflow_id:'w',revision:1,session_id:'session',idempotency_key:key,approval_id})
}
async function claim():Promise<Claim>{const c=await service.acquire({owner:'worker',projects:['p']});assert.ok(c);return c}
function output(claim:Claim,removed=0):Manifest {
  const kinds=claim.spec.operator==='split'?{train:'DatasetRef',validation:'DatasetRef',test:'DatasetRef',mapping:'SplitMapRef'}:claim.spec.operator==='fit'?{transformer:'TransformerRef'}:{data:'DatasetRef'}
  return {outputs:Object.fromEntries(Object.entries(kinds).map(([port,kind])=>[port,{kind,object_key:`${claim.job_id}/${claim.attempt_no}/${port}`,digest:'c'.repeat(64),bytes:10,metadata:{partition:port}}])) as Manifest['outputs'],impact:{removed_fraction:removed}}
}
test('migrations reapply without destroying business data',async()=>{
  await pool.query(await readFile(new URL('../../../database/migrations/001_data_agent.sql',import.meta.url),'utf8'))
  assert.equal((await pool.query('SELECT count(*) FROM data_agent.projects')).rows[0].count,'2')
})
test('server rejects viewer writes and cross-project snapshots',async()=>{
  await assert.rejects(service.saveWorkflow({...actor,actor_id:'viewer'},'w',0,fixture()),/FORBIDDEN/)
  const run=await submit()
  await assert.rejects(service.snapshot({project_id:'q',actor_id:'bob'},run.run_id),/FORBIDDEN/)
})
test('optimistic revision conflicts and stale approvals are rejected',async()=>{
  await service.saveWorkflow(actor,'w',0,fixture())
  const approval=await service.approve(actor,'w',1,0.1)
  await assert.rejects(service.saveWorkflow(actor,'w',0,fixture()),/VERSION_CONFLICT/)
  const edited=fixture(); edited.nodes[1].params.method='mean'
  await service.saveWorkflow(actor,'w',1,edited)
  await assert.rejects(service.submit(actor,{workflow_id:'w',revision:2,session_id:'s',idempotency_key:'k',approval_id:approval}),/MISSING_APPROVAL/)
})
test('concurrent submit returns a single run, and changed request conflicts',async()=>{
  await service.saveWorkflow(actor,'w',0,fixture());const approval_id=await service.approve(actor,'w',1,0.1)
  const req={workflow_id:'w',revision:1,session_id:'s',idempotency_key:'k',approval_id}
  const results=await Promise.all(Array.from({length:5},()=>service.submit(actor,req)))
  assert.equal(new Set(results.map(r=>r.run_id)).size,1)
  await assert.rejects(service.submit(actor,{...req,session_id:'different'}),/IDEMPOTENCY_CONFLICT/)
})
test('concurrent acquire claims only the ready node and downstream binds published ports',async()=>{
  const run=await submit()
  const claims=await Promise.all(Array.from({length:5},()=>service.acquire({owner:'worker',projects:['p']})))
  assert.equal(claims.filter(Boolean).length,1)
  const first=claims.find(Boolean)!;assert.equal(first.node_id,'split')
  await service.commit(first,output(first));const fit=await claim();assert.equal(fit.node_id,'fit')
  assert.equal(fit.inputs.train.kind,'DatasetRef');assert.ok(fit.inputs.train.artifact_id)
  await service.commit(fit,output(fit));const apply=await claim();await service.commit(apply,output(apply))
  const snap=await service.snapshot(actor,run.run_id);assert.equal(snap.status,'succeeded');assert.equal(snap.artifacts.length,6)
  assert.equal((await service.events(actor,run.run_id,snap.cursor)).length,0)
})
test('lost commit response replays exact receipt; different manifest conflicts',async()=>{
  await submit();const c=await claim();const m=output(c)
  const results=await Promise.all([service.commit(c,m),service.commit(c,m)])
  assert.deepEqual(results[0],results[1]);assert.equal((await pool.query('SELECT count(*) FROM data_agent.artifacts WHERE job_id=$1',[c.job_id])).rows[0].count,'4')
  const checks=verifications;await service.commit(c,m);assert.equal(verifications,checks)
  await assert.rejects(service.commit(c,output(c,0.05)),/IDEMPOTENCY_CONFLICT/)
})
test('expired workers cannot heartbeat or publish after recovery',async()=>{
  await submit();const first=await claim()
  await pool.query("UPDATE data_agent.jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[first.job_id])
  assert.equal(await service.recover(),1)
  const second=await claim();assert.equal(second.attempt_no,2)
  await assert.rejects(service.heartbeat(first),/STALE_ATTEMPT/)
  await assert.rejects(service.commit(first,output(first)),/STALE_ATTEMPT/)
  await service.commit(second,output(second))
})
test('candidate releases worker, is not retried, and cannot publish after cancellation',async()=>{
  const run=await submit();const c=await claim();const receipt=await service.commit(c,output(c,0.5))
  assert.equal(receipt.status,'waiting_approval');assert.equal(await service.recover(),0);assert.equal(await service.acquire({owner:'w2',projects:['p']}),null)
  assert.equal((await service.snapshot(actor,run.run_id)).artifacts.length,0)
  await service.cancel(actor,run.run_id)
  assert.equal((await service.snapshot(actor,run.run_id)).status,'cancelled')
  await assert.rejects(service.approveCandidate(actor,run.run_id,c.job_id,receipt.manifest_digest),/CANDIDATE_STALE/)
})
test('candidate approval is idempotent and requires unchanged intent',async()=>{
  const run=await submit();const c=await claim();const receipt=await service.commit(c,output(c,0.5))
  await Promise.all([service.approveCandidate(actor,run.run_id,c.job_id,receipt.manifest_digest),service.approveCandidate(actor,run.run_id,c.job_id,receipt.manifest_digest)])
  assert.equal((await service.snapshot(actor,run.run_id)).artifacts.length,4)
})
test('cancel remains requested until executor confirms exit, and blocks result',async()=>{
  const run=await submit();const c=await claim();await service.cancel(actor,run.run_id)
  assert.equal((await service.snapshot(actor,run.run_id)).status,'cancel_requested')
  await pool.query("UPDATE data_agent.jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[c.job_id]);await service.recover()
  assert.equal((await service.snapshot(actor,run.run_id)).status,'cancel_requested')
  await assert.rejects(service.commit(c,output(c)),/STALE_ATTEMPT/)
  await service.acknowledgeCancel(c);assert.equal((await service.snapshot(actor,run.run_id)).status,'cancelled')
})

test('real Python process computes DAG outputs and publishes verified bytes',async()=>{
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises')
  const {tmpdir}=await import('node:os')
  const {join,resolve}=await import('node:path')
  const {execFileSync}=await import('node:child_process')
  const {LocalStore}=await import('../src/local-store.ts')
  const {LocalExecutor}=await import('../src/local-executor.ts')
  const root=await mkdtemp(join(tmpdir(),'dsh-data-test-'))
  try {
    const input=join(root,'input.parquet')
    execFileSync(process.env.DATA_AGENT_TEST_PYTHON??'python3',['-c',"import polars as pl,sys; pl.DataFrame({'__row_id':[str(i) for i in range(500)],'income':[float(i%40) if i%7 else None for i in range(500)]}).write_parquet(sys.argv[1])",input])
    const store=new LocalStore(root);const checksum=await store.checksum('input.parquet')
    await pool.query("UPDATE data_agent.artifacts SET object_key='input.parquet',digest=$1,bytes=$2,metadata=$3 WHERE id='input'",[checksum.digest,checksum.bytes,{roles:{income:'feature'},source:'source',preview:false}])
    const workflow=fixture();(workflow.nodes[0].inputs.data as {digest:string}).digest=checksum.digest
    const live=new DataAgentService(pool,{lease_ms:60000,max_attempts:2,max_running_jobs:1},(c,m)=>store.verify(c,m))
    await live.saveWorkflow(actor,'w',0,workflow);const approval_id=await live.approve(actor,'w',1,0)
    const run=await live.submit(actor,{workflow_id:'w',revision:1,session_id:'s',idempotency_key:'python',approval_id})
    const executor=new LocalExecutor(live,store,{python:process.env.DATA_AGENT_TEST_PYTHON??execFileSync(process.env.DATA_AGENT_TEST_PYTHON??'python3',['-c','import sys; print(sys.executable)'],{encoding:'utf8'}).trim(),script:resolve('../../services/data-worker/execute.py'),heartbeat_ms:200,timeout_ms:10000,kill_grace_ms:500,max_output_bytes:100000,max_columns:100,polars_threads:2})
    for(let i=0;i<3;i++) { const result=await executor.once({owner:'local-worker',projects:['p']}); assert.equal(result!.status,'published',JSON.stringify(result)) }
    assert.equal(await executor.once({owner:'local-worker',projects:['p']}),null)
    const snapshot=await live.snapshot(actor,run.run_id)
    assert.equal(snapshot.status,'succeeded');assert.equal(snapshot.artifacts.length,6)
    const transformer=snapshot.artifacts.find(a=>a.kind==='TransformerRef')!
    assert.ok(transformer.digest)
    const record=(await pool.query('SELECT object_key FROM data_agent.artifacts WHERE id=$1',[transformer.id])).rows[0]
    await writeFile(await store.path(record.object_key),'corrupt')
    assert.notEqual((await store.checksum(record.object_key)).digest,transformer.digest)
    await assert.rejects(store.path('../outside'),/OBJECT_KEY/)
  } finally {await rm(root,{recursive:true,force:true})}
})

test('database publication failure leaves no formal outputs and retry can commit',async()=>{
  await submit();const c=await claim();const manifest=output(c)
  await pool.query("CREATE OR REPLACE FUNCTION data_agent.test_reject_output() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected database failure'; END $$; CREATE TRIGGER reject_output BEFORE INSERT ON data_agent.artifacts FOR EACH ROW EXECUTE FUNCTION data_agent.test_reject_output()")
  try {await assert.rejects(service.commit(c,manifest),/injected database failure/)}
  finally {await pool.query('DROP TRIGGER reject_output ON data_agent.artifacts; DROP FUNCTION data_agent.test_reject_output()')}
  assert.equal((await service.snapshot(actor,c.run_id)).artifacts.length,0)
  assert.equal((await service.commit(c,manifest)).status,'published')
})
test('old candidate approval after workflow edit is rejected',async()=>{
  await submit();const c=await claim();const receipt=await service.commit(c,output(c,0.5))
  const edited=fixture();edited.nodes[1].params.method='mean';await service.saveWorkflow(actor,'w',1,edited)
  await assert.rejects(service.approveCandidate(actor,c.run_id,c.job_id,receipt.manifest_digest),/VERSION_CONFLICT/)
})
test('progress is monotonic and every snapshot cursor covers committed state',async()=>{
  await submit();const c=await claim();await service.reportProgress(c,10)
  const first=await service.snapshot(actor,c.run_id)
  assert.deepEqual(first.nodes.find(n=>n.node_id==='split')!.progress,{processed:10})
  await assert.rejects(service.reportProgress(c,9),/PROGRESS_REGRESSION/)
  await service.reportProgress(c,20,100)
  const events=await service.events(actor,c.run_id,first.cursor)
  assert.equal(events.length,1);assert.equal(events[0].body.type,'node.progress')
})
test('node failure prevents new dependent work without deleting upstream output',async()=>{
  await submit();const first=await claim();await service.commit(first,output(first))
  const next=await claim();await service.fail(next,'TYPE_CONVERSION')
  const snapshot=await service.snapshot(actor,first.run_id)
  assert.equal(snapshot.status,'failed');assert.equal(snapshot.artifacts.length,4)
  assert.equal(await service.acquire({owner:'worker',projects:['p']}),null)
})

test('configured heavy-job budget queues a second ready run',async()=>{
  await submit()
  const approval_id=(await pool.query('SELECT id FROM data_agent.approvals WHERE project_id=$1',[actor.project_id])).rows[0].id
  await service.submit(actor,{workflow_id:'w',revision:1,session_id:'s2',idempotency_key:'second',approval_id})
  await claim()
  assert.equal(await service.acquire({owner:'second-worker',projects:['p']}),null)
})

test('internal HTTP binds worker identity, attempt credentials and persisted receipt replay',async()=>{
  const {createServer}=await import('node:http')
  const {createHash}=await import('node:crypto')
  const {createWorkerHandler}=await import('../src/worker-http.ts')
  await submit()
  const bootstrap='synthetic-worker-service-credential'
  const server=createServer(createWorkerHandler(service,{accounts:[{owner:'restricted-worker',projects:['p'],credential_sha256:createHash('sha256').update(bootstrap).digest('hex')}],max_body_bytes:10000}))
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address=server.address();assert.ok(address && typeof address!=='string')
  const request=async(path:string,token:string,body:unknown,extra:Record<string,string>={})=>{
    const result=await fetch(`http://127.0.0.1:${address.port}/v1/worker/${path}`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...extra},body:JSON.stringify(body)})
    return {status:result.status,body:await result.json() as Record<string,unknown>}
  }
  try {
    assert.equal((await request('acquire','invalid-service-credential',{})).status,403)
    assert.equal((await request('acquire',bootstrap,{projects:['q']})).status,400)
    assert.equal((await request('acquire',bootstrap,{padding:'x'.repeat(12000)})).status,413)
    assert.equal((await request('acquire',bootstrap,{}, {origin:'https://other.example'})).status,403)
    const result=await request('acquire',bootstrap,{})
    assert.equal(result.status,200)
    const token=result.body.credential as string;const c=result.body.claim as Claim
    assert.equal(c.owner,'restricted-worker');assert.equal(c.project_id,'p')
    const stored=(await pool.query('SELECT credential_hash FROM data_agent.attempts WHERE job_id=$1',[c.job_id])).rows[0].credential_hash
    assert.notEqual(stored,token);assert.equal(stored,createHash('sha256').update(token).digest('hex'))
    assert.equal((await request('heartbeat',bootstrap,{})).status,403)
    assert.equal((await request('heartbeat',token,{})).status,200)
    assert.equal((await request('heartbeat',token,{job_id:'other'})).status,400)
    const receipt=await request('submit',token,output(c));assert.equal(receipt.status,200)
    const replay=await request('submit',token,output(c));assert.deepEqual(replay.body,receipt.body)
    assert.equal((await request('submit',token,output(c,.01))).status,409)
    assert.equal((await request('heartbeat',token,{})).status,409)
  } finally {server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
})

test('actual Python deletion produces quarantined row references and waits for impact approval',async()=>{
  const {mkdtemp,rm,readFile:read}=await import('node:fs/promises')
  const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');const {execFileSync}=await import('node:child_process')
  const {LocalStore}=await import('../src/local-store.ts');const {LocalExecutor}=await import('../src/local-executor.ts')
  const root=await mkdtemp(join(tmpdir(),'dsh-delete-test-'))
  try {
    execFileSync(process.env.DATA_AGENT_TEST_PYTHON??'python3',['-c',"import polars as pl,sys; pl.DataFrame({'__row_id':['a','b','c','d'],'income':[1.,2.,3.,4.]}).write_parquet(sys.argv[1])",join(root,'input.parquet')])
    const store=new LocalStore(root);const checksum=await store.checksum('input.parquet')
    await pool.query("UPDATE data_agent.artifacts SET object_key='input.parquet',digest=$1,bytes=$2,metadata=$3 WHERE id='input'",[checksum.digest,checksum.bytes,{roles:{income:'feature'},source:'source',preview:false}])
    const workflow=fixture();workflow.nodes=[{id:'filter',operator:'filter_rows',operator_version:'1',params:{condition:{column:'income',comparison:'gt',value:2},keep_null:false},inputs:{data:{artifact_id:'input',project_id:'p',kind:'DatasetRef',digest:checksum.digest}}}]
    const live=new DataAgentService(pool,{lease_ms:60000,max_attempts:2,max_running_jobs:1},(c,m)=>store.verify(c,m))
    await live.saveWorkflow(actor,'w',0,workflow);const approval_id=await live.approve(actor,'w',1,.1)
    const run=await live.submit(actor,{workflow_id:'w',revision:1,session_id:'s',idempotency_key:'delete',approval_id})
    const executor=new LocalExecutor(live,store,{python:execFileSync(process.env.DATA_AGENT_TEST_PYTHON??'python3',['-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim(),script:resolve('../../services/data-worker/execute.py'),heartbeat_ms:200,timeout_ms:10000,kill_grace_ms:500,max_output_bytes:100000,max_columns:100,polars_threads:2})
    const receipt=await executor.once({owner:'worker',projects:['p']})
    assert.equal(receipt!.status,'waiting_approval');assert.equal((await live.snapshot(actor,run.run_id)).artifacts.length,0)
    const attempt=(await pool.query('SELECT a.* FROM data_agent.attempts a JOIN data_agent.jobs j ON a.job_id=j.id WHERE j.run_id=$1',[run.run_id])).rows[0]
    assert.equal(attempt.manifest.impact.removed_fraction,.5)
    const report=JSON.parse(await read(await store.path(attempt.manifest.outputs.report.object_key),'utf8'))
    assert.equal(report.removed_rows,2)
    const removed=execFileSync(process.env.DATA_AGENT_TEST_PYTHON??'python3',['-c',"import polars as pl,sys,json; print(json.dumps(pl.read_parquet(sys.argv[1])['__row_id'].sort().to_list()))",await store.path(attempt.manifest.outputs.removed.object_key)],{encoding:'utf8'})
    assert.deepEqual(JSON.parse(removed),['a','b'])
    await live.approveCandidate(actor,run.run_id,attempt.job_id,attempt.manifest_digest)
    assert.equal((await live.snapshot(actor,run.run_id)).status,'succeeded')
  } finally {await rm(root,{recursive:true,force:true})}
})

test('dsh profile mounts authenticated Worker routes and awaits SIGTERM cleanup', {timeout:45000}, async()=>{
  const {hostSmoke}=await import('./host-smoke.ts')
  await hostSmoke(testUrl)
})

test('dsh refuses a newer database schema and exits without leaking its credential', {timeout:45000}, async()=>{
  const {hostSmoke}=await import('./host-smoke.ts')
  await pool.query('INSERT INTO data_agent.schema_versions(version) VALUES(99)')
  try {await hostSmoke(testUrl,'DATA_AGENT_SCHEMA_VERSION')}
  finally {await pool.query('DELETE FROM data_agent.schema_versions WHERE version=99')}
})

test('remote Worker transfers objects over HTTP and publishes a Docker-computed report', {timeout:90000,skip:!process.env.DATA_AGENT_TEST_IMAGE}, async()=>{
  const {remoteSmoke}=await import('./remote-smoke.ts')
  await remoteSmoke(pool,process.env.DATA_AGENT_TEST_IMAGE!)
})

test('remote cancellation waits for the actual compute container to stop', {timeout:90000,skip:!process.env.DATA_AGENT_ISOLATION_IMAGE}, async()=>{
  const {remoteSmoke}=await import('./remote-smoke.ts')
  await remoteSmoke(pool,process.env.DATA_AGENT_ISOLATION_IMAGE!,true)
})

test('data center resumes multipart upload and creates immutable Docker import versions', {timeout:90000,skip:!process.env.DATA_AGENT_TEST_IMAGE},async()=>{
  const {catalogSmoke}=await import('./catalog-smoke.ts')
  await catalogSmoke(pool,process.env.DATA_AGENT_TEST_IMAGE!)
})

test('Skill lifecycle gates release and preserves locked snapshots across edits, rollback and retirement',async()=>{
  const {lifecycleSmoke}=await import('./lifecycle-smoke.ts')
  await lifecycleSmoke(pool)
})

test('Worker restart stops an orphan container before acknowledging an expired cancellation', {timeout:90000,skip:!process.env.DATA_AGENT_ISOLATION_IMAGE},async()=>{
  const {remoteSmoke}=await import('./remote-smoke.ts')
  await remoteSmoke(pool,process.env.DATA_AGENT_ISOLATION_IMAGE!,'restart')
})

test(process.env.DATA_AGENT_REAL_MODEL?'real dsh session uses DeepSeek to submit an identity-bound diagnostic run':'real dsh session binds identity, executes scoped tools and restores locked Skill snapshots',async()=>{const {lifecycleSmoke}=await import('./lifecycle-smoke.ts');if(!process.env.DATA_AGENT_QUALITY_EVAL)await lifecycleSmoke(pool);const {hostSmoke}=await import('./host-smoke.ts');await hostSmoke(testUrl,undefined,pool)})

function proposalFixture() {
  const workflow=fixture(),ref=workflow.nodes[0].inputs.data
  return {workflow_id:'proposal-flow',expected_revision:0,session_id:null,goal:'Prepare training data',workflow,evidence:[{ref,inputs:[ref],scope:'full',description:'Published input schema; confirm entity split and train-only fit'}],expected_impact:[{node_id:'split',description:'Partition all rows without deleting rows',basis:'full'},{node_id:'fit',description:'Fit median on train only',basis:'full'}],unmet_prerequisites:[]}
}
test('unified proposals persist evidence, require human decisions and submit idempotently',async()=>{
  const proposal=await service.propose(actor,proposalFixture())
  assert.equal(proposal.body.confirmations.length,2)
  assert.equal(proposal.body.input_versions.length,1)
  await assert.rejects(service.submitProposal(actor,proposal.proposal_id,'approved-run'),/MISSING_APPROVAL/)
  await assert.rejects(service.decideProposal({...actor,actor_id:'viewer'},proposal.proposal_id,{action:'approve',digest:proposal.digest,max_removed_fraction:.1,reason:'Reviewed'}),/FORBIDDEN/)
  const decision={action:'approve',digest:proposal.digest,max_removed_fraction:.1,reason:'Reviewed split, input and train fit'}
  assert.deepEqual(await service.decideProposal(actor,proposal.proposal_id,decision),{status:'approved'})
  assert.deepEqual(await service.decideProposal(actor,proposal.proposal_id,decision),{status:'approved'})
  const run=await service.submitProposal(actor,proposal.proposal_id,'approved-run')
  assert.deepEqual(await service.submitProposal(actor,proposal.proposal_id,'approved-run'),run)
  assert.equal((await service.proposal(actor,proposal.proposal_id)).decisions.length,1)
  const changed=proposalFixture();changed.expected_revision=1;changed.workflow.nodes[1].params.method='mean'
  const changedProposal=await service.propose(actor,changed)
  assert.deepEqual(changedProposal.body.affected_nodes,['apply','fit'])
  assert.equal((await service.proposal(actor,proposal.proposal_id)).stale,true)
  await assert.rejects(service.submitProposal(actor,proposal.proposal_id,'fresh-run'),/VERSION_CONFLICT/)
  assert.deepEqual(await service.submitProposal(actor,proposal.proposal_id,'approved-run'),run)
})
test('proposal validation rolls back draft changes and unresolved prerequisites block approval',async()=>{
  await assert.rejects(service.propose(actor,{...proposalFixture(),evidence:[]}),/EVIDENCE_REQUIRED/)
  assert.equal((await pool.query('SELECT count(*) FROM data_agent.workflows')).rows[0].count,'0')
  const proposal=await service.propose(actor,{...proposalFixture(),unmet_prerequisites:['Business owner must confirm target meaning']})
  await assert.rejects(service.decideProposal(actor,proposal.proposal_id,{action:'approve',digest:proposal.digest,max_removed_fraction:0,reason:'Proceed'}),/PREREQUISITES_UNMET/)
  await service.decideProposal(actor,proposal.proposal_id,{action:'reject',digest:proposal.digest,reason:'Clarify target meaning'})
  await assert.rejects(service.submitProposal(actor,proposal.proposal_id,'rejected'),/MISSING_APPROVAL/)
  await assert.rejects(service.decideProposal(actor,proposal.proposal_id,{action:'approve',digest:proposal.digest,max_removed_fraction:0,reason:'Changed mind'}),/DECISION_CONFLICT/)
})
test('concurrent proposal writers share the canvas optimistic revision lock',async()=>{
  const attempts=await Promise.allSettled([service.propose(actor,proposalFixture()),service.propose(actor,proposalFixture())])
  assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1)
  assert.equal((await pool.query('SELECT count(*) FROM data_agent.proposals')).rows[0].count,'1')
})
test('candidate review exposes actual impact and rejection never publishes or schedules descendants',async()=>{
  const run=await submit(),c=await claim(),receipt=await service.commit(c,output(c,.2))
  const candidate=await service.candidate(actor,run.run_id,c.job_id)
  assert.equal(candidate.actual_impact.removed_fraction,.2)
  assert.ok(!JSON.stringify(candidate).includes('object_key'))
  await assert.rejects(service.rejectCandidate(actor,run.run_id,c.job_id,'d'.repeat(64),'Reject'),/CANDIDATE_STALE/)
  await service.rejectCandidate(actor,run.run_id,c.job_id,receipt.manifest_digest,'Too many rows removed')
  await assert.rejects(service.approveCandidate(actor,run.run_id,c.job_id,receipt.manifest_digest),/CANDIDATE_STALE/)
  assert.equal((await service.snapshot(actor,run.run_id)).artifacts.length,0)
  assert.equal((await service.snapshot(actor,run.run_id)).status,'failed')
  assert.equal(await service.acquire({owner:'worker',projects:['p']}),null)
})

test('candidate publication rechecks object integrity after review waiting',async()=>{
  let intact=true
  const verified=new DataAgentService(pool,{lease_ms:60000,max_attempts:2,max_running_jobs:1},async()=>{if(!intact)throw new Error('OBJECT_CHECKSUM')})
  const run=await submit(),c=await claim(),receipt=await verified.commit(c,output(c,.2))
  intact=false
  await assert.rejects(verified.approveCandidate(actor,run.run_id,c.job_id,receipt.manifest_digest),/OBJECT_CHECKSUM/)
  assert.equal((await verified.snapshot(actor,run.run_id)).status,'waiting_approval')
  assert.equal((await verified.snapshot(actor,run.run_id)).artifacts.length,0)
  intact=true
  await verified.approveCandidate(actor,run.run_id,c.job_id,receipt.manifest_digest)
  assert.equal((await verified.snapshot(actor,run.run_id)).artifacts.length,4)
})
test('proposal evidence refuses foreign identities and sample-to-full relabelling',async()=>{
  const value=proposalFixture()
  value.evidence[0].ref={...value.evidence[0].ref,project_id:'q'}
  await assert.rejects(service.propose(actor,value),/FORBIDDEN/)
  await pool.query("UPDATE data_agent.artifacts SET metadata='{\"preview\":true}' WHERE id='input'")
  await assert.rejects(service.propose(actor,proposalFixture()),/EVIDENCE_SCOPE/)
  assert.equal((await pool.query('SELECT count(*) FROM data_agent.proposals')).rows[0].count,'0')
})

test('proposal business validation blocks protected fields before draft creation',async()=>{
  await pool.query("UPDATE data_agent.artifacts SET metadata='{\"roles\":{\"income\":\"feature\",\"target\":\"target\",\"id\":\"entity_id\"}}' WHERE id='input'")
  const value=proposalFixture();value.workflow.nodes[1].params.columns=['target']
  await assert.rejects(service.propose(actor,value),/PROTECTED_FIELD/)
  assert.equal((await pool.query('SELECT count(*) FROM data_agent.workflow_versions')).rows[0].count,'0')
})

const taskService=new DataAgentService(pool,{lease_ms:60000,max_attempts:2,max_running_jobs:1,runtime:{environment_digest:'a'.repeat(64),policy_version:'policy1'}},async()=>{},async key=>({digest:key==='input'?'b'.repeat(64):'c'.repeat(64),bytes:key==='input'?1:10}))
const rootRef={kind:'DatasetRef' as const,project_id:'p',artifact_id:'input',digest:'b'.repeat(64)}
async function businessTask(){return (await taskService.createTask(actor,{name:'Training data',goal:'Prepare a verified training export',dataset:rootRef,idempotency_key:'task'})).task_id}
async function approvedGraph(id:string,workflow=fixture(),expected=0){
 const p=await taskService.propose(actor,{workflow_id:id,expected_revision:expected,session_id:null,goal:'Reviewed phase',workflow,evidence:[{ref:rootRef,inputs:[rootRef],scope:'full',description:'Exact source'}],expected_impact:workflow.nodes.filter(n=>['split','fit'].includes(n.operator)).map(n=>({node_id:n.id,description:'Confirmed operation',basis:'full'})),unmet_prerequisites:[]})
 await taskService.decideProposal(actor,p.proposal_id,{action:'approve',digest:p.digest,reason:'Reviewed synthetic case',max_removed_fraction:0.1});return p.proposal_id
}
async function taskRun(task:string,proposal_id:string,overrides:Record<string,unknown>={}){
 return taskService.submitTask(actor,task,{proposal_id,stage:'analysis',previous_run_id:null,source_run_id:null,scope:{kind:'all'},reuse:false,select:true,expected_revision:0,idempotency_key:'task-run',...overrides})
}
async function finishRun(){while(true){const c=await taskService.acquire({owner:'worker',projects:['p']});if(!c)break;await taskService.commit(c,output(c))}}

test('business task requires ordered completed stages; branch creation preserves selection and idempotency',async()=>{
 const task=await businessTask(),proposal=await approvedGraph('task-w')
 await assert.rejects(taskRun(task,proposal,{stage:'features'}),/STAGE_ORDER/)
 const first=await taskRun(task,proposal)
 await assert.rejects(taskRun(task,proposal,{stage:'processing',previous_run_id:first.run_id,expected_revision:1,idempotency_key:'early'}),/PREVIOUS_RUN_INCOMPLETE/)
 await finishRun()
 assert.equal((await taskService.taskSnapshot(actor,task)).status,'awaiting_next_stage')
 const request={scope:{kind:'all'},reuse:true,select:false,expected_revision:1,idempotency_key:'branch'}
 const branches=await Promise.all([taskService.rerun(actor,first.run_id,request),taskService.rerun(actor,first.run_id,request)])
 assert.equal(branches[0].run_id,branches[1].run_id)
 const snap=await taskService.taskSnapshot(actor,task)
 assert.equal(snap.selected_run_id,first.run_id);assert.equal(snap.runs.length,2)
 const replay=await taskService.snapshot(actor,branches[0].run_id)
 assert.equal(replay.status,'succeeded');assert.ok(replay.nodes.every(n=>n.attempt_no===0&&n.reused_from_job_id));assert.equal(replay.artifacts.length,6)
 await assert.rejects(taskService.selectTask(actor,task,branches[0].run_id,1),/VERSION_CONFLICT/)
 await taskService.selectTask(actor,task,branches[0].run_id,2)
 assert.equal((await taskService.taskSnapshot(actor,task)).selected_run_id,branches[0].run_id)
 await assert.rejects(taskService.taskSnapshot({project_id:'q',actor_id:'bob'},task),/TASK_NOT_FOUND/)
 await assert.rejects(taskService.createTask({...actor,actor_id:'viewer'},{name:'x',goal:'x',dataset:rootRef,idempotency_key:'x'}),/FORBIDDEN/)
})
test('frozen replay ignores current draft and preserves original locks; scopes exclude nodes and force descendants',async()=>{
 const task=await businessTask(),proposal=await approvedGraph('task-w')
 await pool.query("INSERT INTO data_agent.skill_definitions VALUES('p','locked-skill',1,'{}','1.0.0')")
 await pool.query("INSERT INTO data_agent.skill_versions(project_id,skill_id,version,digest,snapshot,status,reason,actor_id) VALUES('p','locked-skill','1.0.0',$1,$2,'released','Synthetic persisted lock fixture','alice')",['d'.repeat(64),{files:{'SKILL.md':'Original locked instructions'}}])
 await pool.query("INSERT INTO data_agent.skill_invocations(id,project_id,skill_id,version,digest,actor_id,session_id,input,runtime) VALUES('lock','p','locked-skill','1.0.0',$1,'alice',$2,'{}','{}')",['d'.repeat(64),proposal])
 const first=await taskRun(task,proposal);await finishRun()
 await pool.query("UPDATE data_agent.skill_versions SET status='retired' WHERE skill_id='locked-skill'; UPDATE data_agent.skill_definitions SET default_version=NULL WHERE id='locked-skill'")
 const changed=fixture();changed.nodes[1].params.method='mean';await service.saveWorkflow(actor,'task-w',1,changed)
 const through=await taskService.rerun(actor,first.run_id,{scope:{kind:'through',node_id:'split'},reuse:true,select:false,expected_revision:1,idempotency_key:'through'})
 const limited=await taskService.snapshot(actor,through.run_id);assert.equal(limited.status,'succeeded');assert.equal(limited.nodes.filter(n=>n.status==='not_selected').length,2)
 const next=await taskService.rerun(actor,first.run_id,{scope:{kind:'from',node_id:'fit'},reuse:true,select:false,expected_revision:2,idempotency_key:'from'})
 const snap=await taskService.snapshot(actor,next.run_id);assert.equal(snap.nodes.find(n=>n.node_id==='split')!.status,'succeeded');assert.equal(snap.nodes.find(n=>n.node_id==='fit')!.status,'pending')
 const c=await taskService.acquire({owner:'worker',projects:['p']});assert.ok(c);assert.equal(c.spec.params.method,'median');assert.deepEqual(c.recipe?.skill_locks,(await pool.query('SELECT snapshot FROM data_agent.runs WHERE id=$1',[first.run_id])).rows[0].snapshot.skill_locks);assert.equal((c.recipe?.skill_locks as {version:string;snapshot:{files:Record<string,string>}}[])[0].snapshot.files['SKILL.md'],'Original locked instructions');assert.equal(c.recipe?.semantic_digest,(await pool.query('SELECT snapshot FROM data_agent.runs WHERE id=$1',[first.run_id])).rows[0].snapshot.semantic_digest)
 const mismatch=new DataAgentService(pool,{lease_ms:1000,max_attempts:1,max_running_jobs:1,runtime:{policy_version:'changed',environment_digest:'a'.repeat(64)}},async()=>{})
 await assert.rejects(mismatch.rerun(actor,first.run_id,{scope:{kind:'all'},reuse:true,select:false,expected_revision:3,idempotency_key:'mismatch'}),/RUNTIME_INCOMPATIBLE/)
})
test('missing cache bytes cause recomputation; changed proposal invalidates descendants only',async()=>{
 const task=await businessTask(),proposal=await approvedGraph('task-w'),first=await taskRun(task,proposal);await finishRun()
 const missing=new DataAgentService(pool,taskService.config,async()=>{},async()=>{throw new Error('missing')})
 const replay=await missing.rerun(actor,first.run_id,{scope:{kind:'all'},reuse:true,select:false,expected_revision:1,idempotency_key:'missing'})
 assert.ok((await taskService.snapshot(actor,replay.run_id)).nodes.every(n=>n.status==='pending'))
 await taskService.cancel(actor,replay.run_id)
 const changed=fixture();changed.nodes[1].params.method='mean'
 const edited=await approvedGraph('task-w',changed,1)
 const patched=await taskRun(task,edited,{source_run_id:first.run_id,reuse:true,select:false,expected_revision:2,idempotency_key:'patched'})
 const nodes=(await taskService.snapshot(actor,patched.run_id)).nodes
 assert.ok(nodes.find(n=>n.node_id==='split')!.reused_from_job_id)
 assert.equal(nodes.find(n=>n.node_id==='fit')!.status,'pending');assert.equal(nodes.find(n=>n.node_id==='apply')!.status,'pending')
})
test('pause stops acquisition at node boundaries; task cancel drains active attempts and blocks new phases',async()=>{
 const task=await businessTask(),proposal=await approvedGraph('task-w'),first=await taskRun(task,proposal)
 const active=await taskService.acquire({owner:'worker',projects:['p']});assert.ok(active)
 await taskService.pause(actor,first.run_id,true);await taskService.commit(active,output(active))
 assert.equal(await taskService.acquire({owner:'worker',projects:['p']}),null)
 await taskService.pause(actor,first.run_id,false)
 const fit=await taskService.acquire({owner:'worker',projects:['p']});assert.ok(fit)
 const branch=await taskService.rerun(actor,first.run_id,{scope:{kind:'all'},reuse:false,select:false,expected_revision:1,idempotency_key:'other'})
 await taskService.cancelTask(actor,task)
 assert.equal((await taskService.snapshot(actor,branch.run_id)).status,'cancelled')
 assert.equal((await taskService.taskSnapshot(actor,task)).status,'cancel_requested')
 await taskService.cancel(actor,first.run_id);await taskService.cancel(actor,first.run_id)
 assert.equal((await taskService.snapshot(actor,first.run_id)).status,'cancel_requested')
 await taskService.acknowledgeCancel(fit)
 const snap=await taskService.taskSnapshot(actor,task);assert.equal(snap.status,'cancelled')
 assert.equal((await taskService.snapshot(actor,first.run_id)).artifacts.length,4)
 await assert.rejects(taskService.rerun(actor,first.run_id,{scope:{kind:'all'},reuse:false,select:false,expected_revision:snap.revision,idempotency_key:'after'}),/TASK_CANCELLED/)
})
test('business task completes only after real training export; cached lineage retains original artifact versions',async()=>{
 const {taskExportSmoke}=await import('./task-export-smoke.ts');await taskExportSmoke(pool)
})

test('remote Worker publishes a verified training bundle over HTTP',{timeout:90000,skip:!process.env.DATA_AGENT_TEST_IMAGE},async()=>{
 const {remoteSmoke}=await import('./remote-smoke.ts');await remoteSmoke(pool,process.env.DATA_AGENT_TEST_IMAGE!,false,true)
})

test('cache keys bind schema and role metadata even when content bytes are unchanged',async()=>{
 const task=await businessTask(),proposal=await approvedGraph('task-w'),first=await taskRun(task,proposal);await finishRun()
 await pool.query("UPDATE data_agent.artifacts SET metadata=$1 WHERE id='input'",[{roles:{income:'ignore'},schema:{income:'Float64'}}])
 const replay=await taskService.rerun(actor,first.run_id,{scope:{kind:'all'},reuse:true,select:false,expected_revision:1,idempotency_key:'roles'})
 assert.ok((await taskService.snapshot(actor,replay.run_id)).nodes.every(node=>node.status==='pending'))
})

test('task cancellation waits for a publishing run without blocking its project foreign key',async()=>{
 const task=await businessTask(),proposal=await approvedGraph('task-w'),run=await taskRun(task,proposal)
 const publisher=await pool.connect();let cancellation:Promise<unknown>|undefined
 try{
  await publisher.query('BEGIN');await publisher.query('SELECT id FROM data_agent.runs WHERE id=$1 FOR UPDATE',[run.run_id])
  cancellation=taskService.cancelTask(actor,task)
  const deadline=Date.now()+3000
  let waiting=false
  while(Date.now()<deadline){
   waiting=Boolean((await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM data_agent.runs WHERE business_task_id=%'")).rowCount)
   if(waiting)break
   await new Promise(resolve=>setTimeout(resolve,10))
  }
  assert.ok(waiting,'Cancellation must reach the held Run lock')
  await publisher.query('SELECT id FROM data_agent.projects WHERE id=$1 FOR KEY SHARE NOWAIT',['p'])
 }finally{await publisher.query('ROLLBACK');publisher.release();await cancellation}
 assert.equal((await taskService.taskSnapshot(actor,task)).status,'cancelled')
})

test('task cancellation waits for live attempts even when another node has already failed the Run',async()=>{
 const parallel=new DataAgentService(pool,{...taskService.config,max_running_jobs:2},async()=>{})
 const task=await businessTask(),workflow=fixture()
 workflow.nodes=['left','right'].map(id=>({id,operator:'inspect',operator_version:'1',params:{},inputs:{data:rootRef}}))
 const proposal=await approvedGraph('task-w',workflow),run=await taskRun(task,proposal)
 const first=await parallel.acquire({owner:'worker',projects:['p']}),second=await parallel.acquire({owner:'worker',projects:['p']});assert.ok(first&&second)
 await parallel.fail(first,'EXECUTION_FAILED');assert.equal((await service.snapshot(actor,run.run_id)).status,'failed')
 await parallel.cancelTask(actor,task);assert.equal((await parallel.taskSnapshot(actor,task)).status,'cancel_requested')
 await parallel.acknowledgeCancel(second);assert.equal((await parallel.taskSnapshot(actor,task)).status,'cancelled')
})


test('workbench templates retain revisions and reject viewer and foreign-project writes',async()=>{
 const workbench=new Workbench(pool),page={search:'',offset:0,limit:30}
 assert.deepEqual(await workbench.saveTemplate(actor,'template',{name:'Training',expected_revision:0,workflow:fixture()}),{id:'template',revision:1})
 await assert.rejects(workbench.saveTemplate(actor,'template',{name:'Stale',expected_revision:0,workflow:fixture()}),/VERSION_CONFLICT/)
 await assert.rejects(workbench.saveTemplate({...actor,actor_id:'viewer'},'other',{name:'Denied',expected_revision:0,workflow:fixture()}),/FORBIDDEN/)
 await assert.rejects(workbench.saveTemplate({project_id:'q',actor_id:'bob'},'other',{name:'Foreign',expected_revision:0,workflow:fixture()}),/FORBIDDEN/)
 assert.equal((await workbench.templates(actor,page))[0].revision,1)
 assert.equal((await workbench.templates({project_id:'q',actor_id:'bob'},page)).length,0)
 await service.saveWorkflow(actor,'history',0,fixture())
 const edited=fixture();edited.seed=19
 await service.saveWorkflow(actor,'history',1,edited)
 assert.equal((await workbench.workflow(actor,'history',1)).body.seed,42)
 assert.equal((await workbench.workflow(actor,'history')).revision,2)
 await pool.query("INSERT INTO data_agent.skill_definitions(project_id,id,revision,draft) VALUES('p','custom',1,'{\"manifest\":{\"description\":\"Candidate\"}}')")
 const skills=await workbench.skills(actor,page)
 assert.equal(skills.length,1);assert.equal(skills[0].id,'custom');assert.equal(skills[0].default_version,null);assert.equal(skills[0].status,null);assert.equal(skills[0].evaluation,null)
 assert.equal((await workbench.skills({project_id:'q',actor_id:'bob'},page)).length,0)
})
test('workbench session search, rename and navigation remain owner scoped',async()=>{
 const workbench=new Workbench(pool),input={dataset:{artifact_id:'input'},goal:'Initial'}
 await pool.query("INSERT INTO data_agent.harness_sessions(id,project_id,actor_id,input,runtime,provider,status) VALUES('session-a','p','alice',$1,'{}','fixture','ready'),('session-b','p','viewer',$1,'{}','fixture','ready')",[input])
 await workbench.rename(actor,'session-a',{title:'September analysis'})
 assert.deepEqual((await workbench.sessions(actor,{search:'SEPTEMBER',offset:0,limit:1})).map(row=>row.id),['session-a'])
 assert.deepEqual((await workbench.sessions(actor,{search:'INITIAL',offset:0,limit:1})).map(row=>row.id),['session-a'])
 assert.equal((await workbench.sessions(actor,{search:'Initial',offset:1,limit:1})).length,0)
 assert.equal((await workbench.sessions(actor,{search:'%',offset:0,limit:30})).length,0)
 await assert.rejects(workbench.rename(actor,'session-b',{title:'Denied'}),/SESSION_FORBIDDEN/)
 await assert.rejects(workbench.navigation(actor,'session-b'),/SESSION_FORBIDDEN/)
 assert.deepEqual(await workbench.navigation(actor,'session-a'),{runs:[],proposals:[]})
})

test('workbench history deletion rejects other owners and active runs, preserving data',async()=>{
 const workbench=new Workbench(pool),input={dataset:{artifact_id:'input'},goal:'Disposable'}
 await pool.query("INSERT INTO data_agent.harness_sessions(id,project_id,actor_id,input,runtime,provider,status) VALUES('session-a','p','alice',$1,'{}','fixture','ready'),('session-b','p','viewer',$1,'{}','fixture','ready')",[input])
 await assert.rejects(workbench.removeSession(actor,'session-b'),/SESSION_FORBIDDEN/)
 await assert.rejects(workbench.removeSession({project_id:'p',actor_id:'viewer'},'session-b'),/FORBIDDEN/)
 await pool.query("INSERT INTO data_agent.runs(id,project_id,session_id,actor_id,idempotency_key,request_digest,snapshot,status,max_removed_fraction) VALUES('busy','p','session-a','alice','busy','digest','{}','running',0.1)")
 await assert.rejects(workbench.removeSession(actor,'session-a'),/SESSION_BUSY/)
 await pool.query("UPDATE data_agent.runs SET status='succeeded' WHERE id='busy'")
 assert.deepEqual(await workbench.removeSession(actor,'session-a'),{session_id:'session-a',deleted:true})
 assert.equal((await workbench.sessions(actor,{search:'',offset:0,limit:30})).length,0)
 await assert.rejects(workbench.navigation(actor,'session-a'),/SESSION_FORBIDDEN/)
 assert.equal((await pool.query("SELECT 1 FROM data_agent.artifacts WHERE id='input'")).rowCount,1)
 assert.equal((await pool.query("SELECT 1 FROM data_agent.runs WHERE id='busy'")).rowCount,1)
})
