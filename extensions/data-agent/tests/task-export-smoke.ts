/** Real Python execution proves task completion requires a published training bundle. */
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import type {Pool} from 'pg'
import {DataAgentService} from '../src/service.ts'
import {LocalStore} from '../src/local-store.ts'
import {LocalExecutor} from '../src/local-executor.ts'
import {operators,type ArtifactRef,type Workflow} from '../src/contracts.ts'
/** Execute the selected phases and verify historical export reuse and corruption misses.
 * @param pool - Disposable migrated PostgreSQL database with the input row.
 */
export async function taskExportSmoke(pool:Pool){
 const root=await mkdtemp(join(tmpdir(),'task-export-')),python=process.env.DATA_AGENT_TEST_PYTHON??'python3',actor={project_id:'p',actor_id:'alice'}
 try{
  execFileSync(python,['-c',"import polars as pl,sys;pl.DataFrame({'__row_id':[str(i) for i in range(200)],'income':[None if i%7==0 else float(i) for i in range(200)]}).write_parquet(sys.argv[1])",join(root,'input.parquet')])
  const store=new LocalStore(root),checksum=await store.checksum('input.parquet')
  await pool.query("UPDATE data_agent.artifacts SET object_key='input.parquet',digest=$1,bytes=$2,metadata=$3 WHERE id='input'",[checksum.digest,checksum.bytes,{roles:{income:'feature'},source:'source',preview:false}])
  const service=new DataAgentService(pool,{lease_ms:60000,max_attempts:2,max_running_jobs:1,runtime:{policy_version:'policy1',environment_digest:'a'.repeat(64)}},(c,m)=>store.verify(c,m),key=>store.checksum(key))
  const executor=new LocalExecutor(service,store,{python,script:fileURLToPath(new URL('../../../services/data-worker/execute.py',import.meta.url)),heartbeat_ms:200,timeout_ms:10000,kill_grace_ms:500,max_output_bytes:100000,max_columns:100,polars_threads:2})
  const input:ArtifactRef={artifact_id:'input',project_id:'p',kind:'DatasetRef',digest:checksum.digest}
  const task=(await service.createTask(actor,{name:'Training contract',goal:'Prepare income features',dataset:input,idempotency_key:'export-task'})).task_id
  let previous:string|null=null,revision=0
  async function phase(stage:'analysis'|'processing'|'features',nodes:Workflow['nodes'],source:ArtifactRef){
   const workflow:Workflow={schema_version:'1',project_id:'p',environment_digest:'a'.repeat(64),policy_version:'policy1',seed:42,nodes}
   const proposal=await service.propose(actor,{workflow_id:stage,expected_revision:0,session_id:null,goal:stage,workflow,evidence:[{ref:source,inputs:[source],scope:'full',description:'Published full dataset'}],expected_impact:nodes.filter(n=>operators[n.operator].approval).map(n=>({node_id:n.id,description:'Reviewed transform',basis:'full'})),unmet_prerequisites:[]})
   await service.decideProposal(actor,proposal.proposal_id,{action:'approve',digest:proposal.digest,reason:'Synthetic full-data review',max_removed_fraction:0})
   const run=await service.submitTask(actor,task,{proposal_id:proposal.proposal_id,stage,previous_run_id:previous,source_run_id:null,scope:{kind:'all'},reuse:false,select:true,expected_revision:revision++,idempotency_key:stage});previous=run.run_id
   for(let i=0;i<nodes.length;i++)assert.equal((await executor.once({owner:'worker',projects:['p']}))?.status,'published')
   assert.equal((await service.snapshot(actor,run.run_id)).status,'succeeded');return run.run_id
  }
  const analysis=await phase('analysis',[{id:'inspect',operator:'inspect',operator_version:'1',params:{},inputs:{data:input}}],input)
  assert.equal((await service.taskSnapshot(actor,task)).status,'awaiting_next_stage')
  const processing=await phase('processing',[{id:'fill',operator:'fill_constant',operator_version:'1',params:{columns:['income'],value:0},inputs:{data:input}}],input)
  const data=(await service.snapshot(actor,processing)).artifacts.find(a=>a.kind==='DatasetRef')!
  const processed:ArtifactRef={artifact_id:data.id,project_id:'p',kind:'DatasetRef',digest:data.digest}
  const features=await phase('features',[
   {id:'split',operator:'split',operator_version:'1',params:{method:'random',train_fraction:0.6,validation_fraction:0.2},inputs:{data:processed}},
   {id:'export',operator:'export',operator_version:'1',params:{feature_columns:['income'],purpose:'unsupervised',allow_null:false},inputs:Object.fromEntries(['train','validation','test'].map(port=>[port,{node_id:'split',output_port:port}]))},
  ],processed)
  await pool.query(await readFile(new URL('../../../database/migrations/007_business_tasks.sql',import.meta.url),'utf8'))
  const completed=await service.taskSnapshot(actor,task);assert.equal(completed.status,'completed');assert.equal(completed.final_export_refs.length,1)
  const bundle=(await pool.query('SELECT object_key FROM data_agent.artifacts WHERE id=$1',[completed.final_export_refs[0].id])).rows[0]
  const check=execFileSync(python,['-c',"import json,zipfile,sys,hashlib;z=zipfile.ZipFile(sys.argv[1]);m=json.loads(z.read('manifest.json'));assert all(hashlib.sha256(z.read(k)).hexdigest()==v['sha256'] for k,v in m['files'].items());p=json.loads(z.read('recipe.json'))['plan'];assert p['business_task_id']==sys.argv[2];print(m['status'])",await store.path(bundle.object_key),task],{encoding:'utf8'})
  assert.equal(check.trim(),'ready_for_training_contract')
  const replay=await service.rerun(actor,features,{scope:{kind:'all'},reuse:true,select:false,expected_revision:revision++,idempotency_key:'export-replay'})
  assert.equal((await service.snapshot(actor,replay.run_id)).status,'succeeded');assert.equal((await service.taskSnapshot(actor,task)).selected_run_id,features)
  await service.selectTask(actor,task,replay.run_id,revision++);assert.equal((await service.taskSnapshot(actor,task)).status,'completed')
  await writeFile(await store.path(bundle.object_key),'corrupt')
  const corrupt=await service.rerun(actor,features,{scope:{kind:'all'},reuse:true,select:false,expected_revision:revision++,idempotency_key:'export-corrupt'})
  const nodes=(await service.snapshot(actor,corrupt.run_id)).nodes
  assert.equal(nodes.find(n=>n.node_id==='split')!.status,'succeeded');assert.equal(nodes.find(n=>n.node_id==='export')!.status,'pending')
  await service.selectTask(actor,task,analysis,revision);assert.equal((await service.taskSnapshot(actor,task)).status,'awaiting_next_stage')
 }finally{await rm(root,{recursive:true,force:true})}
}
