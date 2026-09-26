import { z } from 'zod'



/** The workflow kind schema value. */
export const WorkflowKindSchema = z.string().min(1)
/** Shape of the workflow kind. */
export type WorkflowKind = z.infer<typeof WorkflowKindSchema>

/** The workflow phase id schema value. */
export const WorkflowPhaseIdSchema = z.string().min(1)
/** Shape of the workflow phase id. */
export type WorkflowPhaseId = z.infer<typeof WorkflowPhaseIdSchema>

/** The workflow run status schema value. */
export const WorkflowRunStatusSchema = z.enum([
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
])
/** Shape of the workflow run status. */
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>

/** The workflow node status schema value. */
export const WorkflowNodeStatusSchema = z.enum([
  'pending',
  'active',
  'completed',
  'failed',
  'skipped',
  'cancelled',
])
/** Shape of the workflow node status. */
export type WorkflowNodeStatus = z.infer<typeof WorkflowNodeStatusSchema>

/** The workflow graph collection status schema value. */
export const WorkflowGraphCollectionStatusSchema = z.enum(['active', 'draining', 'exhausted'])
/** Shape of the workflow graph collection status. */
export type WorkflowGraphCollectionStatus = z.infer<typeof WorkflowGraphCollectionStatusSchema>

/** The expert workflow phase schema value. */
export const ExpertWorkflowPhaseSchema = z.enum([
  'clarify',
  'task_analysis',
  'arch_decompose',
  'env_setup',
  'meta_prompt',
  'exec',
  'final_critic',
  'complete',
])
/** Shape of the expert workflow phase. */
export type ExpertWorkflowPhase = z.infer<typeof ExpertWorkflowPhaseSchema>

/** The workflow strategy schema value. */
export const WorkflowStrategySchema = z.object({
  clarify: z.object({
    confidenceThreshold: z.number(),
    maxRounds: z.number().int().positive(),
    minRounds: z.number().int().nonnegative(),
  }),
  executor: z.object({
    drainingChangeHours: z.number().positive(),
    frontierTarget: z.number().int().positive(),
    maxConcurrentLoops: z.number().int().positive(),
    maxConsecutiveErrors: z.number().int().positive(),
    maxPlannerRuns: z.number().int().positive(),
  }),
  finalCritic: z.object({
    maxIterations: z.number().int().positive(),
  }),
  reactLoop: z.object({
    maxRounds: z.number().int().positive(),
  }),
})
/** Shape of the workflow strategy. */
export type WorkflowStrategy = z.infer<typeof WorkflowStrategySchema>

/** The expert workflow strategy schema value. */
export const ExpertWorkflowStrategySchema = WorkflowStrategySchema
/** Shape of the expert workflow strategy. */
export type ExpertWorkflowStrategy = WorkflowStrategy

/** The workflow phase behavior schema value. */
export const WorkflowPhaseBehaviorSchema = z.enum([
  'agent',
  'scheduled_graph',
  'critic',
  'complete',
])
/** Shape of the workflow phase behavior. */
export type WorkflowPhaseBehavior = z.infer<typeof WorkflowPhaseBehaviorSchema>

/** The workflow graph seed source schema value. */
export const WorkflowGraphSeedSourceSchema = z.object({
  gateAfterPhase: WorkflowPhaseIdSchema.optional(),
  targetPhase: WorkflowPhaseIdSchema,
})
/** Shape of the workflow graph seed source. */
export type WorkflowGraphSeedSource = z.infer<typeof WorkflowGraphSeedSourceSchema>

/** The workflow phase definition schema value. */
export const WorkflowPhaseDefinitionSchema = z.object({
  artifactPath: z.string().optional(),
  behavior: WorkflowPhaseBehaviorSchema.default('agent'),
  description: z.string().min(1),
  nodePromptsFromArtifact: z
    .object({
      targetPhase: WorkflowPhaseIdSchema,
    })
    .optional(),
  phase: WorkflowPhaseIdSchema,
  seedGraphFromArtifact: WorkflowGraphSeedSourceSchema.optional(),
  title: z.string().min(1),
})
/** Shape of the workflow phase definition. */
export type WorkflowPhaseDefinition = z.infer<typeof WorkflowPhaseDefinitionSchema>

/** The workflow definition schema value. */
export const WorkflowDefinitionSchema = z
  .object({
    definitionId: z.string().min(1),
    definitionVersion: z.string().min(1),
    description: z.string().optional(),
    kind: WorkflowKindSchema,
    phaseOrder: z.array(WorkflowPhaseIdSchema).min(1),
    phases: z.array(WorkflowPhaseDefinitionSchema).min(1),
    strategy: WorkflowStrategySchema,
    title: z.string().min(1),
  })
  .superRefine((definition, context) => {
    const seenPhases = new Set<string>()
    for (const phase of definition.phases) {
      if (seenPhases.has(phase.phase)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate workflow phase definition: ${phase.phase}`,
          path: ['phases'],
        })
      }
      seenPhases.add(phase.phase)
    }

    const seenOrder = new Set<string>()
    for (const phase of definition.phaseOrder) {
      if (seenOrder.has(phase)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate workflow phase order entry: ${phase}`,
          path: ['phaseOrder'],
        })
      }
      seenOrder.add(phase)
      if (!seenPhases.has(phase)) {
        context.addIssue({
          code: 'custom',
          message: `Workflow phaseOrder references unknown phase: ${phase}`,
          path: ['phaseOrder'],
        })
      }
    }

    for (const phase of seenPhases) {
      if (!seenOrder.has(phase)) {
        context.addIssue({
          code: 'custom',
          message: `Workflow phase definition is missing from phaseOrder: ${phase}`,
          path: ['phases'],
        })
      }
    }
  })
/** Shape of the workflow definition. */
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>

/** The workflow artifact schema value. */
export const WorkflowArtifactSchema = z.object({
  contentType: z.string(),
  createdAt: z.string(),
  label: z.string(),
  path: z.string(),
  phase: WorkflowPhaseIdSchema.optional(),
})
/** Shape of the workflow artifact. */
export type WorkflowArtifact = z.infer<typeof WorkflowArtifactSchema>

/** The workflow phase snapshot schema value. */
export const WorkflowPhaseSnapshotSchema = z.object({
  artifactPath: z.string().optional(),
  activityId: z.string().optional(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
  phase: WorkflowPhaseIdSchema,
  sessionId: z.string().optional(),
  startedAt: z.string().optional(),
  status: WorkflowNodeStatusSchema,
  traceId: z.string().optional(),
  turnId: z.string().optional(),
})
/** Shape of the workflow phase snapshot. */
export type WorkflowPhaseSnapshot = z.infer<typeof WorkflowPhaseSnapshotSchema>

/** The workflow activity kind schema value. */
export const WorkflowActivityKindSchema = z.enum([
  'agent_session',
  'planner_agent',
  'subplanner_agent',
  'actor_agent',
  'critic_agent',
])
/** Shape of the workflow activity kind. */
export type WorkflowActivityKind = z.infer<typeof WorkflowActivityKindSchema>

/** The workflow session link status schema value. */
export const WorkflowSessionLinkStatusSchema = z.enum([
  'starting',
  'running',
  'retrying_model',
  'waiting_permission',
  'completed',
  'failed',
  'cancelled',
])
/** Shape of the workflow session link status. */
export type WorkflowSessionLinkStatus = z.infer<typeof WorkflowSessionLinkStatusSchema>

/** The workflow failure kind schema value. */
export const WorkflowFailureKindSchema = z.enum([
  'network',
  'rate_limit',
  'timeout',
  'auth',
  'provider',
  'model_context',
  'configuration',
  'permission',
  'tool',
  'cancelled',
  'unknown',
])
/** Shape of the workflow failure kind. */
export type WorkflowFailureKind = z.infer<typeof WorkflowFailureKindSchema>

/** The workflow failure schema value. */
export const WorkflowFailureSchema = z.object({
  activityId: z.string().optional(),
  code: z.string().optional(),
  kind: WorkflowFailureKindSchema,
  message: z.string(),
  nodeId: z.string().optional(),
  phase: WorkflowPhaseIdSchema.optional(),
  recoverable: z.boolean(),
  retryable: z.boolean(),
  sessionId: z.string().optional(),
  traceId: z.string().optional(),
  turnId: z.string().optional(),
})
/** Shape of the workflow failure. */
export type WorkflowFailure = z.infer<typeof WorkflowFailureSchema>

/** The workflow recovery action schema value. */
export const WorkflowRecoveryActionSchema = z.object({
  action: z.enum(['retry', 'retry_with_current_model', 'skip_node', 'cancel']),
  activityId: z.string().optional(),
  destructive: z.boolean().optional(),
  label: z.string(),
  nodeId: z.string().optional(),
  phase: WorkflowPhaseIdSchema.optional(),
})
/** Shape of the workflow recovery action. */
export type WorkflowRecoveryAction = z.infer<typeof WorkflowRecoveryActionSchema>

/** The workflow session link schema value. */
export const WorkflowSessionLinkSchema = z.object({
  activityId: z.string(),
  attempt: z.number().int().positive(),
  completedAt: z.string().optional(),
  kind: WorkflowActivityKindSchema,
  model: z.string().optional(),
  nodeId: z.string().optional(),
  parentSessionId: z.string().optional(),
  phase: WorkflowPhaseIdSchema,
  runId: z.string(),
  sessionId: z.string().optional(),
  startedAt: z.string(),
  status: WorkflowSessionLinkStatusSchema,
  traceId: z.string().optional(),
  turnId: z.string().optional(),
})
/** Shape of the workflow session link. */
export type WorkflowSessionLink = z.infer<typeof WorkflowSessionLinkSchema>

/** The workflow activity snapshot schema value. */
export const WorkflowActivitySnapshotSchema = z.object({
  activityId: z.string(),
  artifactPath: z.string().optional(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
  inputArtifactPaths: z.array(z.string()).default([]),
  kind: WorkflowActivityKindSchema,
  model: z.string().optional(),
  nodeId: z.string().optional(),
  outputArtifactPaths: z.array(z.string()).default([]),
  parentSessionId: z.string().optional(),
  phase: WorkflowPhaseIdSchema,
  sessionId: z.string().optional(),
  startedAt: z.string(),
  status: WorkflowNodeStatusSchema,
  traceId: z.string().optional(),
  turnId: z.string().optional(),
})
/** Shape of the workflow activity snapshot. */
export type WorkflowActivitySnapshot = z.infer<typeof WorkflowActivitySnapshotSchema>

/** The workflow graph node schema value. */
export const WorkflowGraphNodeSchema = z.object({
  collectionId: z.string().optional(),
  id: z.string(),
  attempts: z.number().int().nonnegative().optional(),
  dependsOn: z.array(z.string()).default([]),
  description: z.string().optional(),
  error: z.string().optional(),
  kind: z.enum(['phase', 'task']).default('phase'),
  phase: WorkflowPhaseIdSchema.optional(),
  prompt: z.string().optional(),
  reopenAttempts: z.number().int().nonnegative().optional(),
  status: WorkflowNodeStatusSchema,
  title: z.string(),
})
/** Shape of the workflow graph node. */
export type WorkflowGraphNode = z.infer<typeof WorkflowGraphNodeSchema>

/** The workflow graph edge schema value. */
export const WorkflowGraphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
})
/** Shape of the workflow graph edge. */
export type WorkflowGraphEdge = z.infer<typeof WorkflowGraphEdgeSchema>

/** The workflow graph collection schema value. */
export const WorkflowGraphCollectionSchema = z.object({
  analyzedNodeIds: z.array(z.string()).optional(),
  collectionId: z.string(),
  errorCount: z.number().int().nonnegative().optional(),
  exhausted: z.boolean().optional(),
  explorable: z.boolean().optional(),
  frontierTarget: z.number().int().positive().optional(),
  goal: z.string().optional(),
  lastCompletionAt: z.string().optional(),
  lastGraphChangeAt: z.string().optional(),
  metric: z.string().optional(),
  nodeIds: z.array(z.string()).optional(),
  phase: WorkflowPhaseIdSchema.optional(),
  plannerRuns: z.number().int().nonnegative().optional(),
  status: WorkflowGraphCollectionStatusSchema.optional(),
  title: z.string().optional(),
})
/** Shape of the workflow graph collection. */
export type WorkflowGraphCollection = z.infer<typeof WorkflowGraphCollectionSchema>

/** The workflow graph schema value. */
export const WorkflowGraphSchema = z.object({
  collections: z.array(WorkflowGraphCollectionSchema).optional(),
  edges: z.array(WorkflowGraphEdgeSchema),
  nodes: z.array(WorkflowGraphNodeSchema),
})
/** Shape of the workflow graph. */
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>

/** The workflow graph planner node schema value. */
export const WorkflowGraphPlannerNodeSchema = z.object({
  collectionId: z.string().optional(),
  dependsOn: z.array(z.string()).default([]),
  description: z.string().optional(),
  id: z.string(),
  kind: z.enum(['phase', 'task']).default('task'),
  phase: WorkflowPhaseIdSchema.optional(),
  prompt: z.string().optional(),
  title: z.string(),
})
/** Shape of the workflow graph planner node. */
export type WorkflowGraphPlannerNode = z.infer<typeof WorkflowGraphPlannerNodeSchema>

/** The workflow graph planner result schema value. */
export const WorkflowGraphPlannerResultSchema = z.object({
  collectionNodeIds: z.array(z.string()).optional(),
  edges: z.array(WorkflowGraphEdgeSchema).default([]),
  exhausted: z.boolean().optional(),
  nodes: z.array(WorkflowGraphPlannerNodeSchema).default([]),
  reasoning: z.string().optional(),
})
/** Shape of the workflow graph planner result. */
export type WorkflowGraphPlannerResult = z.infer<typeof WorkflowGraphPlannerResultSchema>

/** The workflow graph seed collection schema value. */
export const WorkflowGraphSeedCollectionSchema = z.object({
  collectionId: z.string(),
  explorable: z.boolean().optional(),
  frontierTarget: z.number().int().positive().optional(),
  goal: z.string().optional(),
  metric: z.string().optional(),
  nodeIds: z.array(z.string()).default([]),
  phase: WorkflowPhaseIdSchema.optional(),
  title: z.string().optional(),
})
/** Shape of the workflow graph seed collection. */
export type WorkflowGraphSeedCollection = z.infer<typeof WorkflowGraphSeedCollectionSchema>

/** The workflow graph seed schema value. */
export const WorkflowGraphSeedSchema = z.object({
  collections: z.array(WorkflowGraphSeedCollectionSchema).default([]),
  edges: z.array(WorkflowGraphEdgeSchema).default([]),
  nodes: z.array(WorkflowGraphPlannerNodeSchema).default([]),
  reasoning: z.string().optional(),
})
/** Shape of the workflow graph seed. */
export type WorkflowGraphSeed = z.infer<typeof WorkflowGraphSeedSchema>

/** The workflow node prompt update schema value. */
export const WorkflowNodePromptUpdateSchema = z
  .object({
    description: z.string().min(1).optional(),
    id: z.string().min(1),
    prompt: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
  })
  .refine(
    update =>
      update.description !== undefined || update.prompt !== undefined || update.title !== undefined,
    {
      message: 'Workflow node prompt update must include prompt, description, or title',
    },
  )
/** Shape of the workflow node prompt update. */
export type WorkflowNodePromptUpdate = z.infer<typeof WorkflowNodePromptUpdateSchema>

/** The workflow node prompt update set schema value. */
export const WorkflowNodePromptUpdateSetSchema = z.object({
  nodes: z.array(WorkflowNodePromptUpdateSchema).default([]),
  reasoning: z.string().optional(),
})
/** Shape of the workflow node prompt update set. */
export type WorkflowNodePromptUpdateSet = z.infer<typeof WorkflowNodePromptUpdateSetSchema>

/** The workflow critic severity schema value. */
export const WorkflowCriticSeveritySchema = z.enum(['critical', 'major', 'minor'])
/** Shape of the workflow critic severity. */
export type WorkflowCriticSeverity = z.infer<typeof WorkflowCriticSeveritySchema>

/** The workflow critic reopen proposal schema value. */
export const WorkflowCriticReopenProposalSchema = z.object({
  nodeId: z.string().min(1),
  reason: z.string().min(1),
  severity: WorkflowCriticSeveritySchema.optional(),
})
/** Shape of the workflow critic reopen proposal. */
export type WorkflowCriticReopenProposal = z.infer<typeof WorkflowCriticReopenProposalSchema>

/** The workflow critic result schema value. */
export const WorkflowCriticResultSchema = z.object({
  acceptanceGaps: z.array(z.string()).default([]),
  reasoning: z.string().default(''),
  reopenProposals: z.array(WorkflowCriticReopenProposalSchema).default([]),
  verdict: z.enum(['pass', 'fail']),
})
/** Shape of the workflow critic result. */
export type WorkflowCriticResult = z.infer<typeof WorkflowCriticResultSchema>

/** The workflow run snapshot schema value. */
export const WorkflowRunSnapshotSchema = z.object({
  activities: z.array(WorkflowActivitySnapshotSchema).default([]),
  artifacts: z.array(WorkflowArtifactSchema),
  completedAt: z.string().optional(),
  createdAt: z.string(),
  currentPhase: WorkflowPhaseIdSchema.optional(),
  cwd: z.string(),
  definitionId: z.string().min(1).optional(),
  definitionVersion: z.string().min(1).optional(),
  graph: WorkflowGraphSchema,
  kind: WorkflowKindSchema,
  phaseOrder: z.array(WorkflowPhaseIdSchema),
  phases: z.array(WorkflowPhaseSnapshotSchema),
  failure: WorkflowFailureSchema.optional(),
  pauseReason: z.string().optional(),
  reportPath: z.string().optional(),
  recoveryActions: z.array(WorkflowRecoveryActionSchema).default([]),
  runId: z.string(),
  schemaVersion: z.literal(1),
  sessionId: z.string().optional(),
  sessionLinks: z.array(WorkflowSessionLinkSchema).default([]),
  startedAt: z.string().optional(),
  status: WorkflowRunStatusSchema,
  strategy: WorkflowStrategySchema,
  task: z.string(),
  traceId: z.string().optional(),
  updatedAt: z.string(),
})
/** Shape of the workflow run snapshot. */
export type WorkflowRunSnapshot = z.infer<typeof WorkflowRunSnapshotSchema>

/** The expert workflow run snapshot schema value. */
export const ExpertWorkflowRunSnapshotSchema = WorkflowRunSnapshotSchema
/** Shape of the expert workflow run snapshot. */
export type ExpertWorkflowRunSnapshot = WorkflowRunSnapshot

/** The workflow event type schema value. */
export const WorkflowEventTypeSchema = z.enum([
  'run_started',
  'run_completed',
  'run_failed',
  'workflow_paused',
  'workflow_retry_started',
  'workflow_session_linked',
  'run_cancelled',
  'phase_started',
  'phase_completed',
  'phase_failed',
  'artifact_written',
  'graph_updated',
  'node_started',
  'node_completed',
  'node_failed',
  'frontier_changed',
  'executor_paused',
  'executor_completed',
  'planner_started',
  'planner_completed',
  'planner_failed',
  'graph_expanded',
  'collection_exhausted',
  'critic_started',
  'critic_passed',
  'critic_failed',
  'node_reopened',
  'critic_iteration_limit_reached',
])
/** Shape of the workflow event type. */
export type WorkflowEventType = z.infer<typeof WorkflowEventTypeSchema>

/** The workflow event schema value. */
export const WorkflowEventSchema = z.object({
  kind: WorkflowKindSchema,
  message: z.string().optional(),
  nodeId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  phase: WorkflowPhaseIdSchema.optional(),
  runId: z.string(),
  timestamp: z.string(),
  type: WorkflowEventTypeSchema,
})
/** Shape of the workflow event. */
export type WorkflowEvent = z.infer<typeof WorkflowEventSchema>

/** The workflow graph record schema value. */
export const WorkflowGraphRecordSchema = z.discriminatedUnion('recordType', [
  z.object({
    recordType: z.literal('meta'),
    createdAt: z.string(),
    definitionId: z.string().min(1).optional(),
    definitionVersion: z.string().min(1).optional(),
    phaseOrder: z.array(WorkflowPhaseIdSchema),
    runId: z.string(),
    schemaVersion: z.literal(1),
    strategy: WorkflowStrategySchema,
  }),
  z.object({
    recordType: z.literal('node'),
    node: WorkflowGraphNodeSchema,
    runId: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    recordType: z.literal('edge'),
    edge: WorkflowGraphEdgeSchema,
    runId: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    recordType: z.literal('collection'),
    collection: WorkflowGraphCollectionSchema,
    runId: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    collectionId: z.string().optional(),
    edgeIds: z.array(z.string()).optional(),
    recordType: z.literal('op'),
    nodeId: z.string().optional(),
    nodeIds: z.array(z.string()).optional(),
    phase: WorkflowPhaseIdSchema.optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
    runId: z.string(),
    status: WorkflowNodeStatusSchema.optional(),
    timestamp: z.string(),
    type: z.string(),
  }),
])
/** Shape of the workflow graph record. */
export type WorkflowGraphRecord = z.infer<typeof WorkflowGraphRecordSchema>

/** The workflow scheduler derived node schema value. */
export const WorkflowSchedulerDerivedNodeSchema = z.object({
  blockedBy: z.array(z.string()),
  collectionIds: z.array(z.string()).default([]),
  incoming: z.array(z.string()),
  node: WorkflowGraphNodeSchema,
  outgoing: z.array(z.string()),
  ready: z.boolean(),
})
/** Shape of the workflow scheduler derived node. */
export type WorkflowSchedulerDerivedNode = z.infer<typeof WorkflowSchedulerDerivedNodeSchema>

/** The workflow scheduler collection state schema value. */
export const WorkflowSchedulerCollectionStateSchema = z.object({
  activeNodeIds: z.array(z.string()),
  collection: WorkflowGraphCollectionSchema,
  completedNodeIds: z.array(z.string()),
  errorCount: z.number().int().nonnegative(),
  exhausted: z.boolean(),
  failedNodeIds: z.array(z.string()),
  frontier: z.number().int().nonnegative(),
  frontierTarget: z.number().int().positive().optional(),
  pendingNodeIds: z.array(z.string()),
  plannerRuns: z.number().int().nonnegative(),
  readyNodeIds: z.array(z.string()),
  status: WorkflowGraphCollectionStatusSchema,
})
/** Shape of the workflow scheduler collection state. */
export type WorkflowSchedulerCollectionState = z.infer<
  typeof WorkflowSchedulerCollectionStateSchema
>

/** The workflow scheduler active activity schema value. */
export const WorkflowSchedulerActiveActivitySchema = z.object({
  activityId: z.string(),
  nodeId: z.string().optional(),
  phase: WorkflowPhaseIdSchema,
  sessionId: z.string().optional(),
  traceId: z.string().optional(),
  turnId: z.string().optional(),
})
/** Shape of the workflow scheduler active activity. */
export type WorkflowSchedulerActiveActivity = z.infer<typeof WorkflowSchedulerActiveActivitySchema>

/** The workflow scheduler state schema value. */
export const WorkflowSchedulerStateSchema = z.object({
  activeActivities: z.array(WorkflowSchedulerActiveActivitySchema),
  activeChildSessionIds: z.array(z.string()),
  activeNodeIds: z.array(z.string()),
  blockedNodes: z.array(
    z.object({
      blockedBy: z.array(z.string()),
      nodeId: z.string(),
    }),
  ),
  counts: z.object({
    active: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  collectionStates: z.array(WorkflowSchedulerCollectionStateSchema).default([]),
  nodes: z.array(WorkflowSchedulerDerivedNodeSchema),
  readyNodeIds: z.array(z.string()),
})
/** Shape of the workflow scheduler state. */
export type WorkflowSchedulerState = z.infer<typeof WorkflowSchedulerStateSchema>

const TERMINAL_DEPENDENCY_STATUSES = new Set<WorkflowNodeStatus>([
  'cancelled',
  'completed',
  'failed',
  'skipped',
])

/**
 * Derives the workflow scheduler state.
 * @param graph - the graph argument.
 * @returns the computed result.
 */
export function deriveWorkflowSchedulerState(graph: WorkflowGraph): WorkflowSchedulerState {
  const nodesById = new Map(graph.nodes.map(node => [node.id, node]))
  const incomingById = new Map<string, string[]>()
  const outgoingById = new Map<string, string[]>()

  for (const node of graph.nodes) {
    incomingById.set(node.id, [...node.dependsOn])
    outgoingById.set(node.id, [])
  }

  for (const edge of graph.edges) {
    incomingById.set(edge.to, [...(incomingById.get(edge.to) ?? []), edge.from])
    outgoingById.set(edge.from, [...(outgoingById.get(edge.from) ?? []), edge.to])
  }

  const collections = graph.collections ?? []
  const collectionIdsByNodeId = new Map<string, string[]>()
  for (const collection of collections) {
    for (const nodeId of collection.nodeIds ?? []) {
      const collectionIds = collectionIdsByNodeId.get(nodeId) ?? []
      collectionIds.push(collection.collectionId)
      collectionIdsByNodeId.set(nodeId, collectionIds)
    }
  }
  for (const node of graph.nodes) {
    if (!node.collectionId) continue
    const collectionIds = collectionIdsByNodeId.get(node.id) ?? []
    if (!collectionIds.includes(node.collectionId)) {
      collectionIds.push(node.collectionId)
      collectionIdsByNodeId.set(node.id, collectionIds)
    }
  }

  const nodes = graph.nodes.map((node) => {
    const incoming = [...new Set(incomingById.get(node.id) ?? [])]
    const blockedBy = incoming.filter((dependencyId) => {
      const dependency = nodesById.get(dependencyId)
      return !dependency || !TERMINAL_DEPENDENCY_STATUSES.has(dependency.status)
    })
    return {
      blockedBy,
      collectionIds: collectionIdsByNodeId.get(node.id) ?? [],
      incoming,
      node,
      outgoing: [...new Set(outgoingById.get(node.id) ?? [])],
      ready: node.status === 'pending' && blockedBy.length === 0,
    }
  })

  const activeNodeIds = nodes
    .filter(entry => entry.node.status === 'active')
    .map(entry => entry.node.id)
  const blockedNodes = nodes
    .filter(entry => entry.node.status === 'pending' && entry.blockedBy.length > 0)
    .map(entry => ({ blockedBy: entry.blockedBy, nodeId: entry.node.id }))
  const readyNodeIds = nodes.filter(entry => entry.ready).map(entry => entry.node.id)
  const collectionStates = collections.map((collection) => {
    const nodeIds = [
      ...new Set([
        ...(collection.nodeIds ?? []),
        ...graph.nodes
          .filter(node => node.collectionId === collection.collectionId)
          .map(node => node.id),
      ]),
    ]
    const activeCollectionNodeIds = nodeIds.filter(
      nodeId => nodesById.get(nodeId)?.status === 'active',
    )
    const pendingNodeIds = nodeIds.filter(nodeId => nodesById.get(nodeId)?.status === 'pending')
    const completedNodeIds = nodeIds.filter(
      nodeId => nodesById.get(nodeId)?.status === 'completed',
    )
    const failedNodeIds = nodeIds.filter(nodeId => nodesById.get(nodeId)?.status === 'failed')
    const readyCollectionNodeIds = readyNodeIds.filter(nodeId => nodeIds.includes(nodeId))
    return {
      activeNodeIds: activeCollectionNodeIds,
      collection,
      completedNodeIds,
      errorCount: collection.errorCount ?? 0,
      exhausted: collection.exhausted ?? false,
      failedNodeIds,
      frontier: activeCollectionNodeIds.length + pendingNodeIds.length,
      frontierTarget: collection.frontierTarget,
      pendingNodeIds,
      plannerRuns: collection.plannerRuns ?? 0,
      readyNodeIds: readyCollectionNodeIds,
      status: collection.status ?? 'active',
    }
  })

  return {
    activeActivities: [],
    activeChildSessionIds: [],
    activeNodeIds,
    blockedNodes,
    counts: {
      active: activeNodeIds.length,
      blocked: blockedNodes.length,
      completed: nodes.filter(entry => entry.node.status === 'completed').length,
      failed: nodes.filter(entry => entry.node.status === 'failed').length,
      pending: nodes.filter(entry => entry.node.status === 'pending').length,
      ready: readyNodeIds.length,
      total: nodes.length,
    },
    collectionStates,
    nodes,
    readyNodeIds,
  }
}

/**
 * Derives the workflow run scheduler state.
 * @param snapshot - the snapshot argument.
 * @returns the computed result.
 */
export function deriveWorkflowRunSchedulerState(
  snapshot: WorkflowRunSnapshot,
): WorkflowSchedulerState {
  const state = deriveWorkflowSchedulerState(snapshot.graph)
  const activeActivities = snapshot.activities
    .filter(activity => activity.status === 'active')
    .map(activity => ({
      activityId: activity.activityId,
      ...(activity.nodeId ? { nodeId: activity.nodeId } : {}),
      phase: activity.phase,
      ...(activity.sessionId ? { sessionId: activity.sessionId } : {}),
      ...(activity.traceId ? { traceId: activity.traceId } : {}),
      ...(activity.turnId ? { turnId: activity.turnId } : {}),
    }))

  return {
    ...state,
    activeActivities,
    activeChildSessionIds: activeActivities
      .map(activity => activity.sessionId)
      .filter((sessionId): sessionId is string => sessionId !== undefined),
  }
}

/**
 * Derives the workflow session links.
 * @param snapshot - the snapshot argument.
 * @returns the computed result.
 */
export function deriveWorkflowSessionLinks(
  snapshot: Pick<WorkflowRunSnapshot, 'activities' | 'runId'>,
): WorkflowSessionLink[] {
  const attemptByScope = new Map<string, number>()
  return snapshot.activities.map((activity) => {
    const scope = [
      activity.phase,
      activity.nodeId ?? `phase:${activity.phase}`,
      activity.kind,
    ].join(':')
    const attempt = (attemptByScope.get(scope) ?? 0) + 1
    attemptByScope.set(scope, attempt)
    return {
      activityId: activity.activityId,
      attempt,
      ...(activity.completedAt ? { completedAt: activity.completedAt } : {}),
      kind: activity.kind,
      ...(activity.model ? { model: activity.model } : {}),
      ...(activity.nodeId ? { nodeId: activity.nodeId } : {}),
      ...(activity.parentSessionId ? { parentSessionId: activity.parentSessionId } : {}),
      phase: activity.phase,
      runId: snapshot.runId,
      ...(activity.sessionId ? { sessionId: activity.sessionId } : {}),
      startedAt: activity.startedAt,
      status: workflowSessionLinkStatusFromActivity(activity.status),
      ...(activity.traceId ? { traceId: activity.traceId } : {}),
      ...(activity.turnId ? { turnId: activity.turnId } : {}),
    }
  })
}

function workflowSessionLinkStatusFromActivity(
  status: WorkflowNodeStatus,
): WorkflowSessionLinkStatus {
  switch (status) {
    case 'active':
      return 'running'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'cancelled':
    case 'skipped':
      return 'cancelled'
    case 'pending':
    default:
      return 'starting'
  }
}

/** Shape of the workflow run list item. */
export interface WorkflowRunListItem {
  completedAt?: string
  createdAt: string
  cwd: string
  kind: WorkflowKind
  runId: string
  status: WorkflowRunStatus
  task: string
  updatedAt: string
}

/** Shape of the workflow store port. */
export interface WorkflowStorePort {
  appendEvent(event: WorkflowEvent, options?: { signal?: AbortSignal }): Promise<void>
  appendGraphRecord(
    runId: string,
    record: WorkflowGraphRecord,
    options?: { signal?: AbortSignal },
  ): Promise<void>
  listRuns(
    options?: { cwd?: string; kind?: WorkflowKind; limit?: number },
    signalOptions?: { signal?: AbortSignal },
  ): Promise<WorkflowRunListItem[]>
  readEvents(runId: string, options?: { signal?: AbortSignal }): Promise<WorkflowEvent[]>
  readLatestRun(
    options?: { cwd?: string; kind?: WorkflowKind },
    signalOptions?: { signal?: AbortSignal },
  ): Promise<WorkflowRunSnapshot | null>
  readRun(runId: string, options?: { signal?: AbortSignal }): Promise<WorkflowRunSnapshot | null>
  writeArtifact(
    runId: string,
    relativePath: string,
    content: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ path: string; relativePath: string }>
  writeReport(
    runId: string,
    content: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ path: string; relativePath: string }>
  writeSnapshot(snapshot: WorkflowRunSnapshot, options?: { signal?: AbortSignal }): Promise<void>
}

/** Shape of the workflow definition store port. */
export interface WorkflowDefinitionStorePort {
  listDefinitions(options?: { signal?: AbortSignal }): Promise<WorkflowDefinition[]>
  readDefinition(
    definitionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<WorkflowDefinition | null>
}
