/** Only the external model is scripted; dsh loads the actual Session, loop, tools and Skill registry. */
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
export const name = 'data-agent-scripted-model'
export const inject = ['llm']
class Scripted extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (JSON.stringify(options.messages).includes('Draft one concise, practical data modeling preparation goal')) {
      assert.equal(options.tools?.length ?? 0, 0)
      const block=options.messages.filter(message=>message.role==='user').at(-1)?.content.find(block=>block.type==='text')
      assert.ok(block && block.type==='text')
      const request=JSON.parse(block.text)
      if(request.keywords==='simulate failure')throw new Error('Synthetic generation failure')
      yield {type:'block-start',index:0,blockType:'text'}
      yield {type:'text-delta',index:0,text:request.keywords?`Prepare training data for ${request.keywords}; confirm cleaning and feature proposals before execution.`:'Inspect data quality and prepare training data after confirming the processing proposal.'}
      yield {type:'finish',reason:{kind:'stop'}}
      return
    }
    if (options.tools?.some((tool) => tool.name === 'submit_skill_result')) {
      assert.deepEqual(
        options.tools.map((tool) => tool.name),
        ['submit_skill_result'],
      )
      assert.ok(
        JSON.stringify(options.messages).includes(
          'Evaluate synthetic data plans using only submit_skill_result',
        ),
      )
      assert.ok(!JSON.stringify(options.messages).includes('{{cwd}}'))
      if (options.messages.at(-1)?.content.some((block) => block.type === 'tool-result')) {
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const blocks = options.messages.filter((message) => message.role === 'user').at(-1)?.content
      const block = blocks?.find((block) => block.type === 'text')
      assert.ok(block && block.type === 'text')
      const { input } = JSON.parse(block.text)
      const cleaning = input.request.includes('fill ONLY'),
        feature = input.request.includes('income_ratio')
      const node = {
        id: 'step',
        operator: cleaning ? 'fill_constant' : feature ? 'derive' : 'inspect',
        operator_version: '1',
        params: cleaning
          ? { columns: ['income'], value: -1 }
          : feature
            ? {
                left: 'income',
                right: 'denominator',
                output: 'income_ratio',
                method: 'divide',
                invalid: 'null',
              }
            : {},
        inputs: { data: input.dataset },
      }
      const result = input.request.startsWith('A user asks')
        ? { status: 'needs_review', reasons: ['Protected target; train scope and human approval required'] }
        : {
            status: 'proposed',
            workflow: { ...input.workflow_template, nodes: [node] },
            evidence:
              cleaning || feature
                ? []
                : [
                    {
                      metric: 'income_nulls',
                      value: input.rows.filter((row: { income: number | null }) => row.income === null)
                        .length,
                      scope: 'full_exact',
                      report: input.report,
                    },
                    {
                      metric: 'income_negative',
                      value: input.rows.filter(
                        (row: { income: number | null }) => row.income !== null && row.income < 0,
                      ).length,
                      scope: 'full_exact',
                      report: input.report,
                    },
                  ],
            needs_confirmation: cleaning || feature ? ['Confirm changes'] : [],
          }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield {
        type: 'tool-call-delta',
        index: 0,
        id: ToolCallId('evaluation-call'),
        name: 'submit_skill_result',
        argumentsDelta: JSON.stringify({ result_json: JSON.stringify(result) }),
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    assert.ok(
      JSON.stringify(options.messages).includes('domain_schemas'),
      'Workflow and proposal schemas must be visible in logged context',
    )
    assert.ok(
      JSON.stringify(options.messages).includes('Always write every user-visible response in Simplified Chinese'),
      'Domain sessions must instruct the model to answer users in Simplified Chinese',
    )
    const task = options.tools?.some((tool) => tool.name === 'get_task_snapshot')
    assert.deepEqual(
      options.tools?.map((tool) => tool.name).sort(),
      [
        'get_run_snapshot',
        'inspect_dataset',
        'propose_workflow_patch',
        'read_report',
        'read_skill_resource',
        'skill',
        ...(task ? ['get_task_snapshot', 'rerun', 'submit_task_run'] : []),
      ].sort(),
    )
    if (options.messages.at(-1)?.content.some((block) => block.type === 'tool-result')) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield {
        type: 'text-delta',
        index: 0,
        text: '工具结果已记录；排队中的任务尚未完成。',
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const text = JSON.stringify(options.messages.filter((m) => m.role === 'user').at(-1))
    if (text.includes('TEST_ASYNC')) {
      await new Promise(resolve => setTimeout(resolve,500))
      yield {type:'block-start',index:0,blockType:'text'}
      yield {type:'text-delta',index:0,text:'ASYNC_COMPLETE'}
      yield {type:'finish',reason:{kind:'stop'}}
      return
    }
    const proposal = {
      schema_version: '1',
      project_id: 'p',
      policy_version: 'policy1',
      seed: 0,
      environment_digest: 'a'.repeat(64),
      nodes: [
        {
          id: 'inspect',
          operator: 'inspect',
          operator_version: '1',
          params: {},
          inputs: {
            data: { kind: 'DatasetRef', project_id: 'p', artifact_id: 'input', digest: 'b'.repeat(64) },
          },
        },
      ],
    }
    const command = options.messages
      .filter((m) => m.role === 'user')
      .at(-1)
      ?.content.find((b) => b.type === 'text')
    if(command?.type==='text' && command.text.startsWith('TEST_CAPACITY_PROPOSE ')){
      const proposal=JSON.parse(command.text.slice('TEST_CAPACITY_PROPOSE '.length))
      yield {type:'block-start',index:0,blockType:'tool-call'}
      yield {type:'tool-call-delta',index:0,id:ToolCallId('capacity-call'),name:'propose_workflow_patch',argumentsDelta:JSON.stringify({proposal_json:JSON.stringify(proposal)})}
      yield {type:'finish',reason:{kind:'tool-calls'}};return
    }
    const taskArgs =
      command?.type === 'text' && command.text.includes('TEST_TASK_SUBMIT ')
        ? command.text.split('TEST_TASK_SUBMIT ')[1]
        : null
    const action = taskArgs
      ? { name: 'submit_task_run', args: { request_json: taskArgs } }
      : text.includes('TEST_TASK_STATUS')
        ? { name: 'get_task_snapshot', args: {} }
        : text.includes('TEST_PROPOSE')
          ? {
              name: 'propose_workflow_patch',
              args: {
                proposal_json: JSON.stringify({
                  workflow_id: task ? 'task-proposal' : 'test-proposal',
                  expected_revision: 0,
                  goal: 'Inspect input',
                  workflow: proposal,
                  evidence: [],
                  expected_impact: [],
                  unmet_prerequisites: [],
                }),
              },
            }
          : text.includes('TEST_WORKBENCH')
            ? { name: 'inspect_dataset', args: { dataset_id: 'workbench-input' } }
            : text.includes('TEST_INSPECT')
              ? { name: 'inspect_dataset', args: { dataset_id: 'input' } }
              : text.includes('TEST_FORBIDDEN')
                ? { name: 'inspect_dataset', args: { dataset_id: 'other-project' } }
                : { name: 'skill', args: { name: 'data-analysis' } }
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield {
      type: 'tool-call-delta',
      index: 0,
      id: ToolCallId('test-call'),
      name: action.name,
      argumentsDelta: JSON.stringify(action.args),
    }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}
export function apply(ctx: Context) {
  ctx.llm.registerAdapter(['data-agent-scripted'], new Scripted())
}
