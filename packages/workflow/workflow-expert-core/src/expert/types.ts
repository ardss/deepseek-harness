import type {
  ExpertWorkflowRunSnapshot,
  SessionEvent,
  TraceContext,
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowRunStatus,
  WorkflowStorePort,
} from '@deepseek-ai/dsh-workflow-runs'

/** Shape of the expert workflow agent run input. */
export interface ExpertWorkflowAgentRunInput {
  abortSignal?: AbortSignal
  activityId: string
  cwd: string
  onChildSessionStarted?: (event: ExpertWorkflowChildSessionStartedEvent) => void | Promise<void>
  onEvent?: (event: SessionEvent) => void | Promise<void>
  parentSessionId?: string
  phase: string
  prompt: string
  runId: string
  task: string
  traceContext?: TraceContext
  workflowKind?: string
}

/** Shape of the expert workflow child session started event. */
export interface ExpertWorkflowChildSessionStartedEvent {
  model?: string
  sessionId: string
  traceId?: string
  turnId?: string
}

/** Shape of the expert workflow agent run result. */
export interface ExpertWorkflowAgentRunResult {
  model?: string
  response: string
  sessionId: string
  traceId?: string
  turnId?: string
}

/** Shape of the expert workflow agent runner. */
export interface ExpertWorkflowAgentRunner {
  run(input: ExpertWorkflowAgentRunInput): Promise<ExpertWorkflowAgentRunResult>
}

/** Shape of the expert workflow runtime deps. */
export interface ExpertWorkflowRuntimeDeps {
  agentRunner: ExpertWorkflowAgentRunner
  createActivityId?: () => string
  createRunId?: () => string
  definition?: WorkflowDefinition
  now?: () => Date
  onWorkflowEvent?: (event: WorkflowEvent) => void | Promise<void>
  store: WorkflowStorePort
}

/** Shape of the expert workflow run options. */
export interface ExpertWorkflowRunOptions {
  abortSignal?: AbortSignal
  cwd: string
  definitionId?: string
  onEvent?: (event: SessionEvent) => void | Promise<void>
  sessionId?: string
  task: string
  traceContext?: TraceContext
  workflowKind?: string
}

/** Shape of the expert workflow lookup options. */
export interface ExpertWorkflowLookupOptions {
  abortSignal?: AbortSignal
  cwd: string
  definitionId?: string
  runId?: string
  workflowKind?: string
}

/** Shape of the expert workflow retry options. */
export interface ExpertWorkflowRetryOptions extends ExpertWorkflowLookupOptions {
  activityId?: string
  nodeId?: string
  onEvent?: (event: SessionEvent) => void | Promise<void>
  phase?: string
  traceContext?: TraceContext
}

/** Shape of the expert workflow list options. */
export interface ExpertWorkflowListOptions {
  abortSignal?: AbortSignal
  cwd: string
  definitionId?: string
  limit?: number
  workflowKind?: string
}

/** Shape of the expert workflow events options. */
export interface ExpertWorkflowEventsOptions {
  abortSignal?: AbortSignal
  limit?: number
  runId: string
}

/** Shape of the expert workflow command result. */
export interface ExpertWorkflowCommandResult {
  reportPath?: string
  response: string
  runId?: string
  snapshot?: ExpertWorkflowRunSnapshot
  status?: WorkflowRunStatus
  traceId?: string
}

/** Shape of the expert phase run result. */
export interface ExpertPhaseRunResult {
  response: string
  snapshot: ExpertWorkflowRunSnapshot
}

/** Shape of the workflow agent run input. */
export type WorkflowAgentRunInput = ExpertWorkflowAgentRunInput
/** Shape of the workflow agent run result. */
export type WorkflowAgentRunResult = ExpertWorkflowAgentRunResult
/** Shape of the workflow agent runner. */
export type WorkflowAgentRunner = ExpertWorkflowAgentRunner
/** Shape of the workflow runtime deps. */
export type WorkflowRuntimeDeps = ExpertWorkflowRuntimeDeps
/** Shape of the workflow run options. */
export type WorkflowRunOptions = ExpertWorkflowRunOptions
/** Shape of the workflow lookup options. */
export type WorkflowLookupOptions = ExpertWorkflowLookupOptions
/** Shape of the workflow retry options. */
export type WorkflowRetryOptions = ExpertWorkflowRetryOptions
/** Shape of the workflow list options. */
export type WorkflowListOptions = ExpertWorkflowListOptions
/** Shape of the workflow events options. */
export type WorkflowEventsOptions = ExpertWorkflowEventsOptions
/** Shape of the workflow command result. */
export type WorkflowCommandResult = ExpertWorkflowCommandResult
