import type { WorkflowGraph, WorkflowGraphEdge, WorkflowRunStatus } from '@deepseek-ai/dsh-workflow-runs'

/**
 * Handles the phase node id.
 * @param phase - the phase argument.
 * @returns the computed result.
 */
export function phaseNodeId(phase: string): string {
  return `phase:${phase}`
}

/**
 * Handles the edge id.
 * @param edge - the edge argument.
 * @returns the computed result.
 */
export function edgeId(edge: WorkflowGraphEdge): string {
  return `${edge.from}->${edge.to}`
}

/**
 * Handles the executable node ids for phase.
 * @param graph - the graph argument.
 * @param phase - the phase argument.
 * @returns the computed result.
 */
export function executableNodeIdsForPhase(graph: WorkflowGraph, phase: string): string[] {
  const taskIds = graph.nodes
    .filter(node => node.kind === 'task' && (node.phase === phase || !node.phase))
    .map(node => node.id)
  return taskIds.length > 0 ? taskIds : [phaseNodeId(phase)]
}

/**
 * Handles the safe artifact name.
 * @param value - the value argument.
 * @returns the computed result.
 */
export function safeArtifactName(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return safe.length > 0 ? safe : 'workflow'
}

/**
 * Handles the safe run id segment.
 * @param value - the value argument.
 * @returns the computed result.
 */
export function safeRunIdSegment(value: string): string {
  return safeArtifactName(value).replace(/[.]/g, '-')
}

/**
 * Iss the terminal status.
 * @param status - the status argument.
 * @returns the computed result.
 */
export function isTerminalStatus(status: WorkflowRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}
