import type { Workflow } from '../src/contracts.ts'
export function fixture(): Workflow {
  return {schema_version:'1',project_id:'p',policy_version:'policy1',seed:42,environment_digest:'a'.repeat(64),nodes:[
    {id:'split',operator:'split',operator_version:'1',params:{method:'random',train_fraction:0.6,validation_fraction:0.2},inputs:{data:{kind:'DatasetRef',project_id:'p',artifact_id:'input',digest:'b'.repeat(64)}}},
    {id:'fit',operator:'fit',operator_version:'1',params:{method:'median',columns:['income'],fit_scope:'train',max_categories:10,unknown:'ignore'},inputs:{train:{node_id:'split',output_port:'train'}}},
    {id:'apply',operator:'transform',operator_version:'1',params:{},inputs:{data:{node_id:'split',output_port:'test'},transformer:{node_id:'fit',output_port:'transformer'}}},
  ]}
}
