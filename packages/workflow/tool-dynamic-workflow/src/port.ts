/**
 * `DynamicWorkflowRunPort` / actor 侧端口：对话工具面与 dynamic 引擎（journal 模块，后续实施）
 * 之间的接缝。端口所有成员按 `typeof` 探测（照 ZCode list-workflow-runs.ts 的先例），
 * 缺席绝不静默成功——「模型会去等一个永不到来的通知」。
 *
 * @module
 */

import { isJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import type { DynamicWorkflowRunArtifact, DynamicWorkflowRunError, DynamicWorkflowRunPendingQuestion } from '@deepseek-ai/dsh-workflow-runs'

/** 编译诊断（模型面行号可直接粘进一次 Edit）。 */
export interface WorkflowCompileDiagnostic {
  line: number
  column: number
  message: string
}

/** 编译结果：ok=false 时 diagnostics 至少一条。 */
export interface WorkflowCompileResult {
  ok: boolean
  diagnostics: WorkflowCompileDiagnostic[]
}

/** submit / amend 的公共入参。run 记下的 cwd 与 scriptPath 恒为绝对路径。 */
export interface DynamicWorkflowSubmitRequest {
  scriptText: string
  /**
   * settings-only 修订标记（仅 amend）：true 时 `scriptText` 无意义（恒为空串），
   * 引擎沿用被修订 run 的脚本字节。显式声明这个约定——引擎不能靠「空串」这个哨兵
   * 去猜模型到底是「不改脚本」还是「提交了空脚本」。
   */
  settingsOnly?: boolean
  cwd: string
  /** 展示名；缺席由引擎兜底。 */
  name?: string
  /** 实参（saved 来源拷贝或顶层 args）。 */
  args?: JsonValue
  /** amend 语义：被本次修订取代的前驱 run。 */
  amendOf?: string
  parentSessionId: string
  toolCallId: string
  maxConcurrency?: number
  subagentModel?: string
  /** 可编辑的脚本文件（绝对路径）；缺席即该 run 没有可编辑文件。 */
  scriptPath?: string
}

/** 提交结果：runId + 终态 promise（引擎结算时 resolve）。 */
export interface DynamicWorkflowSubmitResult {
  runId: string
  settled: Promise<import('@deepseek-ai/dsh-workflow-runs').DynamicWorkflowRunSettlement>
}

/** 列表行（跨会话可见的项目级 run 历史）。 */
export interface DynamicWorkflowRunSummary {
  runId: string
  label: string
  labelSource?: string
  status: string
  stopReason?: string
  resumedFrom?: string
  supersededBy?: string
  /** 本会话是否持有该 run；不能确认时 false 但 possiblyInterrupted 说明那是注解不是 verdict。 */
  ownedByThisSession: boolean
  possiblyInterrupted?: true
  startedAt?: number
  updatedAt?: number
  spentTokens?: number
}

/** 单 run 详情（GetWorkflowRun 的数据面）。 */
export interface DynamicWorkflowRunDetail extends DynamicWorkflowRunSummary {
  summary: string
  description?: string
  /** 引擎在此进程内看到的停驻问题；查不到时 undefined（Unknown 分支明说）。 */
  pendingQuestions?: readonly DynamicWorkflowRunPendingQuestion[]
  logTail?: readonly string[]
  result?: string
  error?: DynamicWorkflowRunError
  artifacts?: readonly DynamicWorkflowRunArtifact[]
  usage?: { durationMs?: number; totalTokens?: number }
  scriptPath?: string
}

/** resume 的结构化失败原因（稳定错误码 11-17 的判别键）。 */
export type DynamicWorkflowResumeErrorReason =
  | 'not_found'
  | 'not_resumable'
  | 'superseded'
  | 'already_running'
  | 'script_missing'
  | 'script_mismatch'
  | 'compile_failed'

/** resolveQuestion 的结构化失败原因（稳定错误码 21-24 的判别键）。 */
export type DynamicWorkflowResolveErrorReason =
  | 'unknown_question'
  | 'already_resolved'
  | 'run_not_in_flight'

/** 服务端为 subagent_model 选型提供的模型清单行。 */
export interface WorkflowModelSummary {
  /** 规范形 `providerId/modelId`，直接可作 `subagent_model`。 */
  id: string
  providerId: string
  label?: string
  reasoningLevels?: readonly string[]
  disabled?: boolean
}

/**
 * dynamic run 服务端口。submit/amend 由 CreateWorkflow / AmendWorkflow 消费；
 * 其余成员可选，工具侧 typeof 探测。
 */
export interface DynamicWorkflowRunPort {
  /** 编译 + 启动后台 run；提交失败向上冒泡成工具调用失败。 */
  submit(request: DynamicWorkflowSubmitRequest, signal: AbortSignal): Promise<DynamicWorkflowSubmitResult>
  /** amend：起新 run 取代 amendOf 并导入其已完成工作为 cache。 */
  amend(request: DynamicWorkflowSubmitRequest, signal: AbortSignal): Promise<DynamicWorkflowSubmitResult>
  /** 本机并发天花板（对话文案的「(this machine's maximum)」判据）。 */
  concurrencyCeiling?(): number
  /** 静态分析/编译；缺席即本会话没有类型检查能力。 */
  compile?(scriptText: string): Promise<WorkflowCompileResult>
  resolveQuestion?(questionId: string, answer: string): Promise<
    | { ok: true; qid: string }
    | { ok: false; reason: DynamicWorkflowResolveErrorReason; message: string }
  >
  getRunDetail?(runId: string): Promise<DynamicWorkflowRunDetail | undefined>
  listRuns?(ownerSessionId?: string): Promise<readonly DynamicWorkflowRunSummary[]>
  resumeRun?(runId: string, signal: AbortSignal): Promise<
    | { ok: true; runId: string }
    | { ok: false; reason: DynamicWorkflowResumeErrorReason; message?: string; detail?: string }
  >
  /** 同步只读跑一段 snippet（EvalWorkflowSnippet 测试台）。 */
  evalSnippet?(code: string): Promise<{ ok: boolean; value?: string; error?: string }>
  listModels?(): Promise<readonly WorkflowModelSummary[]>
  cancel?(runId: string, reason?: string): Promise<boolean>
}

/** escalate 的一次结局：answered 是普通结果，refused 的文案由端口写好透传（非错误）。 */
export type WorkflowEscalateOutcome =
  | { kind: 'answered'; answer: string; qid: string }
  | { kind: 'refused'; message: string; reason: 'budget_exhausted' | 'no_pending_ask' | string }

/** actor 侧升级端口（escalate 工具消费）。 */
export interface WorkflowEscalatePort {
  escalate(request: {
    toolCallId: string
    question: string
    context?: string
    signal: AbortSignal
  }): Promise<WorkflowEscalateOutcome>
}

/** actor 侧终态回交端口（submit_result 工具消费）。 */
export interface WorkflowSubmitResultPort {
  submitResult(request: {
    toolCallId: string
    outcome: 'success' | 'reject'
    result?: JsonValue
    error?: string
  }): Promise<{ accepted: boolean; message?: string }>
}

/**
 * 端口载荷 → 无损 JSON 工具结果字段：结构化值经 JSON 往返剥离非 JSON 成员，
 * 往返失败（含 undefined 根或循环引用）回落为 null。工具结果字段一律经此
 * 构造，禁止 `as unknown as JsonValue` 断言（no-unknown-casts 门禁）。
 * @param value - the value argument.
 * @returns the computed result.
 */
export function portPayloadAsJson(value: unknown): JsonValue {
  try {
    const encoded = JSON.parse(JSON.stringify(value ?? null)) as JsonValue
    return isJsonValue(encoded) ? encoded : null
  } catch {
    return null
  }
}

/**
 * 可选接缝的 Context 合并：dynamic 引擎模块（后续实施）注册实现；本包只声明键。
 * 属性类型显式含 `| undefined`——「端口缺席」是本工具面的一等公民（未接线宿主的占位语义）。
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    dynamicWorkflowRuns: DynamicWorkflowRunPort | undefined
    workflowEscalate: WorkflowEscalatePort | undefined
    workflowSubmitResult: WorkflowSubmitResultPort | undefined
  }
}
