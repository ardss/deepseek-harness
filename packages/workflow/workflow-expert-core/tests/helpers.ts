/**
 * 测试辅助：构造合法的 ExpertWorkflowRunSnapshot（过 zod 校验的最小快照）。
 */
import {
  WorkflowRunSnapshotSchema,
  type WorkflowGraph,
  type WorkflowRunSnapshot,
} from '@deepseek-ai/dsh-workflow-runs'

export const T0 = '2026-01-01T00:00:00.000Z'

export function emptyGraph(): WorkflowGraph {
  return { edges: [], nodes: [] }
}

export function makeSnapshot(overrides: {
  graph?: WorkflowGraph
  phases?: WorkflowRunSnapshot['phases']
  status?: WorkflowRunSnapshot['status']
}): WorkflowRunSnapshot {
  return WorkflowRunSnapshotSchema.parse({
    artifacts: [],
    createdAt: T0,
    cwd: 'C:/tmp/workflow-test',
    graph: overrides.graph ?? emptyGraph(),
    kind: 'expert',
    phaseOrder: ['clarify', 'exec'],
    phases: overrides.phases ?? [
      { phase: 'clarify', status: 'completed' },
      { phase: 'exec', status: overrides.status === 'running' ? 'active' : 'pending' },
    ],
    recoveryActions: [],
    runId: 'wf_expert_test-0001',
    schemaVersion: 1,
    sessionLinks: [],
    status: overrides.status ?? 'running',
    strategy: {
      clarify: { confidenceThreshold: 0.8, maxRounds: 3, minRounds: 1 },
      executor: {
        drainingChangeHours: 1,
        frontierTarget: 3,
        maxConcurrentLoops: 2,
        maxConsecutiveErrors: 3,
        maxPlannerRuns: 10,
      },
      finalCritic: { maxIterations: 3 },
      reactLoop: { maxRounds: 30 },
    },
    task: '测试任务',
    updatedAt: T0,
  })
}

export function node(
  id: string,
  overrides: Partial<WorkflowGraph['nodes'][number]> = {},
): WorkflowGraph['nodes'][number] {
  return {
    dependsOn: [],
    id,
    kind: 'task',
    status: 'pending',
    title: id,
    ...overrides,
  }
}
