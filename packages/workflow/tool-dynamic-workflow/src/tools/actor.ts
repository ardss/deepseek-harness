/**
 * actor 侧工具：escalate / submit_result。端口在场才注册（ZCode includeEscalate 先例）——
 * 它们只存在于由 workflow runtime 派生的 actor 会话装配里。
 * @module
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { Context } from '@deepseek-ai/cordis'

/** escalate 工具描述 = actor 侧的使用纪律（逐字）。 */
const ESCALATE_DESCRIPTION = `Escalates a question that is BLOCKING you to the main agent that created this workflow, and waits here for the answer.

This is a LAST RESORT, for when you are genuinely stuck on something outside your reach:
- a gate that is broken or impossible to pass (a check capped at 95 when the threshold is 96);
- instructions that contradict each other, so no output can satisfy both;
- a fact you cannot obtain (a tradeoff, an external convention, what 'good' means here) that only whoever started this run knows.

Do NOT use it for curiosity, progress reports, asking permission, confirming a conclusion you could verify yourself, or thinking out loud. None of those are blocked — keep working.

Ask ONE focused question that can be answered in a sentence, and put your evidence in \`context\`: what you already tried, and exactly where you are stuck. The quality of the answer depends on it.

The cost: this call BLOCKS until the main agent answers, which may take a long time. You get at most 3 escalations per ask; the 4th tells you the budget is spent and to proceed on your own best judgement. Do not spend them on questions not worth waiting for.`

/**
 * escalate：阻塞等待结局；answered 与 refused 都是**普通工具结果**（不是错误）。
 * @param ctx - the ctx argument.
 * @returns the registry-ready tool definition.
 */
export function createEscalateTool(ctx: Context): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'escalate',
    description: ESCALATE_DESCRIPTION,
    parameters: {
      question: { type: 'string', required: true, description: 'One focused question, answerable in a sentence.' },
      context: { type: 'string', description: 'What you already tried and exactly where you are stuck.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['answered', 'refused'] },
          message: { type: 'string', required: true },
          qid: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    // 等待可能任意长（不设超时——「超时后自行判断」恰恰重新引入投机绕过）；exec.signal 的
    // 取消是唯一的逃生舱。
    async execute(args, exec) {
      const port = ctx.get('workflowEscalate')
      if (port === undefined) {
        throw new Error('Workflow escalate port is not configured for escalate (this session is not a workflow actor).')
      }
      const outcome = await port.escalate({
        toolCallId: exec.callId,
        question: String(args['question']),
        ...(typeof args['context'] === 'string' ? { context: args['context'] as string } : {}),
        signal: exec.signal,
      })
      // 判别位不进模型面：模型只读到答案本身，或端口写好的拒绝文案。
      return outcome.kind === 'answered'
        ? { status: 'answered' as const, message: outcome.answer, qid: outcome.qid }
        : { status: 'refused' as const, message: outcome.message }
    },
  })
}

/** submit_result 工具描述（actor 终态回交）。 */
const SUBMIT_RESULT_DESCRIPTION = 'Submit the structured final result for the ask you were created to perform, and end your part of the workflow. Call it exactly once, when your work is done: ' + '`outcome`' + ' "success" carries `result` (the typed value your creator asked for); "reject" explains why the ask cannot be satisfied and carries `error`. After this call your turn ends — do not continue working, and do not call it twice.'

/**
 * submit_result：actor 终态回交（typed 变体供 workflow 子代理）。
 * @param ctx - the ctx argument.
 * @returns the registry-ready tool definition.
 */
export function createSubmitResultTool(ctx: Context): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'submit_result',
    description: SUBMIT_RESULT_DESCRIPTION,
    parameters: {
      outcome: { type: 'string', required: true, enum: ['success', 'reject'], description: 'success carries `result`; reject carries `error`.' },
      result: { type: 'json', description: 'The typed final value (success only).' },
      error: { type: 'string', description: 'Why the ask cannot be satisfied (reject only).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { response: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.response }],
    },
    async execute(args, exec) {
      const port = ctx.get('workflowSubmitResult')
      if (port === undefined) {
        throw new Error('Workflow submit-result port is not configured for submit_result (this session is not a workflow actor).')
      }
      const outcome = await port.submitResult({
        toolCallId: exec.callId,
        outcome: args['outcome'] as 'success' | 'reject',
        ...(args['result'] !== undefined ? { result: args['result'] as JsonValue } : {}),
        ...(typeof args['error'] === 'string' ? { error: args['error'] as string } : {}),
      })
      return {
        response: outcome.accepted
          ? 'Result submitted. Your part of the workflow is complete.'
          : outcome.message ?? 'Result was not accepted.',
      }
    },
  })
}

/**
 * actor 侧工具的注册判据（端口在场才注册；apply 时探测一次）。
 * @param ctx - the ctx argument.
 * @returns the computed result.
 */
export function actorToolFactories(ctx: Context): (() => ReturnType<typeof defineTool>)[] {
  const factories: (() => ReturnType<typeof defineTool>)[] = []
  if (ctx.get('workflowEscalate') !== undefined) factories.push(() => createEscalateTool(ctx))
  if (ctx.get('workflowSubmitResult') !== undefined) factories.push(() => createSubmitResultTool(ctx))
  return factories
}
