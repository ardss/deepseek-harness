/**
 * 脚本文件在模型面的三句话（逐字移植自 ZCode workflow-script-notes.ts）：
 * 诊断行、编不过 NOTE、启动成功句。CreateWorkflow 与 AmendWorkflow 共用——
 * 「改完再 `path` 交回来」在两个工具上是同一句话。
 * @module
 */

import type { WorkflowCompileDiagnostic } from './port.ts'

/** 脚本文件在模型面的身份；没有文件（草稿写不下去）时缺席。 */
export interface WorkflowScriptLocation {
  /** `draft` 是工具刚写下的拷贝（「saved at」）；`path` 是模型自己给的那个文件。 */
  kind: 'draft' | 'path'
  /** 模型面的写法（工作区相对或绝对）。 */
  described: string
  /** 正文行 → 文件行的偏移；无元数据块即 0。 */
  lineOffset: number
}

/**
 * 诊断的模型面行：有文件按文件行报（可粘进一次 Edit），否则退回 `L:C` 正文行。
 * @param diagnostics - the diagnostics argument.
 * @param location - the location argument.
 * @returns the computed result.
 */
export function formatWorkflowDiagnosticLines(
  diagnostics: readonly WorkflowCompileDiagnostic[],
  location: WorkflowScriptLocation | undefined,
): string[] {
  if (location === undefined) {
    return diagnostics.map(diagnostic => `L${diagnostic.line}:C${diagnostic.column} ${diagnostic.message}`)
  }
  return diagnostics.map(diagnostic =>
    `${location.described}:L${diagnostic.line + location.lineOffset}:C${diagnostic.column} ${diagnostic.message}`,
  )
}

/**
 * 编不过、且脚本有文件时的 NOTE。最后半句是整个特性的目的：别再把脚本贴一遍。
 * @param location - the location argument.
 * @returns the computed result.
 */
export function workflowScriptFileNote(location: WorkflowScriptLocation): string {
  const where =
    location.kind === 'draft'
      ? `The script is saved at ${location.described}.`
      : `The script file is ${location.described}.`
  return `NOTE: The workflow was NOT executed. ${where} Edit that file in place and resubmit with \`path: "${location.described}"\` — do not paste the script inline again.`
}

/**
 * 编不过、来源是 saved 定义时的 NOTE（点名它抄自哪个定义；改定义本身走 SaveWorkflow）。
 * @param options - the options argument.
 * @returns the computed result.
 */
export function workflowSavedDraftNote(options: {
  savedName: string
  savedPath: string
  draft: string
}): string {
  return `NOTE: The workflow was NOT executed. A working copy of the saved workflow '${options.savedName}' (${options.savedPath}) was written to ${options.draft}. Edit that copy in place and resubmit with \`path: "${options.draft}"\` (pass its \`args\` again); to change the saved definition itself, use SaveWorkflow.`
}

/**
 * 启动成功后追加的一句：下一次修订从编辑这个文件开始。
 * @param location - the location argument.
 * @returns the computed result.
 */
export function workflowLaunchedScriptSentence(location: WorkflowScriptLocation): string {
  const where =
    location.kind === 'draft'
      ? `The script is saved at ${location.described}`
      : `The script file is ${location.described}`
  return ` ${where}; to revise it later, edit that file and pass \`path\` to AmendWorkflow.`
}

/**
 * 修订启动成功后追加的一句（再修订一次仍是同一个动作）。
 * @param location - the location argument.
 * @returns the computed result.
 */
export function workflowAmendedScriptSentence(location: WorkflowScriptLocation): string {
  return ` The revision's script is at ${location.described}; edit it there for a further revision.`
}
