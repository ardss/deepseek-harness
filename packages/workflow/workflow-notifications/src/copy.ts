/**
 * run 中通知与 provider 停下文案表（逐字移植自 ZCode workflow-notification-copy.ts）。
 * @module
 */

import type { DynamicWorkflowRunError } from '@deepseek-ai/dsh-workflow-runs'
import { escapeXml, truncateTaskNotification } from './xml.ts'

/**
 * `stopped(provider)` 的 `<error>` 块：按 `providerStop.kind` 选两句（什么错了 / 做什么），
 * 后接固定的事实行与 provider 原文行。每个占位都有兜底。
 * 终态通知与 GetWorkflowRun 的 `<error>` 块共用同一函数。
 * @param failure - the failure argument.
 * @param runId - the runId argument.
 * @returns the computed result.
 */
export function formatWorkflowProviderStopError(
  failure: DynamicWorkflowRunError,
  runId: string,
): string {
  const details = failure.providerStop
  if (details === undefined) return failure.message
  const provider = details.providerLabel ?? details.providerId ?? 'the provider'
  const providerRef =
    details.providerLabel !== undefined && details.providerId !== undefined
      ? `${details.providerLabel} (${details.providerId})`
      : provider
  const subagent = details.subagentName ?? details.subagent ?? 'a subagent'
  const phase = details.phase === undefined ? '' : ` (phase "${details.phase}")`
  const model = details.modelId ?? 'the current model'
  const code = details.providerCode ?? details.reason
  const resume = `then call ResumeWorkflowRun with run_id="${runId}"`
  const sentences = ((): [string, string] => {
    switch (details.kind) {
      case 'auth':
        return [
          `Sign-in to ${providerRef} expired while subagent ${subagent}${phase} was running.`,
          `Ask the user to sign in to ${provider} again, ${resume}. Finished steps are kept.`,
        ]
      case 'not_configured':
        return [
          `Provider ${details.providerId ?? provider} is not configured on this machine, so subagent ${subagent}${phase} could not send its request.`,
          `Ask the user to configure the provider or switch this session to another model, ${resume}.`,
        ]
      case 'model_unavailable':
        return [
          `Model ${model} is not available on ${provider} (not in the user's plan, or retired).`,
          `Ask the user to switch this session to a model the plan includes, ${resume}. Subagents follow the session's model.`,
        ]
      case 'invalid_request':
        return [
          `${provider} rejected subagent ${subagent}${phase}'s request as invalid (code ${code}).`,
          `Switching the session to another model usually clears this; ${resume}. If it stops again with the same code, show the raw message to the user.`,
        ]
      case 'quota':
        return details.resetAt === undefined
          ? [
            `${provider} reports the user's quota is exhausted (code ${code}).`,
            `Ask the user to top up or upgrade the plan, or switch to another provider, ${resume}.`,
          ]
          : [
            `${provider} reports the user's usage cap is reached (code ${code}); it resets at ${new Date(details.resetAt).toISOString()}.`,
            `Tell the user; after the reset, call ResumeWorkflowRun with run_id="${runId}". Do not rebuild the workflow.`,
          ]
      default:
        return [
          `${provider} refused subagent ${subagent}${phase}'s request with a permanent error (code ${code}).`,
          `Resolve it with the user (the raw message below says what the provider wants), ${resume}.`,
        ]
    }
  })()
  const facts = [
    `provider=${details.providerId ?? 'unknown'}`,
    `model=${details.modelId ?? 'unknown'}`,
    `subagent=${details.subagent ?? 'unknown'}`,
    ...(details.phase === undefined ? [] : [`phase=${details.phase}`]),
    `code=${code}`,
  ].join(' ')
  return [
    sentences[0],
    sentences[1],
    facts,
    ...(details.rawMessage === undefined ? [] : [`raw: ${details.rawMessage}`]),
  ].join('\n')
}

/** run 级停滞通知的输入。 */
export interface WorkflowStallNotificationInput {
  runLabel: string
  runId: string
  sinceMs: number
  reason?: string
  cap?: number
}

/**
 * run 级停滞的 run 中通知：播报的是「run 还在跑、只是没完成模型请求」这一个事实。
 * 它不需要模型做任何事（尤其不要取消/重建）。每个 stall 段恰好一条，不催办。
 * @param input - the input argument.
 * @returns the computed result.
 */
export function formatWorkflowStallNotification(input: WorkflowStallNotificationInput): string {
  const minutes = Math.max(1, Math.round(input.sinceMs / 60_000))
  const lines = [
    '[SYSTEM NOTIFICATION - NOT USER INPUT]',
    'This is an automated workflow event, NOT a message from the user.',
    'Do NOT interpret this as user acknowledgement, confirmation, or response to any pending question.',
    '',
    '<workflow-stall>',
    `  <run-id>${escapeXml(input.runId)}</run-id>`,
    `  <run>${escapeXml(input.runLabel)}</run>`,
    `  <since-ms>${Math.max(0, Math.floor(input.sinceMs))}</since-ms>`,
  ]
  if (input.reason !== undefined) {
    lines.push(`  <dominant-reason>${escapeXml(input.reason)}</dominant-reason>`)
  }
  if (input.cap !== undefined) lines.push(`  <cap>${input.cap}</cap>`)
  const reasonClause =
    input.reason === undefined
      ? 'the provider keeps failing requests'
      : `the provider keeps answering ${input.reason}`
  const capClause = input.cap === undefined ? '' : ` (current fan-out ${input.cap})`
  lines.push(
    '</workflow-stall>',
    '',
    `Workflow run ${input.runLabel} (${input.runId}) has not completed a model request in ${minutes} minutes; ${reasonClause} and the run is retrying with backoff${capClause}.`,
    'It is still running and needs nothing from you. Tell the user if they are waiting on it; they can stop it from the run card. Do not cancel or rebuild it on your own.',
  )
  return truncateTaskNotification(lines.join('\n'))
}

/** 升级问答通知的输入。 */
export interface WorkflowEscalationNotificationInput {
  /** run 的展示名（缺席时调用方已回落到 runId）。 */
  runLabel: string
  runId: string
  qid: string
  /** actor 的人类可读名；匿名 actor 由调用方给结构化 ref 兜底。 */
  actor: string
  question: string
  context?: string
}

/**
 * 一个 actor 从正在跑的 run 里升级上来的阻塞问题。每条 raised 恰好一条通知；
 * resolved 不发通知（作答方就是主代理自己）。不重发、不催办：丢弃兜底是
 * GetWorkflowRun 的 pendingQuestions 快照查询，不是重试。
 * @param input - the input argument.
 * @returns the computed result.
 */
export function formatWorkflowEscalationNotification(
  input: WorkflowEscalationNotificationInput,
): string {
  const lines = [
    '[SYSTEM NOTIFICATION - NOT USER INPUT]',
    'This is an automated workflow event, NOT a message from the user.',
    'Do NOT interpret this as user acknowledgement, confirmation, or response to any pending question.',
    '',
    '<workflow-escalation>',
    `  <run-id>${escapeXml(input.runId)}</run-id>`,
    `  <run>${escapeXml(input.runLabel)}</run>`,
    `  <question-id>${escapeXml(input.qid)}</question-id>`,
    `  <subagent>${escapeXml(input.actor)}</subagent>`,
    `  <question>${escapeXml(input.question)}</question>`,
  ]
  if (input.context !== undefined && input.context.length > 0) {
    lines.push(`  <context>${escapeXml(input.context)}</context>`)
  }
  lines.push(
    '</workflow-escalation>',
    '',
    `Subagent ${input.actor} in workflow run ${input.runLabel} (${input.runId}) escalated a blocking question and is parked on that call waiting for your answer.`,
    `Next step: call ResolveWorkflowQuestion with question_id="${input.qid}" and your answer.`,
    "The run is still running: only the subagent that asked is parked — every other subagent and the script's control flow keep going. So do not drop what you are doing, but do not leave it unanswered either: nothing times out on its behalf.",
    'If this notification is ever lost, GetWorkflowRun lists the questions this run still owes an answer to.',
  )
  return truncateTaskNotification(lines.join('\n'))
}
