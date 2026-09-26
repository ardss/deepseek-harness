/**
 * jobs 投递适配（蓝图 §3.3）：run 以 `ctx.jobs` producer 注册（kind `workflow-run`），
 * 终态通知的**投递**完全交给 tool-jobs 既有 completion delivery（busy 注入 / idle wakeup /
 * maxConsecutiveWakes 防自激）；本插件只负责把通知文本铸造好（workflow-notifications）。
 *
 * escalation / stall 的回合中通知（ZCode 方案 A 的 `notice(text)`）在 dsh jobs 面尚无对应
 * 通道——按蓝图 R1 的方案 B 降级：停驻问题经 GetWorkflowRun 的 pendingQuestions 快照兜底。
 * 如实声明，不是静默降级。
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobId, JobOutcome } from '@deepseek-ai/dsh-jobs'
import type { DynamicWorkflowRunSettlement } from '@deepseek-ai/dsh-workflow-runs'
import { formatWorkflowTaskNotification } from '@deepseek-ai/dsh-workflow-notifications'
import type { DynamicWorkflowSubmitResult } from './port.ts'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    'workflow-run': 'workflow-run'
  }
}

/**
 * 引擎终态 → jobs 三词（蓝图 §1.2 的 mapJobOutcomeStatus；detail 一行）。
 * @param settlement - the settlement argument.
 * @returns the computed result.
 */
export function mapJobOutcomeStatus(
  settlement: DynamicWorkflowRunSettlement,
): { status: JobOutcome['status']; detail: string } {
  switch (settlement.status) {
    case 'completed':
      return { status: 'completed', detail: settlement.summary }
    case 'errored':
      return { status: 'failed', detail: settlement.failure?.message ?? settlement.summary }
    case 'stopped':
      return {
        status: 'killed',
        detail: `stopped${settlement.stopReason === undefined ? '' : ` (${settlement.stopReason})`}`,
      }
  }
}

/**
 * 结算 → 完整终态通知文本（含 deliveryGuidance；120k 截断在铸造器内）。
 * @param runId - the runId argument.
 * @param settlement - the settlement argument.
 * @returns the computed result.
 */
export function renderSettlementNotification(
  runId: string,
  settlement: DynamicWorkflowRunSettlement,
): string {
  return formatWorkflowTaskNotification({
    taskId: runId,
    status: settlement.status,
    stopReason: settlement.stopReason,
    failure: settlement.failure,
    result: settlement.result,
    summary: settlement.summary,
    description: settlement.description,
    scriptPath: settlement.scriptPath,
    reports: settlement.reports,
    artifacts: settlement.artifacts,
    deliveryGuidance: true,
  })
}

/**
 * 注册一个 run 为 owned job。starter 在 job starter 内被调用（run 属于 job）；提交失败
 * 使 `runId` reject 并让 done settle failed——提交失败绝不吞成带 backgroundTaskId 的成功
 * （那会让后台追踪器去轮询一个不存在的 run）。
 * @param ctx - the ctx argument.
 * @param options - the options argument.
 * @returns the computed result.
 */
export function startWorkflowRunJob(
  ctx: Context,
  options: {
    label: string
    owner: Agent
    start: (signal: AbortSignal) => Promise<DynamicWorkflowSubmitResult>
  },
): { jobId: JobId; runId: Promise<string> } {
  const jobs = ctx.get('jobs')
  if (jobs === undefined) {
    throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
  }
  let resolveRunId!: (value: string) => void
  let rejectRunId!: (reason?: unknown) => void
  const runId = new Promise<string>((resolve, reject) => {
    resolveRunId = resolve
    rejectRunId = reject
  })
  const controller = new AbortController()
  let portCancel: ((reason?: string) => void) | undefined
  void runId.then((id) => {
    portCancel = (reason?: string) => {
      void ctx.get('dynamicWorkflowRuns')?.cancel?.(id, reason ?? 'workflow job killed')
    }
  }, () => {})
  const jobId = jobs.start({
    kind: 'workflow-run',
    label: options.label,
    owner: options.owner.id,
    run(job) {
      // registry 在 kill/teardown 时先调 hooks.cancel，再等待 done；把取消转发给端口。
      job // （仅确立此回调在 job 语境里执行）
      controller.signal.addEventListener('abort', () => { portCancel?.(controller.signal.reason) }, { once: true })
      const submission = options.start(controller.signal)
      void submission.then(
        (submitted) => { resolveRunId(submitted.runId) },
        (error) => { rejectRunId(error) },
      )
      return {
        cancel: (reason?: string) => {
          controller.abort(reason ?? 'workflow job killed')
          portCancel?.(reason)
        },
        done: submission.then(({ runId: id, settled }) =>
          settled.then((settlement): JobOutcome => ({
            ...mapJobOutcomeStatus(settlement),
            result: renderSettlementNotification(id, settlement),
          })),
        ).catch((error: unknown): JobOutcome => ({
          status: 'failed',
          detail: error instanceof Error ? error.message : String(error),
        })),
      }
    },
  })
  return { jobId, runId }
}
