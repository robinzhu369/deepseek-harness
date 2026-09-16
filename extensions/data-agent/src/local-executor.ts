/** Single-host process adapter. Production network and memory isolation belongs to its container. */
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve, isAbsolute } from 'node:path'
import { DomainError, Manifest } from './contracts.ts'
import { DataAgentService, type Worker } from './service.ts'
import { LocalStore } from './local-store.ts'
export type ExecutorConfig = { python: string; script: string; heartbeat_ms: number; timeout_ms: number; kill_grace_ms: number; max_output_bytes: number; max_columns: number; polars_threads: number }
export class LocalExecutor {
  constructor(readonly service: DataAgentService, readonly store: LocalStore, readonly config: ExecutorConfig) {
    if(!isAbsolute(config.python) || !isAbsolute(config.script)) throw new DomainError('EXECUTOR_PATH')
    if(config.heartbeat_ms>=service.config.lease_ms/2 || Object.entries(config).some(([key,value])=>typeof value==='number' && (!Number.isInteger(value) || value<=0))) throw new DomainError('EXECUTOR_CONFIG')
  }
  async once(worker: Worker) {
    const claim=await this.service.acquire(worker)
    if(!claim) return null
    let child: ReturnType<typeof spawn>|undefined
    let pulse: ReturnType<typeof setTimeout>|undefined
    let timeout: ReturnType<typeof setTimeout>|undefined
    let force: ReturnType<typeof setTimeout>|undefined
    let heartbeatTask: Promise<void>|undefined
    let stopped=false, cancel=false, timedOut=false, lostLease=false, outputExceeded=false
    const stop=()=>{
      child?.kill('SIGTERM')
      if(!force) force=setTimeout(()=>child?.kill('SIGKILL'),this.config.kill_grace_ms)
    }
    try {
      const refs=await this.service.workerInputs(claim)
      const inputs=Object.fromEntries(await Promise.all(Object.entries(refs).map(async([port,ref])=>[port,{...ref,path:await this.store.path(ref.object_key)}])))
      const prefix=`${claim.project_id}/${claim.run_id}/${claim.job_id}/${claim.attempt_no}`
      const outputPath=resolve(this.store.root,prefix)
      await mkdir(resolve(outputPath,'..'),{recursive:true,mode:0o700})
      child=spawn(this.config.python,[this.config.script],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',POLARS_MAX_THREADS:String(this.config.polars_threads),PYTHONDONTWRITEBYTECODE:'1'}})
      let stdout='',stderr='',size=0
      const completed=new Promise<number|null>((done,reject)=>{
        child!.once('error',reject)
        child!.once('close',done)
        child!.stdout!.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>this.config.max_output_bytes){outputExceeded=true;stop()}else stdout+=chunk.toString()})
        child!.stderr!.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>this.config.max_output_bytes){outputExceeded=true;stop()}else stderr+=chunk.toString()})
        child!.stdin!.on('error',()=>{/* Process exit owns the result; EPIPE cannot supersede it. */})
      })
      child.stdin!.end(JSON.stringify({spec:claim.spec,inputs,seed:claim.seed,recipe:claim.recipe,object_prefix:prefix,output_path:outputPath,max_columns:this.config.max_columns}))
      const heartbeat=async()=>{
        try {const status=await this.service.heartbeat(claim);if(status.cancel_requested){cancel=true;stop()}}
        catch {lostLease=true;stop()}
        if(!stopped && !cancel && !lostLease) pulse=setTimeout(()=>{heartbeatTask=heartbeat()},this.config.heartbeat_ms)
      }
      pulse=setTimeout(()=>{heartbeatTask=heartbeat()},this.config.heartbeat_ms)
      timeout=setTimeout(()=>{timedOut=true;stop()},this.config.timeout_ms)
      const exitCode=await completed
      stopped=true;clearTimeout(pulse);await heartbeatTask
      // Recheck cancellation after exit, before publishing or classifying a process failure.
      if(!lostLease) {
        try {cancel=(await this.service.heartbeat(claim)).cancel_requested || cancel}
        catch {lostLease=true}
      }
      if(cancel) {await this.service.acknowledgeCancel(claim);return {status:'cancelled'}}
      if(lostLease) throw new DomainError('STALE_ATTEMPT')
      if(timedOut || outputExceeded || exitCode!==0) {
        let code=timedOut?'EXECUTION_TIMEOUT':outputExceeded?'OUTPUT_LIMIT':'EXECUTION_FAILED'
        try { const parsed=JSON.parse(stderr);if(!timedOut && !outputExceeded && /^[A-Z_]{1,80}$/.test(parsed.error)) code=parsed.error }
        catch {/* Unstructured worker stderr is deliberately not persisted. */}
        await this.service.fail(claim,code);return {status:'failed',code}
      }
      return await this.service.commit(claim,Manifest.parse(JSON.parse(stdout)))
    } catch(error) {
      // Awaited process completion above prevents reporting cancellation before exit.
      if(error instanceof DomainError && error.code==='STALE_ATTEMPT') throw error
      try {await this.service.fail(claim,'EXECUTOR_ERROR')} catch(failure) {
        if(!(failure instanceof DomainError) || failure.code!=='STALE_ATTEMPT') throw failure
      }
      throw error
    } finally {stopped=true;clearTimeout(pulse);clearTimeout(timeout);clearTimeout(force)}
  }
}
