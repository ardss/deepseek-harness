/**
 * 终态 `<task-notification>` XML（local_workflow 形状）与 deliveryGuidance。
 * 逐字移植自 ZCode notification.ts（块序是契约，120k 总截断斩序
 * result > reports > artifacts > guidance）。Glossary 替换（TaskOutput → `job_output`、
 * TaskStop → `job_kill`）只落在引用了那两个 ZCode 工具名的句子里，见
 * `tool-dynamic-workflow/GLOSSARY.md`。
 *
 * 与 ZCode 的差异：ZCode 的输入同时带后台任务追踪器的通用词 `status` 与 dwf 三终态词
 * `runStatus`；dsh 的 jobs 面经 mapJobOutcomeStatus 折叠词汇，本包输入只收 dwf 三终态词
 * （`status` 字段，必填）——`<status>` 行因此恒说真话，不需要 runStatus 优先级逻辑。
 * @module
 */

import type {
  DynamicStopReason,
  DynamicWorkflowRunSettlement,
} from '@deepseek-ai/dsh-workflow-runs'
import { buildWorkflowArtifactsSection, WORKFLOW_ARTIFACTS_NOTIFICATION_MAX_LINES } from './artifacts-line.ts'
import { formatWorkflowProviderStopError } from './copy.ts'
import { escapeXml, escapeXmlText, truncateTaskNotification } from './xml.ts'

/** dsh 词汇替换：呈现指引里引用的 ZCode 工具名（GLOSSARY.md 的实现面）。 */
export const STOP_TOOL_NAME = '`job_kill`'

/** 终态通知的输入（ZCode TaskNotificationInput 的 dwf 子集；status 收敛为三终态词）。 */
export interface TaskNotificationInput extends DynamicWorkflowRunSettlement {
  /** run id（`<task-id>` 行）。 */
  taskId: string
  /** 发起这次 run 的工具调用 id（在场则带 `<tool-use-id>` 行）。 */
  toolUseId?: string
  /** 在场时在 XML 之后追加交付物呈现指引。 */
  deliveryGuidance?: boolean
}

/**
 * 铸造一条 dwf run 的终态通知（含可选 deliveryGuidance）。
 * @param input - the input argument.
 * @returns the computed result.
 */
export function formatWorkflowTaskNotification(input: TaskNotificationInput): string {
  const lines = ['<task-notification>', `<task-id>${escapeXml(input.taskId)}</task-id>`]
  if (input.toolUseId !== undefined) {
    lines.push(`<tool-use-id>${escapeXml(input.toolUseId)}</tool-use-id>`)
  }
  lines.push(`<status>${escapeXml(input.status)}</status>`)
  if (input.stopReason !== undefined) {
    lines.push(`<stop-reason>${escapeXml(input.stopReason)}</stop-reason>`)
  }
  if (input.description !== undefined) {
    lines.push(`<description>${escapeXml(input.description)}</description>`)
  }
  lines.push(`<summary>${escapeXml(input.summary)}</summary>`)
  if (input.result !== undefined) lines.push(`<result>${escapeXml(input.result)}</result>`)
  // provider 停下：`<error>` 是一整块表驱动文案（多行）；其余终态照旧一句 message。
  const providerStopError =
    input.failure?.providerStop === undefined
      ? undefined
      : formatWorkflowProviderStopError(input.failure, input.taskId)
  if (providerStopError !== undefined) {
    // 块里有要让模型照抄的 `run_id="…"`：只转义 <>&，引号原样。
    lines.push(`<error>\n${escapeXmlText(providerStopError)}\n</error>`)
  } else if (input.failure !== undefined) {
    lines.push(`<error>${escapeXml(input.failure.message)}</error>`)
  }
  // 渐进产物排在 result / error 之后；产物排在 `<reports>` 之后——这个顺序决定 120k 先斩谁。
  if (input.reports !== undefined && input.reports.length > 0) {
    lines.push(`<reports count="${input.reports.length}" shown="${input.reports.length}">`)
    lines.push(...input.reports.map(report => escapeXml(report.text)))
    lines.push('</reports>')
  }
  const artifacts = buildWorkflowArtifactsSection(
    input.artifacts,
    WORKFLOW_ARTIFACTS_NOTIFICATION_MAX_LINES,
  )
  if (artifacts !== undefined) {
    const shown = artifacts.shown < artifacts.count ? ` shown="${artifacts.shown}"` : ''
    lines.push(
      `<artifacts count="${artifacts.count}"${shown}>`,
      escapeXml(artifacts.preview),
      '</artifacts>',
    )
  }
  lines.push('</task-notification>')
  // 呈现指引排在最后：120k 总截断先斩指引再斩产物。
  if (input.deliveryGuidance === true) {
    lines.push(
      '',
      workflowDeliveryGuidance({
        status: input.status,
        stopReason: input.stopReason,
        hasArtifacts: artifacts !== undefined,
        runId: input.taskId,
        scriptPath: input.scriptPath,
      }),
    )
  }
  return truncateTaskNotification(lines.join('\n'))
}

/**
 * 终态通知末尾的呈现指引：三终态 × stopped 的五个 reason 各一支（外加 stopped 无 reason
 * 的老端口兜底支）。逐字移植；`TaskStop` 按 GLOSSARY 换成 `job_kill`。
 * @param input - the input argument.
 * @returns the computed result.
 */
export function workflowDeliveryGuidance(input: {
  status: DynamicWorkflowRunSettlement['status']
  stopReason: DynamicStopReason | undefined
  hasArtifacts: boolean
  runId: string
  scriptPath: string | undefined
}): string {
  const { status, stopReason, hasArtifacts, scriptPath } = input
  // 产物那一句只在 `<artifacts>` 节真的在场时追加。
  const artifactsSentence = hasArtifacts
    ? [
      'Artifacts listed above are already in front of the user as cards; refer to them by title and do not paste their contents. The one marked primary is the deliverable: point the user to it first.',
    ]
    : []
  const artifactsShort = hasArtifacts
    ? ['Artifacts listed above are already in front of the user.']
    : []
  if (status === 'completed') {
    return [
      'The workflow completed. Present its outcome to the user as a deliverable, in this order: the conclusion; each finding with its evidence (path and line, or the command and output that showed it); which findings were confirmed by a deterministic check or an independent subagent and which are judged only; what the run did not cover.',
      'The reported items above are individual findings: present them individually and keep their evidence. When the preview is partial (count greater than shown), say so and read the rest with GetWorkflowRun.',
      ...artifactsSentence,
      'Do not restate the phase graph or the script.',
    ].join('\n')
  }
  if (stopReason === 'user') {
    return [
      'The user stopped this workflow on purpose. Do not resume it with ResumeWorkflowRun and do not amend or rebuild it unless the user asks you to.',
      'Present what it finished before it was stopped: the reported items above are finished findings — show them individually with their evidence. Then stop and wait for the user to say what happens next.',
      ...artifactsShort,
    ].join('\n')
  }
  if (stopReason === 'model') {
    return [
      `You stopped this workflow with ${STOP_TOOL_NAME}. If you stopped it to fix the script, do that now: call AmendWorkflow with this run's ID and the corrected script — everything that settled before the stop is imported as cache, and the sooner the fix runs the less it re-pays. (Next time, amend the running run directly: AmendWorkflow stops it for you.)${
        scriptPath === undefined ? '' : ` Its script is at ${scriptPath}: edit that file and pass \`path\`.`
      }`,
      'Otherwise present what it finished: the reported items above are finished findings — show them individually with their evidence. Resume it unchanged only if that is what the user wants.',
      ...artifactsShort,
    ].join('\n')
  }
  if (stopReason === 'provider') {
    return [
      'A provider-side error stopped this run; the <error> block above names the cause and the fix. Present what the run finished: the reported items above are finished findings — show them individually with their evidence.',
      `Then resolve the cause with the user before calling ResumeWorkflowRun with run_id="${input.runId}" — finished steps replay from the journal. Do not rebuild the workflow.`,
      ...artifactsShort,
    ].join('\n')
  }
  if (stopReason === 'interrupted') {
    return [
      'The process that owned this run exited before it finished. Present what it finished: the reported items above are finished findings — show them individually with their evidence.',
      `Then call ResumeWorkflowRun with run_id="${input.runId}" — finished steps replay from the journal and only the unfinished ones run again.`,
      ...artifactsShort,
    ].join('\n')
  }
  if (stopReason === 'superseded') {
    // 正常到不了：superseded 的终态通知在 coordinator 处被压下。防御支不说「resume it」。
    return [
      "This run was stopped because you amended it: a newer run supersedes it and is already running. Do not resume this run and do not amend it again; wait for the successor's notification.",
      ...artifactsShort,
    ].join('\n')
  }
  if (status === 'stopped') {
    // reason 缺席（老端口 / stub）：只说「停了、可续」，不猜是谁停的。
    return [
      'This workflow was stopped before it finished. Present what it salvaged first: the reported items above are finished findings — show them individually with their evidence.',
      `It can be continued with ResumeWorkflowRun (run_id="${input.runId}"); ask the user before resuming a run you did not stop yourself.`,
      ...artifactsShort,
    ].join('\n')
  }
  if (status === 'errored') {
    return [
      "The workflow script failed. Present what it salvaged first: the reported items above are finished findings — show them individually with their evidence. Then explain the failure and what it means for the user's request.",
      ...artifactsShort,
      scriptPath === undefined
        ? `Fix the script and submit it with AmendWorkflow (run_id="${input.runId}") so finished work is reused. ResumeWorkflowRun will refuse this run: replaying the same script would fail the same way.`
        : `The run's script is at ${scriptPath}. Edit that file in place, then call AmendWorkflow (run_id="${input.runId}", path="${scriptPath}") so finished work is reused — do not paste the script inline. ResumeWorkflowRun will refuse this run: replaying the same script would fail the same way.`,
    ].join('\n')
  }
  // 兜底（未知终态词）：沿用旧的通用指引。
  return [
    "The workflow did not complete. Present what it salvaged first: the reported items above are finished findings — show them individually with their evidence. Then explain the failure and what it means for the user's request.",
    ...artifactsShort,
    'If the script itself was wrong, a corrected script submitted with AmendWorkflow re-uses the finished work.',
  ].join('\n')
}
