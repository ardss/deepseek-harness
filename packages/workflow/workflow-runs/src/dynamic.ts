/**
 * ZCode dynamic 工作流的 run 状态词汇（spec-dynamic-engine §3.2/§5 的原文词汇，
 * 见迁移蓝图 §1.2）。与既有 dsh workflow 包的 CLOSED union 互斥：本文件词汇只供
 * journal 引擎及其工具面/通知文案使用，禁止与 `@deepseek-ai/dsh-workflow/types`
 * 的 stopReason/outcome 混写。
 */

/** dynamic run 的五态运行状态。 */
export type DynamicRunStatus = 'pending' | 'running' | 'completed' | 'errored' | 'stopped'

/** dynamic run 的五种停止原因。 */
export type DynamicStopReason = 'user' | 'model' | 'provider' | 'interrupted' | 'superseded'

// ============================================================
// 通知/端口承载的 JSON 词汇（对话面模块新增，加法不动既有成员）
// ============================================================
// 以下类型是 ZCode contracts（dynamic-workflow-run.port.ts 等）的 JSON 形状镜像：
// 端口与通知铸造只承载可序列化数据，不引用引擎内部类型。

/** `ProviderStop` 的结构化明细（引擎 `ProviderStopDetails` 的 JSON 镜像）。 */
export interface DynamicWorkflowRunProviderStop {
  kind: 'auth' | 'not_configured' | 'model_unavailable' | 'invalid_request' | 'quota' | 'other'
  reason: string
  providerId?: string
  providerLabel?: string
  modelId?: string
  providerCode?: string
  subagent?: string
  subagentName?: string
  phase?: string
  rawMessage?: string
  resetAt?: number
}

/** 结构化失败。`code` 是稳定判别键——模型必须能分辨「进程死了」与「脚本真失败」。 */
export interface DynamicWorkflowRunError {
  code: string
  message: string
  /** 只在 `code === "ProviderStop"` 时在场。 */
  providerStop?: DynamicWorkflowRunProviderStop
}

/** 一个 actor 停驻等答的升级问题（进程内活事实的投影，零条时整字段缺席）。 */
export interface DynamicWorkflowRunPendingQuestion {
  questionId: string
  /** 结构化 ref（`siteId@ordinal`），匿名 actor 的展示名兜底。 */
  actor?: string
  actorName?: string
  /** ≤4000 字符（超限在投递边界裁剪）。 */
  question: string
  /** ≤4000 字符。 */
  context?: string
  askedAt?: number
}

/** 一件用户面产物在模型面需要的全部事实（三处共用行投影的输入交集）。 */
export interface DynamicWorkflowRunArtifact {
  id: string
  kind: string
  version: number
  title?: string
  contentType?: string
  /** 内容产物（file / markdown）最新版的字节数；预置看板没有字节。 */
  bytes?: number
  /** 预置看板收到的标签 report 条数；内容产物恒 0。 */
  itemCount?: number
  /** run 的交付物：清单以它带头，行上标 `primary`。 */
  primary?: true
  description?: string
  /**
   * 预置看板载荷（引擎侧 zod 权威校验；UI 侧宽松二次解析，坏 spec 降级卡）。
   * 只在预置看板产物上在场；内容产物缺席。entries 有界
   * （PROJECTION_LIMITS.presetEntries），触限经外层 `truncated` 位报告。
   */
  preset?: {
    kind: 'chart' | 'table' | 'metrics' | 'board'
    /** 引擎校验通过的 spec 原文（UI 侧宽容解析）。 */
    spec: unknown
    /** report(item, artifactId) 条目流的最小投影。 */
    entries: readonly unknown[]
  }
}

/** 一条渐进产物（脚本经 `report(item)` 发布的发现）。 */
export interface DynamicWorkflowRunReportItem {
  text: string
}

/** run 结算时随终态通知携带的载荷（jobs producer → JobOutcome.result 的原料）。 */
export interface DynamicWorkflowRunSettlement {
  status: Extract<DynamicRunStatus, 'completed' | 'errored' | 'stopped'>
  /** 只在 `status === "stopped"` 时在场。 */
  stopReason?: DynamicStopReason
  /** errored 恒在场；stopped 只对 provider / interrupted 在场。 */
  failure?: DynamicWorkflowRunError
  /** 脚本顶层返回值（引擎 artifact），与用户面产物是两件东西。 */
  result?: string
  summary: string
  description?: string
  /** 已相对化的脚本文件路径（模型面写法），缺席即无可编辑文件。 */
  scriptPath?: string
  reports?: readonly DynamicWorkflowRunReportItem[]
  artifacts?: readonly DynamicWorkflowRunArtifact[]
  usage?: { durationMs?: number; totalTokens?: number; toolUseCount?: number }
}

/**
 * dynamic run 的终态是否可续跑：superseded 不可 resume。
 * @param status - the status argument.
 * @param stopReason - the stopReason argument.
 * @returns the computed result.
 */
export function isDynamicRunResumable(
  status: DynamicRunStatus,
  stopReason?: DynamicStopReason,
): boolean {
  if (status !== 'stopped') return false
  return stopReason !== 'superseded'
}
