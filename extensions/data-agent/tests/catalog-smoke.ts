/** Exercise upload HTTP grants, resume, immutable completion, Docker import and Range reads. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp,mkdir,writeFile,rm,readFile,stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Pool } from 'pg'
import { Catalog } from '../src/catalog.ts'
import { LocalStore } from '../src/local-store.ts'
import { DataAgentService } from '../src/service.ts'
import { createDomainHandler } from '../src/domain-http.ts'
import { createWorkerHandler } from '../src/worker-http.ts'
export async function catalogSmoke(pool:Pool,image:string) {
  const root=await mkdtemp(join(tmpdir(),'data-agent-catalog-'));await mkdir(join(root,'objects'))
  const store=new LocalStore(join(root,'objects')),sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex')
  const catalog=new Catalog(pool,store,{max_upload_bytes:1000000,part_bytes:8,upload_ttl_ms:60000,upload_cleanup_grace_ms:60000,environment_digest:'a'.repeat(64)})
  const service=new DataAgentService(pool,{lease_ms:60000,max_attempts:2,max_running_jobs:1},(c,m)=>store.verify(c,m))
  const userToken='synthetic-catalog-user-token',workerToken='synthetic-catalog-worker-token'
  const handler=createDomainHandler(catalog,service,{accounts:[{actor_id:'alice',credential_sha256:sha(userToken),can_create_projects:false}],allowed_origins:[],max_body_bytes:100000})
  const worker=createWorkerHandler(service,{accounts:[{owner:'catalog-worker',projects:['p'],credential_sha256:sha(workerToken)}],max_body_bytes:100000},{store,max_object_bytes:1000000})
  const server=createServer((req,res)=>{void(req.url!.startsWith('/v1/worker/')?worker:handler)(req,res)})
  try {
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');const endpoint=`http://127.0.0.1:${address.port}`
    const request=(path:string,body?:unknown,headers:Record<string,string>={},method=body===undefined?'GET':'POST')=>fetch(endpoint+'/v1/data/'+path,{method,headers:{authorization:'Bearer '+userToken,'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)})
    const raw=Buffer.from('id,income\n001,1\n002,3\n'),init={filename:'中文.csv',bytes:raw.length,digest:sha(raw),idempotency_key:'upload'}
    const uploaded=await(await request('p/uploads',init)).json() as {id:string};assert.ok(uploaded.id)
    assert.equal((await(await request('p/uploads',init)).json() as {id:string}).id,uploaded.id)
    assert.equal((await request('q/uploads',init)).status,403)
    assert.equal((await request(`p/uploads/${uploaded.id}/complete`,{})).status,409)
    for(let number=Math.ceil(raw.length/8);number>=1;number--) {
      const chunk=raw.subarray((number-1)*8,number*8)
      const grant=await(await request(`p/uploads/${uploaded.id}/grant`,{number,digest:sha(chunk)})).json() as {ticket:string}
      for(let retry=0;retry<2;retry++) {
        const result=await fetch(endpoint+`/v1/data/p/uploads/${uploaded.id}/parts/${number}`,{method:'PUT',headers:{authorization:'Bearer '+userToken,'x-upload-ticket':grant.ticket},body:chunk})
        assert.equal(result.status,200,await result.text())
      }
    }
    const resumed=await(await request(`p/uploads/${uploaded.id}`)).json() as {parts:unknown[]};assert.equal(resumed.parts.length,3)
    assert.equal((await request(`p/uploads/${uploaded.id}/complete`,{})).status,200)
    assert.equal((await request(`p/uploads/${uploaded.id}/complete`,{})).status,200)
    assert.equal((await request(`p/uploads/${uploaded.id}/abort`,{})).status,409)
    const range=await request(`p/artifacts/${uploaded.id}/download`,undefined,{range:'bytes=0-1'})
    assert.equal(range.status,206);assert.equal(await range.text(),'id')
    assert.equal((await request(`q/artifacts/${uploaded.id}/download`)).status,403)
    const parse={options:{format:'csv',types:{id:'string',income:'float64'}},roles:{id:'record_id',income:'feature'}}
    const imported=await(await request(`p/uploads/${uploaded.id}/import`,parse)).json() as {run_id:string};assert.ok(imported.run_id)
    assert.equal((await(await request(`p/uploads/${uploaded.id}/import`,parse)).json() as {run_id:string}).run_id,imported.run_id)
    const before=await catalog.list({project_id:'p',actor_id:'alice'},'中文',0,20);assert.equal(before[0].status,'importing')
    const config={endpoint,root:join(root,'worker'),image,instance_id:'catalog-worker',docker:'/usr/local/bin/docker',docker_home:process.env.HOME,credential_env:'WORKER_TOKEN',http_timeout_seconds:5,docker_timeout_seconds:20,heartbeat_seconds:.2,poll_seconds:.1,execution_seconds:20,input_bytes:1000000,output_bytes:16000000,temporary_bytes:8000000,manifest_bytes:100000,memory_bytes:536870912,pids:64,cpus:1,polars_threads:1,max_columns:100}
    const path=join(root,'config.json');await writeFile(path,JSON.stringify(config))
    const result=await promisify(execFile)(process.env.DATA_AGENT_TEST_PYTHON??'python3',[resolve('../../services/data-worker/remote.py'),'--config',path,'--once'],{timeout:60000,env:{PATH:'/usr/bin:/bin',WORKER_TOKEN:workerToken}})
    assert.equal(JSON.parse(result.stdout).status,'published',result.stderr)
    const after=await catalog.list({project_id:'p',actor_id:'alice'},'中文',0,20);assert.equal(after[0].status,'ready');assert.equal(after[0].metadata.rows,2);assert.equal(after[0].metadata.schema.id,'String')
    assert.equal((await request(`p/artifacts/${after[0].dataset_id}/archive`,{})).status,200)
    assert.equal((await request(`p/artifacts/${uploaded.id}/discard`,{})).status,409)
    assert.equal((await request(`p/artifacts/${after[0].dataset_id}/discard`,{})).status,409)
    const preview=await(await request(`p/artifacts/${after[0].dataset_id}/preview`,{offset:1,limit:1,columns:['id']})).json() as {run_id:string}
    assert.ok(preview.run_id)
    const previewResult=await promisify(execFile)(process.env.DATA_AGENT_TEST_PYTHON??'python3',[resolve('../../services/data-worker/remote.py'),'--config',path,'--once'],{timeout:60000,env:{PATH:'/usr/bin:/bin',WORKER_TOKEN:workerToken}})
    assert.equal(JSON.parse(previewResult.stdout).status,'published',previewResult.stderr)
    const report=(await pool.query('SELECT object_key FROM data_agent.artifacts WHERE run_id=$1 AND kind=$2',[preview.run_id,'ReportRef'])).rows[0]
    const previewBody=JSON.parse(await readFile(await store.path(report.object_key),'utf8'))
    assert.deepEqual(previewBody.rows,[{id:'002'}]);assert.equal(previewBody.total,2)
    const expired=await catalog.init({project_id:'p',actor_id:'alice'},{...init,idempotency_key:'expired'})
    const chunk=raw.subarray(0,8),grant=await catalog.grant({project_id:'p',actor_id:'alice'},expired.id,1,sha(chunk))
    let release!:()=>void
    const paused=new Promise<void>(resolve=>{release=resolve})
    let started!:()=>void
    const reading=new Promise<void>(resolve=>{started=resolve})
    const oldPart=catalog.part({project_id:'p',actor_id:'alice'},expired.id,1,grant.ticket,(async function*(){started();await paused;yield chunk})())
    const rejected=assert.rejects(oldPart,{code:'UPLOAD_CLOSED'})
    await reading
    const replacement=Buffer.from('abcdefgh')
    const newGrant=await catalog.grant({project_id:'p',actor_id:'alice'},expired.id,1,sha(replacement))
    await catalog.part({project_id:'p',actor_id:'alice'},expired.id,1,newGrant.ticket,(async function*(){yield replacement})())
    release();await rejected
    assert.equal((await catalog.status({project_id:'p',actor_id:'alice'},expired.id)).parts[0].digest,sha(replacement))
    await pool.query("UPDATE data_agent.uploads SET expires_at=clock_timestamp()-interval '2 minutes',status='completing' WHERE id=$1",[expired.id])
    assert.deepEqual(await catalog.expire(),{expired:1,cleaned:1})
    assert.equal((await catalog.status({project_id:'p',actor_id:'alice'},expired.id)).status,'aborted')
    await assert.rejects(stat(join(root,'objects','p','uploads',expired.id)),{code:'ENOENT'})
    assert.ok(await stat(await store.path(`${'p'}/uploads/${uploaded.id}/original`)))
    const changed=await catalog.import({project_id:'p',actor_id:'alice'},uploaded.id,{...parse,options:{...parse.options,null_values:['NULL']}});assert.notEqual(changed.run_id,imported.run_id)
    const failedClaim=await service.acquire({owner:'catalog-worker',projects:['p']});assert.ok(failedClaim);assert.equal(failedClaim.run_id,changed.run_id)
    await service.fail(failedClaim,'DIMENSION_LIMIT')
    const failedRow=(await catalog.list({project_id:'p',actor_id:'alice'},'',0,20)).find(row=>row.run_id===changed.run_id)
    assert.equal(failedRow.status,'failed');assert.equal(failedRow.error_code,'DIMENSION_LIMIT')
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true})}
}
