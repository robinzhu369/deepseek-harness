import test from 'node:test'
import assert from 'node:assert/strict'
import { compile, affected, digest, type Workflow } from '../src/contracts.ts'
import { fixture } from './fixtures.ts'
test('symbolic split/fit outputs compile before artifacts exist',()=>assert.deepEqual(compile(fixture()).order,['split','fit','apply']))
test('layout and JSON key order do not change computation identity',()=>{
  const a=fixture(), b=structuredClone(a); b.layout={fit:{x:100,y:200}}
  assert.equal(compile(a).digest,compile(b).digest); assert.deepEqual(affected(a,b),[])
  assert.equal(digest({b:2,a:1}),digest({a:1,b:2}))
})
test('parameter edits invalidate descendants, not ancestors',()=>{
  const a=fixture(),b=structuredClone(a); b.nodes[1].params.method='mean'
  assert.deepEqual(affected(a,b),['apply','fit'])
})
test('reject cross-project data, dangling ports, arbitrary operators, cycles and non-train fitting',()=>{
  for(const change of [
    (w:Workflow)=>{w.project_id='other'},
    (w:Workflow)=>{w.nodes[1].inputs.train={node_id:'absent',output_port:'train'}},
    (w:Workflow)=>{w.nodes[1].inputs.train={node_id:'split',output_port:'test'}},
    (w:Workflow)=>{w.nodes[1].operator='shell'},
    (w:Workflow)=>{w.nodes[0].inputs.data={node_id:'apply',output_port:'data'}},
  ]) { const w=fixture();change(w);assert.throws(()=>compile(w)) }
})
test('reject fitting transformed test ancestry',()=>{
  const w=fixture()
  w.nodes.push({id:'fit2',operator:'fit',operator_version:'1',params:{...w.nodes[1].params},inputs:{train:{node_id:'apply',output_port:'data'}}})
  assert.throws(()=>compile(w),/FIT_SCOPE/)
})
test('business column names can be Chinese without becoming executable expressions',()=>{
  const w=fixture();w.nodes[1].params.columns=['收入（元）'];assert.ok(compile(w))
})
