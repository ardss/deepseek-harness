/**
 * 写作工具簇：CreateWorkflow / AmendWorkflow / SaveWorkflow / ListSavedWorkflows /
 * EvalWorkflowSnippet（spec-conversation-flow §3、§9 的逐字落地；门次序：技能门先于一切解析）。
 * @module
 */

import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve, join } from 'node:path'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SKILL_TOOL_REF } from '../glossary.ts'
import { requireDynamicWorkflowSkill, createWorkflowNeedsSkill, amendWorkflowNeedsSkill } from '../skill-gate.ts'
import { childDisallowedError, CHILD_DISALLOWED_TOOLS } from '../child-disallowed.ts'
import { cwdOf, isSubagentSession, portOf, sessionOf } from '../context.ts'
import { portPayloadAsJson } from '../port.ts'
import { describeWorkflowScriptPath, writeWorkflowDraft } from '../drafts.ts'
import {
  formatWorkflowDiagnosticLines,
  workflowLaunchedScriptSentence,
  workflowSavedDraftNote,
  workflowScriptFileNote,
  type WorkflowScriptLocation,
} from '../script-notes.ts'
import { readSavedWorkflow, saveWorkflowDefinition, listSavedWorkflows, savedWorkflowFileName } from '../saved-store.ts'
import { submitRunInBackground } from '../submit.ts'

/** 「没执行」的 NOTE（ZCode 同文）：编不过与端口缺席各一句，绝不假装启动。 */
export const DIAGNOSTICS_NOT_EXECUTED_NOTE =
  'NOTE: The workflow was NOT executed — fix the errors above and resubmit.'
/** The saved_file_not_executed_note value. */
export const SAVED_FILE_NOT_EXECUTED_NOTE =
  'NOTE: The workflow was NOT executed — the saved file needs fixing (edit it, or save a corrected version).'
/** The execution_unavailable_note value. */
export const EXECUTION_UNAVAILABLE_NOTE =
  'NOTE: The workflow was NOT executed — workflow execution is not available in this session, so the script was only typechecked.'
/** 一期如实降级：静态分析（lowering）未实施，连 typecheck 都没有。 */
export const COMPILER_UNAVAILABLE_NOTE =
  'NOTE: The workflow was NOT executed — no workflow compiler is available in this session, so the script could not be typechecked either.'

/**
 * 生效的并发上界在结果文案里的一句话（只在设了上界时出现；等于天花板时点明是本机上限）。
 * @param limit - the limit argument.
 * @param ceiling - the ceiling argument.
 * @returns the computed result.
 */
export function describeWorkflowConcurrencyLimit(
  limit: number | undefined,
  ceiling: number | undefined,
): string {
  if (limit === undefined) return ''
  const subject = limit === 1 ? '1 subagent runs' : `${limit} subagents run`
  return ` At most ${subject} at once${limit === ceiling ? " (this machine's maximum)" : ''}.`
}

/** 子代理禁用名单的统一检查（写作簇里执行语义的工具）。 */
function assertNotChild(exec: ToolRunContext): void {
  if (isSubagentSession(exec) && CHILD_DISALLOWED_TOOLS.has(exec.name)) {
    throw childDisallowedError(exec.name)
  }
}

// ============================================================
// CreateWorkflow
// ============================================================

const CREATE_WORKFLOW_DESCRIPTION = `Create and run a dynamic workflow: a TypeScript script that orchestrates multiple model-driven
subagents with plain control flow (loops, conditionals, fan-out) and typed intermediate results.
The script is typechecked, the user is asked to confirm it, and the run starts in the background;
you are notified with its final result when it settles. Compilation errors come back as diagnostics.

When to use:
- The user explicitly asks for a workflow — "use a workflow", "with a workflow", "使用 workflow",
  "用工作流", or any phrasing that names workflow/工作流 as the means: this tool is mandatory.
  Do not substitute the subagent delegation tools, do not do the work inline yourself, and do not
  judge the task too small for a workflow — the user chose the tool, and that choice is theirs.
  Size only decides how many subagents the script gets, never whether it is written.
- Without such an explicit request, do not start a workflow: delegate with the subagent tools or do
  the work yourself, even for multi-step or multi-subagent tasks.

Before writing or revising a script, load the \`dynamic-workflows\` skill with the ${SKILL_TOOL_REF} tool: it
carries the facade declarations the script is checked against, the authoring rules, and this
tool's full contract. A call that submits a script is refused until that skill has been loaded
in this session; running a saved workflow by name is exempt.

Pass exactly one source: \`script\` (a one-off script written inline; it is saved to a draft file
the result names — revise that file and resubmit with \`path\`, never paste the script again),
\`saved\` (a workflow saved in this project or globally, by name; check ListSavedWorkflows before
writing one from scratch), or \`path\` (a script file on disk, normally the file a previous result
named). To change a run that already exists — errored, completed, stopped or still running —
call AmendWorkflow instead of starting over.`

/**
 * CreateWorkflow 工具（门次序固定：技能门 → 子代理判据 → 来源解析 → 草稿落盘 → 编译 → 提交）。
 * @param ctx - the ctx argument.
 * @returns the registry-ready tool definition.
 */
export function createCreateWorkflowTool(ctx: Context): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'CreateWorkflow',
    description: CREATE_WORKFLOW_DESCRIPTION,
    parameters: {
      script: { type: 'string', description: 'A one-off script written inline; it is saved to a draft file the result names.' },
      saved: {
        type: 'object',
        additionalProperties: true,
        description: 'Run a workflow saved in this project or globally. Fields: name (required), args (optional JSON input).',
        properties: {
          name: { type: 'string', required: true, description: 'The saved workflow name.' },
          args: { type: 'json', description: 'Optional JSON input persisted with the saved definition.' },
        },
      },
      path: { type: 'string', description: 'A script file on disk (normally the draft a previous result named); submitted without re-pasting the script.' },
      name: { type: 'string', description: 'Optional display name; falls back to the first phase name.' },
      args: { type: 'json', description: 'JSON input exposed to the script as `args` (top-level `path` source only).' },
      max_concurrency: { type: 'integer', description: 'Optional cap on concurrently running subagents.' },
      subagent_model: { type: 'string', description: 'Optional subagent model selection; check ListModels for valid values.' },
      script_line_offset: { type: 'integer', description: 'Line offset between inline script text and the draft file (metadata block present).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          response: { type: 'string', required: true },
          status: { type: 'string', enum: ['backgrounded'] },
          backgroundTaskId: { type: 'string' },
          diagnostics: { type: 'json' },
          ok: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.response }],
    },
    async execute(args, exec) {
      assertNotChild(exec)
      const session = sessionOf(exec)
      // 门先于一切解析：未加载技能时 saved 之外的来源直接拒绝（Nothing was started）。
      if (createWorkflowNeedsSkill(args)) {
        const refusal = requireDynamicWorkflowSkill(session, 'CreateWorkflow')
        if (refusal !== undefined) throw refusal
      }
      const cwd = cwdOf(exec)
      const record = args as Record<string, unknown>
      const sources = (['script', 'path', 'saved'] as const).filter(key => record[key] !== undefined)
      if (sources.length !== 1) {
        throw new Error('CreateWorkflow takes exactly one source: `script`, `saved`, or `path`.')
      }
      const name = typeof args['name'] === 'string' ? args['name'] : undefined
      const maxConcurrency = typeof args['max_concurrency'] === 'number' ? args['max_concurrency'] : undefined
      const subagentModel = typeof args['subagent_model'] === 'string' ? args['subagent_model'] : undefined
      const lineOffset = typeof args['script_line_offset'] === 'number' ? args['script_line_offset'] : 0
      const savedArgs = (args['saved'] as Record<string, unknown> | undefined)?.['args'] as JsonValue | undefined
      const scriptArgs = (args['args'] as JsonValue | undefined) ?? savedArgs

      // 来源归一：saved/path 落盘读字节。全流程唯一一次读盘在此；确认窗（若有）看到的就是
      // 将要生效的字节。
      let scriptText: string
      let sourcePath: string | undefined
      let savedName: string | undefined
      let savedPath: string | undefined
      if (typeof args['script'] === 'string') {
        scriptText = args['script']
      } else if (typeof args['path'] === 'string') {
        sourcePath = isAbsolute(args['path']) ? args['path'] : resolve(cwd, args['path'])
        scriptText = await readFile(sourcePath, 'utf8')
      } else {
        const saved = (args['saved'] as Record<string, unknown> | undefined) ?? {}
        savedName = typeof saved['name'] === 'string' ? saved['name'] : undefined
        if (savedName === undefined) throw new Error('saved.name is required')
        const definition = await readSavedWorkflow(savedName, cwd)
        if (definition === undefined) {
          throw new Error(`no saved workflow named "${savedName}" in this project or globally (check ListSavedWorkflows).`)
        }
        scriptText = definition.script
        savedPath = sourcePathOfSaved(definition.scope, cwd, savedName)
      }

      // 内联脚本无论编译成败都落盘草稿；saved 来源的拷贝由引擎模块写（一期由提交路径处理）。
      const inlineDraft =
        typeof args['script'] === 'string'
          ? await writeWorkflowDraft({ cwd, name: name ?? savedName ?? 'workflow', source: scriptText })
          : undefined
      const submittedPath = sourcePath ?? inlineDraft?.path
      const location: WorkflowScriptLocation | undefined = submittedPath === undefined
        ? undefined
        : {
          kind: sourcePath !== undefined ? 'path' : 'draft',
          described: describeWorkflowScriptPath(submittedPath, cwd),
          lineOffset,
        }

      const port = portOf(ctx)
      // 端口缺席：保持占位语义，刻意不降级成「假装启动了」。
      if (port === undefined) {
        return {
          response: `The workflow script was accepted for submission.\n\n${EXECUTION_UNAVAILABLE_NOTE}`,
          ok: true,
        }
      }
      if (exec.agent === undefined) {
        throw new Error('CreateWorkflow requires a calling agent (exec.agent was undefined)')
      }

      // 编译门：编译失败不进确认窗（工具体直接回诊断，不启动、不建 run）。
      let diagnostics: Awaited<ReturnType<NonNullable<typeof port.compile>>>['diagnostics'] = []
      if (port.compile !== undefined) {
        const analysis = await port.compile(scriptText)
        diagnostics = analysis.diagnostics
        if (!analysis.ok) {
          const note = location === undefined
            ? (savedName === undefined ? DIAGNOSTICS_NOT_EXECUTED_NOTE : SAVED_FILE_NOT_EXECUTED_NOTE)
            : savedName !== undefined && savedPath !== undefined
              ? workflowSavedDraftNote({ savedName, savedPath: describeWorkflowScriptPath(savedPath, cwd), draft: location.described })
              : workflowScriptFileNote(location)
          return {
            response: [
              savedName === undefined
                ? 'The workflow script has errors:'
                : `The saved workflow '${savedName}'${savedPath === undefined ? '' : ` (${describeWorkflowScriptPath(savedPath, cwd)})`} has errors:`,
              ...formatWorkflowDiagnosticLines(diagnostics, location),
              '',
              note,
            ].join('\n'),
            ok: false,
            diagnostics: portPayloadAsJson(diagnostics),
          }
        }
      } else {
        // 一期如实降级：没有 lowering 就没有诊断——文案不谎称「compiled cleanly」。
        return {
          response: [
            'No workflow compiler is available in this session, so the script was not typechecked.',
            '',
            COMPILER_UNAVAILABLE_NOTE,
            ...(location === undefined ? [] : ['', workflowScriptFileNote(location)]),
          ].join('\n'),
          ok: true,
          ...(diagnostics.length > 0 ? { diagnostics: portPayloadAsJson(diagnostics) } : {}),
        }
      }

      const { jobId, runId: runIdPromise } = submitRunInBackground(ctx, {
        label: name ?? savedName ?? 'workflow',
        agent: exec.agent!,
        start: signal => port.submit({
          scriptText,
          cwd,
          ...(name === undefined ? {} : { name }),
          ...(scriptArgs === undefined ? {} : { args: scriptArgs }),
          parentSessionId: session === undefined ? 'unknown' : String(session.id),
          toolCallId: exec.callId,
          ...(maxConcurrency === undefined ? {} : { maxConcurrency }),
          ...(subagentModel === undefined ? {} : { subagentModel }),
          ...(submittedPath === undefined ? {} : { scriptPath: submittedPath }),
        }, signal),
      })
      const runId = await runIdPromise
      return {
        response:
          `The workflow script compiled cleanly and the run started in the background: run ID ${runId} (background job ${jobId}). It is still running — you will be notified with the final output when it completes. Do not wait for it or poll it with job_output; continue with other work unless the user asked you to wait.${describeWorkflowConcurrencyLimit(maxConcurrency, port.concurrencyCeiling?.())}${describeWorkflowSubagentModel(subagentModel)}${location === undefined ? '' : workflowLaunchedScriptSentence(location)}`,
        status: 'backgrounded' as const,
        // backgroundTaskId 必须是 jobs 注册表的 JobId（job_output / job_kill 的入参）；
        // run ID 属于内省工具面（GetWorkflowRun / ListWorkflowRuns / AmendWorkflow）。
        backgroundTaskId: jobId,
        ok: true,
      }
    },
  })
}

/** 模型句：只在显式选了模型时出现。 */
function describeWorkflowSubagentModel(subagentModel: string | undefined): string {
  return subagentModel === undefined ? '' : ` Subagents run on ${subagentModel}.`
}

function sourcePathOfSaved(scope: 'project' | 'global', cwd: string, name: string): string | undefined {
  // saved 定义的磁盘位置（诊断文案点名它抄自哪个定义）。
  const dir = scope === 'project'
    ? join(cwd, '.dsh', 'workflows')
    : join(homedir(), '.dsh', 'workflows')
  return join(dir, `${savedWorkflowFileName(name)}.json`)
}

// ============================================================
// AmendWorkflow
// ============================================================

const AMEND_WORKFLOW_DESCRIPTION = `Amend an existing dynamic-workflow run with a revised script or revised settings. Starts a NEW run that supersedes the old one and imports its finished work as a cache, so only what you changed is paid for again. Works on ANY run of this project: completed, errored, stopped — or still running.

When to use:
- The run errored, or completed but needs one more stage: fix or extend the script and amend. Never rewrite the workflow from scratch with CreateWorkflow.
- The run is STILL RUNNING and is visibly going wrong: amend it NOW, in one call. Do not job_kill it first and do not wait for it to finish — this tool stops the running predecessor and starts the revision; the earlier you amend, the less is re-paid.
- The user wants the same workflow with fewer subagents at once, its subagents on another model, or another name: amend with only that field and neither \`path\` nor \`script\`.
- To continue a stopped run unchanged, use ResumeWorkflowRun instead.

Load the \`dynamic-workflows\` skill with the ${SKILL_TOOL_REF} tool before revising a script: it carries the cache rules, what each omitted field keeps, and the confirmation rule. A call that passes \`path\` or \`script\` is refused until that skill has been loaded in this session; a settings-only call is not. Pass \`path\` (the run's script file, edited in place — the usual form) or \`script\` (the whole revised script inline), never both.`

/**
 * AmendWorkflow 工具（带 path/script 时同 CreateWorkflow 门；settings-only 免门）。
 * @param ctx - the ctx argument.
 * @returns the registry-ready tool definition.
 */
export function createAmendWorkflowTool(ctx: Context): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'AmendWorkflow',
    description: AMEND_WORKFLOW_DESCRIPTION,
    parameters: {
      run_id: { type: 'string', required: true, description: 'The run to amend — from CreateWorkflow/AmendWorkflow results, a notification, GetWorkflowRun or ListWorkflowRuns.' },
      script: { type: 'string', description: 'The whole revised script inline.' },
      path: { type: 'string', description: 'The run\'s script file, edited in place (the usual form).' },
      max_concurrency: { type: 'integer', description: 'Revised concurrent-subagent cap.' },
      subagent_model: { type: 'string', description: 'Revised subagent model selection.' },
      name: { type: 'string', description: 'Revised display name.' },
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
      if (amendWorkflowNeedsSkill(args)) {
        const refusal = requireDynamicWorkflowSkill(sessionOf(exec), 'AmendWorkflow')
        if (refusal !== undefined) throw refusal
      }
      const port = portOf(ctx)
      if (port === undefined) {
        throw new Error('AmendWorkflow is unavailable: workflow execution is not available in this session. This is a capability gap, not a bad run ID.')
      }
      const cwd = cwdOf(exec)
      const path = typeof args['path'] === 'string' ? (isAbsolute(args['path']) ? args['path'] : resolve(cwd, args['path'])) : undefined
      const script = typeof args['script'] === 'string' ? args['script'] : undefined
      if (script !== undefined && path !== undefined) {
        throw new Error('AmendWorkflow takes `path` or `script`, never both.')
      }
      let scriptText = script
      if (path !== undefined) scriptText = await readFile(path, 'utf8')
      const settingsOnly = scriptText === undefined
      const amendFields = [args['name'], args['max_concurrency'], args['subagent_model']].filter(
        field => field !== undefined,
      )
      if (settingsOnly && amendFields.length === 0) {
        throw new Error(
          `AmendWorkflow needs something to amend: pass \`path\` or \`script\` to revise the run's script, or at least one of \`name\` / \`max_concurrency\` / \`subagent_model\`. To continue the run unchanged, use ResumeWorkflowRun instead. Run ${String(args['run_id'])} was NOT changed.`,
        )
      }
      // 编译门（与 CreateWorkflow 同一门）：带 path/script 的修订先编译，失败不提交、
      // 不建 run；settings-only 修订不动脚本字节，免编译。
      let diagnostics: Awaited<ReturnType<NonNullable<typeof port.compile>>>['diagnostics'] = []
      if (!settingsOnly) {
        const location: WorkflowScriptLocation | undefined = path === undefined
          ? undefined
          : { kind: 'path', described: describeWorkflowScriptPath(path, cwd), lineOffset: 0 }
        if (port.compile === undefined) {
          // 一期如实降级：修订脚本没有编译能力就不启动（与 CreateWorkflow 同语义）。
          return {
            response: [
              'No workflow compiler is available in this session, so the revised script was not typechecked.',
              '',
              COMPILER_UNAVAILABLE_NOTE,
              ...(location === undefined ? [] : ['', workflowScriptFileNote(location)]),
            ].join('\n'),
            ok: true,
          }
        }
        const analysis = await port.compile(scriptText!)
        diagnostics = analysis.diagnostics
        if (!analysis.ok) {
          return {
            response: [
              'The revised workflow script has errors:',
              ...formatWorkflowDiagnosticLines(diagnostics, location),
              '',
              location === undefined
                ? DIAGNOSTICS_NOT_EXECUTED_NOTE
                : workflowScriptFileNote(location),
            ].join('\n'),
            ok: false,
            diagnostics: portPayloadAsJson(diagnostics),
          }
        }
      }
      const amendRequest = {
        // settings-only 用显式标记向引擎声明「沿用前驱脚本」，而不是拿空串当哨兵。
        // settingsOnly 收窄不了 TS 对 let 的联合（中间隔着 await 赋值），这里显式断言非空。
        scriptText: settingsOnly ? '' : scriptText!,
        ...(settingsOnly ? { settingsOnly: true } : {}),
        cwd,
        ...(typeof args['name'] === 'string' ? { name: args['name'] as string } : {}),
        ...(args['max_concurrency'] !== undefined ? { maxConcurrency: args['max_concurrency'] as number } : {}),
        ...(typeof args['subagent_model'] === 'string' ? { subagentModel: args['subagent_model'] as string } : {}),
        amendOf: args['run_id'] as string,
        parentSessionId: sessionOf(exec) === undefined ? 'unknown' : String(sessionOf(exec)!.id),
        toolCallId: exec.callId,
        ...(path === undefined ? {} : { scriptPath: path }),
      }
      const { jobId, runId: runIdPromise } = submitRunInBackground(ctx, {
        label: `amend of ${String(args['run_id'])}`,
        agent: exec.agent!,
        start: signal => port.amend(amendRequest, signal),
      })
      const runId = await runIdPromise
      const scriptSentence =
        path === undefined
          ? ''
          : ` The revision's script is at ${describeWorkflowScriptPath(path, cwd)}; edit it there for a further revision.`
      return {
        response: `The amended run started in the background: run ID ${runId} (background job ${jobId}); the predecessor ${String(args['run_id'])} is superseded and its finished work was imported as cache. It is still running — you will be notified with the final output when it completes. Do not wait for it or poll it with job_output.${scriptSentence}`,
        status: 'backgrounded' as const,
        // backgroundTaskId 必须是 jobs 注册表的 JobId（job_output / job_kill 的入参）。
        backgroundTaskId: jobId,
      }
    },
  })
}

// ============================================================
// SaveWorkflow
// ============================================================

const SAVE_WORKFLOW_DESCRIPTION = `Save a dynamic-workflow script with its metadata so it can be run again later by name (CreateWorkflow's \`saved\` source; ListSavedWorkflows lists them). The required \`scope\` decides whether it lives in this project or globally.

NEVER call this tool unsolicited: saving writes a file into the user's repository, and that is their decision. When a workflow you just built looks reusable, suggest saving it in one sentence and wait; call SaveWorkflow only after the user agrees, or when the user asks directly.

Load the \`dynamic-workflows\` skill with the ${SKILL_TOOL_REF} tool first: it carries what belongs in a saved definition. Pass \`script\` (the body only) or \`script_path\` (a draft file, saved without re-emitting it), never both.`

/**
 * SaveWorkflow 工具（写侧 alwaysAsk 在确认门；「绝不主动保存」禁令常驻描述）。
 * @returns the registry-ready tool definition.
 */
export function createSaveWorkflowTool(): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'SaveWorkflow',
    description: SAVE_WORKFLOW_DESCRIPTION,
    parameters: {
      name: { type: 'string', required: true, description: 'The saved workflow name (kebab-case).' },
      scope: { type: 'string', required: true, enum: ['project', 'global'], description: 'project stores under <cwd>/.dsh/workflows; global under ~/.dsh/workflows.' },
      script: { type: 'string', description: 'The script body.' },
      script_path: { type: 'string', description: 'A draft file to save without re-emitting its text.' },
      description: { type: 'string', description: 'One-line description shown by ListSavedWorkflows.' },
      args: { type: 'json', description: 'Default arguments persisted with the definition.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { response: { type: 'string', required: true }, path: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.response }],
    },
    async execute(args, exec) {
      const refusal = requireDynamicWorkflowSkill(sessionOf(exec), 'SaveWorkflow')
      if (refusal !== undefined) throw refusal
      const cwd = cwdOf(exec)
      const script = typeof args['script'] === 'string'
        ? args['script']
        : typeof args['script_path'] === 'string'
          ? await readFile(isAbsolute(args['script_path'] as string) ? args['script_path'] as string : resolve(cwd, args['script_path'] as string), 'utf8')
          : undefined
      if (script === undefined) {
        throw new Error('SaveWorkflow takes `script` or `script_path`, never neither.')
      }
      if (args['script'] !== undefined && args['script_path'] !== undefined) {
        throw new Error('SaveWorkflow takes `script` or `script_path`, never both.')
      }
      const name = savedWorkflowFileName(String(args['name']))
      const path = await saveWorkflowDefinition({
        name,
        scope: args['scope'] as 'project' | 'global',
        script,
        ...(typeof args['description'] === 'string' ? { description: args['description'] as string } : {}),
        ...(args['args'] !== undefined ? { args: args['args'] as JsonValue } : {}),
      }, cwd)
      return {
        response: `Saved workflow "${name}" (${String(args['scope'])}) at ${describeWorkflowScriptPath(path, cwd)}. Run it later with CreateWorkflow's \`saved\` source.`,
        path,
      }
    },
  })
}

// ============================================================
// ListSavedWorkflows
// ============================================================

const LIST_SAVED_WORKFLOWS_DESCRIPTION = 'Lists the dynamic-workflow DEFINITIONS saved in this project (`<cwd>`/.dsh/workflows/, keyed on the working directory) and the global archive (~/.dsh/workflows). These are workflow DEFINITIONS you can run, not past runs — for the run history use ListWorkflowRuns instead. `invalid` lists saved files that could not be read (usually a hand-edited metadata block). They are named so they can be fixed, not silently skipped.'

/**
 * ListSavedWorkflows 工具（只读无门）。
 * @returns the registry-ready tool definition.
 */
export function createListSavedWorkflowsTool(): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'ListSavedWorkflows',
    description: LIST_SAVED_WORKFLOWS_DESCRIPTION,
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          response: { type: 'string', required: true },
          workflows: { type: 'json' },
          invalid: { type: 'json' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.response }],
    },
    async execute(_args, exec) {
      const { workflows, invalid } = await listSavedWorkflows(cwdOf(exec))
      const lines = workflows.map(workflow =>
        `- ${workflow.name} (${workflow.scope})${workflow.description === undefined ? '' : `: ${workflow.description}`}`,
      )
      const invalidLines = invalid.map(entry => `- ${entry.path} (${entry.scope}): ${entry.reason}`)
      return {
        workflows: portPayloadAsJson(workflows),
        invalid: portPayloadAsJson(invalid),
        response: [
          lines.length > 0 ? lines.join('\n') : 'No saved workflows in this project or the global archive.',
          ...(invalidLines.length > 0 ? ['', 'Invalid saved files:', ...invalidLines] : []),
        ].join('\n'),
      }
    },
  })
}

// ============================================================
// EvalWorkflowSnippet
// ============================================================

const EVAL_WORKFLOW_SNIPPET_DESCRIPTION = `Compile and run a small dynamic-workflow TypeScript snippet synchronously, against the same compiler, sandbox and world-read execution path a real run uses. It is the test bench for workflow authoring: check a parser against real command output, see what a glob actually returns, or exercise a gate predicate on real repository state before putting it in a CreateWorkflow script. No agent()/report(); nothing persists; the result comes back in this call.

Load the \`dynamic-workflows\` skill with the ${SKILL_TOOL_REF} tool first: it carries the snippet facade and the rules. The call is refused until that skill has been loaded in this session. Pass \`code\` (inline) or \`path\` (a file holding the snippet), never both.`

/**
 * EvalWorkflowSnippet 工具（技能门；端口缺 evalSnippet 即能力缺席，绝不静默成功）。
 * @param ctx - the ctx argument.
 * @returns the registry-ready tool definition.
 */
export function createEvalWorkflowSnippetTool(ctx: Context): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'EvalWorkflowSnippet',
    description: EVAL_WORKFLOW_SNIPPET_DESCRIPTION,
    parameters: {
      code: { type: 'string', description: 'The snippet, inline.' },
      path: { type: 'string', description: 'A file holding the snippet.' },
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
      assertNotChild(exec)
      const refusal = requireDynamicWorkflowSkill(sessionOf(exec), 'EvalWorkflowSnippet')
      if (refusal !== undefined) throw refusal
      const port = portOf(ctx)
      if (port === undefined || typeof port.evalSnippet !== 'function') {
        throw new Error('workflow_snippet_unavailable: this session cannot run workflow snippets — workflow execution is not available here. This is a capability gap, not a bad snippet.')
      }
      const cwd = cwdOf(exec)
      const code = typeof args['code'] === 'string'
        ? args['code']
        : typeof args['path'] === 'string'
          ? await readFile(isAbsolute(args['path']) ? args['path'] : resolve(cwd, args['path']), 'utf8')
          : undefined
      if (code === undefined) throw new Error('EvalWorkflowSnippet takes `code` or `path`.')
      if (args['code'] !== undefined && args['path'] !== undefined) {
        throw new Error('EvalWorkflowSnippet takes `code` or `path`, never both.')
      }
      const result = await port.evalSnippet(code)
      return {
        response: result.ok
          ? `Snippet settled.\n\n${result.value ?? '(no value)'}`
          : `Snippet failed: ${result.error ?? 'unknown error'}. Nothing was persisted.`,
      }
    },
  })
}

/**
 * 供注册表使用的统一清单（child 判据按工具名走同一条 assertNotChild）。
 * @param ctx - the ctx argument.
 * @returns the registered-in-order tool definitions.
 */
export function writingToolFactories(ctx: Context): ReturnType<typeof defineTool>[] {
  return [
    createCreateWorkflowTool(ctx),
    createAmendWorkflowTool(ctx),
    createSaveWorkflowTool(),
    createListSavedWorkflowsTool(),
    createEvalWorkflowSnippetTool(ctx),
  ]
}
