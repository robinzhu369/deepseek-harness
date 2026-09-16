/** Private local-volume object storage used by the single-host executor. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, realpath, stat, mkdir, open, link, unlink, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isAbsolute, resolve, sep, dirname } from 'node:path'
import { DomainError, Id, type Manifest } from './contracts.ts'
import type { Claim } from './service.ts'
export class LocalStore {
  constructor(readonly root: string) { if (!isAbsolute(root)) throw new DomainError('STORAGE_ROOT') }
  async path(key: string) {
    if (!key || key.includes('\\') || isAbsolute(key) || key.split('/').some(part=>!part || part==='.' || part==='..')) throw new DomainError('OBJECT_KEY')
    const root=await realpath(this.root)
    let current=root
    for(const part of key.split('/')) {
      current=resolve(current,part)
      if((await lstat(current)).isSymbolicLink()) throw new DomainError('OBJECT_SYMLINK')
    }
    const actual=await realpath(current)
    if(!actual.startsWith(root+sep) || !(await stat(actual)).isFile()) throw new DomainError('OBJECT_KEY')
    return actual
  }
  async checksum(key: string) {
    const path=await this.path(key)
    const h=createHash('sha256')
    for await(const data of createReadStream(path)) h.update(data)
    return {digest:h.digest('hex'),bytes:(await stat(path)).size}
  }
  /** Stream immutable bytes into a private temporary file and atomically publish its name.
   * @param key - Storage-relative destination.
   * @param chunks - Bounded transport stream.
   * @param expected - Exact byte count and SHA-256, checked before publication.
   * @returns The verified object identity; same-content retries are idempotent.
   */
  async put(key: string, chunks: AsyncIterable<Uint8Array>, expected: {bytes:number;digest:string}) {
    if (!key || key.includes('\\') || isAbsolute(key) || key.split('/').some(p=>!p || p==='.' || p==='..')) throw new DomainError('OBJECT_KEY')
    if(!Number.isSafeInteger(expected.bytes) || expected.bytes<0 || !/^[a-f0-9]{64}$/.test(expected.digest)) throw new DomainError('OBJECT_CHECKSUM')
    const root=await realpath(this.root)
    let parent=root
    for(const part of key.split('/').slice(0,-1)) {
      parent=resolve(parent,part)
      await mkdir(parent,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST') throw error})
      if((await lstat(parent)).isSymbolicLink() || !(await stat(parent)).isDirectory()) throw new DomainError('OBJECT_SYMLINK')
    }
    const destination=resolve(root,key), temporary=resolve(dirname(destination),`.upload-${randomUUID()}`)
    const file=await open(temporary,'wx',0o600)
    let bytes=0;const hash=createHash('sha256')
    try {
      for await(const chunk of chunks) {
        bytes+=chunk.length
        if(bytes>expected.bytes) throw new DomainError('OBJECT_SIZE')
        hash.update(chunk)
        let offset=0
        while(offset<chunk.length) offset+=(await file.write(chunk,offset)).bytesWritten
      }
      if(bytes!==expected.bytes || hash.digest('hex')!==expected.digest) throw new DomainError('OBJECT_CHECKSUM')
      await file.sync();await file.close()
      try {await link(temporary,destination)} catch(error) {
        if((error as NodeJS.ErrnoException).code!=='EEXIST') throw error
        const current=await this.checksum(key)
        if(current.digest!==expected.digest || current.bytes!==expected.bytes) throw new DomainError('OBJECT_CONFLICT')
      }
      return {object_key:key,...expected}
    } finally {await file.close();await unlink(temporary)}
  }
  /** Remove only an aborted upload prefix whose absence of references was checked by the catalog. */
  async purgeUpload(project:string,id:string) {
    Id.parse(project);Id.parse(id)
    let path=await realpath(this.root)
    for(const component of [project,'uploads',id]) {
      path=resolve(path,component)
      const info=await lstat(path).catch(error=>{if(error.code==='ENOENT')return null;throw error})
      if(!info)return
      if(info.isSymbolicLink() || !info.isDirectory())throw new DomainError('OBJECT_SYMLINK')
    }
    await rm(path,{recursive:true,force:true})
  }
  async verify(claim: Claim, manifest: Manifest) {
    const prefix=`${claim.project_id}/${claim.run_id}/${claim.job_id}/${claim.attempt_no}/`
    for(const output of Object.values(manifest.outputs)) {
      if(!output.object_key.startsWith(prefix)) throw new DomainError('ATTEMPT_OBJECT_SCOPE')
      const actual=await this.checksum(output.object_key)
      if(actual.digest!==output.digest || actual.bytes!==output.bytes) throw new DomainError('OBJECT_CHECKSUM')
    }
  }
}
