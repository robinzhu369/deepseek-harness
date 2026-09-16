/** Re-score immutable real-model responses locally; this test never contacts a model. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkQualityPlan } from '../src/quality-evaluation.ts'
import { createHash } from 'node:crypto'
import { digest } from '../src/contracts.ts'
const root=fileURLToPath(new URL('../../../evals/data-agent/',import.meta.url))
for(const version of ['v010','real'])test(version+': recorded model proposals retain strict failures while valid supplementary row counts pass',async()=>{
  const original=JSON.parse(await readFile(join(root,`skill-quality-${version}.json`),'utf8'))
  const files=await readdir(join(root,`skill-quality-${version}-sessions`),{recursive:true})
  const inputs=new Map<string,unknown>()
  for(const file of files.filter(file=>file.endsWith('.jsonl'))){
    const events=(await readFile(join(root,`skill-quality-${version}-sessions`,file),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
    for(const event of events)if(event.type==='user/message'){
      const text=event.data.content?.find((block:{type:string})=>block.type==='text')?.text
      if(!text?.startsWith('{"evaluation"'))continue
      const payload=JSON.parse(text);inputs.set(digest(payload.input),payload.input)
    }
  }
  let checked=0,blocked=0
  for(const [id,evaluation] of Object.entries(original) as [string,{status:string;report:{cases:{id:string;lane:string;metrics:Record<string,number>;trace:string;passed:boolean;blocking_failures:string[]}[]}}][]){
    for(const item of evaluation.report.cases){
      if(item.lane!=='planning')continue
      const observations=JSON.parse(item.trace)
      for(const observation of observations){
        const input=inputs.get(observation.input_digest) as Parameters<typeof checkQualityPlan>[3]
        assert.ok(input,'missing logged input')
        const runtime={harness_commit:'c291e7961a515f6d7af9304e7fd1d257929aef26',model_id:'deepseek-v4-flash',model_snapshot:null,environment_digest:input.workflow_template.environment_digest,policy_version:input.workflow_template.policy_version,parameters:{}}
        observation.blocking_failures=observation.timed_out?['MODEL_TIMEOUT']:!observation.submitted?['NO_RESULT']:checkQualityPlan(id,observation.result,runtime,input)
        checked++;if(observation.blocking_failures.length)blocked++
      }
      const candidate=observations.filter((o:{variant:string})=>o.variant==='candidate'),baseline=observations.filter((o:{variant:string})=>o.variant==='baseline')
      const passes=(items:{blocking_failures:string[]}[])=>items.filter(o=>!o.blocking_failures.length).length
      const rate=passes(candidate)/candidate.length
      item.metrics={candidate_passes:passes(candidate),baseline_passes:passes(baseline),repetitions:candidate.length,candidate_failure_rate:1-rate,candidate_pass_variance:rate*(1-rate),baseline_failure_rate:1-passes(baseline)/baseline.length}
      item.blocking_failures=[...new Set<string>(candidate.flatMap((o:{blocking_failures:string[]})=>o.blocking_failures))]
      item.passed=item.blocking_failures.length===0;item.trace=JSON.stringify(observations)
    }
    evaluation.status=evaluation.report.cases.every(c=>c.passed)?'passed':'failed'
  }
  assert.equal(checked,72);assert.ok(blocked>0)
  if(version==='v010')assert.equal(original['data-analysis'].report.cases[0].metrics.candidate_passes,3)
  assert.equal(original['data-analysis'].status,'failed')
  assert.equal(original['data-cleaning'].status,'failed')
  assert.equal(original['feature-engineering'].status,'failed')
  if(version==='v010')assert.equal(original['numeric-quality-review'].status,'passed')
  if(process.env.DATA_AGENT_WRITE_REPLAY==='1')await writeFile(join(root,`skill-quality-${version}-rescored.json`),JSON.stringify({local_only:true,scoring_revision:5,scorer_sha256:createHash('sha256').update(await readFile(new URL('../src/quality-evaluation.ts',import.meta.url))).digest('hex'),original:`skill-quality-${version}.json`,correction:'Allow exact supplementary row_count and read-only verification nodes; preserve strict schema and mandatory confirmation failures.',evaluations:original},null,2)+'\n')
})
