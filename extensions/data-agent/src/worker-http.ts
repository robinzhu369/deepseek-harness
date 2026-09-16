/** Authenticated internal Worker routes, mounted by a host; this module does not listen. */
import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { DataAgentService, type Worker, type Claim } from './service.ts'
import { DomainError } from './contracts.ts'
import { operators } from './contracts.ts'
import { LocalStore } from './local-store.ts'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
export type WorkerAccount = Worker & { credential_sha256: string }
export type WorkerHttpConfig = { accounts: WorkerAccount[]; max_body_bytes: number }
const empty=z.object({}).strict()
const progress=z.object({processed:z.number().int().nonnegative(),total:z.number().int().nonnegative().optional()}).strict()
/** Mount only behind the configured internal TLS/host boundary.
 * @param service - business authority with object verification configured.
 * @param config - server-owned account restrictions and request budget.
 * @returns an HTTP handler with no browser CORS or arbitrary worker identities.
 */
export function createWorkerHandler(service: DataAgentService, config: WorkerHttpConfig, objects?: {store:LocalStore;max_object_bytes:number}) {
  if(!Number.isSafeInteger(config.max_body_bytes) || config.max_body_bytes<1 || new Set(config.accounts.map(a=>a.owner)).size!==config.accounts.length || config.accounts.some(a=>!a.owner || !a.projects.length || !/^[a-f0-9]{64}$/.test(a.credential_sha256))) throw new DomainError('WORKER_HTTP_CONFIG')
  const accounts=structuredClone(config.accounts)
  return async(req: IncomingMessage,res: ServerResponse):Promise<void>=>{
    const send=(status:number,body:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body))}
    try {
      if(req.method!=='POST' || req.headers.origin) {send(403,{error:'FORBIDDEN'});return}
      const bearer=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{20,200})$/)?.[1]
      if(!bearer) throw new DomainError('FORBIDDEN')
      const url=new URL(req.url ?? '/', 'http://worker.internal')
      const route=url.pathname
      let claim: Claim | undefined
      let account: WorkerAccount | undefined
      if(route==='/v1/worker/acquire') {
        const hash=createHash('sha256').update(bearer).digest()
        account=accounts.find(item=>timingSafeEqual(hash,Buffer.from(item.credential_sha256,'hex')))
        if(!account) throw new DomainError('FORBIDDEN')
      } else {
        claim=await service.authenticateAttempt(bearer)
        const identity=claim
        if(!accounts.some(item=>item.owner===identity.owner && item.projects.includes(identity.project_id))) throw new DomainError('FORBIDDEN')
      }
      if(route==='/v1/worker/output') {
        if(!objects || !claim) throw new DomainError('FORBIDDEN')
        await service.workerInputs(claim)
        const filename=url.searchParams.get('name') ?? ''
        const port=filename.split('.')[0]!
        if(!/^[a-z_]+\.(json|parquet|zip)$/.test(filename) || !(port in operators[claim.spec.operator].outputs)) throw new DomainError('OUTPUT_PORTS')
        const bytes=Number(req.headers['content-length']),digest=String(req.headers['x-content-sha256'])
        if(req.headers['content-type']!=='application/octet-stream' || !Number.isSafeInteger(bytes) || bytes<0 || bytes>objects.max_object_bytes) throw new DomainError('OBJECT_SIZE')
        const key=`${claim.project_id}/${claim.run_id}/${claim.job_id}/${claim.attempt_no}/${filename}`
        send(200,await objects.store.put(key,req.iterator({destroyOnReturn:false}),{bytes,digest}));return
      }
      if(req.headers['content-type']?.split(';')[0]!=='application/json') {send(415,{error:'JSON_REQUIRED'});return}
      let size=0;const chunks:Buffer[]=[]
      for await(const chunk of req.iterator({destroyOnReturn:false})) {
        size+=chunk.length
        if(size>config.max_body_bytes) {req.resume();send(413,{error:'REQUEST_TOO_LARGE'});return}
        chunks.push(chunk)
      }
      const body:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if(route==='/v1/worker/acquire') {
        empty.parse(body)
        const acquired=await service.acquire(account!)
        if(!acquired) {send(200,{claim:null});return}
        const credential=await service.issueCredential(acquired)
        send(200,{claim:acquired,credential,lease_ms:service.config.lease_ms,inputs:await service.workerInputs(acquired)});return
      }
      if(!claim) throw new DomainError('FORBIDDEN')
      if(route==='/v1/worker/input') {
        if(!objects) throw new DomainError('FORBIDDEN')
        const {port}=z.object({port:z.string()}).strict().parse(body)
        const ref=(await service.workerInputs(claim))[port]
        if(!ref) throw new DomainError('INPUT_PORTS')
        const path=await objects.store.path(ref.object_key),info=await stat(path)
        if(info.size>objects.max_object_bytes) throw new DomainError('OBJECT_SIZE')
        res.writeHead(200,{'content-type':'application/octet-stream','content-length':info.size,'x-content-sha256':ref.digest,'cache-control':'no-store'})
        await pipeline(createReadStream(path),res)
      }
      else if(route==='/v1/worker/heartbeat') {empty.parse(body);send(200,await service.heartbeat(claim))}
      else if(route==='/v1/worker/submit') send(200,await service.commit(claim,body))
      else if(route==='/v1/worker/progress') {const value=progress.parse(body);await service.reportProgress(claim,value.processed,value.total);send(200,{accepted:true})}
      else if(route==='/v1/worker/failure') {const value=z.object({code:z.string().regex(/^[A-Z_]{1,80}$/)}).strict().parse(body);await service.fail(claim,value.code);send(200,{accepted:true})}
      else if(route==='/v1/worker/cancelled') {empty.parse(body);await service.acknowledgeCancel(claim);send(200,{accepted:true})}
      else send(404,{error:'NOT_FOUND'})
    } catch(error) {
      if(res.headersSent) {res.destroy();return}
      req.resume()
      if(error instanceof DomainError) send(error.code==='FORBIDDEN'?403:409,{error:error.code})
      else if(error instanceof z.ZodError || error instanceof SyntaxError) send(400,{error:'INVALID_REQUEST'})
      else send(500,{error:'INTERNAL_ERROR'})
    }
  }
}
