/**
 * @deepseek-ai/dsh-tool-dynamic-workflow — 动态工作流的对话工具面插件。
 *
 * 注册 11 + 2 个工具（ZCode `core/src/tool/handlers/` 的对等，spec-conversation-flow
 * §二~§九逐条落地）+ alwaysAsk 确认门 + 用途提示词段。引擎（journal 模块）尚未实施时，
 * 端口缺席走占位文案——「本会话没有执行能力」，绝不假装启动。
 *
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installAskGate } from './ask-gate.ts'
import { writingToolFactories } from './tools/writing.ts'
import {
  createGetWorkflowRunTool,
  createListModelsTool,
  createListWorkflowRunsTool,
  createResolveWorkflowQuestionTool,
  createResumeWorkflowRunTool,
} from './tools/introspection.ts'
import { actorToolFactories } from './tools/actor.ts'

export { DYNAMIC_WORKFLOW_SKILL_NAME, TASK_OUTPUT_REF, TASK_STOP_REF } from './glossary.ts'
export { WORKFLOW_SKILL_NOT_LOADED_CODE } from './skill-gate.ts'
export { CHILD_DISALLOWED_TOOLS, childDisallowedError } from './child-disallowed.ts'
export type {
  DynamicWorkflowRunPort,
  DynamicWorkflowRunDetail,
  DynamicWorkflowRunSummary,
  WorkflowEscalatePort,
  WorkflowSubmitResultPort,
  WorkflowModelSummary,
} from './port.ts'
export { mapJobOutcomeStatus, renderSettlementNotification, startWorkflowRunJob } from './run-job.ts'

/** Config:动态工作流工具簇的总开关与提示词段开关。 */
export interface Config {
  /** Register the whole tool cluster (default true). */
  enable?: boolean
  /** Register the usage prompt section alongside the tools (default true). */
  enablePromptSection?: boolean
}

export const Config: z<Config> = z.object({
  enable: z.boolean().default(true),
  enablePromptSection: z.boolean().default(true),
})

export const name = 'tool-dynamic-workflow'
// 可选接缝（jobs / dynamicWorkflowRuns / workflowEscalate / workflowSubmitResult）经
// `ctx.get(...)` 读取：缺席的服务解析为 undefined（端口缺席 = 占位语义的一等公民），
// 且不作为 inject 依赖——否则 fiber 会一直等一个永不存在的实现。
export const inject = ['tools', 'systemPrompt']

export function apply(ctx: Context, config: Config): void {
  if (config.enable !== true) return

  // alwaysAsk 确认门（CreateWorkflow / AmendWorkflow 带脚本 / SaveWorkflow / ResumeWorkflowRun）。
  installAskGate(ctx)

  if (config.enablePromptSection !== false) {
    // 用途纪律随工具自带（master convention：工具指引进 tool 插件的 prompt section）。
    ctx.systemPrompt.section({
      name: 'tool:CreateWorkflow',
      order: ctx.systemPrompt.getSectionOrder('TOOL_WORKFLOW'),
      text: 'Use the CreateWorkflow tool ONLY when the user explicitly asks for a workflow (点名 workflow/工作流): it is mandatory then, regardless of task size. Without such an explicit request, do not start a workflow — delegate with the subagent tools or do the work yourself. A running workflow reports progress by itself; do not poll it.',
    })
  }

  {
    for (const tool of writingToolFactories(ctx)) ctx.tools.register(tool)
    ctx.tools.register(createListWorkflowRunsTool(ctx))
    ctx.tools.register(createGetWorkflowRunTool(ctx))
    ctx.tools.register(createResumeWorkflowRunTool(ctx))
    ctx.tools.register(createResolveWorkflowQuestionTool(ctx))
    ctx.tools.register(createListModelsTool(ctx))
    // actor 侧：端口在场才注册（escalate / submit_result 只存在于 workflow actor 装配）。
    for (const factory of actorToolFactories(ctx)) ctx.tools.register(factory())
  }
}
