/**
 * 子代理禁用名单（ZCode WORKFLOW_CHILD_DISALLOWED_TOOLS 的对等）：执行语义工具
 * （CreateWorkflow/ResumeWorkflowRun/AmendWorkflow/EvalWorkflowSnippet）在子代理会话里
 * 不可用——alwaysAsk 在 child 里无窗可弹。只读内省工具不在此列。
 *
 * 判据：dsh 的子代理会话 header 带 `origin: 'subagent'`（session header 校验的既有词汇）。
 * @module
 */

/** 子代理禁用名单（工具名）。 */
export const CHILD_DISALLOWED_TOOLS: ReadonlySet<string> = new Set([
  'CreateWorkflow',
  'AmendWorkflow',
  'ResumeWorkflowRun',
  'EvalWorkflowSnippet',
])

/** actor 侧工具在子代理会话可用——它们就是为子代理（workflow actor）设计的。 */

/**
 * 子代理会话里调用执行语义工具时的稳定拒绝。
 * @param toolName - the toolName argument.
 * @returns the computed result.
 */
export function childDisallowedError(toolName: string): Error {
  return new Error(
    `${toolName} is not available to subagents: only the main session can start, amend, or resume workflow runs (there is no approval window to ask in). Read-only introspection tools (ListWorkflowRuns, GetWorkflowRun) remain available.`,
  )
}
