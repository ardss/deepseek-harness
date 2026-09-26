import { randomUUID } from 'node:crypto'
import {
  WorkflowDefinitionSchema,
  deriveWorkflowSessionLinks,
  type ExpertWorkflowRunSnapshot,
  type WorkflowActivitySnapshot,
  type WorkflowArtifact,
  type WorkflowDefinition,
  type WorkflowEvent,
  type WorkflowNodeStatus,
  type WorkflowPhaseDefinition,
  type WorkflowPhaseSnapshot,
} from '@deepseek-ai/dsh-workflow-runs'
import { createExpertWorkflowDefinition, workflowDefinitionPhaseMap } from '../definition.js'
import type { WorkflowGraphNodeChange, WorkflowSnapshotLifecycleResult } from '../lifecycle.js'
import { phaseNodeId, safeRunIdSegment } from './ids.js'
import { createPhaseGraph, updateGraphNodeStatus } from './prompts.js'
import type { ExpertWorkflowLookupOptions, ExpertWorkflowRuntimeDeps } from './types.js'

/** The expert workflow runtime context service. */
export class ExpertWorkflowRuntimeContext {
/** The active run abort controllers. */
  readonly activeRunAbortControllers = new Map<string, AbortController>()
  /** The agent runner. */
  readonly agentRunner: ExpertWorkflowRuntimeDeps['agentRunner']
  /** The create activity id. */
  readonly createActivityId: () => string
  /** The create run id. */
  readonly createRunId: () => string
  /** The definition. */
  readonly definition: WorkflowDefinition
  /** The now. */
  readonly now: () => Date
  /** The on workflow event. */
  readonly onWorkflowEvent?: (event: WorkflowEvent) => void | Promise<void>
  /** The phase definitions. */
  readonly phaseDefinitions: Map<string, WorkflowPhaseDefinition>
  /** The store. */
  readonly store: ExpertWorkflowRuntimeDeps['store']

  constructor(deps: ExpertWorkflowRuntimeDeps) {
    this.definition = WorkflowDefinitionSchema.parse(
      deps.definition ?? createExpertWorkflowDefinition(),
    )
    this.phaseDefinitions = workflowDefinitionPhaseMap(this.definition)
    this.agentRunner = deps.agentRunner
    this.createActivityId = deps.createActivityId ?? (() => `act_${randomUUID()}`)
    this.createRunId =
      deps.createRunId ?? (() => `wf_${safeRunIdSegment(this.definition.kind)}_${randomUUID()}`)
    this.now = deps.now ?? (() => new Date())
    this.onWorkflowEvent = deps.onWorkflowEvent
    this.store = deps.store
  }

  /**
 * The expert workflow runtime context.create initial snapshot.
 * @param options - the options argument.
 * @returns the computed result.
 */
  createInitialSnapshot(options: {
    cwd: string
    sessionId?: string
    task: string
    traceContext?: { traceId: string }
  }): ExpertWorkflowRunSnapshot {
    const runId = this.createRunId()
    const timestamp = this.timestamp()
    const phaseOrder = this.definition.phaseOrder
    return {
      activities: [],
      artifacts: [],
      createdAt: timestamp,
      cwd: options.cwd,
      definitionId: this.definition.definitionId,
      definitionVersion: this.definition.definitionVersion,
      graph: createPhaseGraph(this.definition),
      kind: this.definition.kind,
      phaseOrder,
      phases: phaseOrder.map(phase => ({
        phase,
        status: 'pending',
      })),
      recoveryActions: [],
      runId,
      schemaVersion: 1,
      sessionId: options.sessionId,
      sessionLinks: [],
      status: 'pending',
      strategy: this.definition.strategy,
      task: options.task,
      traceId: options.traceContext?.traceId,
      updatedAt: timestamp,
    }
  }

  /**
 * The expert workflow runtime context.write initial graph.
 * @param signal - the signal argument.
 * @param snapshot - the snapshot argument.
 */
  async writeInitialGraph(
    snapshot: ExpertWorkflowRunSnapshot,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.store.appendGraphRecord(
      snapshot.runId,
      {
        createdAt: snapshot.createdAt,
        definitionId: snapshot.definitionId,
        definitionVersion: snapshot.definitionVersion,
        phaseOrder: snapshot.phaseOrder,
        recordType: 'meta',
        runId: snapshot.runId,
        schemaVersion: 1,
        strategy: snapshot.strategy,
      },
      { signal },
    )
    for (const node of snapshot.graph.nodes) {
      await this.store.appendGraphRecord(
        snapshot.runId,
        {
          node,
          recordType: 'node',
          runId: snapshot.runId,
          timestamp: this.timestamp(),
        },
        { signal },
      )
    }
    for (const edge of snapshot.graph.edges) {
      await this.store.appendGraphRecord(
        snapshot.runId,
        {
          edge,
          recordType: 'edge',
          runId: snapshot.runId,
          timestamp: this.timestamp(),
        },
        { signal },
      )
    }
    for (const collection of snapshot.graph.collections ?? []) {
      await this.store.appendGraphRecord(
        snapshot.runId,
        {
          collection,
          recordType: 'collection',
          runId: snapshot.runId,
          timestamp: this.timestamp(),
        },
        { signal },
      )
    }
  }

  /**
 * The expert workflow runtime context.append graph status.
 * @param phase - the phase argument.
 * @param signal - the signal argument.
 * @param snapshot - the snapshot argument.
 * @param status - the status argument.
 */
  async appendGraphStatus(
    snapshot: ExpertWorkflowRunSnapshot,
    phase: string,
    status: WorkflowNodeStatus,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.appendGraphNodeStatus(snapshot, phaseNodeId(phase), status, signal, phase)
  }

  /**
 * The expert workflow runtime context.append graph node status.
 * @param nodeId - the nodeId argument.
 * @param phase - the phase argument.
 * @param signal - the signal argument.
 * @param snapshot - the snapshot argument.
 * @param status - the status argument.
 */
  async appendGraphNodeStatus(
    snapshot: ExpertWorkflowRunSnapshot,
    nodeId: string,
    status: WorkflowNodeStatus,
    signal?: AbortSignal,
    phase?: string,
  ): Promise<void> {
    await this.store.appendGraphRecord(
      snapshot.runId,
      {
        nodeId,
        phase,
        recordType: 'op',
        runId: snapshot.runId,
        status,
        timestamp: this.timestamp(),
        type: 'update_status',
      },
      { signal },
    )
  }

  /**
 * The expert workflow runtime context.append event.
 * @param options - the options argument.
 * @param runId - the runId argument.
 * @param type - the type argument.
 */
  async appendEvent(
    runId: string,
    type: WorkflowEvent['type'],
    options: {
      message?: string
      nodeId?: string
      payload?: Record<string, unknown>
      phase?: string
      signal?: AbortSignal
    } = {},
  ): Promise<void> {
    const event: WorkflowEvent = {
      kind: this.definition.kind,
      message: options.message,
      nodeId: options.nodeId,
      payload: options.payload,
      phase: options.phase,
      runId,
      timestamp: this.timestamp(),
      type,
    }
    await this.store.appendEvent(event, { signal: options.signal })
    await this.onWorkflowEvent?.(event)
  }

  /**
 * The expert workflow runtime context.append lifecycle graph changes.
 * @param nodeChanges - the nodeChanges argument.
 * @param signal - the signal argument.
 * @param snapshot - the snapshot argument.
 */
  async appendLifecycleGraphChanges(
    snapshot: ExpertWorkflowRunSnapshot,
    nodeChanges: readonly WorkflowGraphNodeChange[],
    signal?: AbortSignal,
  ): Promise<void> {
    for (const change of nodeChanges) {
      await this.appendGraphNodeStatus(
        snapshot,
        change.nodeId,
        change.status,
        signal,
        change.phase,
      )
    }
  }

  /**
 * The expert workflow runtime context.update snapshot.
 * @param patch - the patch argument.
 * @param snapshot - the snapshot argument.
 * @returns the computed result.
 */
  updateSnapshot(
    snapshot: ExpertWorkflowRunSnapshot,
    patch: Partial<
      Pick<
        ExpertWorkflowRunSnapshot,
        | 'completedAt'
        | 'currentPhase'
        | 'failure'
        | 'pauseReason'
        | 'recoveryActions'
        | 'reportPath'
        | 'startedAt'
        | 'status'
      >
    >,
  ): ExpertWorkflowRunSnapshot {
    return {
      ...snapshot,
      ...patch,
      updatedAt: this.timestamp(),
    }
  }

  /**
 * The expert workflow runtime context.update phase.
 * @param patch - the patch argument.
 * @param phase - the phase argument.
 * @param snapshot - the snapshot argument.
 * @returns the computed result.
 */
  updatePhase(
    snapshot: ExpertWorkflowRunSnapshot,
    phase: string,
    patch: Partial<WorkflowPhaseSnapshot>,
  ): ExpertWorkflowRunSnapshot {
    return this.updateSnapshot(
      {
        ...snapshot,
        currentPhase: phase,
        graph: updateGraphNodeStatus(snapshot.graph, phase, patch.status),
        phases: snapshot.phases.map(item =>
          item.phase === phase
            ? {
              ...item,
              ...patch,
            }
            : item,
        ),
      },
      {
        currentPhase: phase,
      },
    )
  }

  /**
 * The expert workflow runtime context.add artifact.
 * @param artifact - the artifact argument.
 * @param snapshot - the snapshot argument.
 * @returns the computed result.
 */
  addArtifact(
    snapshot: ExpertWorkflowRunSnapshot,
    artifact: WorkflowArtifact,
  ): ExpertWorkflowRunSnapshot {
    const artifacts = [
      ...snapshot.artifacts.filter(item => item.path !== artifact.path),
      artifact,
    ]
    return {
      ...snapshot,
      artifacts,
      updatedAt: this.timestamp(),
    }
  }

  /**
 * The expert workflow runtime context.upsert activity.
 * @param activity - the activity argument.
 * @param snapshot - the snapshot argument.
 * @returns the computed result.
 */
  upsertActivity(
    snapshot: ExpertWorkflowRunSnapshot,
    activity: WorkflowActivitySnapshot,
  ): ExpertWorkflowRunSnapshot {
    const activities = [
      ...snapshot.activities.filter(item => item.activityId !== activity.activityId),
      activity,
    ]
    return {
      ...snapshot,
      activities,
      sessionLinks: deriveWorkflowSessionLinks({ activities, runId: snapshot.runId }),
      updatedAt: this.timestamp(),
    }
  }

  /**
 * The expert workflow runtime context.resolve snapshot.
 * @param options - the options argument.
 * @returns the computed result.
 */
  async resolveSnapshot(
    options: ExpertWorkflowLookupOptions,
  ): Promise<ExpertWorkflowRunSnapshot | null> {
    if (options.runId) {
      return await this.store.readRun(options.runId, { signal: options.abortSignal })
    }
    return await this.store.readLatestRun(
      {
        cwd: options.cwd,
        kind: this.definition.kind,
      },
      { signal: options.abortSignal },
    )
  }

  /**
 * The expert workflow runtime context.get phase definition.
 * @param phase - the phase argument.
 * @returns the computed result.
 */
  getPhaseDefinition(phase: string): WorkflowPhaseDefinition {
    const definition = this.phaseDefinitions.get(phase)
    if (!definition) {
      throw new Error(`${this.definition.title} definition is missing phase: ${phase}`)
    }
    return definition
  }

  /**
 * The expert workflow runtime context.timestamp.
 * @returns the computed result.
 */
  timestamp(): string {
    return this.now().toISOString()
  }

  /**
 * The expert workflow runtime context.register run abort signal.
 * @param externalSignal - the externalSignal argument.
 * @param runId - the runId argument.
 * @returns the computed result.
 */
  registerRunAbortSignal(
    runId: string,
    externalSignal: AbortSignal | undefined,
  ): { dispose: () => void; signal: AbortSignal } {
    const controller = new AbortController()
    const forwardAbort = (): void => {
      controller.abort(
        externalSignal?.reason instanceof Error
          ? externalSignal.reason
          : new Error('Workflow aborted'),
      )
    }

    this.activeRunAbortControllers.set(runId, controller)
    if (externalSignal?.aborted) {
      forwardAbort()
    } else {
      externalSignal?.addEventListener('abort', forwardAbort, { once: true })
    }

    return {
      dispose: () => {
        externalSignal?.removeEventListener('abort', forwardAbort)
        if (this.activeRunAbortControllers.get(runId) === controller) {
          this.activeRunAbortControllers.delete(runId)
        }
      },
      signal: controller.signal,
    }
  }
}

/**
 * Handles the lifecycle payload.
 * @param result - the result argument.
 * @returns the computed result.
 */
export function lifecyclePayload(
  result: WorkflowSnapshotLifecycleResult<ExpertWorkflowRunSnapshot>,
): Record<string, unknown> {
  return {
    activityIds: result.activityIds,
    nodeIds: result.nodeChanges.map(change => change.nodeId),
    phaseIds: result.phaseIds,
  }
}

/**
 * Handles the compact workflow payload.
 * @param value - the value argument.
 * @returns the computed result.
 */
export function compactWorkflowPayload(
  value: Record<string, unknown | undefined>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Record<string, unknown>
}

/**
 * Handles the dedupe workflow node changes.
 * @param changes - the changes argument.
 * @returns the computed result.
 */
export function dedupeWorkflowNodeChanges(
  changes: WorkflowGraphNodeChange[],
): WorkflowGraphNodeChange[] {
  const byNodeId = new Map<string, WorkflowGraphNodeChange>()
  for (const change of changes) {
    byNodeId.set(change.nodeId, change)
  }
  return [...byNodeId.values()]
}
