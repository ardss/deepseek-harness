/**
 * 工具执行环境的公共取面：会话 / 工作目录 / 端口 / 子代理判据。
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Session } from '@deepseek-ai/dsh-session'
import type { DynamicWorkflowRunPort } from './port.ts'

/**
 * 调用方会话；非 agent 调用（装配直调）为 undefined。
 * @param exec - the exec argument.
 * @returns the computed result.
 */
export function sessionOf(exec: ToolRunContext): Session | undefined {
  return exec.agent?.session
}

/**
 * 会话工作目录；header 未带 cwd 时回退进程 cwd（落盘工具的正常底线）。
 * @param exec - the exec argument.
 * @returns the computed result.
 */
export function cwdOf(exec: ToolRunContext): string {
  return exec.agent?.session.header.cwd ?? process.cwd()
}

/**
 * dynamic run 端口（缺席即本会话没有执行能力——绝不静默成功）。
 * @param ctx - the ctx argument.
 * @returns the computed result.
 */
export function portOf(ctx: Context): DynamicWorkflowRunPort | undefined {
  return ctx.get('dynamicWorkflowRuns')
}

/**
 * 子代理会话判据（header.origin === 'subagent'）。
 * @param exec - the exec argument.
 * @returns the computed result.
 */
export function isSubagentSession(exec: ToolRunContext): boolean {
  return exec.agent?.session.header.origin === 'subagent'
}
