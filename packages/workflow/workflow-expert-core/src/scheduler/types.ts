import type {
  SessionEvent,
  TraceContext,
  WorkflowEvent,
  WorkflowGraph,
  WorkflowGraphCollection,
  WorkflowGraphCollectionStatus,
  WorkflowGraphNode,
  WorkflowGraphPlannerResult,
  WorkflowGraphRecord,
  WorkflowRunSnapshot,
} from '@deepseek-ai/dsh-workflow-runs'

/** Shape of the workflow graph scheduler activity input. */
export interface WorkflowGraphSchedulerActivityInput {
  abortSignal?: AbortSignal
  activityId: string
  cwd: string
  node: WorkflowGraphNode
  onChildSessionStarted?: (
    event: WorkflowGraphSchedulerChildSessionStartedEvent,
  ) => void | Promise<void>
  onEvent?: (event: SessionEvent) => void | Promise<void>
  parentSessionId?: string
  phase: string
  prompt: string
  runId: string
  task: string
  traceContext?: TraceContext
}

/** Shape of the workflow graph scheduler activity result. */
export interface WorkflowGraphSchedulerActivityResult {
  model?: string
  response: string
  sessionId: string
  traceId?: string
  turnId?: string
}

/** Shape of the workflow graph scheduler child session started event. */
export interface WorkflowGraphSchedulerChildSessionStartedEvent {
  model?: string
  sessionId: string
  traceId?: string
  turnId?: string
}

/** Shape of the workflow graph scheduler runner. */
export interface WorkflowGraphSchedulerRunner {
  run(input: WorkflowGraphSchedulerActivityInput): Promise<WorkflowGraphSchedulerActivityResult>
}

/** Shape of the workflow graph scheduler planner input. */
export interface WorkflowGraphSchedulerPlannerInput {
  abortSignal?: AbortSignal
  activityId: string
  collection: WorkflowGraphCollection
  cwd: string
  graph: WorkflowGraph
  onChildSessionStarted?: (
    event: WorkflowGraphSchedulerChildSessionStartedEvent,
  ) => void | Promise<void>
  onEvent?: (event: SessionEvent) => void | Promise<void>
  parentSessionId?: string
  phase: string
  prompt: string
  runId: string
  snapshot: WorkflowRunSnapshot
  task: string
  traceContext?: TraceContext
}

/** Shape of the workflow graph scheduler planner run result. */
export interface WorkflowGraphSchedulerPlannerRunResult extends WorkflowGraphPlannerResult {
  model?: string
  response: string
  sessionId: string
  traceId?: string
  turnId?: string
}

/** Shape of the workflow graph scheduler planner runner. */
export interface WorkflowGraphSchedulerPlannerRunner {
  run(input: WorkflowGraphSchedulerPlannerInput): Promise<WorkflowGraphSchedulerPlannerRunResult>
}

/** Shape of the workflow graph scheduler deps. */
export interface WorkflowGraphSchedulerDeps {
  appendEvent(event: WorkflowEvent, options?: { signal?: AbortSignal }): Promise<void>
  appendGraphRecord(
    runId: string,
    record: WorkflowGraphRecord,
    options?: { signal?: AbortSignal },
  ): Promise<void>
  createActivityId: () => string
  now: () => Date
  onWorkflowEvent?: (event: WorkflowEvent) => void | Promise<void>
  plannerRunner?: WorkflowGraphSchedulerPlannerRunner
  runner: WorkflowGraphSchedulerRunner
  writeArtifact(
    runId: string,
    relativePath: string,
    content: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ path: string; relativePath: string }>
  writeSnapshot(snapshot: WorkflowRunSnapshot, options?: { signal?: AbortSignal }): Promise<void>
}

/** Shape of the workflow graph scheduler run options. */
export interface WorkflowGraphSchedulerRunOptions {
  abortSignal?: AbortSignal
  artifactDirectory?: string
  buildPrompt?: (input: {
    node: WorkflowGraphNode
    phase: string
    snapshot: WorkflowRunSnapshot
  }) => string
  cwd: string
  executableNodeIds?: Iterable<string>
  onEvent?: (event: SessionEvent) => void | Promise<void>
  parentSessionId?: string
  phase: string
  snapshot: WorkflowRunSnapshot
  traceContext?: TraceContext
}

/** Shape of the workflow graph scheduler run result. */
export interface WorkflowGraphSchedulerRunResult {
  reason: 'completed' | 'deadlock' | 'error_threshold'
  snapshot: WorkflowRunSnapshot
  status: 'completed' | 'paused'
}

/** Shape of the node run started. */
export interface NodeRunStarted {
  snapshot: WorkflowRunSnapshot
}

/** Shape of the node run outcome. */
export interface NodeRunOutcome {
  nodeId: string
  ok: boolean
  snapshot: WorkflowRunSnapshot
}

/** Shape of the workflow graph scheduler snapshot access. */
export interface WorkflowGraphSchedulerSnapshotAccess {
  getSnapshot(): WorkflowRunSnapshot
  setSnapshot(snapshot: WorkflowRunSnapshot): WorkflowRunSnapshot
}

/** Shape of the applied planner expansion. */
export interface AppliedPlannerExpansion {
  addedEdges: WorkflowGraphRecordEdge[]
  addedNodes: WorkflowGraphNode[]
  collection: SchedulerCollection
  snapshot: WorkflowRunSnapshot
}

/** Shape of the workflow graph record edge. */
export type WorkflowGraphRecordEdge = WorkflowGraph['edges'][number]

/** Shape of the scheduler collection. */
export type SchedulerCollection = WorkflowGraphCollection & {
  analyzedNodeIds: string[]
  errorCount: number
  exhausted: boolean
  explorable: boolean
  nodeIds: string[]
  plannerRuns: number
  status: WorkflowGraphCollectionStatus
}

/** Shape of the workflow scheduler node promise. */
export type WorkflowSchedulerNodePromise = Promise<NodeRunOutcome> & {
  started: Promise<NodeRunStarted>
}
