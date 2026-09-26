/**
 * 提交 → 后台 job 的薄封装：CreateWorkflow / AmendWorkflow 共用（「启动即后台」语义一致）。
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobId } from '@deepseek-ai/dsh-jobs'
import type { DynamicWorkflowSubmitRequest } from './port.ts'
import { startWorkflowRunJob } from './run-job.ts'
import type { DynamicWorkflowSubmitResult } from './port.ts'

/**
 * 注册 owned job 并同时交回两个标识：`jobId`（jobs 注册表的 JobId，job_output / job_kill
 * 的合法入参）与 `runId`（工作流引擎的 run 标识，GetWorkflowRun / AmendWorkflow / 列表工具
 * 的入参）。两者不可混用——把 runId 喂给 job_output 会被 validateJobId 拒绝。
 * 提交失败（端口同步拒绝、journal 不可用）向上冒泡成工具调用失败——绝不吞成带
 * backgroundTaskId 的成功。
 * @param ctx - the ctx argument.
 * @param options - the options argument.
 * @returns the computed result.
 */
export function submitRunInBackground(
  ctx: Context,
  options: {
    label: string
    agent: Agent
    start: (signal: AbortSignal) => Promise<{ runId: string }>
  },
): { jobId: JobId; runId: Promise<string> } {
  return startWorkflowRunJob(ctx, {
    label: options.label,
    owner: options.agent,
    start: options.start as (signal: AbortSignal) => Promise<DynamicWorkflowSubmitResult>,
  })
}

export type { DynamicWorkflowSubmitRequest }
