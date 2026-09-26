/**
 * 内省与控制工具簇：ListWorkflowRuns / GetWorkflowRun / ResumeWorkflowRun /
 * ResolveWorkflowQuestion / ListModels（spec-conversation-flow §4、§9 的逐字落地）。
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { escapeXml } from '@deepseek-ai/dsh-workflow-notifications'
import { cwdOf, isSubagentSession, portOf } from '../context.ts'
import { childDisallowedError, CHILD_DISALLOWED_TOOLS } from '../child-disallowed.ts'
import { portPayloadAsJson } from '../port.ts'
import { describeWorkflowScriptPath } from '../drafts.ts'

/**
 * 两个内省工具共用的异步引导（逐字）。不禁用轮询——用户显式要求盯着在飞 run 时它仍是
 * 对的动作；这里只设默认。
 */
export const WORKFLOW_RUN_INTROSPECTION_STEERING = [
  'Runs this session starts settle on their own: you receive a completion notification carrying the final output. Do NOT poll this tool while waiting for one — continue with other work.',
  "Reach for it when: (a) the user asks how a workflow is going, (b) you want to review this project's earlier runs, including ones other sessions started, (c) a completion notification was truncated and you need the run's full record by ID.",
].join('\n')

/**
 * 「本会话没有 workflow 内省能力」——绝不静默回空列表（会把「没跑过」和「读不到」混为一谈）。
 * @returns the computed result.
 */
export function workflowIntrospectionUnavailable(): Error {
  return new Error(
    'workflow_introspection_unavailable: this session cannot read workflow runs — workflow execution is not available here, so no run history is reachable. This is a capability gap, not an empty project.',
  )
}

function assertNotChild(exec: ToolRunContext): void {
  if (isSubagentSession(exec) && CHILD_DISALLOWED_TOOLS.has(exec.name)) {
    throw childDisallowedError(exec.name)
  }
}

// ============================================================
// ListWorkflowRuns
// ============================================================

/**
 * ListWorkflowRuns 工具（只读；行字段与 ZCode 同形）。
 * @param ctx - the ctx argument.
 * @returns the registry-ready tool definition.
 */
export function createListWorkflowRunsTool(ctx: Context): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'ListWorkflowRuns',
    description: `Lists this project's dynamic-workflow runs (the session's working directory is the project key), most recently updated first. Includes runs started by other sessions — the run journal is per-project, not per-session.\n\n${WORKFLOW_RUN_INTROSPECTION_STEERING}`,
    parameters: {
      status: {
        type: 'string',
        description: 'Optional status filter.',
        enum: ['running', 'pending', 'completed', 'errored', 'stopped'],
      },
      limit: { type: 'integer', description: 'Maximum rows (1-50, default 20).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { response: { type: 'string', required: true }, runs: { type: 'json' } },
      },
      render: (_args, value) => [{ type: 'text', text: value.response }],
    },
    async execute(args) {
      const port = portOf(ctx)
      if (port === undefined || typeof port.listRuns !== 'function') {
        throw workflowIntrospectionUnavailable()
      }
      const runs = await port.listRuns()
      const filtered = typeof args['status'] === 'string'
        ? runs.filter(run => run.status === args['status'])
        : runs
      const limit = typeof args['limit'] === 'number' ? Math.min(Math.max(1, args['limit']), 50) : 20
      const selected = filtered.slice(0, limit)
      const lines = selected.map(run => [
        `- ${run.runId}`,
        `label=${JSON.stringify(run.label)}`,
        `status=${run.status}`,
        ...(run.stopReason === undefined ? [] : [`stop_reason=${run.stopReason}`]),
        ...(run.resumedFrom === undefined ? [] : [`resumed_from=${run.resumedFrom}`]),
        ...(run.supersededBy === undefined ? [] : [`superseded_by=${run.supersededBy}`]),
        `owned_by_this_session=${run.ownedByThisSession}`,
        ...(run.possiblyInterrupted === true ? ['possibly_interrupted=true'] : []),
      ].join(' '))
      return {
        runs: portPayloadAsJson(selected),
        response: [
          lines.length > 0 ? lines.join('\n') : 'No workflow runs for this project.',
          ...(selected.some(run => run.possiblyInterrupted === true)
            ? ['', '`possibly_interrupted="true"` means this session cannot confirm the run is still alive: it may be a leftover from a process that exited, or a sibling session\'s run still in flight. It is an annotation, not a verdict — do not report it as a failure.']
            : []),
        ].join('\n'),
      }
    },
  })
}

// ============================================================
// GetWorkflowRun
// ============================================================

/**
 * GetWorkflowRun 工具（只读；块序是契约：summary → 身份 → 停驻问题 → 生命线 → 收场 → 路由）。
 * @param ctx - the ctx argument.
 * @returns the registry-ready tool definition.
 */
export function createGetWorkflowRunTool(ctx: Context): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'GetWorkflowRun',
    description: `Returns the current state of one dynamic-workflow run: progress, token usage and the tail of its log() narration while it runs; the final result once it completed; the structured failure if it errored or was stopped.\n\n${WORKFLOW_RUN_INTROSPECTION_STEERING}\n\n- Takes run_id — from CreateWorkflow's or AmendWorkflow's result, from a completion notification, or from ListWorkflowRuns.\n- This is an instant snapshot and never waits. To block until a run THIS session started finishes, use job_output with wait instead: that is the waiting tool. GetWorkflowRun is the right tool when you must not wait, or when the run belongs to another session (a waiting job_output cannot see those).\n- The \`artifacts\` section lists what the run published for the user — files, documents and live dashboards that are ALREADY shown to them as cards. Refer to one by its title; do not paste its contents back. The one marked \`primary\` is the deliverable: point the user to it first.\n- Three terminal states: \`completed\`; \`errored\` (the script itself failed — not resumable, amend it); \`stopped\` with a stop reason — \`user\` (cancelled on purpose: resume only when the user asks), \`model\` (your own job_kill), \`provider\` (a provider-side error stopped it: the \`<error>\` block names the cause and the fix; resolve it with the user, then resume), \`interrupted\` (the process that owned the run exited — continuing it is usually what the user wants), \`superseded\` (an AmendWorkflow replaced it; \`<superseded_by>\` names the successor — read that run instead, never resume this one).\n- A stopped run (other than a superseded one) can be continued with ResumeWorkflowRun — no rebuild needed, same run ID, same script.\n- ANY run — completed, stopped, errored, or still running — can instead be revised with AmendWorkflow: pass its run ID and the corrected script, and the finished work is imported as cache. When the script itself errored, that is the move — fix the script and keep the work that already succeeded, rather than rewriting from scratch.`,
    parameters: {
      run_id: { type: 'string', required: true, description: 'The workflow run ID.' },
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
      const port = portOf(ctx)
      if (port === undefined || typeof port.getRunDetail !== 'function') {
        throw workflowIntrospectionUnavailable()
      }
      const runId = String(args['run_id'])
      const run = await port.getRunDetail(runId)
      if (run === undefined) {
        throw new Error(`run_not_found: no workflow run with ID ${runId} exists for this project. Use ListWorkflowRuns to see the runs that do.`)
      }
      const blocks: string[] = [
        `<summary>${escapeXml(run.summary)}</summary>`,
        [
          `<run_id>${escapeXml(run.runId)}</run_id>`,
          `<label>${escapeXml(run.label)}</label>`,
          `<status>${escapeXml(run.status)}</status>`,
          ...(run.stopReason === undefined ? [] : [`<stop-reason>${escapeXml(run.stopReason)}</stop-reason>`]),
          ...(run.supersededBy === undefined ? [] : [`<superseded_by>${escapeXml(run.supersededBy)}</superseded_by>`]),
          ...(run.resumedFrom === undefined ? [] : [`<resumed_from>${escapeXml(run.resumedFrom)}</resumed_from>`]),
        ].join('\n'),
      ]
      if (run.pendingQuestions === undefined) {
        // 停驻问题查不到时明说——沉默会被读成「没有人在等」，而那正是最危险的误读。
        blocks.push(
          '<pending_questions>Unknown: pending questions are tracked only by the process that owns the run, and this session does not. Resuming the run will re-ask any question its subagent still needs answered.</pending_questions>',
        )
      } else if (run.pendingQuestions.length > 0) {
        blocks.push(
          '<pending_questions>',
          ...run.pendingQuestions.map(question =>
            `  [${question.questionId}] ${question.actorName ?? question.actor ?? 'subagent'}: ${escapeXml(question.question)}`,
          ),
          '</pending_questions>',
          '',
          'Each of these subagents is parked waiting for an answer and nothing times out on its behalf. Answer one with ResolveWorkflowQuestion using the ID in brackets. The rest of the run keeps running meanwhile.',
        )
      }
      if (run.logTail !== undefined && run.logTail.length > 0) {
        blocks.push('<log_tail>', ...run.logTail.map(line => escapeXml(line)), '</log_tail>')
      }
      if (run.result !== undefined) blocks.push(`<result>${escapeXml(run.result)}</result>`)
      if (run.error !== undefined) {
        blocks.push(`<error>${escapeXml(run.error.message)}</error>`)
      }
      if (run.artifacts !== undefined && run.artifacts.length > 0) {
        blocks.push(
          '<artifacts>',
          ...run.artifacts.map(artifact => escapeXml(artifactLine(artifact))),
          '</artifacts>',
        )
      }
      if (run.usage !== undefined) {
        const facts = [
          run.usage.totalTokens === undefined ? [] : [`total_tokens=${run.usage.totalTokens}`],
          run.usage.durationMs === undefined ? [] : [`duration_ms=${run.usage.durationMs}`],
        ].flat()
        if (facts.length > 0) blocks.push(`<usage>${facts.join(' ')}</usage>`)
      }
      if (run.scriptPath !== undefined) {
        blocks.push(`<script_path>${escapeXml(describeWorkflowScriptPath(run.scriptPath, cwdOf(exec)))}</script_path>`)
      }
      return { response: blocks.join('\n\n') }
    },
  })
}

/** 一件产物的一行（与终态通知共用同一投影，模型不会以为是两套东西）。 */
function artifactLine(artifact: { id: string; kind: string; version: number; title?: string; bytes?: number; itemCount?: number; contentType?: string; primary?: true }): string {
  const parts = artifact.primary === true ? [artifact.kind, 'primary'] : [artifact.kind]
  parts.push(`v${artifact.version}`)
  if (artifact.contentType !== undefined && artifact.contentType.length > 0) parts.push(artifact.contentType)
  if (artifact.bytes !== undefined) parts.push(`${artifact.bytes} bytes`)
  else if (artifact.itemCount !== undefined) parts.push(`${artifact.itemCount} item${artifact.itemCount === 1 ? '' : 's'}`)
  const head = `- ${artifact.id} (${parts.join(', ')})`
  const title = artifact.title?.trim()
  return title === undefined || title.length === 0 ? head : `${head}: ${title}`
}

// ============================================================
// ResumeWorkflowRun
// ============================================================

const RESUME_WORKFLOW_RUN_DESCRIPTION = `Resumes a dynamic-workflow run whose status is \`stopped\` — the user cancelled it, you stopped it with job_kill, a provider-side error stopped it (expired sign-in, model not in the plan, quota cap), or the process that owned it exited (\`interrupted\`). The run continues under the same run ID: finished steps are replayed from the journal without spending tokens, unfinished steps are dispatched again. The one stopped run that is NOT resumable is a \`superseded\` one: an AmendWorkflow replaced it, and its successor is the live run.

- Takes run_id — from CreateWorkflow's or AmendWorkflow's result, from a completion notification, or from GetWorkflowRun / ListWorkflowRuns.
- The resumed run is backgrounded: you will be notified with the final output when it completes. Do not wait for it or poll it with job_output; continue with other work unless the user asked you to wait.
- An \`errored\` run (the script itself failed) is NOT resumable — replaying it would fail the same way. Fix the script and submit it with AmendWorkflow instead. A completed run is not resumable either; a \`superseded\` run is refused with the successor's ID.
- Stop reason \`user\` means the user stopped it on purpose: resume it only when the user asks you to; never resume a run the user just cancelled on your own initiative. Reason \`model\` is your own job_kill. Reason \`provider\` means a provider-side error stopped it: resolve the cause with the user first (the stop notification names it), then resume. Reason \`interrupted\` (the process died) is different: continuing it is usually what the user wants.`

/**
 * ResumeWorkflowRun 的失败分支文案（errorCode 11-17；message 判别键在稳定前缀）。
 * @param reason - the reason argument.
 * @param runId - the runId argument.
 * @param detail - the detail argument.
 * @param serverMessage - the serverMessage argument.
 * @returns the computed result.
 */
export function resumeFailureFor(
  reason: string,
  runId: string,
  detail: string | undefined,
  serverMessage: string | undefined,
): Error {
  const suffix = detail === undefined ? '' : `\n${detail}`
  switch (reason) {
    case 'compile_failed':
      return new Error(`workflow_run_compile_failed: the stored script of run ${runId} no longer compiles against the current workflow facade, so it cannot be replayed as-is. Rewrite it for the current facade and submit it with AmendWorkflow, which keeps the finished work of this run.${suffix}`)
    case 'not_resumable':
      return new Error('workflow_run_not_resumable: this run is not in the resumable set — only a `stopped` run can be resumed (any stop reason except `superseded`). An `errored` run needs a corrected script submitted with AmendWorkflow; a completed run has nothing to resume. Check the status with GetWorkflowRun.')
    case 'superseded':
      return new Error(`workflow_run_superseded: run ${runId} was stopped by an AmendWorkflow and superseded; its unfinished work belongs to the successor run (see GetWorkflowRun's \`<superseded_by>\`). Read or amend the successor instead of resuming this run.`)
    case 'already_running':
      return new Error('workflow_run_already_running: this run is already in flight in this session\'s workflow runtime. Wait for its completion notification instead of resuming it again.')
    case 'script_missing':
      return new Error('workflow_run_script_missing: this run\'s journal record has no stored script text (it predates script persistence), so there is nothing to re-run. Start a fresh run with CreateWorkflow instead.')
    case 'script_mismatch':
      return new Error(`workflow_run_script_mismatch: the stored script hash for run ${runId} no longer matches the stored script text — the journal record was modified by an outside force. Start a fresh run with CreateWorkflow instead.`)
    case 'not_found':
      return new Error(`run_not_found: no workflow run with ID ${runId} exists for this project. Use ListWorkflowRuns to see the runs that do.`)
    default:
      return new Error(serverMessage ?? `workflow_run_not_resumable: the workflow runtime refused to resume run ${runId} (reason: ${reason}).`)
  }
}

/**
 * ResumeWorkflowRun 工具（执行语义，alwaysAsk；child 禁用）。
 * @param ctx - the ctx argument.
 * @returns the registry-ready tool definition.
 */
export function createResumeWorkflowRunTool(ctx: Context): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'ResumeWorkflowRun',
    description: RESUME_WORKFLOW_RUN_DESCRIPTION,
    parameters: {
      run_id: { type: 'string', required: true, description: 'The workflow run ID to resume.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          response: { type: 'string', required: true },
          status: { type: 'string', enum: ['backgrounded'] },
          backgroundTaskId: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.response }],
    },
    async execute(args, exec) {
      assertNotChild(exec)
      const port = portOf(ctx)
      if (port === undefined || typeof port.resumeRun !== 'function') {
        throw new Error('workflow_resume_unavailable: this session cannot resume workflow runs — workflow execution is not available here. This is a capability gap, not a bad run ID.')
      }
      const runId = String(args['run_id'])
      const result = await port.resumeRun(runId, exec.signal)
      if (!result.ok) {
        throw resumeFailureFor(result.reason, runId, result.detail, result.message)
      }
      const resumed = result.runId
      // resume 的 run 由端口侧续跑（同一 runId）；这里不注册新 job（引擎模块负责 resume 的
      // 通知投递），文案与 ZCode 同形。
      return {
        response: `The workflow run was resumed in the background with ID: ${resumed}. Finished steps replay from the journal; it is still running — you will be notified with the final output when it completes. Do not wait for it or poll it with job_output; continue with other work unless the user asked you to wait.`,
        status: 'backgrounded' as const,
        backgroundTaskId: resumed,
      }
    },
  })
}

// ============================================================
// ResolveWorkflowQuestion
// ============================================================

const RESOLVE_WORKFLOW_QUESTION_DESCRIPTION = `Answers a blocking question that a subagent escalated from inside a RUNNING dynamic-workflow run.

- Takes question_id — the ID from the escalation notification (it looks like \`dwfq-...\`). If that notification was lost, GetWorkflowRun lists the questions a run still owes an answer to.
- The run keeps running the whole time: only the subagent that asked is parked on its call, while every other subagent and the script's control flow keep going. Your answer becomes that call's result verbatim and the subagent continues from there.
- Answer directly and actionably. If you are not sure, look at the run first with GetWorkflowRun, or ask the user with ask_user_question, then come back and answer — nothing answers on your behalf, and the subagent waits indefinitely.
- If the question reveals the SCRIPT is structurally broken (a broken gate, wrong control flow), a sentence cannot fix that: cancel the run and continue with a revised script via AmendWorkflow.`

/**
 * ResolveWorkflowQuestion 工具（执行语义；进 actor 禁用名单——子代理不得替主代理作答）。
 * @param ctx - the ctx argument.
 * @returns the registry-ready tool definition.
 */
export function createResolveWorkflowQuestionTool(ctx: Context): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'ResolveWorkflowQuestion',
    description: RESOLVE_WORKFLOW_QUESTION_DESCRIPTION,
    parameters: {
      question_id: { type: 'string', required: true, description: 'The ID from the escalation notification (it looks like `dwfq-...`).' },
      answer: { type: 'string', required: true, description: 'The answer; becomes the parked call\'s result verbatim.' },
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
      if (isSubagentSession(exec)) {
        throw childDisallowedError('ResolveWorkflowQuestion')
      }
      const port = portOf(ctx)
      if (port === undefined || typeof port.resolveQuestion !== 'function') {
        throw new Error('workflow_question_answering_unavailable: this session cannot answer workflow escalations — workflow execution is not available here. This is a capability gap, not a bad question ID.')
      }
      const result = await port.resolveQuestion(String(args['question_id']), String(args['answer']))
      if (!result.ok) {
        // message 原样透传服务端；判别键在前缀（稳定错误码 21-24 的对等位）。
        throw new Error(result.message)
      }
      return {
        // 说清两件事：答案已经送达，以及 run 并没有因此停下。
        response: `Answer delivered for question ${result.qid}. The subagent that asked has resumed its turn with your answer; the run keeps going as before.`,
      }
    },
  })
}

// ============================================================
// ListModels
// ============================================================

/**
 * ListModels 工具（只读；服务于 `subagent_model` 选型）。
 * @param ctx - the ctx argument.
 * @returns the registry-ready tool definition.
 */
export function createListModelsTool(ctx: Context): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'ListModels',
    description: 'Lists the models this host has configured, so a dynamic workflow\'s subagents can be pointed at one.\n\n- Each row\'s `id` (`providerId/modelId`) pastes verbatim into CreateWorkflow\'s or AmendWorkflow\'s `subagent_model`.\n- This tool does NOT change the model you are running on. The session model is the user\'s choice and only the user changes it; `subagent_model` only moves the workflow\'s subagents.\n- The model the session is on right now is marked `[current]` — setting the subagents to that one is the same as omitting the field.\n- A row marked `disabled` cannot be used (no API key, disabled by policy). Resolve that with the user rather than picking around it silently.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { response: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.response }],
    },
    async execute() {
      const port = portOf(ctx)
      if (port === undefined || typeof port.listModels !== 'function') {
        throw workflowIntrospectionUnavailable()
      }
      const models = await port.listModels()
      const lines = models.map(model =>
        `- ${model.id}${model.disabled === true ? ' [disabled]' : ''}${model.label === undefined ? '' : ` — ${model.label}`}${model.reasoningLevels === undefined ? '' : ` (reasoning levels: ${model.reasoningLevels.join(', ')})`}`,
      )
      return {
        response: lines.length > 0
          ? lines.join('\n')
          : 'No models are configured for dynamic-workflow subagents on this host.',
      }
    },
  })
}
