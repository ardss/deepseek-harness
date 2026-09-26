import {
  deriveWorkflowSchedulerState,
  deriveWorkflowSessionLinks,
  type WorkflowActivitySnapshot,
  type WorkflowArtifact,
  type WorkflowGraph,
  type WorkflowGraphCollection,
  type WorkflowGraphNode,
  type WorkflowNodeStatus,
  type WorkflowRunSnapshot,
} from '@deepseek-ai/dsh-workflow-runs'
import type { SchedulerCollection, WorkflowGraphRecordEdge } from './types.js'

const COMPLETED_NODE_STATUSES = new Set<WorkflowNodeStatus>(['cancelled', 'completed', 'skipped'])

/**
 * Handles the ready executable nodes.
 * @param graph - the graph argument.
 * @param executableNodeIds - the executableNodeIds argument.
 * @returns the computed result.
 */
export function readyExecutableNodes(
  graph: WorkflowGraph,
  executableNodeIds: Set<string>,
): WorkflowGraphNode[] {
  const state = deriveWorkflowSchedulerState(graph)
  const readyNodeIds = new Set(state.readyNodeIds)
  return graph.nodes.filter(node => executableNodeIds.has(node.id) && readyNodeIds.has(node.id))
}

/**
 * Handles the ordered ready executable nodes.
 * @param graph - the graph argument.
 * @param executableNodeIds - the executableNodeIds argument.
 * @returns the computed result.
 */
export function orderedReadyExecutableNodes(
  graph: WorkflowGraph,
  executableNodeIds: Set<string>,
): WorkflowGraphNode[] {
  const readyNodes = readyExecutableNodes(graph, executableNodeIds)
  const explorationNodeIds = new Set<string>()
  const explorationByCollection = new Map<string, WorkflowGraphNode[]>()
  for (const collection of graphCollections(graph)) {
    if (!collection.explorable || collection.exhausted) continue
    const nodeIds = new Set(collectionNodeIdsForGraph(collection, graph))
    for (const node of readyNodes) {
      if (!nodeIds.has(node.id)) continue
      explorationNodeIds.add(node.id)
      const list = explorationByCollection.get(collection.collectionId) ?? []
      list.push(node)
      explorationByCollection.set(collection.collectionId, list)
    }
  }

  const engineeringNodes = readyNodes.filter(node => !explorationNodeIds.has(node.id))
  const explorationNodes: WorkflowGraphNode[] = []
  const collectionIds = [...explorationByCollection.keys()]
  let index = 0
  while (collectionIds.length > 0) {
    const collectionIndex = index % collectionIds.length
    const collectionId = collectionIds[collectionIndex]!
    const nodes = explorationByCollection.get(collectionId) ?? []
    const node = nodes.shift()
    if (node) explorationNodes.push(node)
    if (nodes.length === 0) {
      collectionIds.splice(collectionIndex, 1)
    } else {
      index++
    }
  }

  return [...engineeringNodes, ...explorationNodes]
}

/**
 * Handles the blocked executable nodes.
 * @param graph - the graph argument.
 * @param executableNodeIds - the executableNodeIds argument.
 * @returns the computed result.
 */
export function blockedExecutableNodes(
  graph: WorkflowGraph,
  executableNodeIds: Set<string>,
): Array<{ blockedBy: string[]; nodeId: string }> {
  return deriveWorkflowSchedulerState(graph).blockedNodes.filter(entry =>
    executableNodeIds.has(entry.nodeId),
  )
}

/**
 * Handles the are executable nodes complete.
 * @param graph - the graph argument.
 * @param executableNodeIds - the executableNodeIds argument.
 * @param waitsForCollections - the waitsForCollections argument.
 * @returns the computed result.
 */
export function areExecutableNodesComplete(
  graph: WorkflowGraph,
  executableNodeIds: Set<string>,
  waitsForCollections: boolean,
): boolean {
  const executableNodes = graph.nodes.filter(node => executableNodeIds.has(node.id))
  if (!executableNodes.every(node => COMPLETED_NODE_STATUSES.has(node.status))) {
    return false
  }
  if (!waitsForCollections) return true
  return graphCollections(graph)
    .filter(collection => collection.explorable && isCollectionRelevant(collection, graph))
    .every(collection => collection.exhausted || collection.status === 'exhausted')
}

/**
 * Handles the update graph node.
 * @param snapshot - the snapshot argument.
 * @param nodeId - the nodeId argument.
 * @param patch - the patch argument.
 * @returns the computed result.
 */
export function updateGraphNode(
  snapshot: WorkflowRunSnapshot,
  nodeId: string,
  patch: Partial<Pick<WorkflowGraphNode, 'attempts' | 'error' | 'status'>>,
): WorkflowRunSnapshot {
  return {
    ...snapshot,
    graph: {
      collections: snapshot.graph.collections,
      edges: snapshot.graph.edges,
      nodes: snapshot.graph.nodes.map(node =>
        node.id === nodeId
          ? {
            ...node,
            ...patch,
          }
          : node,
      ),
    },
  }
}

/**
 * Handles the update graph collection.
 * @param snapshot - the snapshot argument.
 * @param collectionId - the collectionId argument.
 * @param patch - the patch argument.
 * @param timestamp - the timestamp argument.
 * @returns the computed result.
 */
export function updateGraphCollection(
  snapshot: WorkflowRunSnapshot,
  collectionId: string,
  patch: Partial<WorkflowGraphCollection>,
  timestamp: string,
): WorkflowRunSnapshot {
  const collections = graphCollections(snapshot.graph)
  const existing = collections.find(collection => collection.collectionId === collectionId)
  const nextCollection = normalizeCollection({
    ...(existing ?? { collectionId }),
    ...patch,
    collectionId,
  })
  const found = existing !== undefined
  return {
    ...snapshot,
    graph: {
      collections: found
        ? collections.map(collection =>
          collection.collectionId === collectionId ? nextCollection : collection,
        )
        : [...collections, nextCollection],
      edges: snapshot.graph.edges,
      nodes: snapshot.graph.nodes,
    },
    updatedAt: timestamp,
  }
}

/**
 * Handles the upsert activity.
 * @param snapshot - the snapshot argument.
 * @param activity - the activity argument.
 * @param timestamp - the timestamp argument.
 * @returns the computed result.
 */
export function upsertActivity(
  snapshot: WorkflowRunSnapshot,
  activity: WorkflowActivitySnapshot,
  timestamp: string,
): WorkflowRunSnapshot {
  const activities = [
    ...snapshot.activities.filter(item => item.activityId !== activity.activityId),
    activity,
  ]
  return {
    ...snapshot,
    activities,
    sessionLinks: deriveWorkflowSessionLinks({ activities, runId: snapshot.runId }),
    updatedAt: timestamp,
  }
}

/**
 * Handles the add artifact.
 * @param snapshot - the snapshot argument.
 * @param artifact - the artifact argument.
 * @param timestamp - the timestamp argument.
 * @returns the computed result.
 */
export function addArtifact(
  snapshot: WorkflowRunSnapshot,
  artifact: WorkflowArtifact,
  timestamp: string,
): WorkflowRunSnapshot {
  return {
    ...snapshot,
    artifacts: [...snapshot.artifacts.filter(item => item.path !== artifact.path), artifact],
    updatedAt: timestamp,
  }
}

/**
 * Handles the graph collections.
 * @param graph - the graph argument.
 * @returns the computed result.
 */
export function graphCollections(graph: WorkflowGraph): SchedulerCollection[] {
  return (graph.collections ?? []).map(normalizeCollection)
}

/**
 * Normalizes the collection.
 * @param collection - the collection argument.
 * @returns the computed result.
 */
export function normalizeCollection(collection: WorkflowGraphCollection): SchedulerCollection {
  return {
    ...collection,
    analyzedNodeIds: collection.analyzedNodeIds ?? [],
    errorCount: collection.errorCount ?? 0,
    exhausted: collection.exhausted ?? false,
    explorable: collection.explorable ?? false,
    nodeIds: collection.nodeIds ?? [],
    plannerRuns: collection.plannerRuns ?? 0,
    status: collection.status ?? 'active',
  }
}

/**
 * Handles the collection node ids for graph.
 * @param collection - the collection argument.
 * @param graph - the graph argument.
 * @returns the computed result.
 */
export function collectionNodeIdsForGraph(
  collection: WorkflowGraphCollection,
  graph: WorkflowGraph,
): string[] {
  return [
    ...new Set([
      ...(collection.nodeIds ?? []),
      ...graph.nodes
        .filter(node => node.collectionId === collection.collectionId)
        .map(node => node.id),
    ]),
  ]
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
 * Handles the collection frontier.
 * @param graph - the graph argument.
 * @param collection - the collection argument.
 * @returns the computed result.
 */
export function collectionFrontier(
  graph: WorkflowGraph,
  collection: WorkflowGraphCollection,
): number {
  return collectionNodeIdsForGraph(collection, graph).filter((nodeId) => {
    const status = nodeById(graph, nodeId)?.status
    return status === 'pending' || status === 'active'
  }).length
}

/**
 * Handles the node by id.
 * @param graph - the graph argument.
 * @param nodeId - the nodeId argument.
 * @returns the computed result.
 */
export function nodeById(graph: WorkflowGraph, nodeId: string): WorkflowGraphNode | undefined {
  return graph.nodes.find(node => node.id === nodeId)
}

/**
 * Iss the collection in phase.
 * @param collection - the collection argument.
 * @param graph - the graph argument.
 * @param executableNodeIds - the executableNodeIds argument.
 * @param phase - the phase argument.
 * @returns the computed result.
 */
export function isCollectionInPhase(
  collection: WorkflowGraphCollection,
  graph: WorkflowGraph,
  executableNodeIds: Set<string>,
  phase: string,
): boolean {
  if (collection.phase) return collection.phase === phase
  const nodeIds = collectionNodeIdsForGraph(collection, graph)
  return nodeIds.length === 0 || nodeIds.some(nodeId => executableNodeIds.has(nodeId))
}

function isCollectionRelevant(
  collection: WorkflowGraphCollection,
  graph: WorkflowGraph,
): boolean {
  return collectionNodeIdsForGraph(collection, graph).length > 0
}

/**
 * Handles the edge id.
 * @param edge - the edge argument.
 * @returns the computed result.
 */
export function edgeId(edge: WorkflowGraphRecordEdge): string {
  return `${edge.from}->${edge.to}`
}
