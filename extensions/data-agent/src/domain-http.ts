/** Authenticated domain transport; member roles remain authoritative in PostgreSQL. */
import { createHash,timingSafeEqual,randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat,readFile } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage,ServerResponse } from 'node:http'
import { z } from 'zod'
import { Workbench } from './workbench.ts'
import { Workflow,operators } from './contracts.ts'
import { Catalog } from './catalog.ts'
import { DomainError,Id } from './contracts.ts'
import { DataAgentService } from './service.ts'
import { Skills } from './skills.ts'
import { HarnessSessions } from './harness.ts'
export type UserAccount={actor_id:string;credential_sha256:string;can_create_projects:boolean}
export type DomainHttpConfig={accounts:UserAccount[];allowed_origins:string[];max_body_bytes:number}
export function createDomainHandler(catalog:Catalog,service:DataAgentService,config:DomainHttpConfig,skills?:Skills,harness?:HarnessSessions) {
  const accounts=structuredClone(config.accounts),workbench=new Workbench(service.pool)
  return async(req:IncomingMessage,res:ServerResponse)=>{
    const send=(status:number,body:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body))}
    try {
      if(req.headers.origin && !config.allowed_origins.includes(req.headers.origin)) throw new DomainError('FORBIDDEN')
      const token=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,200})$/)?.[1]
      if(!token) throw new DomainError('FORBIDDEN')
      const hash=createHash('sha256').update(token).digest()
      const account=accounts.find(a=>timingSafeEqual(hash,Buffer.from(a.credential_sha256,'hex')))
      if(!account) throw new DomainError('FORBIDDEN')
      const url=new URL(req.url??'/', 'http://data.internal')
      const parts=url.pathname.split('/').slice(3).map(decodeURIComponent)
      let body:unknown={}
      const binary=req.method==='PUT' && parts[1]==='uploads' && parts[3]==='parts'
      if(req.method==='POST' && req.headers['content-type']?.split(';')[0]!=='application/json') {send(415,{error:'JSON_REQUIRED'});return}
      if(req.method==='POST') {
        let size=0;const chunks:Buffer[]=[]
        for await(const chunk of req.iterator({destroyOnReturn:false})){size+=chunk.length;if(size>config.max_body_bytes)throw new DomainError('REQUEST_TOO_LARGE');chunks.push(chunk)}
        body=JSON.parse(Buffer.concat(chunks).toString('utf8'))
      }
      if(parts[0]==='account'&&req.method==='GET'){send(200,{actor_id:account.actor_id,can_create_projects:account.can_create_projects});return}
      if(parts[0]==='projects') {
        if(req.method==='POST') {
          if(!account.can_create_projects) throw new DomainError('FORBIDDEN')
          const {name}=z.object({name:z.string().min(1).max(256)}).strict().parse(body),id=randomUUID()
          await catalog.tx(async db=>{await db.query('INSERT INTO data_agent.projects VALUES($1,$2)',[id,name]);await db.query("INSERT INTO data_agent.members VALUES($1,$2,'owner')",[id,account.actor_id])})
          send(201,{id,name});return
        }
        if(req.method==='GET') {send(200,(await catalog.pool.query('SELECT p.* FROM data_agent.projects p JOIN data_agent.members m ON m.project_id=p.id WHERE m.actor_id=$1 ORDER BY p.id',[account.actor_id])).rows);return}
      }
      const actor={project_id:Id.parse(parts[0]),actor_id:account.actor_id}
      const page={search:url.searchParams.get('search')??'',offset:Number(url.searchParams.get('offset')??0),limit:Number(url.searchParams.get('limit')??30)}
      if(parts[1]==='workbench'&&req.method==='GET'){
        await catalog.tx(db=>catalog.authorize(db,actor))
        const role=(await service.pool.query('SELECT role FROM data_agent.members WHERE project_id=$1 AND actor_id=$2',[actor.project_id,actor.actor_id])).rows[0].role
        send(200,{role,runtime:harness?.config.runtime??null,workflow_schema:z.toJSONSchema(Workflow),operators:Object.fromEntries(Object.entries(operators).map(([id,value])=>[id,{...value,params:z.toJSONSchema(value.params)}]))});return
      }
      if(parts[1]==='templates'){
        if(req.method==='GET'){send(200,await workbench.templates(actor,page));return}
        if(req.method==='POST'){send(200,await workbench.saveTemplate(actor,Id.parse(parts[2]),body));return}
      }
      if(parts[1]==='workflows'){
        const id=Id.parse(parts[2])
        if(req.method==='GET'){send(200,await workbench.workflow(actor,id,url.searchParams.has('revision')?Number(url.searchParams.get('revision')):undefined));return}
        if(req.method==='POST'){const value=z.object({expected_revision:z.number().int().nonnegative(),workflow:z.unknown()}).strict().parse(body);send(200,await service.saveWorkflow(actor,id,value.expected_revision,value.workflow));return}
      }
      if(parts[1]==='sessions'){
        if(req.method==='GET'&&parts.length===2){send(200,await workbench.sessions(actor,page));return}
        const id=parts[2]===undefined?'':Id.parse(parts[2])
        if(req.method==='GET'&&parts[3]==='navigation'){send(200,await workbench.navigation(actor,id));return}
        if(req.method==='GET'&&parts[3]==='history'&&harness){send(200,await harness.history(actor,id,Number(url.searchParams.get('after')??-1),page.limit));return}
        if(req.method==='POST'&&parts[3]==='rename'){send(200,await workbench.rename(actor,id,body));return}
      }
      if(parts[1]==='tasks') {
        if(req.method==='POST'&&parts.length===2){send(201,await service.createTask(actor,body));return}
        const id=Id.parse(parts[2])
        if(req.method==='GET'&&(parts.length===3||parts[3]==='follow')){
          const snapshot=await service.taskSnapshot(actor,id)
          const cursor=JSON.stringify(snapshot.cursor)
          send(200,{...snapshot,changed:url.searchParams.get('cursor')!==cursor});return
        }
        if(req.method==='POST'&&parts[3]==='submit'){send(201,await service.submitTask(actor,id,body));return}
        if(req.method==='POST'&&parts[3]==='cancel'){z.object({}).strict().parse(body);send(200,await service.cancelTask(actor,id));return}
        if(req.method==='POST'&&parts[3]==='select'){
          const value=z.object({run_id:Id,expected_revision:z.number().int().nonnegative()}).strict().parse(body)
          send(200,await service.selectTask(actor,id,value.run_id,value.expected_revision));return
        }
      }
      if(parts[1]==='runs'&&req.method==='POST'&&parts.length===4){
        const id=Id.parse(parts[2])
        if(parts[3]==='rerun'){send(201,await service.rerun(actor,id,body));return}
        if(['pause','resume','cancel'].includes(parts[3])){
          z.object({}).strict().parse(body)
          send(200,parts[3]==='cancel'?await service.cancel(actor,id):await service.pause(actor,id,parts[3]==='pause'));return
        }
      }
      if(parts[1]==='proposals') {
        if(req.method==='POST' && parts.length===2){send(201,await service.propose(actor,body));return}
        const id=Id.parse(parts[2])
        if(req.method==='GET' && parts.length===3){send(200,await service.proposal(actor,id));return}
        if(req.method==='POST' && parts[3]==='decision'){send(200,await service.decideProposal(actor,id,body));return}
        if(req.method==='POST' && parts[3]==='submit'){
          const value=z.object({idempotency_key:Id}).strict().parse(body)
          send(200,await service.submitProposal(actor,id,value.idempotency_key));return
        }
      }
      if(parts[1]==='runs' && parts[3]==='candidates') {
        const run=Id.parse(parts[2]),job=Id.parse(parts[4])
        if(req.method==='GET' && parts.length===5){send(200,await service.candidate(actor,run,job));return}
        if(req.method==='POST' && parts[5]==='decision') {
          const value=z.object({action:z.enum(['approve','reject']),manifest_digest:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().min(1).max(4000)}).strict().parse(body)
          send(200,value.action==='approve'?await service.approveCandidate(actor,run,job,value.manifest_digest,value.reason):await service.rejectCandidate(actor,run,job,value.manifest_digest,value.reason));return
        }
      }
      if(parts[1]==='sessions' && harness && req.method==='POST') {
        if(parts.length===2){send(201,await harness.create(actor,body));return}
        const id=Id.parse(parts[2])
        if(parts[3]==='messages'){const value=z.object({text:z.string()}).strict().parse(body);send(200,await harness.message(actor,id,value.text));return}
        if(parts[3]==='resume'){send(200,await harness.resume(actor,id));return}
        if(parts[3]==='cancel'){await harness.cancel(actor,id);send(200,{status:'cancel_requested'});return}
      }
      if(parts[1]==='skills' && skills) {
        if(req.method==='GET'&&parts.length===2){send(200,await workbench.skills(actor,page));return}
        if(req.method==='GET'&&parts[3]==='versions'){send(200,await workbench.skillVersion(actor,Id.parse(parts[2]),String(parts[4])));return}
        const id=Id.parse(parts[2]),action=parts[3]
        if(req.method==='GET'){send(200,await skills.list(actor,id));return}
        if(req.method!=='POST'){send(405,{error:'METHOD_NOT_ALLOWED'});return}
        if(action==='draft') {
          const v=z.object({revision:z.number().int().nonnegative(),package:z.unknown()}).strict().parse(body)
          send(200,await skills.draft(actor,id,v.revision,v.package));return
        }
        if(action==='candidate') {
          const v=z.object({revision:z.number().int().positive(),reason:z.string(),parent:z.string().nullable()}).strict().parse(body)
          send(200,await skills.candidate(actor,id,v.revision,v.reason,v.parent));return
        }
        if(action==='publish') {
          const v=z.object({version:z.string(),evaluation_id:z.string()}).strict().parse(body)
          send(200,await skills.publish(actor,id,v.version,v.evaluation_id));return
        }
        const v=z.object({version:z.string()}).strict().parse(body)
        if(action==='evaluate') send(200,await skills.evaluate(actor,id,v.version))
        else if(action==='default'){await skills.selectDefault(actor,id,v.version);send(200,{default_version:v.version})}
        else if(action==='retire')send(200,{affected_invocations:await skills.retire(actor,id,v.version)})
        else send(404,{error:'NOT_FOUND'})
        return
      }
      if(req.method==='POST' && parts[1]==='uploads' && parts.length===2) send(200,await catalog.init(actor,body))
      else if(req.method==='GET' && parts[1]==='uploads' && parts.length===3) send(200,await catalog.status(actor,Id.parse(parts[2])))
      else if(req.method==='POST' && parts[1]==='uploads' && parts[3]==='grant') {
        const value=z.object({number:z.number().int(),digest:z.string()}).strict().parse(body);send(200,await catalog.grant(actor,Id.parse(parts[2]),value.number,value.digest))
      }
      else if(binary && parts.length===5) send(200,await catalog.part(actor,Id.parse(parts[2]),Number(parts[4]),String(req.headers['x-upload-ticket']??''),req.iterator({destroyOnReturn:false})))
      else if(req.method==='POST' && parts[1]==='uploads' && parts[3]==='complete') send(200,await catalog.complete(actor,Id.parse(parts[2])))
      else if(req.method==='POST' && parts[1]==='uploads' && parts[3]==='retry'){await catalog.retry(actor,Id.parse(parts[2]));send(200,{status:'uploading'})}
      else if(req.method==='POST' && parts[1]==='uploads' && parts[3]==='abort') {await catalog.abort(actor,Id.parse(parts[2]));send(200,{status:'aborted'})}
      else if(req.method==='POST' && parts[1]==='uploads' && parts[3]==='import') send(200,await catalog.import(actor,Id.parse(parts[2]),body))
      else if(req.method==='GET' && parts[1]==='datasets') send(200,await catalog.list(actor,url.searchParams.get('search')??'',Number(url.searchParams.get('offset')??0),Number(url.searchParams.get('limit')??20)))
      else if(req.method==='POST' && parts[1]==='artifacts' && parts[3]==='preview')send(200,await catalog.preview(actor,Id.parse(parts[2]),body))
      else if(req.method==='POST' && parts[1]==='artifacts' && parts[3]==='discard')send(200,await catalog.discard(actor,Id.parse(parts[2])))
      else if(req.method==='POST' && parts[1]==='artifacts' && parts[3]==='archive'){await catalog.archive(actor,Id.parse(parts[2]));send(200,{archived:true})}
      else if(req.method==='GET' && parts[1]==='artifacts' && parts[3]==='report') {
        const artifact=await catalog.artifact(actor,Id.parse(parts[2]))
        if(artifact.kind!=='ReportRef')throw new DomainError('REPORT_REQUIRED')
        const path=await catalog.store.path(artifact.object_key)
        if((await stat(path)).size>config.max_body_bytes)throw new DomainError('RESULT_LIMIT')
        send(200,JSON.parse(await readFile(path,'utf8')))
      }
      else if(req.method==='GET' && parts[1]==='artifacts' && parts[3]==='download') {
        const artifact=await catalog.artifact(actor,Id.parse(parts[2])),path=await catalog.store.path(artifact.object_key),file=await stat(path)
        let start=0,end=file.size-1,status=200
        if(req.headers.range) {
          const range=req.headers.range.match(/^bytes=(\d*)-(\d*)$/)
          if(!range || !range[1]&&!range[2]) {res.writeHead(416,{'content-range':`bytes */${file.size}`});res.end();return}
          start=range[1]?Number(range[1]):Math.max(0,file.size-Number(range[2]));end=range[1]&&range[2]?Math.min(Number(range[2]),file.size-1):file.size-1
          if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=file.size) {res.writeHead(416,{'content-range':`bytes */${file.size}`});res.end();return}
          status=206
        }
        res.writeHead(status,{'content-type':'application/octet-stream','content-disposition':`attachment; filename="${artifact.id}"`,'content-length':Math.max(0,end-start+1),'accept-ranges':'bytes','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'",...(status===206?{'content-range':`bytes ${start}-${end}/${file.size}`}:{})})
        if(file.size) await pipeline(createReadStream(path,{start,end}),res);else res.end()
      }
      else if(req.method==='GET' && parts[1]==='runs') send(200,await service.snapshot(actor,Id.parse(parts[2])))
      else send(404,{error:'NOT_FOUND'})
    }catch(error){req.resume();if(res.headersSent){res.destroy();return}if(error instanceof DomainError)send(error.code==='FORBIDDEN'?403:409,{error:error.code});else if(error instanceof z.ZodError || error instanceof SyntaxError || error instanceof URIError)send(400,{error:'INVALID_REQUEST'});else send(500,{error:'INTERNAL_ERROR'})}
  }
}
