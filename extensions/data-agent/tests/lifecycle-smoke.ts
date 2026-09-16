/** Publish eligibility and immutable invocation locks, using a controlled evaluator fixture. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { Pool } from 'pg'
import { Skills,type SkillRuntime,type EvaluationSuite,type Evaluator } from '../src/skills.ts'
import { digest } from '../src/contracts.ts'
export async function lifecycleSmoke(pool:Pool) {
  const actor={project_id:'p',actor_id:'alice'},viewer={project_id:'p',actor_id:'viewer'}
  await pool.query("INSERT INTO data_agent.members VALUES('p','editor','editor')")
  const root=new URL('../../../skill-packages/data-analysis/',import.meta.url)
  const manifest=JSON.parse(await readFile(new URL('skill.manifest.json',root),'utf8'))
  const files=Object.fromEntries(await Promise.all(['SKILL.md','contracts/input.schema.json','contracts/output.schema.json'].map(async path=>[path,await readFile(new URL(path,root),'utf8')])))
  const suite:EvaluationSuite={release_eligible:true,digest:digest('private-labelled-fixture-v1'),cases:[{id:'holdout-planning',group:'holdout',lane:'planning'},{id:'regression-frozen',group:'regression',lane:'frozen'}]}
  const runtime:SkillRuntime={harness_commit:'fixture-commit',model_id:'fixture-only-not-a-real-model',model_snapshot:null,environment_digest:'a'.repeat(64),policy_version:'policy1',parameters:{seed:1}}
  let mode:'good'|'blocking'|'missing'='good'
  const evaluator:Evaluator=async(snapshot,suite)=>({cases:suite.cases.slice(mode==='missing'?1:0).map(c=>({...c,passed:true,blocking_failures:mode==='blocking'?['TARGET_MODIFIED']:[],metrics:{accuracy:1},trace:'fixture://'+snapshot.digest+'/'+c.id})),suitability:'Test fixture only; not business or model acceptance',limitations:['No actual LLM evaluation'],cost:0,duration_ms:1})
  const skills=new Skills(pool,new Set(['inspect_dataset','propose_workflow_patch']),{[manifest.evaluation_suite]:suite},runtime,evaluator)
  const initial=await skills.draft(actor,manifest.id,0,{manifest,files});assert.equal(initial.revision,1)
  await assert.rejects(skills.draft(viewer,manifest.id,1,{manifest,files}),/FORBIDDEN/)
  await assert.rejects(skills.draft(actor,manifest.id,0,{manifest,files}),/VERSION_CONFLICT/)
  const first=await skills.candidate(actor,manifest.id,1,'Initial controlled fixture',null)
  const originalText=first.snapshot.files['SKILL.md'];files['SKILL.md']+='\nChanged draft.\n'
  await skills.draft(actor,manifest.id,1,{manifest,files})
  await assert.rejects(skills.candidate(actor,manifest.id,2,'Overwrite',null),/VERSION_IMMUTABLE/)
  await assert.rejects(skills.publish(actor,manifest.id,manifest.version,'fabricated'),/EVALUATION_REQUIRED/)
  mode='blocking';const blocking=await skills.evaluate(actor,manifest.id,manifest.version);assert.equal(blocking.status,'failed')
  await assert.rejects(skills.publish(actor,manifest.id,manifest.version,blocking.id),/EVALUATION_REQUIRED/)
  mode='missing';assert.equal((await skills.evaluate(actor,manifest.id,manifest.version)).status,'failed')
  mode='good';const evaluation=await skills.evaluate(actor,manifest.id,manifest.version);assert.equal(evaluation.status,'passed')
  await assert.rejects(skills.publish({project_id:'p',actor_id:'editor'},manifest.id,manifest.version,evaluation.id),/FORBIDDEN/)
  await skills.publish(actor,manifest.id,manifest.version,evaluation.id)
  assert.equal((await skills.list(actor,manifest.id)).definition.default_version,null)
  await skills.selectDefault(actor,manifest.id,manifest.version)
  const input={project_id:'p',dataset:{kind:'DatasetRef',project_id:'p',artifact_id:'input',digest:'b'.repeat(64)},workflow_revision:0,goal:'Inspect fixture',fit_scope:'undefined',policy_version:'policy1'}
  const invocation=await skills.invoke(actor,manifest.id,null,'fixture-session',input)
  assert.equal(invocation.snapshot.files['SKILL.md'],originalText)
  const next={...manifest,version:'2.0.0'}
  await skills.draft(actor,manifest.id,2,{manifest:next,files});await skills.candidate(actor,manifest.id,3,'Controlled update',manifest.version)
  const nextEvaluation=await skills.evaluate(actor,manifest.id,next.version);await skills.publish(actor,manifest.id,next.version,nextEvaluation.id)
  await skills.selectDefault(actor,manifest.id,next.version)
  assert.equal((await skills.load(actor,invocation.invocation_id)).version,manifest.version)
  await skills.selectDefault(actor,manifest.id,manifest.version)
  assert.equal((await skills.list(actor,manifest.id)).definition.default_version,manifest.version)
  const affected=await skills.retire(actor,manifest.id,manifest.version);assert.equal(affected[0].id,invocation.invocation_id)
  await assert.rejects(skills.invoke(actor,manifest.id,manifest.version,'s',input),/VERSION_UNAVAILABLE/)
  assert.equal((await skills.load(actor,invocation.invocation_id)).snapshot.files['SKILL.md'],originalText)
  await assert.rejects(skills.load({project_id:'q',actor_id:'bob'},invocation.invocation_id),/INVOCATION_NOT_FOUND/)
  await skills.feedback(actor,invocation.invocation_id,{kind:'quality',text:'Human-reviewed fixture feedback'})
  const disabled=new Skills(pool,new Set(),{},null)
  await assert.rejects(disabled.evaluate(actor,manifest.id,next.version),/EVALUATOR_UNCONFIGURED/)
}
