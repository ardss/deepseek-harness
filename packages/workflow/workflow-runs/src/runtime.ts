/**
 * 专家工作流引擎的宿主运行时端口类型（自 ZCode contracts 的 tracing / errors /
 * session.events 子集移植，见迁移蓝图 §2.0 workflow-runs）。
 *
 * 引擎包保持零宿主依赖：这里只声明引擎回调面（WorkflowRuntimePort）实际引用的
 * 结构——SessionEvent 在本包内是"宿主会话事件"的不透明结构视图，宿主接入时以
 * 结构兼容的既有事件对象直接传入，不做包装。
 */

// -----------------------------------------------
// 会话事件（不透明视图）
// -----------------------------------------------

/** 宿主会话事件的结构视图：引擎只透传，不解释 payload。 */
export interface SessionEvent {
  id: string
  sessionId: string
  turnId?: string
  type: string
  timestamp: Date
  traceId?: string
  sequenceNumber: number
  payload: unknown
}

// -----------------------------------------------
// 追踪上下文
// -----------------------------------------------

/** 轻量追踪上下文：引擎只需 traceId / sessionId / turnId 的透传语义。 */
export interface TraceContext {
  traceId: string
  queryId?: string
  spanId?: string
  parentSpanId?: string
  parentId?: string
  sessionId?: string
  turnId?: string
  attributes?: Record<string, number | string | boolean>
}

let spanSequence = 0

/** 生成本地 span id：进程内单调，非全局唯一——引擎只用于日志关联。 */
function generateSpanId(): string {
  spanSequence += 1
  return `span_${Date.now().toString(36)}_${spanSequence.toString(36)}`
}

/**
 * 从父上下文派生子上下文：traceId 继承，spanId 重生，属性合并。
 * @param parent - the parent argument.
 * @param options - the options argument.
 * @returns the computed result.
 */
export function createChildTraceContext(
  parent: TraceContext,
  options: {
    queryId?: string
    sessionId?: string
    turnId?: string
    attributes?: Record<string, number | string | boolean>
  } = {},
): TraceContext {
  // exactOptionalPropertyTypes：缺席键必须整键缺席，不能写显式 undefined。
  const child: TraceContext = {
    traceId: parent.traceId,
    spanId: generateSpanId(),
    attributes: {
      ...parent.attributes,
      ...options.attributes,
    },
  }
  const queryId = options.queryId ?? parent.queryId
  if (queryId !== undefined) child.queryId = queryId
  if (parent.spanId !== undefined) {
    child.parentSpanId = parent.spanId
    child.parentId = parent.spanId
  }
  const sessionId = options.sessionId ?? parent.sessionId
  if (sessionId !== undefined) child.sessionId = sessionId
  const turnId = options.turnId ?? parent.turnId
  if (turnId !== undefined) child.turnId = turnId
  return child
}

// -----------------------------------------------
// 核心错误类型（自 ZCode contracts/src/errors 子集移植）
// -----------------------------------------------

/** The core error type value. */
export const CoreErrorType = {
  // 会话错误
  SessionNotFound: 'session_not_found',
  SessionAlreadyExists: 'session_already_exists',
  SessionCorrupted: 'session_corrupted',
  // 回合错误
  TurnNotFound: 'turn_not_found',
  TurnInProgress: 'turn_in_progress',
  InvalidTurnPhase: 'invalid_turn_phase',
  TurnCancelled: 'turn_cancelled',
  // 模型错误
  ModelError: 'model_error',
  ModelTimeout: 'model_timeout',
  ModelRateLimited: 'model_rate_limited',
  ModelContextExceeded: 'model_context_exceeded',
  // 工具错误
  ToolNotFound: 'tool_not_found',
  ToolExecutionFailed: 'tool_execution_failed',
  ToolTimeout: 'tool_timeout',
  ToolCancelled: 'tool_cancelled',
  ToolMaxCalls: 'tool_max_calls',
  InvalidInput: 'invalid_input',
  // 权限错误
  PermissionDenied: 'permission_denied',
  PermissionEscalation: 'permission_escalation',
  PermissionTimeout: 'permission_timeout',
  // 状态错误
  InvalidStateTransition: 'invalid_state_transition',
  EventOutOfOrder: 'event_out_of_order',
  ProjectionCorrupted: 'projection_corrupted',
  // 系统错误
  StorageError: 'storage_error',
  ConfigurationError: 'configuration_error',
  Cancelled: 'cancelled',
  UnknownError: 'unknown_error',
} as const

/** Shape of the core error type. */
export type CoreErrorType = (typeof CoreErrorType)[keyof typeof CoreErrorType]

/** 核心错误结构：宿主侧错误对象只要带 type/code 即被视为 CoreError。 */
export interface CoreError extends Error {
  type: CoreErrorType
  code: string
  message: string
  cause?: Error
  context?: Record<string, unknown>
  recoverable: boolean
  retryable: boolean
  timestamp: Date
}

/**
 * 判定一个抛出值是否为核心错误：结构判定，不要求宿主用本包的工厂构造。
 * @param error - the error argument.
 * @returns the computed result.
 */
export function isCoreError(error: unknown): error is CoreError {
  return error instanceof Error && 'type' in error && 'code' in error
}
