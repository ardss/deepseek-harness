/**
 * 确认门（ZCode 的 `alwaysAsk` 权限语义在 dsh 的对等）：CreateWorkflow / AmendWorkflow
 * （带脚本）/ SaveWorkflow / ResumeWorkflowRun 在任何权限模式下必问；经 dsh 既有的
 * `tools/pre-execute` waterfall 返回 `{ kind: 'ask' }`，由审批服务落实「允许一次」。
 *
 * 与 ZCode 的差异（如实声明）：ZCode 在 prepareApproval 里对「编不过的脚本」裁掉弹窗
 * （静态分析已在门之前完成）；dsh 一期没有静态分析（workflow-lowering 模块未实施），
 * 门先问、工具体后验——编译失败的弹窗抑制留给 lowering 模块接入门后补。
 * 端口缺席时不问：工具体会走「本会话没有执行能力」的占位文案，问了只会打断 agent 自己。
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution, PreToolDecision } from '@deepseek-ai/dsh-tools'

/** 写侧 / 执行语义工具的 alwaysAsk 名单。 */
export const ALWAYS_ASK_TOOLS: ReadonlySet<string> = new Set([
  'CreateWorkflow',
  'AmendWorkflow',
  'SaveWorkflow',
  'ResumeWorkflowRun',
])

/**
 * AmendWorkflow 只改设定（不带 path/script）不问：沿用前驱已确认过的脚本。
 * @param args - the args argument.
 * @returns the computed result.
 */
export function amendNeedsAsk(args: Record<string, unknown>): boolean {
  return args['script'] !== undefined || args['path'] !== undefined
}

/**
 * 安装确认门。端口在场时对名单内的调用返回 ask；其余调用 `next()` 放行给下游门与工具体。
 * @param ctx - the ctx argument.
 * @returns the computed result.
 */
export function installAskGate(ctx: Context): () => void {
  return ctx.on('tools/pre-execute', async (exec: ToolExecution, next): Promise<PreToolDecision> => {
    if (!ALWAYS_ASK_TOOLS.has(exec.name)) return next()
    if (ctx.get('dynamicWorkflowRuns') === undefined) return next()
    if (exec.name === 'AmendWorkflow' && !amendNeedsAsk(asRecord(exec.arguments))) return next()
    return {
      kind: 'ask',
      reason: `dynamic workflow tool "${exec.name}" starts, amends, or resumes a workflow run`,
      displayReason: {
        en: `Confirm the dynamic-workflow call "${exec.name}".`,
        zh: `确认动态工作流调用「${exec.name}」。`,
      },
    }
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
