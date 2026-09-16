/** Real HTTP transport plus isolated Docker computation; no shared object volume. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { Pool } from 'pg'
import { DataAgentService } from '../src/service.ts'
import { LocalStore } from '../src/local-store.ts'
import { createWorkerHandler } from '../src/worker-http.ts'
import { fixture } from './fixtures.ts'

export async function remoteSmoke(pool:Pool,image:string,cancel:boolean|'restart'=false,exportBundle=false) {
  const root=await mkdtemp(join(tmpdir(),'data-agent-remote-'))
  const objects=join(root,'objects');await mkdir(objects)
  const store=new LocalStore(objects)
  const service=new DataAgentService(pool,{lease_ms:60000,max_attempts:2,max_running_jobs:1},(c,m)=>store.verify(c,m))
  const token='synthetic-remote-worker-token'
  const handler=createWorkerHandler(service,{accounts:[{owner:'remote',projects:['p'],credential_sha256:createHash('sha256').update(token).digest('hex')}],max_body_bytes:100000},{store,max_object_bytes:10000000})
  const server=createServer((req,res)=>{void handler(req,res)})
  try {
    const python=process.env.DATA_AGENT_TEST_PYTHON??'python3'
    execFileSync(python,['-c',"import polars as p,sys;p.DataFrame({'__row_id':[str(i) for i in range(100)],'income':[float(i) for i in range(100)]}).write_parquet(sys.argv[1])",join(objects,'input.parquet')])
    const checksum=await store.checksum('input.parquet')
    await pool.query("UPDATE data_agent.artifacts SET object_key='input.parquet',digest=$1,bytes=$2,metadata=$3 WHERE id='input'",[checksum.digest,checksum.bytes,{roles:{income:'feature'},source:'source'}])
    const workflow=fixture();workflow.nodes=[{id:'inspect',operator:'inspect',operator_version:'1',params:{},inputs:{data:{artifact_id:'input',project_id:'p',kind:'DatasetRef',digest:checksum.digest}}}]
    if(exportBundle)workflow.nodes=[
      {id:'split',operator:'split',operator_version:'1',params:{method:'random',train_fraction:0.6,validation_fraction:0.2},inputs:workflow.nodes[0].inputs},
      {id:'export',operator:'export',operator_version:'1',params:{feature_columns:['income'],purpose:'unsupervised',allow_null:false},inputs:Object.fromEntries(['train','validation','test'].map(port=>[port,{node_id:'split',output_port:port}]))},
    ]
    const actor={project_id:'p',actor_id:'alice'}
    await service.saveWorkflow(actor,'w',0,workflow)
    const approval_id=await service.approve(actor,'w',1,0)
    const run=await service.submit(actor,{workflow_id:'w',revision:1,session_id:'s',idempotency_key:'remote',approval_id})
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    const address=server.address();assert.ok(address && typeof address!=='string')
    const config={endpoint:`http://127.0.0.1:${address.port}`,root:join(root,'worker'),image,instance_id:'remote-test',
      docker:'/usr/local/bin/docker',docker_home:process.env.HOME,credential_env:'WORKER_TOKEN',
      http_timeout_seconds:5,docker_timeout_seconds:20,heartbeat_seconds:.2,poll_seconds:.1,execution_seconds:20,
      input_bytes:10000000,output_bytes:16000000,temporary_bytes:8000000,manifest_bytes:100000,
      memory_bytes:536870912,pids:64,cpus:1,polars_threads:1,max_columns:100}
    const configPath=join(root,'worker.json');await writeFile(configPath,JSON.stringify(config))
    const execution=promisify(execFile)(python,[resolve('../../services/data-worker/remote.py'),'--config',configPath,'--once'],{
      timeout:60000,env:{PATH:'/usr/bin:/bin',WORKER_TOKEN:token},maxBuffer:100000})
    if(cancel) {
      const deadline=Date.now()+15000
      while(Date.now()<deadline) {
        const running=execFileSync('/usr/local/bin/docker',['ps','-q','--filter','label=data-agent.instance=remote-test'],{encoding:'utf8'}).trim()
        if(running) break
        await new Promise(resolve=>setTimeout(resolve,100))
      }
      if(cancel==='restart') {
        execution.child.kill('SIGKILL');await execution.catch(()=>{})
        await pool.query("UPDATE data_agent.jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=$1",[run.run_id])
      }
      await service.cancel(actor,run.run_id)
    }
    const result=cancel==='restart'?await promisify(execFile)(python,[resolve('../../services/data-worker/remote.py'),'--config',configPath,'--once'],{timeout:60000,env:{PATH:'/usr/bin:/bin',WORKER_TOKEN:token},maxBuffer:100000}):await execution
    if(cancel==='restart')assert.equal(JSON.parse(result.stdout),null)
    else assert.equal(JSON.parse(result.stdout).status,cancel?'cancelled':'published',result.stderr)
    if(exportBundle){
      const exported=await promisify(execFile)(python,[resolve('../../services/data-worker/remote.py'),'--config',configPath,'--once'],{timeout:60000,env:{PATH:'/usr/bin:/bin',WORKER_TOKEN:token},maxBuffer:100000})
      assert.equal(JSON.parse(exported.stdout).status,'published',exported.stderr)
    }
    const snapshot=await service.snapshot(actor,run.run_id)
    assert.equal(snapshot.status,cancel?'cancelled':'succeeded');assert.equal(snapshot.artifacts.length,cancel?0:exportBundle?6:1)
    if(cancel) return
    const record=(await pool.query('SELECT * FROM data_agent.artifacts WHERE run_id=$1',[run.run_id])).rows[0]
    assert.equal((await store.checksum(record.object_key)).digest,record.digest)
    if(exportBundle)assert.ok(snapshot.artifacts.some(a=>a.kind==='ExportRef'&&a.metadata.status==='ready_for_training_contract'))
    assert.ok(!result.stdout.includes(token))
  } finally {
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))
    await rm(root,{recursive:true,force:true})
  }
}
