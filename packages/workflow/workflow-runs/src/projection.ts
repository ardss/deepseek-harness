/**
 * UI 投影词汇（迁移蓝图 §1.2 / §2.10）：宿主侧把 journal 引擎与 expert 引擎的
 * 事件流归约成有界投影，经 `ignorable: true` 会话事件族（opaque 载荷）下发，
 * Web UI 只消费本文件的形状，绝不接触引擎内部类型。
 *
 * 三条协议不变量（必须保真，见 spec-ui-surface §1.2）：
 * 1. 零条时整个键缺席，不是空数组——UI 据此整区不渲染，不留空壳；
 * 2. 后加字段一律 optional——旧 UI 少一个键是"退化"而非"整帧被丢"；
 * 3. 所有载荷有界（{@link PROJECTION_LIMITS}），触限置 `truncated` 位，
 *    真相仍在 journal / 存储账本。
 *
 * `resumable` 是 host 侧单信源算好的只读位（与恢复命令同一处判定），UI 只读不推导。
 */

import type { DynamicRunStatus, DynamicStopReason } from './dynamic.js'
import type {
  DynamicWorkflowRunArtifact,
  DynamicWorkflowRunError,
  DynamicWorkflowRunPendingQuestion,
  DynamicWorkflowRunReportItem,
} from './dynamic.js'
import type {
  WorkflowArtifact, WorkflowFailure, WorkflowNodeStatus, WorkflowRunStatus,
} from './expert.js'

// ============================================================
// 会话事件族（ignorable opaque 载荷契约）
// ============================================================

/** dynamic run 投影事件类型（发布方必须携带 `ignorable: true`）。 */
export const JOURNAL_RUN_EVENT_TYPE = 'journal-run/updated'

/** expert run 投影事件类型（发布方必须携带 `ignorable: true`）。 */
export const EXPERT_RUN_EVENT_TYPE = 'expert-run/updated'

// ============================================================
// 投影词汇
// ============================================================

/** UI 五态投影词汇（沿用 ui-workflow-run 现有视觉语义）。 */
export type ProjectionRunStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

/** 投影上的一个可执行节点（dsh member 粒度）。 */
export interface ProjectionNode {
  id: string
  label: string
  status: ProjectionRunStatus
  /** 出生阶段（与生命周期状态刻意两个词）。 */
  phase?: string
}

/** 事件日志单行摘要（UI 绝不整灌 journal；summary 已在铸造侧截断）。 */
export interface ProjectionEventLine {
  seq: number
  type: string
  summary: string
}

/** 一个 graph 集合的状态读数（concurrency 芯片判据）。 */
export interface ProjectionConcurrency {
  cap: number
  ceiling: number
}

// ============================================================
// 载荷上限（不变量 3 的权威常量；通知/GetRun/UI 三处共用）
// ============================================================

/** 投影各键的条数与字符上限。 */
export const PROJECTION_LIMITS = {
  /** reports[] 最大条数。 */
  reports: 32,
  /** artifacts[] 最大条数。 */
  artifacts: 16,
  /** pendingQuestions[] 最大条数。 */
  pendingQuestions: 8,
  /** nodes[] 最大条数。 */
  nodes: 64,
  /** phaseNames[] 最大条数。 */
  phaseNames: 16,
  /** events[]（事件日志摘要）最大条数，取尾部。 */
  events: 50,
  /** 事件摘要单行字符上限。 */
  eventSummary: 200,
  /** resultPreview 字符上限。 */
  resultPreview: 2000,
  /** 单条 report 文本字符上限。 */
  reportText: 2000,
  /** 预置看板 entries 最大条数（UI 看板渲染的最小数据面）。 */
  presetEntries: 500,
} as const

/**
 * 把一个数组裁剪到上限内，并报告是否触限。
 * @param items - 原始数组（真相持有者）。
 * @param limit - {@link PROJECTION_LIMITS} 中的上限。
 * @returns 裁剪后的前 `limit` 条与 truncated 位。
 */
export function clampProjectionList<T>(
  items: readonly T[],
  limit: number,
): { items: readonly T[]; truncated: boolean } {
  if (items.length <= limit) return { items, truncated: false }
  return { items: items.slice(0, limit), truncated: true }
}

/**
 * 单行字符截断（事件日志摘要语义：绝不把整条 journal 灌进 DOM）。
 * @param text - 原文。
 * @param limit - 字符上限。
 * @returns 截断后的文本，触限时以省略号收尾。
 */
export function truncateProjectionText(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…`
}

// ============================================================
// dynamic（journal 引擎）投影事件载荷
// ============================================================

/** `journal-run/updated` 的 opaque 载荷：整帧快照语义（收到即整帧替换）。 */
export interface DynamicRunProjectionEvent {
  runId: string
  /** 该 run 的宿主 job id（Cancel 按钮的唯一通道；缺席即 UI 不可取消）。 */
  jobId?: string
  label: string
  status: DynamicRunStatus
  /** 只在 `status === "stopped"` 时在场。 */
  stopReason?: DynamicStopReason
  /** host 算好的单信源只读位；为真才在场。 */
  resumable?: true
  /** lineage：本 run 由哪个前驱 resume 而来。 */
  resumedFrom?: string
  /** lineage：本 run 被哪个后继 amend 取代（UI 显示后继跳转）。 */
  supersededBy?: string
  /** errored 恒在场；stopped 只对 provider / interrupted 在场。 */
  error?: DynamicWorkflowRunError
  /** 脚本顶层返回值的预览（截断到 {@link PROJECTION_LIMITS.resultPreview}）。 */
  resultPreview?: string
  /** 任一键触限后整帧置位。 */
  truncated?: boolean
  usage?: { durationMs?: number; totalTokens?: number }
  /** 渐进产物（report(item) 的预览文本）。 */
  reports?: readonly DynamicWorkflowRunReportItem[]
  /** 用户面产物元数据（每项只带最新版）。 */
  artifacts?: readonly DynamicWorkflowRunArtifact[]
  /** actor 停驻等答的升级问题（纯内存事实，终态清空＝整键缺席）。 */
  pendingQuestions?: readonly DynamicWorkflowRunPendingQuestion[]
  /** 声明序的阶段名（迷你轨道画"还没到的站"）。 */
  phaseNames?: readonly string[]
  /** 当前所处阶段。 */
  currentPhase?: string
  /** ask / world-read 实例（member 粒度）。 */
  nodes?: readonly ProjectionNode[]
  /** 并发读数（UI 只在 `cap < ceiling` 时显示芯片）。 */
  concurrency?: ProjectionConcurrency
  /** 事件日志尾部摘要（详情侧板消费；单行已截断）。 */
  events?: readonly ProjectionEventLine[]
}

// ============================================================
// expert 引擎投影事件载荷
// ============================================================

/** expert 投影上的一个相位行。 */
export interface ProjectionPhase {
  phase: string
  title?: string
  status: WorkflowNodeStatus
  artifactPath?: string
}

/** `expert-run/updated` 的 opaque 载荷：整帧快照语义。 */
export interface ExpertRunProjectionEvent {
  runId: string
  /** 该 run 的宿主 job id（Cancel 通道；缺席即 UI 不可取消）。 */
  jobId?: string
  label: string
  /** host 算好的单信源只读位（paused/failed 可 retry-resume 时为真）；为真才在场。 */
  resumable?: true
  /** 任务一句话（运行的是什么）。 */
  task?: string
  status: WorkflowRunStatus
  /** 声明序的相位序列（含每个相位的节点状态）。 */
  phaseOrder?: readonly string[]
  phases?: readonly ProjectionPhase[]
  currentPhase?: string
  /** 图节点（phase / task，dsh member 粒度）。 */
  nodes?: readonly ProjectionNode[]
  /** 暂停原因（status === "paused" 时在场）。 */
  pauseReason?: string
  /** 结构化失败（failed 时在场）。 */
  failure?: Pick<WorkflowFailure, 'kind' | 'message'>
  /** 恢复动作标签（paused 时随失败给出一组可选项）。 */
  recoveryActions?: readonly string[]
  /** 相位产物元数据。 */
  artifacts?: readonly WorkflowArtifact[]
  /** run 报告（completed 时 buildReport 的预览）。 */
  reportPreview?: string
  /** 任一键触限后整帧置位。 */
  truncated?: boolean
  /** 事件日志尾部摘要。 */
  events?: readonly ProjectionEventLine[]
}

// ============================================================
// 引擎词汇 → UI 五态投影映射（蓝图 §1.2 mapProjectionStatus）
// ============================================================

/**
 * dynamic 引擎词汇 → UI 五态。
 * `errored→failed`；`stopped` 按 reason：`interrupted→interrupted`、
 * `user|superseded→cancelled`（superseded 另经 `supersededBy` 字段保留原词、
 * 显示后继跳转）、`model|provider→failed`；`pending` 归入 `running`（瞬态）。
 * @param status - 引擎五态。
 * @param stopReason - stopped 时的停止原因。
 * @returns UI 五态投影。
 */
export function mapDynamicProjectionStatus(
  status: DynamicRunStatus,
  stopReason?: DynamicStopReason,
): ProjectionRunStatus {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'errored':
      return 'failed'
    case 'stopped':
      if (stopReason === 'interrupted') return 'interrupted'
      if (stopReason === 'model' || stopReason === 'provider') return 'failed'
      return 'cancelled'
    case 'pending':
    case 'running':
    default:
      return 'running'
  }
}

/**
 * expert 引擎词汇 → UI 五态。
 * `failed→failed`、`completed→completed`、`cancelled→cancelled`、
 * `paused→interrupted`（暂停＝等待恢复动作，视觉上归警告态）、
 * `pending|running→running`。
 * @param status - expert 六态。
 * @returns UI 五态投影。
 */
export function mapExpertProjectionStatus(status: WorkflowRunStatus): ProjectionRunStatus {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    case 'paused':
      return 'interrupted'
    case 'pending':
    case 'running':
    default:
      return 'running'
  }
}
