import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {validatePackage,validateSkillResult} from '../src/skill-contracts.ts'
const names=['data-analysis','data-cleaning','feature-engineering','numeric-quality-review']
for(const name of names) test(`validates immutable ${name} package and capability narrowing`,async()=>{
  const root=new URL(`../../../skill-packages/${name}/`,import.meta.url)
  const raw=JSON.parse(await readFile(new URL('skill.manifest.json',root),'utf8'))
  const files=Object.fromEntries(await Promise.all(['SKILL.md','contracts/input.schema.json','contracts/output.schema.json'].map(async path=>[path,await readFile(new URL(path,root),'utf8')])))
  const tools=new Set(['inspect_dataset','propose_workflow_patch'])
  const snapshot=validatePackage(raw,files,tools,new Set(['inspect']))
  const old=snapshot.files['SKILL.md'];files['SKILL.md']='modified';assert.equal(snapshot.files['SKILL.md'],old)
  assert.throws(()=>validatePackage(raw,files,new Set(),new Set(['inspect'])),/SKILL_TOOL_DENIED/)
  assert.throws(()=>validatePackage(raw,{...files,'../escape.md':'bad'},tools,new Set(['inspect'])),/SKILL_RESOURCE_PATH/)
})
test('rejects fabricated executed artifacts and wrong result status',async()=>{
  const ref={kind:'DatasetRef',project_id:'p',artifact_id:'missing',digest:'a'.repeat(64)}
  await assert.rejects(validateSkillResult({status:'executed',artifacts:[ref]},'p',async()=>false),/SKILL_ARTIFACT_UNAVAILABLE/)
  await assert.rejects(validateSkillResult({status:'executed'},'p',async()=>true))
  await assert.rejects(validateSkillResult({status:'submitted',run_id:'r',artifacts:[ref]},'p',async()=>true))
})
