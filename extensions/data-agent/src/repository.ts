/** Project authorization and transaction helpers shared by domain modules. */
import { Pool, type PoolClient } from 'pg'
import { DomainError } from './contracts.ts'
export type Actor={project_id:string;actor_id:string}
export class Repository {
  constructor(readonly pool:Pool) {}
  async tx<T>(body:(db:PoolClient)=>Promise<T>):Promise<T> {
    const db=await this.pool.connect()
    try {await db.query('BEGIN');const result=await body(db);await db.query('COMMIT');return result}
    catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
  }
  async authorize(db:PoolClient,actor:Actor,permission:'read'|'write'|'release'='read') {
    const member=(await db.query('SELECT role FROM data_agent.members WHERE project_id=$1 AND actor_id=$2',[actor.project_id,actor.actor_id])).rows[0]
    if(!member || permission==='write' && member.role==='viewer' || permission==='release' && member.role!=='owner') throw new DomainError('FORBIDDEN')
  }
  async audit(db:PoolClient,actor:Actor,action:string,body:unknown) {
    await db.query('INSERT INTO data_agent.audit(project_id,actor_id,action,body) VALUES($1,$2,$3,$4)',[actor.project_id,actor.actor_id,action,body])
  }
}
