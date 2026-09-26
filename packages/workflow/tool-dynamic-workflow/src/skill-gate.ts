/**
 * 技能门（移植自 ZCode workflow-skill-gate.ts）：四个写作工具在会话没有成功加载
 * `dynamic-workflows` 技能前拒绝脚本类调用。判据 = 会话 messageHistory 里有无**成功的**
 * `skill`（dsh 的小写工具名）调用；压缩移除技能正文后须重新加载；resume/rewind 随历史恢复。
 *
 * @module
 */

import type { Session } from '@deepseek-ai/dsh-session'
import { DYNAMIC_WORKFLOW_SKILL_NAME } from './glossary.ts'

/** 「技能未加载」的稳定错误码（与入参级 400 分开：调用方要能不靠文本区分两种失败）。 */
export const WORKFLOW_SKILL_NOT_LOADED_CODE = 428

/**
 * 判据：扫描会话事件流，找 `tool/call`（name === 'skill' 且实参点名本技能）配对一条
 * 未失败的 `tool/result`。历史快照读取是本判据的定义本身（ZCode 同款：判据就是模型当前
 * 可见的 messageHistory），这里必须同步读整段历史；Session 的同步读面已标废弃，但
 * 技能门没有可替代的增量面，故按工具面只读语义使用（tool-history.ts 同类先例）。
 * @param session - the session argument.
 * @returns the computed result.
 */
export function isDynamicWorkflowSkillLoaded(session: Session | undefined): boolean {
  // 探针缺席（无会话可查）时不设门：fail-open 仅限「装配未提供检查」，与 ZCode 同款。
  if (session === undefined) return true
  const answered = new Map<string, boolean>()
  for (const event of session.snapshotEvents()) {
    if (event.type === 'tool/call') {
      if (event.data.name !== 'skill') continue
      let requested = false
      try {
        const parsed: unknown = JSON.parse(event.data.arguments)
        requested =
          typeof parsed === 'object' && parsed !== null &&
          (parsed as Record<string, unknown>)['name'] === DYNAMIC_WORKFLOW_SKILL_NAME
      } catch {
        requested = false
      }
      if (requested) answered.set(event.data.callId, false)
    } else if (event.type === 'tool/result' && answered.has(event.data.message.toolCallId)) {
      answered.set(event.data.message.toolCallId, event.data.message.isError !== true)
    }
  }
  return [...answered.values()].some(success => success)
}

/**
 * 没读过技能就拒绝。返回 undefined 表示放行：技能已加载，或本会话没有会话探针。
 * 文案逐字（工具名是拒绝文案里点名的重试目标）。
 * @param session - the session argument.
 * @param toolName - the toolName argument.
 * @returns the computed result.
 */
export function requireDynamicWorkflowSkill(
  session: Session | undefined,
  toolName: string,
): Error | undefined {
  if (isDynamicWorkflowSkillLoaded(session)) return undefined
  return new Error(
    `${toolName} needs the \`${DYNAMIC_WORKFLOW_SKILL_NAME}\` skill loaded in this session before it accepts a script. Call the skill tool with skill "${DYNAMIC_WORKFLOW_SKILL_NAME}" first — it carries the facade declarations the script is checked against, the authoring rules and this tool's full contract — then call ${toolName} again. Nothing was started. (error code ${WORKFLOW_SKILL_NOT_LOADED_CODE})`,
  )
}

/**
 * CreateWorkflow 的例外：按名字跑一个保存的工作流不是写脚本，不需要技能。
 * @param args - the args argument.
 * @returns the computed result.
 */
export function createWorkflowNeedsSkill(args: Record<string, unknown>): boolean {
  const runsSavedOnly =
    args['saved'] !== undefined && args['script'] === undefined && args['path'] === undefined
  return !runsSavedOnly
}

/**
 * AmendWorkflow 的例外：只改设定（不带 path/script）沿用前驱的脚本，不是写脚本。
 * @param args - the args argument.
 * @returns the computed result.
 */
export function amendWorkflowNeedsSkill(args: Record<string, unknown>): boolean {
  return args['script'] !== undefined || args['path'] !== undefined
}
