/**
 * artifact 行投影：一处定义，三处共用（终态通知 `<artifacts>` 节、GetWorkflowRun 截面、
 * UI manifest）。移植自 ZCode `core/src/tool/executor/workflow-published-artifacts.ts`。
 *
 * 刻意不给 uri：模型读不了产物存储；引用纪律是「按标题引用，不贴内容」。
 * @module
 */

import type { DynamicWorkflowRunArtifact } from '@deepseek-ai/dsh-workflow-runs'

/** Shape of the published artifact summary. */
export type PublishedArtifactSummary = DynamicWorkflowRunArtifact

/** 完成通知里 `<artifacts>` 最多列几行（与载荷上界 ≤8 同值）。 */
export const WORKFLOW_ARTIFACTS_NOTIFICATION_MAX_LINES = 8
/** GetWorkflowRun 截面上界（每 run 产物上限 32）。 */
export const WORKFLOW_ARTIFACTS_INTROSPECTION_MAX_LINES = 32

/** 预置看板的四个成员：它们没有字节，数据量是标签 report 的条数。 */
const PRESET_ARTIFACT_KINDS: ReadonlySet<string> = new Set([
  'chart',
  'table',
  'metrics',
  'board',
])

/**
 * 交付物带头，其余保持原顺序（稳定排序）。三处清单都先过这一步再截，所以上界砍不到交付物。
 * @param artifacts - the artifacts argument.
 * @returns the computed result.
 */
export function primaryFirst<T extends { primary?: true }>(artifacts: readonly T[]): T[] {
  return [...artifacts].sort(
    (left, right) => Number(right.primary === true) - Number(left.primary === true),
  )
}

/**
 * 一件产物 → 一行：`- {id} ({kind}[, primary], v{version}[, {contentType}][, {bytes} bytes | {n} items])[: {title}]`。
 * 缺席的部件整段省略；title 缺席时连冒号一起省略。
 * @param artifact - the artifact argument.
 * @returns the computed result.
 */
export function formatPublishedArtifactLine(artifact: PublishedArtifactSummary): string {
  // `primary` 紧跟种类：模型据它知道该先把哪一件交给用户。
  const parts = artifact.primary === true ? [artifact.kind, 'primary'] : [artifact.kind]
  parts.push(`v${artifact.version}`)
  if (artifact.contentType !== undefined && artifact.contentType.length > 0) {
    parts.push(artifact.contentType)
  }
  if (PRESET_ARTIFACT_KINDS.has(artifact.kind)) {
    if (artifact.itemCount !== undefined) {
      parts.push(`${artifact.itemCount} item${artifact.itemCount === 1 ? '' : 's'}`)
    }
  } else if (artifact.bytes !== undefined) {
    parts.push(`${artifact.bytes} bytes`)
  }
  const head = `- ${artifact.id} (${parts.join(', ')})`
  const title = artifact.title?.trim()
  return title === undefined || title.length === 0 ? head : `${head}: ${title}`
}

/** `<artifacts count shown>` 一节所需的三件事，与 `<reports>` 那一节同形。 */
export interface WorkflowArtifactsSection {
  /** 真实总件数（不是列出来的行数）。 */
  count: number
  /** 实际列出的行数；小于 count 即清单是局部的。 */
  shown: number
  preview: string
}

/**
 * 产物清单 → `<artifacts>` 一节；零件（undefined / 空数组）返回 undefined，
 * 调用方据此让整节缺席——不发一节空的。
 * @param artifacts - the artifacts argument.
 * @param maxLines - the maxLines argument.
 * @returns the computed result.
 */
export function buildWorkflowArtifactsSection(
  artifacts: readonly PublishedArtifactSummary[] | undefined,
  maxLines: number,
): WorkflowArtifactsSection | undefined {
  if (artifacts === undefined || artifacts.length === 0) return undefined
  const lines = primaryFirst(artifacts)
    .slice(0, maxLines)
    .map(formatPublishedArtifactLine)
  return { count: artifacts.length, shown: lines.length, preview: lines.join('\n') }
}
