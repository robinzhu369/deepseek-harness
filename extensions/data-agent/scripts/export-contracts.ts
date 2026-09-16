import { writeFile,mkdir } from 'node:fs/promises'
import { z } from 'zod'
import { Workflow, Manifest, operators, ImportOptions } from '../src/contracts.ts'
import { SkillInput,SkillResult,SkillManifest } from '../src/skill-contracts.ts'
const root=new URL('../../../domain-contracts/',import.meta.url)
await mkdir(root,{recursive:true})
for(const [name,schema] of Object.entries({'import-options':ImportOptions,workflow:Workflow,'worker-result':Manifest,'skill-input':SkillInput,'skill-result':SkillResult,'skill-manifest':SkillManifest})) {
  await writeFile(new URL(name+'.schema.json',root),JSON.stringify(z.toJSONSchema(schema),null,2)+'\n')
}
await writeFile(new URL('operators.json',root),JSON.stringify(Object.fromEntries(Object.entries(operators).map(([key,spec])=>[key,{...spec,params:z.toJSONSchema(spec.params)}])),null,2)+'\n')
